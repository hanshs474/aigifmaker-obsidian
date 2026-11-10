'use strict';
const { Plugin, Modal, Notice, PluginSettingTab, Setting, requestUrl, normalizePath, MarkdownView } = require('obsidian');

const BASE = 'https://aigifmaker.ai';
const KEYS_URL = `${BASE}/settings/apikeys`;
const PRICING_URL = `${BASE}/pricing`;
const DEFAULTS = { apiKey: '', folder: 'AI GIF Maker' };

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gif';
}

/** kind: auth | quota | rejected | failed | timeout | network | other */
class AigifmakerError extends Error {
  constructor(message, kind = 'other') { super(message); this.kind = kind; }
}

/** Every answer is HTTP 200; the JSON code says what happened (aigifmaker SPEC §2). */
function unwrap(status, body) {
  if (!body || typeof body.code !== 'number') throw new AigifmakerError((body && body.message) || `unexpected answer (HTTP ${status})`, status >= 500 ? 'network' : 'other');
  if (body.code !== 0) {
    const msg = body.message || `request refused (code ${body.code})`;
    if (/invalid api key|no auth/i.test(msg)) throw new AigifmakerError('the API key was rejected. Check it in Settings → AI GIF Maker.', 'auth');
    if (/insufficient credits/i.test(msg)) throw new AigifmakerError(`not enough credits. Top up at ${PRICING_URL}`, 'quota');
    if (body.code !== -1) throw new AigifmakerError(`${msg}. Reword the prompt and try again.`, 'rejected');
    throw new AigifmakerError(msg);
  }
  const data = body.data || {};
  if (data.wall === true) throw new AigifmakerError(`an API key is required. Create one at ${KEYS_URL} and paste it in Settings → AI GIF Maker.`, 'auth');
  return data;
}

/** requestUrl, not fetch: it is not subject to CORS inside the app. */
async function call(path, json, apiKey, base = BASE) {
  const key = (apiKey || '').trim();
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  let res;
  try {
    res = await requestUrl({ url: base + path, method: 'POST', throw: false, contentType: 'application/json', headers, body: JSON.stringify(json || {}) });
  } catch {
    throw new AigifmakerError('could not reach aigifmaker.ai.', 'network');
  }
  let body = null;
  try { body = res.json; } catch { /* non-JSON error page */ }
  return unwrap(res.status, body);
}

async function submit(prompt, apiKey, base = BASE) {
  const d = await call('/api/ai/generate', {
    provider: 'openlux', mediaType: 'image', model: 'gif-maker-v1', scene: 'text-to-image',
    prompt, options: { output_format: 'gif' },
  }, apiKey, base);
  if (!d.id) throw new AigifmakerError('aigifmaker.ai returned no task id');
  return String(d.id);
}

const status = (id, apiKey, base = BASE) => call('/api/ai/query', { taskId: String(id) }, apiKey, base);

/** Submit, poll every 3 s, return the GIF URL. */
async function generate(prompt, { apiKey, onQueued, pollEveryMs = 3000, timeoutMs = 15 * 60 * 1000, base = BASE } = {}) {
  const id = await submit(prompt, apiKey, base);
  onQueued && onQueued(id);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, pollEveryMs));
    let s;
    try { s = await status(id, apiKey, base); } catch (e) { if (e.kind === 'network') continue; throw e; } // a dropped poll is not a failed GIF
    if (s.status === 'success' && s.images && s.images.length) return String(s.images[0]);
    if (s.status === 'failed' || s.status === 'canceled') {
      throw new AigifmakerError(`the GIF ${s.status}${s.errorMessage ? `: ${s.errorMessage}` : ''}.`, s.failureKind === 'moderation' ? 'rejected' : 'failed');
    }
  }
  throw new AigifmakerError('not finished in time; the GIF will still be in your history on aigifmaker.ai.', 'timeout');
}

async function credits(apiKey, base = BASE) {
  const d = await call('/api/user/get-user-credits', {}, apiKey, base);
  return Number(d.remainingCredits || 0);
}

class PromptModal extends Modal {
  constructor(app, initial, onSubmit) {
    super(app);
    Object.assign(this, { onSubmit, prompt: initial || '' });
  }
  onOpen() {
    this.titleEl.setText('AI GIF Maker: make a GIF');
    new Setting(this.contentEl).setName('What should the GIF show?').addTextArea((t) => {
      t.setPlaceholder('a corgi in a party hat blowing out birthday candles, confetti falling').setValue(this.prompt).onChange((v) => (this.prompt = v));
      t.inputEl.rows = 4;
      t.inputEl.style.width = '100%';
    });
    new Setting(this.contentEl).setDesc('One GIF costs 1 credit.').addButton((b) => b.setButtonText('Make GIF').setCta().onClick(() => {
      if (!this.prompt.trim()) return new Notice('Write what the GIF should show first.');
      this.close();
      this.onSubmit(this.prompt.trim());
    }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = class AigifmakerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new AigifmakerSettingTab(this.app, this));
    this.addCommand({
      id: 'generate-gif', name: 'Make a GIF into this note',
      editorCallback: (editor) => this.open(editor.getSelection()),
    });
    this.addCommand({
      id: 'show-credits', name: 'Show remaining credits',
      callback: async () => {
        try { new Notice(`AI GIF Maker: ${await credits(this.settings.apiKey)} credits left.`); } catch (e) { new Notice(`AI GIF Maker: ${e.message}`); }
      },
    });
  }

  open(selection) {
    if (!(this.settings.apiKey || '').trim()) return new Notice(`AI GIF Maker: add your API key in Settings → AI GIF Maker first (create one at ${KEYS_URL}).`, 10000);
    new PromptModal(this.app, (selection || '').trim(), (prompt) => this.run(prompt)).open();
  }

  async save(url, name) {
    const res = await requestUrl({ url });
    const folder = normalizePath(this.settings.folder || DEFAULTS.folder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    return this.app.vault.createBinary(normalizePath(`${folder}/${name}-${Date.now().toString(36)}.gif`), res.arrayBuffer);
  }

  async run(prompt) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view && view.editor;
    const at = editor && editor.getCursor('to');
    const notice = new Notice('AI GIF Maker: sending…', 0);
    try {
      const url = await generate(prompt, {
        apiKey: this.settings.apiKey,
        onQueued: () => notice.setMessage('AI GIF Maker: making your GIF, about a minute…'),
      });
      const file = await this.save(url, slug(prompt));
      const link = `![[${file.path}]]\n`;
      if (editor && at) editor.replaceRange(link, at);
      notice.setMessage(`AI GIF Maker: saved ${file.path}`);
    } catch (e) {
      notice.setMessage(`AI GIF Maker: ${e.message}`);
    } finally {
      setTimeout(() => notice.hide(), 8000);
    }
  }
};

class AigifmakerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const saveAs = (k, f = (v) => v) => async (v) => { p.settings[k] = f(v); await p.saveData(p.settings); };
    containerEl.empty();
    new Setting(containerEl)
      .setName('API key')
      .setDesc('From aigifmaker.ai/settings/apikeys. Each GIF costs 1 credit on your AI GIF Maker account.')
      .addText((t) => { t.inputEl.type = 'password'; t.setValue(p.settings.apiKey).onChange(saveAs('apiKey', (v) => v.trim())); })
      .addExtraButton((b) => b.setIcon('external-link').setTooltip('Get a key').onClick(() => window.open(KEYS_URL)));
    new Setting(containerEl).setName('Folder').setDesc('Vault folder for new GIFs.')
      .addText((t) => t.setValue(p.settings.folder).onChange(saveAs('folder', (v) => v.trim() || DEFAULTS.folder)));
  }
}

module.exports.generate = generate;
module.exports.submit = submit;
module.exports.credits = credits;
module.exports.unwrap = unwrap;

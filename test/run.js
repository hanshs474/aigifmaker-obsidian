'use strict';
// node test/run.js          -> mocked unit tests (responses shaped like the live API, SPEC §2)
// node test/run.js --live   -> free live calls only: wrong key -> auth on credits, no key -> wall -> auth on submit
const Module = require('module');
const live = process.argv.includes('--live');
let polls = 0;
let lastBody;
let next = null;
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req !== 'obsidian') return origLoad.call(this, req, ...rest);
  const noop = class {};
  return {
    Plugin: noop, Modal: noop, PluginSettingTab: noop, Setting: noop, MarkdownView: noop, Notice: noop,
    normalizePath: (p) => p,
    requestUrl: async (o) => {
      if (live) {
        const r = await fetch(o.url, { method: o.method || 'GET', headers: { ...o.headers, 'content-type': o.contentType }, body: o.body });
        let json = null; try { json = JSON.parse(await r.text()); } catch {}
        return { status: r.status, json };
      }
      if (next) { const n = next; next = null; return { status: 200, json: n }; }
      const body = JSON.parse(o.body || '{}');
      if (o.url.endsWith('/api/ai/generate')) { lastBody = body; return { status: 200, json: { code: 0, message: 'ok', data: { id: 't1', status: 'pending' } } }; }
      if (o.url.endsWith('/api/user/get-user-credits')) return { status: 200, json: { code: 0, data: { remainingCredits: 42, made: 1 } } };
      if (polls++ === 0) return { status: 200, json: { code: 0, data: { id: 't1', status: 'processing', queued: true, queueEta: 30 } } };
      return { status: 200, json: { code: 0, data: { id: 't1', status: 'success', images: ['https://cdn/x.gif'], watermarked: [false] } } };
    },
  };
};
const assert = require('assert');
const { generate, submit, credits, unwrap } = require('../main.js');

(async () => {
  if (live) {
    await assert.rejects(credits('sk-invalidtest000'), (e) => e.kind === 'auth');
    await assert.rejects(submit('smoke test', ''), (e) => e.kind === 'auth' && /required/.test(e.message));
    console.log('live: wrong key -> auth (credits), no key -> wall -> auth (submit)');
    return;
  }
  assert.strictEqual(await generate('x', { apiKey: 'sk', pollEveryMs: 0 }), 'https://cdn/x.gif');
  assert.deepStrictEqual(lastBody, { provider: 'openlux', mediaType: 'image', model: 'gif-maker-v1', scene: 'text-to-image', prompt: 'x', options: { output_format: 'gif' } });
  assert.strictEqual(await credits('sk'), 42);
  const k = (b) => { try { unwrap(200, b); return 'none'; } catch (e) { return e.kind; } };
  assert.strictEqual(k({ code: -1, message: 'invalid API key — create one at https://aigifmaker.ai/settings/apikeys' }), 'auth');
  assert.strictEqual(k({ code: 0, data: { wall: true, reason: 'anon_credits' } }), 'auth');
  assert.strictEqual(k({ code: -1, message: 'insufficient credits' }), 'quota');
  assert.strictEqual(k({ code: 429, message: 'cooldown' }), 'rejected');
  assert.strictEqual(k({ code: -1, message: 'boom' }), 'other');
  next = { code: -1, message: 'invalid API key' };
  await assert.rejects(credits('sk'), (e) => e.kind === 'auth');
  console.log('all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

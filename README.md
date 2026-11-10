# AI GIF Maker for Obsidian

Turn text into animated GIFs with AI GIF Maker. Native GIF generation — no video conversion. Type what you want and download your GIF in about a minute.

This is the official Obsidian plugin for [AI GIF Maker](https://aigifmaker.ai/?utm_source=obsidian&utm_medium=plugin): put a GIF in your note without leaving it. Run **Make a GIF into this note**, describe the GIF (selected text is used as the starting prompt), and the finished GIF is saved to your vault and embedded at the cursor as `![[…gif]]`.

## Commands

- **Make a GIF into this note**: prompt in, GIF saved to the `AI GIF Maker` folder (configurable) and embedded where you were typing. The notice tells you when it is saved.
- **Show remaining credits**: free to call.

## Setup

1. Sign in on [AI GIF Maker](https://aigifmaker.ai/?utm_source=obsidian&utm_medium=plugin) and create a key at https://aigifmaker.ai/settings/apikeys.
2. Paste it into **Settings → AI GIF Maker → API key**.

Each GIF costs 1 credit on your AI GIF Maker account, the same as on the website. New accounts get one free GIF (it carries a small aigifmaker.ai badge), and a failed GIF gives its credit back. Credit packs are on the [pricing](https://aigifmaker.ai/pricing?utm_source=obsidian&utm_medium=plugin) page.

## Network use and privacy

The plugin talks only to `https://aigifmaker.ai`: your prompt goes to `/api/ai/generate`, the GIF is polled at `/api/ai/query`, and the balance comes from `/api/user/get-user-credits`. The finished GIF is downloaded into your vault. Your API key is stored in this plugin's data in your vault. Nothing else is sent, and there is no telemetry. An AI GIF Maker account is required.

`node test/run.js` runs the unit tests; `node test/run.js --live` checks against the live site that a wrong key and a missing key both end on the API-key error (nothing is generated).

MIT licensed. Questions: support@aigifmaker.ai.

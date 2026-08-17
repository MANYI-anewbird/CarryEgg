# CarryEgg

ChatGPT threads get long, slow, or stuck — and starting over means losing context. **CarryEgg** packs a conversation into something you can take with you: a paste-ready **continuation Egg**, or a clean **Chat Digest** worth saving.

A lightweight Chrome extension for [chatgpt.com](https://chatgpt.com). Built as Manifest V3, vanilla JavaScript, and optional OpenAI — no bloated dependencies.

---

## What you can do

**Continue when the chat feels stuck**  
One click packs the thread into a structured Egg: the latest turns stay intact, while goals, decisions, constraints, open questions, and code get distilled into background context. Paste it into a new chat and keep going without re-explaining everything.

**Summarize into a Chat Digest**  
Turn a long conversation into an archive card — Core Question, how your thinking evolved, the main insight, why it matters, and what’s still unresolved. Powered by OpenAI when you add your own API key (stored only on your device).

**Capture the whole thread**  
Older messages often aren’t in the DOM until you scroll. CarryEgg scrolls for you, then extracts turns as Markdown (including fenced code) so nothing important is left behind.

**Copy, download, or keep a few eggs**  
Copy to clipboard, download a file (`.md` for Continue, Word-friendly `.doc` for Digest), or pull a recent Egg back from your local Carton.

---

## How to use

1. Load the extension in Chrome (`chrome://extensions` → Developer mode → **Load unpacked** → this folder).
2. Open any chat on [chatgpt.com](https://chatgpt.com).
3. Click the CarryEgg icon.
4. Choose **Continue Chat** or **Summarize Chat**.
5. For Summarize, add your OpenAI API key once when prompted.
6. Wait while it loads older messages (and generates a digest if you chose Summarize).
7. **Copy** or **Download** — for Continue, paste the whole Egg into a new chat.

---

## Under the hood (for the curious)

CarryEgg is a small, deliberate stack — product first, engineering that stays out of the way:

| What you notice | What’s going on |
|-----------------|-----------------|
| Works on live ChatGPT pages | Content script with multi-tier DOM fallbacks and role detection (`data-message-author-role`), so UI churn doesn’t kill extraction |
| “Whole chat,” not just what’s on screen | Finds the scroll container, loads older turns, and stops when the thread stops growing |
| Continuation Eggs that actually hand off | Rule-based context compiler: relevance scoring, decision/constraint mining, artifact dedupe — optimized for paste-into-new-session |
| Digests that stay usable | OpenAI Chat Completions (e.g. GPT‑4o); long chats use **segment → merge**; results are schema-checked before you see them |
| Your key, your machine | BYOK via `chrome.storage.local`; auth vs rate-limit errors get different, clear recovery paths |

**Stack:** Chrome Extension (MV3) · Vanilla JS · OpenAI Chat Completions · `chrome.runtime` messaging · no npm runtime deps

```
background.js   # MV3 service worker
content.js      # Extract + full-snapshot scroll
popup/          # UI, digest API flow, continuation builder
manifest.json
```

---

## Tags

`Product` · `Chrome Extension` · `ChatGPT` · `LLM` · `OpenAI` · `Context Engineering` · `Prompt Design` · `Productivity` · `Manifest V3` · `Vanilla JS`

---

## License

See [LICENSE](LICENSE).

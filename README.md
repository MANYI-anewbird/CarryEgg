# CarryEgg

**The question:** The ChatGPT thread is long, slow, or stuck. Starting over means losing the context. How do you take the chat with you?

CarryEgg packs a conversation into something you can carry: a paste-ready **continuation Egg**, or a **Chat Digest** worth keeping. Chrome extension for [chatgpt.com](https://chatgpt.com).

**How we built that:** Manifest V3, vanilla JS — a content script scrolls and extracts the whole thread as Markdown, a rule-based compiler builds the Continue Egg, and **Summarize** calls OpenAI (**gpt-4o**, long chats **segment → merge**) with **BYOK** in `chrome.storage.local`.

**Chrome Store:** [CarryEgg](https://chromewebstore.google.com/detail/carryegg/pfieekhlecbboffjdgjggpmhmbdlbnee)

---

## Decision this supports

You do not want another chatbot. You want the *current* thread to survive a new window.

Two decisions CarryEgg is built for:

1. **Continue** — paste one Egg into a new chat and keep going without re-explaining goals, decisions, and constraints.
2. **Keep a digest** — Core Question, how thinking moved, the main insight, what’s still open — not a meeting-notes dump.

---

## What you get

- **Continue Chat** — latest turns intact; goals / decisions / constraints / open questions / code distilled as background
- **Summarize Chat** — Chat Digest (needs your OpenAI key, on-device only)
- **Full thread capture** — scrolls until older messages actually load
- **Copy, download, Carton** — `.md` for Continue, Word-friendly `.doc` for Digest; recent Eggs locally

---

## What it will not claim

Not a ChatGPT replacement. Not a cloud sync of your chats. Continue does **not** need a key; Summarize does. Auth failures and rate-limits are different errors on purpose. ChatGPT DOM changes can still break extraction — the content script uses multi-tier fallbacks (`data-message-author-role`).

---

## What’s in the repo

| Path | |
|---|---|
| `manifest.json` | MV3, `chatgpt.com` + `api.openai.com` |
| `content.js` | Extract + full-snapshot scroll |
| `background.js` | Service worker |
| `popup/` | UI, Continue compiler, digest API |
| [`docs/CHROME_STORE_CHECKLIST.md`](docs/CHROME_STORE_CHECKLIST.md) | Store packaging |

---

## How we built it (technical)

Stack: **Chrome Extension (MV3)** · vanilla JS · **OpenAI Chat Completions** · `chrome.runtime` messaging · no npm runtime dependencies.

**Capture.** Content script finds the scroll container, loads older turns, stops when the thread stops growing. Turns become Markdown, including fenced code.

**Continue.** Rule-based context compiler: relevance scoring, decision/constraint mining, artifact dedupe — optimized to paste into a new session, not to be a second LLM call.

**Digest.** `SUMMARY_MODEL = gpt-4o`. Short chats: one completion. Long chats: segment (550 tokens) then merge (2000). Schema-checked before display. Key validation can use `gpt-4o-mini`.

**Keys.** `carryegg_openai_api_key` in `chrome.storage.local`. Never commit a key.

---

## Setup

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Open a chat on [chatgpt.com](https://chatgpt.com).
3. Click the CarryEgg icon → **Continue Chat** or **Summarize Chat**.
4. For Summarize, add an OpenAI key when prompted.
5. **Copy** or **Download**. For Continue, paste the whole Egg into a new chat.

---

## License

See [LICENSE](LICENSE).

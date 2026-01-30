# CarryEgg — Chrome Web Store Checklist

## 1. Developer account

1. **Register** (one-time $5 USD)
   - Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Sign in with your Google account
   - Accept the agreement and pay the **$5** registration fee (lifetime)

---

## 2. Package the extension

### 2.1 What to include

**Include:**
- `manifest.json`
- `background.js`
- `content.js`
- `popup/` (popup.html, popup.css, popup.js, snapshot.js)
- `icons/` (knockout.PNG; egg carton.PNG if referenced)

**Exclude:**
- `.git/`, `node_modules/`
- Dev/test-only files (e.g. `.cursorrules`, `docs/`, `*.md`), unless you use them for the store listing

### 2.2 Create the ZIP

From the project root:

```bash
zip -r carryegg-v0.1.0.zip . \
  -x "*.git*" \
  -x "node_modules/*" \
  -x ".cursorrules" \
  -x "*.md" \
  -x "docs/*"
```

Or manually select the files/folders above and create a ZIP.

### 2.3 Icons (optional but recommended)

The store uses **128×128**. Using a single image for all sizes can look blurry when scaled. Prefer:

- A **128×128** `icons/knockout.PNG` as the main store icon
- Separate 16 and 48 assets, or the same image if you accept some scaling

---

## 3. Store listing (Developer Dashboard)

### 3.1 Required fields

| Field | Notes |
|-------|--------|
| **Short description** | One or two sentences, e.g. "Save ChatGPT conversations and pack them for a new chat." |
| **Detailed description** | Features, use cases, Quick Egg / Whole Egg / Carton, etc. Markdown allowed. |
| **Category** | e.g. **Productivity** or **Developer Tools** |
| **Language** | At least one (e.g. English) |

### 3.2 Privacy and permissions

- The extension uses only **local `localStorage`** for history; no data is sent off-device.
- Permissions: `activeTab`, `scripting`, `https://chatgpt.com`.
- If the store requires a **Privacy Policy** URL:
  - Publish a short page stating that the extension does not collect or upload user data and only uses local storage.
  - Enter that page URL in the Developer Dashboard.

### 3.3 Screenshots and assets

- **Screenshots**: At least 1, up to 5. Prefer **1280×800** or **640×400**.
  - Show the popup, Carton drawer, output area, etc.
- **Marquee** (small promo tile): **440×280**, optional but useful.

---

## 4. Submit for review

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **New item** → upload `carryegg-v0.1.0.zip`
3. Fill in the **store listing**, **privacy**, **screenshots**, etc.
4. Click **Submit for review**

Review usually takes **1–3 business days** (sometimes longer). Once approved, the extension is published and users can install it from the store.

---

## 5. Updating later

- Bump **`version`** in `manifest.json` (e.g. `0.1.0` → `0.1.1`)
- Create a new ZIP, then in the Dashboard open the extension → **Upload new version** → submit for review

---

## 6. Links

- [Publish guides (Chrome)](https://developer.chrome.com/docs/webstore/publish/)
- [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/) (CarryEgg is free; no pricing setup needed)

---

**Quick flow:** Register ($5) → ZIP → Upload → Store listing & screenshots → Submit → Wait for approval.

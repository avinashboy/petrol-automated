# ⛽ Automated Petrol Record — AI Powered

A single-page web app that lets you photograph your petrol receipt, bike odometer, and pump display, then uses AI (Google Gemini via OpenRouter) to extract the data and save it automatically to a Google Sheet.

---

## How It Works

1. Upload (or drag-and-drop / paste) three images:
   - **Receipt** — date, time, bill amount
   - **Bike Odometer** — current KM reading
   - **Pump Display** — rate, volume, density
2. Click **Process with AI** — Gemini 2.5 Flash reads all three images and fills in the form.
3. Review / edit the extracted values.
4. Click **Submit to Google Sheets** — the record plus a merged image are saved to your sheet.

---

## Project Structure

```
.
├── index.html              # Entire frontend (HTML + CSS + JS, single file)
└── functions/
    └── api/
        ├── ocr.js          # Cloudflare Pages Function — proxies OpenRouter API
        └── sheet.js        # Cloudflare Pages Function — proxies Google Apps Script
```

Secrets (`OPENROUTER_API_KEY`, `SCRIPT_URL`) never reach the browser. The browser calls `/api/ocr` and `/api/sheet`; the Cloudflare Functions add the secrets server-side before forwarding.

---

## Prerequisites

| What | Why |
|---|---|
| [Cloudflare Pages](https://pages.cloudflare.com) account | Hosts the site and runs the proxy functions |
| [OpenRouter](https://openrouter.ai) account | Provides AI OCR via Gemini 2.5 Flash |
| Google account | Google Sheets + Google Apps Script for data storage |

---

## Setup

### 1. Google Apps Script (backend for Sheets)

1. Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Go to **Extensions → Apps Script**.
3. Paste your Apps Script code that accepts POST (new record) and GET (last record) requests.
4. Click **Deploy → New deployment**, choose type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (the Cloudflare Function acts as a gate — the URL itself stays secret)
5. Copy the deployment URL — you will need it as `SCRIPT_URL`.

### 2. OpenRouter API Key

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Go to **Keys** and create a new API key.
3. Make sure your account has credits (Gemini 2.5 Flash is very cheap per request).
4. Copy the key — you will need it as `OPENROUTER_API_KEY`.

### 3. Deploy to Cloudflare Pages

1. Fork or push this repository to GitHub.
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com), go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your repository.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/` (root)
5. Click **Save and Deploy**.

### 4. Set Environment Variables

In your Cloudflare Pages project go to **Settings → Environment variables** and add:

| Variable name | Value | Required |
|---|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (`sk-or-...`) | Yes |
| `SCRIPT_URL` | Your Google Apps Script web app deployment URL | Yes |

Set these for both **Production** and **Preview** environments.

Redeploy the project after adding variables (or trigger a new deployment) so the Functions pick them up.

---

## Local Development

The Cloudflare Functions (`/api/ocr`, `/api/sheet`) require environment variables that only exist in Cloudflare. To run locally, use the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm install -g wrangler

# Create a .dev.vars file (never commit this)
echo "OPENROUTER_API_KEY=sk-or-your-key-here" >> .dev.vars
echo "SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec" >> .dev.vars

wrangler pages dev . --port 8788
```

Then open `http://localhost:8788`.

---

## Configuration Reference

### Cloudflare Environment Variables

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | API key for OpenRouter. Used by `functions/api/ocr.js` to authenticate requests to `https://openrouter.ai/api/v1/chat/completions`. |
| `SCRIPT_URL` | Full deployment URL of your Google Apps Script web app. Used by `functions/api/sheet.js` for both GET (fetch last record) and POST (submit new record). |

### Model

The AI model is set in `index.html`:

```js
const LLM_MODEL = "google/gemini-2.5-flash";
```

You can swap this for any vision-capable model available on OpenRouter (e.g. `openai/gpt-4o`, `anthropic/claude-opus-4`).

---

## Image Input Methods

All three upload slots (Receipt, Bike Odometer, Pump Display) support:

| Method | How |
|---|---|
| **File picker** | Click the box |
| **Drag and drop** | Drag an image file from your computer onto the box |
| **Clipboard paste (button)** | Right-click an image anywhere → Copy image → click **📋 Paste Image from Clipboard** |
| **Ctrl+V** | Works when the page has keyboard focus |

> **Note:** The **Paste Image** button uses the browser Clipboard API and requires HTTPS. The browser will ask for clipboard permission once.

---

## Data Flow

```
Browser
  │
  ├─ POST /api/ocr  ──►  ocr.js (adds OPENROUTER_API_KEY)  ──►  OpenRouter (Gemini)
  │                                                                      │
  │◄─────────────────────────────────────── extracted JSON ◄────────────┘
  │
  └─ POST /api/sheet  ──►  sheet.js (uses SCRIPT_URL)  ──►  Google Apps Script
                                                                   │
                                                             Google Sheets row
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "SCRIPT_URL not configured" error | Add `SCRIPT_URL` to Cloudflare environment variables and redeploy |
| AI returns empty / wrong data | Check `OPENROUTER_API_KEY` is valid and has credit; verify images are clear |
| Paste button does nothing | Make sure the site is served over HTTPS; allow clipboard permission in the browser prompt |
| Data not appearing in Sheet | Check your Apps Script deployment is set to "Anyone" and the URL in `SCRIPT_URL` is the `/exec` URL, not the editor URL |
| Functions 404 locally | Use `wrangler pages dev` instead of opening `index.html` directly |

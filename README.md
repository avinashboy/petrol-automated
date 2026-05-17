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
├── index.html                  # Entire frontend (HTML + CSS + JS, single file)
├── google-apps-script.gs       # Google Apps Script source — paste this into Apps Script editor
└── functions/
    └── api/
        ├── ocr.js              # Cloudflare Pages Function — proxies OpenRouter API
        └── sheet.js            # Cloudflare Pages Function — proxies Google Apps Script
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

This is the most important step. The file `google-apps-script.gs` in this repo is the complete backend. Follow these steps exactly:

#### Step 1 — Open the target spreadsheet

The script is pre-configured to write into this specific spreadsheet:

```
Spreadsheet ID: 1pwB6xA5RTVFjXsUfU9UI72ZlToNhsgBCzdwjwYcPcx0
```

Open it at:
`https://docs.google.com/spreadsheets/d/1pwB6xA5RTVFjXsUfU9UI72ZlToNhsgBCzdwjwYcPcx0/edit`

> If you want to use a different spreadsheet, open it and copy its ID from the URL, then update the `SPREADSHEET_ID` constant at the top of `google-apps-script.gs` before deploying.

#### Step 2 — Open Apps Script editor

Inside the spreadsheet, go to **Extensions → Apps Script**.

A new tab opens with the Apps Script code editor.

#### Step 3 — Paste the script

1. Select all existing code in the editor (Ctrl+A / Cmd+A) and delete it.
2. Open `google-apps-script.gs` from this repo and copy its entire contents.
3. Paste it into the Apps Script editor.
4. Press **Ctrl+S** (or **Cmd+S** on Mac) to save.
5. Give the project a name if prompted (e.g. `Petrol Record`).

#### Step 4 — Deploy as a Web App

1. Click the **Deploy** button (top-right) → **New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Fill in the settings:
   - **Description:** `Petrol Record v1` (or anything you like)
   - **Execute as:** `Me` (your Google account)
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. Google will ask you to **authorize** the script the first time:
   - Click **Authorize access**
   - Choose your Google account
   - Click **Advanced → Go to Petrol Record (unsafe)** (this is normal for personal scripts)
   - Click **Allow**
6. After authorization, the deployment completes and you get a **Web app URL** that looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
7. **Copy this URL** — you will paste it into Cloudflare as `SCRIPT_URL`.

> **Important:** Every time you edit the script and want the changes to take effect, you must create a **New deployment** (not edit the existing one). The `/exec` URL of a deployment is fixed — redeployment gives you a new URL.

#### Step 5 — Verify the deployment

Open the URL in your browser. You should see a JSON response like:
```json
{
  "status": "API is running",
  "message": "Send POST for form submit. GET: month, year, vehicle..."
}
```

If you see that, the backend is working.

#### Script configuration constants

At the top of `google-apps-script.gs` you can adjust these:

| Constant | Default | Description |
|---|---|---|
| `SPREADSHEET_ID` | `1pwB6xA5RTVFjXsUfU9UI72ZlToNhsgBCzdwjwYcPcx0` | The Google Sheets spreadsheet to write to |
| `FOLDER_NAME` | `Petrol Records - Uploaded Files` | Root Google Drive folder where merged images are stored |
| `HIGHLIGHT_COLOR` | `#FFF3CD` | Row background color when Oil or Both service is recorded |

---

### 2. OpenRouter API Key

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Go to **Keys** and create a new API key.
3. Make sure your account has credits (Gemini 2.5 Flash costs fractions of a cent per request).
4. Copy the key — you will need it as `OPENROUTER_API_KEY`.

---

### 3. Deploy to Cloudflare Pages

1. Fork or push this repository to GitHub.
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com), go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your repository.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/` (root)
5. Click **Save and Deploy**.

---

### 4. Set Environment Variables in Cloudflare

In your Cloudflare Pages project go to **Settings → Environment variables → Add variable**:

| Variable name | Value | Required |
|---|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (`sk-or-...`) | Yes |
| `SCRIPT_URL` | The `/exec` URL from your Apps Script deployment | Yes |

Set these for both **Production** and **Preview** environments.

After adding the variables, go to **Deployments → Retry deployment** (or push a new commit) so the Functions pick them up.

---

## Local Development

The Cloudflare Functions (`/api/ocr`, `/api/sheet`) require environment variables that only exist in Cloudflare. To run locally, use the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm install -g wrangler

# Create a .dev.vars file in the project root (never commit this file)
echo "OPENROUTER_API_KEY=sk-or-your-key-here" >> .dev.vars
echo "SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" >> .dev.vars

wrangler pages dev . --port 8788
```

Then open `http://localhost:8788`.

---

## Configuration Reference

### Cloudflare Environment Variables

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | API key for OpenRouter. Added by `functions/api/ocr.js` to all requests sent to `https://openrouter.ai/api/v1/chat/completions`. |
| `SCRIPT_URL` | Full `/exec` deployment URL of the Google Apps Script web app. Used by `functions/api/sheet.js` for GET (fetch last record) and POST (submit new record). |

### AI Model

The model is set in `index.html` at the top of the `<script>` block:

```js
const LLM_MODEL = "google/gemini-2.5-flash";
```

You can swap this for any vision-capable model on OpenRouter (e.g. `openai/gpt-4o`, `anthropic/claude-opus-4`).

---

## Google Sheets Structure

The script automatically creates and manages sheets. You do not need to set them up manually.

### Sheet naming

Each sheet covers **one vehicle for one calendar month**. The name format is:

```
{Month} {2-digit year} {last 4 digits of vehicle number}
```

Examples: `February 26 1234`, `March 26 1234`

### Column layout (12 columns)

| Column | Header | Description |
|---|---|---|
| A | Date | Format: `DD-MM-YY:HH:MM:SS` |
| B | Amount | Total bill amount (₹) |
| C | Kilo meter | Current odometer reading |
| D | KM run | Distance since last fill-up (written to the *previous* row) |
| E | Volume litre | Litres filled |
| F | Petrol bunk | Petrol station name |
| G | Density | Fuel density reading |
| H | Rate | Rate per litre (₹) |
| I | Location | Fill-up location |
| J | Oil / Air Change | `None`, `Air`, `Oil`, or `Both` |
| K | Petrol Type | `Normal` or `Power Petrol` |
| L | Image | Merged photo (inserted as `=IMAGE()` formula via Google Drive) |

Rows where **Oil** or **Both** is recorded are highlighted in yellow (`#FFF3CD`) automatically.

### Google Drive folder structure

Merged images are uploaded to your Google Drive and linked in column L:

```
Petrol Records - Uploaded Files/
└── February 26/
    └── Vehicle_1234/
        └── 1716012345678_merged.webp
```

All folders and files are shared as **"Anyone with the link can view"** so the `=IMAGE()` formula can render them even when your Drive is private.

---

## Image Input Methods

All three upload slots (Receipt, Bike Odometer, Pump Display) support:

| Method | How |
|---|---|
| **File picker** | Click the box |
| **Drag and drop** | Drag an image file from your computer onto the box |
| **Clipboard paste (button)** | Right-click an image anywhere → Copy image → click **📋 Paste Image from Clipboard** |
| **Ctrl+V** | Works when the page has keyboard focus |

> **Note:** The **Paste Image** button uses the browser Clipboard API and requires HTTPS. The browser will ask for clipboard permission the first time.

Paste fills slots in order: Receipt → Bike Odometer → Pump Display. Press the button once per image.

---

## Data Flow

```
Browser
  │
  ├─ POST /api/ocr  ──►  ocr.js (adds OPENROUTER_API_KEY)  ──►  OpenRouter (Gemini 2.5 Flash)
  │                                                                      │
  │◄─────────────────────────────────────── extracted JSON ◄────────────┘
  │
  └─ POST /api/sheet  ──►  sheet.js (uses SCRIPT_URL)  ──►  Google Apps Script (doPost)
                                                                   │
                                                        ┌──────────┴──────────┐
                                                  Google Sheets row      Google Drive image
```

---

## Apps Script API Reference

The deployed web app supports these endpoints (all go through the `/api/sheet` Cloudflare proxy):

### GET — Check API status
```
GET /api/sheet
```
Returns a JSON status message confirming the API is running.

### GET — Fetch sheet data
```
GET /api/sheet?month=February&year=26&vehicle=TN12AA1234
```
Returns all records for that vehicle and month as JSON.

### GET — Fetch previous record (for KM run pre-fill)
```
GET /api/sheet?month=February&year=26&vehicle=TN12AA1234&LR=1
```
Returns the second-to-last record's odometer and "biblical number" (odometer with last digit removed), used by the form to pre-calculate KM run.

### POST — Submit a new record
Sent automatically by the form on submit. Required fields:

| Field | Description |
|---|---|
| `date` | ISO date string |
| `vehicleNo` | Full vehicle number (e.g. `TN12AA1234`) |
| `amount` | Total bill amount |
| `kilometer` | Odometer reading |
| `volume` | Litres filled |
| `petrolBunk` | Station name |
| `density` | Fuel density |
| `rate` | Rate per litre |
| `location` | Fill-up location |
| `oilChange` | `None`, `Air`, `Oil`, or `Both` |
| `petrolType` | `Normal` or `Power Petrol` |
| `fileData` | Base64-encoded merged image |
| `fileName` | File name for the image |
| `mimeType` | MIME type (e.g. `image/webp`) |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "SCRIPT_URL not configured" error | Add `SCRIPT_URL` to Cloudflare environment variables and redeploy |
| "Missing data, try again" from Apps Script | One or more required POST fields are empty — check the browser console for which fields |
| AI returns empty / wrong data | Check `OPENROUTER_API_KEY` is valid and has credit; make sure images are clear and well-lit |
| Paste button does nothing | Site must be served over HTTPS; allow clipboard permission when the browser asks |
| Images not showing in Sheet (column L) | The Drive file sharing may have failed — check Apps Script logs via **Executions** in the Apps Script editor |
| Data not appearing in Sheet | Confirm the Apps Script deployment is set to "Anyone" and `SCRIPT_URL` ends in `/exec` not `/dev` |
| Sheet not found error | The vehicle number or month doesn't match any existing sheet — the script creates it automatically on first submit |
| Functions return 404 locally | Use `wrangler pages dev` instead of opening `index.html` directly in the browser |
| Apps Script authorization loop | Delete the deployment, revoke access in Google account permissions, and redeploy from scratch |

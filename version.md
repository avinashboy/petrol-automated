# Petrol Automated — Version History

Update this file **and** the badge in `index.html` (`APP_VERSION` + `#appVersion`) on every deploy.

## v1.3.1 — 2026-11-13

- Treat **Reliance**, **Jio**, **Jio-bp**, and **Reliance bp Mobility** as the same petrol bunk (`Reliance` / Jio-bp in the dropdown).
- AI prompt + form normalization map those aliases to `Reliance`.

## v1.3.0 — 2026-11-13

- Added **Retry AI extraction** on the review form to re-POST the current images to `/api/ocr` and refresh fields when the first read is wrong.

## v1.2.0 — 2026-11-13

- Merged collage layout set back to **horizontal** (side-by-side images).
- Optional density board still appends as a 4th image when present.

## v1.1.0 — 2026-11-13

- Added optional **+ Add density board photo** upload for bunks that show density on a board, not the pump.
- Optional image is included in AI OCR when present (preferred density source).
- Merged WebP collage supports 3 or 4 images.
- Paste/clipboard fills the density slot after the three required images.

## v1.0.1 — 2026-08-14

- Fixed Cloudflare `/api/sheet` proxy returning HTTP 400 after a successful Apps Script submit.
- Workers now follow Google’s 302 redirect with GET (browser-compatible) so the UI gets JSON success instead of HTML 400.

## v1.0.0 — 2026-05

- Initial Cloudflare Pages app with OCR proxy (`/api/ocr`) and Sheets proxy (`/api/sheet`).
- Receipt / odometer / pump uploads, AI extraction, merged image submit to Google Apps Script.
- Drag-and-drop and clipboard paste for image slots.

# Phase 1.5 Frontend Design
**Date:** 2026-05-07
**Status:** Approved

---

## Overview

Update and relocate the existing vanilla JS/HTML/CSS frontend from `web/` to `frontend/` so it works end-to-end with the new API. No new UI structure is needed — the existing layout (navbar, upload card, result card) is kept. Changes are limited to API wiring, upload progress, polling parameters, BLOCKED state, and file size limit.

**In scope:** File relocation, API URL update, XHR progress bar, polling fix, BLOCKED styling, field name fix.

**Out of scope:** Mobile-only layout changes, admin dashboard, auth, S3 static hosting (Phase 2).

---

## File Map

| Action | Path | Change |
|---|---|---|
| Create | `frontend/index.html` | Copy of `web/index.html` — update `<script>` and `<link>` paths only |
| Create | `frontend/app.js` | Rewrite of `web/script.js` — all functional changes live here |
| Create | `frontend/styles.css` | Copy of `web/style.css` + three new CSS variables for BLOCKED |

`web/` stays in place (not deleted) — ask before removing.

---

## API Constants

At the top of `app.js`, a single constant controls all endpoint URLs:

```js
var API_BASE = 'https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com';
```

Two derived URLs:
- `API_BASE + '/upload-url'` — POST to get presigned URL
- `API_BASE + '/get-moderation-result?imageKey=' + encodeURIComponent(key)` — GET to poll result

The server status ping hits `/get-moderation-result?imageKey=_ping` on the new base URL.

---

## Validation Changes

`MAX_FILE_SIZE_MB` changes from `5` to `10`. `ALLOWED_TYPES` stays the same: `['image/jpeg', 'image/png', 'image/gif', 'image/webp']`.

---

## Upload Flow (XHR Progress Bar)

`uploadToS3()` is rewritten to use `XMLHttpRequest` for the S3 PUT so upload progress events are available. `fetch()` is retained for the two API calls (presign request and polling).

### Progress bar HTML

A progress bar element is added inside `#uploadCard` in `index.html`, hidden by default:

```html
<div class="progress-wrap hidden" id="progressWrap">
  <div class="progress-bar" id="progressBar" style="width:0%"></div>
  <span class="progress-label" id="progressLabel">0%</span>
</div>
```

### Upload sequence

1. `fetch POST /upload-url` → get `{ uploadUrl, imageKey }`
2. Show progress bar, disable upload button
3. `new XMLHttpRequest()` PUT to `uploadUrl` with `Content-Type` header
   - `xhr.upload.onprogress` → update bar width and label percentage
   - `xhr.onload` → if status 200/204: hide bar, begin polling. Else: show error.
   - `xhr.onerror` → show error, re-enable button
4. `pollModerationResult(file, imageKey)` — note field is `imageKey` not `key`

---

## Polling Changes

`pollModerationResult()` parameters change:
- `maxTries`: 10 → **20**
- `delayMs`: 2000 → **1500**

Total max wait: 30 seconds (20 × 1.5 s).

On each 404 or missing `status` field, wait and retry. On timeout: show error and re-enable button.

---

## Result Display — Three Statuses

`showResult()` handles all three statuses. Badge class and step icon class derive from status:

| Status | Badge class | Step icon class | Step icon character |
|---|---|---|---|
| `APPROVED` | `approved` | `ok` | `✓` |
| `FLAGGED` | `flagged` | `bad` | `!` |
| `BLOCKED` | `blocked` | `blocked` | `✕` |

The result-card step list for BLOCKED shows:
1. ✓ Image received
2. ✓ Uploaded to S3
3. ✓ Scanned by Amazon Rekognition
4. ✕ Content policy violation — image blocked
5. ✕ Detected labels (pills) — if any

---

## CSS Changes — BLOCKED State

Three new variables added to `:root` in `styles.css`:

```css
--orange:        #c2410c;
--orange-bg:     #fff7ed;
--orange-border: #fed7aa;
```

Three new rules added:

```css
.result-badge.blocked {
    background: var(--orange-bg);
    color: var(--orange);
    border: 1px solid var(--orange-border);
}

.step-icon.blocked {
    background: var(--orange-bg);
    color: var(--orange);
    border: 1px solid var(--orange-border);
}

.step-status.blocked { color: var(--orange); }
```

Progress bar CSS:

```css
.progress-wrap {
    position: relative;
    background: #e5e7eb;
    border-radius: 99px;
    height: 6px;
    overflow: hidden;
    margin-bottom: 6px;
}

.progress-bar {
    background: var(--primary);
    height: 100%;
    border-radius: 99px;
    transition: width 0.2s ease;
}

.progress-label {
    font-size: 11px;
    color: var(--text-4);
    display: block;
    text-align: right;
    margin-bottom: 14px;
}
```

---

## Testing

Manual test plan (no automated tests for the frontend):

1. Open `frontend/index.html` via `python -m http.server 8080` (or equivalent)
2. **Happy path (APPROVED):** Upload a benign photo → progress bar fills → result shows green APPROVED badge
3. **FLAGGED path:** Upload a borderline test image → orange-ish FLAGGED result
4. **BLOCKED path:** Trigger a BLOCKED result (high-confidence violent/explicit image) → orange BLOCKED badge and ✕ steps
5. **Validation — wrong type:** Drop a `.pdf` → error message, no upload
6. **Validation — too large:** Select a file > 10 MB → error message
7. **Reset:** Click "Upload Another Image" → returns to upload card, cleared state
8. **Timeout:** Disconnect from internet mid-poll → after 30 s shows timeout error

---

## Variables Updated

| Variable | Old value | New value |
|---|---|---|
| API base URL | `https://96nwepsh16…/dev` | `https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com` |
| Response field | `data.key` | `data.imageKey` |
| Max file size | 5 MB | 10 MB |
| Poll attempts | 10 | 20 |
| Poll interval | 2000 ms | 1500 ms |
| Upload method | `fetch PUT` | `XMLHttpRequest PUT` |

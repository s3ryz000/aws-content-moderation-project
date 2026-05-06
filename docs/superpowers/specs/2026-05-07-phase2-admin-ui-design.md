# Phase 2.3 Admin UI Design

## Goal

A standalone admin page (`frontend/admin/`) that lets an operator list moderation results, filter by status, record approve/reject decisions, and export results to CSV — all without login.

## Architecture

Three files added under `frontend/admin/`: `index.html`, `admin.css`, `admin.js`. No build step, no framework — same vanilla HTML/CSS/JS approach as the main `frontend/`. Served locally with the same `python -m http.server 8080` command. The admin page calls the two new admin API routes added in Phase 2.1.

## Components

### `frontend/admin/index.html`

- Navbar: same dark header as main frontend — "CM" logo, title "Content Moderation", subtitle "Admin". No status pill.
- Filter chips row: **All** · **Flagged** · **Blocked** · **Approved** — one active at a time, highlighted with the status colour (red/orange/green). Defaults to All on load.
- Refresh button next to filter chips — reruns the current filter query.
- Export CSV button — serialises current table rows to CSV and triggers browser download.
- Results table with columns: `Image Key` · `Status` · `Timestamp` · `Manual Decision` · `Actions`
- Status badge in the Status column: colour-coded chip (green = APPROVED, red = FLAGGED, orange = BLOCKED), same colour tokens as `styles.css`.
- Manual Decision column: shows `APPROVED` or `REJECTED` in muted text if a decision exists; blank otherwise.
- Actions column: **Approve** and **Reject** buttons. Both are hidden once `manualDecision` is already set on that row (decisions are final for MVP).
- Empty state: "No results found." row spanning all columns.
- Error state: red inline banner above the table.

### `frontend/admin/admin.css`

- Imports the same CSS custom properties (`--bg`, `--surface`, `--primary`, `--green`, `--red`, `--orange`, etc.) as `styles.css` — defined inline in this file (not imported, to keep it self-contained).
- Table: full-width, striped rows (`--bg` on odd rows), `--border` separators, sticky header.
- Filter chips: pill buttons, inactive = muted, active = filled with status colour.
- Action buttons: small outline buttons (Approve = green outline, Reject = red outline); hidden via `display:none` when decision already exists.
- Responsive: table scrolls horizontally on narrow viewports.

### `frontend/admin/admin.js`

**State:**
- `currentStatus` — `null` (All) or `"FLAGGED"` / `"BLOCKED"` / `"APPROVED"`
- `currentRows` — array of items from the last API response (used for CSV export)

**On page load:** call `loadResults()` with `currentStatus = null`.

**`loadResults(status)`:**
1. Build URL: `API_BASE + '/admin/moderation'` + optional `?status=X`
2. `fetch()` — on error show error banner; on success call `renderTable(items)`
3. Saves response items to `currentRows`

**`renderTable(items)`:**
- Clears table body
- For each item: insert a `<tr>` with all columns
- Status badge: `<span class="badge badge-{status.toLowerCase()}">STATUS</span>`
- Manual Decision: item's `manualDecision` or `—`
- Actions: two buttons; if `item.manualDecision` is set, set both to `display:none`
- Button onclick calls `recordDecision(imageKey, 'APPROVED'|'REJECTED', rowEl)`

**`recordDecision(imageKey, decision, rowEl)`:**
1. Encode imageKey: `encodeURIComponent(imageKey)`
2. `fetch(API_BASE + '/admin/moderation/' + encoded + '/decision', { method: 'POST', body: JSON.stringify({decision}) })`
3. On 200: update the Manual Decision cell in `rowEl`, hide both action buttons
4. On error: show inline error in row or banner

**`exportCSV()`:**
- Headers: `imageKey,status,timestamp,manualDecision,decisionTimestamp`
- Rows from `currentRows`
- `encodeURIComponent` values, join with commas
- Create a `<a>` with `download="moderation-export.csv"` and `href=data:text/csv,...`, click it, remove it

## API Calls

| Action | Method | URL |
|--------|--------|-----|
| Load all results | GET | `{API_BASE}/admin/moderation` |
| Load filtered | GET | `{API_BASE}/admin/moderation?status=FLAGGED` |
| Record decision | POST | `{API_BASE}/admin/moderation/{imageKey}/decision` |

`API_BASE = 'https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com'`

## Error Handling

- Network/fetch error → red banner: "Failed to load results. Check your connection."
- Decision POST non-200 → inline row error or banner: "Failed to record decision."
- Empty results → "No results found." empty-state row.

## What Is Not In Scope

- Login / authentication (no Cognito, no JWT)
- Image preview (bucket is private, no presigned GET endpoint)
- Pagination (limit cap of 100 default, 500 max handled server-side)
- Auto-refresh / polling
- Edit or undo decisions (decisions are final once recorded)

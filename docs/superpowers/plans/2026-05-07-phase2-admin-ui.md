# Phase 2.3 Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone vanilla JS admin dashboard at `frontend/admin/` that lists moderation results, supports status filtering, approve/reject decisions, and CSV export.

**Architecture:** Three self-contained files under `frontend/admin/` — `admin.css` (all styles, including CSS tokens copied in), `index.html` (markup only), `admin.js` (all logic). No framework, no build step. Served with `python -m http.server 8080` from the repo root; open `http://localhost:8080/frontend/admin/`. Manual verification only — no automated tests for UI.

**Tech Stack:** Vanilla HTML5 / CSS3 / ES5 JavaScript, `fetch` API, browser `<a download>` for CSV export.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/admin/admin.css` | All styles — CSS tokens, navbar, toolbar, filter chips, table, badges, action buttons |
| Create | `frontend/admin/index.html` | Markup — navbar, toolbar with chips, error banner, table skeleton |
| Create | `frontend/admin/admin.js` | All logic — `loadResults`, `renderTable`, `recordDecision`, `exportCSV`, helpers |
| Modify | `docs/roadmap.md` | Mark Phase 2.3 items complete |
| Modify | `docs/changelog.md` | Add v0.7.0 entry |

---

### Task 1: Create `frontend/admin/admin.css`

All visual styling lives here. CSS tokens are defined inline (not imported) so this file works standalone without the main `frontend/styles.css`.

**Files:**
- Create: `frontend/admin/admin.css`

- [ ] **Step 1: Create `frontend/admin/admin.css`**

```css
/* ================================================
   Content Moderation — Admin UI
   ================================================ */

:root {
    --bg:            #ECF0F8;
    --surface:       #FFFFFF;
    --primary:       #2563EB;
    --text:          #111827;
    --text-2:        #374151;
    --text-3:        #6B7280;
    --text-4:        #9CA3AF;
    --border:        #E5E7EB;
    --green:         #16A34A;
    --green-bg:      #F0FDF4;
    --green-border:  #BBF7D0;
    --red:           #DC2626;
    --red-bg:        #FEF2F2;
    --red-border:    #FECACA;
    --orange:        #c2410c;
    --orange-bg:     #fff7ed;
    --orange-border: #fed7aa;
    --shadow:        0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.07);
    --radius:        14px;
    --radius-sm:     8px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    font-size: 14px;
    line-height: 1.5;
}

/* ---- NAVBAR ---- */
.navbar {
    height: 56px;
    background: #0F172A;
    display: flex;
    align-items: center;
    padding: 0 28px;
    position: sticky;
    top: 0;
    z-index: 50;
    border-bottom: 1px solid #1E293B;
}
.navbar-brand { display: flex; align-items: center; gap: 12px; }
.navbar-logo {
    width: 32px; height: 32px;
    background: var(--primary);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; color: #fff;
}
.navbar-name { color: #F8FAFC; font-weight: 600; font-size: 15px; display: block; }
.navbar-sub  { color: #94A3B8; font-size: 11px; display: block; }

/* ---- MAIN ---- */
.main { flex: 1; padding: 28px; max-width: 1200px; width: 100%; margin: 0 auto; }

.page-header { margin-bottom: 20px; }
.page-header h1 { font-size: 22px; font-weight: 700; }
.page-header p  { color: var(--text-3); margin-top: 4px; }

/* ---- TOOLBAR ---- */
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }

/* ---- FILTER CHIPS ---- */
.chip {
    padding: 6px 14px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px; font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip.active-all      { background: var(--primary); border-color: var(--primary); color: #fff; }
.chip.active-flagged  { background: var(--red);     border-color: var(--red);     color: #fff; }
.chip.active-blocked  { background: var(--orange);  border-color: var(--orange);  color: #fff; }
.chip.active-approved { background: var(--green);   border-color: var(--green);   color: #fff; }

/* ---- TOOLBAR BUTTONS ---- */
.btn {
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px; font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
}
.btn:hover { background: var(--bg); }
.btn-refresh { margin-left: auto; }

/* ---- ERROR BANNER ---- */
.error-banner {
    background: var(--red-bg);
    border: 1px solid var(--red-border);
    color: var(--red);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    margin-bottom: 14px;
    font-size: 13px;
    display: none;
}
.error-banner.visible { display: block; }

/* ---- TABLE CARD ---- */
.table-card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
}
.table-wrap { overflow-x: auto; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }

thead th {
    background: #F9FAFB;
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    position: sticky;
    top: 56px;
}

tbody tr { border-bottom: 1px solid var(--border); }
tbody tr:last-child { border-bottom: none; }
tbody tr:nth-child(odd)  { background: var(--bg); }
tbody tr:nth-child(even) { background: var(--surface); }
tbody tr:hover { background: #EFF6FF; }

tbody td { padding: 10px 14px; vertical-align: middle; }

td.key-cell {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-3);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ---- STATUS BADGE ---- */
.badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.badge-approved { background: var(--green-bg);  color: var(--green);  border: 1px solid var(--green-border); }
.badge-flagged  { background: var(--red-bg);    color: var(--red);    border: 1px solid var(--red-border); }
.badge-blocked  { background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border); }

/* ---- DECISION CELL ---- */
td.decision-cell         { color: var(--text-4); font-style: italic; }
td.decision-cell.decided { color: var(--text-2); font-style: normal; font-weight: 500; }

/* ---- ACTION BUTTONS ---- */
.action-btns { display: flex; gap: 6px; }

.btn-approve, .btn-reject {
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px; font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid;
}
.btn-approve { background: var(--green-bg); color: var(--green); border-color: var(--green-border); }
.btn-approve:hover { background: var(--green); color: #fff; }
.btn-reject  { background: var(--red-bg);   color: var(--red);   border-color: var(--red-border); }
.btn-reject:hover  { background: var(--red);   color: #fff; }
.btn-approve:disabled, .btn-reject:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---- STATES ---- */
.empty-state, .loading-state {
    text-align: center;
    padding: 40px;
    color: var(--text-3);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/admin/admin.css
git commit -m "feat: add admin UI stylesheet"
```

---

### Task 2: Create `frontend/admin/index.html`

Pure markup — no inline JS, no inline styles. All behaviour is in `admin.js`.

**Files:**
- Create: `frontend/admin/index.html`

- [ ] **Step 1: Create `frontend/admin/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Content Moderation — Admin</title>
    <link rel="stylesheet" href="admin.css">
</head>
<body>

    <nav class="navbar">
        <div class="navbar-brand">
            <div class="navbar-logo">CM</div>
            <div>
                <span class="navbar-name">Content Moderation</span>
                <span class="navbar-sub">Admin Dashboard</span>
            </div>
        </div>
    </nav>

    <main class="main">

        <div class="page-header">
            <h1>Moderation Results</h1>
            <p>Review and action flagged or blocked content.</p>
        </div>

        <div class="toolbar">
            <button class="chip active-all" data-status=""         onclick="setFilter(this, '')">All</button>
            <button class="chip"            data-status="FLAGGED"  onclick="setFilter(this, 'FLAGGED')">Flagged</button>
            <button class="chip"            data-status="BLOCKED"  onclick="setFilter(this, 'BLOCKED')">Blocked</button>
            <button class="chip"            data-status="APPROVED" onclick="setFilter(this, 'APPROVED')">Approved</button>
            <button class="btn"             onclick="exportCSV()">Export CSV</button>
            <button class="btn btn-refresh" onclick="loadResults()">&#8635; Refresh</button>
        </div>

        <div class="error-banner" id="errorBanner"></div>

        <div class="table-card">
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Image Key</th>
                            <th>Status</th>
                            <th>Timestamp</th>
                            <th>Manual Decision</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody">
                        <tr><td colspan="5" class="loading-state">Loading&hellip;</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

    </main>

    <script src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/admin/index.html
git commit -m "feat: add admin UI HTML markup"
```

---

### Task 3: Create `frontend/admin/admin.js`

All logic in one file. Uses ES5 (`var`, no arrow functions) for maximum browser compatibility, matching the style of the main `frontend/app.js`.

**Files:**
- Create: `frontend/admin/admin.js`

- [ ] **Step 1: Create `frontend/admin/admin.js`**

```javascript
var API_BASE = 'https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com';

var currentStatus = '';
var currentRows   = [];

function init() {
    loadResults();
}

function setFilter(chipEl, status) {
    var chips = document.querySelectorAll('.chip');
    chips.forEach(function(c) { c.className = 'chip'; });

    var label = status === ''         ? 'all'
              : status === 'FLAGGED'  ? 'flagged'
              : status === 'BLOCKED'  ? 'blocked'
              : 'approved';
    chipEl.classList.add('active-' + label);

    currentStatus = status;
    loadResults();
}

function loadResults() {
    var url = API_BASE + '/admin/moderation';
    if (currentStatus) {
        url += '?status=' + encodeURIComponent(currentStatus);
    }

    hideError();
    setTableBody('<tr><td colspan="5" class="loading-state">Loading…</td></tr>');

    fetch(url)
        .then(function(resp) {
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .then(function(data) {
            currentRows = data.items || [];
            renderTable(currentRows);
        })
        .catch(function() {
            showError('Failed to load results. Check your connection.');
            setTableBody('<tr><td colspan="5" class="empty-state">—</td></tr>');
        });
}

function renderTable(items) {
    if (!items.length) {
        setTableBody('<tr><td colspan="5" class="empty-state">No results found.</td></tr>');
        return;
    }

    var rows = items.map(function(item) {
        var badgeClass   = 'badge-' + item.status.toLowerCase();
        var decisionText = item.manualDecision || '—';
        var decisionClass = item.manualDecision ? 'decision-cell decided' : 'decision-cell';
        var actionsHtml  = item.manualDecision
            ? '<span style="color:var(--text-4);font-size:12px;">Decided</span>'
            : '<div class="action-btns">'
                + '<button class="btn-approve" onclick="recordDecision(\''
                + escKey(item.imageKey) + '\', \'APPROVED\', this)">Approve</button>'
                + '<button class="btn-reject" onclick="recordDecision(\''
                + escKey(item.imageKey) + '\', \'REJECTED\', this)">Reject</button>'
              + '</div>';

        return '<tr>'
            + '<td class="key-cell" title="' + escHtml(item.imageKey) + '">' + escHtml(item.imageKey) + '</td>'
            + '<td><span class="badge ' + badgeClass + '">' + escHtml(item.status) + '</span></td>'
            + '<td>' + escHtml(formatTs(item.timestamp)) + '</td>'
            + '<td class="' + decisionClass + '">' + escHtml(decisionText) + '</td>'
            + '<td>' + actionsHtml + '</td>'
            + '</tr>';
    });

    setTableBody(rows.join(''));
}

function recordDecision(imageKey, decision, buttonEl) {
    var row        = buttonEl.closest('tr');
    var actionCell = buttonEl.closest('td');
    var buttons    = actionCell.querySelectorAll('button');
    buttons.forEach(function(b) { b.disabled = true; });

    var encoded = encodeURIComponent(imageKey);
    fetch(API_BASE + '/admin/moderation/' + encoded + '/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: decision })
    })
        .then(function(resp) {
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .then(function(data) {
            var cells = row.querySelectorAll('td');
            cells[3].className   = 'decision-cell decided';
            cells[3].textContent = data.manualDecision;
            actionCell.innerHTML = '<span style="color:var(--text-4);font-size:12px;">Decided</span>';

            for (var i = 0; i < currentRows.length; i++) {
                if (currentRows[i].imageKey === imageKey) {
                    currentRows[i].manualDecision    = data.manualDecision;
                    currentRows[i].decisionTimestamp = data.decisionTimestamp;
                    break;
                }
            }
        })
        .catch(function() {
            buttons.forEach(function(b) { b.disabled = false; });
            showError('Failed to record decision. Please try again.');
        });
}

function exportCSV() {
    var headers = ['imageKey', 'status', 'timestamp', 'manualDecision', 'decisionTimestamp'];
    var lines   = [headers.join(',')];

    currentRows.forEach(function(item) {
        lines.push([
            csvEsc(item.imageKey         || ''),
            csvEsc(item.status           || ''),
            csvEsc(item.timestamp        || ''),
            csvEsc(item.manualDecision   || ''),
            csvEsc(item.decisionTimestamp || '')
        ].join(','));
    });

    var a    = document.createElement('a');
    a.href   = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
    a.download = 'moderation-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/* ---- Helpers ---- */

function setTableBody(html) {
    document.getElementById('tableBody').innerHTML = html;
}

function showError(msg) {
    var el = document.getElementById('errorBanner');
    el.textContent = msg;
    el.classList.add('visible');
}

function hideError() {
    document.getElementById('errorBanner').classList.remove('visible');
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escKey(key) {
    return String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function csvEsc(val) {
    var s = String(val);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function formatTs(ts) {
    if (!ts) { return '—'; }
    try { return new Date(ts).toLocaleString(); } catch (e) { return ts; }
}

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/admin/admin.js
git commit -m "feat: add admin UI JavaScript — filter, table render, approve/reject, CSV export"
```

---

### Task 4: Manual verification

No automated tests for UI. Verify the golden path manually.

**Files:** No changes — run only.

- [ ] **Step 1: Start the local server**

From the repo root (PowerShell):

```powershell
python -m http.server 8080
```

Then open **http://localhost:8080/frontend/admin/** in a browser.

- [ ] **Step 2: Verify table loads**

Expected: table populates with moderation results from the live API. If the table shows "No results found," upload an image via `http://localhost:8080/frontend/` first, then refresh admin.

- [ ] **Step 3: Verify filter chips**

Click **Flagged** chip — table shows only `FLAGGED` rows; chip turns red.  
Click **All** chip — full table returns; chip turns blue.

- [ ] **Step 4: Verify approve/reject**

Click **Approve** on a FLAGGED row. Expected:
- Buttons are disabled briefly
- Manual Decision cell updates to `APPROVED`
- Buttons replaced with "Decided" label
- Original Status badge still shows `FLAGGED`

- [ ] **Step 5: Verify CSV export**

Click **Export CSV** — browser downloads `moderation-export.csv`.  
Open the file — confirm headers `imageKey,status,timestamp,manualDecision,decisionTimestamp` and one row per result.

- [ ] **Step 6: Verify empty state**

Click **Blocked** chip when no BLOCKED items exist. Expected: "No results found." row.

---

### Task 5: Update roadmap and changelog

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Mark Phase 2.3 items complete in `docs/roadmap.md`**

In the `### 2.3 Dashboard UI` section, change:

```markdown
### 2.3 Dashboard UI (still vanilla JS, separate page)
- [ ] `/admin/index.html` — login → table view
- [ ] Filter chips: All / Flagged / Blocked / Approved
- [ ] Image preview on row click (presigned GET URL, short expiry)
- [ ] Approve / Reject buttons → calls decision endpoint, updates row
- [ ] CSV export of current filter
```

To:

```markdown
### 2.3 Dashboard UI (still vanilla JS, separate page)
- [-] Login screen — removed from scope (no auth in MVP)
- [x] `frontend/admin/index.html` — table view at `http://localhost:8080/frontend/admin/`
- [x] Filter chips: All / Flagged / Blocked / Approved
- [-] Image preview — removed from scope (bucket is private, no presigned GET endpoint)
- [x] Approve / Reject buttons → calls decision endpoint, updates row
- [x] CSV export of current filter
```

Also update the last-updated date at the bottom to `2026-05-07`.

- [ ] **Step 2: Add v0.7.0 entry to `docs/changelog.md`**

Insert after `## [Unreleased]` and before `## [0.6.0]`:

```markdown
## [0.7.0] — 2026-05-07

### Added
- `frontend/admin/index.html` — admin dashboard at `http://localhost:8080/frontend/admin/`; table view with filter chips (All / Flagged / Blocked / Approved), approve/reject actions, CSV export
- `frontend/admin/admin.css` — self-contained styles; reuses same CSS tokens as main frontend
- `frontend/admin/admin.js` — `loadResults()`, `renderTable()`, `recordDecision()`, `exportCSV()`; no framework, no build step
```

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md docs/changelog.md
git commit -m "docs: mark Phase 2.3 admin UI complete, add v0.7.0 changelog"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Navbar matching main frontend | Task 2 (index.html) + Task 1 (navbar CSS) |
| Filter chips All/Flagged/Blocked/Approved — active state per status colour | Task 1 (chip CSS) + Task 3 (setFilter) |
| Table: Image Key, Status, Timestamp, Manual Decision, Actions columns | Task 2 (thead) + Task 3 (renderTable) |
| Status badge colour-coded (green/red/orange) | Task 1 (badge CSS) + Task 3 (badgeClass) |
| Approve/Reject buttons hidden once decision is set | Task 3 (actionsHtml check on `item.manualDecision`) |
| Decision POST to `/admin/moderation/{imageKey}/decision` | Task 3 (recordDecision) |
| Row updates in-place on decision (decision cell + buttons replaced) | Task 3 (recordDecision .then) |
| Original `status` badge unchanged after decision | Task 3 (only cells[3] updated) |
| CSV export of current filter results | Task 3 (exportCSV, currentRows) |
| CSV headers: imageKey, status, timestamp, manualDecision, decisionTimestamp | Task 3 (headers array) |
| Empty state row | Task 3 (renderTable early-return) |
| Error banner on fetch failure | Task 3 (showError / hideError) |
| Refresh button reruns current filter | Task 2 (onclick="loadResults()") |
| Image preview — not in scope | Documented as [-] in roadmap |
| Login — not in scope | Documented as [-] in roadmap |

**Placeholder scan:** No TBDs, no vague steps. Every step has complete code.

**Type consistency:** `currentRows` is set by `loadResults` and read by `exportCSV` and `recordDecision`. `item.imageKey`, `item.status`, `item.timestamp`, `item.manualDecision`, `item.decisionTimestamp` match the shape returned by `GET /admin/moderation` (defined in Phase 2.1 `cm-list-moderation` handler). `data.manualDecision` and `data.decisionTimestamp` match the shape returned by `POST /admin/moderation/{imageKey}/decision` (defined in Phase 2.1 `cm-decide-moderation` handler). Consistent throughout.

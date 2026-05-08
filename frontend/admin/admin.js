var API_BASE = 'https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com';

var allRows       = [];
var currentRows   = [];
var currentStatus = '';
var _toastTimer   = null;

// ---- INIT ----

function init() {
    var token = getToken();
    if (!token) { redirectToLogin(); return; }
    loadResults();
}

// ---- LOAD (always fetches all from API) ----

function loadResults() {
    hideError();
    setTableBody(skeletonHtml());

    fetch(API_BASE + '/admin/moderation', { headers: getAuthHeader() })
        .then(function(resp) {
            if (resp.status === 401) { logout(); return null; }
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .then(function(data) {
            if (!data) { return; }
            allRows = data.items || [];
            updateCounts();
            applyFilter();
        })
        .catch(function() {
            showError('Failed to load results. Check your connection.');
            setTableBody(emptyHtml('Could not reach the server.', 'Check your connection and click Refresh.'));
        });
}

// ---- FILTER (client-side, no API call) ----

function setFilter(chipEl, status) {
    document.querySelectorAll('.chip').forEach(function(c) { c.className = 'chip'; });

    var label = status === ''         ? 'all'
              : status === 'FLAGGED'  ? 'flagged'
              : status === 'BLOCKED'  ? 'blocked'
              : 'approved';
    chipEl.classList.add('active-' + label);

    currentStatus = status;
    applyFilter();
}

function applyFilter() {
    currentRows = currentStatus
        ? allRows.filter(function(r) { return r.status === currentStatus; })
        : allRows.slice();
    renderTable(currentRows);
}

function updateCounts() {
    var counts = { '': allRows.length, FLAGGED: 0, BLOCKED: 0, APPROVED: 0 };
    allRows.forEach(function(r) {
        if (Object.prototype.hasOwnProperty.call(counts, r.status)) { counts[r.status]++; }
    });
    [
        { sel: '[data-status=""]',         n: counts['']       },
        { sel: '[data-status="FLAGGED"]',  n: counts.FLAGGED   },
        { sel: '[data-status="BLOCKED"]',  n: counts.BLOCKED   },
        { sel: '[data-status="APPROVED"]', n: counts.APPROVED  }
    ].forEach(function(c) {
        var el = document.querySelector('.chip' + c.sel);
        if (el) { el.setAttribute('data-count', c.n); }
    });
}

// ---- RENDER TABLE ----

function renderTable(items) {
    if (!items.length) {
        var msg = currentStatus
            ? 'No ' + currentStatus.toLowerCase() + ' items found.'
            : 'No moderation results yet.';
        var sub = currentStatus
            ? 'Try a different filter or click Refresh.'
            : 'Images you upload will appear here once processed.';
        setTableBody(emptyHtml(msg, sub));
        return;
    }

    var rows = items.map(function(item) {
        var badgeClass    = 'badge-' + item.status.toLowerCase();
        var decisionText  = item.manualDecision || '—';
        var decisionClass = item.manualDecision ? 'decision-cell decided' : 'decision-cell';
        var actionsHtml   = item.manualDecision
            ? '<span class="decided-label">Decided</span>'
            : '<div class="action-btns">'
                + '<button class="btn-approve" onclick="recordDecision(\''
                + escKey(item.imageKey) + '\', \'APPROVED\', this)">Approve</button>'
                + '<button class="btn-reject" onclick="recordDecision(\''
                + escKey(item.imageKey) + '\', \'REJECTED\', this)">Reject</button>'
              + '</div>';

        return '<tr>'
            + '<td class="key-cell" data-label="Image Key" title="' + escHtml(item.imageKey) + '">'
            +     escHtml(truncateKey(item.imageKey))
            + '</td>'
            + '<td data-label="Status"><span class="badge ' + badgeClass + '">' + escHtml(item.status) + '</span></td>'
            + '<td data-label="Timestamp">' + escHtml(formatTs(item.timestamp)) + '</td>'
            + '<td data-label="Decision" class="' + decisionClass + '">' + escHtml(decisionText) + '</td>'
            + '<td data-label="Actions">' + actionsHtml + '</td>'
            + '</tr>';
    });

    setTableBody(rows.join(''));
}

// ---- RECORD DECISION ----

function recordDecision(imageKey, decision, buttonEl) {
    var row        = buttonEl.closest('tr');
    var actionCell = buttonEl.closest('td');
    var buttons    = actionCell.querySelectorAll('button');
    buttons.forEach(function(b) { b.disabled = true; });

    var authHeader = getAuthHeader();

    fetch(API_BASE + '/admin/moderation/decision', {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': authHeader['Authorization']
        },
        body: JSON.stringify({ imageKey: imageKey, decision: decision })
    })
        .then(function(resp) {
            if (resp.status === 401) { logout(); return null; }
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            return resp.json();
        })
        .then(function(data) {
            if (!data) { return; }
            var cells = row.querySelectorAll('td');
            cells[3].className   = 'decision-cell decided';
            cells[3].textContent = data.manualDecision;
            actionCell.innerHTML = '<span class="decided-label">Decided</span>';

            for (var i = 0; i < allRows.length; i++) {
                if (allRows[i].imageKey === imageKey) {
                    allRows[i].manualDecision    = data.manualDecision;
                    allRows[i].decisionTimestamp = data.decisionTimestamp;
                    break;
                }
            }
        })
        .catch(function() {
            buttons.forEach(function(b) { b.disabled = false; });
            showError('Failed to record decision. Please try again.');
        });
}

// ---- EXPORT CSV ----

function exportCSV() {
    var headers = ['imageKey', 'status', 'timestamp', 'manualDecision', 'decisionTimestamp'];
    var lines   = [headers.join(',')];

    currentRows.forEach(function(item) {
        lines.push([
            csvEsc(item.imageKey          || ''),
            csvEsc(item.status            || ''),
            csvEsc(item.timestamp         || ''),
            csvEsc(item.manualDecision    || ''),
            csvEsc(item.decisionTimestamp || '')
        ].join(','));
    });

    var a      = document.createElement('a');
    a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
    a.download = 'moderation-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ---- HELPERS ----

function setTableBody(html) {
    document.getElementById('tableBody').innerHTML = html;
}

function showError(msg) {
    var el = document.getElementById('errorBanner');
    el.innerHTML = escHtml(msg)
        + '<button class="toast-close" onclick="hideError()" aria-label="Dismiss">✕</button>';
    el.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideError, 5000);
}

function hideError() {
    document.getElementById('errorBanner').classList.remove('visible');
    clearTimeout(_toastTimer);
}

function skeletonHtml() {
    var row = '<tr class="skeleton-row">'
        + '<td><div class="skeleton" style="width:65%"></div></td>'
        + '<td><div class="skeleton" style="width:52px"></div></td>'
        + '<td><div class="skeleton" style="width:60%"></div></td>'
        + '<td><div class="skeleton" style="width:48px"></div></td>'
        + '<td><div class="skeleton" style="width:88px"></div></td>'
        + '</tr>';
    return row + row + row + row;
}

function emptyHtml(title, sub) {
    return '<tr><td colspan="5" class="empty-state">'
        + '<div class="empty-icon">'
        + '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'
        + '</svg>'
        + '</div>'
        + '<p class="empty-title">' + escHtml(title) + '</p>'
        + '<p class="empty-sub">'   + escHtml(sub)   + '</p>'
        + '</td></tr>';
}

function truncateKey(key) {
    if (key.length <= 38) { return key; }
    return key.slice(0, 20) + '…' + key.slice(-14);
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

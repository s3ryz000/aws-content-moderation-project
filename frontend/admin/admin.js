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
        var badgeClass    = 'badge-' + item.status.toLowerCase();
        var decisionText  = item.manualDecision || '—';
        var decisionClass = item.manualDecision ? 'decision-cell decided' : 'decision-cell';
        var actionsHtml   = item.manualDecision
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

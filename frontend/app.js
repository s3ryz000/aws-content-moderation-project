var API_BASE = 'https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com';

var fileInput     = document.getElementById('fileInput');
var dropZone      = document.getElementById('dropZone');
var previewArea   = document.getElementById('previewArea');
var previewImage  = document.getElementById('previewImage');
var fileNameEl    = document.getElementById('fileName');
var fileSizeEl    = document.getElementById('fileSize');
var errorArea     = document.getElementById('errorArea');
var errorMessage  = document.getElementById('errorMessage');
var uploadBtn     = document.getElementById('uploadBtn');
var clearBtn      = document.getElementById('clearBtn');
var uploadCard    = document.getElementById('uploadCard');
var resultSection = document.getElementById('resultSection');
var workflowSteps = document.getElementById('workflowSteps');
var resultBadge   = document.getElementById('resultBadge');
var resetBtn      = document.getElementById('resetBtn');
var statusPill    = document.getElementById('statusPill');
var statusText    = document.getElementById('statusText');
var progressWrap  = document.getElementById('progressWrap');
var progressBar   = document.getElementById('progressBar');
var progressLabel = document.getElementById('progressLabel');

var MAX_FILE_SIZE_MB = 10;
var MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;
var ALLOWED_TYPES    = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

var selectedFile = null;

// ---- SERVER STATUS ----
// 2xx / 4xx → Online (API responded; 404 is expected for ping key)
// 5xx       → Degraded (API reachable but returning errors)
// timeout / network error → Offline

function checkServerStatus() {
    statusPill.className   = 'status-pill checking';
    statusText.textContent = 'Checking…';

    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 5000);

    fetch(API_BASE + '/get-moderation-result?imageKey=_ping', { signal: controller.signal })
        .then(function(res) {
            clearTimeout(timer);
            if (res.status >= 500) {
                statusPill.className   = 'status-pill degraded';
                statusText.textContent = 'Degraded';
            } else {
                statusPill.className   = 'status-pill';
                statusText.textContent = 'Online';
            }
        })
        .catch(function() {
            clearTimeout(timer);
            statusPill.className   = 'status-pill offline';
            statusText.textContent = 'Offline';
        });
}

checkServerStatus();
setInterval(checkServerStatus, 30000);

// ---- DRAG AND DROP ----

dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', function(e) {
    if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('over');
    }
});

dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('over');
    var file = e.dataTransfer.files[0];
    if (file) { handleFile(file); }
});

// ---- FILE INPUT ----

fileInput.addEventListener('change', function() {
    if (this.files[0]) { handleFile(this.files[0]); }
});

// ---- CLEAR BUTTON ----

clearBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    clearSelection();
});

function clearSelection() {
    selectedFile    = null;
    fileInput.value = '';
    hidePreview();
    hideError();
    uploadBtn.disabled = true;
}

// ---- HANDLE FILE ----

function handleFile(file) {
    hideError();

    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
        showError('Invalid file type. Please select a JPG, PNG, GIF, or WEBP image.');
        clearSelection();
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        var sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        showError('File too large (' + sizeMB + ' MB). Maximum allowed is ' + MAX_FILE_SIZE_MB + ' MB.');
        clearSelection();
        return;
    }

    selectedFile = file;
    showPreview(file);
    uploadBtn.disabled = false;
}

// ---- UPLOAD BUTTON ----

uploadBtn.addEventListener('click', function() {
    var file = fileInput.files[0] || selectedFile;
    if (!file) {
        showError('No file selected. Please choose an image first.');
        return;
    }
    uploadToS3(file);
});

// ---- RESET BUTTON ----

resetBtn.addEventListener('click', function() {
    clearSelection();
    hideResult();
    uploadBtn.textContent = 'Upload Image';
    uploadBtn.disabled    = true;
});

// ---- SHOW RESULT ----

function showResult(file, moderationData) {
    workflowSteps.innerHTML = '';
    var status    = moderationData.status;
    var isFlagged = status === 'FLAGGED';
    var isBlocked = status === 'BLOCKED';

    resultBadge.textContent = status;
    resultBadge.className   = 'result-badge ' + status.toLowerCase();

    var stepDefs = [
        { icon: 'ok', text: 'Image received: ' + file.name + ' — ' + formatSize(file.size) }
    ];

    if (isBlocked) {
        stepDefs.push({ icon: 'blocked', text: 'Content policy violation — image blocked', status: status });
        if (moderationData.labels && moderationData.labels.length > 0) {
            stepDefs.push({ icon: 'blocked', text: 'Detected:', labels: moderationData.labels });
        }
    } else if (isFlagged) {
        stepDefs.push({ icon: 'bad', text: 'Moderation result: ', status: status });
        if (moderationData.labels && moderationData.labels.length > 0) {
            stepDefs.push({ icon: 'bad', text: 'Detected labels:', labels: moderationData.labels });
        }
    } else {
        stepDefs.push({ icon: 'ok', text: 'Moderation result: ', status: status });
    }

    stepDefs.forEach(function(def) {
        var li = document.createElement('li');

        var iconEl = document.createElement('div');
        iconEl.className   = 'step-icon ' + def.icon;
        iconEl.textContent = def.icon === 'ok' ? '✓' : def.icon === 'blocked' ? '✕' : '!';

        var body = document.createElement('div');
        body.className = 'step-body';

        if (def.status) {
            body.appendChild(document.createTextNode(def.text));
            var tag = document.createElement('span');
            tag.className   = 'step-status ' + status.toLowerCase();
            tag.textContent = def.status;
            body.appendChild(tag);
        } else if (def.labels) {
            body.appendChild(document.createTextNode(def.text));
            var pills = document.createElement('div');
            pills.className = 'label-pills';
            def.labels.forEach(function(lbl) {
                var pill = document.createElement('span');
                pill.className   = 'label-pill';
                pill.textContent = lbl;
                pills.appendChild(pill);
            });
            body.appendChild(pills);
        } else {
            body.textContent = def.text;
        }

        li.appendChild(iconEl);
        li.appendChild(body);
        workflowSteps.appendChild(li);
    });

    uploadCard.classList.add('hidden');
    resultSection.classList.remove('hidden');
}

// ---- PREVIEW HELPERS ----

function showPreview(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        previewImage.src       = e.target.result;
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatSize(file.size);
        previewArea.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function hidePreview() {
    previewArea.classList.add('hidden');
    previewImage.src       = '';
    fileNameEl.textContent = '';
    fileSizeEl.textContent = '';
}

// ---- ERROR HELPERS ----

function showError(msg) {
    errorMessage.textContent = msg;
    errorArea.classList.remove('hidden');
}

function hideError() {
    errorArea.classList.add('hidden');
    errorMessage.textContent = '';
}

// ---- RESULT HELPERS ----

function hideResult() {
    resultSection.classList.add('hidden');
    workflowSteps.innerHTML = '';
    uploadCard.classList.remove('hidden');
}

// ---- FORMAT BYTES ----

function formatSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---- UPLOAD TO S3 ----

function uploadToS3(file) {
    uploadBtn.disabled    = true;
    uploadBtn.textContent = 'Getting upload URL…';

    fetch(API_BASE + '/upload-url', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: file.name, contentType: file.type })
    })
    .then(function(res) {
        if (!res.ok) { throw new Error('Failed to get upload URL'); }
        return res.json();
    })
    .then(function(data) {
        var uploadUrl = data.uploadUrl;
        var imageKey  = data.imageKey;

        progressWrap.classList.remove('hidden');
        progressBar.style.width   = '0%';
        progressLabel.textContent = '0%';
        uploadBtn.textContent     = 'Uploading…';

        var xhr = new XMLHttpRequest();

        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                var pct = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width   = pct + '%';
                progressLabel.textContent = pct + '%';
            }
        };

        xhr.onload = function() {
            progressWrap.classList.add('hidden');
            if (xhr.status === 200 || xhr.status === 204) {
                uploadBtn.textContent = 'Scanning image…';
                pollModerationResult(file, imageKey);
            } else {
                showError('Upload failed. Please try again.');
                uploadBtn.textContent = 'Upload Image';
                uploadBtn.disabled    = false;
            }
        };

        xhr.onerror = function() {
            progressWrap.classList.add('hidden');
            showError('Upload failed. Please try again.');
            uploadBtn.textContent = 'Upload Image';
            uploadBtn.disabled    = false;
        };

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
    })
    .catch(function() {
        showError('Upload failed. Please try again.');
        uploadBtn.textContent = 'Upload Image';
        uploadBtn.disabled    = false;
    });
}

// ---- POLL FOR RESULT ----

function pollModerationResult(file, imageKey) {
    var maxTries = 20;
    var delayMs  = 1500;
    var attempt  = 0;

    function tryOnce() {
        fetch(API_BASE + '/get-moderation-result?imageKey=' + encodeURIComponent(imageKey))
        .then(function(res) {
            if (res.ok) { return res.json(); }
            return null;
        })
        .then(function(data) {
            if (data && data.status) {
                uploadBtn.textContent = 'Upload Image';
                uploadBtn.disabled    = false;
                showResult(file, { status: data.status, labels: data.moderationLabels || [] });
                return;
            }
            attempt++;
            if (attempt < maxTries) {
                setTimeout(tryOnce, delayMs);
            } else {
                showError('Upload worked but the moderation result is taking too long. Please try again.');
                uploadBtn.textContent = 'Upload Image';
                uploadBtn.disabled    = false;
            }
        })
        .catch(function() {
            attempt++;
            if (attempt < maxTries) {
                setTimeout(tryOnce, delayMs);
            } else {
                showError('Upload worked but the moderation result is taking too long. Please try again.');
                uploadBtn.textContent = 'Upload Image';
                uploadBtn.disabled    = false;
            }
        });
    }

    tryOnce();
}

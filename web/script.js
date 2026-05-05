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

var MAX_FILE_SIZE_MB = 5;
var MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;
var ALLOWED_TYPES    = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

var selectedFile = null;

// ---- SERVER STATUS ----

function checkServerStatus() {
    statusPill.className = 'status-pill checking';
    statusText.textContent = 'Checking...';

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 5000);

    fetch(
        'https://96nwepsh16.execute-api.ap-southeast-2.amazonaws.com/dev/moderation-result?imageKey=_ping',
        { signal: controller.signal }
    )
    .then(function () {
        clearTimeout(timer);
        statusPill.className = 'status-pill';
        statusText.textContent = 'Online · Prototype Mode';
    })
    .catch(function (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            statusPill.className = 'status-pill offline';
            statusText.textContent = 'Offline';
        } else {
            // Network/CORS error on the status ping doesn't mean the upload API is broken
            statusPill.className = 'status-pill';
            statusText.textContent = 'Online · Prototype Mode';
        }
    });
}
checkServerStatus();

// ---- DRAG AND DROP ----

dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', function (e) {
    if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('over');
    }
});

dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('over');
    var file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

// ---- FILE INPUT ----

fileInput.addEventListener('change', function () {
    if (this.files[0]) handleFile(this.files[0]);
});

// ---- CLEAR BUTTON ----

clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearSelection();
});

function clearSelection() {
    selectedFile = null;
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

uploadBtn.addEventListener('click', function () {
    var file = fileInput.files[0] || selectedFile;
    if (!file) {
        showError('No file selected. Please choose an image first.');
        return;
    }
    uploadToS3(file);
});

// ---- RESET BUTTON ----

resetBtn.addEventListener('click', function () {
    clearSelection();
    hideResult();
    uploadBtn.textContent = 'Upload Image';
    uploadBtn.disabled = true;
});

// ---- SHOW RESULT ----

function showResult(file, moderationData) {
    workflowSteps.innerHTML = '';
    var isFlagged = moderationData.status === 'FLAGGED';

    resultBadge.textContent = moderationData.status;
    resultBadge.className   = 'result-badge ' + (isFlagged ? 'flagged' : 'approved');

    var stepDefs = [
        { icon: 'ok',                     text: 'Image received: ' + file.name + ' — ' + formatSize(file.size) },
        { icon: 'ok',                     text: 'Uploaded to S3 bucket' },
        { icon: 'ok',                     text: 'Scanned by Amazon Rekognition' },
        { icon: isFlagged ? 'bad' : 'ok', text: 'Moderation result: ', status: moderationData.status }
    ];

    if (isFlagged && moderationData.labels && moderationData.labels.length > 0) {
        stepDefs.push({ icon: 'bad', text: 'Detected labels:', labels: moderationData.labels });
    }

    stepDefs.forEach(function (def) {
        var li = document.createElement('li');

        var iconEl = document.createElement('div');
        iconEl.className = 'step-icon ' + def.icon;
        iconEl.textContent = def.icon === 'ok' ? '✓' : '!';

        var body = document.createElement('div');
        body.className = 'step-body';

        if (def.status) {
            body.appendChild(document.createTextNode(def.text));
            var tag = document.createElement('span');
            tag.className = 'step-status ' + (isFlagged ? 'flagged' : 'approved');
            tag.textContent = def.status;
            body.appendChild(tag);
        } else if (def.labels) {
            body.appendChild(document.createTextNode(def.text));
            var pills = document.createElement('div');
            pills.className = 'label-pills';
            def.labels.forEach(function (lbl) {
                var pill = document.createElement('span');
                pill.className = 'label-pill';
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
    reader.onload = function (e) {
        previewImage.src      = e.target.result;
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

async function uploadToS3(file) {
    try {
        uploadBtn.disabled    = true;
        uploadBtn.textContent = 'Getting upload URL...';

        const res = await fetch('https://96nwepsh16.execute-api.ap-southeast-2.amazonaws.com/dev/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type })
        });

        if (!res.ok) throw new Error('Failed to get upload URL');

        const data      = await res.json();
        const uploadUrl = data.uploadUrl;
        const key       = data.key;

        uploadBtn.textContent = 'Uploading to S3...';

        const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file });

        if (!uploadRes.ok) {
            console.error('S3 error:', await uploadRes.text());
            throw new Error('Upload to S3 failed');
        }

        uploadBtn.textContent = 'Scanning image...';
        await pollModerationResult(file, key);

    } catch (err) {
        console.error(err);
        showError('Upload failed. Please try again.');
        uploadBtn.textContent = 'Upload Image';
        uploadBtn.disabled    = false;
    }
}

// ---- POLL FOR RESULT ----

async function pollModerationResult(file, key) {
    var maxTries = 10;
    var delayMs  = 2000;

    for (var i = 0; i < maxTries; i++) {
        try {
            const res = await fetch(
                'https://96nwepsh16.execute-api.ap-southeast-2.amazonaws.com/dev/moderation-result?imageKey=' + encodeURIComponent(key)
            );

            if (res.ok) {
                const data = await res.json();
                if (data.status) {
                    uploadBtn.textContent = 'Upload Image';
                    uploadBtn.disabled    = false;
                    showResult(file, {
                        status: data.status,
                        labels: data.moderationLabels || []
                    });
                    return;
                }
            }
        } catch (err) {
            console.error(err);
        }
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }

    showError('Upload worked but the moderation result is taking too long. Please try again.');
    uploadBtn.textContent = 'Upload Image';
    uploadBtn.disabled    = false;
}

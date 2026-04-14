//  document object model elements 
var fileInput     = document.getElementById('fileInput');
var previewArea   = document.getElementById('previewArea');
var previewImage  = document.getElementById('previewImage');
var fileNameEl    = document.getElementById('fileName');
var fileSizeEl    = document.getElementById('fileSize');
var errorArea     = document.getElementById('errorArea');
var errorMessage  = document.getElementById('errorMessage');
var uploadBtn     = document.getElementById('uploadBtn');
var resultSection = document.getElementById('resultSection');
var workflowSteps = document.getElementById('workflowSteps');
var resetBtn      = document.getElementById('resetBtn');
var serverStatus  = document.getElementById('serverStatus');

// if this file is tweakin / too big we reject it right here
var MAX_FILE_SIZE_MB = 5;
var MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;
var ALLOWED_TYPES    = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// ping the backend so the footer shows if the server is alive
function checkServerStatus() {
    fetch('/status')
        .then(function (res) {
            if (res.ok) {
                serverStatus.textContent = 'Online (Prototype Mode)';
                serverStatus.className   = 'online';
            } else {
                throw new Error('not ok');
            }
        })
        .catch(function () {
            // server aint running but thats fine this is just a prototype
            serverStatus.textContent = 'Offline';
            serverStatus.className   = 'offline';
        });
}
checkServerStatus();

//  FILE SELECTION
fileInput.addEventListener('change', function () {
    // so the user picked a file? now lets see if it is actually an image
    hideError();
    hideResult();

    var file = this.files[0];

    if (!file) {
        // no file selected
        hidePreview();
        uploadBtn.disabled = true;
        return;
    }

    // type validation
    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
        // user tried to upload something thats not an image?
        showError('Invalid file type. Please select an image (JPG, PNG, GIF, or WEBP).');
        hidePreview();
        uploadBtn.disabled = true;
        return;
    }

    // size validation
    if (file.size > MAX_FILE_SIZE) {
        // this file is way too big so we can't have it
        var sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        showError('File too large (' + sizeMB + ' MB). Maximum allowed is ' + MAX_FILE_SIZE_MB + ' MB.');
        hidePreview();
        uploadBtn.disabled = true;
        return;
    }

    //if ok, show preview
    showPreview(file);
    uploadBtn.disabled = false;
});

//  UPLOAD BUTTON
uploadBtn.addEventListener('click', function () {
    var file = fileInput.files[0];

    if (!file) {
        showError('No file selected. Please choose an image first.');
        return;
    }

    uploadToS3(file);
});

//  RESET BUTTON
resetBtn.addEventListener('click', function () {
    // user wants to go again, reset everything
    fileInput.value = '';
    hidePreview();
    hideError();
    hideResult();
    uploadBtn.disabled = true;
});

// =====================
//  SIMULATE UPLOAD
// =====================
function simulateUpload(file) {
    uploadBtn.disabled   = true;
    uploadBtn.textContent = 'Processing...';

    // we throwing in a lil delay so it feels real even tho nothing is happening
    setTimeout(function () {
        showResult(file);
        uploadBtn.textContent = 'Upload Image';
    }, 800);
}


//  SHOW RESULT
function showResult(file, moderationData) {
    workflowSteps.innerHTML = '';

    var steps = [
        'Image received: ' + file.name + ' (' + formatSize(file.size) + ')',
        'Uploaded to S3',
        'Scanned by Rekognition',
        'Result: ' + moderationData.status
    ];
    // this shows what is wrong with the photo
    if (moderationData.labels && moderationData.labels.length > 0) {
        steps.push('Labels: ' + moderationData.labels.join(', '));
    } else {
        steps.push('Labels: None');
    }

    for (var i = 0; i < steps.length; i++) {
        var li = document.createElement('li');
        li.textContent = steps[i];
        workflowSteps.appendChild(li);
    }

    resultSection.classList.remove('hidden');
}


//  PREVIEW HELPERS
function showPreview(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
        previewImage.src = e.target.result;
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatSize(file.size);
        previewArea.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function hidePreview() {
    previewArea.classList.add('hidden');
    previewImage.src = '';
    fileNameEl.textContent = '';
    fileSizeEl.textContent = '';
}


//  ERROR HELPERS

function showError(msg) {
    errorMessage.textContent = msg;
    errorArea.classList.remove('hidden');
}

function hideError() {
    errorArea.classList.add('hidden');
    errorMessage.textContent = '';
}


//  RESULT HELPERS
function hideResult() {
    resultSection.classList.add('hidden');
    workflowSteps.innerHTML = '';
}


//  UTILITY

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// “Frontend uploads image to S3 using a temporary URL
// then repeatedly checks the backend until AWS finishes scanning and returns the moderation result.”

async function uploadToS3(file) {
    try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Getting upload URL...';

        // STEP 1: Ask backend for a temporary upload link (presigned URL)
        const res = await fetch('https://96nwepsh16.execute-api.ap-southeast-2.amazonaws.com/dev/upload-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            // We send file name and type so backend knows what we are uploading
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type
            })
        });

        if (!res.ok) throw new Error('Failed to get URL');

        const data = await res.json();
        // Backend gives us a special one-time link to upload directly to S3
        const uploadUrl = data.uploadUrl;
        const key = data.key;

        uploadBtn.textContent = 'Uploading to S3...';
        
        // STEP 2: Upload file directly to S3 using the presigned URL
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file
        });

        if (!uploadRes.ok) {
            const errorText = await uploadRes.text();
            // If upload fails, print the exact S3 error for debugging
            console.error('S3 error body:', errorText);
            throw new Error('Upload failed');
        }

        uploadBtn.textContent = 'Upload Complete';
        // STEP 3: After upload, start checking if moderation result is ready
        await pollModerationResult(file, key);

    } catch (err) {
        console.error(err);
        showError('Upload failed. Check console.');
        uploadBtn.textContent = 'Upload Image';
    } finally {
        uploadBtn.disabled = false;
    }
}

async function pollModerationResult(file, key) {
    uploadBtn.textContent = 'Waiting for moderation result...';

    var maxTries = 10;
    var delayMs = 2000;
    
    // Keep asking backend for moderation result
    for (var i = 0; i < maxTries; i++) {
        try {
            // Ask backend: "Is this image safe already?"
            const res = await fetch(
                'https://96nwepsh16.execute-api.ap-southeast-2.amazonaws.com/dev/moderation-result?imageKey=' + encodeURIComponent(key)
            );

            if (res.ok) {
                const data = await res.json();

                if (data.status) {
                    uploadBtn.textContent = 'Moderation Complete';
                    // If backend has result (APPROVED or FLAGGED), show it to user
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
        // Wait before asking again (don’t spam backend)
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    // If no result after many tries, show error
    showError('Upload worked, but moderation result was not retrieved yet.');
    uploadBtn.textContent = 'Upload Image';
}
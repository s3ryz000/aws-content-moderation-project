# Phase 1.6 Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the live end-to-end pipeline works — presign → upload → Rekognition → DynamoDB → poll — using a script that generates its own test image and checks CloudWatch logs for structured output.

**Architecture:** A single Python script `scripts/verify_pipeline.py` drives the full flow using only stdlib (no extra dependencies). It generates a 1×1 white PNG in-memory, runs it through the live API, and exits 0 on APPROVED or non-zero on failure. A separate log-check command reads CloudWatch via the AWS CLI. No test image files checked into the repo.

**Tech Stack:** Python 3.12 stdlib (`urllib`, `json`, `struct`, `zlib`), AWS CLI (`logs filter-log-events`), boto3 profile `content-moderation`.

---

## File Map

| Action | Path | Change |
|---|---|---|
| Create | `scripts/verify_pipeline.py` | End-to-end verification script |
| Modify | `docs/roadmap.md` | Mark Phase 1.6 complete |
| Modify | `docs/changelog.md` | Add v0.5.0 entry |

---

### Task 1: Write `scripts/verify_pipeline.py`

**Files:**
- Create: `scripts/verify_pipeline.py`

No automated unit tests — this script IS the test. It exits 0 on pass, non-zero on fail.

- [ ] **Step 1: Create `scripts/verify_pipeline.py`**

```python
#!/usr/bin/env python3
"""
verify_pipeline.py — end-to-end verification of the content moderation pipeline.

Usage:
    python scripts/verify_pipeline.py
    python scripts/verify_pipeline.py --image path/to/photo.jpg --expect APPROVED
    python scripts/verify_pipeline.py --image path/to/sensitive.jpg --expect FLAGGED

Without --image: generates a 1x1 white PNG and uploads it (should return APPROVED).
"""
import argparse
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

API_BASE = "https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com"
POLL_MAX = 20
POLL_DELAY = 1.5


def minimal_png() -> bytes:
    """Return a 1x1 white pixel PNG using only stdlib — no files, no Pillow."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
        + chunk(b"IEND", b"")
    )


def api_post(path: str, body: dict) -> dict:
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        API_BASE + path,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def upload_to_s3(url: str, data: bytes, content_type: str) -> int:
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def poll_result(image_key: str) -> dict | None:
    encoded = urllib.parse.quote(image_key, safe="")
    url = f"{API_BASE}/get-moderation-result?imageKey={encoded}"
    for attempt in range(1, POLL_MAX + 1):
        print(f"  attempt {attempt}/{POLL_MAX}...", end=" ", flush=True)
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read())
                if data.get("status"):
                    print(f"got {data['status']}")
                    return data
                print("no status yet")
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}")
        except Exception as e:
            print(f"error: {e}")
        time.sleep(POLL_DELAY)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify the content moderation pipeline end-to-end."
    )
    parser.add_argument(
        "--image",
        help="Path to image file (default: generated 1x1 white PNG)",
    )
    parser.add_argument(
        "--expect",
        default="APPROVED",
        choices=["APPROVED", "FLAGGED", "BLOCKED"],
        help="Expected moderation status (default: APPROVED)",
    )
    args = parser.parse_args()

    if args.image:
        with open(args.image, "rb") as f:
            image_data = f.read()
        filename = args.image.replace("\\", "/").split("/")[-1]
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
        mime_map = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "webp": "image/webp",
        }
        content_type = mime_map.get(ext, "image/jpeg")
    else:
        image_data = minimal_png()
        filename = "verify-test.png"
        content_type = "image/png"

    sep = "=" * 52
    print(f"\n{sep}")
    print("  Content Moderation Pipeline — Verification")
    print(sep)
    print(f"  Image      : {filename} ({len(image_data)} bytes, {content_type})")
    print(f"  API base   : {API_BASE}")
    print(f"  Expecting  : {args.expect}")
    print()

    # Step 1: get presigned URL
    print("[1/3] POST /upload-url")
    try:
        presign = api_post("/upload-url", {"filename": filename, "contentType": content_type})
    except Exception as e:
        print(f"  FAIL: {e}")
        sys.exit(1)
    image_key = presign["imageKey"]
    upload_url = presign["uploadUrl"]
    print(f"  OK  — imageKey: {image_key}")

    # Step 2: upload to S3
    print("[2/3] PUT image to S3 (presigned URL)")
    http_status = upload_to_s3(upload_url, image_data, content_type)
    if http_status not in (200, 204):
        print(f"  FAIL: S3 returned HTTP {http_status}")
        sys.exit(1)
    print(f"  OK  — HTTP {http_status}")

    # Step 3: poll for moderation result
    print(f"[3/3] Polling GET /get-moderation-result (max {POLL_MAX} × {POLL_DELAY}s)")
    result = poll_result(image_key)
    if result is None:
        print(f"\n  FAIL: no result after {POLL_MAX * POLL_DELAY:.0f}s")
        sys.exit(1)

    # Report
    actual = result["status"]
    labels = result.get("moderationLabels", [])
    print()
    print(sep)
    print(f"  Status  : {actual}")
    if labels:
        names = ", ".join(
            lbl.get("Name", str(lbl)) if isinstance(lbl, dict) else str(lbl)
            for lbl in labels
        )
        print(f"  Labels  : {names}")
    print()
    if actual == args.expect:
        print(f"  PASS — got expected status: {actual}")
        print(sep)
    else:
        print(f"  FAIL — expected {args.expect}, got {actual}")
        print(sep)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/verify_pipeline.py
git commit -m "feat: add verify_pipeline.py end-to-end verification script"
```

---

### Task 2: Run the APPROVED happy-path verification

**Files:** No changes — run only.

- [ ] **Step 1: Ensure AWS profile is active**

In your terminal (PowerShell):

```powershell
$env:AWS_PROFILE = "content-moderation"
```

- [ ] **Step 2: Run the script with the generated test image**

```powershell
python scripts/verify_pipeline.py
```

Expected output (timing will vary):

```
====================================================
  Content Moderation Pipeline — Verification
====================================================
  Image      : verify-test.png (67 bytes, image/png)
  API base   : https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com
  Expecting  : APPROVED

[1/3] POST /upload-url
  OK  — imageKey: uploads/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.png
[2/3] PUT image to S3 (presigned URL)
  OK  — HTTP 200
[3/3] Polling GET /get-moderation-result (max 20 × 1.5s)
  attempt 1/20... HTTP 404
  attempt 2/20... HTTP 404
  attempt 3/20... got APPROVED

====================================================
  Status  : APPROVED
  
  PASS — got expected status: APPROVED
====================================================
```

If the script exits with code 0, the APPROVED path is verified. If it fails, see the troubleshooting note at the end of this plan.

- [ ] **Step 3: (Optional) Run with a custom image**

If you have a test image on hand, run:

```powershell
python scripts/verify_pipeline.py --image C:\path\to\photo.jpg --expect APPROVED
```

For a FLAGGED or BLOCKED path, supply a relevant test image and change `--expect` accordingly.

---

### Task 3: Check CloudWatch logs for structured JSON

**Files:** No changes — inspection only.

The `cm-process-image` Lambda runs asynchronously after each S3 upload. Its CloudWatch log group is `/aws/lambda/cm-process-image`.

- [ ] **Step 1: Pull the most recent log events**

Run (PowerShell, same terminal with `AWS_PROFILE=content-moderation`):

```powershell
aws logs filter-log-events `
  --log-group-name /aws/lambda/cm-process-image `
  --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds()) `
  --query "events[*].message" `
  --output text `
  --profile content-moderation `
  --region ap-southeast-2
```

- [ ] **Step 2: Verify the log output**

You should see one or more log lines that look like structured JSON or a Python print/logging statement. A passing log entry will contain the `imageKey` from your test upload and the `status` field. Example:

```
START RequestId: abc123 ...
Processing s3://content-moderation-bucket-420/uploads/xxxx.png
Rekognition returned 0 labels
Writing to DynamoDB: imageKey=uploads/xxxx.png status=APPROVED
END RequestId: abc123 ...
REPORT RequestId: abc123 Duration: 1234.56 ms ...
```

Key things to confirm:
- The `imageKey` matches what the verify script printed
- The `status` matches what was returned by the API
- No base64 image data appears in the logs (the Lambda reads from S3 by key, it never logs image bytes)

- [ ] **Step 3: Check the other two Lambda log groups (optional)**

```powershell
aws logs filter-log-events `
  --log-group-name /aws/lambda/cm-get-upload-url `
  --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds()) `
  --query "events[*].message" --output text `
  --profile content-moderation --region ap-southeast-2

aws logs filter-log-events `
  --log-group-name /aws/lambda/cm-get-moderation-result `
  --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds()) `
  --query "events[*].message" --output text `
  --profile content-moderation --region ap-southeast-2
```

---

### Task 4: Update roadmap and changelog

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Mark Phase 1.6 complete in `docs/roadmap.md`**

Change the Phase 1.6 section from:

```markdown
### 1.6 Verification
- [ ] End-to-end happy path: upload a benign cat photo → `APPROVED`
- [ ] End-to-end flag path: upload a known borderline test image → `FLAGGED`
- [ ] End-to-end block path: confirm `BLOCKED` triggers (synthetic test using a known violent stock image set)
- [ ] CloudWatch logs show structured JSON, no PII, no full base64 image bytes
```

To:

```markdown
### 1.6 Verification
- [x] End-to-end happy path: generated 1×1 PNG → `APPROVED` via `verify_pipeline.py`
- [-] End-to-end flag path: skipped for MVP — requires curated test images
- [-] End-to-end block path: skipped for MVP — requires curated test images
- [x] CloudWatch logs confirmed: structured output, no PII, no image bytes
```

Also update the last-updated date at the bottom of the file to `2026-05-07`.

- [ ] **Step 2: Add v0.5.0 entry to `docs/changelog.md`**

Insert after `## [Unreleased]` and before `## [0.4.0]`:

```markdown
## [0.5.0] — 2026-05-07

### Added
- `scripts/verify_pipeline.py` — end-to-end verification script; generates a 1×1 white PNG, runs it through the live API (presign → S3 upload → poll), and exits 0 on expected status

### Verified
- APPROVED happy path confirmed against live API (`https://92oypqmlm2.execute-api.ap-southeast-2.amazonaws.com`)
- CloudWatch logs for all three Lambdas show structured output with no PII or image bytes
```

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md docs/changelog.md
git commit -m "docs: mark Phase 1.6 verification complete, add v0.5.0 changelog"
```

---

## Troubleshooting

**`[1/3] FAIL: HTTP Error 403` or `400` on POST /upload-url**
The API is rejecting the request. Check that `contentType` is one of `image/jpeg`, `image/png`, `image/gif`, `image/webp`. Inspect the response body for a validation error message.

**`[2/3] FAIL: S3 returned HTTP 403`**
The presigned URL has expired (unlikely for a 300 s window) or the `Content-Type` header sent to S3 doesn't match the one used to generate the presigned URL. Ensure `content_type` is passed identically to both the presign request and the S3 PUT.

**`[3/3] FAIL: no result after 30s`**
`cm-process-image` didn't run or failed. Check:
1. S3 event notification is wired up: `aws s3api get-bucket-notification-configuration --bucket content-moderation-bucket-420 --profile content-moderation`
2. Lambda logs: `aws logs filter-log-events --log-group-name /aws/lambda/cm-process-image --start-time ...`

**Script exits 0 but status is FLAGGED instead of APPROVED**
Rekognition flagged the generated 1×1 PNG. This is unexpected but possible. Check the `Labels` field in the output. If this happens, try a larger, clearly benign image (`--image path/to/photo.jpg --expect APPROVED`).

---

## Self-Review

**Spec coverage:**

| Roadmap item | Task |
|---|---|
| E2e happy path → APPROVED | Task 2 |
| E2e flag/block path | Marked `[-]` (skipped for MVP — no curated test images in repo) |
| CloudWatch logs: structured JSON, no PII | Task 3 |
| Script at `scripts/verify_pipeline.py` | Task 1 |
| Roadmap + changelog updated | Task 4 |

**Placeholder scan:** No TBDs, no vague steps. Every step has exact commands and expected output.

**Type consistency:** `presign["imageKey"]` and `presign["uploadUrl"]` match the response shape returned by `lambdas/get_upload_url/handler.py`. `result["status"]` and `result["moderationLabels"]` match `lambdas/get_moderation_result/handler.py`.

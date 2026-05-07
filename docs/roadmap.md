# roadmap.md — AWS Content Moderation System

> What we're building, in what order, and why. Update status checkboxes as work lands.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` cut from scope

---

## Phase 0 — Project Bootstrap

The boring-but-load-bearing foundation.

- [x] Create repo and `docs/` with `claude.md`, `roadmap.md`, `changelog.md`
- [x] Capture architecture diagram (`docs/project-architecture.pdf`)
- [x] `README.md` with one-paragraph project description and local-run instructions
- [x] `.gitignore` (Python, Terraform, OS junk)
- [x] AWS account / IAM user `dev` with programmatic access (PowerUserAccess + IAMFullAccess)
- [x] Configure local AWS profile `content-moderation`
- [x] Choose AWS region and pin it — **`ap-southeast-2` (Sydney)**, overrides `us-east-1` recommendation; matches existing Lambda code
- [x] Pick a unique S3 bucket name and reserve it (`content-moderation-bucket-420`)

**Exit criteria:** `terraform plan` runs with zero resources but valid credentials and backend.

---

## Phase 0.5 — Rewrite Node.js Lambdas to Python 3.12

Required before any `aws_lambda_function` Terraform resource can be deployed.

- [x] Rewrite `lambda/get-upload-url.js` → `lambdas/get_upload_url/handler.py`
- [x] Rewrite `lambda/process-image.js` → `lambdas/process_image/handler.py` (+ `policy.py` for `HARD_BLOCK_CATEGORIES`)
- [x] Rewrite `lambda/get-moderation-result.js` → `lambdas/get_moderation_result/handler.py`
- [x] Add `requirements.txt` to each Lambda directory (`boto3` only — it is provided by the Lambda runtime but pin for local testing)
- [x] Confirm each handler signature: `lambda_handler(event: dict, context) -> dict` with type hints

**Exit criteria:** All three Python handlers pass unit tests locally; `lambda/` (old Node.js) directory can be archived/removed.

---

## Phase 1 — MVP Pipeline (the spine)

Goal: a user on `localhost:8080` can drag in an image, see it upload, and within seconds see `APPROVED`, `FLAGGED`, or `BLOCKED`. No admin dashboard, no auth, no polish.

### 1.1 Infrastructure (Terraform)
- [x] S3 bucket — private, versioning on, server-side encryption (SSE-S3)
- [x] DynamoDB table `image-moderation-results` — on-demand, PK `imageKey`
- [x] IAM roles & policies — one per Lambda, least-privilege
- [x] Three Lambda functions (Python 3.12, 256 MB, 10 s timeout for HTTP, 30 s for `process-image`)
- [x] API Gateway HTTP API with two routes:
  - [x] `POST /upload-url` → `cm-get-upload-url`
  - [x] `GET /get-moderation-result` → `cm-get-moderation-result`
- [x] S3 → `cm-process-image` event notification (`s3:ObjectCreated:*`)
- [x] CORS on API Gateway for `http://localhost:8080`
- [x] Terraform outputs: API base URL, bucket name

### 1.2 Lambda — `cm-get-upload-url`
- [x] Validate body: `filename` (string) and `contentType` (allowlist of 4 MIME types)
- [x] Generate UUID-based `imageKey` (`uploads/{uuid}.{ext}`)
- [x] Return presigned PutObject URL, 300 s expiry, content-type-locked
- [x] Unit tests for the allowlist and key generation

### 1.3 Lambda — `cm-process-image`
- [x] Parse S3 event, extract `bucketName` + `imageKey`
- [x] Call `rekognition.detect_moderation_labels` with `MinConfidence=50`
- [x] Apply status logic from `claude.md §5`
- [x] Write `{imageKey, bucketName, status, moderationLabels, timestamp}` to DynamoDB
- [x] Idempotent: re-running on the same key overwrites cleanly
- [x] Unit tests for the status decision function (no AWS calls in those tests)

### 1.4 Lambda — `cm-get-moderation-result`
- [x] Validate query string: `imageKey` required, length-bounded
- [x] DynamoDB `GetItem` by `imageKey`
- [x] Return `404` shape if not found yet (frontend interprets as "still processing")
- [x] Return JSON: `{ status, moderationLabels, timestamp }`
- [x] Unit tests for the not-found path and happy path

### 1.5 Frontend (Vanilla JS)
- [x] `index.html` — file input, image preview, status chip, label list
- [x] `app.js`:
  - [x] Client-side validation (size ≤ 10 MB, MIME in allowlist)
  - [x] Request presigned URL → PUT image with progress bar
  - [x] Poll `GET /get-moderation-result` every 1.5 s, max 20 attempts
  - [x] Render result with color-coded status (green / red / orange)
- [x] `styles.css` — minimal, responsive, no framework
- [x] BLOCKED orange state (badge, step icons, step status text)

### 1.6 Verification
- [x] End-to-end happy path: uploaded image via frontend → `APPROVED` confirmed
- [-] End-to-end flag path: skipped for MVP — requires curated test images
- [-] End-to-end block path: skipped for MVP — requires curated test images
- [-] CloudWatch logs: deferred — pipeline confirmed working end-to-end

**Exit criteria:** A teammate can `git clone`, `terraform apply`, open `localhost:8080`, and see the full pipeline work without you helping.

---

## Phase 2 — Admin Dashboard

Goal: administrators can review what got flagged or blocked, approve/reject manually, and see trends.

### 2.1 Backend additions
- [x] New API Gateway routes (admin namespace):
  - `GET /admin/moderation` — list with optional `status` filter and `limit` cap (default 100)
  - `POST /admin/moderation/{imageKey}/decision` — manual override (approve / reject)
- [x] DynamoDB GSI: `status-timestamp-index` for cheap status-filtered queries
- [x] New Lambdas: `cm-list-moderation`, `cm-decide-moderation`
- [x] `manualDecision`, `decidedBy`, `decisionTimestamp` fields; `process-image` never overwrites them

### 2.2 Auth (minimum viable)
- [x] Amazon Cognito user pool with one admin group
- [x] API Gateway JWT authorizer on `/admin/*` routes only
- [x] Login screen on the dashboard (Cognito Hosted UI with PKCE)

### 2.3 Dashboard UI (still vanilla JS, separate page)
- [-] Login screen — removed from scope (no auth in MVP)
- [x] `frontend/admin/index.html` — table view at `http://localhost:8080/frontend/admin/`
- [x] Filter chips: All / Flagged / Blocked / Approved
- [-] Image preview — removed from scope (bucket is private, no presigned GET endpoint)
- [x] Approve / Reject buttons → calls decision endpoint, updates row
- [x] CSV export of current filter

### 2.4 Verification
- [ ] An admin can log in, see a flagged image, approve it, and that decision persists
- [ ] A non-admin cannot reach `/admin/*` endpoints

**Exit criteria:** A reviewer can clear the flagged queue end-to-end without touching the AWS console.

---

## Phase 3 — Hardening & Polish

Optional but valuable; pick from this list once Phases 1–2 are done.

- [ ] Rate limiting per IP at API Gateway (usage plans / WAF)
- [ ] CloudFront in front of S3 for moderated-asset delivery (with signed URLs)
- [ ] Admin notifications: SNS topic on `BLOCKED` → email/Slack
- [ ] DynamoDB TTL — auto-expire rows after 90 days
- [ ] CloudWatch dashboard: uploads/min, % flagged, Rekognition latency, Lambda errors
- [x] CI/CD: GitHub Actions running `ruff`, `pytest`, `terraform fmt -check`, `terraform validate` on PRs
- [ ] Custom domain via Route 53 + ACM cert
- [ ] Multi-region? (Probably no — defer until there's actual traffic.)

---

## Out of Scope (explicit non-goals)

So we don't get tempted:

- Video moderation
- User-facing accounts or upload history
- Custom-trained models — Rekognition is the moderation engine, full stop
- Mobile app
- Real-time streaming
- Multi-tenant / organization support

---

*Last updated: 2026-05-07 (Phase 2.3)*

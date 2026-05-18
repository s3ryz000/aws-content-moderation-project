# AWS Content Moderation System

An end-to-end image content moderation pipeline built entirely on AWS serverless services. Users upload images through a web frontend; Amazon Rekognition automatically scans them for inappropriate content; results are stored in DynamoDB and shown in the browser. A separate password-protected admin dashboard lets moderators review flagged images, see confidence scores, and approve or reject them manually.

**Live region:** `ap-southeast-2` (Sydney)

---

## What It Does

### Upload flow (public)
1. User visits the upload page and picks an image (JPEG, PNG, GIF, WebP — up to 10 MB).
2. The browser requests a presigned S3 upload URL from the API.
3. The image is uploaded directly to a private S3 bucket (browser → S3, no Lambda in the data path).
4. An S3 event triggers the `process-image` Lambda, which calls Rekognition's `DetectModerationLabels`.
5. The result is written to DynamoDB with one of three statuses:
   - **APPROVED** — no content issues detected (confidence below threshold)
   - **FLAGGED** — potentially inappropriate content detected; needs human review
   - **BLOCKED** — high-confidence harmful content; blocked immediately
6. The upload page polls the API every 2 seconds and shows the result once ready, including each detected label and its confidence percentage (e.g. `Weapons — 99.9%`).

### Admin dashboard (protected)
1. Admin navigates to `/frontend/admin/` and is redirected to a Cognito Hosted UI login page.
2. After logging in, a JWT token is stored in memory (PKCE OAuth 2.0 flow — no password ever touches the app server).
3. The dashboard fetches all moderation results and displays them in a filterable table.
4. **Filter tabs:** All · Flagged (needs review) · Blocked · Approved — each shows a live count badge.
5. **Labels column** — every row shows the Rekognition labels that triggered the result, each with its confidence score.
6. **View button** — generates a temporary presigned S3 GET URL so the admin can open the original image in a new tab (URLs expire after 1 hour).
7. **Approve / Reject buttons** — flagged items can be manually decided. The decision is written back to DynamoDB and the row moves to the correct filter tab instantly (no page reload).
8. **Export CSV** — downloads the current filtered view as a `.csv` file.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        PUBLIC                           │
│                                                         │
│  Browser ──POST /upload-url──► Lambda: get-upload-url  │
│              (presigned PUT URL)                        │
│                                                         │
│  Browser ──PUT image──────────► S3 (private bucket)    │
│                                      │                  │
│                               s3:ObjectCreated          │
│                                      ▼                  │
│                          Lambda: process-image          │
│                                      │                  │
│                            DetectModerationLabels       │
│                                      ▼                  │
│                                 Rekognition             │
│                                      │                  │
│                            write result + labels        │
│                                      ▼                  │
│                                 DynamoDB                │
│                                      ▲                  │
│  Browser ──GET /result──────────► Lambda: get-result   │
│              (poll until ready)                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                        ADMIN                            │
│                                                         │
│  Admin ──── Cognito Hosted UI ─── JWT token            │
│                                                         │
│  Admin ──GET /admin/moderation──► Lambda: list-mod     │
│              (all results + presigned image URLs)       │
│                                      │                  │
│                          DynamoDB scan (GSI by status)  │
│                          S3 presigned GET URL per row   │
│                                                         │
│  Admin ──POST /admin/moderation/decision               │
│              ──────────────────────► Lambda: decide    │
│                                      ▼                  │
│                             write manualDecision        │
│                             + decisionTimestamp         │
│                                  DynamoDB               │
└─────────────────────────────────────────────────────────┘
```

### API routes

| Method | Path | Lambda | Auth |
|--------|------|--------|------|
| `POST` | `/upload-url` | `get-upload-url` | None |
| `GET` | `/get-moderation-result` | `get-moderation-result` | None |
| `GET` | `/admin/moderation` | `list-moderation` | Cognito JWT |
| `POST` | `/admin/moderation/decision` | `decide-moderation` | Cognito JWT |

### DynamoDB schema

| Attribute | Type | Role |
|-----------|------|------|
| `imageKey` | String | Partition key (e.g. `uploads/<uuid>.jpg`) |
| `status` | String | `APPROVED` / `FLAGGED` / `BLOCKED` — GSI partition key |
| `timestamp` | String | ISO-8601 — GSI sort key |
| `moderationLabels` | List | Rekognition labels with name, confidence, parent |
| `manualDecision` | String | `APPROVED` / `REJECTED` (admin override, optional) |
| `decisionTimestamp` | String | ISO-8601 of when the admin decided (optional) |

GSI name: `status-timestamp-index` — used to query by status and sort newest-first.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vanilla HTML / CSS / JS (no framework) |
| API | Amazon API Gateway HTTP API (payload format v2.0) |
| Compute | AWS Lambda — Python 3.12 |
| Moderation | Amazon Rekognition `DetectModerationLabels` |
| Storage | Amazon S3 — private bucket, presigned URLs for upload and viewing |
| Database | Amazon DynamoDB — on-demand billing, GSI for status queries |
| Auth | Amazon Cognito — Hosted UI, PKCE OAuth 2.0, JWT verification |
| IaC | Terraform (remote state in S3, lock in DynamoDB) |
| CI | GitHub Actions — lint (ruff), unit tests (pytest + moto), tf validate |

---

## Project Structure

```
aws-content-moderation-project/
├── frontend/
│   ├── index.html          ← Upload page
│   ├── app.js              ← Upload + poll + result rendering
│   ├── styles.css          ← Upload page styles
│   ├── shared.css          ← Design tokens and shared components (navbar, label pills)
│   └── admin/
│       ├── index.html      ← Admin dashboard
│       ├── admin.js        ← Table render, filter chips, decision actions, CSV export
│       ├── admin.css       ← Admin page styles
│       ├── auth.js         ← PKCE token management (login, logout, token refresh)
│       ├── callback.html   ← Cognito redirect landing page
│       └── callback.js     ← Exchange auth code for tokens
├── lambdas/
│   ├── get_upload_url/     ← Returns presigned S3 PUT URL for direct browser upload
│   ├── process_image/      ← Triggered by S3 event; runs Rekognition; writes to DynamoDB
│   ├── get_moderation_result/ ← Polls DynamoDB for a result by imageKey
│   ├── list_moderation/    ← Admin: returns all results with labels + presigned view URLs
│   └── decide_moderation/  ← Admin: records APPROVED / REJECTED manual decision
├── infra/                  ← Terraform — S3, DynamoDB, Lambda, API Gateway, Cognito, IAM
├── tests/                  ← 59 pytest unit tests (moto mocks all AWS calls)
├── scripts/
│   ├── aws-bootstrap.ps1   ← One-time: creates upload bucket + Terraform backend
│   └── create-admin.ps1    ← Creates a Cognito admin user
└── docs/                   ← Architecture notes, specs, changelog
```

---

## Prerequisites

- [AWS CLI v2](https://awscli.amazonaws.com/AWSCLIV2.msi)
- [Terraform ≥ 1.6](https://developer.hashicorp.com/terraform/install)
- Python 3.12
- An AWS account with an IAM user that has PowerUserAccess + IAMFullAccess

---

## Setup (fresh deploy)

### 1 — Configure AWS profile

```powershell
aws configure --profile content-moderation
# Region:  ap-southeast-2
# Output:  json
```

### 2 — Bootstrap state backend (one-time)

```powershell
.\scripts\aws-bootstrap.ps1
```

Creates the S3 upload bucket, Terraform remote state bucket, and DynamoDB lock table.

### 3 — Deploy infrastructure

```powershell
cd infra
terraform init
terraform apply
```

### 4 — Create the admin user

```powershell
.\scripts\create-admin.ps1 -Username admin -Email you@example.com -TempPassword Temp1234!
```

Cognito forces a password change on first login.

---

## Running locally

| OS | Command |
|----|---------|
| Linux / Mac | `./run.sh` |
| Windows | `run.bat` |

Then open <http://localhost:8080>.

| Page | URL |
|------|-----|
| Upload | `http://localhost:8080/frontend/` |
| Admin dashboard | `http://localhost:8080/frontend/admin/` |

The admin dashboard redirects to Cognito login automatically. The live API in `ap-southeast-2` is used even when running locally — no local AWS emulation needed.

---

## Development

```powershell
# Install dev dependencies
pip install -r requirements-dev.txt

# Run tests (59 tests, all AWS calls mocked via moto)
pytest tests/ -q

# Lint
ruff check lambdas/
```

---

## Key Design Decisions

**Direct S3 upload (presigned PUT URL)** — images never pass through Lambda. Lambda only handles URL generation, keeping Lambda payloads small and removing a potential bottleneck for large files.

**Private S3 bucket with presigned GET URLs** — the bucket has all public access blocked. Admins view images through time-limited presigned URLs (1-hour expiry) generated per-request by the `list-moderation` Lambda, so no image is ever publicly reachable.

**Client-side filtering** — the admin dashboard fetches all results once and filters in the browser. This avoids repeated API calls when switching tabs and keeps the filter counts always accurate.

**PKCE OAuth 2.0** — no client secret is embedded in the frontend. The auth code exchange uses a code verifier/challenge pair generated in the browser, so the flow is safe even in a public JavaScript client.

**Terraform for all infrastructure** — every AWS resource (S3, DynamoDB, Lambda, API Gateway, Cognito, IAM roles and policies) is declared in Terraform. Nothing was created manually in the console.

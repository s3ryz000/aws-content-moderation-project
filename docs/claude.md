# claude.md — AWS Content Moderation System

> Persistent project context for Claude. Read this first at the start of every coding session.

---

## 1. Project Snapshot

**Name:** AWS Content Moderation System
**Goal:** Automatically filter inappropriate images before they are published. Users upload images via a web frontend; Amazon Rekognition analyzes them; the system tags each image as `APPROVED`, `FLAGGED`, or `BLOCKED` and stores the result for the user (and, eventually, an admin dashboard) to consume.

**Current phase:** MVP — end-to-end upload → moderate → result pipeline. Admin dashboard is explicitly Phase 2.

---

## 2. Architecture (must match the diagram in `docs/project-architecture.pdf`)

Three independent flows, all serverless, all triggered through API Gateway or S3 events.

**A. Upload-permission flow (synchronous)**
`Browser` → `POST /upload-url` → `API Gateway (HTTP API)` → `Lambda: get-upload-url` → returns `{ uploadUrl, imageKey }`. The Lambda generates a short-lived presigned S3 PutObject URL.

**B. Direct S3 upload flow (asynchronous trigger)**
`Browser` → `PUT` image bytes to the presigned URL → `S3 bucket: content-moderation-bucket-420` → `s3:ObjectCreated:*` event → `Lambda: process-image` → calls `Rekognition.DetectModerationLabels` → writes result row to DynamoDB.

**C. Result-retrieval flow (synchronous, polled by frontend)**
`Browser` → `GET /get-moderation-result?imageKey=...` → `API Gateway` → `Lambda: get-moderation-result` → reads DynamoDB by `imageKey` → returns `{ status, moderationLabels, timestamp }`.

**DynamoDB table:** `image-moderation-results`
Attributes: `imageKey` (PK, S), `bucketName` (S), `status` (S), `moderationLabels` (L of M), `timestamp` (S, ISO 8601).

**S3 bucket:** `content-moderation-bucket-420` — private, presigned-URL-only writes, key format `uploads/{uuid}.{ext}`.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS, served on `localhost:8080` (later: S3 static hosting) | Matches diagram, no build step, easy to reason about. |
| API | Amazon API Gateway (HTTP API, not REST API) | Cheaper, lower latency, sufficient for our two routes. |
| Compute | AWS Lambda, Python 3.12 | Native `boto3`, low cold-start, idiomatic for Rekognition. |
| Moderation | Amazon Rekognition `DetectModerationLabels` | Managed, no model hosting. |
| Storage (objects) | Amazon S3 | Presigned-URL uploads only. |
| Storage (metadata) | Amazon DynamoDB (on-demand) | Single-table, key-only access pattern. |
| IaC | Terraform | Readable, all infra reproducible from `infra/`. |
| Local dev | AWS SAM CLI or `python -m http.server` for the frontend | Lambda iteration without redeploys. |

---

## 4. Repository Layout (target)

```
aws-content-moderation-project/
├── docs/                       # ← claude.md, roadmap.md, changelog.md, architecture pdf
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js                  # upload + polling logic
├── lambdas/
│   ├── get_upload_url/
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── process_image/
│   │   ├── handler.py
│   │   └── requirements.txt
│   └── get_moderation_result/
│       ├── handler.py
│       └── requirements.txt
├── infra/                      # Terraform
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── s3.tf
│   ├── dynamodb.tf
│   ├── lambda.tf
│   ├── api_gateway.tf
│   └── iam.tf
├── tests/                      # pytest unit tests for Lambda handlers
└── README.md
```

Treat this layout as the source of truth — when adding files, place them here.

---

## 5. Status Decision Logic

`process-image` Lambda decides status from Rekognition's `ModerationLabels` array (each has `Name`, `Confidence`, `ParentName`).

```
BLOCKED   if any label.Confidence ≥ 90 AND label.ParentName ∈ HARD_BLOCK_CATEGORIES
FLAGGED   else if any label.Confidence ≥ 60
APPROVED  otherwise
```

`HARD_BLOCK_CATEGORIES` (initial set, tunable): `Explicit Nudity`, `Violence`, `Visually Disturbing`, `Hate Symbols`. Keep this constant in one place — `lambdas/process_image/policy.py` — so it's auditable.

---

## 6. Conventions

**Python (Lambdas):** PEP 8, type hints required on handler signatures, `ruff` + `black` for formatting. Each handler exports `lambda_handler(event, context)` and nothing else; pure logic lives in sibling modules so it's unit-testable.

**Naming:**
- Lambda function names: `cm-get-upload-url`, `cm-process-image`, `cm-get-moderation-result` (`cm-` = "content moderation")
- IAM role names: `cm-{function}-role`
- Terraform resource names: `snake_case`, mirror the AWS console name where possible.

**Frontend:** No frameworks, no bundlers. ES modules, `fetch` over `XMLHttpRequest`, no jQuery. Keep `app.js` under ~250 lines; if it grows, split by flow (`upload.js`, `poll.js`, `render.js`).

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `infra:`). One concern per commit.

**Secrets:** Never committed. AWS credentials via local `~/.aws/credentials` profile `content-moderation`. No `.env` files checked in — only `.env.example`.

---

## 7. Security Guardrails (non-negotiable)

- S3 bucket is **private**. Only writes via presigned URL (≤ 5 min expiry), only reads by `process-image` Lambda role.
- IAM follows **least privilege**:
  - `get-upload-url`: `s3:PutObject` on the single bucket prefix only.
  - `process-image`: `s3:GetObject`, `rekognition:DetectModerationLabels`, `dynamodb:PutItem` on the one table.
  - `get-moderation-result`: `dynamodb:GetItem` on the one table. No write permissions.
- API Gateway routes are **unauthenticated for MVP** but rate-limited (usage plan, 10 req/s, 100 burst). Auth is a Phase 3 concern.
- Frontend validates file type and size before requesting a presigned URL: max 10 MB, MIME ∈ `{image/jpeg, image/png, image/gif, image/webp}`. Server-side check in `process-image` is the source of truth — frontend validation is UX, not security.
- Presigned URLs are scoped to one `imageKey`, one method (`PUT`), one Content-Type.

---

## 8. How to Help Me (Claude's working agreement)

1. **Read `docs/roadmap.md` before suggesting work.** Don't propose Phase 2 features while Phase 1 milestones are open.
2. **Update `docs/changelog.md` whenever you ship something.** New section under the upcoming version, `Keep a Changelog` format.
3. **Don't invent infrastructure.** If a feature needs a new AWS resource, add it to Terraform in `infra/` — never assume it exists.
4. **Match the diagram.** If a request would deviate from the architecture in `project-architecture.pdf`, flag it explicitly before coding.
5. **Test the Lambda logic, not the AWS SDK.** Use `moto` or simple monkey-patching for `boto3` in unit tests.
6. **Plain prose explanations.** When teaching me something, prefer paragraphs over bullet soup unless it's reference material.
7. **Ask before deleting.** Refactors that move/delete files need a heads-up first.

---

## 9. Open Questions (resolve as we go)

- Final list of `HARD_BLOCK_CATEGORIES` — current list is a placeholder.
- Polling interval for the frontend (currently planned: 1.5 s, max 20 attempts).
- Retention policy for DynamoDB rows (TTL on `timestamp + 90d`?).
- Auth model for the Phase 2 admin dashboard (Cognito? Single shared API key behind CloudFront?).

---

*Last updated: 2026-05-06*

# Changelog

All notable changes to this project are recorded here.

This log follows the conventions of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until `1.0.0`, expect breaking changes between minor versions.

Sections to use under each release: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Infra`, `Docs`.

---

## [Unreleased]

---

## [0.5.0] — 2026-05-07

### Verified
- End-to-end happy path confirmed: image uploaded via `frontend/` → presigned S3 PUT → Rekognition scan → `APPROVED` result displayed in browser
- Full pipeline working: API Gateway → Lambda → S3 → process-image Lambda → DynamoDB → get-moderation-result Lambda → frontend

---

## [0.3.0] — 2026-05-07

### Added
- `infra/s3.tf` — private S3 content bucket with versioning, SSE-S3, public-access block, and CORS for presigned PUT uploads
- `infra/dynamodb.tf` — `image-moderation-results` DynamoDB table (on-demand, PK `imageKey`)
- `infra/iam.tf` — three least-privilege IAM roles (`cm-get-upload-url-role`, `cm-process-image-role`, `cm-get-moderation-result-role`) with inline policies and CloudWatch Logs attachment
- `infra/lambda.tf` — three Python 3.12 Lambda functions packaged via `archive_file`; S3 event notification (`s3:ObjectCreated:*` on `uploads/`) wired to `cm-process-image`
- `infra/api_gateway.tf` — HTTP API (`cm-api`) with `POST /upload-url` and `GET /get-moderation-result` routes, `$default` stage with auto-deploy, CORS for `http://localhost:8080`
- `infra/outputs.tf` — `api_base_url`, `content_bucket`, `dynamodb_table_name`, `aws_region`
- `dist/.gitkeep` — tracks the `dist/` directory where Terraform writes Lambda zips

### Changed
- `infra/backend.tf` — added `required_providers` block pinning `hashicorp/aws ~> 5.0` and `hashicorp/archive ~> 2.0`

---

## [0.2.0] — 2026-05-06

### Added
- `lambdas/get_upload_url/handler.py` — Python 3.12 rewrite; validates MIME type allowlist, generates UUID-based `imageKey`, returns presigned S3 PutObject URL (300 s expiry)
- `lambdas/process_image/handler.py` — Python 3.12 rewrite; parses S3 event, calls Rekognition, writes result to DynamoDB; re-raises on AWS errors for Lambda retry
- `lambdas/process_image/policy.py` — `HARD_BLOCK_CATEGORIES` constant and `determine_status()` pure function; single auditable location for moderation thresholds
- `lambdas/get_moderation_result/handler.py` — Python 3.12 rewrite; validates `imageKey`, reads DynamoDB, returns `{ status, moderationLabels, timestamp }`
- `tests/` — 39 unit tests across four files (`test_policy.py`, `test_get_upload_url.py`, `test_process_image.py`, `test_get_moderation_result.py`); uses `moto` for AWS mocking, coverage ≥ 80%
- `requirements-dev.txt` — pinned dev toolchain (pytest, moto, ruff, black, pytest-cov)
- `pyproject.toml` — pytest, coverage, ruff, and black configuration

### Changed
- `.github/workflows/ci.yml` — replaced Java/zip build with lint-gate parallel pipeline: `lint` (ruff + black) → `test` (pytest + coverage) ∥ `terraform-validate`
- `.github/workflows/deploy.yml` — added `workflow_dispatch` trigger; updated Lambda packaging from Node.js zips to Python directory zips

### Removed
- `lambda/` Node.js handlers — archived to `lambda_archived/` (not deleted)

### Docs
- `docs/cicd.md` — added branch protection setup instructions
- `docs/roadmap.md` — marked Phase 0.5 (Python Lambda rewrite) and Phase 3 CI/CD item complete

### Added
- `.gitignore` covering compiled Java output, Python bytecode/virtualenvs, Terraform state and `.tfvars`, and local secrets/credentials
- `.env.example` with non-secret reference values for the project's AWS environment variables
- `infra/backend.tf` — Terraform S3 remote state backend pointed at `cm-tfstate-<account-id>` with DynamoDB lock table
- `infra/providers.tf` — AWS provider pinned to `ap-southeast-2`, profile `content-moderation`, with default resource tags
- `infra/variables.tf` — skeleton variable declarations for bucket name, DynamoDB table name, and frontend origin
- `scripts/aws-bootstrap.ps1` — idempotent script to create the upload bucket, Terraform state bucket, and DynamoDB lock table; also patches `backend.tf` with the real account ID
- `scripts/check-aws.ps1` — quick health check: identity, bucket contents, DynamoDB table status

### Changed
- `README.md` — updated framing from "no cloud services connected" to "cloud-connected (ap-southeast-2)"; added Setup section documenting `aws configure --profile content-moderation`, env-var exports, and bootstrap script

### Infra
- Provisioning split confirmed: AWS CLI handles Phase 0 bootstrap; Terraform under `infra/` provisions all Phase 1 resources
- Region pinned to `ap-southeast-2` (Sydney) — overrides roadmap's `us-east-1` recommendation to match existing Lambda code

### Docs
- `docs/roadmap.md` — ticked `.gitignore`, `README.md`, region, and bucket-name items; added Phase 0.5 (Python Lambda rewrite) between Phase 0 and Phase 1

---

## [0.0.1] — 2026-05-06

Initial scaffolding of the project. No runnable code yet — this release exists to anchor the documentation and make subsequent diffs meaningful.

### Docs
- Added `docs/claude.md` — persistent project context, architecture summary, conventions, and Claude's working agreement
- Added `docs/roadmap.md` — Phase 0 (bootstrap), Phase 1 (MVP pipeline), Phase 2 (admin dashboard), Phase 3 (hardening)
- Added `docs/changelog.md` — this file
- Imported `docs/project-architecture.pdf` — source-of-truth architecture diagram

### Decided
- **Lambda runtime:** Python 3.12
- **IaC:** Terraform (in `infra/`)
- **Frontend:** Vanilla HTML/CSS/JS, no framework, no bundler
- **Admin dashboard:** deferred to Phase 2 — MVP ships the upload → moderate → result pipeline first
- **Status thresholds:** `BLOCKED` ≥ 90% confidence on hard-block categories; `FLAGGED` ≥ 60% on any moderation label; `APPROVED` otherwise

### Notes
- No AWS resources provisioned yet
- No code written yet
- Next up: Phase 0 exit criteria (`README.md`, `.gitignore`, AWS profile, Terraform skeleton)

---

<!--
Template for future entries:

## [X.Y.Z] — YYYY-MM-DD

### Added
-

### Changed
-

### Fixed
-

### Infra
-

### Docs
-
-->

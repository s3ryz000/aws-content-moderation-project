# CI/CD Full Feature Design
**Date:** 2026-05-06
**Status:** Approved

---

## Overview

Complete the CI/CD pipeline in two sequential phases:

1. **Phase 0.5** — Rewrite all three Lambda handlers from Node.js to Python 3.12, add comprehensive unit tests
2. **Phase 3 (CI/CD)** — Update GitHub Actions workflows to lint, test, and validate against the Python codebase; add `workflow_dispatch` to deploy

---

## Part 1: Python Lambda Rewrite

### Directory structure

```
lambdas/
  get_upload_url/
    handler.py
    requirements.txt
  process_image/
    handler.py
    policy.py           # HARD_BLOCK_CATEGORIES + determine_status()
    requirements.txt
  get_moderation_result/
    handler.py
    requirements.txt
tests/
  conftest.py
  test_get_upload_url.py
  test_process_image.py
  test_get_moderation_result.py
lambda_archived/        # old Node.js handlers, renamed not deleted
```

### Handler contracts

Each file exports exactly one symbol: `lambda_handler(event: dict, context) -> dict`.

Pure logic (e.g. status decision) lives in sibling modules so it is testable without AWS calls.

### `lambdas/get_upload_url/handler.py`

- Parse body: require `filename` (string) and `contentType` (allowlist: `image/jpeg`, `image/png`, `image/gif`, `image/webp`)
- Return 400 on missing or disallowed fields
- Generate `imageKey = uploads/{uuid}.{ext}` from filename extension
- Generate presigned S3 PutObject URL, expiry 300 s, content-type-locked
- Return `{ uploadUrl, imageKey }` with CORS headers
- Handle OPTIONS preflight → 200

### `lambdas/process_image/handler.py` + `policy.py`

`policy.py` defines:
```python
HARD_BLOCK_CATEGORIES = {
    "Explicit Nudity", "Violence", "Visually Disturbing", "Hate Symbols"
}

def determine_status(labels: list[dict]) -> str:
    # BLOCKED   if any label.Confidence >= 90 AND label.ParentName in HARD_BLOCK_CATEGORIES
    # FLAGGED   elif any label.Confidence >= 60
    # APPROVED  otherwise
```

`handler.py`:
- Parse S3 event: extract `bucketName`, `imageKey`
- Call `rekognition.detect_moderation_labels(MinConfidence=50)`
- Call `policy.determine_status(labels)`
- Write `{imageKey, bucketName, status, moderationLabels (L of M), timestamp}` to DynamoDB
- Idempotent: PutItem overwrites on same key
- Re-raise on Rekognition or DynamoDB exceptions (Lambda retries)

### `lambdas/get_moderation_result/handler.py`

- Validate `imageKey` query param: required, non-empty, length ≤ 512
- DynamoDB GetItem by `imageKey`
- Return 404 `{ error: "Result not found" }` if item absent
- Return 200 `{ status, moderationLabels, timestamp }`
- Return 500 on DynamoDB exception
- Handle OPTIONS preflight → 200

### `requirements.txt` (each handler directory)

```
boto3==1.34.144
```

### Root-level dev requirements (`requirements-dev.txt`)

```
pytest==8.2.0
pytest-cov==5.0.0
moto[s3,dynamodb,rekognition]==5.0.9
ruff==0.4.4
black==24.4.2
```

---

## Part 2: Comprehensive Tests

### `tests/conftest.py`

Shared fixtures:
- `aws_credentials` — set dummy env vars so moto doesn't try real AWS
- `s3_bucket` — moto-mocked bucket `content-moderation-bucket-420`
- `dynamodb_table` — moto-mocked `image-moderation-results` table
- `s3_event(key)` — factory for standard S3 ObjectCreated event dict
- `apigw_event(method, qs, body)` — factory for API Gateway HTTP event dict

### `tests/test_get_upload_url.py`

| Test | Assertion |
|---|---|
| Valid jpeg filename | 200, `uploadUrl` present, `imageKey` starts with `uploads/` |
| Valid png, gif, webp | 200 each |
| Disallowed MIME type | 400 |
| Missing `contentType` | 400 |
| Missing `filename` | 400 |
| Malformed JSON body | 400 |
| OPTIONS preflight | 200, CORS headers present |
| `imageKey` uses UUID format | matches `uploads/<uuid>.<ext>` pattern |

### `tests/test_process_image.py`

**`policy.determine_status` (pure, no AWS)**

| Test | Assertion |
|---|---|
| No labels | `APPROVED` |
| Labels all < 60% confidence | `APPROVED` |
| Any label ≥ 60% | `FLAGGED` |
| Hard-block label ≥ 90% | `BLOCKED` |
| Hard-block label at 89% | `FLAGGED` (boundary) |
| Multiple labels, mixed — worst wins | `BLOCKED` if any qualify |
| Non-hard-block label at 95% | `FLAGGED` (not BLOCKED) |

**Full handler (moto)**

| Test | Assertion |
|---|---|
| Valid S3 event → Rekognition → DynamoDB write | Item present in table, status correct |
| Rekognition raises `ClientError` | Handler re-raises |
| Malformed S3 event (missing `Records`) | Raises `KeyError` or similar |
| `status=APPROVED` written with empty labels list | DynamoDB item has `moderationLabels = []` |

### `tests/test_get_moderation_result.py`

| Test | Assertion |
|---|---|
| Known `imageKey` in table | 200, `status`/`moderationLabels`/`timestamp` returned |
| Unknown `imageKey` | 404 |
| Missing `imageKey` param | 400 |
| Empty string `imageKey` | 400 |
| `imageKey` > 512 chars | 400 |
| DynamoDB raises `ClientError` | 500 |
| OPTIONS preflight | 200, CORS headers |
| `moderationLabels` stored as empty list | Returns `[]` not error |

Coverage gate: `pytest --cov=lambdas --cov-fail-under=80`

---

## Part 3: CI Workflow (`ci.yml`)

### Job graph

```
lint  →  [test, terraform-validate]  (parallel)
```

All three jobs are required status checks. PRs cannot merge until all pass.

### `lint` job

```yaml
- ruff check lambdas/ tests/
- black --check lambdas/ tests/
```

Fails fast (~10s) before spending runner minutes on tests or AWS auth.

### `test` job (needs: lint)

```yaml
- actions/setup-python@v5  (python 3.12)
- pip install -r requirements-dev.txt
- pytest tests/ --cov=lambdas --cov-fail-under=80
```

No AWS credentials needed — moto intercepts all boto3 calls.

### `terraform-validate` job (needs: lint)

```yaml
- hashicorp/setup-terraform@v3  (~> 1.6)
- aws-actions/configure-aws-credentials@v4  (OIDC)
- terraform fmt -check -recursive
- terraform init  (backend-config from vars)
- terraform validate
- terraform plan  (TF_VAR_frontend_origin=https://placeholder.example.com)
```

### Removed from current `ci.yml`

- `java-build` job — Java local dev server is not part of the deployment pipeline
- `lambda-build` zip job — packaging belongs in deploy only

### Branch protection (manual step, documented)

After workflow is pushed: Settings → Branches → Add rule for `main` → enable "Require status checks: lint, test, terraform-validate".

---

## Part 4: Deploy Workflow (`deploy.yml`)

### Changes from today

1. Add `workflow_dispatch` to `on:` block (manual trigger from GitHub Actions UI)
2. Update Lambda packaging: zip each `lambdas/<name>/` directory (handler + sibling modules) instead of `lambda/*.js`
3. No changes to Terraform apply or S3 frontend sync steps

### Lambda packaging (updated step)

```bash
for dir in lambdas/*/; do
  name=$(basename "$dir")
  zip -r "dist/${name}.zip" "$dir"
  echo "Packaged ${name}.zip"
done
```

Function names remain driven by GitHub Actions Variables:
- `LAMBDA_GET_UPLOAD_URL` → `dist/get_upload_url.zip`
- `LAMBDA_PROCESS_IMAGE` → `dist/process_image.zip`
- `LAMBDA_GET_RESULT` → `dist/get_moderation_result.zip`

---

## Sequence of Implementation

1. Rename `lambda/` → `lambda_archived/`
2. Create `lambdas/` with three Python handlers
3. Create `policy.py` in `process_image/`
4. Add `requirements.txt` per handler, `requirements-dev.txt` at root
5. Write `tests/conftest.py` and all three test files
6. Replace `ci.yml` with new lint-gate parallel design
7. Update `deploy.yml` (workflow_dispatch + Python packaging)
8. Update `docs/cicd.md` with branch protection instructions
9. Update `docs/roadmap.md` to mark Phase 0.5 items and Phase 3 CI/CD item
10. Update `docs/changelog.md`

---

## Open Questions (resolved)

- **Rollback strategy:** Fail loudly; manual `git revert` as documented in `docs/cicd.md`
- **Merge gating:** Hard block — all CI jobs required
- **Test depth:** Comprehensive (all paths including error injection and boundary conditions)
- **Java CI job:** Removed — not part of the deployment pipeline

# Phase 1.1 Terraform Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the full AWS backend (S3, DynamoDB, IAM, Lambda ×3, API Gateway) for the content-moderation MVP using Terraform.

**Architecture:** Six new files are added to `infra/`; no existing files are modified except `backend.tf` (adding `required_providers`). Lambda code is packaged at plan time via `archive_file` data sources pointing at `lambdas/`. All other infra is declarative HCL deployed in a single `terraform apply`.

**Tech Stack:** Terraform ≥ 1.6, hashicorp/aws ~> 5.0, hashicorp/archive ~> 2.0, AWS (ap-southeast-2)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `infra/backend.tf` | Add `required_providers` (aws + archive) |
| Create | `dist/.gitkeep` | Ensures the `dist/` directory exists so `archive_file` can write zips there |
| Create | `infra/s3.tf` | Private content bucket: versioning, SSE-S3, public-access block, CORS |
| Create | `infra/dynamodb.tf` | `image-moderation-results` table, on-demand, PK `imageKey` |
| Create | `infra/iam.tf` | Three IAM roles, least-privilege inline policies, CloudWatch log attachment |
| Create | `infra/lambda.tf` | Three Lambda functions, `archive_file` sources, S3 event notification, Lambda permissions |
| Create | `infra/api_gateway.tf` | HTTP API, two routes + integrations, `$default` stage, CORS, Lambda permissions |
| Create | `infra/outputs.tf` | `api_base_url`, `content_bucket`, `dynamodb_table_name`, `aws_region` |

---

## Task 1: Bootstrap — dist directory + provider versions + terraform init

**Files:**
- Create: `dist/.gitkeep`
- Modify: `infra/backend.tf`

- [ ] **Step 1: Create `dist/.gitkeep`**

Create an empty file at `dist/.gitkeep`. This directory is where `archive_file` will write the Lambda zips. The `.gitkeep` file makes git track the directory without tracking the generated zips (which are already in `.gitignore`).

```
dist/.gitkeep   ← empty file, no content
```

- [ ] **Step 2: Add `required_providers` to `infra/backend.tf`**

The current file only has `required_version`. Add `required_providers` so Terraform explicitly pins the AWS and Archive providers:

```hcl
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "cm-tfstate-737710549268"
    key            = "content-moderation/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "cm-tfstate-lock"
    encrypt        = true
  }
}
```

- [ ] **Step 3: Run `terraform init` to download providers**

```bash
terraform -chdir=infra init
```

Expected output ends with: `Terraform has been successfully initialized!`

If you see `Backend configuration changed` — answer `yes` to migrate state.

- [ ] **Step 4: Verify existing files pass `terraform fmt`**

```bash
terraform -chdir=infra fmt -check -recursive
```

Expected: no output (all files already formatted). If any files are listed, run `terraform -chdir=infra fmt -recursive` to fix them.

- [ ] **Step 5: Commit**

```bash
git add dist/.gitkeep infra/backend.tf
git commit -m "chore: add dist dir placeholder and pin Terraform provider versions"
```

---

## Task 2: S3 content bucket

**Files:**
- Create: `infra/s3.tf`

- [ ] **Step 1: Create `infra/s3.tf`**

```hcl
resource "aws_s3_bucket" "content" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "content" {
  bucket = aws_s3_bucket.content.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "content" {
  bucket = aws_s3_bucket.content.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "content" {
  bucket = aws_s3_bucket.content.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "content" {
  bucket = aws_s3_bucket.content.id

  cors_rule {
    allowed_headers = ["Content-Type"]
    allowed_methods = ["PUT"]
    allowed_origins = [var.frontend_origin]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/s3.tf
git commit -m "infra: add S3 content bucket with versioning, SSE, and CORS"
```

---

## Task 3: DynamoDB table

**Files:**
- Create: `infra/dynamodb.tf`

- [ ] **Step 1: Create `infra/dynamodb.tf`**

```hcl
resource "aws_dynamodb_table" "results" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "imageKey"

  attribute {
    name = "imageKey"
    type = "S"
  }
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/dynamodb.tf
git commit -m "infra: add DynamoDB image-moderation-results table"
```

---

## Task 4: IAM roles and policies

**Files:**
- Create: `infra/iam.tf`

- [ ] **Step 1: Create `infra/iam.tf`**

```hcl
# ── Shared assume-role policy ─────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ── cm-get-upload-url ─────────────────────────────────────────────────────────

resource "aws_iam_role" "get_upload_url" {
  name               = "cm-get-upload-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "get_upload_url" {
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/uploads/*"]
  }
}

resource "aws_iam_role_policy" "get_upload_url" {
  name   = "cm-get-upload-url-policy"
  role   = aws_iam_role.get_upload_url.id
  policy = data.aws_iam_policy_document.get_upload_url.json
}

resource "aws_iam_role_policy_attachment" "get_upload_url_logs" {
  role       = aws_iam_role.get_upload_url.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── cm-process-image ──────────────────────────────────────────────────────────

resource "aws_iam_role" "process_image" {
  name               = "cm-process-image-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "process_image" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["rekognition:DetectModerationLabels"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.results.arn]
  }
}

resource "aws_iam_role_policy" "process_image" {
  name   = "cm-process-image-policy"
  role   = aws_iam_role.process_image.id
  policy = data.aws_iam_policy_document.process_image.json
}

resource "aws_iam_role_policy_attachment" "process_image_logs" {
  role       = aws_iam_role.process_image.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── cm-get-moderation-result ──────────────────────────────────────────────────

resource "aws_iam_role" "get_moderation_result" {
  name               = "cm-get-moderation-result-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "get_moderation_result" {
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.results.arn]
  }
}

resource "aws_iam_role_policy" "get_moderation_result" {
  name   = "cm-get-moderation-result-policy"
  role   = aws_iam_role.get_moderation_result.id
  policy = data.aws_iam_policy_document.get_moderation_result.json
}

resource "aws_iam_role_policy_attachment" "get_moderation_result_logs" {
  role       = aws_iam_role.get_moderation_result.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/iam.tf
git commit -m "infra: add IAM roles and least-privilege policies for all three Lambdas"
```

---

## Task 5: Lambda functions and S3 event notification

**Files:**
- Create: `infra/lambda.tf`

- [ ] **Step 1: Create `infra/lambda.tf`**

```hcl
# ── Packaging ─────────────────────────────────────────────────────────────────

data "archive_file" "get_upload_url" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/get_upload_url"
  output_path = "${path.module}/../dist/get_upload_url.zip"
}

data "archive_file" "process_image" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/process_image"
  output_path = "${path.module}/../dist/process_image.zip"
}

data "archive_file" "get_moderation_result" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/get_moderation_result"
  output_path = "${path.module}/../dist/get_moderation_result.zip"
}

# ── Lambda functions ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "get_upload_url" {
  function_name    = "cm-get-upload-url"
  role             = aws_iam_role.get_upload_url.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.get_upload_url.output_path
  source_code_hash = data.archive_file.get_upload_url.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      BUCKET_NAME     = var.bucket_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}

resource "aws_lambda_function" "process_image" {
  function_name    = "cm-process-image"
  role             = aws_iam_role.process_image.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.process_image.output_path
  source_code_hash = data.archive_file.process_image.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE = var.table_name
    }
  }
}

resource "aws_lambda_function" "get_moderation_result" {
  function_name    = "cm-get-moderation-result"
  role             = aws_iam_role.get_moderation_result.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.get_moderation_result.output_path
  source_code_hash = data.archive_file.get_moderation_result.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}

# ── S3 event notification ─────────────────────────────────────────────────────

resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.process_image.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.content.arn
}

resource "aws_s3_bucket_notification" "content" {
  bucket = aws_s3_bucket.content.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_image.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
  }

  depends_on = [aws_lambda_permission.allow_s3]
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/lambda.tf
git commit -m "infra: add three Lambda functions with archive_file packaging and S3 event notification"
```

---

## Task 6: API Gateway HTTP API

**Files:**
- Create: `infra/api_gateway.tf`

- [ ] **Step 1: Create `infra/api_gateway.tf`**

```hcl
# ── HTTP API ──────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "cm-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.frontend_origin]
    allow_methods = ["POST", "GET", "OPTIONS"]
    allow_headers = ["Content-Type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

# ── Integrations ──────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "get_upload_url" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_upload_url.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "get_moderation_result" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_moderation_result.invoke_arn
  payload_format_version = "2.0"
}

# ── Routes ────────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "post_upload_url" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.get_upload_url.id}"
}

resource "aws_apigatewayv2_route" "get_moderation_result" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /get-moderation-result"
  target    = "integrations/${aws_apigatewayv2_integration.get_moderation_result.id}"
}

# ── Lambda permissions ────────────────────────────────────────────────────────

resource "aws_lambda_permission" "apigw_get_upload_url" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_get_moderation_result" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_moderation_result.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/api_gateway.tf
git commit -m "infra: add API Gateway HTTP API with two routes and CORS"
```

---

## Task 7: Outputs

**Files:**
- Create: `infra/outputs.tf`

- [ ] **Step 1: Create `infra/outputs.tf`**

```hcl
output "api_base_url" {
  description = "Base URL for the API Gateway HTTP API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "content_bucket" {
  description = "Name of the private S3 bucket for image uploads"
  value       = aws_s3_bucket.content.id
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table storing moderation results"
  value       = aws_dynamodb_table.results.name
}

output "aws_region" {
  description = "AWS region where resources are deployed"
  value       = "ap-southeast-2"
}
```

- [ ] **Step 2: Format and validate**

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Run `terraform plan` — review before applying**

```bash
terraform -chdir=infra plan
```

Expected: plan shows **~22 resources to add**, zero to change, zero to destroy. Review the list and confirm it includes:
- `aws_s3_bucket.content`
- `aws_dynamodb_table.results`
- `aws_iam_role.get_upload_url` / `process_image` / `get_moderation_result`
- `aws_iam_role_policy.*` × 3
- `aws_iam_role_policy_attachment.*` × 3
- `aws_lambda_function.get_upload_url` / `process_image` / `get_moderation_result`
- `aws_lambda_permission.allow_s3`
- `aws_lambda_permission.apigw_get_upload_url` / `apigw_get_moderation_result`
- `aws_s3_bucket_notification.content`
- `aws_apigatewayv2_api.main`
- `aws_apigatewayv2_stage.default`
- `aws_apigatewayv2_integration.get_upload_url` / `get_moderation_result`
- `aws_apigatewayv2_route.post_upload_url` / `get_moderation_result`

- [ ] **Step 4: Commit**

```bash
git add infra/outputs.tf
git commit -m "infra: add Terraform outputs for API URL, bucket, table, and region"
```

---

## Task 8: Apply and verify

- [ ] **Step 1: Apply**

```bash
terraform -chdir=infra apply
```

Type `yes` when prompted. Expected: `Apply complete! Resources: ~22 added, 0 changed, 0 destroyed.`

- [ ] **Step 2: Capture the API base URL**

```bash
terraform -chdir=infra output api_base_url
```

Expected: something like `https://abc123def.execute-api.ap-southeast-2.amazonaws.com`

Save this URL — you'll need it when wiring up the frontend in Phase 1.5.

- [ ] **Step 3: Verify the S3 bucket exists and is private**

```bash
aws s3 ls s3://content-moderation-bucket-420 --profile content-moderation
```

Expected: empty listing (no objects yet, no error). If you get `AccessDenied`, the public-access block is working correctly for public requests — test with your authenticated profile only.

- [ ] **Step 4: Verify DynamoDB table is ACTIVE**

```bash
aws dynamodb describe-table \
  --table-name image-moderation-results \
  --profile content-moderation \
  --query "Table.TableStatus"
```

Expected: `"ACTIVE"`

- [ ] **Step 5: Verify all three Lambda functions exist**

```bash
aws lambda list-functions \
  --profile content-moderation \
  --query "Functions[?starts_with(FunctionName, 'cm-')].FunctionName" \
  --output table
```

Expected:
```
cm-get-upload-url
cm-get-moderation-result
cm-process-image
```

- [ ] **Step 6: Smoke-test the upload-url endpoint**

Replace `<API_BASE_URL>` with the value from Step 2:

```bash
curl -s -X POST <API_BASE_URL>/upload-url \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.jpg","contentType":"image/jpeg"}' | python -m json.tool
```

Expected response:
```json
{
  "uploadUrl": "https://content-moderation-bucket-420.s3.ap-southeast-2.amazonaws.com/uploads/...",
  "imageKey": "uploads/<uuid>.jpg"
}
```

- [ ] **Step 7: Update `docs/roadmap.md` — mark Phase 1.1 items complete**

In Phase 1.1, change all `- [ ]` infrastructure items to `- [x]`:
```markdown
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
```

- [ ] **Step 8: Update `docs/changelog.md` — add Phase 1.1 entry**

Insert the following block between `## [Unreleased]` and `## [0.2.0]`:

```markdown
## [0.3.0] — 2026-05-06

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
```

- [ ] **Step 9: Commit**

```bash
git add docs/roadmap.md docs/changelog.md
git commit -m "docs: mark Phase 1.1 infrastructure complete in roadmap and changelog"
```

---

## Self-Review

**Spec coverage:**
- S3 bucket (private, versioning, SSE-S3) ✅ Task 2
- DynamoDB table (on-demand, PK `imageKey`) ✅ Task 3
- IAM roles (least-privilege, one per Lambda) ✅ Task 4
- Lambda ×3 (Python 3.12, correct timeouts, env vars) ✅ Task 5
- S3 event notification (`uploads/` prefix → `cm-process-image`) ✅ Task 5
- API Gateway HTTP API, two routes ✅ Task 6
- CORS for `http://localhost:8080` ✅ Task 6
- Outputs (`api_base_url`, `content_bucket`, `dynamodb_table_name`, `aws_region`) ✅ Task 7
- Verification steps ✅ Task 8

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N". All HCL blocks are complete.

**Type consistency:**
- `aws_s3_bucket.content` referenced in `lambda.tf` (`aws_s3_bucket.content.arn`) and `api_gateway.tf` — consistent
- `aws_dynamodb_table.results.arn` used in `iam.tf` — consistent with resource name in `dynamodb.tf`
- `aws_iam_role.<name>.arn` used in `lambda.tf` — matches role resource names in `iam.tf`
- `aws_lambda_function.<name>.function_name` / `.invoke_arn` / `.arn` used in `api_gateway.tf` and `lambda.tf` — consistent
- `aws_apigatewayv2_stage.default.invoke_url` used in `outputs.tf` — matches stage resource name in `api_gateway.tf`

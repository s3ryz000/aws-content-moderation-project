# Phase 1.1 Terraform Infrastructure Design
**Date:** 2026-05-06
**Status:** Approved

---

## Overview

Stand up the full AWS backend for the MVP content-moderation pipeline using Terraform. Six new files are added to `infra/`; no existing files are modified.

**In scope:** S3 content bucket, DynamoDB table, IAM roles, three Lambda functions, API Gateway HTTP API, S3 event notification, Terraform outputs.

**Out of scope:** Frontend deployment (already scaffolded in `frontend.tf`), admin dashboard, auth, CloudFront, TTL.

---

## Lambda Packaging

Each Lambda is packaged using an `archive_file` data source with `source_dir = "../lambdas/<name>"`. The directory contents (not the directory itself) are zipped, placing `handler.py` at the zip root. Output paths go to `../dist/<name>.zip` (gitignored). This mirrors what the deploy pipeline does, so a fresh `terraform apply` from any clone produces fully functional Lambda functions without a separate build step.

---

## File Map

| File | Responsibility |
|---|---|
| `infra/s3.tf` | Content bucket: private, versioning on, SSE-S3, public-access block, CORS for presigned PUT uploads |
| `infra/dynamodb.tf` | `image-moderation-results` table, on-demand billing, PK `imageKey` |
| `infra/iam.tf` | Three IAM roles + least-privilege inline policies + `AWSLambdaBasicExecutionRole` attachment |
| `infra/lambda.tf` | Three Lambda functions, `archive_file` data sources, S3 event notification, Lambda permissions |
| `infra/api_gateway.tf` | HTTP API, two routes, two Lambda integrations, `$default` stage with `auto_deploy`, CORS config, two Lambda permissions |
| `infra/outputs.tf` | `api_base_url`, `content_bucket`, `dynamodb_table_name`, `aws_region` |

---

## Storage

### S3 — `infra/s3.tf`

Resource: `aws_s3_bucket.content` — name from `var.bucket_name` (`content-moderation-bucket-420`).

Supporting resources:
- `aws_s3_bucket_versioning.content` — enabled
- `aws_s3_bucket_server_side_encryption_configuration.content` — SSE-S3 (`aws:s3`)
- `aws_s3_bucket_public_access_block.content` — all four flags `true`
- `aws_s3_bucket_cors_configuration.content` — `PUT` allowed from `var.frontend_origin` on `uploads/*`, exposes `ETag` header, max-age 3000 s

### DynamoDB — `infra/dynamodb.tf`

Resource: `aws_dynamodb_table.results` — name from `var.table_name` (`image-moderation-results`), billing mode `PAY_PER_REQUEST`, hash key `imageKey` (String).

---

## IAM — `infra/iam.tf`

Three roles, one per Lambda. Each role has:
1. An assume-role policy allowing `lambda.amazonaws.com` to assume it.
2. An inline policy with least-privilege permissions (see table).
3. `AWSLambdaBasicExecutionRole` managed policy attached for CloudWatch Logs.

| Role | Inline Policy Permissions |
|---|---|
| `cm-get-upload-url-role` | `s3:PutObject` on `arn:aws:s3:::content-moderation-bucket-420/uploads/*` |
| `cm-process-image-role` | `s3:GetObject` on bucket, `rekognition:DetectModerationLabels` (`*`), `dynamodb:PutItem` on table |
| `cm-get-moderation-result-role` | `dynamodb:GetItem` on table |

---

## Lambda — `infra/lambda.tf`

### Functions

| Terraform resource | Function name | Handler | Timeout | Memory |
|---|---|---|---|---|
| `aws_lambda_function.get_upload_url` | `cm-get-upload-url` | `handler.lambda_handler` | 10 s | 256 MB |
| `aws_lambda_function.process_image` | `cm-process-image` | `handler.lambda_handler` | 30 s | 256 MB |
| `aws_lambda_function.get_moderation_result` | `cm-get-moderation-result` | `handler.lambda_handler` | 10 s | 256 MB |

Runtime: `python3.12`. Each function references its corresponding IAM role and `archive_file` zip.

### Environment Variables

| Function | Variables |
|---|---|
| `cm-get-upload-url` | `BUCKET_NAME = var.bucket_name`, `FRONTEND_ORIGIN = var.frontend_origin` |
| `cm-process-image` | `DYNAMODB_TABLE = var.table_name` |
| `cm-get-moderation-result` | `DYNAMODB_TABLE = var.table_name`, `FRONTEND_ORIGIN = var.frontend_origin` |

### S3 Event Notification

`aws_s3_bucket_notification.content` on the content bucket: `s3:ObjectCreated:*` with prefix filter `uploads/` → `cm-process-image` Lambda ARN.

`aws_lambda_permission.allow_s3` grants `lambda:InvokeFunction` to `s3.amazonaws.com`, scoped to the content bucket ARN.

---

## API Gateway — `infra/api_gateway.tf`

`aws_apigatewayv2_api.main` — HTTP API, name `cm-api`.

### CORS (configured on the API)

- `allow_origins` — `[var.frontend_origin]`
- `allow_methods` — `["POST", "GET", "OPTIONS"]`
- `allow_headers` — `["Content-Type"]`
- `max_age` — `300`

### Stage

`aws_apigatewayv2_stage.default` — stage name `$default`, `auto_deploy = true`.

### Routes and Integrations

| Route key | Integration target | Terraform resource |
|---|---|---|
| `POST /upload-url` | `cm-get-upload-url` | `aws_apigatewayv2_integration.get_upload_url` |
| `GET /get-moderation-result` | `cm-get-moderation-result` | `aws_apigatewayv2_integration.get_moderation_result` |

Integration type: `AWS_PROXY`, payload format version `2.0`.

Two `aws_lambda_permission` resources grant `apigateway.amazonaws.com` invoke rights on both HTTP-triggered Lambdas.

---

## Outputs — `infra/outputs.tf`

| Output | Value |
|---|---|
| `api_base_url` | `aws_apigatewayv2_stage.default.invoke_url` |
| `content_bucket` | `aws_s3_bucket.content.id` |
| `dynamodb_table_name` | `aws_dynamodb_table.results.name` |
| `aws_region` | `"ap-southeast-2"` |

---

## Variables Used

All variables are already declared in `infra/variables.tf`:

| Variable | Default |
|---|---|
| `bucket_name` | `content-moderation-bucket-420` |
| `table_name` | `image-moderation-results` |
| `frontend_origin` | `http://localhost:8080` |

---

## Verification

After `terraform apply`:
1. `terraform output api_base_url` returns a valid `https://` URL.
2. `aws s3 ls s3://content-moderation-bucket-420` confirms bucket exists and is private.
3. `aws dynamodb describe-table --table-name image-moderation-results` confirms table is ACTIVE.
4. `aws lambda list-functions` shows all three `cm-` functions.
5. `curl -X POST <api_base_url>/upload-url -H "Content-Type: application/json" -d '{"filename":"test.jpg","contentType":"image/jpeg"}'` returns a presigned URL.

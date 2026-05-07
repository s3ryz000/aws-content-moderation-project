# AWS Content Moderation System

An image content moderation pipeline built on AWS. Users upload images via a web frontend; Amazon Rekognition scans them; the result (APPROVED / FLAGGED / BLOCKED) is stored in DynamoDB and displayed in the browser. Administrators can review flagged content and record manual decisions through a protected dashboard.

**Region:** `ap-southeast-2` (Sydney)

---

## Architecture

```
Browser → POST /upload-url → Lambda: get-upload-url → presigned S3 PUT URL
Browser → PUT image → S3 → s3:ObjectCreated → Lambda: process-image → Rekognition → DynamoDB
Browser → GET /get-moderation-result → Lambda: get-moderation-result → DynamoDB

Admin browser → Cognito Hosted UI login → JWT token
Admin browser → GET /admin/moderation → Lambda: list-moderation → DynamoDB (GSI)
Admin browser → POST /admin/moderation/{key}/decision → Lambda: decide-moderation → DynamoDB
```

---

## Tech Stack

| Layer       | Choice                                      |
|-------------|---------------------------------------------|
| Frontend    | Vanilla HTML / CSS / JS (no framework)      |
| API         | Amazon API Gateway (HTTP API)               |
| Compute     | AWS Lambda — Python 3.12                    |
| Moderation  | Amazon Rekognition `DetectModerationLabels` |
| Storage     | Amazon S3 (private, presigned-URL uploads)  |
| Database    | Amazon DynamoDB (on-demand)                 |
| Auth        | Amazon Cognito (Hosted UI, PKCE, JWT)       |
| IaC         | Terraform                                   |
| CI          | GitHub Actions (lint + test + tf-validate)  |

---

## Prerequisites

- [AWS CLI v2](https://awscli.amazonaws.com/AWSCLIV2.msi)
- [Terraform ≥ 1.6](https://developer.hashicorp.com/terraform/install)
- Python 3.12
- An AWS account with an IAM user that has PowerUserAccess + IAMFullAccess

---

## Setup

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

```powershell
python -m http.server 8080
```

| Page | URL |
|------|-----|
| Upload | `http://localhost:8080/frontend/` |
| Admin dashboard | `http://localhost:8080/frontend/admin/` |

The admin dashboard redirects to Cognito's login page automatically.

---

## Development

```powershell
# Install dev dependencies
pip install -r requirements-dev.txt

# Run tests
pytest tests/ -q

# Lint
ruff check lambdas/
```

---

## Project Structure

```
aws-content-moderation-project/
├── frontend/
│   ├── index.html / app.js / styles.css     ← Upload page
│   └── admin/
│       ├── index.html / admin.js / admin.css ← Admin dashboard
│       ├── auth.js                            ← PKCE token management
│       └── callback.html / callback.js        ← Cognito redirect handler
├── lambdas/
│   ├── get_upload_url/    ← Presigned S3 PUT URL
│   ├── process_image/     ← Rekognition scan → DynamoDB write
│   ├── get_moderation_result/ ← Poll result by imageKey
│   ├── list_moderation/   ← Admin: list with status filter
│   └── decide_moderation/ ← Admin: record manual decision
├── infra/                 ← Terraform (S3, DynamoDB, Lambda, API GW, Cognito, IAM)
├── tests/                 ← pytest unit tests (56 tests, moto for AWS mocking)
├── scripts/               ← Bootstrap + admin user creation
└── docs/                  ← Architecture, roadmap, changelog, specs, plans
```

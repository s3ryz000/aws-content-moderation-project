# CI/CD

Two GitHub Actions workflows run against this repo:

- **`ci.yml`** — runs on every PR to `main`: Terraform validate/plan, Java compile, Lambda zip
- **`deploy.yml`** — runs on every push to `main`: Terraform apply, Lambda deploy, S3 sync

Both authenticate to AWS via **GitHub OIDC** — no long-lived credentials stored in GitHub.

---

## One-time setup

### 1. GitHub OIDC provider in AWS

In the AWS console (IAM → Identity providers → Add provider):

- Provider type: OpenID Connect
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 2. IAM role

Create a role named `github-actions-content-moderation`.

**Trust policy** (replace `<owner>` with your GitHub username or org):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<owner>/aws-content-moderation-project:*"
        }
      }
    }
  ]
}
```

**Permissions**: attach a policy that mirrors the `content-moderation-dev` IAM user — S3, Lambda, API Gateway, DynamoDB, Rekognition, CloudWatch Logs, IAM PassRole, plus read/write access to the Terraform state bucket (`cm-tfstate-737710549268`) and lock table (`cm-tfstate-lock`).

### 3. GitHub Actions variables

Go to **Settings → Secrets and variables → Actions → Variables** and add:

| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-southeast-2` |
| `AWS_ROLE_ARN` | ARN of the role from step 2 |
| `TF_STATE_BUCKET` | `cm-tfstate-737710549268` |
| `TF_LOCK_TABLE` | `cm-tfstate-lock` |
| `FRONTEND_BUCKET` | set after first `terraform apply` (see output `frontend_bucket`) |
| `LAMBDA_GET_UPLOAD_URL` | Lambda function name for presigned URL generation |
| `LAMBDA_PROCESS_IMAGE` | Lambda function name for Rekognition processing |
| `LAMBDA_GET_RESULT` | Lambda function name for result polling |

`FRONTEND_BUCKET` can be populated after the first deploy runs — Terraform creates the bucket and outputs its name.

---

## Manual deploy

Add `workflow_dispatch` to trigger `deploy.yml` from the GitHub Actions UI without a code push. You can add it to the workflow `on:` block:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

Then trigger via **Actions → Deploy → Run workflow**.

---

## Rollback

Revert the commit on `main`:

```bash
git revert <commit-sha>
git push origin main
```

`deploy.yml` fires on the revert push. Terraform re-applies the previous state; Lambda code is redeployed from the reverted source.

---

## Prerequisites

The Terraform backend (S3 bucket + DynamoDB table) must exist before any workflow runs. It was bootstrapped with `scripts/aws-bootstrap.ps1`. If you need to recreate it, run that script locally with the `content-moderation` AWS profile.

CI workflows do **not** use `.env` files — all configuration comes from GitHub Actions Variables listed above.

---

## Branch protection (one-time setup)

After the CI workflow is pushed to `main`, enable required status checks so PRs cannot merge until all three jobs pass.

1. Go to **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Check **Require status checks to pass before merging**
4. Search for and add these three checks:
   - `Lint & Format`
   - `Unit Tests`
   - `Terraform Validate`
5. Check **Require branches to be up to date before merging**
6. Save

Once enabled, any PR with failing lint, failing tests, or failing Terraform validate will be blocked from merging.

# aws-bootstrap.ps1 - idempotent Phase 0 bootstrap for content-moderation project.
# Run after: aws configure --profile content-moderation

$profile      = "content-moderation"
$region       = "ap-southeast-2"
$uploadBucket = "content-moderation-bucket-420"

$acct = aws sts get-caller-identity --profile $profile --query Account --output text
if (-not $acct) {
    Write-Error "Cannot get caller identity. Run 'aws configure --profile content-moderation' first."
    exit 1
}
Write-Host "Account ID: $acct"
$tfBucket = "cm-tfstate-$acct"

# Write encryption JSON without BOM (PowerShell 5.1 Set-Content -Encoding utf8 adds BOM)
$encJson  = '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
$tmpEnc   = "$env:TEMP\cm-enc.json"
[System.IO.File]::WriteAllText($tmpEnc, $encJson)

function Apply-BucketGuardrails {
    param([string]$bucket)
    aws s3api put-public-access-block --bucket $bucket --profile $profile `
        --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    aws s3api put-bucket-versioning --bucket $bucket --profile $profile `
        --versioning-configuration Status=Enabled
    aws s3api put-bucket-encryption --bucket $bucket --profile $profile `
        --server-side-encryption-configuration "file://$tmpEnc"
    Write-Host "Guardrails applied to $bucket."
}

# Upload bucket
aws s3api head-bucket --bucket $uploadBucket --profile $profile 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Upload bucket $uploadBucket already exists - skipping create."
} else {
    Write-Host "Creating upload bucket $uploadBucket ..."
    aws s3api create-bucket --bucket $uploadBucket --region $region `
        --create-bucket-configuration LocationConstraint=$region --profile $profile
}
Apply-BucketGuardrails $uploadBucket

# Terraform state bucket
aws s3api head-bucket --bucket $tfBucket --profile $profile 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Terraform state bucket $tfBucket already exists - skipping create."
} else {
    Write-Host "Creating Terraform state bucket $tfBucket ..."
    aws s3api create-bucket --bucket $tfBucket --region $region `
        --create-bucket-configuration LocationConstraint=$region --profile $profile
}
Apply-BucketGuardrails $tfBucket

# DynamoDB lock table
$tableStatus = aws dynamodb describe-table --table-name cm-tfstate-lock `
    --region $region --profile $profile --query "Table.TableStatus" --output text 2>$null
if ($tableStatus -eq "ACTIVE") {
    Write-Host "DynamoDB lock table cm-tfstate-lock already exists - skipping create."
} else {
    Write-Host "Creating DynamoDB lock table cm-tfstate-lock ..."
    aws dynamodb create-table --table-name cm-tfstate-lock `
        --attribute-definitions AttributeName=LockID,AttributeType=S `
        --key-schema AttributeName=LockID,KeyType=HASH `
        --billing-mode PAY_PER_REQUEST --region $region --profile $profile
}

Remove-Item $tmpEnc -ErrorAction SilentlyContinue

# Patch backend.tf with real account ID
$backendFile = "$PSScriptRoot\..\infra\backend.tf"
$content = Get-Content $backendFile -Raw
if ($content -match "ACCOUNT_ID") {
    $content = $content -replace "ACCOUNT_ID", $acct
    [System.IO.File]::WriteAllText((Resolve-Path $backendFile).Path, $content)
    Write-Host "Patched infra/backend.tf with account ID $acct."
} else {
    Write-Host "infra/backend.tf already patched."
}

Write-Host ""
Write-Host "Bootstrap complete. Run 'cd infra; terraform init' to finish Phase 0."

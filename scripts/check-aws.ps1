# check-aws.ps1 — quick health check for content-moderation AWS resources.

$profile = "content-moderation"
$region  = "ap-southeast-2"
$uploadBucket = "content-moderation-bucket-420"
$ddbTable = "image-moderation-results"

Write-Host "=== Identity ===" -ForegroundColor Cyan
aws sts get-caller-identity --profile $profile

Write-Host "`n=== Upload bucket contents ===" -ForegroundColor Cyan
aws s3 ls "s3://$uploadBucket/" --recursive --profile $profile

Write-Host "`n=== DynamoDB table ===" -ForegroundColor Cyan
aws dynamodb describe-table --table-name $ddbTable --region $region --profile $profile 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "(table not yet created)" -ForegroundColor Yellow }

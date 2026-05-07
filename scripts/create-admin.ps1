<#
.SYNOPSIS
    Creates the first admin user in the Cognito user pool.
.EXAMPLE
    .\create-admin.ps1 -Username admin -Email you@example.com -TempPassword Temp1234!
#>
param(
    [Parameter(Mandatory)][string]$Username,
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$TempPassword
)

$poolId = (terraform -chdir="$PSScriptRoot\..\infra" output -raw cognito_user_pool_id 2>&1)
if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not read cognito_user_pool_id from terraform output. Run 'terraform apply' in infra/ first."
    exit 1
}

aws cognito-idp admin-create-user `
    --user-pool-id $poolId `
    --username $Username `
    --user-attributes Name=email,Value=$Email Name=email_verified,Value=true `
    --temporary-password $TempPassword `
    --message-action SUPPRESS `
    --profile content-moderation

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "User '$Username' created. They will be prompted to set a permanent password on first login via the Hosted UI."
} else {
    Write-Error "Failed to create user. See error above."
    exit 1
}

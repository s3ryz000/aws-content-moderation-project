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

output "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.admin.id
}

output "cognito_client_id" {
  description = "Cognito app client ID"
  value       = aws_cognito_user_pool_client.admin.id
}

output "cognito_domain" {
  description = "Cognito hosted UI base URL"
  value       = "https://${aws_cognito_user_pool_domain.admin.domain}.auth.ap-southeast-2.amazoncognito.com"
}

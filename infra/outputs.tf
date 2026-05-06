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

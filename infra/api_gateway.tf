# ── HTTP API ──────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "cm-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.frontend_origin]
    allow_methods = ["POST", "GET", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

# ── JWT authorizer ────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cm-cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.admin.id]
    issuer   = "https://cognito-idp.ap-southeast-2.amazonaws.com/${aws_cognito_user_pool.admin.id}"
  }
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
  statement_id  = "AllowAPIGatewayInvokeGetUploadUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_get_moderation_result" {
  statement_id  = "AllowAPIGatewayInvokeGetModerationResult"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_moderation_result.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "list_moderation" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_moderation.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "decide_moderation" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.decide_moderation.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_admin_moderation" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/moderation"
  target             = "integrations/${aws_apigatewayv2_integration.list_moderation.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "post_admin_decision" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/moderation/decision"
  target             = "integrations/${aws_apigatewayv2_integration.decide_moderation.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw_list_moderation" {
  statement_id  = "AllowAPIGatewayInvokeListModeration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_moderation.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_decide_moderation" {
  statement_id  = "AllowAPIGatewayInvokeDecideModeration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.decide_moderation.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

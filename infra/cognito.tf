data "aws_caller_identity" "current" {}

resource "aws_cognito_user_pool" "admin" {
  name = "cm-admin-pool"

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
    require_lowercase = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_client" "admin" {
  name         = "cm-admin-client"
  user_pool_id = aws_cognito_user_pool.admin.id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = ["http://localhost:8080/frontend/admin/callback.html"]
  logout_urls   = ["http://localhost:8080/frontend/"]

  supported_identity_providers = ["COGNITO"]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

resource "aws_cognito_user_pool_domain" "admin" {
  domain       = "cm-admin-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.admin.id
}

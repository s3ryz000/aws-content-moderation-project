# ── Packaging ─────────────────────────────────────────────────────────────────

data "archive_file" "get_upload_url" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/get_upload_url"
  output_path = "${path.module}/../dist/get_upload_url.zip"
}

data "archive_file" "process_image" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/process_image"
  output_path = "${path.module}/../dist/process_image.zip"
}

data "archive_file" "get_moderation_result" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/get_moderation_result"
  output_path = "${path.module}/../dist/get_moderation_result.zip"
}

# ── Lambda functions ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "get_upload_url" {
  function_name    = "cm-get-upload-url"
  role             = aws_iam_role.get_upload_url.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.get_upload_url.output_path
  source_code_hash = data.archive_file.get_upload_url.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      BUCKET_NAME     = var.bucket_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}

resource "aws_lambda_function" "process_image" {
  function_name    = "cm-process-image"
  role             = aws_iam_role.process_image.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.process_image.output_path
  source_code_hash = data.archive_file.process_image.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE = var.table_name
    }
  }
}

resource "aws_lambda_function" "get_moderation_result" {
  function_name    = "cm-get-moderation-result"
  role             = aws_iam_role.get_moderation_result.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.get_moderation_result.output_path
  source_code_hash = data.archive_file.get_moderation_result.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}

data "archive_file" "list_moderation" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/list_moderation"
  output_path = "${path.module}/../dist/list_moderation.zip"
}

data "archive_file" "decide_moderation" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/decide_moderation"
  output_path = "${path.module}/../dist/decide_moderation.zip"
}

resource "aws_lambda_function" "list_moderation" {
  function_name    = "cm-list-moderation"
  role             = aws_iam_role.list_moderation.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.list_moderation.output_path
  source_code_hash = data.archive_file.list_moderation.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
      BUCKET_NAME     = var.bucket_name
    }
  }
}

resource "aws_lambda_function" "decide_moderation" {
  function_name    = "cm-decide-moderation"
  role             = aws_iam_role.decide_moderation.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.decide_moderation.output_path
  source_code_hash = data.archive_file.decide_moderation.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}


# ── S3 event notification ─────────────────────────────────────────────────────

resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.process_image.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.content.arn
}

resource "aws_s3_bucket_notification" "content" {
  bucket = aws_s3_bucket.content.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_image.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
  }

  depends_on = [aws_lambda_permission.allow_s3]
}

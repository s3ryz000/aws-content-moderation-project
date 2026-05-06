# ── Shared assume-role policy ─────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ── cm-get-upload-url ─────────────────────────────────────────────────────────

resource "aws_iam_role" "get_upload_url" {
  name               = "cm-get-upload-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "get_upload_url" {
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/uploads/*"]
  }
}

resource "aws_iam_role_policy" "get_upload_url" {
  name   = "cm-get-upload-url-policy"
  role   = aws_iam_role.get_upload_url.id
  policy = data.aws_iam_policy_document.get_upload_url.json
}

resource "aws_iam_role_policy_attachment" "get_upload_url_logs" {
  role       = aws_iam_role.get_upload_url.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── cm-process-image ──────────────────────────────────────────────────────────

resource "aws_iam_role" "process_image" {
  name               = "cm-process-image-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "process_image" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["rekognition:DetectModerationLabels"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.results.arn]
  }
}

resource "aws_iam_role_policy" "process_image" {
  name   = "cm-process-image-policy"
  role   = aws_iam_role.process_image.id
  policy = data.aws_iam_policy_document.process_image.json
}

resource "aws_iam_role_policy_attachment" "process_image_logs" {
  role       = aws_iam_role.process_image.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── cm-get-moderation-result ──────────────────────────────────────────────────

resource "aws_iam_role" "get_moderation_result" {
  name               = "cm-get-moderation-result-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "get_moderation_result" {
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.results.arn]
  }
}

resource "aws_iam_role_policy" "get_moderation_result" {
  name   = "cm-get-moderation-result-policy"
  role   = aws_iam_role.get_moderation_result.id
  policy = data.aws_iam_policy_document.get_moderation_result.json
}

resource "aws_iam_role_policy_attachment" "get_moderation_result_logs" {
  role       = aws_iam_role.get_moderation_result.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_dynamodb_table" "results" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "imageKey"

  attribute {
    name = "imageKey"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  global_secondary_index {
    name            = "status-timestamp-index"
    hash_key        = "status"
    range_key       = "timestamp"
    projection_type = "ALL"
  }
}

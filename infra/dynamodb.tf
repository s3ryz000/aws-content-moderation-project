resource "aws_dynamodb_table" "results" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "imageKey"

  attribute {
    name = "imageKey"
    type = "S"
  }
}

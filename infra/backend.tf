terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.46"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "cm-tfstate-737710549268"
    key            = "content-moderation/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "cm-tfstate-lock"
    encrypt        = true
  }
}

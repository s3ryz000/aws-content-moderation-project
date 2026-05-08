provider "aws" {
  region  = "ap-southeast-2"
  profile = "content-moderation"
  default_tags {
    tags = {
      Project   = "content-moderation"
      ManagedBy = "terraform"
    }
  }
}

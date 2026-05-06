import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

import boto3

from policy import determine_status

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "image-moderation-results")

rekognition_client = boto3.client("rekognition")
dynamodb_client = boto3.client("dynamodb")


def lambda_handler(event: dict, context: Any) -> dict:
    for record in event["Records"]:
        bucket_name: str = record["s3"]["bucket"]["name"]
        raw_key: str = record["s3"]["object"]["key"]
        image_key: str = unquote(raw_key.replace("+", " "))

        response = rekognition_client.detect_moderation_labels(
            Image={"S3Object": {"Bucket": bucket_name, "Name": image_key}},
            MinConfidence=50,
        )

        labels: list[dict] = response.get("ModerationLabels", [])
        status = determine_status(labels)
        timestamp = datetime.now(timezone.utc).isoformat()

        dynamodb_client.put_item(
            TableName=DYNAMODB_TABLE,
            Item={
                "imageKey": {"S": image_key},
                "bucketName": {"S": bucket_name},
                "status": {"S": status},
                "moderationLabels": {
                    "L": [
                        {
                            "M": {
                                "Name": {"S": label.get("Name", "")},
                                "Confidence": {"N": str(label.get("Confidence", 0))},
                                "ParentName": {"S": label.get("ParentName", "")},
                            }
                        }
                        for label in labels
                    ]
                },
                "timestamp": {"S": timestamp},
            },
        )

    return {"statusCode": 200, "body": json.dumps({"message": "Processing complete"})}

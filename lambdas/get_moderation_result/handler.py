import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "image-moderation-results")
MAX_KEY_LENGTH = 512

CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("FRONTEND_ORIGIN", "http://localhost:8080"),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
}

dynamodb_client = boto3.client("dynamodb")


def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    qs: dict = event.get("queryStringParameters") or {}
    image_key: str | None = qs.get("imageKey")

    if not image_key:
        return _error(400, "Missing required parameter: imageKey")
    if len(image_key) > MAX_KEY_LENGTH:
        return _error(400, "imageKey exceeds maximum length")

    try:
        result = dynamodb_client.get_item(
            TableName=DYNAMODB_TABLE,
            Key={"imageKey": {"S": image_key}},
        )
    except ClientError:
        return _error(500, "Internal server error")

    item = result.get("Item")
    if not item:
        return _error(404, "Result not found")

    labels_raw: list = item.get("moderationLabels", {}).get("L", [])
    label_names = [entry.get("M", {}).get("Name", {}).get("S", "") for entry in labels_raw]

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(
            {
                "status": item["status"]["S"],
                "moderationLabels": label_names,
                "timestamp": item.get("timestamp", {}).get("S", ""),
            }
        ),
    }


def _error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }

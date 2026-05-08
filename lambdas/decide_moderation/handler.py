import json
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "image-moderation-results")
VALID_DECISIONS = {"APPROVED", "REJECTED"}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("FRONTEND_ORIGIN", "http://localhost:8080"),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

dynamodb_client = boto3.client("dynamodb")


def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        raw_body = event.get("body") or "{}"
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        return _error(400, "Invalid JSON body")

    image_key = body.get("imageKey")
    if not isinstance(image_key, str) or not image_key:
        return _error(400, "Missing or invalid imageKey in request body")

    decision: str | None = body.get("decision")
    if not decision or decision not in VALID_DECISIONS:
        return _error(400, "Invalid decision. Must be APPROVED or REJECTED")

    try:
        existing = dynamodb_client.get_item(
            TableName=DYNAMODB_TABLE,
            Key={"imageKey": {"S": image_key}},
        )
    except ClientError:
        return _error(500, "Internal server error")

    if not existing.get("Item"):
        return _error(404, "Not found")

    decision_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        dynamodb_client.update_item(
            TableName=DYNAMODB_TABLE,
            Key={"imageKey": {"S": image_key}},
            UpdateExpression="SET manualDecision = :d, decidedBy = :b, decisionTimestamp = :t",
            ExpressionAttributeValues={
                ":d": {"S": decision},
                ":b": {"S": "admin"},
                ":t": {"S": decision_timestamp},
            },
        )
    except ClientError:
        return _error(500, "Internal server error")

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(
            {
                "imageKey": image_key,
                "manualDecision": decision,
                "decisionTimestamp": decision_timestamp,
            }
        ),
    }


def _error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }

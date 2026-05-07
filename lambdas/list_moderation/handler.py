import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "image-moderation-results")
GSI_NAME = "status-timestamp-index"
VALID_STATUSES = {"APPROVED", "FLAGGED", "BLOCKED"}
DEFAULT_LIMIT = 100
MAX_LIMIT = 500

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

    status_filter: str | None = qs.get("status")
    if status_filter and status_filter not in VALID_STATUSES:
        return _error(400, "Invalid status. Must be one of: APPROVED, FLAGGED, BLOCKED")

    raw_limit = qs.get("limit")
    if raw_limit is not None:
        try:
            limit = int(raw_limit)
            if limit < 1:
                raise ValueError
        except ValueError:
            return _error(400, "limit must be a positive integer")
        limit = min(limit, MAX_LIMIT)
    else:
        limit = DEFAULT_LIMIT

    try:
        if status_filter:
            items = _query_by_status(status_filter, limit)
        else:
            items = _query_all(limit)
    except ClientError:
        return _error(500, "Internal server error")

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({"items": items, "count": len(items)}),
    }


def _query_by_status(status: str, limit: int) -> list[dict]:
    resp = dynamodb_client.query(
        TableName=DYNAMODB_TABLE,
        IndexName=GSI_NAME,
        KeyConditionExpression="#s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": {"S": status}},
        ScanIndexForward=False,
        Limit=limit,
    )
    return [_deserialize(item) for item in resp.get("Items", [])]


def _query_all(limit: int) -> list[dict]:
    all_items: list[dict] = []
    for status in VALID_STATUSES:
        resp = dynamodb_client.query(
            TableName=DYNAMODB_TABLE,
            IndexName=GSI_NAME,
            KeyConditionExpression="#s = :s",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": {"S": status}},
            ScanIndexForward=False,
            Limit=limit,
        )
        all_items.extend(_deserialize(item) for item in resp.get("Items", []))
    all_items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return all_items[:limit]


def _deserialize(item: dict) -> dict:
    out: dict = {
        "imageKey": item["imageKey"]["S"],
        "status": item["status"]["S"],
        "timestamp": item.get("timestamp", {}).get("S", ""),
        "moderationLabels": [
            {
                "Name": entry.get("M", {}).get("Name", {}).get("S", ""),
                "Confidence": float(entry.get("M", {}).get("Confidence", {}).get("N", "0")),
            }
            for entry in item.get("moderationLabels", {}).get("L", [])
        ],
    }
    if "manualDecision" in item:
        out["manualDecision"] = item["manualDecision"]["S"]
    if "decisionTimestamp" in item:
        out["decisionTimestamp"] = item["decisionTimestamp"]["S"]
    return out


def _error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }

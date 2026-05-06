import json
import os
import uuid
from typing import Any

import boto3

ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

BUCKET_NAME = os.environ.get("BUCKET_NAME", "content-moderation-bucket-420")
PRESIGN_EXPIRY = 300

CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("FRONTEND_ORIGIN", "http://localhost:8080"),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

s3_client = boto3.client("s3")


def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        data: dict = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Invalid JSON body")

    filename = data.get("filename")
    content_type = data.get("contentType")

    if not filename:
        return _error(400, "Missing required field: filename")
    if not content_type:
        return _error(400, "Missing required field: contentType")
    if content_type not in ALLOWED_CONTENT_TYPES:
        return _error(400, f"Unsupported contentType: {content_type}")

    ext = ALLOWED_CONTENT_TYPES[content_type]
    image_key = f"uploads/{uuid.uuid4()}.{ext}"

    upload_url: str = s3_client.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET_NAME, "Key": image_key, "ContentType": content_type},
        ExpiresIn=PRESIGN_EXPIRY,
    )

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({"uploadUrl": upload_url, "imageKey": image_key}),
    }


def _error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }

import json
import os

import pytest


@pytest.fixture(autouse=True)
def aws_credentials():
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "ap-southeast-2"
    os.environ.setdefault("BUCKET_NAME", "content-moderation-bucket-420")
    os.environ.setdefault("DYNAMODB_TABLE", "image-moderation-results")
    os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:8080")
    yield
    for key in [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_DEFAULT_REGION",
    ]:
        os.environ.pop(key, None)


def s3_event(bucket: str, key: str) -> dict:
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                }
            }
        ]
    }


def apigw_event(
    method: str = "GET",
    qs: dict = None,
    body: dict = None,
    path_params: dict = None,
) -> dict:
    return {
        "requestContext": {"http": {"method": method}},
        "queryStringParameters": qs,
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": path_params,
    }

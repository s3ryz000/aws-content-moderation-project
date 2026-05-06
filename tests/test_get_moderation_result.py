import importlib.util
import json
import os
import sys
from unittest.mock import patch

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from conftest import apigw_event

_LAMBDA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "get_moderation_result")
)
_spec = importlib.util.spec_from_file_location(
    "get_moderation_result_handler",
    os.path.join(_LAMBDA_DIR, "handler.py"),
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["get_moderation_result_handler"] = _mod
_spec.loader.exec_module(_mod)
lambda_handler = _mod.lambda_handler

TABLE_NAME = "image-moderation-results"


def _make_table(ddb):
    ddb.create_table(
        TableName=TABLE_NAME,
        KeySchema=[{"AttributeName": "imageKey", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "imageKey", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def _seed_item(ddb, image_key: str, status: str, labels: list[dict] = None):
    ddb.put_item(
        TableName=TABLE_NAME,
        Item={
            "imageKey": {"S": image_key},
            "bucketName": {"S": "content-moderation-bucket-420"},
            "status": {"S": status},
            "moderationLabels": {
                "L": [
                    {
                        "M": {
                            "Name": {"S": lbl.get("Name", "")},
                            "Confidence": {"N": str(lbl.get("Confidence", 0))},
                            "ParentName": {"S": lbl.get("ParentName", "")},
                        }
                    }
                    for lbl in (labels or [])
                ]
            },
            "timestamp": {"S": "2026-01-01T00:00:00+00:00"},
        },
    )


@mock_aws
def test_known_key_returns_200_with_status_and_timestamp():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/cat.jpg", "APPROVED")

    result = lambda_handler(apigw_event("GET", qs={"imageKey": "uploads/cat.jpg"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["status"] == "APPROVED"
    assert body["timestamp"] == "2026-01-01T00:00:00+00:00"


@mock_aws
def test_known_key_returns_label_names():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(
        ddb,
        "uploads/flag.jpg",
        "FLAGGED",
        [{"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}],
    )

    result = lambda_handler(apigw_event("GET", qs={"imageKey": "uploads/flag.jpg"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["moderationLabels"] == ["Suggestive"]


@mock_aws
def test_unknown_key_returns_404():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    result = lambda_handler(apigw_event("GET", qs={"imageKey": "uploads/missing.jpg"}), None)
    assert result["statusCode"] == 404


@mock_aws
def test_missing_image_key_param_returns_400():
    result = lambda_handler(apigw_event("GET"), None)
    assert result["statusCode"] == 400


@mock_aws
def test_empty_string_image_key_returns_400():
    result = lambda_handler(apigw_event("GET", qs={"imageKey": ""}), None)
    assert result["statusCode"] == 400


@mock_aws
def test_image_key_over_512_chars_returns_400():
    long_key = "uploads/" + "a" * 510
    result = lambda_handler(apigw_event("GET", qs={"imageKey": long_key}), None)
    assert result["statusCode"] == 400


@mock_aws
def test_empty_moderation_labels_returns_empty_list():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/clean.jpg", "APPROVED", [])

    result = lambda_handler(apigw_event("GET", qs={"imageKey": "uploads/clean.jpg"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["moderationLabels"] == []


@mock_aws
def test_options_preflight_returns_200_with_cors_headers():
    result = lambda_handler(apigw_event("OPTIONS"), None)
    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]


def test_dynamodb_error_returns_500():
    with patch.object(_mod, "dynamodb_client") as mock_ddb:
        mock_ddb.get_item.side_effect = ClientError(
            {"Error": {"Code": "InternalServerError", "Message": "error"}},
            "GetItem",
        )
        result = lambda_handler(apigw_event("GET", qs={"imageKey": "uploads/test.jpg"}), None)
    assert result["statusCode"] == 500

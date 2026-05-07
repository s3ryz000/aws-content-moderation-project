import importlib.util
import json
import os
import sys

import boto3
from conftest import apigw_event
from moto import mock_aws

_LAMBDA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "list_moderation")
)
_spec = importlib.util.spec_from_file_location(
    "list_moderation_handler",
    os.path.join(_LAMBDA_DIR, "handler.py"),
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["list_moderation_handler"] = _mod
_spec.loader.exec_module(_mod)
lambda_handler = _mod.lambda_handler

TABLE_NAME = "image-moderation-results"
GSI_NAME = "status-timestamp-index"


def _make_table(ddb):
    ddb.create_table(
        TableName=TABLE_NAME,
        KeySchema=[{"AttributeName": "imageKey", "KeyType": "HASH"}],
        AttributeDefinitions=[
            {"AttributeName": "imageKey", "AttributeType": "S"},
            {"AttributeName": "status", "AttributeType": "S"},
            {"AttributeName": "timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
        GlobalSecondaryIndexes=[
            {
                "IndexName": GSI_NAME,
                "KeySchema": [
                    {"AttributeName": "status", "KeyType": "HASH"},
                    {"AttributeName": "timestamp", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )


def _seed_item(ddb, image_key: str, status: str, timestamp: str = "2026-01-01T00:00:00Z"):
    ddb.put_item(
        TableName=TABLE_NAME,
        Item={
            "imageKey": {"S": image_key},
            "status": {"S": status},
            "timestamp": {"S": timestamp},
            "moderationLabels": {"L": []},
        },
    )


@mock_aws
def test_list_all_returns_items_from_all_statuses():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/a.png", "APPROVED", "2026-01-01T00:00:01Z")
    _seed_item(ddb, "uploads/b.png", "FLAGGED", "2026-01-01T00:00:02Z")
    _seed_item(ddb, "uploads/c.png", "BLOCKED", "2026-01-01T00:00:03Z")

    result = lambda_handler(apigw_event("GET"), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["count"] == 3
    statuses = {item["status"] for item in body["items"]}
    assert statuses == {"APPROVED", "FLAGGED", "BLOCKED"}


@mock_aws
def test_list_with_status_filter_returns_only_matching():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/a.png", "APPROVED")
    _seed_item(ddb, "uploads/b.png", "FLAGGED")

    result = lambda_handler(apigw_event("GET", qs={"status": "FLAGGED"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["count"] == 1
    assert body["items"][0]["status"] == "FLAGGED"
    assert body["items"][0]["imageKey"] == "uploads/b.png"


@mock_aws
def test_list_empty_table_returns_empty_items():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    result = lambda_handler(apigw_event("GET"), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["items"] == []
    assert body["count"] == 0


@mock_aws
def test_invalid_status_returns_400():
    result = lambda_handler(apigw_event("GET", qs={"status": "INVALID"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert "Invalid status" in body["error"]


@mock_aws
def test_invalid_limit_returns_400():
    result = lambda_handler(apigw_event("GET", qs={"limit": "abc"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert "limit" in body["error"]


@mock_aws
def test_limit_caps_results():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    for i in range(5):
        _seed_item(ddb, f"uploads/{i}.png", "APPROVED", f"2026-01-01T00:00:{i:02d}Z")

    result = lambda_handler(apigw_event("GET", qs={"limit": "2"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["count"] == 2


@mock_aws
def test_options_preflight_returns_200():
    result = lambda_handler(apigw_event("OPTIONS"), None)

    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]


@mock_aws
def test_items_include_manual_decision_when_present():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    ddb.put_item(
        TableName=TABLE_NAME,
        Item={
            "imageKey": {"S": "uploads/decided.png"},
            "status": {"S": "FLAGGED"},
            "timestamp": {"S": "2026-01-01T00:00:00Z"},
            "moderationLabels": {"L": []},
            "manualDecision": {"S": "APPROVED"},
            "decisionTimestamp": {"S": "2026-01-02T00:00:00Z"},
        },
    )

    result = lambda_handler(apigw_event("GET", qs={"status": "FLAGGED"}), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    item = body["items"][0]
    assert item["manualDecision"] == "APPROVED"
    assert item["decisionTimestamp"] == "2026-01-02T00:00:00Z"

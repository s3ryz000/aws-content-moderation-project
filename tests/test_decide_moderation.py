import importlib.util
import json
import os
import sys
from unittest.mock import patch

import boto3
from botocore.exceptions import ClientError
from conftest import apigw_event
from moto import mock_aws

_LAMBDA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "decide_moderation")
)
_spec = importlib.util.spec_from_file_location(
    "decide_moderation_handler",
    os.path.join(_LAMBDA_DIR, "handler.py"),
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["decide_moderation_handler"] = _mod
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


def _seed_item(ddb, image_key: str, status: str = "FLAGGED"):
    ddb.put_item(
        TableName=TABLE_NAME,
        Item={
            "imageKey": {"S": image_key},
            "status": {"S": status},
            "timestamp": {"S": "2026-01-01T00:00:00Z"},
            "moderationLabels": {"L": []},
        },
    )


@mock_aws
def test_approve_existing_item_returns_200():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/img.png")

    result = lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/img.png", "decision": "APPROVED"},
        ),
        None,
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["imageKey"] == "uploads/img.png"
    assert body["manualDecision"] == "APPROVED"
    assert "decisionTimestamp" in body


@mock_aws
def test_reject_existing_item_returns_200():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/img.png")

    result = lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/img.png", "decision": "REJECTED"},
        ),
        None,
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["manualDecision"] == "REJECTED"


@mock_aws
def test_decision_persists_in_dynamodb():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/img.png")

    lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/img.png", "decision": "APPROVED"},
        ),
        None,
    )

    item = ddb.get_item(TableName=TABLE_NAME, Key={"imageKey": {"S": "uploads/img.png"}})["Item"]
    assert item["manualDecision"]["S"] == "APPROVED"
    assert item["decidedBy"]["S"] == "admin"
    assert "decisionTimestamp" in item


@mock_aws
def test_original_status_not_overwritten():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)
    _seed_item(ddb, "uploads/img.png", status="FLAGGED")

    lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/img.png", "decision": "APPROVED"},
        ),
        None,
    )

    item = ddb.get_item(TableName=TABLE_NAME, Key={"imageKey": {"S": "uploads/img.png"}})["Item"]
    assert item["status"]["S"] == "FLAGGED"


@mock_aws
def test_missing_image_key_returns_404():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    result = lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/missing.png", "decision": "APPROVED"},
        ),
        None,
    )
    assert result["statusCode"] == 404


@mock_aws
def test_invalid_decision_returns_400():
    result = lambda_handler(
        apigw_event(
            "POST",
            body={"imageKey": "uploads/img.png", "decision": "MAYBE"},
        ),
        None,
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert "Invalid decision" in body["error"]


@mock_aws
def test_missing_decision_field_returns_400():
    result = lambda_handler(
        apigw_event("POST", body={"imageKey": "uploads/img.png"}),
        None,
    )
    assert result["statusCode"] == 400


@mock_aws
def test_missing_image_key_in_body_returns_400():
    result = lambda_handler(
        apigw_event("POST", body={"decision": "APPROVED"}),
        None,
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert "imageKey" in body["error"]


@mock_aws
def test_options_preflight_returns_200():
    result = lambda_handler(apigw_event("OPTIONS"), None)

    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]


def test_dynamodb_get_error_returns_500():
    with patch.object(_mod, "dynamodb_client") as mock_ddb:
        mock_ddb.get_item.side_effect = ClientError(
            {"Error": {"Code": "InternalServerError", "Message": "error"}},
            "GetItem",
        )
        result = lambda_handler(
            apigw_event(
                "POST",
                body={"imageKey": "uploads/img.png", "decision": "APPROVED"},
            ),
            None,
        )
    assert result["statusCode"] == 500

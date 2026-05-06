import importlib.util
import os
import sys
from unittest.mock import patch

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from conftest import s3_event

_PROCESS_IMAGE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "process_image")
)
if _PROCESS_IMAGE_DIR not in sys.path:
    sys.path.insert(0, _PROCESS_IMAGE_DIR)

_handler_spec = importlib.util.spec_from_file_location(
    "process_image_handler",
    os.path.join(_PROCESS_IMAGE_DIR, "handler.py"),
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)
sys.modules["process_image_handler"] = _handler_mod
_handler_spec.loader.exec_module(_handler_mod)
lambda_handler = _handler_mod.lambda_handler

TABLE_NAME = "image-moderation-results"
BUCKET = "content-moderation-bucket-420"


def _make_table(ddb):
    ddb.create_table(
        TableName=TABLE_NAME,
        KeySchema=[{"AttributeName": "imageKey", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "imageKey", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def _get_item(ddb, key: str) -> dict:
    return ddb.get_item(
        TableName=TABLE_NAME,
        Key={"imageKey": {"S": key}},
    ).get("Item", {})


@mock_aws
def test_approved_image_written_to_dynamodb():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {"ModerationLabels": []}
        lambda_handler(s3_event(BUCKET, "uploads/cat.jpg"), None)

    item = _get_item(ddb, "uploads/cat.jpg")
    assert item["status"]["S"] == "APPROVED"
    assert item["imageKey"]["S"] == "uploads/cat.jpg"
    assert item["bucketName"]["S"] == BUCKET
    assert "timestamp" in item


@mock_aws
def test_flagged_image_written_to_dynamodb():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {
            "ModerationLabels": [
                {"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}
            ]
        }
        lambda_handler(s3_event(BUCKET, "uploads/flag.jpg"), None)

    item = _get_item(ddb, "uploads/flag.jpg")
    assert item["status"]["S"] == "FLAGGED"


@mock_aws
def test_blocked_image_written_to_dynamodb():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {
            "ModerationLabels": [
                {"Name": "Violence", "Confidence": 95.0, "ParentName": "Violence"}
            ]
        }
        lambda_handler(s3_event(BUCKET, "uploads/block.jpg"), None)

    item = _get_item(ddb, "uploads/block.jpg")
    assert item["status"]["S"] == "BLOCKED"


@mock_aws
def test_approved_item_has_empty_moderation_labels():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {"ModerationLabels": []}
        lambda_handler(s3_event(BUCKET, "uploads/clean.jpg"), None)

    item = _get_item(ddb, "uploads/clean.jpg")
    assert item["moderationLabels"]["L"] == []


@mock_aws
def test_moderation_labels_persisted_in_dynamodb():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {
            "ModerationLabels": [
                {"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}
            ]
        }
        lambda_handler(s3_event(BUCKET, "uploads/img.jpg"), None)

    item = _get_item(ddb, "uploads/img.jpg")
    labels = item["moderationLabels"]["L"]
    assert len(labels) == 1
    assert labels[0]["M"]["Name"]["S"] == "Suggestive"


@mock_aws
def test_second_write_to_same_key_overwrites():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {"ModerationLabels": []}
        lambda_handler(s3_event(BUCKET, "uploads/same.jpg"), None)
        mock_rek.detect_moderation_labels.return_value = {
            "ModerationLabels": [
                {"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}
            ]
        }
        lambda_handler(s3_event(BUCKET, "uploads/same.jpg"), None)

    item = _get_item(ddb, "uploads/same.jpg")
    assert item["status"]["S"] == "FLAGGED"


def test_rekognition_error_reraises():
    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.side_effect = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "Access denied"}},
            "DetectModerationLabels",
        )
        with pytest.raises(ClientError):
            lambda_handler(s3_event(BUCKET, "uploads/test.jpg"), None)


def test_malformed_event_missing_records_raises():
    with pytest.raises(KeyError):
        lambda_handler({}, None)


@mock_aws
def test_url_encoded_key_is_decoded():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    with patch.object(_handler_mod, "rekognition_client") as mock_rek:
        mock_rek.detect_moderation_labels.return_value = {"ModerationLabels": []}
        event = s3_event(BUCKET, "uploads/my+photo.jpg")
        lambda_handler(event, None)

    item = _get_item(ddb, "uploads/my photo.jpg")
    assert item["imageKey"]["S"] == "uploads/my photo.jpg"

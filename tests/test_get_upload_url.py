import importlib.util
import json
import os
import re
import sys

import boto3
from conftest import apigw_event
from moto import mock_aws

_LAMBDA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "get_upload_url")
)
_spec = importlib.util.spec_from_file_location(
    "get_upload_url_handler",
    os.path.join(_LAMBDA_DIR, "handler.py"),
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["get_upload_url_handler"] = _mod
_spec.loader.exec_module(_mod)
lambda_handler = _mod.lambda_handler


def _make_bucket():
    s3 = boto3.client("s3", region_name="ap-southeast-2")
    s3.create_bucket(
        Bucket="content-moderation-bucket-420",
        CreateBucketConfiguration={"LocationConstraint": "ap-southeast-2"},
    )


@mock_aws
def test_valid_jpeg_returns_200_with_upload_url_and_image_key():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "photo.jpg", "contentType": "image/jpeg"})
    result = lambda_handler(event, None)
    body = json.loads(result["body"])
    assert result["statusCode"] == 200
    assert "uploadUrl" in body
    assert body["uploadUrl"].startswith("https://")
    assert body["imageKey"].startswith("uploads/")
    assert body["imageKey"].endswith(".jpg")


@mock_aws
def test_valid_png_returns_200():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "photo.png", "contentType": "image/png"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["imageKey"].endswith(".png")


@mock_aws
def test_valid_gif_returns_200():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "anim.gif", "contentType": "image/gif"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["imageKey"].endswith(".gif")


@mock_aws
def test_valid_webp_returns_200():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "img.webp", "contentType": "image/webp"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["imageKey"].endswith(".webp")


@mock_aws
def test_disallowed_mime_type_returns_400():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "file.pdf", "contentType": "application/pdf"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 400


@mock_aws
def test_missing_content_type_returns_400():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "photo.jpg"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 400


@mock_aws
def test_missing_filename_returns_400():
    _make_bucket()
    event = apigw_event("POST", body={"contentType": "image/jpeg"})
    result = lambda_handler(event, None)
    assert result["statusCode"] == 400


@mock_aws
def test_malformed_json_body_returns_400():
    _make_bucket()
    event = apigw_event("POST")
    event["body"] = "{not valid json"
    result = lambda_handler(event, None)
    assert result["statusCode"] == 400


@mock_aws
def test_options_preflight_returns_200_with_cors_headers():
    event = apigw_event("OPTIONS")
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]
    assert "Access-Control-Allow-Methods" in result["headers"]


@mock_aws
def test_image_key_uses_uuid_format():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "photo.jpg", "contentType": "image/jpeg"})
    result = lambda_handler(event, None)
    image_key = json.loads(result["body"])["imageKey"]
    uuid_pattern = r"^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$"
    assert re.match(uuid_pattern, image_key), f"imageKey did not match UUID pattern: {image_key}"


@mock_aws
def test_two_uploads_get_different_image_keys():
    _make_bucket()
    event = apigw_event("POST", body={"filename": "photo.jpg", "contentType": "image/jpeg"})
    r1 = lambda_handler(event, None)
    r2 = lambda_handler(event, None)
    key1 = json.loads(r1["body"])["imageKey"]
    key2 = json.loads(r2["body"])["imageKey"]
    assert key1 != key2

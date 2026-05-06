# CI/CD Full Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite three Node.js Lambda handlers to Python 3.12 with comprehensive tests, then update GitHub Actions CI/CD workflows to lint, test, and validate against the Python codebase.

**Architecture:** Each Lambda handler is a standalone Python 3.12 module in `lambdas/<name>/handler.py`, importing only `boto3` and stdlib. Status-decision logic lives in `lambdas/process_image/policy.py` (pure Python, no AWS calls) so it is trivially testable. Tests use `moto` to mock all AWS calls. CI runs lint → (test ∥ terraform-validate) with hard merge-blocking on `main`.

**Tech Stack:** Python 3.12, boto3, moto v5, pytest, ruff, black, GitHub Actions, Terraform ≥ 1.6, AWS OIDC

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lambdas/get_upload_url/handler.py` | Validate body, generate UUID key, return presigned S3 PUT URL |
| Create | `lambdas/get_upload_url/requirements.txt` | Pin boto3 |
| Create | `lambdas/process_image/handler.py` | Parse S3 event, call Rekognition, write DynamoDB |
| Create | `lambdas/process_image/policy.py` | `HARD_BLOCK_CATEGORIES` + `determine_status()` |
| Create | `lambdas/process_image/requirements.txt` | Pin boto3 |
| Create | `lambdas/get_moderation_result/handler.py` | Validate query param, read DynamoDB, return result |
| Create | `lambdas/get_moderation_result/requirements.txt` | Pin boto3 |
| Create | `requirements-dev.txt` | pytest, moto, ruff, black, pytest-cov |
| Create | `pyproject.toml` | pytest + coverage + ruff + black config |
| Create | `tests/conftest.py` | `aws_credentials` autouse fixture, `s3_event()` + `apigw_event()` helpers |
| Create | `tests/test_policy.py` | `determine_status()` unit tests (pure Python) |
| Create | `tests/test_get_upload_url.py` | get_upload_url handler tests (moto) |
| Create | `tests/test_process_image.py` | process_image handler integration tests (moto + unittest.mock) |
| Create | `tests/test_get_moderation_result.py` | get_moderation_result handler tests (moto + unittest.mock) |
| Rename | `lambda/` → `lambda_archived/` | Archive Node.js handlers, not deleted |
| Replace | `.github/workflows/ci.yml` | lint-gate → parallel test + terraform-validate |
| Modify | `.github/workflows/deploy.yml` | Add workflow_dispatch; Python Lambda packaging |
| Modify | `docs/cicd.md` | Add branch protection instructions |
| Modify | `docs/roadmap.md` | Mark Phase 0.5 + Phase 3 CI/CD items complete |
| Modify | `docs/changelog.md` | Document this release |

---

## Task 1: Archive Node.js and scaffold the Python project

**Files:**
- Rename: `lambda/` → `lambda_archived/`
- Create: `lambdas/get_upload_url/requirements.txt`
- Create: `lambdas/process_image/requirements.txt`
- Create: `lambdas/get_moderation_result/requirements.txt`
- Create: `requirements-dev.txt`
- Create: `pyproject.toml`

- [ ] **Step 1: Archive the Node.js directory**

```bash
git mv lambda lambda_archived
```

Expected: `lambda_archived/` now contains the three `.js` files; `lambda/` is gone.

- [ ] **Step 2: Create Lambda directory structure**

```bash
mkdir -p lambdas/get_upload_url lambdas/process_image lambdas/get_moderation_result tests
```

- [ ] **Step 3: Create per-handler requirements.txt (identical for all three)**

`lambdas/get_upload_url/requirements.txt`:
```
boto3==1.34.144
```

`lambdas/process_image/requirements.txt`:
```
boto3==1.34.144
```

`lambdas/get_moderation_result/requirements.txt`:
```
boto3==1.34.144
```

- [ ] **Step 4: Create root-level `requirements-dev.txt`**

```
pytest==8.2.0
pytest-cov==5.0.0
moto[s3,dynamodb,rekognition]==5.0.9
ruff==0.4.4
black==24.4.2
```

- [ ] **Step 5: Create `pyproject.toml`**

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.coverage.run]
source = ["lambdas"]

[tool.coverage.report]
omit = ["*/__pycache__/*"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I"]

[tool.black]
line-length = 100
target-version = ["py312"]
```

- [ ] **Step 6: Install dev dependencies**

```bash
pip install -r requirements-dev.txt
```

Expected: pytest, moto, ruff, black all install without errors.

- [ ] **Step 7: Commit**

```bash
git add lambdas/ requirements-dev.txt pyproject.toml
git commit -m "chore: archive Node.js lambdas, scaffold Python project structure"
```

---

## Task 2: `policy.py` + tests (TDD — pure Python, no AWS)

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_policy.py`
- Create: `lambdas/process_image/policy.py`

- [ ] **Step 1: Create `tests/conftest.py`**

```python
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


def apigw_event(method: str = "GET", qs: dict = None, body: dict = None) -> dict:
    return {
        "requestContext": {"http": {"method": method}},
        "queryStringParameters": qs,
        "body": json.dumps(body) if body is not None else None,
    }
```

- [ ] **Step 2: Write failing tests in `tests/test_policy.py`**

```python
import importlib.util
import os
import sys

_POLICY_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "lambdas", "process_image", "policy.py")
)
_spec = importlib.util.spec_from_file_location("policy", _POLICY_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["policy"] = _mod
_spec.loader.exec_module(_mod)

determine_status = _mod.determine_status
HARD_BLOCK_CATEGORIES = _mod.HARD_BLOCK_CATEGORIES


def test_no_labels_is_approved():
    assert determine_status([]) == "APPROVED"


def test_all_labels_below_60_is_approved():
    labels = [
        {"Name": "Suggestive", "Confidence": 55.0, "ParentName": "Suggestive"},
        {"Name": "Tobacco", "Confidence": 30.0, "ParentName": "Tobacco"},
    ]
    assert determine_status(labels) == "APPROVED"


def test_label_at_60_confidence_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 60.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_label_above_60_confidence_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_hard_block_label_at_90_is_blocked():
    labels = [{"Name": "Explicit Nudity", "Confidence": 90.0, "ParentName": "Explicit Nudity"}]
    assert determine_status(labels) == "BLOCKED"


def test_hard_block_label_at_89_is_flagged():
    labels = [{"Name": "Explicit Nudity", "Confidence": 89.9, "ParentName": "Explicit Nudity"}]
    assert determine_status(labels) == "FLAGGED"


def test_non_hard_block_label_at_95_is_flagged():
    labels = [{"Name": "Suggestive", "Confidence": 95.0, "ParentName": "Suggestive"}]
    assert determine_status(labels) == "FLAGGED"


def test_worst_case_wins_blocked_beats_flagged():
    labels = [
        {"Name": "Suggestive", "Confidence": 75.0, "ParentName": "Suggestive"},
        {"Name": "Violence", "Confidence": 92.0, "ParentName": "Violence"},
    ]
    assert determine_status(labels) == "BLOCKED"


def test_all_hard_block_categories_trigger_blocked():
    for category in HARD_BLOCK_CATEGORIES:
        labels = [{"Name": category, "Confidence": 95.0, "ParentName": category}]
        assert determine_status(labels) == "BLOCKED", f"Expected BLOCKED for {category}"


def test_hard_block_name_not_parent_is_flagged():
    labels = [{"Name": "Explicit Nudity", "Confidence": 95.0, "ParentName": "Other"}]
    assert determine_status(labels) == "FLAGGED"
```

- [ ] **Step 3: Run tests — confirm they fail (policy.py doesn't exist yet)**

```bash
pytest tests/test_policy.py -v
```

Expected: All tests ERROR with `FileNotFoundError` or `ModuleNotFoundError`. No tests pass.

- [ ] **Step 4: Create `lambdas/process_image/policy.py`**

```python
HARD_BLOCK_CATEGORIES = {
    "Explicit Nudity",
    "Violence",
    "Visually Disturbing",
    "Hate Symbols",
}

BLOCK_CONFIDENCE_THRESHOLD = 90.0
FLAG_CONFIDENCE_THRESHOLD = 60.0


def determine_status(labels: list[dict]) -> str:
    for label in labels:
        confidence = float(label.get("Confidence", 0))
        parent_name = label.get("ParentName", "")
        if confidence >= BLOCK_CONFIDENCE_THRESHOLD and parent_name in HARD_BLOCK_CATEGORIES:
            return "BLOCKED"

    for label in labels:
        if float(label.get("Confidence", 0)) >= FLAG_CONFIDENCE_THRESHOLD:
            return "FLAGGED"

    return "APPROVED"
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
pytest tests/test_policy.py -v
```

Expected: 10 tests PASSED.

- [ ] **Step 6: Commit**

```bash
git add lambdas/process_image/policy.py tests/conftest.py tests/test_policy.py
git commit -m "feat: add process_image policy module with determine_status logic"
```

---

## Task 3: `get_upload_url` handler + tests (TDD)

**Files:**
- Create: `tests/test_get_upload_url.py`
- Create: `lambdas/get_upload_url/handler.py`

- [ ] **Step 1: Write failing tests in `tests/test_get_upload_url.py`**

```python
import importlib.util
import json
import os
import re
import sys

import boto3
import pytest
from moto import mock_aws

from conftest import apigw_event

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
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pytest tests/test_get_upload_url.py -v
```

Expected: All tests ERROR — `handler.py` does not exist yet.

- [ ] **Step 3: Create `lambdas/get_upload_url/handler.py`**

```python
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
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
pytest tests/test_get_upload_url.py -v
```

Expected: 11 tests PASSED.

- [ ] **Step 5: Commit**

```bash
git add lambdas/get_upload_url/handler.py tests/test_get_upload_url.py
git commit -m "feat: add get_upload_url Python handler with presigned URL generation"
```

---

## Task 4: `process_image` handler + tests (TDD)

**Files:**
- Create: `tests/test_process_image.py`
- Create: `lambdas/process_image/handler.py`

- [ ] **Step 1: Write failing tests in `tests/test_process_image.py`**

```python
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

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
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pytest tests/test_process_image.py -v
```

Expected: All tests ERROR — `handler.py` does not exist yet.

- [ ] **Step 3: Create `lambdas/process_image/handler.py`**

```python
import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

import boto3

from policy import determine_status

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "image-moderation-results")

rekognition_client = boto3.client("rekognition")
dynamodb_client = boto3.client("dynamodb")


def lambda_handler(event: dict, context: Any) -> dict:
    for record in event["Records"]:
        bucket_name: str = record["s3"]["bucket"]["name"]
        raw_key: str = record["s3"]["object"]["key"]
        image_key: str = unquote(raw_key.replace("+", " "))

        response = rekognition_client.detect_moderation_labels(
            Image={"S3Object": {"Bucket": bucket_name, "Name": image_key}},
            MinConfidence=50,
        )

        labels: list[dict] = response.get("ModerationLabels", [])
        status = determine_status(labels)
        timestamp = datetime.now(timezone.utc).isoformat()

        dynamodb_client.put_item(
            TableName=DYNAMODB_TABLE,
            Item={
                "imageKey": {"S": image_key},
                "bucketName": {"S": bucket_name},
                "status": {"S": status},
                "moderationLabels": {
                    "L": [
                        {
                            "M": {
                                "Name": {"S": label.get("Name", "")},
                                "Confidence": {"N": str(label.get("Confidence", 0))},
                                "ParentName": {"S": label.get("ParentName", "")},
                            }
                        }
                        for label in labels
                    ]
                },
                "timestamp": {"S": timestamp},
            },
        )

    return {"statusCode": 200, "body": json.dumps({"message": "Processing complete"})}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
pytest tests/test_process_image.py -v
```

Expected: 9 tests PASSED.

- [ ] **Step 5: Commit**

```bash
git add lambdas/process_image/handler.py tests/test_process_image.py
git commit -m "feat: add process_image Python handler with Rekognition and DynamoDB integration"
```

---

## Task 5: `get_moderation_result` handler + tests (TDD)

**Files:**
- Create: `tests/test_get_moderation_result.py`
- Create: `lambdas/get_moderation_result/handler.py`

- [ ] **Step 1: Write failing tests in `tests/test_get_moderation_result.py`**

```python
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
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pytest tests/test_get_moderation_result.py -v
```

Expected: All tests ERROR — `handler.py` does not exist yet.

- [ ] **Step 3: Create `lambdas/get_moderation_result/handler.py`**

```python
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
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
pytest tests/test_get_moderation_result.py -v
```

Expected: 9 tests PASSED.

- [ ] **Step 5: Run the full test suite and verify coverage**

```bash
pytest tests/ --cov=lambdas --cov-report=term-missing --cov-fail-under=80 -v
```

Expected: All tests PASSED, coverage ≥ 80%.

- [ ] **Step 6: Commit**

```bash
git add lambdas/get_moderation_result/handler.py tests/test_get_moderation_result.py
git commit -m "feat: add get_moderation_result Python handler with DynamoDB polling"
```

---

## Task 6: Replace `ci.yml`

**Files:**
- Replace: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace `.github/workflows/ci.yml` with the new three-job workflow**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

permissions:
  id-token: write
  contents: read
  pull-requests: read

jobs:
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install linters
        run: pip install ruff==0.4.4 black==24.4.2

      - name: ruff check
        run: ruff check lambdas/ tests/

      - name: black check
        run: black --check lambdas/ tests/

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r requirements-dev.txt

      - name: Run tests with coverage
        run: pytest tests/ --cov=lambdas --cov-report=term-missing --cov-fail-under=80 -v

  terraform-validate:
    name: Terraform Validate
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~> 1.6"

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Terraform fmt
        working-directory: infra
        run: terraform fmt -check -recursive

      - name: Terraform init
        working-directory: infra
        run: |
          terraform init \
            -backend-config="bucket=${{ vars.TF_STATE_BUCKET }}" \
            -backend-config="dynamodb_table=${{ vars.TF_LOCK_TABLE }}" \
            -backend-config="region=${{ vars.AWS_REGION }}"

      - name: Terraform validate
        working-directory: infra
        run: terraform validate

      - name: Terraform plan
        working-directory: infra
        run: terraform plan -no-color
        env:
          TF_VAR_frontend_origin: "https://placeholder.example.com"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: replace java-based CI with lint-gate parallel Python test + terraform-validate"
```

---

## Task 7: Update `deploy.yml`

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add `workflow_dispatch` and update Lambda packaging in `deploy.yml`**

Change the `on:` block (lines 3–7) from:
```yaml
on:
  push:
    branches: [main]
```
to:
```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

Change the Lambda packaging step inside the `deploy-lambdas` job from:
```yaml
      - name: Package and deploy Lambda functions
        run: |
          mkdir -p dist

          zip -j dist/get-upload-url.zip    lambda/get-upload-url.js
          zip -j dist/process-image.zip     lambda/process-image.js
          zip -j dist/get-moderation-result.zip lambda/get-moderation-result.js

          deploy_lambda() {
            local fn_name="$1"
            local zip_path="$2"
            aws lambda update-function-code \
              --function-name "$fn_name" \
              --zip-file "fileb://${zip_path}" \
              --no-cli-pager
            aws lambda wait function-updated \
              --function-name "$fn_name"
            echo "Deployed ${fn_name}"
          }

          deploy_lambda "${{ vars.LAMBDA_GET_UPLOAD_URL }}"  dist/get-upload-url.zip
          deploy_lambda "${{ vars.LAMBDA_PROCESS_IMAGE }}"   dist/process-image.zip
          deploy_lambda "${{ vars.LAMBDA_GET_RESULT }}"      dist/get-moderation-result.zip
```
to:
```yaml
      - name: Package and deploy Lambda functions
        run: |
          mkdir -p dist

          zip -r dist/get_upload_url.zip    lambdas/get_upload_url/
          zip -r dist/process_image.zip     lambdas/process_image/
          zip -r dist/get_moderation_result.zip lambdas/get_moderation_result/

          deploy_lambda() {
            local fn_name="$1"
            local zip_path="$2"
            aws lambda update-function-code \
              --function-name "$fn_name" \
              --zip-file "fileb://${zip_path}" \
              --no-cli-pager
            aws lambda wait function-updated \
              --function-name "$fn_name"
            echo "Deployed ${fn_name}"
          }

          deploy_lambda "${{ vars.LAMBDA_GET_UPLOAD_URL }}"  dist/get_upload_url.zip
          deploy_lambda "${{ vars.LAMBDA_PROCESS_IMAGE }}"   dist/process_image.zip
          deploy_lambda "${{ vars.LAMBDA_GET_RESULT }}"      dist/get_moderation_result.zip
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add workflow_dispatch and update deploy to Python Lambda packaging"
```

---

## Task 8: Update docs

**Files:**
- Modify: `docs/cicd.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Add branch protection instructions to `docs/cicd.md`**

Append the following section to the end of `docs/cicd.md`:

```markdown
---

## Branch protection (one-time setup)

After the CI workflow is pushed to `main`, enable required status checks so PRs cannot merge until all three jobs pass.

1. Go to **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Check **Require status checks to pass before merging**
4. Search for and add these three checks:
   - `Lint & Format`
   - `Unit Tests`
   - `Terraform Validate`
5. Check **Require branches to be up to date before merging**
6. Save

Once enabled, any PR with failing lint, failing tests, or failing Terraform validate will be blocked from merging.
```

- [ ] **Step 2: Update `docs/roadmap.md` — mark Phase 0.5 and Phase 3 CI/CD items complete**

In Phase 0.5, change all `- [ ]` items to `- [x]`:
```markdown
- [x] Rewrite `lambda/get-upload-url.js` → `lambdas/get_upload_url/handler.py`
- [x] Rewrite `lambda/process-image.js` → `lambdas/process_image/handler.py` (+ `policy.py` for `HARD_BLOCK_CATEGORIES`)
- [x] Rewrite `lambda/get-moderation-result.js` → `lambdas/get_moderation_result/handler.py`
- [x] Add `requirements.txt` to each Lambda directory (`boto3` only — it is provided by the Lambda runtime but pin for local testing)
- [x] Confirm each handler signature: `lambda_handler(event: dict, context) -> dict` with type hints
```

In Phase 3, change the CI/CD line from `- [ ]` to `- [x]`:
```markdown
- [x] CI/CD: GitHub Actions running `ruff`, `pytest`, `terraform fmt -check`, `terraform validate` on PRs
```

- [ ] **Step 3: Add a new entry to `docs/changelog.md`**

Insert the following block between `## [Unreleased]` and `## [0.0.1]`:

```markdown
## [0.2.0] — 2026-05-06

### Added
- `lambdas/get_upload_url/handler.py` — Python 3.12 rewrite; validates MIME type allowlist, generates UUID-based `imageKey`, returns presigned S3 PutObject URL (300 s expiry)
- `lambdas/process_image/handler.py` — Python 3.12 rewrite; parses S3 event, calls Rekognition, writes result to DynamoDB; re-raises on AWS errors for Lambda retry
- `lambdas/process_image/policy.py` — `HARD_BLOCK_CATEGORIES` constant and `determine_status()` pure function; single auditable location for moderation thresholds
- `lambdas/get_moderation_result/handler.py` — Python 3.12 rewrite; validates `imageKey`, reads DynamoDB, returns `{ status, moderationLabels, timestamp }`
- `tests/` — 29 unit tests across four files (`test_policy.py`, `test_get_upload_url.py`, `test_process_image.py`, `test_get_moderation_result.py`); uses `moto` for AWS mocking, coverage ≥ 80%
- `requirements-dev.txt` — pinned dev toolchain (pytest, moto, ruff, black, pytest-cov)
- `pyproject.toml` — pytest, coverage, ruff, and black configuration

### Changed
- `.github/workflows/ci.yml` — replaced Java/zip build with lint-gate parallel pipeline: `lint` (ruff + black) → `test` (pytest + coverage) ∥ `terraform-validate`
- `.github/workflows/deploy.yml` — added `workflow_dispatch` trigger; updated Lambda packaging from Node.js zips to Python directory zips

### Removed
- `lambda/` Node.js handlers — archived to `lambda_archived/` (not deleted)

### Docs
- `docs/cicd.md` — added branch protection setup instructions
- `docs/roadmap.md` — marked Phase 0.5 (Python Lambda rewrite) and Phase 3 CI/CD item complete
```

- [ ] **Step 4: Commit**

```bash
git add docs/cicd.md docs/roadmap.md docs/changelog.md
git commit -m "docs: update cicd.md branch protection instructions, roadmap, and changelog for v0.2.0"
```

---

## Self-Review

**Spec coverage check:**
- Part 1 (Python Lambda rewrite): ✅ Tasks 1–5 cover all three handlers and policy.py
- Part 2 (Comprehensive tests): ✅ All test cases from the spec table are present in Tasks 2–5
  - `test_policy.py`: 10 tests covering all `determine_status` branches including boundary (89.9%)
  - `test_get_upload_url.py`: 11 tests including UUID format, unique keys, all 4 MIME types, all error paths
  - `test_process_image.py`: 9 tests including re-raise, URL decode, idempotency, label persistence
  - `test_get_moderation_result.py`: 9 tests including empty labels, >512 char key, ClientError injection
- Part 3 (CI workflow): ✅ Task 6 replaces `ci.yml` with lint-gate parallel design; Java job removed
- Part 4 (deploy workflow): ✅ Task 7 adds `workflow_dispatch` and Python packaging
- Branch protection: ✅ Documented in Task 8 (manual GitHub step, cannot be automated via workflow)
- Docs: ✅ Task 8 covers cicd.md, roadmap.md, changelog.md

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" — all code is explicit.

**Type consistency:**
- `determine_status(labels: list[dict]) -> str` — defined in Task 2, imported via `from policy import determine_status` in Task 4 handler — consistent
- `lambda_handler(event: dict, context: Any) -> dict` — identical signature across all three handlers
- `_error(status: int, message: str) -> dict` — defined in Task 3 and Task 5 handlers — consistent
- `s3_event(bucket, key)` / `apigw_event(method, qs, body)` — defined in Task 2 conftest, used identically across Tasks 3–5
- DynamoDB `moderationLabels` format: written as `L of M` in Task 4, read as `L of M` in Task 5 — consistent

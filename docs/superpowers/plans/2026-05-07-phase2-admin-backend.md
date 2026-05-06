# Phase 2.1 Admin Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two unauthenticated admin Lambda functions (`cm-list-moderation`, `cm-decide-moderation`) with API Gateway routes and DynamoDB GSI for status-filtered queries.

**Architecture:** Two new Python 3.12 Lambdas follow the exact same pattern as the existing three (module-level boto3 client, `lambda_handler`, `_error` helper, CORS headers). Terraform adds a GSI to the existing DynamoDB table, two IAM roles, two Lambda functions, and two API Gateway routes to the existing HTTP API. No new infrastructure primitives — only additions.

**Tech Stack:** Python 3.12, boto3, moto (tests), Terraform (AWS provider ~> 5.0, archive ~> 2.0)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `tests/conftest.py` | Add `path_params` kwarg to `apigw_event` |
| Create | `lambdas/list_moderation/handler.py` | List moderation results with optional status filter and limit |
| Create | `tests/test_list_moderation.py` | Unit tests for list_moderation handler |
| Create | `lambdas/decide_moderation/handler.py` | Record approve/reject decisions on existing items |
| Create | `tests/test_decide_moderation.py` | Unit tests for decide_moderation handler |
| Modify | `infra/dynamodb.tf` | Add `status-timestamp-index` GSI |
| Modify | `infra/iam.tf` | Add two new IAM roles with inline policies |
| Modify | `infra/lambda.tf` | Add two new Lambda functions and archive_file data sources |
| Modify | `infra/api_gateway.tf` | Add two integrations, two routes, two Lambda permissions |
| Modify | `docs/roadmap.md` | Mark Phase 2.1 items complete |
| Modify | `docs/changelog.md` | Add v0.6.0 entry |

---

### Task 1: Extend `conftest.py` with `path_params` support

The `apigw_event` helper in `tests/conftest.py` doesn't support path parameters yet. The decide handler reads `event["pathParameters"]["imageKey"]`. Add the kwarg now so tests in later tasks can use it.

**Files:**
- Modify: `tests/conftest.py`

- [ ] **Step 1: Add `path_params` kwarg to `apigw_event`**

Open `tests/conftest.py`. The current signature is:

```python
def apigw_event(method: str = "GET", qs: dict = None, body: dict = None) -> dict:
    return {
        "requestContext": {"http": {"method": method}},
        "queryStringParameters": qs,
        "body": json.dumps(body) if body is not None else None,
    }
```

Replace it with:

```python
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
```

- [ ] **Step 2: Verify existing tests still pass**

Run:
```
pytest tests/ -v --tb=short
```

Expected: all existing tests pass (the new `pathParameters` key with `None` value is ignored by existing handlers).

- [ ] **Step 3: Commit**

```bash
git add tests/conftest.py
git commit -m "test: add path_params kwarg to apigw_event helper"
```

---

### Task 2: TDD — `cm-list-moderation` handler

Write the tests first, run them to confirm they fail, then write the handler.

**Files:**
- Create: `tests/test_list_moderation.py`
- Create: `lambdas/list_moderation/handler.py`

- [ ] **Step 1: Create `tests/test_list_moderation.py`**

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```
pytest tests/test_list_moderation.py -v --tb=short
```

Expected: `ModuleNotFoundError` or `FileNotFoundError` — `handler.py` doesn't exist yet.

- [ ] **Step 3: Create `lambdas/list_moderation/handler.py`**

```python
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```
pytest tests/test_list_moderation.py -v
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Run full suite to check for regressions**

Run:
```
pytest tests/ -v --tb=short
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lambdas/list_moderation/handler.py tests/test_list_moderation.py
git commit -m "feat: add cm-list-moderation handler with GSI-based status filtering"
```

---

### Task 3: TDD — `cm-decide-moderation` handler

**Files:**
- Create: `tests/test_decide_moderation.py`
- Create: `lambdas/decide_moderation/handler.py`

- [ ] **Step 1: Create `tests/test_decide_moderation.py`**

```python
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
            body={"decision": "APPROVED"},
            path_params={"imageKey": "uploads/img.png"},
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
            body={"decision": "REJECTED"},
            path_params={"imageKey": "uploads/img.png"},
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
            body={"decision": "APPROVED"},
            path_params={"imageKey": "uploads/img.png"},
        ),
        None,
    )

    item = ddb.get_item(
        TableName=TABLE_NAME, Key={"imageKey": {"S": "uploads/img.png"}}
    )["Item"]
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
            body={"decision": "APPROVED"},
            path_params={"imageKey": "uploads/img.png"},
        ),
        None,
    )

    item = ddb.get_item(
        TableName=TABLE_NAME, Key={"imageKey": {"S": "uploads/img.png"}}
    )["Item"]
    assert item["status"]["S"] == "FLAGGED"


@mock_aws
def test_missing_image_key_returns_404():
    ddb = boto3.client("dynamodb", region_name="ap-southeast-2")
    _make_table(ddb)

    result = lambda_handler(
        apigw_event(
            "POST",
            body={"decision": "APPROVED"},
            path_params={"imageKey": "uploads/missing.png"},
        ),
        None,
    )
    assert result["statusCode"] == 404


@mock_aws
def test_invalid_decision_returns_400():
    result = lambda_handler(
        apigw_event(
            "POST",
            body={"decision": "MAYBE"},
            path_params={"imageKey": "uploads/img.png"},
        ),
        None,
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert "Invalid decision" in body["error"]


@mock_aws
def test_missing_decision_field_returns_400():
    result = lambda_handler(
        apigw_event("POST", body={}, path_params={"imageKey": "uploads/img.png"}),
        None,
    )
    assert result["statusCode"] == 400


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
                body={"decision": "APPROVED"},
                path_params={"imageKey": "uploads/img.png"},
            ),
            None,
        )
    assert result["statusCode"] == 500
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```
pytest tests/test_decide_moderation.py -v --tb=short
```

Expected: `ModuleNotFoundError` or `FileNotFoundError` — `handler.py` doesn't exist yet.

- [ ] **Step 3: Create `lambdas/decide_moderation/handler.py`**

```python
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

dynamodb_client = boto3.client("dynamodb")


def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    path_params: dict = event.get("pathParameters") or {}
    image_key: str | None = path_params.get("imageKey")
    if not image_key:
        return _error(400, "Missing imageKey path parameter")

    try:
        raw_body = event.get("body") or "{}"
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        return _error(400, "Invalid JSON body")

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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```
pytest tests/test_decide_moderation.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Run full suite with coverage**

Run:
```
pytest tests/ --cov=lambdas --cov-report=term-missing --cov-fail-under=80 -v
```

Expected: all tests pass, coverage ≥ 80%.

- [ ] **Step 6: Commit**

```bash
git add lambdas/decide_moderation/handler.py tests/test_decide_moderation.py
git commit -m "feat: add cm-decide-moderation handler for manual approve/reject decisions"
```

---

### Task 4: Terraform — DynamoDB GSI

Add the `status-timestamp-index` GSI to the existing table. DynamoDB requires that any attribute used in a GSI key be declared in the top-level `attribute` block.

**Files:**
- Modify: `infra/dynamodb.tf`

- [ ] **Step 1: Replace the contents of `infra/dynamodb.tf`**

```hcl
resource "aws_dynamodb_table" "results" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "imageKey"

  attribute {
    name = "imageKey"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  global_secondary_index {
    name            = "status-timestamp-index"
    hash_key        = "status"
    range_key       = "timestamp"
    projection_type = "ALL"
  }
}
```

- [ ] **Step 2: Run `terraform fmt` and `terraform validate`**

Run from the `infra/` directory:
```
terraform fmt
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/dynamodb.tf
git commit -m "infra: add status-timestamp-index GSI to DynamoDB table"
```

---

### Task 5: Terraform — IAM roles

Add two new roles following the exact same pattern as the existing three in `infra/iam.tf`.

**Files:**
- Modify: `infra/iam.tf`

- [ ] **Step 1: Append to `infra/iam.tf`**

Add the following block at the end of the file (after the existing `cm-get-moderation-result` section):

```hcl
# ── cm-list-moderation ────────────────────────────────────────────────────────

resource "aws_iam_role" "list_moderation" {
  name               = "cm-list-moderation-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "list_moderation" {
  statement {
    effect  = "Allow"
    actions = ["dynamodb:Query"]
    resources = [
      aws_dynamodb_table.results.arn,
      "${aws_dynamodb_table.results.arn}/index/status-timestamp-index",
    ]
  }
}

resource "aws_iam_role_policy" "list_moderation" {
  name   = "cm-list-moderation-policy"
  role   = aws_iam_role.list_moderation.id
  policy = data.aws_iam_policy_document.list_moderation.json
}

resource "aws_iam_role_policy_attachment" "list_moderation_logs" {
  role       = aws_iam_role.list_moderation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── cm-decide-moderation ──────────────────────────────────────────────────────

resource "aws_iam_role" "decide_moderation" {
  name               = "cm-decide-moderation-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "decide_moderation" {
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.results.arn]
  }
}

resource "aws_iam_role_policy" "decide_moderation" {
  name   = "cm-decide-moderation-policy"
  role   = aws_iam_role.decide_moderation.id
  policy = data.aws_iam_policy_document.decide_moderation.json
}

resource "aws_iam_role_policy_attachment" "decide_moderation_logs" {
  role       = aws_iam_role.decide_moderation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
```

- [ ] **Step 2: Run `terraform fmt` and `terraform validate`**

```
terraform fmt
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/iam.tf
git commit -m "infra: add IAM roles for cm-list-moderation and cm-decide-moderation"
```

---

### Task 6: Terraform — Lambda functions

Add two new Lambda functions and their `archive_file` data sources to `infra/lambda.tf`.

**Files:**
- Modify: `infra/lambda.tf`

- [ ] **Step 1: Append to `infra/lambda.tf`**

Add the following after the existing `data "archive_file" "get_moderation_result"` and `resource "aws_lambda_function" "get_moderation_result"` blocks, before the `# ── S3 event notification ──` section:

```hcl
data "archive_file" "list_moderation" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/list_moderation"
  output_path = "${path.module}/../dist/list_moderation.zip"
}

data "archive_file" "decide_moderation" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/decide_moderation"
  output_path = "${path.module}/../dist/decide_moderation.zip"
}

resource "aws_lambda_function" "list_moderation" {
  function_name    = "cm-list-moderation"
  role             = aws_iam_role.list_moderation.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.list_moderation.output_path
  source_code_hash = data.archive_file.list_moderation.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}

resource "aws_lambda_function" "decide_moderation" {
  function_name    = "cm-decide-moderation"
  role             = aws_iam_role.decide_moderation.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.decide_moderation.output_path
  source_code_hash = data.archive_file.decide_moderation.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE  = var.table_name
      FRONTEND_ORIGIN = var.frontend_origin
    }
  }
}
```

- [ ] **Step 2: Run `terraform fmt` and `terraform validate`**

```
terraform fmt
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/lambda.tf
git commit -m "infra: add Lambda functions for cm-list-moderation and cm-decide-moderation"
```

---

### Task 7: Terraform — API Gateway routes

Add integrations, routes, and Lambda invoke permissions for both new functions.

**Files:**
- Modify: `infra/api_gateway.tf`

- [ ] **Step 1: Append to `infra/api_gateway.tf`**

Add after the existing integrations, routes, and permissions sections:

```hcl
resource "aws_apigatewayv2_integration" "list_moderation" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_moderation.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "decide_moderation" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.decide_moderation.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_admin_moderation" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /admin/moderation"
  target    = "integrations/${aws_apigatewayv2_integration.list_moderation.id}"
}

resource "aws_apigatewayv2_route" "post_admin_decision" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /admin/moderation/{imageKey}/decision"
  target    = "integrations/${aws_apigatewayv2_integration.decide_moderation.id}"
}

resource "aws_lambda_permission" "apigw_list_moderation" {
  statement_id  = "AllowAPIGatewayInvokeListModeration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_moderation.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_decide_moderation" {
  statement_id  = "AllowAPIGatewayInvokeDecideModeration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.decide_moderation.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
```

- [ ] **Step 2: Run `terraform fmt` and `terraform validate`**

```
terraform fmt
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Run CI checks locally**

Run linting and tests to confirm everything is still clean before creating the PR:

```
ruff check lambdas/ tests/
python -m black --check lambdas/ tests/
pytest tests/ --cov=lambdas --cov-report=term-missing --cov-fail-under=80 -v
```

Expected: all pass, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add infra/api_gateway.tf
git commit -m "infra: add API Gateway routes for GET /admin/moderation and POST /admin/moderation/{imageKey}/decision"
```

---

### Task 8: Update roadmap and changelog

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Mark Phase 2.1 items complete in `docs/roadmap.md`**

In the `### 2.1 Backend additions` section, change:

```markdown
### 2.1 Backend additions
- [ ] New API Gateway routes (admin namespace):
  - `GET /admin/moderation` — list with filters (`status`, date range, limit)
  - `POST /admin/moderation/{imageKey}/decision` — manual override (approve / reject)
- [ ] DynamoDB GSI: `status-timestamp-index` for cheap status-filtered queries
- [ ] New Lambdas: `cm-list-moderation`, `cm-decide-moderation`
- [ ] Add `manualDecision` and `decidedBy` fields to the table; `process-image` never overwrites them
```

To:

```markdown
### 2.1 Backend additions
- [x] New API Gateway routes (admin namespace):
  - `GET /admin/moderation` — list with optional `status` filter and `limit` cap (default 100)
  - `POST /admin/moderation/{imageKey}/decision` — manual override (approve / reject)
- [x] DynamoDB GSI: `status-timestamp-index` for cheap status-filtered queries
- [x] New Lambdas: `cm-list-moderation`, `cm-decide-moderation`
- [x] `manualDecision`, `decidedBy`, `decisionTimestamp` fields; `process-image` never overwrites them
```

Also update the last-updated date at the bottom of `docs/roadmap.md` to `2026-05-07`.

- [ ] **Step 2: Add v0.6.0 entry to `docs/changelog.md`**

Insert the following block after `## [Unreleased]` and before `## [0.5.0]`:

```markdown
## [0.6.0] — 2026-05-07

### Added
- `lambdas/list_moderation/handler.py` — `GET /admin/moderation` Lambda; optional `status` filter (APPROVED/FLAGGED/BLOCKED), `limit` cap (default 100, max 500); queries `status-timestamp-index` GSI; returns `{ items, count }` sorted by timestamp descending
- `lambdas/decide_moderation/handler.py` — `POST /admin/moderation/{imageKey}/decision` Lambda; records `manualDecision` (APPROVED/REJECTED), `decidedBy="admin"`, `decisionTimestamp`; never overwrites original `status`
- `tests/test_list_moderation.py` — 8 unit tests (moto)
- `tests/test_decide_moderation.py` — 9 unit tests (moto)

### Infra
- `infra/dynamodb.tf` — added `status-timestamp-index` GSI (PK: status, SK: timestamp, projection: ALL)
- `infra/iam.tf` — two new least-privilege IAM roles (`cm-list-moderation-role`, `cm-decide-moderation-role`)
- `infra/lambda.tf` — two new Python 3.12 Lambda functions
- `infra/api_gateway.tf` — two new routes, integrations, and Lambda permissions on existing HTTP API

### Changed
- `tests/conftest.py` — added `path_params` kwarg to `apigw_event` helper
```

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md docs/changelog.md
git commit -m "docs: mark Phase 2.1 complete, add v0.6.0 changelog"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| GSI `status-timestamp-index` (PK: status, SK: timestamp, ALL projection) | Task 4 |
| `cm-list-moderation`: optional `status` + `limit` (default 100, max 500) | Task 2 |
| Query GSI when status given; query all three and merge when not | Task 2 |
| Return `{ items, count }` sorted by timestamp desc | Task 2 |
| 400 on invalid status | Task 2 (test + handler) |
| 400 on invalid limit | Task 2 (test + handler) |
| `cm-decide-moderation`: `decision` = APPROVED or REJECTED | Task 3 |
| 400 on invalid decision | Task 3 (test + handler) |
| 404 if imageKey not found | Task 3 (test + handler) |
| UpdateItem sets `manualDecision`, `decidedBy="admin"`, `decisionTimestamp` | Task 3 |
| Original `status` never overwritten | Task 3 (test + handler) |
| 200 response shape `{ imageKey, manualDecision, decisionTimestamp }` | Task 3 |
| Items in list response include `manualDecision`/`decisionTimestamp` when present | Task 2 |
| `cm-list-moderation-role` — `dynamodb:Query` on table + GSI ARN | Task 5 |
| `cm-decide-moderation-role` — `dynamodb:GetItem` + `dynamodb:UpdateItem` | Task 5 |
| Two Lambda functions (Python 3.12, 256 MB, 10s timeout) | Task 6 |
| Two API Gateway routes + integrations + Lambda permissions | Task 7 |
| Roadmap + changelog updated | Task 8 |

**Placeholder scan:** No TBDs, no vague steps. Every step has exact code or commands.

**Type consistency:** `_deserialize` in `list_moderation/handler.py` returns dicts with `imageKey`, `status`, `timestamp`, `moderationLabels` — tests assert these same keys. `decide_moderation/handler.py` response keys `imageKey`, `manualDecision`, `decisionTimestamp` match test assertions in Task 3. Consistent throughout.

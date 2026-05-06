# Phase 2.1 Backend Design — Admin Moderation API

## Goal

Add two unauthenticated admin API routes that let a frontend list moderation results and record manual approve/reject decisions, without touching the existing public pipeline.

## Architecture

Two new Lambda functions (`cm-list-moderation`, `cm-decide-moderation`) are added to the existing HTTP API Gateway. A GSI on the existing DynamoDB table enables efficient status-filtered queries. IAM roles follow the same least-privilege pattern as the three existing Lambdas.

## Components

### DynamoDB GSI

Add `status-timestamp-index` to the existing `image-moderation-results` table:

- Partition key: `status` (S)
- Sort key: `timestamp` (S)
- Projection: ALL
- Billing: on-demand (inherits from table)

### New Fields on Existing Items

`process_image` Lambda writes `status` and `timestamp` already. No changes needed there.

`cm-decide-moderation` adds three fields via `UpdateItem` (never overwrites existing fields):

- `manualDecision` (S) — `"APPROVED"` or `"REJECTED"`
- `decidedBy` (S) — hardcoded `"admin"` for now
- `decisionTimestamp` (S) — ISO 8601 UTC string

### Lambda: `cm-list-moderation`

**Path:** `lambdas/list_moderation/handler.py`

Query params:
- `status` (optional) — one of `APPROVED`, `FLAGGED`, `BLOCKED`
- `limit` (optional, integer) — default 100, max 500

Logic:
- If `status` given: query GSI with `KeyConditionExpression = status = :s`, `ScanIndexForward=False`, `Limit=limit`
- If no `status`: query all three statuses in parallel (three GSI queries), merge results, sort by `timestamp` descending, slice to `limit`
- Return `{ "items": [...], "count": N }`

Each item includes: `imageKey`, `status`, `timestamp`, `moderationLabels`, and (if present) `manualDecision`, `decisionTimestamp`.

Error responses:
- 400 if `status` param is provided but not one of the three valid values
- 400 if `limit` is not a positive integer

### Lambda: `cm-decide-moderation`

**Path:** `lambdas/decide_moderation/handler.py`

Route: `POST /admin/moderation/{imageKey}/decision`

The `imageKey` comes from the path parameter (URL-decoded).

Body: `{ "decision": "APPROVED" | "REJECTED" }`

Logic:
1. Validate `decision` is one of the two valid values — 400 otherwise
2. `GetItem` by `imageKey` — 404 if not found
3. `UpdateItem` setting `manualDecision`, `decidedBy="admin"`, `decisionTimestamp` (ISO 8601 UTC)
4. Return `{ "imageKey": ..., "manualDecision": ..., "decisionTimestamp": ... }`

### IAM Roles

- `cm-list-moderation-role` — `dynamodb:Query` on table and GSI ARN only
- `cm-decide-moderation-role` — `dynamodb:GetItem` + `dynamodb:UpdateItem` on table ARN only

Both get CloudWatch Logs (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`).

### API Gateway Routes

Added to existing `cm-api` HTTP API:

- `GET /admin/moderation` → `cm-list-moderation`
- `POST /admin/moderation/{imageKey}/decision` → `cm-decide-moderation`

No authorizer (unauthenticated, same as existing public routes). CORS already configured at API level.

## API Contracts

### GET /admin/moderation

**Request:**
```
GET /admin/moderation?status=FLAGGED&limit=50
```

**200 Response:**
```json
{
  "items": [
    {
      "imageKey": "uploads/abc.png",
      "status": "FLAGGED",
      "timestamp": "2026-05-07T10:00:00Z",
      "moderationLabels": [{"Name": "Suggestive", "Confidence": 72.3}],
      "manualDecision": "APPROVED",
      "decisionTimestamp": "2026-05-07T11:00:00Z"
    }
  ],
  "count": 1
}
```

**400 Response (invalid status):**
```json
{ "error": "Invalid status. Must be one of: APPROVED, FLAGGED, BLOCKED" }
```

### POST /admin/moderation/{imageKey}/decision

**Request:**
```
POST /admin/moderation/uploads%2Fabc.png/decision
Content-Type: application/json

{ "decision": "REJECTED" }
```

**200 Response:**
```json
{
  "imageKey": "uploads/abc.png",
  "manualDecision": "REJECTED",
  "decisionTimestamp": "2026-05-07T11:05:00Z"
}
```

**400 Response (invalid decision):**
```json
{ "error": "Invalid decision. Must be APPROVED or REJECTED" }
```

**404 Response:**
```json
{ "error": "Not found" }
```

## Testing

Four test files following the existing pattern (moto for AWS mocking, pytest):

- `tests/test_list_moderation.py` — happy path with status filter, happy path without filter, invalid status, invalid limit, empty result
- `tests/test_decide_moderation.py` — happy path APPROVED, happy path REJECTED, invalid decision value, imageKey not found

## Terraform Changes

- `infra/dynamodb.tf` — add GSI block to existing table
- `infra/iam.tf` — two new roles with inline policies
- `infra/lambda.tf` — two new `aws_lambda_function` resources + `archive_file` data sources
- `infra/api_gateway.tf` — two new routes + two new integrations

## What Is Not Changing

- Existing public routes (`POST /upload-url`, `GET /get-moderation-result`) — untouched
- `process_image` Lambda — untouched (it already writes `status` and `timestamp`)
- DynamoDB table name, primary key, existing items — untouched
- CI pipeline — no new test infrastructure needed (moto already in `requirements-dev.txt`)

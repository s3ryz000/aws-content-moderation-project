# Phase 2.2 Auth Implementation Design

## Goal

Protect `/admin/*` API routes with Cognito JWT auth and add a Hosted UI login flow to the admin dashboard.

## Architecture

Cognito user pool issues JWTs. API Gateway validates them via a JWT authorizer before forwarding requests to the admin Lambdas. The admin dashboard checks for a valid token on load; if missing or expired it redirects to Cognito's Hosted UI. After login, Cognito redirects back to a callback page that exchanges the auth code for tokens (PKCE), stores them in `localStorage`, and forwards to `index.html`.

**Auth flow:**
1. User visits `frontend/admin/index.html`
2. `auth.js` checks `localStorage` for a non-expired ID token
3. No valid token → redirect to Cognito Hosted UI
4. User authenticates on Cognito's page (handles forced password reset on first login automatically)
5. Cognito redirects to `frontend/admin/callback.html?code=...&state=...`
6. `callback.js` verifies the state param, POSTs code + PKCE verifier to Cognito token endpoint
7. Tokens (`idToken`, `accessToken`, `refreshToken`, `expiresAt`) stored in `localStorage`
8. Redirect to `index.html`
9. All `fetch` calls to `/admin/*` include `Authorization: Bearer {idToken}`
10. API Gateway JWT authorizer validates the token before invoking Lambdas

## Tech Stack

- Amazon Cognito (user pool, app client, hosted UI domain)
- API Gateway HTTP API JWT authorizer
- Vanilla JS (`auth.js`, `callback.js`) — no libraries
- AWS CLI (admin user creation script)
- Terraform (`infra/cognito.tf`)

---

## Infrastructure (`infra/cognito.tf`)

**User pool:**
- Name: `cm-admin-pool`
- Password policy: min 8 chars, require uppercase + number
- `allow_software_mfa_token = false` — no MFA for MVP
- Schema: standard `email` attribute, required

**App client:**
- Name: `cm-admin-client`
- No client secret (public client)
- Allowed flows: `code` (Authorization Code)
- Allowed scopes: `openid`, `email`, `profile`
- Callback URL: `http://localhost:8080/frontend/admin/callback.html`
- Logout URL: `http://localhost:8080/frontend/admin/index.html`
- PKCE required (`code_challenge_method = "S256"`)

**Domain:**
- `cm-admin-{aws_account_id}` prefix on `amazoncognito.com`
- Full URL: `https://cm-admin-{account_id}.auth.ap-southeast-2.amazoncognito.com`

**JWT authorizer (added to `infra/api_gateway.tf`):**
- Name: `cm-cognito-authorizer`
- Identity source: `$request.header.Authorization`
- Issuer: `https://cognito-idp.ap-southeast-2.amazonaws.com/{user_pool_id}`
- Audience: `[client_id]`
- Applied to: `GET /admin/moderation` and `POST /admin/moderation/{imageKey}/decision` routes only

**New outputs (`infra/outputs.tf`):**
- `cognito_user_pool_id`
- `cognito_client_id`
- `cognito_domain` (the full hosted UI base URL)

**New variable (`infra/variables.tf`):**
- `aws_account_id` — used in the Cognito domain prefix

---

## Script (`scripts/create-admin.ps1`)

Reads `cognito_user_pool_id` and `cognito_client_id` from `terraform output`, then:

```powershell
aws cognito-idp admin-create-user `
  --user-pool-id $poolId `
  --username $Username `
  --user-attributes Name=email,Value=$Email Name=email_verified,Value=true `
  --temporary-password $TempPassword `
  --message-action SUPPRESS `
  --profile content-moderation
```

Cognito forces a password change on first login via the Hosted UI. Script takes `-Username`, `-Email`, `-TempPassword` parameters. Errors if pool ID cannot be read from Terraform output.

---

## Frontend

### `frontend/admin/auth.js`

Exported functions:
- `getToken()` — returns `idToken` from `localStorage` if `expiresAt > Date.now()`, else `null`
- `getAuthHeader()` — returns `{ Authorization: 'Bearer ' + getToken() }` or throws if no token
- `redirectToLogin()` — generates PKCE code verifier + challenge, stores verifier in `sessionStorage`, builds Cognito authorize URL, sets `window.location.href`
- `logout()` — clears `localStorage`, redirects to Cognito logout URL
- `buildAuthorizeUrl(codeChallenge)` — returns the full Cognito Hosted UI URL with all required params
- Config constants: `COGNITO_DOMAIN`, `CLIENT_ID`, `REDIRECT_URI` — hardcoded (not env vars, no build step)

PKCE: `crypto.subtle.digest('SHA-256', ...)` + base64url encoding, both available natively in modern browsers.

### `frontend/admin/callback.html`

Minimal HTML page. Loads `callback.js`. Shows "Signing you in…" text while the exchange happens. Shows an error message if the exchange fails.

### `frontend/admin/callback.js`

On load:
1. Parse `code` and `state` from `window.location.search`
2. Verify `state` matches `sessionStorage.getItem('pkce_state')`
3. POST to `{COGNITO_DOMAIN}/oauth2/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`
4. Store `id_token`, `access_token`, `refresh_token`, `expires_in` (converted to `expiresAt = Date.now() + expires_in * 1000`) in `localStorage`
5. Clear `pkce_state` and `pkce_verifier` from `sessionStorage`
6. `window.location.replace('/frontend/admin/index.html')`

On error: show message in the page, do not redirect.

### `frontend/admin/index.html` changes

Add `<script src="auth.js"></script>` before `admin.js`.

### `frontend/admin/admin.js` changes

In `init()`:
```javascript
var token = getToken();
if (!token) { redirectToLogin(); return; }
```

In `loadResults()` and `recordDecision()`: add `Authorization: Bearer {token}` header to every `fetch` call. On 401 response: call `logout()` (token expired server-side).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No token on load | Redirect to Cognito Hosted UI |
| Token expired (local check) | Redirect to Cognito Hosted UI |
| 401 from API | Call `logout()` → redirect to login |
| Callback state mismatch | Show error on callback page, do not store tokens |
| Token exchange fails | Show error on callback page |

Refresh tokens are stored but not used for silent renewal in this phase — expired sessions require a fresh login. This is acceptable for an admin MVP.

---

## What Is Not In Scope

- Token refresh (silent renewal) — deferred to Phase 3
- MFA — not required for MVP
- Multiple admin users / groups (Cognito group check) — the JWT authorizer validates the token is valid for the pool; no group-level check is implemented (any pool member can access admin routes)
- User self-registration — disabled on the user pool

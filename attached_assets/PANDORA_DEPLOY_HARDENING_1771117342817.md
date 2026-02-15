# Pandora Deploy Hardening — Security Checklist + Agent Build Review

## Context

Pandora is deployed on Replit with a public URL. The Replit deploy settings show "Anyone on the internet with the URL" can access the app. Pandora stores OAuth tokens for customer CRM orgs (HubSpot, Salesforce), workspace API keys, and normalized CRM data across multiple customer workspaces. This document covers what needs to be locked down before any customer workspace goes live, and what to verify from the Replit Agent's recent Workbook Generator build.

---

## Part 1: Security Hardening Checklist

### Priority 1 — Do Before Any Customer Connects (Blockers)

#### 1.1 Authentication Layer

**Current state:** Unknown — need to verify if routes have auth middleware.

**Claude Code prompt:**

```
Audit the authentication layer across the entire application.

1. Read every route file in server/routes/ (or wherever routes are defined)
2. For each route, determine:
   - Does it have auth middleware applied?
   - What type of auth? (session, JWT, API key, workspace token, none)
   - Is workspace scoping enforced? (does the route verify the 
     authenticated user has access to the requested workspace?)

3. Create a table:

| Route | Method | Auth? | Type | Workspace Scoped? | Risk |
|-------|--------|-------|------|-------------------|------|

4. Flag every route that is:
   - Unauthenticated (no middleware)
   - Authenticated but not workspace-scoped (user A could access workspace B's data)
   - Using a weak auth mechanism (e.g., workspace ID in URL with no token check)

5. For any unauthenticated routes that SHOULD be authenticated, 
   add the auth middleware. Follow the pattern used by the majority 
   of existing routes.

6. Specifically check these high-risk endpoints:
   - GET /api/workspaces/:id/skills/:skillId/runs/:runId/export (NEW — from Agent build)
   - GET /api/workspaces/:id/agents/:agentId/runs/:runId/export (NEW — from Agent build)
   - POST /api/workspaces/:id/push/:entityType (Push API — if built)
   - GET /api/workspaces/:id/connectors/*/health
   - Any endpoint that returns connector_configs data
   - Any endpoint that triggers a sync
   - OAuth callback routes (these are intentionally unauthenticated 
     but must validate state parameter)

7. Report findings. Do NOT auto-fix OAuth callback routes — those 
   need careful review.
```

#### 1.2 Credential Encryption at Rest

**Current state:** The Command Center spec lists this as "DONE" but verify.

**Claude Code prompt:**

```
Verify credential encryption at rest is working correctly.

1. Read the connector_configs table schema and any encryption 
   utilities in the codebase (search for 'encrypt', 'decrypt', 
   'crypto', 'cipher', 'AES')

2. Check: are OAuth tokens (access_token, refresh_token) stored 
   encrypted or in plaintext?
   
   Run this query (read-only):
   SELECT id, workspace_id, source_type, 
          LEFT(credentials::text, 50) as creds_preview
   FROM connector_configs
   LIMIT 5;
   
   If you can read "Bearer ey..." or a plaintext refresh token, 
   encryption is NOT working.

3. If encryption exists, verify:
   - What algorithm? (AES-256-GCM is minimum)
   - Where is the encryption key stored? (env var, not in code or DB)
   - Is the key rotatable without re-encrypting everything?
   - Are there any code paths that write credentials without encrypting?
   - Search for all INSERT/UPDATE to connector_configs — every path 
     must go through the encryption layer

4. If encryption does NOT exist, build it:
   
   a. Create server/utils/credential-encryption.ts:
      - encrypt(plaintext: string): string — AES-256-GCM
      - decrypt(ciphertext: string): string
      - Key from process.env.CREDENTIAL_ENCRYPTION_KEY
      - Include IV in output (prepended to ciphertext)
   
   b. Create a migration that:
      - Reads all existing plaintext credentials
      - Encrypts them
      - Writes back encrypted versions
      - This is a one-time data migration
   
   c. Update every code path that reads/writes connector_configs 
      to use encrypt/decrypt
   
   d. Verify OAuth callback routes encrypt tokens before storing
   
   e. Verify token refresh flows encrypt the new token before storing

5. Report: encryption status, algorithm, key location, and any 
   gaps found.
```

#### 1.3 Replit Deploy Access Controls

**Manual steps (not Claude Code):**

- [ ] **Remove "Made with Replit" badge** — Settings → uncheck badge. Non-negotiable for customer-facing deployment.
- [ ] **Disable feedback widget** — Don't want customers seeing a Replit feedback widget on what's supposed to be a standalone product.
- [ ] **Check if Replit supports access restrictions** — Can you password-protect the deploy, or restrict by IP/domain? If not, the auth middleware (1.1) is the only protection layer. Document this limitation.
- [ ] **Custom domain** — Set up a custom domain (e.g., app.pandora-revops.com) before customer onboarding. A `*.replit.app` URL signals "prototype."
- [ ] **Environment variables** — Verify all secrets are in Replit Secrets, not in `.env` files that could be exposed. Check: `CREDENTIAL_ENCRYPTION_KEY`, `SALESFORCE_CLIENT_SECRET`, `HUBSPOT_CLIENT_SECRET`, all API keys.

#### 1.4 CORS Configuration

**Claude Code prompt:**

```
Audit CORS configuration.

1. Find where CORS is configured (search for 'cors', 'Access-Control', 
   'origin' in server code)

2. Check: is the CORS origin set to '*' (allow all)?
   If yes, this means any website on the internet can make API calls 
   to Pandora from a browser. Fix:
   
   - Set origin to the specific Pandora domain(s)
   - Allow the Replit preview domain during development
   - Allow the custom domain for production
   
3. Check: does CORS allow credentials? If yes, the origin CANNOT be '*'.
   
4. Check: are sensitive headers exposed? (Don't expose Authorization 
   headers in Access-Control-Expose-Headers)

5. Report current configuration and any fixes applied.
```

#### 1.5 Rate Limiting

**Claude Code prompt:**

```
Add rate limiting to the API if not already present.

1. Check if express-rate-limit or similar is installed and configured.

2. If not, add it:

   npm install express-rate-limit

   Apply three tiers:

   a. Global: 100 requests per minute per IP
      (prevents brute force and DoS)

   b. Auth endpoints: 10 requests per minute per IP
      (prevents credential stuffing on OAuth flows)

   c. Sync/skill triggers: 5 requests per minute per workspace
      (prevents accidental sync storms)

   d. Export endpoints: 10 requests per minute per workspace
      (prevents automated scraping of skill evidence)

3. Apply to the Express app BEFORE route registration.

4. Return 429 with Retry-After header on limit exceeded.
```

---

### Priority 2 — Do Before Scaling Beyond Dogfood (Important)

#### 2.1 Workspace Isolation Audit

```
Verify multi-tenant isolation is airtight.

1. For every SQL query in the codebase that touches normalized 
   entity tables (deals, contacts, accounts, activities, 
   conversations, skill_runs, agent_runs, findings):
   
   - Does it include WHERE workspace_id = $workspaceId?
   - Is workspace_id from the authenticated session, NOT from 
     the URL parameter alone? (URL params can be spoofed)

2. Search for any queries that:
   - Join across workspaces
   - Aggregate without workspace filter
   - Use workspace_id from req.params without validating against 
     the authenticated user's workspace access

3. Check the export endpoints specifically:
   - GET .../skills/:skillId/runs/:runId/export
   - Can user A download user B's skill run export by guessing the runId?
   - The query should join skill_runs to workspaces and verify access.

4. Report any queries missing workspace_id filters.
```

#### 2.2 SQL Injection Review

```
Audit for SQL injection vulnerabilities.

1. Search for string interpolation in SQL queries:
   - Template literals with ${variable} inside SQL strings
   - String concatenation with + in SQL strings
   - Any raw .query() call where user input is concatenated

2. Every user-controlled value (from req.params, req.query, req.body) 
   must be parameterized ($1, $2, etc.) not interpolated.

3. Pay special attention to:
   - Filter/search endpoints that build dynamic WHERE clauses
   - Sort endpoints that accept column names (SQL injection via ORDER BY)
   - The new export endpoints
   - Any endpoint that accepts date ranges or text search terms

4. Fix any interpolated queries by converting to parameterized queries.

5. For dynamic column names in ORDER BY (which can't be parameterized), 
   use an allowlist:
   
   const ALLOWED_SORT_COLUMNS = ['created_at', 'amount', 'name', 'stage'];
   const sortBy = ALLOWED_SORT_COLUMNS.includes(req.query.sort) 
     ? req.query.sort : 'created_at';
```

#### 2.3 Secret Rotation Plan

Document how to rotate each secret without downtime:

| Secret | Location | Rotation Method |
|---|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Replit Secrets | Re-encrypt all credentials with new key. Requires migration script. |
| `SALESFORCE_CLIENT_SECRET` | Replit Secrets | Generate new in Salesforce Connected App. Update env var. All existing refresh tokens continue working. |
| `HUBSPOT_CLIENT_SECRET` | Replit Secrets | Generate new in HubSpot Developer Portal. Update env var. |
| Workspace push API keys | `workspaces.push_api_key` | Generate new key, invalidate old. Notify customer. |
| Slack webhook URLs | `connector_configs` | Customer regenerates in Slack, updates Pandora config. |
| LLM API keys (Anthropic, Fireworks) | Replit Secrets | Rotate in provider dashboard, update env var. Zero downtime. |

#### 2.4 Logging & Audit Trail

```
Verify security-relevant actions are logged.

1. Check that these events produce log entries:
   - OAuth connection established (which workspace, which CRM)
   - OAuth token refresh (success/failure)
   - Sync triggered (who triggered, workspace, connector)
   - Skill run triggered (who triggered, workspace, skill)
   - Export downloaded (who downloaded, workspace, skill/agent run)
   - Failed auth attempts (wrong token, expired session)
   - Rate limit exceeded

2. Check that logs do NOT contain:
   - Access tokens or refresh tokens (even partial)
   - Full API keys
   - Customer email contents
   - Raw CRM credentials
   
   Search logs for patterns: 'Bearer', 'ey' (JWT prefix), 
   'refresh_token', 'access_token', 'api_key', 'password'

3. If sensitive data is logged, add redaction:
   
   function redactSensitive(obj: any): any {
     const sensitiveKeys = ['access_token', 'refresh_token', 
       'api_key', 'password', 'secret', 'credentials'];
     // Replace values with '[REDACTED]'
   }
```

---

### Priority 3 — Do Before Public Launch (Nice to Have for Dogfood)

#### 3.1 HTTPS Verification

Replit deployments should be HTTPS by default. Verify:
- [ ] All OAuth callback URLs use `https://`
- [ ] No hardcoded `http://` URLs in the codebase for production paths
- [ ] Slack webhook URLs use `https://`

#### 3.2 Content Security Policy

```
Add CSP headers to prevent XSS if the Command Center UI is served 
from the same Express app:

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 
    'max-age=31536000; includeSubDomains');
  next();
});
```

#### 3.3 Dependency Audit

```bash
npm audit
# Fix any high/critical vulnerabilities
npm audit fix
```

Run this before every deploy. Add to CI if you set up a pipeline.

---

## Part 2: Agent Build Review — Workbook Generator

The Replit Agent built a Workbook Generator with Excel export endpoints. Here's what to verify manually or with Claude Code.

### 2.1 File Integrity Check

**Claude Code prompt:**

```
Read server/delivery/workbook-generator.ts completely.

Verify the following features are actually implemented (not just declared):

1. MULTI-TAB STRUCTURE
   - Is there a Summary & Methodology tab? 
   - Does it include workspace metadata, run date, narrative?
   - Are data sources listed with connected/sync status?
   
2. PER-SKILL DATA TABS
   - Does addDataTab() actually create a new worksheet per skill?
   - Does it use evidenceSchema to generate columns dynamically?
   - Are column headers actually written to the first row?

3. SEVERITY COLORING
   - Is there conditional formatting that colors rows by severity?
   - What colors are used? (Should be: red for critical, yellow/amber 
     for warning, green for healthy)
   - Does it handle missing severity gracefully?

4. FROZEN HEADERS
   - Is there a freeze pane on row 1 (or row 2 if there's a title row)?
   - Check: ws.views = [{ state: 'frozen', ySplit: 1 }] or equivalent

5. AUTO-FILTER
   - Is autoFilter set on the data range?
   - Does it cover all columns?

6. CLAIMS SECTION
   - Is there a section below the data with skill claims/insights?
   - Does it include severity indicators?

7. ERROR HANDLING
   - What happens if evidence is null or empty?
   - What happens if evidenceSchema doesn't match the actual evidence data?
   - What happens if a skill run has no output at all?

Report: for each feature, whether it's (a) fully implemented, 
(b) partially implemented with gaps, or (c) missing/stubbed.
```

### 2.2 Export Route Auth Check

**Claude Code prompt:**

```
Read the export route handlers that the Agent added.

1. Find these endpoints:
   - GET /api/workspaces/:id/skills/:skillId/runs/:runId/export
   - GET /api/workspaces/:id/agents/:agentId/runs/:runId/export

2. For each, verify:

   a. AUTH: Is auth middleware applied? 
      If the route file uses router-level middleware (e.g., 
      router.use(authMiddleware)), the new routes inherit it.
      If auth is per-route, the Agent may have missed it.

   b. WORKSPACE SCOPING: Does the query that fetches the skill_run 
      or agent_run include workspace_id in the WHERE clause?
      
      GOOD: WHERE id = $runId AND workspace_id = $workspaceId
      BAD:  WHERE id = $runId  (anyone who guesses runId gets the data)

   c. JSON.PARSE SAFETY: The Agent mentioned adding try/catch 
      around JSON.parse. Verify this is actually present.
      
      If skill_runs.output is corrupt JSON, the export should return 
      a 500 with a clear error, not crash the server.

   d. CONTENT-TYPE HEADERS: Verify the response sets:
      Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
      Content-Disposition: attachment; filename="pandora-export-{runId}.xlsx"

   e. FILENAME SANITIZATION: If the filename includes any user-provided 
      text (like skill name or workspace name), verify it's sanitized 
      to prevent header injection.

3. Report any issues found and fix them.
```

### 2.3 Memory / Performance Check

```
Review the Workbook Generator for memory and performance risks.

1. LARGE EVIDENCE ARRAYS: If a skill run has 1,000+ evidence items 
   (e.g., data quality audit on a large CRM), does the generator 
   buffer the entire workbook in memory before responding?
   
   ExcelJS supports streaming mode. If the generator uses 
   Workbook (not stream.xlsx.WorkbookWriter), large exports 
   could OOM on Replit's memory limits.
   
   For v1 this is acceptable if evidence arrays are capped at 
   a reasonable size. But note the risk.

2. AGENT RUN EXPORTS: An agent run includes evidence from multiple 
   skills. If 6 skills each have 500 evidence items, that's 3,000 
   rows across 6 tabs. Verify the generator handles this without 
   excessive memory allocation.

3. TIMEOUT RISK: Does the export endpoint have a timeout? If 
   workbook generation takes >30 seconds (Replit's default), the 
   request may be killed. Add a timeout guard or streaming response.

4. CONCURRENT EXPORTS: If multiple users hit the export endpoint 
   simultaneously, does the server handle it? Excel generation is 
   CPU-intensive — consider adding the export to a job queue if 
   this becomes a bottleneck. For now, note the limitation.
```

### 2.4 Data Leakage Check

```
Verify the export doesn't leak data across workspaces.

1. Read the query that fetches skill_runs for export.
   Construct a scenario: 
   - Workspace A has skill_run with id 'run-123'
   - User authenticated to Workspace B requests:
     GET /api/workspaces/workspace-B/skills/pipeline-hygiene/runs/run-123/export
   
   Does the query return Workspace A's data? 
   It shouldn't — the WHERE clause must filter on workspace_id.

2. Same check for agent_runs export.

3. Check: does the export include any metadata that could leak 
   information about other workspaces? (e.g., workspace IDs in 
   error messages, cross-workspace join results)
```

---

## Part 3: Deploy Verification Script

After applying all fixes, run this verification:

```typescript
// scripts/verify-deploy-security.ts

// Test 1: Unauthenticated API access
// Hit 5 data endpoints without auth token
// All should return 401, not data

// Test 2: Cross-workspace access
// Authenticate as workspace A
// Try to access workspace B's endpoints
// All should return 403

// Test 3: Export endpoint auth
// Try to download an export without auth
// Should return 401

// Test 4: Rate limiting
// Send 200 requests in 10 seconds
// Should get 429 responses after the limit

// Test 5: Credential encryption
// Read a connector_configs row from DB
// Credentials should NOT be readable plaintext

// Test 6: CORS
// Send request with Origin: https://evil.com
// Should NOT get Access-Control-Allow-Origin back

// Test 7: SQL injection
// Send workspace name with SQL injection payload
// Should return error, not execute the SQL
```

---

## Implementation Sequence

### Sprint 1 (Before next customer workspace)
1. [ ] Auth middleware audit (1.1) — Claude Code
2. [ ] Credential encryption verification (1.2) — Claude Code
3. [ ] Replit deploy settings (1.3) — Manual
4. [ ] Export endpoint auth + workspace scoping (2.2) — Claude Code
5. [ ] CORS fix (1.4) — Claude Code

### Sprint 2 (Before scaling beyond 3 workspaces)
6. [ ] Rate limiting (1.5) — Claude Code
7. [ ] Workspace isolation audit (2.1) — Claude Code
8. [ ] SQL injection review (2.2) — Claude Code
9. [ ] Workbook Generator integrity check (2.1) — Claude Code
10. [ ] Logging audit (2.4) — Claude Code

### Sprint 3 (Before public launch)
11. [ ] Custom domain setup — Manual
12. [ ] CSP headers (3.2) — Claude Code
13. [ ] Dependency audit (3.3) — CLI
14. [ ] Secret rotation documentation (2.3) — Manual
15. [ ] Deploy verification script (Part 3) — Claude Code

---

## What NOT to Do

- ❌ Don't build a full RBAC system yet (single-admin per workspace is fine for now)
- ❌ Don't implement SSO/SAML (future enterprise feature)
- ❌ Don't build a WAF (Replit handles edge-level protection)
- ❌ Don't implement IP allowlisting (complicates consultant access patterns)
- ❌ Don't build audit log UI (API logging is sufficient for now)
- ❌ Don't implement data residency controls (single-region is fine at this scale)

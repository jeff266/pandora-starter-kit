# Salesforce Integration - Prompt 1: OAuth Flow + Sync Orchestrator

## Context

Pull latest from GitHub. New files exist in `server/connectors/salesforce/`:
- `client.ts` - SOQL queries, Bulk API 2.0, rate limits
- `types.ts` - Salesforce API response types
- `transform.ts` - Opportunity/Contact/Account → normalized entities
- `adapter.ts` - CRMAdapter with initialSync, incrementalSync
- `README.md` - Edge cases and gotchas

**Read these files first:**
1. `server/connectors/salesforce/README.md` - Documents all Salesforce-specific gotchas
2. `server/connectors/hubspot/` - Reference implementation (OAuth, sync wiring)
3. `server/connectors/adapters/registry.ts` - Where adapters are registered
4. `server/sync/orchestrator.ts` - How syncWorkspace() discovers and runs connectors

You're wiring the Salesforce adapter into the app so it's fully operational.

---

## Prerequisites

**Connected App Setup (already done in both Salesforce production orgs):**
- Both orgs use `login.salesforce.com` (production, not sandbox)
- Consumer Key + Consumer Secret available
- Callback URL: `https://<your-replit-url>/api/auth/salesforce/callback`
- Scopes: `api`, `refresh_token`, `offline_access`, `id`

---

## Task 1: Add Environment Variables

Add to `.env` (Replit Secrets):

```
SALESFORCE_CLIENT_ID=<consumer key from Connected App>
SALESFORCE_CLIENT_SECRET=<consumer secret from Connected App>
SALESFORCE_CALLBACK_URL=https://<your-replit-url>/api/auth/salesforce/callback
```

**CRITICAL:** Both test orgs are PRODUCTION. Always use `login.salesforce.com` for token endpoints, never `test.salesforce.com`.

---

## Task 2: Build Salesforce OAuth Routes

Create `server/routes/salesforce-auth.ts`:

### Route: GET /api/auth/salesforce/authorize

**Query params:** `workspaceId` (required)

**Purpose:** Redirects user to Salesforce OAuth consent screen

**Implementation:**

```typescript
import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

router.get('/auth/salesforce/authorize', (req: Request, res: Response) => {
  const { workspaceId } = req.query;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId required' });
  }

  // IMPORTANT: Sign state to prevent CSRF
  const state = JSON.stringify({ workspaceId });
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'change-me-in-production')
    .update(state)
    .digest('hex');
  const signedState = `${Buffer.from(state).toString('base64')}.${signature}`;

  const authUrl = new URL('https://login.salesforce.com/services/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', process.env.SALESFORCE_CLIENT_ID!);
  authUrl.searchParams.set('redirect_uri', process.env.SALESFORCE_CALLBACK_URL!);
  authUrl.searchParams.set('scope', 'api refresh_token offline_access id');
  authUrl.searchParams.set('state', signedState);
  authUrl.searchParams.set('prompt', 'login consent');
  // 'login consent' forces re-auth even if user has active Salesforce session

  res.redirect(authUrl.toString());
});

export default router;
```

### Route: GET /api/auth/salesforce/callback

**Query params:** `code` (auth code), `state` (signed state), `error` (if user denied)

**Purpose:** Exchange code for tokens, store credentials, redirect to app

**Implementation:**

```typescript
import { query } from '../db.js';

router.get('/auth/salesforce/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    // Handle user denial
    if (error === 'access_denied') {
      return res.redirect('/?error=salesforce_denied');
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    // Verify state signature (CSRF protection)
    const [encodedState, signature] = state.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', process.env.SESSION_SECRET || 'change-me-in-production')
      .update(Buffer.from(encodedState, 'base64').toString())
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid state signature' });
    }

    const { workspaceId } = JSON.parse(Buffer.from(encodedState, 'base64').toString());

    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.SALESFORCE_CLIENT_ID!,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
        redirect_uri: process.env.SALESFORCE_CALLBACK_URL!,
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Salesforce OAuth] Token exchange failed:', errorText);
      return res.redirect('/?error=salesforce_token_failed');
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, instance_url, id, issued_at } = tokens;

    // CRITICAL: instance_url is org-specific and MUST be stored
    // All subsequent API calls go to THIS URL, not login.salesforce.com

    // Fetch user identity for org info
    const identityResponse = await fetch(id, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!identityResponse.ok) {
      console.error('[Salesforce OAuth] Identity fetch failed');
      return res.redirect('/?error=salesforce_identity_failed');
    }

    const identity = await identityResponse.json();
    const { user_id, organization_id, username, display_name, email } = identity;

    // Store credentials in connector_configs (upsert pattern)
    const existingConfig = await query(
      `SELECT id FROM connector_configs
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    const credentials = {
      access_token,
      refresh_token,
      instance_url,
      org_id: organization_id,
      user_id,
      connected_by: email,
      token_issued_at: issued_at,
    };

    if (existingConfig.rows.length > 0) {
      // Update existing (re-auth flow)
      await query(
        `UPDATE connector_configs
         SET credentials = $1, status = 'connected', last_sync_at = NULL, updated_at = NOW()
         WHERE workspace_id = $2 AND connector_name = 'salesforce'`,
        [JSON.stringify(credentials), workspaceId]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO connector_configs
         (workspace_id, connector_name, credentials, status, metadata)
         VALUES ($1, 'salesforce', $2, 'connected', $3)`,
        [workspaceId, JSON.stringify(credentials), JSON.stringify({ org_name: display_name })]
      );
    }

    console.log(`[Salesforce OAuth] Connected workspace ${workspaceId} to org ${organization_id}`);

    // Redirect to app
    res.redirect(`/?workspace=${workspaceId}&connected=salesforce`);
  } catch (err) {
    console.error('[Salesforce OAuth] Callback error:', err);
    res.redirect('/?error=salesforce_callback_failed');
  }
});
```

---

## Task 3: Build Connector API Routes

Create `server/routes/salesforce-sync.ts`:

### Route: POST /api/workspaces/:workspaceId/connectors/salesforce/test

**Purpose:** Test connection, return org details

```typescript
import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { SalesforceClient } from '../connectors/salesforce/client.js';

const router = Router();

router.post('/workspaces/:workspaceId/connectors/salesforce/test', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Load credentials
    const configResult = await query(
      `SELECT credentials FROM connector_configs
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salesforce not connected' });
    }

    const credentials = configResult.rows[0].credentials;
    const client = new SalesforceClient({
      accessToken: credentials.access_token,
      instanceUrl: credentials.instance_url,
    });

    // Test query
    const result = await client.query('SELECT Id, Name FROM Organization LIMIT 1');
    const orgName = result.records[0]?.Name || 'Unknown';

    res.json({
      success: true,
      orgName,
      orgId: credentials.org_id,
      userName: credentials.connected_by,
      instanceUrl: credentials.instance_url,
    });
  } catch (err) {
    console.error('[Salesforce Test] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

### Route: POST /api/workspaces/:workspaceId/connectors/salesforce/sync

**Purpose:** Run initial or incremental sync

**Implementation pattern:** Follow HubSpot sync route EXACTLY. Key steps:

1. Load credentials from `connector_configs`
2. Check `last_sync_at` to determine initial vs incremental
3. Create `sync_log` entry (status = 'running')
4. Get adapter from registry: `registry.getAdapter('salesforce')`
5. Call `adapter.initialSync()` or `adapter.incrementalSync()`
6. Write transformed records to normalized tables (deals, contacts, accounts)
7. Update `sync_log` (status = 'completed', record counts)
8. Update `connector_configs.last_sync_at = NOW()`
9. Refresh computed fields
10. Refresh context layer

**Reference:** `server/routes/hubspot-sync.ts` (copy the pattern)

### Route: POST /api/workspaces/:workspaceId/connectors/salesforce/discover-schema

**Purpose:** Return schema metadata

```typescript
router.post('/workspaces/:workspaceId/connectors/salesforce/discover-schema', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const configResult = await query(
      `SELECT credentials FROM connector_configs
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salesforce not connected' });
    }

    const credentials = configResult.rows[0].credentials;
    const client = new SalesforceClient({
      accessToken: credentials.access_token,
      instanceUrl: credentials.instance_url,
    });

    const schema = await client.describeGlobal();

    res.json({
      objects: schema.sobjects.map((obj: any) => ({
        name: obj.name,
        label: obj.label,
        custom: obj.custom,
        queryable: obj.queryable,
      })),
      totalObjects: schema.sobjects.length,
      customObjects: schema.sobjects.filter((obj: any) => obj.custom).length,
    });
  } catch (err) {
    console.error('[Salesforce Schema] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### Route: GET /api/workspaces/:workspaceId/connectors/salesforce/health

**Purpose:** Return connection health status

```typescript
router.get('/workspaces/:workspaceId/connectors/salesforce/health', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const configResult = await query(
      `SELECT credentials, status, last_sync_at, last_error
       FROM connector_configs
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salesforce not connected' });
    }

    const config = configResult.rows[0];
    const credentials = config.credentials;

    // Get record counts
    const dealCount = await query(
      `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1 AND source = 'salesforce'`,
      [workspaceId]
    );
    const contactCount = await query(
      `SELECT COUNT(*) as count FROM contacts WHERE workspace_id = $1 AND source = 'salesforce'`,
      [workspaceId]
    );
    const accountCount = await query(
      `SELECT COUNT(*) as count FROM accounts WHERE workspace_id = $1 AND source = 'salesforce'`,
      [workspaceId]
    );

    // Check token age
    const tokenAge = Date.now() - new Date(credentials.token_issued_at).getTime();
    const tokenStatus = tokenAge > 2 * 60 * 60 * 1000 ? 'expired' :
                        tokenAge > 90 * 60 * 1000 ? 'expiring_soon' : 'valid';

    res.json({
      status: config.status,
      lastSync: config.last_sync_at,
      tokenAge: tokenStatus,
      recordCounts: {
        deals: Number(dealCount.rows[0].count),
        contacts: Number(contactCount.rows[0].count),
        accounts: Number(accountCount.rows[0].count),
      },
      lastError: config.last_error,
      orgId: credentials.org_id,
      instanceUrl: credentials.instance_url,
    });
  } catch (err) {
    console.error('[Salesforce Health] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### Route: DELETE /api/workspaces/:workspaceId/connectors/salesforce/disconnect

**Purpose:** Remove credentials (keep data)

```typescript
router.delete('/workspaces/:workspaceId/connectors/salesforce/disconnect', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    await query(
      `UPDATE connector_configs
       SET status = 'disconnected', credentials = NULL
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    // Do NOT delete normalized data (deals, contacts, accounts)
    // The workspace keeps its data even if the connector is removed

    res.json({ success: true });
  } catch (err) {
    console.error('[Salesforce Disconnect] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## Task 4: Wire Into Sync Orchestrator

**File:** `server/sync/orchestrator.ts`

**Current state:** Probably HubSpot-specific. Generalize it to support multiple connectors.

**Pattern:**

```typescript
import { getAdapterRegistry } from '../connectors/adapters/registry.js';

export async function syncWorkspace(workspaceId: string, options?: { mode?: 'initial' | 'incremental' }) {
  const registry = getAdapterRegistry();

  // Get all connected connectors for this workspace
  const connectors = await query(
    `SELECT connector_name, credentials, last_sync_at
     FROM connector_configs
     WHERE workspace_id = $1 AND status IN ('connected', 'healthy')`,
    [workspaceId]
  );

  for (const connector of connectors.rows) {
    const adapter = registry.getAdapter(connector.connector_name);
    if (!adapter) {
      console.warn(`[Sync] No adapter found for ${connector.connector_name}`);
      continue;
    }

    try {
      const isInitial = !connector.last_sync_at || options?.mode === 'initial';

      if (isInitial) {
        await adapter.initialSync(connector.credentials, workspaceId);
      } else {
        await adapter.incrementalSync(connector.credentials, workspaceId, new Date(connector.last_sync_at));
      }

      // Update last_sync_at
      await query(
        `UPDATE connector_configs SET last_sync_at = NOW() WHERE workspace_id = $1 AND connector_name = $2`,
        [workspaceId, connector.connector_name]
      );
    } catch (err) {
      console.error(`[Sync] ${connector.connector_name} sync failed:`, err);
      // Don't fail other connectors — continue
    }
  }
}
```

---

## Task 5: Add to Nightly Sync Schedule

**File:** `server/sync/scheduler.ts` (or wherever the cron job lives)

**Pattern:** Same as HubSpot. Find all workspaces with `status = 'connected'` for Salesforce, run sync.

```typescript
// In the nightly cron job
const workspaces = await query(
  `SELECT DISTINCT workspace_id
   FROM connector_configs
   WHERE status = 'connected' AND connector_name IN ('hubspot', 'salesforce')`
);

for (const ws of workspaces.rows) {
  await syncWorkspace(ws.workspace_id, { mode: 'incremental' });
}
```

---

## Task 6: Register Routes

**File:** `server/index.ts`

```typescript
import salesforceAuthRouter from './routes/salesforce-auth.js';
import salesforceSyncRouter from './routes/salesforce-sync.js';

app.use('/api', salesforceAuthRouter);
app.use('/api', salesforceSyncRouter);
```

---

## Task 7: Verify Salesforce Adapter is Registered

**File:** `server/index.ts` or wherever adapters are registered

```typescript
import { getAdapterRegistry } from './connectors/adapters/registry.js';
import { salesforceAdapter } from './connectors/salesforce/adapter.js';

const registry = getAdapterRegistry();
registry.register(salesforceAdapter);
```

**Verify:** Check that `salesforceAdapter.name === 'salesforce'`

---

## What NOT to Build

- ❌ No token refresh yet (that's Prompt 4)
- ❌ No stage history sync (that's Prompt 2)
- ❌ No activity sync (that's Prompt 3)
- ❌ No UI changes — just API routes
- ❌ No sandbox support (both test orgs are production)

---

## Verification Checklist

After implementation, verify:

- [ ] Routes are registered and accessible
- [ ] OAuth flow redirects to Salesforce login
- [ ] Callback stores credentials in `connector_configs`
- [ ] Test endpoint returns org details
- [ ] Sync endpoint creates `sync_log` entry
- [ ] Adapter is discoverable from registry
- [ ] Orchestrator can run Salesforce sync
- [ ] No errors in server logs

---

## Common Issues

**Issue:** "invalid_client_id" during OAuth
- **Fix:** Check `SALESFORCE_CLIENT_ID` matches Connected App Consumer Key

**Issue:** "redirect_uri_mismatch"
- **Fix:** Callback URL in `.env` must EXACTLY match Connected App setting

**Issue:** "Adapter not found"
- **Fix:** Verify `registry.register(salesforceAdapter)` was called on startup

**Issue:** Credentials stored but sync fails with 401
- **Fix:** Check `instance_url` is being used for API calls, not `login.salesforce.com`

---

## Next Steps

After this prompt is complete, move to:
- **Prompt 2:** OpportunityFieldHistory → Stage History (Claude Code)
- **Prompt 3:** OpportunityContactRole + Activity Sync (Claude Code)
- **Prompt 4:** Token Refresh + Scheduling (Replit)

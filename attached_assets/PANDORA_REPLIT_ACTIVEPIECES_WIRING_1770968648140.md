# PANDORA — ActivePieces Workflow Engine: Replit Integration Prompt
## Wire the headless ActivePieces engine into Pandora's runtime

### Context

Claude Code already built the entire workflow engine logic layer (3 prompts, ~2,900 lines):

**From Prompt 1 (Schema + Compiler):**
- `migrations/018_workflow_engine.sql` — 4 tables + connector registry seed data
- `server/workflows/types.ts` — All TypeScript types
- `server/workflows/tree-validator.ts` — Tree validation
- `server/workflows/compiler.ts` — Deterministic Tree → AP Flow JSON compiler

**From Prompt 2 (Service Layer):**
- `server/workflows/workflow-service.ts` — WorkflowService (create/activate/pause/execute/syncRunStatus/createFromTemplate)
- `server/workflows/workflow-trigger.ts` — onActionCreated bridge (action → workflow execution)
- `server/workflows/connector-registry-service.ts` — Plan-based piece gating
- `server/workflows/run-monitor.ts` — pollRunningWorkflows
- `server/workflows/template-seed.ts` — 5 seed templates

**From Prompt 3 (AP Client + Provisioning):**
- `server/workflows/ap-client.ts` — ActivePiecesClient (typed REST wrapper, retry, version cache)
- `server/workflows/ap-types.ts` — AP response types
- `server/workflows/ap-project-manager.ts` — ensureAPProject, cleanupAPProject
- `server/workflows/ap-connection-provisioner.ts` — Auto-provision AP connections from Pandora credentials
- `migrations/019_workspace_ap_mapping.sql` — ap_project_id column + workspace_ap_connections table

**Barrel export:** `server/workflows/index.ts`

All logic is built with dependency injection. WorkflowService accepts an
APClientInterface — your job is to instantiate the real client and wire 
everything into the running application.

### What to Read First

```
1. server/workflows/index.ts — see what's exported
2. server/workflows/types.ts — understand the interfaces, especially APClientInterface
3. server/workflows/workflow-service.ts — the main service you'll wire into routes
4. server/workflows/workflow-trigger.ts — onActionCreated function signature
5. server/workflows/ap-client.ts — constructor config you need to provide
6. server/workflows/ap-connection-provisioner.ts — event handlers you need to wire

Then read these existing files to match patterns:
7. The existing route files — understand auth middleware, workspace scoping, error handling
8. The existing cron scheduler — understand how periodic jobs are registered
9. The connector credential storage — understand how tokens are stored/refreshed
10. The action creation flow — find where actions are created to hook onActionCreated
```

---

## STEP 1: Docker Compose — ActivePieces + Redis

Add these services to docker-compose.yml:

```yaml
  activepieces:
    image: ghcr.io/activepieces/activepieces:0.72.0
    restart: always
    environment:
      - AP_POSTGRES_DATABASE=${AP_POSTGRES_DATABASE:-activepieces}
      - AP_POSTGRES_PASSWORD=${AP_POSTGRES_PASSWORD}
      - AP_POSTGRES_USERNAME=${AP_POSTGRES_USERNAME:-ap}
      - AP_POSTGRES_HOST=postgres
      - AP_POSTGRES_PORT=5432
      - AP_REDIS_HOST=redis
      - AP_REDIS_PORT=6379
      - AP_ENCRYPTION_KEY=${AP_ENCRYPTION_KEY}
      - AP_JWT_SECRET=${AP_JWT_SECRET}
      - AP_FRONTEND_URL=http://localhost:3000
      - AP_EXECUTION_MODE=UNSANDBOXED
      - AP_TELEMETRY_ENABLED=false
      - AP_TEMPLATES_SOURCE_URL=""
      - AP_SIGN_UP_ENABLED=false
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - internal

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal
```

Add to volumes:
```yaml
volumes:
  redis_data:
```

CRITICAL:
- AP gets NO port mapping. Internal only. Pandora talks to it at http://activepieces:3000
- AP uses a SEPARATE database in the same Postgres instance (not Pandora's database)
- You need to create the AP database and user. Add an init script:

Create `scripts/init-ap-db.sql`:
```sql
-- Run once against Postgres to set up AP's database
CREATE USER ap WITH PASSWORD '<AP_POSTGRES_PASSWORD from env>';
CREATE DATABASE activepieces OWNER ap;
GRANT ALL PRIVILEGES ON DATABASE activepieces TO ap;
```

Or add a Postgres init script to Docker Compose:
```yaml
  postgres:
    volumes:
      - ./scripts/init-ap-db.sql:/docker-entrypoint-initdb.d/02-activepieces.sql
```

Add to .env:
```env
# ActivePieces
AP_POSTGRES_DATABASE=activepieces
AP_POSTGRES_PASSWORD=<generate: openssl rand -hex 16>
AP_POSTGRES_USERNAME=ap
AP_ENCRYPTION_KEY=<generate: openssl rand -hex 16>
AP_JWT_SECRET=<generate: openssl rand -hex 32>
AP_BASE_URL=http://activepieces:3000
AP_API_KEY=<provisioned on first boot — see Step 2>
```

After adding to Docker Compose, run `docker compose up -d` and verify:
- AP container starts and stays running (check `docker compose logs activepieces`)
- Redis container starts with healthy status
- AP creates its tables in the `activepieces` database (check `docker compose exec postgres psql -U ap -d activepieces -c '\dt'`)

---

## STEP 2: First-Boot AP API Key Provisioning

ActivePieces needs a platform admin API key for Pandora to use its REST API.
This only needs to happen once, on first boot.

Create `scripts/provision-ap-key.ts`:

```typescript
/**
 * Run once after AP starts for the first time.
 * Creates a platform admin account and generates an API key.
 * Store the API key in .env as AP_API_KEY.
 *
 * Usage: npx tsx scripts/provision-ap-key.ts
 */

const AP_URL = process.env.AP_BASE_URL || 'http://localhost:3000';

async function provision() {
  // Step 1: Check if AP is up
  console.log('Waiting for ActivePieces to start...');
  let retries = 30;
  while (retries > 0) {
    try {
      const res = await fetch(`${AP_URL}/api/v1/flags`);
      if (res.ok) break;
    } catch { /* not ready yet */ }
    retries--;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (retries === 0) throw new Error('AP did not start within 60 seconds');

  // Step 2: Sign up the platform admin (only works if no users exist)
  // AP_SIGN_UP_ENABLED is false, but the FIRST user creation always works
  const signupRes = await fetch(`${AP_URL}/api/v1/authentication/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'pandora-admin@internal.pandora.io',
      password: generateSecurePassword(),
      firstName: 'Pandora',
      lastName: 'Platform',
    }),
  });

  if (!signupRes.ok) {
    const body = await signupRes.text();
    // If user already exists, that's fine — try to sign in
    if (body.includes('EXISTING_USER')) {
      console.log('Admin user already exists. Sign in to get API key.');
      console.log('If you already have AP_API_KEY set, you can skip this script.');
      return;
    }
    throw new Error(`Signup failed: ${body}`);
  }

  const { token } = await signupRes.json();
  console.log('Platform admin created.');

  // Step 3: Generate API key
  const apiKeyRes = await fetch(`${AP_URL}/api/v1/api-keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: 'Pandora Platform' }),
  });

  if (!apiKeyRes.ok) throw new Error(`API key creation failed: ${await apiKeyRes.text()}`);

  const { value: apiKey } = await apiKeyRes.json();

  console.log('\n=== ActivePieces API Key Provisioned ===');
  console.log(`AP_API_KEY=${apiKey}`);
  console.log('\nAdd this to your .env file.');
  console.log('========================================\n');
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

provision().catch(console.error);
```

Run once after AP starts:
```bash
npx tsx scripts/provision-ap-key.ts
```

Copy the output AP_API_KEY into .env, then restart Pandora so it picks up the key.

NOTE: The AP API endpoints may differ slightly based on the pinned version (0.72.0).
Check the AP docs or inspect the running instance if signup/API key endpoints 
return unexpected responses. The general pattern is:
1. Create first user (always allowed even with signup disabled)
2. Use their bearer token to create a platform API key
3. Use that API key for all subsequent Pandora → AP communication

---

## STEP 3: Run Migrations

Run both new migrations against Pandora's database (not AP's):

```bash
psql $DATABASE_URL -f migrations/018_workflow_engine.sql
psql $DATABASE_URL -f migrations/019_workspace_ap_mapping.sql
```

Then seed the templates:

```typescript
import { seedTemplates } from './server/workflows';
import { pool } from './server/db';  // your database pool

await seedTemplates(pool);
```

You can add this to the existing migration runner or app startup. The seed
function is idempotent (upserts by slug).

---

## STEP 4: Service Initialization at Startup

In your main app startup file (server/index.ts or wherever the Express app initializes),
add the workflow engine initialization:

```typescript
import {
  ActivePiecesClient,
  WorkflowService,
  seedTemplates,
} from './workflows';

// --- Workflow Engine Init ---

// Create AP client (null if AP_API_KEY not configured — graceful degradation)
let apClient: ActivePiecesClient | undefined;
if (process.env.AP_API_KEY) {
  apClient = new ActivePiecesClient({
    baseUrl: process.env.AP_BASE_URL || 'http://activepieces:3000',
    apiKey: process.env.AP_API_KEY,
    timeout: 30000,
  });

  // Verify AP is reachable on startup
  const health = await apClient.healthCheck();
  if (health.healthy) {
    console.log(`ActivePieces connected (version: ${health.version})`);
  } else {
    console.warn(`ActivePieces unreachable: ${health.error} — workflows will be unavailable`);
    apClient = undefined;
  }
} else {
  console.warn('AP_API_KEY not set — workflow engine disabled');
}

// Create service (works without apClient, just can't push to AP)
const workflowService = new WorkflowService(pool, apClient);

// Seed templates on startup (idempotent)
await seedTemplates(pool);
```

IMPORTANT: Make `workflowService` and `apClient` available to your route 
registration and event wiring. Either export them from a shared module,
attach to the Express app, or use whatever DI pattern your codebase uses.

---

## STEP 5: Route Registration

Create `server/routes/workflows.ts` (or add to existing route file).

Follow the same auth middleware and error handling patterns as your other routes.
Every route is workspace-scoped — the :workspaceId param must match the 
authenticated user's workspace access.

```typescript
import { Router } from 'express';
import { WorkflowService } from '../workflows';
import {
  getAvailablePieces,
  getConnectedPieces,
  getRequiredConnectionsForTree,
} from '../workflows';
import { compileWorkflow } from '../workflows';
import { TreeValidator } from '../workflows';

export function createWorkflowRoutes(workflowService: WorkflowService): Router {
  const router = Router();

  // --- Workflow CRUD ---

  // List workflows for workspace
  router.get('/api/workspaces/:workspaceId/workflows', async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const { status, trigger_type, limit, offset } = req.query;
      const workflows = await workflowService.list(workspaceId, {
        status: status as string,
        triggerType: trigger_type as string,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json(workflows);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Create workflow
  router.post('/api/workspaces/:workspaceId/workflows', async (req, res) => {
    try {
      const workflow = await workflowService.create(req.params.workspaceId, req.body);
      res.status(201).json(workflow);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Get workflow
  router.get('/api/workspaces/:workspaceId/workflows/:workflowId', async (req, res) => {
    try {
      const workflow = await workflowService.get(req.params.workspaceId, req.params.workflowId);
      res.json(workflow);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update workflow
  router.put('/api/workspaces/:workspaceId/workflows/:workflowId', async (req, res) => {
    try {
      const workflow = await workflowService.update(
        req.params.workspaceId,
        req.params.workflowId,
        req.body
      );
      res.json(workflow);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Delete workflow
  router.delete('/api/workspaces/:workspaceId/workflows/:workflowId', async (req, res) => {
    try {
      await workflowService.delete(req.params.workspaceId, req.params.workflowId);
      res.status(204).send();
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- Lifecycle ---

  // Activate workflow (compile + push to AP + enable)
  router.post('/api/workspaces/:workspaceId/workflows/:workflowId/activate', async (req, res) => {
    try {
      const result = await workflowService.activate(req.params.workflowId);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Pause workflow
  router.post('/api/workspaces/:workspaceId/workflows/:workflowId/pause', async (req, res) => {
    try {
      const workflow = await workflowService.pause(req.params.workflowId);
      res.json(workflow);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Manual trigger
  router.post('/api/workspaces/:workspaceId/workflows/:workflowId/execute', async (req, res) => {
    try {
      const run = await workflowService.execute(req.params.workflowId, req.body);
      res.status(202).json(run);
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- Runs ---

  // List runs for a workflow
  router.get('/api/workspaces/:workspaceId/workflows/:workflowId/runs', async (req, res) => {
    try {
      // Query workflow_runs table filtered by workflow_id
      // Add this method to WorkflowService if not already present:
      // listRuns(workflowId, { limit, offset, status })
      const { limit, offset, status } = req.query;
      const runs = await workflowService.listRuns(req.params.workflowId, {
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
        status: status as string,
      });
      res.json(runs);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Get specific run
  router.get('/api/workspaces/:workspaceId/workflows/:workflowId/runs/:runId', async (req, res) => {
    try {
      const run = await workflowService.syncRunStatus(req.params.runId);
      res.json(run);
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- Templates ---

  // List all templates
  router.get('/api/workflows/templates', async (req, res) => {
    try {
      // Query workflow_templates table, ordered by popularity DESC
      const templates = await workflowService.listTemplates(req.query.category as string);
      res.json(templates);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Get template details
  router.get('/api/workflows/templates/:templateId', async (req, res) => {
    try {
      const template = await workflowService.getTemplate(req.params.templateId);
      res.json(template);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Create workflow from template
  router.post('/api/workspaces/:workspaceId/workflows/from-template', async (req, res) => {
    try {
      const { templateId, overrides } = req.body;
      const workflow = await workflowService.createFromTemplate(
        req.params.workspaceId,
        templateId,
        overrides
      );
      res.status(201).json(workflow);
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- Connector Registry ---

  // Available pieces for workspace (filtered by plan + gate_status)
  router.get('/api/workspaces/:workspaceId/workflow-connectors', async (req, res) => {
    try {
      const pieces = await getAvailablePieces(req.params.workspaceId);
      res.json(pieces);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Connected pieces (only those with active Pandora connectors)
  router.get('/api/workspaces/:workspaceId/workflow-connectors/connected', async (req, res) => {
    try {
      const pieces = await getConnectedPieces(req.params.workspaceId);
      res.json(pieces);
    } catch (err) {
      handleError(res, err);
    }
  });

  // All registered pieces (admin/global view)
  router.get('/api/workflow-connectors', async (req, res) => {
    try {
      // SELECT * FROM connector_registry ORDER BY display_name
      const pieces = await getAllPieces();
      res.json(pieces);
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- Validation (dry run) ---

  // Validate tree without saving
  router.post('/api/workspaces/:workspaceId/workflows/validate', async (req, res) => {
    try {
      const { tree } = req.body;
      const validator = new TreeValidator();
      // Build context from workspace's connectors
      const context = await workflowService.getCompilerContext(req.params.workspaceId);
      const result = validator.validate(tree, context);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Compile and preview AP flow (without saving or pushing)
  router.post('/api/workspaces/:workspaceId/workflows/:workflowId/compile', async (req, res) => {
    try {
      const workflow = await workflowService.get(req.params.workspaceId, req.params.workflowId);
      const context = await workflowService.getCompilerContext(req.params.workspaceId);
      const compiled = compileWorkflow(workflow.tree, context);
      res.json(compiled);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

// Error handler — adapt to match your existing error handling pattern
function handleError(res: any, err: any) {
  if (err.name === 'WorkflowValidationError') {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  if (err.message?.includes('not found')) {
    return res.status(404).json({ error: err.message });
  }
  if (err.message?.includes('Missing required connectors')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Workflow route error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

Register in your main app:
```typescript
app.use(authMiddleware);  // your existing auth middleware
app.use(createWorkflowRoutes(workflowService));
```

NOTE: The route file above is a template. Adapt it to match:
- Your auth middleware pattern (session, JWT, API key)
- Your workspace access checking pattern
- Your error response format
- Your existing Router registration pattern

WorkflowService may need small additions for routes I referenced that 
aren't in the Claude Code build (like listRuns, listTemplates, getTemplate).
These are simple DB queries — add them if missing:

```typescript
// Add to WorkflowService if not already present:

async listRuns(workflowId: string, opts: { limit: number; offset: number; status?: string }) {
  let query = 'SELECT * FROM workflow_runs WHERE workflow_id = $1';
  const params: any[] = [workflowId];
  if (opts.status) {
    query += ' AND status = $' + (params.length + 1);
    params.push(opts.status);
  }
  query += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(opts.limit, opts.offset);
  const result = await this.db.query(query, params);
  return result.rows;
}

async listTemplates(category?: string) {
  let query = 'SELECT * FROM workflow_templates';
  const params: any[] = [];
  if (category) {
    query += ' WHERE category = $1';
    params.push(category);
  }
  query += ' ORDER BY popularity DESC, name ASC';
  const result = await this.db.query(query, params);
  return result.rows;
}

async getTemplate(templateId: string) {
  const result = await this.db.query(
    'SELECT * FROM workflow_templates WHERE id = $1',
    [templateId]
  );
  if (result.rows.length === 0) throw new Error('Template not found');
  return result.rows[0];
}
```

---

## STEP 6: Event Wiring — Actions → Workflows

Find where actions are created in the codebase. This is likely in:
- `server/actions/action-service.ts`
- Or the skill runtime's post-processing step
- Or wherever `createAction()` / `insertAction()` is called

Add the onActionCreated hook AFTER the action is persisted but BEFORE 
the response is sent:

```typescript
import { onActionCreated } from '../workflows';

// In your action creation flow:

const action = await createAction(workspaceId, actionData);

// Existing: evaluate policies
await evaluatePolicy(action, policies);

// NEW: trigger matching workflows (fire-and-forget)
try {
  await onActionCreated(action, workflowService);
} catch (err) {
  console.error('Workflow trigger failed (non-fatal):', err);
  // Never let workflow failures block action creation
}

// Existing: emit webhook
await emitWebhook(action, 'action.created');
```

If the codebase uses an EventEmitter pattern instead:
```typescript
actionEmitter.on('action.created', async (action) => {
  try {
    await onActionCreated(action, workflowService);
  } catch (err) {
    console.error('Workflow trigger failed (non-fatal):', err);
  }
});
```

The key constraint: one workflow failure must NEVER block other workflows 
or the action creation flow. onActionCreated handles this internally 
(try/catch per workflow), but wrap the outer call too.

---

## STEP 7: Event Wiring — Connector Events → AP Connection Provisioning

Find where connector credentials are stored/refreshed. Look for:
- The OAuth callback handlers (e.g., HubSpot OAuth callback, Salesforce OAuth callback)
- The token refresh logic (e.g., before making API calls, check if token is expired)
- The connector disconnect flow

Wire the AP connection provisioning into these flows:

```typescript
import {
  onConnectorConnected,
  onConnectorDisconnected,
  refreshConnection,
} from '../workflows';

// --- When a new connector is connected (OAuth callback success) ---
// Find the spot where credentials are saved after OAuth callback.
// After storing credentials in connector_configs:

if (apClient) {
  try {
    await onConnectorConnected(
      workspaceId,
      connectorType,       // 'hubspot', 'salesforce', 'slack'
      savedCredentials,     // the credential object you just stored
      apClient,
      pool
    );
    console.log(`AP connection provisioned for ${connectorType} in workspace ${workspaceId}`);
  } catch (err) {
    console.error(`AP connection provisioning failed (non-fatal):`, err);
    // Don't block the OAuth callback — connector still works, just workflows won't have it
  }
}

// --- When tokens are refreshed ---
// Find the token refresh handler for each connector.
// After the new access_token is saved:

if (apClient) {
  try {
    await refreshConnection(
      workspaceId,
      connectorType,
      newCredentials,       // { accessToken, refreshToken, ... }
      apClient,
      pool
    );
  } catch (err) {
    console.error(`AP connection refresh failed (non-fatal):`, err);
  }
}

// --- When a connector is disconnected ---
// Find the disconnect handler:

if (apClient) {
  try {
    await onConnectorDisconnected(workspaceId, connectorType, apClient, pool);
  } catch (err) {
    console.error(`AP connection cleanup failed (non-fatal):`, err);
  }
}
```

CRITICAL: All three hooks are non-fatal. The connector system works 
independently of AP. If AP is down, connectors still sync data. 
Workflows just won't have credentials to execute actions until AP recovers.

The three connectors that have AP piece mappings today are:
- hubspot → @activepieces/piece-hubspot
- salesforce → @activepieces/piece-salesforce  
- slack → @activepieces/piece-slack

Only these three will trigger AP connection provisioning. Others are silently skipped.

---

## STEP 8: Cron Registration — Workflow Run Monitor

Register the run status poller in your cron scheduler. 

Find where periodic jobs are registered (e.g., skill cron, sync scheduler)
and add:

```typescript
import { pollRunningWorkflows } from '../workflows';

// Register workflow run monitor — polls every 30 seconds
cronScheduler.register(
  'workflow-run-monitor',
  async () => {
    if (!apClient) return;  // Skip if AP not configured
    try {
      await pollRunningWorkflows(workflowService);
    } catch (err) {
      console.error('Workflow run monitor error:', err);
    }
  },
  '*/30 * * * * *'   // Every 30 seconds — adjust if your cron doesn't support seconds
);
```

If your scheduler uses minutes, use `* * * * *` (every minute) instead.
The run monitor is lightweight — it only queries runs with status='running' 
and makes one AP API call per running workflow. At low volume this is negligible.

---

## STEP 9: Health Check Integration

Add AP health to your existing health endpoint:

```typescript
// In your existing GET /api/health route:

const health: any = {
  status: 'ok',
  // ... existing health checks
};

if (apClient) {
  const apHealth = await apClient.healthCheck();
  health.activepieces = apHealth;
} else {
  health.activepieces = { healthy: false, error: 'Not configured' };
}

res.json(health);
```

---

## STEP 10: Integration Smoke Test

After all wiring is complete, run these manual tests to verify end-to-end:

### Test 1: AP Health
```bash
curl http://localhost:<your-port>/api/health | jq '.activepieces'
# Expected: { "healthy": true, "version": "0.72.0" }
```

### Test 2: Template List
```bash
curl http://localhost:<your-port>/api/workflows/templates | jq '.[].name'
# Expected: 5 template names
```

### Test 3: Create Workflow from Template
```bash
# Use a workspace that has Slack connected
curl -X POST http://localhost:<your-port>/api/workspaces/<workspace-id>/workflows/from-template \
  -H 'Content-Type: application/json' \
  -d '{"templateId": "<id of Data Quality Fix Notification template>"}'
# Expected: 201 with workflow in draft status
```

### Test 4: Activate Workflow
```bash
curl -X POST http://localhost:<your-port>/api/workspaces/<workspace-id>/workflows/<workflow-id>/activate
# Expected: workflow with status='active', ap_flow_id populated
```

### Test 5: Manual Execute
```bash
curl -X POST http://localhost:<your-port>/api/workspaces/<workspace-id>/workflows/<workflow-id>/execute \
  -H 'Content-Type: application/json' \
  -d '{"test": true, "action": {"type": "clean_data", "severity": "medium", "title": "Test action"}}'
# Expected: 202 with workflow_run in running status
```

### Test 6: Check Run Status
```bash
curl http://localhost:<your-port>/api/workspaces/<workspace-id>/workflows/<workflow-id>/runs
# Expected: run with status (running → succeeded/failed after AP executes)
```

### Test 7: Connector Registry
```bash
curl http://localhost:<your-port>/api/workspaces/<workspace-id>/workflow-connectors
# Expected: list of available pieces filtered by workspace plan
```

### Test 8: Validate Tree
```bash
curl -X POST http://localhost:<your-port>/api/workspaces/<workspace-id>/workflows/validate \
  -H 'Content-Type: application/json' \
  -d '{
    "tree": {
      "version": "1.0",
      "trigger": { "type": "manual", "config": {} },
      "steps": [
        {
          "id": "notify",
          "name": "Test notify",
          "type": "slack_notify",
          "config": {
            "channel": "#test",
            "message_template": "Hello from workflow engine!"
          }
        }
      ]
    }
  }'
# Expected: { valid: true, warnings: [], errors: [] } if Slack is connected
# Expected: { valid: false, errors: [{ ... missing slack connector }] } if not
```

---

## What NOT to Build

- Tree Builder UI — that's a separate, larger effort. The API is sufficient for v1.
  Users interact with workflows through templates + API. UI comes later.
- AP embed SDK / iframe — v2 feature. Pandora's own tree builder is the plan.
- Custom AP pieces (@pandora/piece-*) — v2.
- Billing metering for workflow runs — track in workflow_runs table but don't enforce.
- AP worker scaling — single worker handles initial load fine.

---

## Verification Checklist

After completing all steps:

- [ ] `docker compose up -d` starts AP + Redis alongside existing services
- [ ] AP_API_KEY is provisioned and in .env
- [ ] Migrations 018 + 019 are applied
- [ ] Templates are seeded (5 templates in workflow_templates)
- [ ] GET /api/health shows activepieces: { healthy: true }
- [ ] Workflow CRUD routes work (create, get, list, update, delete)
- [ ] Activate compiles tree + pushes to AP + flow appears in AP
- [ ] Manual execute triggers AP flow run
- [ ] Run monitor updates run status from AP
- [ ] Creating an action triggers matching workflows (if any are active)
- [ ] Connecting HubSpot provisions AP connection automatically
- [ ] Disconnecting a connector removes AP connection
- [ ] Token refresh updates AP connection credentials

If any test fails, check in this order:
1. Docker: `docker compose logs activepieces` — is AP running?
2. Network: Can Pandora reach `http://activepieces:3000`?
3. Auth: Is AP_API_KEY valid? Try `curl -H "Authorization: Bearer $AP_API_KEY" http://activepieces:3000/api/v1/projects`
4. DB: Are migrations applied? Check `\dt` in Pandora's database.
5. Code: Is WorkflowService instantiated with the real apClient?

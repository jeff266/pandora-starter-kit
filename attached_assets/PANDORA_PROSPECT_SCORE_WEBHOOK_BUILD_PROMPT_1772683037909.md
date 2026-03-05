# Pandora Prospect Score Webhooks — Build Prompt

## Context

The Prospect Score consolidation just shipped. Every scored entity now
has component scores (fit/engagement/intent/timing), a full score_factors
array, score_summary, and recommended_action in the lead_scores table.
5,089 contacts and 149 deals scored for Frontera with 100% column fill.

Now we need to push those scores out via webhooks so external systems
(n8n, Zapier, custom integrations, CRM writeback pipelines) can react
to score changes in real time.

The Actions Engine spec (PANDORA_ACTIONS_ENGINE_SPEC.md) designed a
webhook infrastructure with HMAC signing, retry, circuit breaker, and
CRUD API. A previous session wrote the types (webhook-types.ts) and
delivery engine (webhook-delivery.ts). That work may or may not have
been merged — investigate first.

---

## Step 0: Investigate What Exists

Before building anything, check what webhook infrastructure is live:

```bash
# Check if webhook_endpoints table exists
psql $DATABASE_URL -c "\d webhook_endpoints" 2>&1

# Check if webhook delivery files exist
find server/ -name "*webhook*" -type f 2>/dev/null
find server/actions/ -type f 2>/dev/null

# Check if webhook routes exist
grep -r "webhook-endpoints\|webhook_endpoints" server/routes/ --include="*.ts" -l 2>/dev/null

# Check for HMAC signing function
grep -r "signPayload\|X-Pandora-Signature\|hmac" server/ --include="*.ts" -l 2>/dev/null
```

Record findings. Then proceed with whichever path applies:

**PATH A — Webhook infrastructure exists:**
  Skip to Step 2 (add prospect.scored event type).

**PATH B — Webhook infrastructure does NOT exist:**
  Start at Step 1 (build it with prospect.scored as the first event).

---

## Step 1: Webhook Infrastructure (only if PATH B)

If the webhook_endpoints table and delivery engine don't exist, build them.

### 1a. Migration: webhook_endpoints + webhook_delivery_log

```sql
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  secret TEXT NOT NULL,            -- HMAC-SHA256 signing secret
  enabled BOOLEAN DEFAULT true,

  -- Filtering
  event_types TEXT[],              -- NULL = all events
  
  -- Health tracking
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER DEFAULT 0,
  disabled_reason TEXT,            -- 'manual' | 'consecutive_failures'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_webhook_endpoints_workspace
  ON webhook_endpoints(workspace_id, enabled);

-- Delivery log for debugging and retry
CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,          -- unique per event for idempotency
  payload JSONB NOT NULL,
  
  status_code INTEGER,
  success BOOLEAN NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  duration_ms INTEGER,
  
  delivered_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_delivery_log_endpoint
  ON webhook_delivery_log(endpoint_id, delivered_at DESC);

CREATE INDEX idx_delivery_log_event
  ON webhook_delivery_log(event_id);
```

### 1b. Webhook Delivery Engine

Create server/webhooks/delivery.ts (or server/actions/webhook-delivery.ts
if that directory already exists for action types):

```typescript
import crypto from 'crypto';

interface WebhookEvent {
  event: string;
  event_id: string;
  timestamp: string;
  workspace_id: string;
  api_version: string;
  data: any;                       // event-specific payload
}

interface DeliveryResult {
  endpointId: string;
  success: boolean;
  statusCode?: number;
  attempt: number;
  error?: string;
  durationMs: number;
}

/**
 * Sign a payload with HMAC-SHA256.
 * The signature is sent in X-Pandora-Signature header.
 * Consumers verify by computing the same HMAC over the raw body.
 */
export function signPayload(body: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

/**
 * Deliver a webhook event to a single endpoint.
 * Returns the delivery result regardless of success/failure.
 */
export async function deliverWebhook(
  endpoint: { id: string; url: string; secret: string },
  event: WebhookEvent
): Promise<DeliveryResult> {
  const body = JSON.stringify(event);
  const signature = signPayload(body, endpoint.secret);
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pandora-Signature': `sha256=${signature}`,
        'X-Pandora-Event': event.event,
        'X-Pandora-Event-Id': event.event_id,
        'X-Pandora-Timestamp': event.timestamp,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      endpointId: endpoint.id,
      success: response.ok,
      statusCode: response.status,
      attempt: 1,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      endpointId: endpoint.id,
      success: false,
      error: err.message || 'Delivery failed',
      attempt: 1,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Deliver with retry. 3 attempts, exponential backoff.
 * Fire-and-forget — caller does not await retries.
 */
export async function deliverWithRetry(
  endpoint: { id: string; url: string; secret: string },
  event: WebhookEvent,
  maxAttempts: number = 3
): Promise<DeliveryResult> {
  const delays = [0, 60_000, 300_000]; // immediate, 1min, 5min
  let lastResult: DeliveryResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));
    }

    lastResult = await deliverWebhook(endpoint, event);
    lastResult.attempt = attempt;

    // Log delivery attempt
    await logDelivery(endpoint.id, event, lastResult);

    if (lastResult.success) {
      // Reset consecutive failures
      await db.query(`
        UPDATE webhook_endpoints SET 
          consecutive_failures = 0,
          last_success_at = NOW()
        WHERE id = $1
      `, [endpoint.id]);
      return lastResult;
    }
  }

  // All attempts failed — increment consecutive failures
  await db.query(`
    UPDATE webhook_endpoints SET 
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = NOW(),
      -- Circuit breaker: disable after 10 consecutive failures
      enabled = CASE WHEN consecutive_failures + 1 >= 10 THEN false ELSE enabled END,
      disabled_reason = CASE WHEN consecutive_failures + 1 >= 10 THEN 'consecutive_failures' ELSE disabled_reason END
    WHERE id = $1
  `, [endpoint.id]);

  return lastResult!;
}

async function logDelivery(
  endpointId: string,
  event: WebhookEvent,
  result: DeliveryResult
) {
  await db.query(`
    INSERT INTO webhook_delivery_log 
      (endpoint_id, workspace_id, event_type, event_id, payload, 
       status_code, success, attempt, error, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    endpointId, event.workspace_id, event.event,
    event.event_id, event.data,
    result.statusCode, result.success, result.attempt,
    result.error, result.durationMs
  ]);
}
```

### 1c. Webhook CRUD + Routes

Create server/webhooks/service.ts:

```typescript
export async function createWebhookEndpoint(
  workspaceId: string,
  data: { url: string; eventTypes?: string[] }
) {
  const secret = crypto.randomBytes(32).toString('hex');

  const result = await db.query(`
    INSERT INTO webhook_endpoints 
      (workspace_id, url, secret, event_types)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [workspaceId, data.url, secret, data.eventTypes || null]);

  // Return secret ONCE — consumer must save it
  return { ...result.rows[0], secret };
}

export async function listWebhookEndpoints(workspaceId: string) {
  const result = await db.query(`
    SELECT id, workspace_id, url, enabled, event_types,
      last_success_at, last_failure_at, consecutive_failures,
      disabled_reason, created_at
    FROM webhook_endpoints 
    WHERE workspace_id = $1
    ORDER BY created_at DESC
  `, [workspaceId]);
  // NOTE: Never return the secret in list responses
  return result.rows;
}

export async function deleteWebhookEndpoint(workspaceId: string, endpointId: string) {
  await db.query(`
    DELETE FROM webhook_endpoints 
    WHERE id = $1 AND workspace_id = $2
  `, [endpointId, workspaceId]);
}

export async function testWebhookEndpoint(workspaceId: string, endpointId: string) {
  const endpoint = await db.query(`
    SELECT id, url, secret FROM webhook_endpoints 
    WHERE id = $1 AND workspace_id = $2
  `, [endpointId, workspaceId]);

  if (!endpoint.rows[0]) throw new Error('Endpoint not found');

  const testEvent: WebhookEvent = {
    event: 'webhook.test',
    event_id: `evt_test_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    api_version: '2026-03-01',
    data: {
      message: 'This is a test webhook from Pandora.',
      workspace_id: workspaceId,
    },
  };

  return deliverWebhook(endpoint.rows[0], testEvent);
}
```

Wire routes:

```
GET    /api/workspaces/:id/webhook-endpoints
POST   /api/workspaces/:id/webhook-endpoints
DELETE /api/workspaces/:id/webhook-endpoints/:endpointId
POST   /api/workspaces/:id/webhook-endpoints/:endpointId/test
GET    /api/workspaces/:id/webhook-endpoints/:endpointId/deliveries
```

---

## Step 2: prospect.scored Event Type

This is the core addition — emit webhook events when prospect scores change.

### 2a. Event Emitter

Create server/webhooks/prospect-score-events.ts:

```typescript
import { deliverWithRetry } from './delivery';

/**
 * Emit prospect.scored events for all entities whose scores changed.
 * Called at the end of each scoring run.
 * 
 * Only emits for entities where score actually changed (scoreChange != 0)
 * to avoid flooding endpoints with no-op events.
 */
export async function emitProspectScoredEvents(
  workspaceId: string,
  scoredEntities: ScoredEntity[]
): Promise<{ emitted: number; endpoints: number; errors: number }> {
  
  // Only emit for entities with actual score changes
  const changed = scoredEntities.filter(e => 
    e.scoreChange !== 0 && e.scoreChange !== null
  );

  if (changed.length === 0) {
    return { emitted: 0, endpoints: 0, errors: 0 };
  }

  // Load active endpoints that accept prospect.scored events
  const endpoints = await db.query(`
    SELECT id, url, secret 
    FROM webhook_endpoints
    WHERE workspace_id = $1 
      AND enabled = true
      AND (event_types IS NULL OR 'prospect.scored' = ANY(event_types))
  `, [workspaceId]);

  if (endpoints.rows.length === 0) {
    return { emitted: 0, endpoints: 0, errors: 0 };
  }

  // Load workspace name for the envelope
  const ws = await db.query(
    `SELECT name FROM workspaces WHERE id = $1`, [workspaceId]
  );
  const workspaceName = ws.rows[0]?.name || 'Unknown';

  let emitted = 0;
  let errors = 0;

  // Batch: emit one event per changed entity
  for (const entity of changed) {
    const event = buildProspectScoredEvent(entity, workspaceId, workspaceName);

    // Deliver to all endpoints (fire and forget per endpoint)
    for (const endpoint of endpoints.rows) {
      deliverWithRetry(endpoint, event)
        .then(result => {
          if (!result.success) errors++;
        })
        .catch(() => errors++);
    }

    emitted++;
  }

  return { emitted, endpoints: endpoints.rows.length, errors };
}

interface ScoredEntity {
  entityType: 'deal' | 'contact';
  entityId: string;
  sourceObject: string;          // 'lead' | 'contact' | 'deal'
  sourceId: string;              // CRM external ID
  source: string;                // 'hubspot' | 'salesforce'
  email?: string;
  name?: string;

  totalScore: number;
  grade: string;
  fitScore: number;
  engagementScore: number;
  intentScore: number;
  timingScore: number;

  scoreMethod: string;
  scoreConfidence: number;
  segment?: string;
  scoreSummary: string;
  topPositiveFactor: string;
  topNegativeFactor: string;
  recommendedAction?: string;
  scoreFactors: any[];
  segmentBenchmarks?: any;

  previousScore: number | null;
  scoreChange: number | null;
  scoredAt: string;
}

function buildProspectScoredEvent(
  entity: ScoredEntity,
  workspaceId: string,
  workspaceName: string
): WebhookEvent {
  return {
    event: 'prospect.scored',
    event_id: `evt_ps_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    api_version: '2026-03-01',
    data: {
      workspace_name: workspaceName,
      prospect: {
        pandora_id: entity.entityId,
        entity_type: entity.entityType,
        source: entity.source,
        source_object: entity.sourceObject,
        source_id: entity.sourceId,
        email: entity.email,
        name: entity.name,

        // Core scores
        pandora_prospect_score: entity.totalScore,
        pandora_prospect_grade: entity.grade,
        pandora_fit_score: entity.fitScore,
        pandora_engagement_score: entity.engagementScore,
        pandora_intent_score: entity.intentScore,
        pandora_timing_score: entity.timingScore,

        // Metadata
        pandora_score_method: entity.scoreMethod,
        pandora_score_confidence: entity.scoreConfidence,
        pandora_scored_at: entity.scoredAt,

        // Show your math
        pandora_score_summary: entity.scoreSummary,
        pandora_top_positive_factor: entity.topPositiveFactor,
        pandora_top_negative_factor: entity.topNegativeFactor,
        pandora_recommended_action: entity.recommendedAction,
        pandora_score_factors: entity.scoreFactors,

        // Segment
        pandora_segment: entity.segment,
        pandora_segment_benchmarks: entity.segmentBenchmarks,

        // Delta
        previous_score: entity.previousScore,
        score_change: entity.scoreChange,
      },
    },
  };
}
```

### 2b. Wire Into Scoring Engine

In server/skills/compute/lead-scoring.ts, find where scores are persisted
(the upsert to lead_scores). After persistence completes and the
scored entities array is available, add the webhook emission:

```typescript
import { emitProspectScoredEvents } from '../../webhooks/prospect-score-events';

// After all scores persisted...
// Build ScoredEntity[] from the scoring results
// The data is already in memory from the scoring run — just reshape it

const scoredEntities: ScoredEntity[] = [
  ...dealResults.map(d => ({
    entityType: 'deal' as const,
    entityId: d.entityId,
    sourceObject: 'deal',
    sourceId: d.sourceId,       // deals.source_id (CRM external ID)
    source: d.source,           // deals.source ('hubspot' | 'salesforce')
    name: d.dealName,
    totalScore: d.totalScore,
    grade: d.grade,
    fitScore: d.fitScore,
    engagementScore: d.engagementScore,
    intentScore: d.intentScore,
    timingScore: d.timingScore,
    scoreMethod: d.scoreMethod,
    scoreConfidence: d.scoreConfidence,
    segment: d.segmentLabel,
    scoreSummary: d.scoreSummary,
    topPositiveFactor: d.topPositiveFactor,
    topNegativeFactor: d.topNegativeFactor,
    recommendedAction: d.recommendedAction,
    scoreFactors: d.scoreFactors,
    segmentBenchmarks: d.segmentBenchmarks,
    previousScore: d.previousScore,
    scoreChange: d.scoreChange,
    scoredAt: new Date().toISOString(),
  })),
  ...contactResults.map(c => ({
    entityType: 'contact' as const,
    entityId: c.entityId,
    sourceObject: c.sourceObject || 'contact',
    sourceId: c.sourceId,
    source: c.source,
    email: c.email,
    name: c.name,
    totalScore: c.totalScore,
    grade: c.grade,
    fitScore: c.fitScore,
    engagementScore: c.engagementScore,
    intentScore: c.intentScore,
    timingScore: c.timingScore,
    scoreMethod: c.scoreMethod,
    scoreConfidence: c.scoreConfidence,
    segment: c.segmentLabel,
    scoreSummary: c.scoreSummary,
    topPositiveFactor: c.topPositiveFactor,
    topNegativeFactor: c.topNegativeFactor,
    recommendedAction: c.recommendedAction,
    scoreFactors: c.scoreFactors,
    segmentBenchmarks: c.segmentBenchmarks,
    previousScore: c.previousScore,
    scoreChange: c.scoreChange,
    scoredAt: new Date().toISOString(),
  })),
];

// Emit webhooks — fire and forget, never blocks scoring
emitProspectScoredEvents(workspaceId, scoredEntities)
  .then(result => {
    if (result.emitted > 0) {
      console.log(`[Webhooks] Emitted ${result.emitted} prospect.scored events to ${result.endpoints} endpoints`);
    }
  })
  .catch(err => {
    console.warn('[Webhooks] Failed to emit prospect.scored events', err);
  });
```

### 2c. Batch vs. Individual Events

For a workspace with 5,000+ contacts, emitting 5,000 individual webhook
events on every scoring run would flood any endpoint. Two options:

**Option A (recommended): Only emit for significant changes.**
Filter to entities where |scoreChange| >= 5 OR gradeChanged. This
typically reduces the event count to 50-200 per run — meaningful
changes only.

```typescript
const changed = scoredEntities.filter(e => {
  if (e.scoreChange === null || e.scoreChange === 0) return false;
  // Only emit for significant changes
  if (Math.abs(e.scoreChange) >= 5) return true;
  // Always emit for grade changes
  if (e.previousGrade && e.previousGrade !== e.grade) return true;
  return false;
});
```

**Option B: Batch digest event.**
Instead of individual events, emit a single `prospect.scores.batch`
event with an array of all changed scores. Better for bulk processing
but harder for customers to filter.

Start with Option A. Add Option B later if customers need it.

---

## Step 3: Webhook Management UI (Replit)

Add a settings page for webhook configuration. Minimal UI:

### Settings → Webhooks page

- List existing endpoints (url, enabled status, last success/failure)
- "Add Webhook" form: URL input + optional event type filter
- Show the signing secret ONCE on creation (modal with copy button)
- "Test" button per endpoint → calls test route, shows result
- "Delete" button with confirmation
- Recent deliveries table (last 20) with status codes

### Route wiring

If not already wired in Step 1:

```
GET    /api/workspaces/:id/webhook-endpoints
POST   /api/workspaces/:id/webhook-endpoints
       Body: { url: string, event_types?: string[] }
       Returns: { ...endpoint, secret: string }  ← only time secret is returned

DELETE /api/workspaces/:id/webhook-endpoints/:endpointId

POST   /api/workspaces/:id/webhook-endpoints/:endpointId/test
       Returns: { success, statusCode, durationMs, error? }

GET    /api/workspaces/:id/webhook-endpoints/:endpointId/deliveries
       Query: ?limit=20
       Returns: DeliveryLogEntry[]
```

---

## Step 4: Verification

### 4a. Set up a test endpoint

Use a free webhook testing service or a simple local receiver:

```bash
# Option 1: webhook.site (public, temporary)
# Create a URL at https://webhook.site and copy it

# Option 2: local receiver for testing
node -e "
  const http = require('http');
  http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      console.log('Body:', body);
      res.writeHead(200);
      res.end('OK');
    });
  }).listen(9999, () => console.log('Webhook receiver on :9999'));
"
```

### 4b. Register the endpoint

```bash
curl -X POST http://localhost:5000/api/workspaces/<frontera_id>/webhook-endpoints \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://webhook.site/your-unique-id" }'

# Save the returned secret for verification
```

### 4c. Test delivery

```bash
curl -X POST http://localhost:5000/api/workspaces/<frontera_id>/webhook-endpoints/<endpoint_id>/test

# Check webhook.site for the test event
```

### 4d. Trigger a real scoring run

```bash
curl -X POST http://localhost:5000/api/workspaces/<frontera_id>/prospect-scores/run

# Check webhook.site for prospect.scored events
# Should see events only for entities with score changes >= 5
```

### 4e. Verify HMAC signature

```javascript
// Consumer-side verification example
const crypto = require('crypto');

function verifySignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return `sha256=${expected}` === signature;
}

// Check X-Pandora-Signature header against the raw body
```

### 4f. Check delivery logs

```bash
curl http://localhost:5000/api/workspaces/<frontera_id>/webhook-endpoints/<endpoint_id>/deliveries

# Should show the test event + any prospect.scored events
# Each with success=true, statusCode=200, durationMs
```

### 4g. SQL verification

```sql
-- Webhook endpoints registered
SELECT id, url, enabled, event_types, consecutive_failures
FROM webhook_endpoints
WHERE workspace_id = '<frontera_id>';

-- Delivery log
SELECT event_type, success, status_code, attempt, duration_ms
FROM webhook_delivery_log
WHERE workspace_id = '<frontera_id>'
ORDER BY delivered_at DESC
LIMIT 20;
```

---

## What This Unlocks

Once webhooks ship, customers can:

1. **Push scores to n8n/Zapier** → trigger workflows when A-grade
   prospects are identified or when scores drop significantly

2. **Sync to CRM** → webhook receiver updates HubSpot/Salesforce
   custom fields with Pandora scores (CRM writeback via webhook
   is simpler than building direct CRM write into Pandora)

3. **Feed to Slack** → webhook receiver posts to Slack channels
   when specific conditions are met (new A-grade, score drop > 20)

4. **Populate data warehouse** → webhook receiver inserts into
   BigQuery/Snowflake for cross-platform scoring analytics

The webhook payload includes every Pandora field from the spec:
score, grade, 4 components, factors array, summary, segment,
benchmarks, action recommendation. Any downstream system gets
the full picture, not just a number.

---

## What NOT to Build

- CRM writeback (that's the next prompt — uses webhooks OR direct API)
- Webhook retry queue (v1 uses in-process retry, not a job queue)
- Webhook transformation templates (customers handle mapping)
- Rate limiting on the Pandora side (circuit breaker is sufficient)
- Bulk export endpoint (that's a separate feature)

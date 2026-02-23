# Webhook Enrichment Connector

Bidirectional webhook connector that enables Pandora to send account data to third-party tools (Clay, Zapier, Make, n8n) and receive enriched data back. Implements full retry logic, dead letter queue, idempotency, and 207 Multi-Status responses per the spec.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  WEBHOOK CONNECTOR                           │
├──────────────────────────────┬──────────────────────────────┤
│  OUTBOUND                     │  INBOUND                     │
│  Pandora → Third Party        │  Third Party → Pandora       │
├──────────────────────────────┼──────────────────────────────┤
│  1. Get closed-won accounts   │  1. Validate token           │
│  2. POST to user's endpoint   │  2. Check batch_id duplicate │
│  3. Retry on failure          │  3. Normalize records        │
│  4. Move to DLQ after 7 tries │  4. Match to CRM accounts    │
│                               │  5. Calculate confidence     │
│                               │  6. Save enriched_accounts   │
│                               │  7. Return 207 Multi-Status  │
└──────────────────────────────┴──────────────────────────────┘
```

## Database Tables

### 1. `webhook_tokens`
Stores rotatable authentication tokens for inbound webhooks.

**Key Features:**
- One active token per workspace
- URL-safe random tokens (32 bytes, base64url encoded)
- Token rotation invalidates old tokens
- Tokens embedded in webhook URL path

**Schema:**
```sql
id                TEXT PRIMARY KEY
workspace_id      TEXT REFERENCES workspaces
token             TEXT UNIQUE
is_active         BOOLEAN (only one active per workspace)
created_at        TIMESTAMPTZ
rotated_at        TIMESTAMPTZ
```

### 2. `webhook_outbound_configs`
User-configured webhook URLs for outbound enrichment.

**Schema:**
```sql
id                  TEXT PRIMARY KEY
workspace_id        TEXT REFERENCES workspaces (UNIQUE)
endpoint_url        TEXT
is_active           BOOLEAN
last_test_at        TIMESTAMPTZ
last_test_success   BOOLEAN
last_test_error     TEXT
```

### 3. `webhook_delivery_log`
Tracks all outbound delivery attempts and retries.

**Schema:**
```sql
id               TEXT PRIMARY KEY
workspace_id     TEXT REFERENCES workspaces
batch_id         TEXT (pandora_batch_id for idempotency)
endpoint_url     TEXT
payload          JSONB
attempt_number   INTEGER (1-7)
status_code      INTEGER
response_body    TEXT
error_message    TEXT
delivered_at     TIMESTAMPTZ
retry_at         TIMESTAMPTZ (next scheduled retry)
```

### 4. `webhook_dead_letter_queue`
Failed payloads after exhausting all retries.

**Schema:**
```sql
id                 TEXT PRIMARY KEY
workspace_id       TEXT REFERENCES workspaces
batch_id           TEXT
endpoint_url       TEXT
payload            JSONB
final_error        TEXT
final_status_code  INTEGER
total_attempts     INTEGER
failed_at          TIMESTAMPTZ
replayed           BOOLEAN
replayed_at        TIMESTAMPTZ
replay_result      TEXT
```

### 5. `webhook_inbound_log`
Tracks inbound webhook deliveries for idempotency.

**Key Feature:** Unique constraint on `(workspace_id, batch_id)` prevents duplicate processing.

**Schema:**
```sql
id                 TEXT PRIMARY KEY
workspace_id       TEXT REFERENCES workspaces
batch_id           TEXT (from pandora_batch_id)
records_received   INTEGER
records_processed  INTEGER
records_matched    INTEGER
records_failed     INTEGER
error_details      JSONB
received_at        TIMESTAMPTZ
UNIQUE (workspace_id, batch_id)
```

## Components

### 1. Token Manager (`webhook-token-manager.ts`)

Manages rotatable authentication tokens for inbound webhooks.

**Functions:**
- `generateSecureToken()` - Generate URL-safe random token
- `getActiveToken(workspaceId)` - Get or create active token
- `rotateToken(workspaceId)` - Rotate token (invalidates old)
- `validateToken(token)` - Verify token and return workspace_id
- `getWebhookUrl(workspaceId, baseUrl)` - Build full webhook URL

**Token Format:** `tk_{base64url-encoded-32-bytes}`

**Example URL:**
```
https://app.pandora.io/webhooks/enrich/ws_abc123/tk_xyz789...
```

### 2. Outbound Handler (`webhook-outbound.ts`)

Sends account data to third-party webhook endpoints.

**Retry Schedule (per spec):**
| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 | Immediate | 0s |
| 2 | 30 seconds | 30s |
| 3 | 2 minutes | 2m 30s |
| 4 | 10 minutes | 12m 30s |
| 5 | 30 minutes | 42m 30s |
| 6 | 2 hours | 2h 42m |
| 7 | 6 hours | 8h 42m |

**Error Handling:**

**Never Retry (Configuration Errors):**
- 400 - Bad Request
- 401 - Unauthorized
- 403 - Forbidden
- 404 - Not Found
- 410 - Gone
- 422 - Unprocessable Entity
- SSL errors

**Retry with Exponential Backoff:**
- 408 - Request Timeout
- 429 - Rate Limited (respects Retry-After header)
- 500-504 - Server errors
- DNS failures
- Connection refused
- Network timeouts

**Outbound Payload Format:**
```json
{
  "pandora_batch_id": "batch_abc123",
  "workspace_id": "ws_xyz789",
  "triggered_at": "2026-02-22T10:00:00Z",
  "account_count": 47,
  "accounts": [
    {
      "domain": "acme.com",
      "company_name": "Acme Corp",
      "crm_account_id": "0012300000AbcXYZ",
      "close_date": "2025-11-15",
      "deal_value": 48000
    }
  ]
}
```

**Functions:**
- `sendOutboundWebhook(workspaceId, endpointUrl, attemptNumber)` - Send payload
- `processPendingRetries()` - Background job to process scheduled retries
- `replayDeadLetter(workspaceId, dlqId)` - Manually replay failed delivery

### 3. Inbound Handler (`webhook-inbound.ts`)

Processes enrichment data from third-party tools.

**Idempotency:**
- Checks `pandora_batch_id` against `webhook_inbound_log`
- If duplicate detected, returns 200 immediately without processing
- Prevents double-enrichment when retries arrive after delayed success

**Response Status Codes:**
- **200** - All records processed successfully
- **207 Multi-Status** - Partial success (some records failed)
- **400 Bad Request** - Invalid JSON payload
- **401 Unauthorized** - Invalid or expired token
- **413 Payload Too Large** - Payload exceeds 5MB
- **422 Unprocessable** - All records missing required fields
- **429 Too Many Requests** - Rate limit (>60 req/min)

**207 Multi-Status Response Example:**
```json
{
  "success": false,
  "status": "partial",
  "batch_id": "batch_abc123",
  "records_received": 10,
  "records_matched": 7,
  "records_failed": 3,
  "errors": [
    {
      "record_index": 2,
      "domain": "unknown.com",
      "error": "No matching CRM account found"
    },
    {
      "record_index": 5,
      "company_name": "Test Corp",
      "error": "Missing required field: domain or company_name must be present"
    }
  ],
  "processing_time_ms": 1234,
  "message": "Some records processed successfully, others failed. See errors for details."
}
```

**Inbound Payload Format:**
```json
{
  "pandora_batch_id": "batch_abc123",
  "records": [
    {
      "domain": "acme.com",
      "company_name": "Acme Corp",
      "industry": "SaaS",
      "employee_count": 145,
      "employee_range": "101-200",
      "revenue_range": "$10M-$50M",
      "funding_stage": "Series B",
      "hq_country": "US",
      "hq_state": "California",
      "hq_city": "San Francisco",
      "tech_stack": ["Salesforce", "Gong", "Slack"],
      "growth_signal": "growing",
      "founded_year": 2018,
      "public_or_private": "private"
    }
  ]
}
```

**Functions:**
- `processInboundWebhook(workspaceId, payload)` - Main processing logic
- `getInboundHistory(workspaceId, limit)` - Get processing history

### 4. Normalizer (`webhook-normalizer.ts`)

Normalizes flexible field formats from third-party tools.

**Flexible Field Handling:**

**Domain:**
- Removes `https://`, `http://`, `www.`
- Extracts hostname from full URLs
- Normalizes to lowercase

**Employee Count:**
- Accepts numbers: `500`
- Accepts strings with commas: `"1,500"`
- Parses to integer

**Tech Stack:**
- Accepts array: `["Salesforce", "Gong"]`
- Accepts pipe-separated: `"Salesforce|Gong|Slack"`
- Accepts comma-separated: `"Salesforce, Gong, Slack"`
- Accepts JSON string: `'["Salesforce", "Gong"]'`

**Founded Year:**
- Validates range: 1800 to current year + 1
- Rejects invalid years

**Functions:**
- `normalizeWebhookRecord(record)` - Normalize single record
- `validateInboundPayload(payload)` - Validate payload structure

## API Routes

### Outbound Configuration

#### POST `/:workspaceId/enrichment/webhook/outbound/config`
Save outbound webhook URL.

**Request:**
```json
{ "endpoint_url": "https://hooks.clay.com/xyz" }
```

**Response:**
```json
{ "success": true, "message": "Outbound webhook URL saved" }
```

#### GET `/:workspaceId/enrichment/webhook/outbound/config`
Get outbound configuration.

**Response:**
```json
{
  "configured": true,
  "endpoint_url": "https://hooks.clay.com/xyz",
  "is_active": true,
  "last_test": {
    "at": "2026-02-22T10:00:00Z",
    "success": true,
    "error": null
  }
}
```

#### DELETE `/:workspaceId/enrichment/webhook/outbound/config`
Remove outbound webhook.

#### POST `/:workspaceId/enrichment/webhook/outbound/test`
Test connection to outbound webhook.

#### POST `/:workspaceId/enrichment/webhook/outbound/trigger`
Trigger outbound enrichment manually.

### Inbound Configuration

#### GET `/:workspaceId/enrichment/webhook/inbound/url`
Get inbound webhook URL.

**Response:**
```json
{
  "webhook_url": "https://app.pandora.io/webhooks/enrich/ws_abc123/tk_xyz789...",
  "created_at": "2026-02-22T10:00:00Z"
}
```

#### POST `/:workspaceId/enrichment/webhook/inbound/rotate`
Rotate webhook token.

**Response:**
```json
{
  "success": true,
  "webhook_url": "https://app.pandora.io/webhooks/enrich/ws_abc123/tk_new123...",
  "message": "Token rotated successfully. Update your Clay/Zapier/Make workflow with the new URL."
}
```

#### GET `/:workspaceId/enrichment/webhook/inbound/history`
Get inbound processing history.

**Query Params:**
- `limit` - Max results (default: 50, max: 200)

### Dead Letter Queue

#### GET `/:workspaceId/enrichment/webhook/dlq`
List failed deliveries.

#### POST `/:workspaceId/enrichment/webhook/dlq/:dlqId/replay`
Manually replay a failed delivery.

### Public Inbound Endpoint

#### POST `/webhooks/enrich/:workspaceId/:token`
Receive enrichment data from third-party tools.

**Headers:**
- `Content-Type: application/json`

**Authentication:** Token in URL path

**Payload Size Limit:** 5MB

**Rate Limit:** 60 requests/minute

## Idempotency Implementation

### Outbound Idempotency
Every outbound payload includes `pandora_batch_id`. If a retry succeeds after a previous delayed success, the third-party tool can deduplicate using this ID.

### Inbound Idempotency
1. `pandora_batch_id` is echoed back in inbound payload
2. First processing logs batch_id in `webhook_inbound_log` with UNIQUE constraint
3. Subsequent deliveries with same batch_id are detected and skipped (200 response)
4. Prevents double-enrichment of accounts

**Example Scenario:**
```
1. Third-party POSTs enrichment (batch_abc123)
2. Pandora processes, saves to enriched_accounts
3. Network hiccup causes timeout
4. Third-party retries same batch_abc123
5. Pandora detects duplicate, returns 200 immediately
6. No duplicate enrichment saved
```

## Background Jobs

### Retry Processor
Runs every 1 minute to process scheduled retries.

**Pseudo-code:**
```typescript
setInterval(async () => {
  const pending = await query(`
    SELECT * FROM webhook_delivery_log
    WHERE retry_at <= NOW()
      AND delivered_at IS NULL
    LIMIT 100
  `);

  for (const retry of pending) {
    await sendOutboundWebhook(retry.workspace_id, retry.endpoint_url, retry.attempt_number);
  }
}, 60000);
```

## Security

- **Token Generation:** 32-byte cryptographically random tokens
- **Token Rotation:** Invalidates old tokens immediately
- **URL-based Auth:** No bearer tokens, no headers - just URL path
- **Workspace Isolation:** Token validates to specific workspace_id
- **Payload Validation:** Strict JSON schema validation
- **Size Limits:** 5MB max payload size
- **Rate Limiting:** 60 req/min per workspace

## Usage Example

### Setup Outbound Webhook (Pandora → Clay)

1. In Clay, create HTTP trigger, copy webhook URL
2. POST to Pandora:
```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/webhook/outbound/config \
  -H "Content-Type: application/json" \
  -d '{"endpoint_url":"https://hooks.clay.com/xyz"}'
```

3. Test connection:
```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/webhook/outbound/test
```

4. Trigger enrichment:
```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/webhook/outbound/trigger
```

### Setup Inbound Webhook (Clay → Pandora)

1. Get Pandora webhook URL:
```bash
curl https://app.pandora.io/api/workspaces/ws_123/enrichment/webhook/inbound/url
# Returns: https://app.pandora.io/webhooks/enrich/ws_123/tk_xyz...
```

2. In Clay, add HTTP API step at end of workflow
3. Set method: POST
4. Set URL: (paste Pandora webhook URL)
5. Map fields to Pandora schema
6. Run Clay table

### Rotate Token

```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/webhook/inbound/rotate
```

**Important:** Update your Clay/Zapier/Make workflow with the new URL immediately.

## Error Handling Best Practices

1. **Configuration Errors (400-404, 422):** Surface immediately, don't retry
2. **Server Errors (500-504):** Retry with exponential backoff
3. **Rate Limits (429):** Respect Retry-After header
4. **Timeouts:** Retry (30s timeout per request)
5. **Dead Letter Queue:** Alert workspace admin after final retry

## Testing

Test outbound delivery:
```typescript
import { sendOutboundWebhook } from './enrichment/webhook-outbound.js';

const result = await sendOutboundWebhook('ws_123', 'https://hooks.clay.com/xyz');
console.log('Success:', result.success);
console.log('Batch ID:', result.batch_id);
```

Test inbound processing:
```typescript
import { processInboundWebhook } from './enrichment/webhook-inbound.js';

const payload = {
  pandora_batch_id: 'batch_test123',
  records: [
    {
      domain: 'acme.com',
      company_name: 'Acme Corp',
      industry: 'SaaS',
      employee_count: 145,
    }
  ]
};

const result = await processInboundWebhook('ws_123', payload);
console.log('Status:', result.status);
console.log('Status Code:', result.status_code);
console.log('Matched:', result.records_matched);
console.log('Failed:', result.records_failed);
```

## Next Steps

1. ✅ Database migration + webhook tables
2. ✅ Token management
3. ✅ Outbound delivery with retry logic
4. ✅ Inbound processing with 207 Multi-Status
5. ✅ Dead letter queue
6. ✅ Idempotency (batch_id deduplication)
7. ⏳ Background job scheduler for retries
8. ⏳ UI for connector management

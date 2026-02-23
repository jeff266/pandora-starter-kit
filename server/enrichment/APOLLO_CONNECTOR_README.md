# Apollo Account Enrichment Connector

Provider-agnostic account enrichment system that pulls firmographic data from Apollo.io and stores it in a normalized schema with confidence scoring.

## Architecture

```
┌─────────────────┐
│ CRM Accounts    │
│ (Closed-Won)    │
└────────┬────────┘
         │
         v
┌─────────────────┐      ┌──────────────┐
│ Account Matcher │─────>│ Apollo API   │
│ (domain/name)   │      │ /v1/orgs     │
└────────┬────────┘      └──────┬───────┘
         │                      │
         v                      v
┌─────────────────┐      ┌──────────────┐
│ Normalizer      │<─────│ API Response │
│ (to Pandora)    │      └──────────────┘
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Confidence      │
│ Scorer (0-1.0)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ enriched_       │
│ accounts table  │
└─────────────────┘
```

## Components

### 1. Database Migration (`migrations/081_enriched_accounts.sql`)

Creates the `enriched_accounts` table with:
- Normalized firmographic fields (employee_count, revenue_range, tech_stack, etc.)
- Multi-source support (apollo, webhook, csv)
- Confidence scoring (0.0-1.0)
- Idempotency tracking via `pandora_batch_id`

**Key Fields:**
- `domain`, `company_name` - Identifiers
- `industry`, `employee_count`, `employee_range` - Firmographics
- `revenue_range`, `funding_stage` - Financial signals
- `hq_country`, `hq_state`, `hq_city` - Location
- `tech_stack` - Array of technologies
- `confidence_score` - Data quality score (0.0-1.0)
- `enrichment_source` - apollo/webhook/csv

### 2. Confidence Scorer (`confidence-scorer.ts`)

Calculates confidence score based on field completeness:

| Score Range | Label | Requirements |
|-------------|-------|--------------|
| 0.9-1.0 | High | domain + industry + employee_count + revenue_range + tech_stack |
| 0.7-0.89 | Medium | domain + industry + employee_count |
| 0.5-0.69 | Low | (domain OR company_name) + 2+ other fields |
| <0.5 | Insufficient | Missing identifiers or <2 fields |

**Functions:**
- `calculateConfidenceScore(data)` - Returns 0.0-1.0 score
- `getConfidenceLabel(score)` - Returns 'high'/'medium'/'low'/'insufficient'
- `calculateAverageConfidence(accounts)` - Average across array
- `getICPProfileStatus(score)` - Returns ICP match status

### 3. Apollo Client (`apollo-client.ts`)

Handles Apollo.io API calls with rate limiting.

**Rate Limiting:**
- 200ms delay between requests (300 req/min, conservative)
- Sequential processing to avoid 429 errors

**Methods:**
- `enrichOrganization(domain)` - Enrich single organization
- `enrichOrganizations(domains)` - Batch enrichment (sequential)
- `testApolloApiKey(apiKey)` - Validate API key

**API Endpoint:** `POST https://api.apollo.io/v1/organizations/enrich`

**Error Handling:**
- 401/403 - Authentication failure
- 429 - Rate limit exceeded
- 500+ - Server error

### 4. Apollo Normalizer (`apollo-normalizer.ts`)

Maps Apollo API response to Pandora schema.

**Field Mappings:**
- `primary_domain` → `domain` (with fallback to website_url)
- `estimated_num_employees` → `employee_count` + derive `employee_range`
- `annual_revenue_printed` → `revenue_range` (preserved as-is)
- `funding_total_usd` → derive `funding_stage` (Seed/Series A/B/C/etc.)
- `publicly_traded_symbol` → `public_or_private`
- `technology_names` → `tech_stack`

**Derivation Logic:**
- **Employee Range:** Buckets into 1-10, 11-50, 51-200, 201-500, 501-1000, etc.
- **Funding Stage:** Maps total funding to Bootstrapped, Seed, Series A/B/C/D+, Late Stage
- **Ownership:** Public if `publicly_traded_symbol` exists, otherwise Private

### 5. Account Matcher (`account-matcher.ts`)

Links enriched data to CRM accounts using two strategies:

**Strategy 1: Exact Domain Match (confidence: 1.0)**
```sql
SELECT id, name FROM accounts
WHERE LOWER(REPLACE(domain, 'www.', '')) = $domain
```

**Strategy 2: Fuzzy Name Match (confidence: 0.5-0.9)**
```sql
SELECT id, name, SIMILARITY(LOWER(name), LOWER($company_name)) as similarity
FROM accounts
WHERE SIMILARITY(LOWER(name), LOWER($company_name)) > 0.5
ORDER BY similarity DESC
```

Requires PostgreSQL `pg_trgm` extension for trigram similarity.

**Functions:**
- `matchEnrichedAccount(workspaceId, domain, companyName)` - Find matching account
- `getClosedWonAccountDomains(workspaceId)` - Get accounts with closed-won deals

### 6. Enrichment Service (`apollo-enrichment-service.ts`)

Orchestrates the full enrichment workflow:

1. Get closed-won accounts from workspace
2. Call Apollo API for each domain
3. Normalize Apollo response
4. Calculate confidence score
5. Save to `enriched_accounts` table (upsert)

**Functions:**
- `runApolloEnrichment(workspaceId, apiKey, onProgress?)` - Full workflow
- `getEnrichmentStats(workspaceId)` - Workspace statistics

**Returns:**
```typescript
{
  success: boolean;
  total_accounts: number;
  enriched_count: number;
  failed_count: number;
  average_confidence: number;
  errors: string[];
}
```

### 7. API Routes (`routes/enrichment.ts`)

#### POST `/:workspaceId/enrichment/apollo/connect`
Save encrypted Apollo API key for workspace.

**Request:**
```json
{ "api_key": "your-apollo-key" }
```

**Response:**
```json
{ "success": true, "message": "Apollo API key saved successfully" }
```

#### POST `/:workspaceId/enrichment/apollo/disconnect`
Remove Apollo API key from workspace.

#### POST `/:workspaceId/enrichment/apollo/run`
Trigger enrichment for all closed-won accounts in workspace.

**Response:**
```json
{
  "success": true,
  "total_accounts": 50,
  "enriched_count": 48,
  "failed_count": 2,
  "average_confidence": 0.87,
  "errors": ["domain1.com: No data returned", "domain2.com: API error"]
}
```

#### GET `/:workspaceId/enrichment/apollo/stats`
Get enrichment statistics for workspace.

**Response:**
```json
{
  "total_enriched": 100,
  "apollo_count": 75,
  "webhook_count": 20,
  "csv_count": 5,
  "average_confidence": 0.85,
  "last_enrichment": "2024-02-22T10:30:00Z",
  "apollo_connected": true
}
```

#### GET `/:workspaceId/enrichment/enriched-accounts`
List enriched accounts with filtering.

**Query Params:**
- `source` - Filter by enrichment_source (apollo/webhook/csv)
- `min_confidence` - Minimum confidence score (0.0-1.0)
- `limit` - Max results (default: 50, max: 500)
- `offset` - Pagination offset

**Response:**
```json
{
  "accounts": [...],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

## Testing

Run the test suite:

```bash
npx tsx server/enrichment/test-apollo-connector.ts
```

**Tests:**
1. Confidence Scoring - Validates scoring algorithm
2. Apollo Normalizer - Validates field mapping
3. Apollo API Client - Tests API connectivity (requires `APOLLO_API_KEY` env var)

## Security

- API keys are encrypted using AES-256-CBC before storage
- Encryption key from `ENCRYPTION_KEY` environment variable
- Default key provided but should be changed in production

## Usage Example

```typescript
import { runApolloEnrichment } from './enrichment/apollo-enrichment-service.js';

const result = await runApolloEnrichment(
  'workspace-123',
  'apollo-api-key',
  (progress) => {
    console.log(`${progress.processed}/${progress.total} - ${progress.current_domain}`);
  }
);

console.log(`Enriched ${result.enriched_count} accounts`);
console.log(`Average confidence: ${result.average_confidence.toFixed(2)}`);
```

## Next Steps

1. ✅ Database migration + confidence scoring
2. ✅ Apollo connector (this implementation)
3. ⏳ Webhook connector (bidirectional)
4. ⏳ CSV upload connector
5. ⏳ UI for managing connectors

## Notes

- Apollo rate limit: 600 req/min on paid plans
- Current implementation: 300 req/min (conservative)
- Enrichment is idempotent - re-running updates existing records
- Supports multi-source enrichment (Apollo + Webhook + CSV)

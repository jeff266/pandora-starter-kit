# Salesforce CRM Adapter

Production-ready Salesforce integration for Pandora using REST API v59.0 and Bulk API 2.0.

## Authentication Setup

### Connected App Configuration

1. Navigate to **Setup → App Manager → New Connected App**
2. Configure OAuth settings:
   - **Callback URL**: `https://your-domain.com/api/oauth/salesforce/callback`
   - **Selected OAuth Scopes**:
     - `api` - Access and manage your data
     - `refresh_token` - Perform requests on your behalf at any time
     - `offline_access` - Perform requests at any time
3. Save and note the **Consumer Key** (Client ID) and **Consumer Secret**

### Production vs Sandbox

Both test orgs in this project are **production Salesforce orgs** (not sandboxes).

- **Token endpoint**: `https://login.salesforce.com/services/oauth2/token`
- **NOT**: `test.salesforce.com` (sandbox endpoint)
- **Okta SSO**: Both orgs use Okta for browser login, but this **does not affect API authentication**. API auth uses standard OAuth 2.0 flow.

### Instance URL Handling

⚠️ **CRITICAL**: Salesforce may return a **different instance_url** during token refresh (e.g., `na1.salesforce.com` → `na50.salesforce.com`). Always use the returned `instance_url` from the refresh token response.

## API Limits by Edition

| Edition        | Daily API Limit |
|----------------|-----------------|
| Professional   | 15,000          |
| Enterprise     | 100,000         |
| Unlimited      | 500,000         |

The adapter tracks usage via the `Sforce-Limit-Info` response header and logs warnings at 80% usage.

## Sync Strategy Decision Tree

The adapter automatically chooses the optimal sync method based on record count:

- **< 10,000 records**: REST API with `queryAll()` pagination
- **10,000+ records**: Bulk API 2.0
- **Future (> 2M records)**: Bulk API with PK Chunking

## Stage Mapping

Opportunity stages are normalized using Salesforce metadata:

1. **IsClosed + IsWon** → `closed_won`
2. **IsClosed + !IsWon** → `closed_lost`
3. **ForecastCategoryName** mapping:
   - `Omitted` → `awareness`
   - `Pipeline` → `qualification`
   - `Best Case` → `evaluation`
   - `Commit` → `decision`
4. **Fallback**: Use `SortOrder` position (first 33% → qualification, middle 33% → evaluation, last 33% → decision)

## Known Gotchas

### SystemModstamp vs LastModifiedDate

✅ **Use SystemModstamp** for incremental sync - it catches system-level changes (e.g., record ownership transfer, automated field updates).

❌ **Don't use LastModifiedDate** - it only tracks user-initiated changes.

### Person Accounts

Some orgs enable Person Accounts (Contact + Account merged into one record). Detection via `describeObject()` - handle in Phase 2.

### Multi-Currency Orgs

Opportunities may have `CurrencyIsoCode` field. Store in `custom_fields` for now.

### Managed Package Fields

Custom fields from managed packages use namespace: `namespace__FieldName__c`. Treat as regular custom fields.

### Owner.Email May Be Null

Some orgs don't expose `Owner.Email` in API responses. Fallback:
1. Try `Owner.Email`
2. Try `Owner.Name`
3. Use `OwnerId` (Salesforce ID)

### Empty String Sanitization

Same lesson from HubSpot production sync:
- Empty strings (`''`) for date fields → `null` (prevents PostgreSQL crashes)
- Sanitize non-UTF8 characters
- Truncate extremely long text fields to 10,000 chars

### Compound Fields

Address and Name compound fields **cannot be used in WHERE clauses**. Use individual fields (BillingStreet, FirstName, etc.).

## High-Value Custom Fields

The adapter auto-discovers these fields during schema discovery:

- MEDDIC/MEDDPICC scoring fields
- Competitor tracking
- Champion identification
- Next steps
- ARR/MRR fields
- Partner/Channel attribution

Fields with >50% fill rate are included in syncs.

## Out of Scope (Phase 1)

These will be added in future phases:

- ❌ **Lead object** - Needs normalized entity or merge into Contact
- ❌ **Task/Event** - Maps to Activities entity
- ❌ **ContentDocument** - Maps to Documents entity
- ❌ **Campaign and CampaignMember**
- ❌ **OpportunityContactRole** - Rich association data for deal-contact relationships
- ❌ **OpportunityFieldHistory** - Stage change history (feeds Pipeline Waterfall skill)

## Example Usage

```typescript
import { salesforceAdapter } from './server/connectors/salesforce/adapter.js';

// Test connection
const result = await salesforceAdapter.testConnection({
  accessToken: 'your-token',
  instanceUrl: 'https://na1.salesforce.com',
  refreshToken: 'your-refresh-token',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
});

// Discover schema
const schema = await salesforceAdapter.discoverSchema(credentials);

// Initial sync
const syncResult = await salesforceAdapter.initialSync(
  credentials,
  'workspace-id'
);

// Incremental sync
const incrementalResult = await salesforceAdapter.incrementalSync(
  credentials,
  'workspace-id',
  new Date('2024-01-01')
);
```

## Error Handling

The adapter handles these Salesforce-specific error codes:

- `INVALID_SESSION_ID` → Triggers automatic token refresh
- `REQUEST_LIMIT_EXCEEDED` → Throws (do NOT retry)
- `QUERY_TIMEOUT` → Logs query, suggests Bulk API
- `INVALID_FIELD` → Logs field name, continues with remaining fields
- `MALFORMED_QUERY` → Logs full query for debugging

## Token Refresh Flow

1. Catch `INVALID_SESSION_ID` error from any API call
2. Call `SalesforceClient.refreshAccessToken()`
3. Update stored credentials in `connector_configs` with new `accessToken` and `instanceUrl`
4. Retry the failed call with new token
5. If refresh fails, mark connector status as 'error'

## Production Deployment Checklist

- [ ] Connected App created with correct OAuth scopes
- [ ] Callback URL whitelisted in Salesforce
- [ ] Client ID and Client Secret stored securely
- [ ] Both orgs confirmed as production (login.salesforce.com)
- [ ] API limits verified for org edition
- [ ] Test connection successful
- [ ] Schema discovery returns expected custom fields
- [ ] Initial sync completes without errors
- [ ] Incremental sync detects changes correctly

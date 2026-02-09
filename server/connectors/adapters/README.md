# Pandora Adapter Architecture

## Overview

Pandora uses a **category-based adapter pattern** to normalize data from any tool in a category to a unified entity model. This allows Pandora to:

- Support multiple tools in the same category (e.g., HubSpot + Salesforce for CRM)
- Add new data sources without changing downstream code
- Query data across sources using a single schema
- Maintain source-specific details in `source_data` JSONB column

## The Four Categories

### 1. CRM → Deal, Contact, Account
Examples: HubSpot, Salesforce, Pipedrive

**Interface:** `CRMAdapter`
- `transformDeal()` - Normalize CRM opportunities/deals
- `transformContact()` - Normalize CRM contacts/leads
- `transformAccount()` - Normalize CRM companies/accounts

### 2. Conversations → Conversation
Examples: Gong, Fireflies, Fathom, Zoom AI

**Interface:** `ConversationAdapter`
- `transformConversation()` - Normalize call/meeting data with transcripts, participants, sentiment

### 3. Tasks → Task
Examples: Monday.com, Asana, Linear, Jira

**Interface:** `TaskAdapter`
- `transformTask()` - Normalize task/issue data
- `createTask()` - (Optional) Create tasks in source system
- `updateTask()` - (Optional) Update tasks in source system
- `completeTask()` - (Optional) Mark tasks as completed
- `supportsWrite` - Boolean flag for write capability

**Special:** Tasks are the only category that supports **write operations** (creating and updating records in the source system).

### 4. Documents → Document
Examples: Google Drive, Notion, SharePoint

**Interface:** `DocumentAdapter`
- `transformDocument()` - Normalize document metadata
- `extractContent()` - (Optional) Extract text content from documents

## Core Concepts

### 1. Stateless Adapters
Adapters do **not** store credentials or state. They receive credentials per call:

```typescript
await adapter.initialSync(
  credentials, // Passed on every call
  workspaceId,
  options
);
```

This enables:
- Multi-tenancy (different workspaces, different credentials)
- Credential rotation without restarting
- Easy testing (no shared state)

### 2. source_data Column
Every normalized entity has a `source_data` JSONB column containing the raw API response:

```typescript
{
  workspace_id: 'ws_123',
  source: 'hubspot',
  source_id: '12345',
  source_data: {
    // Full raw HubSpot deal object stored here
    properties: { ... },
    associations: { ... }
  },
  name: 'Enterprise Deal',
  amount: 50000,
  // ... normalized fields
}
```

**Why?**
1. **Debugging** - See exactly what the API returned
2. **Custom fields** - When workspace approves new fields, data is already stored
3. **Audit trail** - Preserve original data even if transform logic changes

### 3. Transform Conventions

**Return `null` to skip records:**
```typescript
transformDeal(deal: HubSpotDeal, workspaceId: string): NormalizedDeal {
  if (deal.properties.is_deleted === 'true') {
    return null; // This deal will be excluded from sync result
  }
  // ... transform logic
}
```

**Always populate `source_data`:**
```typescript
{
  source_data: {
    properties: deal.properties,
    associations: deal.associations,
  }
}
```

### 4. Error Handling
Use `transformWithErrorCapture` from `utils/sync-helpers.ts` for per-record error handling:

```typescript
const dealResult = transformWithErrorCapture(
  rawDeals,
  (d) => transformDeal(d, workspaceId),
  'HubSpot Deals',
  (d) => d.id
);

// dealResult = {
//   succeeded: [... normalized deals],
//   failed: [
//     { record: {...}, error: 'Invalid date format', recordId: '123' }
//   ],
//   totalAttempted: 100
// }
```

This ensures one bad record doesn't kill the entire sync.

## Adapter Registry

The `AdapterRegistry` is a singleton that stores all available adapters:

```typescript
import { getAdapterRegistry } from './adapters/registry.js';
import { HubSpotCRMAdapter } from './hubspot/adapter.js';
import { MondayTaskAdapter } from './monday/adapter.js';

const registry = getAdapterRegistry();

// Register adapters
registry.register(new HubSpotCRMAdapter());
registry.register(new MondayTaskAdapter());

// Lookup by source type
const adapter = registry.get('hubspot');

// Lookup by category
const crmAdapters = registry.getByCategory('crm');
```

## Adding a New Adapter

### Step 1: Create Client (Optional)
If the API is complex, create a pure API client first:

```typescript
// server/connectors/salesforce/client.ts
export class SalesforceClient {
  async query(credentials: SalesforceCredentials, soql: string) {
    // Pure API logic
  }
}
```

### Step 2: Create Adapter
Implement the category-specific interface:

```typescript
// server/connectors/salesforce/adapter.ts
import type { CRMAdapter, NormalizedDeal, NormalizedContact, NormalizedAccount } from '../adapters/types.js';

export class SalesforceCRMAdapter implements CRMAdapter {
  readonly sourceType = 'salesforce';
  readonly category = 'crm' as const;

  async testConnection(credentials: Record<string, any>) {
    // Test connection
  }

  async initialSync(credentials: Record<string, any>, workspaceId: string) {
    // Fetch data from Salesforce
    // Transform using transformDeal, transformContact, transformAccount
    // Return SyncResult
  }

  transformDeal(raw: any, workspaceId: string): NormalizedDeal {
    return {
      workspace_id: workspaceId,
      source: 'salesforce',
      source_id: raw.Id,
      source_data: raw,
      name: raw.Name,
      amount: raw.Amount,
      // ... map Salesforce fields to Pandora schema
    };
  }

  transformContact(raw: any, workspaceId: string): NormalizedContact { /* ... */ }
  transformAccount(raw: any, workspaceId: string): NormalizedAccount { /* ... */ }
}
```

### Step 3: Register Adapter
Add to your bootstrap/initialization code:

```typescript
import { getAdapterRegistry } from './connectors/adapters/registry.js';
import { SalesforceCRMAdapter } from './connectors/salesforce/adapter.js';

const registry = getAdapterRegistry();
registry.register(new SalesforceCRMAdapter());
```

### Step 4: Use Adapter
```typescript
const adapter = registry.get('salesforce');
if (!adapter) throw new Error('Salesforce adapter not found');

const result = await adapter.initialSync(
  { username: '...', password: '...', securityToken: '...' },
  'workspace_123'
);

// Store result.deals.succeeded, result.contacts.succeeded, result.accounts.succeeded to database
```

## Credential Patterns

### API Key (Monday.com, HubSpot)
```typescript
const credentials = {
  apiKey: 'abc123'
};
```

### OAuth 2.0 with Refresh (Google Drive, Salesforce)
```typescript
const credentials = {
  accessToken: 'ya29...',
  refreshToken: 'refresh_token',
  clientId: 'client_id',
  clientSecret: 'client_secret',
  expiresAt: 1234567890000 // Unix timestamp in ms
};
```

### Basic Auth (Jira, some tools)
```typescript
const credentials = {
  username: 'user@example.com',
  password: 'api_token'
};
```

## Write Operations (Tasks Only)

Only `TaskAdapter` supports write operations. To implement:

```typescript
export class AsanaTaskAdapter implements TaskAdapter {
  readonly supportsWrite = true; // Enable write operations

  async createTask(
    credentials: Record<string, any>,
    workspaceId: string,
    task: TaskCreateInput,
    context?: TaskContext
  ): Promise<{ success: boolean; sourceId?: string; error?: string }> {
    // Create task in Asana
    // Return { success: true, sourceId: 'asana_task_id' }
  }

  async updateTask(...) { /* ... */ }
  async completeTask(...) { /* ... */ }
}
```

## Schema Discovery (CRM Only)

CRM adapters can implement `SchemaDiscoverable` to expose custom fields:

```typescript
async discoverSchema(credentials: Record<string, any>) {
  return {
    customFields: [
      {
        key: 'annual_contract_value',
        label: 'Annual Contract Value',
        type: 'number',
        category: 'deal'
      },
      // ... more fields
    ]
  };
}
```

This allows Pandora to dynamically adapt to workspace-specific custom fields.

## Testing Adapters

```typescript
import { MondayTaskAdapter } from './monday/adapter.js';

const adapter = new MondayTaskAdapter();

// Test connection
const testResult = await adapter.testConnection({
  apiKey: 'test_key'
});
console.assert(testResult.success === true);

// Test transform (unit test)
const mockMondayItem = {
  id: '123',
  name: 'Test Task',
  column_values: [
    { id: 'status', text: 'Working on it' }
  ]
};

const normalized = adapter.transformTask(mockMondayItem, 'ws_test');
console.assert(normalized.status === 'IN_PROGRESS');
console.assert(normalized.title === 'Test Task');
```

## Future Enhancements

- **Incremental sync optimization** - Use change tracking APIs where available
- **Webhook support** - Real-time updates instead of polling
- **Conflict resolution** - Handle concurrent updates across sources
- **Schema evolution** - Automatic migration when source schemas change
- **Rate limit coordination** - Shared rate limiter across adapters for same source

## See Also

- `types.ts` - TypeScript interfaces for all adapter types
- `registry.ts` - Adapter registry implementation
- `REFACTOR_NOTES.md` - How to migrate existing connectors to this pattern

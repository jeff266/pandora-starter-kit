# Refactor Notes: Migrating Existing Connectors to Adapter Pattern

## Status: Phase 1 Complete, Phase 2 Partial

As of this writing:
- **HubSpot connector** (Phase 1) - Fully functional but NOT yet adapted
- **Gong connector** (Phase 2) - Partially built, NOT yet adapted
- **Fireflies connector** (Phase 2) - Partially built, NOT yet adapted
- **Monday.com connector** - Built using adapter pattern ✅
- **Google Drive connector** - Built using adapter pattern ✅

This document describes how to refactor the existing connectors to conform to the universal adapter pattern.

---

## Why Refactor?

The current connectors work, but they:
1. Have inconsistent interfaces (HubSpot has `sync.ts`, others might differ)
2. Don't implement the standard adapter interfaces
3. Can't be registered/discovered via `AdapterRegistry`
4. Don't follow the stateless pattern consistently

Refactoring to the adapter pattern provides:
- **Consistency** - All connectors use the same interface
- **Discoverability** - Registry can list available sources by category
- **Testability** - Standardized testing approach
- **Extensibility** - Easy to add new sources

---

## Refactor Plan

### Phase A: Extract Adapters (Non-Breaking)
Create adapter classes that **wrap** existing code. No changes to current sync logic.

### Phase B: Register Adapters
Add adapters to the registry. Existing code still works.

### Phase C: Migrate Callers (Breaking)
Update code that calls connectors to use the adapter interface instead.

### Phase D: Cleanup
Remove old connector entry points once all callers use adapters.

---

## HubSpot Connector Refactor

### Current Structure
```
server/connectors/hubspot/
├── client.ts          # HubSpotClient (API client)
├── types.ts           # HubSpot API types
├── transform.ts       # Transform functions
└── sync.ts            # Sync orchestration
```

### Target Structure
```
server/connectors/hubspot/
├── client.ts          # HubSpotClient (unchanged)
├── types.ts           # HubSpot API types (unchanged)
├── transform.ts       # Transform functions (unchanged)
├── sync.ts            # Sync orchestration (unchanged, for now)
└── adapter.ts         # NEW: HubSpotCRMAdapter
```

### Step 1: Create `adapter.ts`

```typescript
import type { CRMAdapter, NormalizedDeal, NormalizedContact, NormalizedAccount, SyncResult } from '../adapters/types.js';
import { HubSpotClient } from './client.js';
import { transformDeal, transformContact, transformCompany } from './transform.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

export class HubSpotCRMAdapter implements CRMAdapter {
  readonly sourceType = 'hubspot';
  readonly category = 'crm' as const;

  private client = new HubSpotClient();

  async testConnection(credentials: Record<string, any>) {
    // Use existing client.testConnection or implement
  }

  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ) {
    // Delegate to existing sync.ts logic
    // OR inline the logic here
    const apiKey = credentials.apiKey;
    this.client.setApiKey(apiKey);

    // Fetch deals
    const rawDeals = await this.client.fetchDeals();
    const dealResult = transformWithErrorCapture(
      rawDeals,
      (d) => transformDeal(d, workspaceId),
      'HubSpot Deals',
      (d) => d.id
    );

    // Fetch contacts
    const rawContacts = await this.client.fetchContacts();
    const contactResult = transformWithErrorCapture(
      rawContacts,
      (c) => transformContact(c, workspaceId),
      'HubSpot Contacts',
      (c) => c.id
    );

    // Fetch companies
    const rawCompanies = await this.client.fetchCompanies();
    const accountResult = transformWithErrorCapture(
      rawCompanies,
      (c) => transformCompany(c, workspaceId),
      'HubSpot Accounts',
      (c) => c.id
    );

    return {
      deals: dealResult,
      contacts: contactResult,
      accounts: accountResult,
    };
  }

  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ) {
    // Delegate to existing sync.ts incrementalSync
  }

  transformDeal(raw: any, workspaceId: string, options?: any): NormalizedDeal {
    return transformDeal(raw, workspaceId, options);
  }

  transformContact(raw: any, workspaceId: string, options?: any): NormalizedContact {
    return transformContact(raw, workspaceId);
  }

  transformAccount(raw: any, workspaceId: string, options?: any): NormalizedAccount {
    return transformCompany(raw, workspaceId);
  }

  async discoverSchema(credentials: Record<string, any>) {
    // Use existing HubSpot metadata API to list custom properties
    // Return customFields array
  }
}
```

### Step 2: Register Adapter
In your app initialization:

```typescript
import { getAdapterRegistry } from './connectors/adapters/registry.js';
import { HubSpotCRMAdapter } from './connectors/hubspot/adapter.js';

const registry = getAdapterRegistry();
registry.register(new HubSpotCRMAdapter());
```

### Step 3: Update Callers (Gradually)

**Before:**
```typescript
import { initialSync } from './connectors/hubspot/sync.js';

const result = await initialSync(apiKey, workspaceId);
```

**After:**
```typescript
import { getAdapterRegistry } from './connectors/adapters/registry.js';

const adapter = getAdapterRegistry().get('hubspot');
const result = await adapter.initialSync({ apiKey }, workspaceId);
```

### Step 4: Remove `sync.ts` (Optional)
Once all callers use the adapter, you can inline the sync logic into `adapter.ts` and delete `sync.ts`.

---

## Gong Connector Refactor

### Current Structure
```
server/connectors/gong/
├── client.ts          # GongClient
├── types.ts           # Gong API types
├── transform.ts       # transformGongCall()
└── (no sync.ts yet)
```

### Target Structure
```
server/connectors/gong/
├── client.ts          # GongClient (unchanged)
├── types.ts           # Gong API types (unchanged)
├── transform.ts       # transformGongCall (unchanged)
└── adapter.ts         # NEW: GongConversationAdapter
```

### Step 1: Create `adapter.ts`

```typescript
import type { ConversationAdapter, NormalizedConversation, SyncResult } from '../adapters/types.js';
import { GongClient } from './client.js';
import { transformGongCall } from './transform.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

export class GongConversationAdapter implements ConversationAdapter {
  readonly sourceType = 'gong';
  readonly category = 'conversations' as const;

  private client = new GongClient();

  async testConnection(credentials: Record<string, any>) {
    // Test Gong API connection
  }

  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ) {
    const accessKey = credentials.accessKey;
    const accessKeySecret = credentials.accessKeySecret;

    this.client.setCredentials(accessKey, accessKeySecret);

    // Fetch calls from Gong
    const rawCalls = await this.client.fetchCalls(options?.startDate, options?.endDate);

    const conversationResult = transformWithErrorCapture(
      rawCalls,
      (call) => transformGongCall(call, workspaceId),
      'Gong Conversations',
      (call) => call.id
    );

    return { conversations: conversationResult };
  }

  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ) {
    // Use lastSyncTime as startDate for Gong API
    return this.initialSync(credentials, workspaceId, {
      ...options,
      startDate: lastSyncTime,
    });
  }

  transformConversation(raw: any, workspaceId: string, options?: any): NormalizedConversation {
    return transformGongCall(raw, workspaceId);
  }
}
```

### Step 2: Register Adapter
```typescript
import { GongConversationAdapter } from './connectors/gong/adapter.js';

registry.register(new GongConversationAdapter());
```

---

## Fireflies Connector Refactor

Same pattern as Gong:

```typescript
export class FirefliesConversationAdapter implements ConversationAdapter {
  readonly sourceType = 'fireflies';
  readonly category = 'conversations' as const;

  // ... implement initialSync, incrementalSync, transformConversation
}
```

---

## Client Pattern: Keep or Refactor?

The existing `client.ts` files are **stateful** (e.g., `setApiKey()`). The adapter pattern is **stateless**.

### Option 1: Keep Existing Clients (Easier)
Instantiate a client per adapter call:

```typescript
async initialSync(credentials, workspaceId) {
  const client = new HubSpotClient();
  client.setApiKey(credentials.apiKey);
  // ... use client
}
```

### Option 2: Refactor Clients to be Stateless (Better)
Pass credentials to each client method:

```typescript
class HubSpotClient {
  async fetchDeals(credentials: HubSpotCredentials) {
    // Use credentials.apiKey for this request
  }
}

// In adapter:
async initialSync(credentials, workspaceId) {
  const rawDeals = await this.client.fetchDeals(credentials);
}
```

**Recommendation:** Start with Option 1 (keep existing clients), refactor to Option 2 later if needed.

---

## Testing the Refactored Adapters

### Unit Test: Transform Functions
```typescript
import { HubSpotCRMAdapter } from './hubspot/adapter.js';

const adapter = new HubSpotCRMAdapter();

const mockDeal = {
  id: '123',
  properties: {
    dealname: 'Test Deal',
    amount: '50000',
    // ...
  }
};

const normalized = adapter.transformDeal(mockDeal, 'ws_test');
console.assert(normalized.name === 'Test Deal');
console.assert(normalized.amount === 50000);
```

### Integration Test: Sync
```typescript
const adapter = new HubSpotCRMAdapter();

const result = await adapter.initialSync(
  { apiKey: process.env.HUBSPOT_API_KEY },
  'ws_test'
);

console.log(`Synced ${result.deals.succeeded.length} deals`);
console.log(`Failed: ${result.deals.failed.length}`);
```

---

## Migration Checklist

### HubSpot
- [ ] Create `server/connectors/hubspot/adapter.ts`
- [ ] Implement `HubSpotCRMAdapter` (delegates to existing code)
- [ ] Register in `AdapterRegistry`
- [ ] Update callers to use adapter interface
- [ ] (Optional) Inline sync logic into adapter, remove `sync.ts`

### Gong
- [ ] Create `server/connectors/gong/adapter.ts`
- [ ] Implement `GongConversationAdapter`
- [ ] Register in `AdapterRegistry`
- [ ] Add sync orchestration (initial + incremental)

### Fireflies
- [ ] Create `server/connectors/fireflies/adapter.ts`
- [ ] Implement `FirefliesConversationAdapter`
- [ ] Register in `AdapterRegistry`
- [ ] Add sync orchestration (initial + incremental)

---

## Breaking Changes

### Before Refactor
```typescript
import { initialSync as hubspotSync } from './connectors/hubspot/sync.js';
import { fetchGongCalls } from './connectors/gong/client.js';

const hubspotResult = await hubspotSync(apiKey, workspaceId);
const gongCalls = await fetchGongCalls(accessKey, secret, startDate, endDate);
```

### After Refactor
```typescript
import { getAdapterRegistry } from './connectors/adapters/registry.js';

const registry = getAdapterRegistry();

const hubspotAdapter = registry.get('hubspot');
const hubspotResult = await hubspotAdapter.initialSync({ apiKey }, workspaceId);

const gongAdapter = registry.get('gong');
const gongResult = await gongAdapter.initialSync(
  { accessKey, accessKeySecret: secret },
  workspaceId,
  { startDate, endDate }
);
```

**Benefits:**
- All connectors use the same interface
- Can loop through `registry.getByCategory('crm')` to sync all CRM sources
- Easy to mock adapters for testing
- Registry can enforce that only one instance of each adapter exists

---

## Timeline

**Phase A: Extract Adapters** (1-2 days)
- Create adapter classes for HubSpot, Gong, Fireflies
- No breaking changes

**Phase B: Register Adapters** (1 hour)
- Add adapters to registry
- Existing code still works

**Phase C: Migrate Callers** (2-3 days)
- Update sync orchestrator to use adapters
- Update API endpoints to use adapters
- Update CLI commands to use adapters

**Phase D: Cleanup** (1 day)
- Remove old sync entry points
- Consolidate duplicated logic

---

## Open Questions

1. **Should we keep the existing `sync.ts` files?**
   - Pro: Gradual migration, less risk
   - Con: Duplication, two ways to do the same thing

2. **Should clients be refactored to be stateless?**
   - Pro: Cleaner, more testable
   - Con: More work, potential breakage

3. **How do we handle workspace-specific config (e.g., stage mappings)?**
   - Option A: Pass in `options` parameter
   - Option B: Store in database, adapter fetches on demand

**Recommendation:** Start with gradual migration (keep existing code), refactor incrementally as patterns stabilize.

# HubSpot Activity Sync Implementation Guide

## ✅ Completed Components

### 1. HubSpot Client Methods (`server/connectors/hubspot/client.ts`)
Added engagement fetching methods:
- `getAllEngagements(sinceTimestamp?)` - Fetches emails, calls, meetings, notes
- `getEngagementsByType(type, sinceTimestamp?)` - Private helper for pagination

**Features:**
- Fetches all 4 engagement types (emails, calls, meetings, notes)
- Pagination support with `after` cursor
- Incremental sync support via `sinceTimestamp` parameter
- Association loading (contacts, deals, companies)

### 2. Transformation Logic (`server/connectors/hubspot/transform.ts`)
Added `transformEngagement()` function:
- Maps HubSpot engagement properties to normalized activity format
- Handles type-specific fields (email subject vs call title, etc.)
- Resolves associated contact and deal IDs
- Exports `NormalizedActivity` interface

### 3. Database Upsert (`server/connectors/hubspot/sync.ts`)
Added `upsertActivities()` function:
- Batch processing via `upsertInBatches()`
- Resolves contact_id and deal_id from HubSpot source IDs
- ON CONFLICT DO UPDATE for idempotency
- Transaction-safe batch processing

---

## 🚧 Remaining Integration Steps

### Step 1: Add Activity Sync to Initial Sync

**File:** `server/connectors/hubspot/sync.ts`
**Function:** `initialSync()`

**Add after accounts sync (around line 550):**

```typescript
// Fetch and transform activities
let rawEngagements: any[] = [];
try {
  rawEngagements = await client.getAllEngagements();
  console.log(`[HubSpot Sync] Fetched ${rawEngagements.length} engagements`);
} catch (err: any) {
  errors.push(`Failed to fetch engagements: ${err.message}`);
}

const activityTransformResult = transformWithErrorCapture(
  rawEngagements,
  (e) => transformEngagement(e, workspaceId),
  'HubSpot Engagements',
  (e) => e.id
);

if (activityTransformResult.failed.length > 0) {
  errors.push(`Activity transform failures: ${activityTransformResult.failed.length} records`);
}

const normalizedActivities = activityTransformResult.succeeded;

// Upsert activities (must be after contacts and deals for FK resolution)
const activitiesStored = await upsertActivities(normalizedActivities).catch(err => {
  console.error(`[HubSpot Sync] Failed to store activities:`, err.message);
  errors.push(`Failed to store activities: ${err.message}`);
  return 0;
});

console.log(`[HubSpot Sync] Stored ${activitiesStored} activities`);
totalStored += activitiesStored;
```

**Update return statement:**
```typescript
return {
  success: true,
  dealsStored,
  contactsStored,
  accountsStored,
  activitiesStored, // Add this
  errors,
  duration_ms: Date.now() - startTime,
};
```

### Step 2: Add Activity Sync to Incremental Sync

**File:** `server/connectors/hubspot/sync.ts`
**Function:** `incrementalSync()`

**Add after accounts sync (around line 750):**

```typescript
// Fetch activities updated since last sync
const lastSyncTimestamp = Math.floor(lastSync.getTime());
let rawEngagements: any[] = [];
try {
  rawEngagements = await client.getAllEngagements(lastSyncTimestamp);
  console.log(`[HubSpot Incremental Sync] Fetched ${rawEngagements.length} updated engagements`);
} catch (err: any) {
  errors.push(`Failed to fetch engagements: ${err.message}`);
}

const activityTransformResult = transformWithErrorCapture(
  rawEngagements,
  (e) => transformEngagement(e, workspaceId),
  'HubSpot Engagements',
  (e) => e.id
);

const normalizedActivities = activityTransformResult.succeeded;

const activitiesStored = await upsertActivities(normalizedActivities).catch(err => {
  console.error(`[HubSpot Incremental Sync] Failed to store activities:`, err.message);
  errors.push(`Failed to store activities: ${err.message}`);
  return 0;
});

console.log(`[HubSpot Incremental Sync] Stored ${activitiesStored} activities`);
totalStored += activitiesStored;
```

**Update return statement:**
```typescript
return {
  success: true,
  dealsStored,
  contactsStored,
  accountsStored,
  activitiesStored, // Add this
  errors,
  duration_ms: Date.now() - startTime,
};
```

### Step 3: Update TypeScript Interfaces

**File:** `server/connectors/_interface.ts`

**Update SyncResult interface:**
```typescript
export interface SyncResult {
  success: boolean;
  dealsStored: number;
  contactsStored: number;
  accountsStored: number;
  activitiesStored?: number; // Add this
  errors: string[];
  duration_ms: number;
}
```

### Step 4: Update Transform Module Exports

**File:** `server/connectors/hubspot/transform.ts`

**Add to exports (around line 10):**
```typescript
export {
  transformDeal,
  transformContact,
  transformCompany,
  transformEngagement, // Add this
  type NormalizedActivity, // Add this
};
```

---

## Testing

### 1. Initial Sync Test

```bash
# Trigger initial sync for Frontera workspace
curl -X POST http://localhost:3000/api/hubspot/sync \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "4160191d-73bc-414b-97dd-5a1853190378"}'
```

**Expected:**
- Logs show "Fetched X engagements"
- Logs show "Stored X activities"
- Activities table populated

**Verify:**
```sql
SELECT COUNT(*) FROM activities
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';

SELECT
  activity_type,
  COUNT(*) as count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM activities
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
GROUP BY activity_type;
```

### 2. Incremental Sync Test

```bash
# Wait 10 minutes, then trigger incremental sync
curl -X POST http://localhost:3000/api/hubspot/sync \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "4160191d-73bc-414b-97dd-5a1853190378"}'
```

**Expected:**
- Only fetches activities updated since last sync
- Existing activities updated (ON CONFLICT DO UPDATE)
- New activities inserted

### 3. Association Resolution Test

```sql
-- Check that activities are linked to contacts and deals
SELECT
  a.activity_type,
  COUNT(*) FILTER (WHERE a.contact_id IS NOT NULL) as with_contact,
  COUNT(*) FILTER (WHERE a.deal_id IS NOT NULL) as with_deal,
  COUNT(*) FILTER (WHERE a.contact_id IS NULL AND a.deal_id IS NULL) as orphaned
FROM activities a
WHERE a.workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
GROUP BY a.activity_type;
```

**Expected:**
- Most activities linked to contacts
- Subset linked to deals
- Few orphaned (unassociated activities)

---

## Performance Considerations

### Batch Size
Current: 100 activities per HubSpot API call
- Adjust if sync is slow: increase to 250-500
- Decrease if hitting memory limits

### Sync Duration Estimate
- **Frontera (500 activities):** ~10-15 seconds
- **Large workspace (10,000 activities):** ~2-3 minutes initial sync
- **Incremental sync:** <30 seconds (only fetches recent)

### Database Impact
- Activities table will grow linearly with engagement volume
- Add index on (workspace_id, timestamp) for fast queries
- Consider partitioning by timestamp for workspaces >1M activities

### Rate Limiting
HubSpot API limits:
- Standard: 100 req/10sec
- Professional+: 150 req/10sec

Current throttling (`utils/throttle.ts`) handles this automatically.

---

## Data Quality

### Expected Coverage

**Frontera workspace (from validation report):**
- Zero activities currently → Will populate ~500-2000 activities
- Email/call/meeting coverage depends on HubSpot usage

**Fill Rate by Type:**
- Emails: Usually highest volume (50-60% of all activities)
- Meetings: 20-30%
- Calls: 10-20%
- Notes: 5-10%

### Known Limitations

1. **Historical Data:** Only fetches activities still in HubSpot
   - HubSpot may archive very old engagements
   - Solution: Run initial sync ASAP to capture current state

2. **Subject/Body Truncation:** HubSpot may truncate long bodies
   - Emails: Usually truncated to 5000 chars
   - Solution: Store full text in source_data if needed

3. **Multi-Association Handling:** HubSpot engagements can link to multiple contacts/deals
   - Current implementation: Uses first association
   - Future enhancement: Create activity_associations junction table

---

## Impact on Skills

### Before Activity Sync
- **deal-risk-review:** Uses deal.last_activity_date only
- **Lead scoring:** Uses deal.last_activity_date only
- **pipeline-hygiene:** Stale deal detection based on deal.updated_at

### After Activity Sync
- **deal-risk-review:** Can analyze activity frequency, gaps, types
- **Lead scoring:** Real engagement scoring (email replies, call duration, meeting attendance)
- **pipeline-hygiene:** Accurate staleness detection (no activity in X days)

**Automatic improvements (no code changes needed):**
- Computed fields engine already queries activities table
- Deal risk calculation already uses activity timeline
- Engagement scoring already uses activity counts

---

## Rollout Plan

### Phase 1: Soft Launch (Current State)
✅ Infrastructure ready
⏳ Pending integration into sync flows

### Phase 2: Integration (Next Deploy)
1. Merge activity sync into initialSync() and incrementalSync()
2. Deploy to staging
3. Run initial sync on test workspace
4. Validate activity data quality
5. Deploy to production

### Phase 3: Backfill (Optional)
1. For existing workspaces, run initial sync to populate activities
2. Monitor sync performance
3. Adjust batch sizes if needed

### Phase 4: Enhanced Features (Future)
1. Multi-association support (activity_associations table)
2. Activity sentiment analysis (email tone, call quality)
3. Activity threading (email chains, follow-up tracking)
4. Activity-based automation triggers

---

## Success Criteria

✅ All HubSpot engagements synced to activities table
✅ Contact and deal associations resolved correctly
✅ Activity types (email/call/meeting/note) mapped correctly
✅ Incremental sync only fetches recent activities
✅ Sync completes in <5 minutes for 10K activities
✅ Zero activity syncs drop to <1% of workspaces
✅ Engagement scoring accuracy improves (measured via lead score distributions)

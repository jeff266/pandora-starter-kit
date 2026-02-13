# File Import → Salesforce Upgrade Guide

## Overview

When a workspace transitions from CSV/Excel file imports to Salesforce integration, Pandora automatically merges the data sources to preserve historical context while upgrading to live API sync.

This guide explains how the upgrade works and what happens to your data.

---

## How It Works

### 1. Automatic Trigger

The upgrade runs automatically on the **first Salesforce sync** after connecting your account.

**Conditions:**
- Workspace has deals with `source = 'csv_import'`
- First time syncing Salesforce (no previous Salesforce sync)
- Upgrade hasn't already run (tracked in workspace settings)

### 2. Matching Strategy

Deals are matched by **External ID** (the `source_id` field):

```
File Import Deal         Salesforce Opportunity
-----------------       ----------------------
source_id: "12345"  →   Id: "12345"         ✅ MATCH
source_id: "67890"  →   Id: "67890"         ✅ MATCH
source_id: "99999"  →   (not in Salesforce) ❌ ORPHAN
```

**What's an External ID?**
- If you included an "Opportunity ID" or "Deal ID" column in your CSV, that becomes the `source_id`
- This allows Pandora to match the file-imported deal with the Salesforce opportunity
- Without external IDs, deals cannot be matched and will remain as orphans

### 3. Merge Process

For each matched deal:

**Step 1: Re-link Activities**
- Any activities (tasks, calls, meetings) linked to the Salesforce deal are moved to the file-imported deal
- Preserves historical activity data from file imports

**Step 2: Re-link Contacts**
- OpportunityContactRole records from Salesforce are merged with file import contact links
- Duplicates are handled gracefully (no double-linking)

**Step 3: Update Deal Source**
- Deal is updated to `source = 'salesforce'`
- `source_id` is set to Salesforce Opportunity ID
- `source_data` is updated with full Salesforce API response
- **Original created_at timestamp is preserved** (maintains historical accuracy)

**Step 4: Transfer Stage History**
- Stage transitions from CSV re-uploads are marked as `file_import_migrated`
- These transitions are preserved in `deal_stage_history` table
- Future stage changes will use `source = 'salesforce_history'`

**Step 5: Delete Duplicate**
- The newly synced Salesforce deal is deleted (data already merged)
- Only one deal record remains, now Salesforce-sourced

### 4. Orphaned Deals

Deals that **don't match** any Salesforce opportunity remain as `source = 'csv_import'`:

**Common Reasons:**
- No external ID provided in CSV
- Deal was closed/deleted in Salesforce before sync
- Deal was manually created in file import (not in Salesforce)

**What Happens:**
- Orphaned deals remain visible in Pandora
- They won't receive updates from Salesforce
- You can manually delete them or keep them for historical reference

---

## Example Upgrade Flow

**Before Upgrade:**
```
Deals Table:
┌──────────────────────────────────────┬──────────┬──────────────┐
│ id                                   │ source   │ source_id    │
├──────────────────────────────────────┼──────────┼──────────────┤
│ deal-abc-123                         │ csv_imp  │ "SF-12345"   │
│ deal-def-456                         │ csv_imp  │ "SF-67890"   │
│ deal-ghi-789                         │ csv_imp  │ null         │
└──────────────────────────────────────┴──────────┴──────────────┘

(First Salesforce sync brings in 2 opportunities)
```

**After First Salesforce Sync:**
```
Deals Table:
┌──────────────────────────────────────┬──────────┬──────────────┐
│ id                                   │ source   │ source_id    │
├──────────────────────────────────────┼──────────┼──────────────┤
│ deal-abc-123                         │ salesfor │ "SF-12345"   │ ← Upgraded
│ deal-def-456                         │ salesfor │ "SF-67890"   │ ← Upgraded
│ deal-ghi-789                         │ csv_imp  │ null         │ ← Orphan
└──────────────────────────────────────┴──────────┴──────────────┘

Stage History:
┌──────────────────┬────────────┬────────────┬──────────────────────┐
│ deal_id          │ from_stage │ to_stage   │ source               │
├──────────────────┼────────────┼────────────┼──────────────────────┤
│ deal-abc-123     │ null       │ Prospectin │ file_import_new      │
│ deal-abc-123     │ Prospectin │ Qualified  │ file_import_diff     │
│ (after upgrade)  │            │            │ ↓                    │
│ deal-abc-123     │ null       │ Prospectin │ file_import_migrated │
│ deal-abc-123     │ Prospectin │ Qualified  │ file_import_migrated │
│ (future changes) │            │            │ ↓                    │
│ deal-abc-123     │ Qualified  │ Closed Won │ salesforce_history   │
└──────────────────┴────────────┴────────────┴──────────────────────┘
```

---

## Checking Upgrade Status

### API Endpoint

```bash
GET /import/:workspaceId/upgrade-status
```

**Response (before upgrade):**
```json
{
  "hasTransitioned": false,
  "orphanedDeals": []
}
```

**Response (after upgrade):**
```json
{
  "hasTransitioned": true,
  "transition": {
    "transitionedAt": "2026-02-13T10:30:00Z",
    "fileImportedDeals": 150,
    "matchedDeals": 142,
    "unmatchedDeals": 8
  },
  "orphanedDeals": [
    {
      "id": "deal-xyz-999",
      "externalId": null,
      "name": "Legacy Deal - No Salesforce Match",
      "stage": "Closed Lost",
      "amount": 5000,
      "owner": "John Doe"
    }
  ]
}
```

### Database Query

```sql
-- Check if workspace has transitioned
SELECT settings->'data_source_history'->'csv_to_salesforce_transition'
FROM workspaces
WHERE id = :workspace_id;

-- Get orphaned deals
SELECT id, name, stage, amount, owner
FROM deals
WHERE workspace_id = :workspace_id
  AND source = 'csv_import';
```

---

## Best Practices

### 1. Use External IDs in CSV Uploads

**When uploading CSV files, include an "Opportunity ID" column:**

```csv
Opportunity ID,Deal Name,Amount,Stage,Close Date
006xx000001234567,Acme Corp - Enterprise,50000,Prospecting,2026-03-15
006xx000009876543,TechCo - Renewal,25000,Negotiation,2026-02-28
```

This ensures seamless matching when you later connect Salesforce.

**Important: 15-char vs 18-char IDs**
- Salesforce CSV exports typically provide **15-character IDs** (case-sensitive)
- Salesforce API returns **18-character IDs** (case-insensitive with checksum suffix)
- The first 15 characters are **identical** in both formats
- Pandora automatically normalizes IDs to 15 characters for matching
- You can use either format in your CSV uploads — both will match correctly

### 2. Review Orphaned Deals

After upgrade, check the orphaned deals list:

1. **No External ID** → Manually verify if they exist in Salesforce
2. **Closed in Salesforce** → Safe to delete or keep for historical reference
3. **Test Data** → Safe to delete

### 3. Stage History Preservation

The upgrade preserves stage transitions from CSV re-uploads:

- All file import stage history is relabeled as `file_import_migrated`
- Future stage changes from Salesforce use `salesforce_history`
- Pipeline Waterfall skill works seamlessly across both sources

---

## Technical Details

### Files Modified

| File | Purpose |
|------|---------|
| `server/import/upgrade.ts` | Core upgrade logic |
| `server/connectors/salesforce/adapter.ts` | Automatic trigger on first sync |
| `server/routes/import.ts` | Upgrade status API endpoint |
| `migrations/015_deal_stage_history.sql` | Document new source values |

### Functions

| Function | Purpose |
|----------|---------|
| `transitionToApiSync()` | Main upgrade orchestrator |
| `matchDealsByExternalId()` | Match file deals to Salesforce |
| `updateDealSource()` | Merge deal data and relationships |
| `transferStageHistory()` | Preserve stage transitions |
| `getTransitionStatus()` | Query upgrade status |
| `getOrphanedDeals()` | Get unmatched deals |

### Database Schema Impact

**Workspaces Table:**
- `settings.data_source_history.csv_to_salesforce_transition` tracks upgrade metadata

**Deals Table:**
- Matched deals updated from `source='csv_import'` to `source='salesforce'`
- `source_id` updated to canonical 18-character Salesforce ID from API

**Deal Stage History Table:**
- `source` values updated: `file_import_diff` → `file_import_migrated`

**Activities Table:**
- Activities from Salesforce deal re-linked to file-imported deal

**Deal Contacts Table:**
- OpportunityContactRole records merged (duplicates avoided)

### Salesforce ID Normalization

**Critical Implementation Detail:**

Salesforce IDs exist in two formats:
- **15-character** (case-sensitive, from CSV exports/reports): `006Dn00000A1bcd`
- **18-character** (case-insensitive, from API with checksum): `006Dn00000A1bcdEFG`

The first 15 characters are identical. To prevent false negatives during matching:

1. **All ID comparisons normalize to 15 characters** before matching
2. **ID lookup maps use normalized 15-char keys** for fast lookups
3. **Stored `source_id` uses full 18-char ID** as canonical format

This ensures that:
- CSV uploads with 15-char IDs match API records with 18-char IDs
- Activities and contacts link correctly across both formats
- Future syncs use the canonical 18-char ID for consistency

**Implementation:** `normalizeSalesforceId()` utility in `server/connectors/salesforce/transform.ts`

---

## Troubleshooting

### "No deals were matched"

**Cause:** CSV upload didn't include external IDs

**Solution:**
- Re-upload CSV with "Opportunity ID" column
- Use merge strategy to update existing deals with external IDs
- Re-run Salesforce sync

### "Orphaned deals still showing"

**Cause:** These deals genuinely don't exist in Salesforce

**Solution:**
- Manually verify if they should exist
- Delete orphans if they're test data or obsolete
- Keep them if they represent historical deals not in Salesforce

### "Stage history looks wrong"

**Cause:** CSV re-uploads may have captured incorrect stage transitions

**Solution:**
- Stage history from file imports is marked as `file_import_migrated`
- Salesforce OpportunityFieldHistory provides authoritative history going forward
- Both sources are preserved and visible in Pipeline Waterfall

---

## Future Enhancements

Potential improvements for this feature:

1. **Fuzzy Matching** - Match by deal name + amount when external ID is missing
2. **Manual Review UI** - Dashboard to review and approve matches before upgrade
3. **Rollback Capability** - Undo upgrade and restore csv_import source
4. **Multi-Source Tracking** - Track which fields came from file vs Salesforce
5. **Conflict Resolution** - UI to resolve discrepancies between file and Salesforce data

---

## Summary

The File Import → Salesforce upgrade provides a **seamless transition** from static CSV uploads to live API sync:

✅ **Preserves historical data** - Stage history, activities, and contacts from file imports are retained
✅ **Automatic matching** - External IDs link file deals to Salesforce opportunities
✅ **Graceful orphan handling** - Unmatched deals remain accessible
✅ **Audit trail** - Transition metadata tracked in workspace settings
✅ **Zero configuration** - Upgrade runs automatically on first Salesforce sync

This ensures that workspaces can start with file imports and upgrade to Salesforce without losing historical context.

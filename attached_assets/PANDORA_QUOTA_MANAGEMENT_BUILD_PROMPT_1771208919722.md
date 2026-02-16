# Pandora Quota Management — HubSpot Goals Sync + Settings UI

## For: Replit
## Depends on: Existing quota upload backend (parseQuotaFile, classifyColumns, quotas table, CRUD API)
## Effort estimate: 10-15 hours across 3 parts

---

## Context

Pandora's quota backend exists: the `quotas` table, upload/preview/confirm endpoints, DeepSeek column classification, and the forecast-rollup skill's quota lookup. But there's no UI for it, and HubSpot customers have to manually upload CSV when their goals already exist in HubSpot.

This prompt builds three things:
1. **HubSpot Goals auto-sync** — Pull quotas directly from HubSpot's Goals API
2. **Settings UI** — Primary quota management page in Settings
3. **Contextual prompts** — Banner on Pipeline Coverage and Forecast pages when quotas are missing

---

## Before Starting

1. Read the existing quota upload code — find `parseQuotaFile`, `classifyColumns`, `buildPreview`, `applyQuotas`, the quotas table schema, and the CRUD routes
2. Read the HubSpot connector — find how OAuth tokens are stored, how API calls are made (there should be a shared `hubspotApi` helper or similar), and what scopes are requested during OAuth
3. Read the forecast-rollup skill's `checkQuotaConfig` — understand how it reads quotas from the table
4. Read the Settings page frontend — understand the existing tabs/sections (Connectors, Voice/Tone, Learning, etc.)
5. Check HubSpot OAuth scopes — the Goals API requires `crm.objects.goals.read` scope. If the existing OAuth flow doesn't include this scope, add it.

---

## Part 1: HubSpot Goals Sync

### 1a. Goals Fetcher

Create `server/connectors/hubspot/goals-sync.ts`:

```typescript
import { hubspotApi } from './hubspot-client'; // Use existing HubSpot API helper

interface HubSpotGoal {
  id: string;
  hs_goal_name: string;
  hs_target_amount: string;        // Comes as string, parse to number
  hs_start_datetime: string;       // ISO timestamp
  hs_end_datetime: string;         // ISO timestamp
  hs_assignee_user_id: string;     // HubSpot user ID (NOT the creator)
  hs_assignee_team_id?: string;    // HubSpot team ID (for team-level goals)
  hs_created_by_user_id: string;   // Who created the goal — NOT the assignee
}

interface ResolvedQuota {
  rep_name: string;
  rep_email: string;
  quota_amount: number;
  period_start: string;     // YYYY-MM-DD
  period_end: string;       // YYYY-MM-DD
  period_label: string;     // "Q1 2026", etc.
  period_type: string;      // monthly, quarterly, annual
  hubspot_goal_id: string;  // For dedup on re-sync
}

export async function fetchHubSpotGoals(workspaceId: string): Promise<{
  goals: ResolvedQuota[];
  warnings: string[];
  raw_count: number;
}> {
  const warnings: string[] = [];
  
  // Step 1: Fetch all goal_targets from HubSpot
  // Use the existing HubSpot API client with the workspace's OAuth token
  const properties = [
    'hs_goal_name',
    'hs_target_amount', 
    'hs_start_datetime',
    'hs_end_datetime',
    'hs_assignee_user_id',
    'hs_assignee_team_id',
    'hs_created_by_user_id'
  ].join(',');
  
  // Paginate through all goals
  let allGoals: HubSpotGoal[] = [];
  let after: string | undefined;
  
  do {
    const url = `/crm/v3/objects/goal_targets?properties=${properties}&limit=100${after ? `&after=${after}` : ''}`;
    const response = await hubspotApi(workspaceId, 'GET', url);
    
    for (const result of response.results || []) {
      allGoals.push({
        id: result.id,
        ...result.properties,
      });
    }
    
    after = response.paging?.next?.after;
  } while (after);
  
  // Step 2: Resolve assignee user IDs to names and emails
  // Collect unique user IDs from assignees
  const userIds = [...new Set(
    allGoals
      .map(g => g.hs_assignee_user_id)
      .filter(Boolean)
  )];
  
  // Fetch HubSpot owners/users to get email and name
  // The Owners API maps HubSpot user IDs to email/name
  // GET /crm/v3/owners?limit=100
  // Each owner has: id, email, firstName, lastName, userId
  const ownerMap = new Map<string, { email: string; name: string }>();
  
  let ownerAfter: string | undefined;
  do {
    const ownerUrl = `/crm/v3/owners?limit=100${ownerAfter ? `&after=${ownerAfter}` : ''}`;
    const ownerResponse = await hubspotApi(workspaceId, 'GET', ownerUrl);
    
    for (const owner of ownerResponse.results || []) {
      // Map by userId (which is what goals reference)
      if (owner.userId) {
        ownerMap.set(String(owner.userId), {
          email: owner.email,
          name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
        });
      }
    }
    
    ownerAfter = ownerResponse.paging?.next?.after;
  } while (ownerAfter);
  
  // Step 3: Transform goals into quota format
  const resolvedQuotas: ResolvedQuota[] = [];
  
  for (const goal of allGoals) {
    // Skip goals without target amount
    if (!goal.hs_target_amount || parseFloat(goal.hs_target_amount) === 0) {
      warnings.push(`Goal "${goal.hs_goal_name}" has no target amount — skipped`);
      continue;
    }
    
    // Skip team-level goals (we want per-rep quotas)
    // If hs_assignee_user_id is null but hs_assignee_team_id exists, it's a team goal
    if (!goal.hs_assignee_user_id && goal.hs_assignee_team_id) {
      warnings.push(`Goal "${goal.hs_goal_name}" is a team-level goal — skipped (Pandora needs per-rep quotas)`);
      continue;
    }
    
    // Resolve assignee
    const assignee = ownerMap.get(goal.hs_assignee_user_id);
    if (!assignee) {
      warnings.push(`Goal "${goal.hs_goal_name}" assigned to unknown user ID ${goal.hs_assignee_user_id} — skipped`);
      continue;
    }
    
    // Parse dates
    const startDate = new Date(goal.hs_start_datetime);
    const endDate = new Date(goal.hs_end_datetime);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      warnings.push(`Goal "${goal.hs_goal_name}" has invalid dates — skipped`);
      continue;
    }
    
    // Determine period type from date range
    const durationDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    let periodType = 'quarterly';
    if (durationDays <= 35) periodType = 'monthly';
    else if (durationDays <= 100) periodType = 'quarterly';
    else periodType = 'annual';
    
    // Generate period label
    const periodLabel = generatePeriodLabel(startDate, endDate, periodType);
    
    resolvedQuotas.push({
      rep_name: assignee.name,
      rep_email: assignee.email,
      quota_amount: parseFloat(goal.hs_target_amount),
      period_start: startDate.toISOString().split('T')[0],
      period_end: endDate.toISOString().split('T')[0],
      period_label: periodLabel,
      period_type: periodType,
      hubspot_goal_id: goal.id,
    });
  }
  
  return {
    goals: resolvedQuotas,
    warnings,
    raw_count: allGoals.length,
  };
}

function generatePeriodLabel(start: Date, end: Date, periodType: string): string {
  const year = start.getFullYear();
  if (periodType === 'monthly') {
    return `${start.toLocaleString('en', { month: 'long' })} ${year}`;
  }
  if (periodType === 'quarterly') {
    const quarter = Math.ceil((start.getMonth() + 1) / 3);
    return `Q${quarter} ${year}`;
  }
  return `FY${year}`;
}
```

### 1b. Goals Sync API Endpoint

Add to quota routes:

```
POST /api/workspaces/:id/quotas/sync-hubspot

Flow:
1. Check workspace has active HubSpot connection
2. Call fetchHubSpotGoals()
3. Return preview (same shape as CSV upload preview):
   {
     source: 'hubspot_goals',
     goals: ResolvedQuota[],
     warnings: string[],
     rawGoalCount: number,
     filteredCount: number,  // After removing team goals, empty amounts, etc.
     teamTotal: number,
     repCount: number,
     periods: string[],      // Unique periods found
   }
4. DO NOT write to DB yet — user confirms first (same pattern as CSV upload)

POST /api/workspaces/:id/quotas/sync-hubspot/confirm

Flow:
1. Write resolved quotas to quotas table
2. Set source = 'hubspot_goals' and store hubspot_goal_id in metadata
3. On conflict (same rep + period), update amount if source is 'hubspot_goals'
   (don't overwrite manual edits — only overwrite previous HubSpot syncs)
4. Return: { inserted, updated, skipped, batchId }
```

### 1c. Auto-Sync on HubSpot Connection

Wire goals sync into the existing HubSpot sync pipeline. After deals/contacts/companies sync completes, check for goals:

```typescript
// In the HubSpot post-sync hook:
// Only auto-fetch goals if:
// 1. Workspace has no quotas yet, OR
// 2. Existing quotas are sourced from hubspot_goals (re-sync)
const existingQuotas = await db.query(
  'SELECT COUNT(*) FROM quotas WHERE workspace_id = $1', [workspaceId]
);

if (existingQuotas.rows[0].count === 0) {
  // No quotas at all — fetch goals and store as pending preview
  // Store in context_layer for the Settings UI to pick up
  const preview = await fetchHubSpotGoals(workspaceId);
  if (preview.goals.length > 0) {
    await storeGoalsPreview(workspaceId, preview);
    // This enables the "HubSpot goals detected" banner in Settings
  }
}
```

### 1d. OAuth Scope Check

The Goals API requires `crm.objects.goals.read` scope. Check the existing HubSpot OAuth configuration:

```typescript
// In the HubSpot OAuth setup, ensure this scope is included:
const HUBSPOT_SCOPES = [
  // ... existing scopes ...
  'crm.objects.goals.read',  // ADD THIS if not present
];
```

**Important:** If the scope isn't currently included, existing connections will need to re-authorize. Handle this gracefully:
- Check if the current token has the goals scope
- If not, show a "Re-authorize HubSpot to sync goals" prompt instead of failing silently
- The sync-hubspot endpoint should return `{ error: 'missing_scope', message: 'HubSpot connection needs re-authorization to access Goals' }` if the API returns 403

---

## Part 2: Settings UI — Quotas & Targets Page

Add a "Quotas & Targets" section to the Settings page (or as a new tab alongside Connectors, Voice/Tone, Learning).

### 2a. Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Settings > Quotas & Targets                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Import Quotas                                         │  │
│  │                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐                   │  │
│  │  │  📥 Upload    │  │  🔄 HubSpot  │                   │  │
│  │  │  CSV / Excel  │  │  Goals Sync  │                   │  │
│  │  └──────────────┘  └──────────────┘                   │  │
│  │                                                        │  │
│  │  (HubSpot button only visible when HS is connected)   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Current Quotas — Q1 2026                                    │
│  ┌──────────────┬───────────┬──────────┬────────┬────────┐  │
│  │ Rep          │ Email     │ Quota    │ Source │ Actions│  │
│  ├──────────────┼───────────┼──────────┼────────┼────────┤  │
│  │ Nate Phillips│ nate@...  │ $500,000 │ HubSpot│ ✏️  🗑  │  │
│  │ Sara Bollman │ sara@...  │ $350,000 │ HubSpot│ ✏️  🗑  │  │
│  │ Carter McKay │ carter@...│ $200,000 │ Upload │ ✏️  🗑  │  │
│  ├──────────────┼───────────┼──────────┼────────┼────────┤  │
│  │ Team Total   │           │$1,050,000│        │        │  │
│  └──────────────┴───────────┴──────────┴────────┴────────┘  │
│                                                              │
│  Period: [◀ Q4 2025] [Q1 2026 ▶]  ← navigate periods       │
│                                                              │
│  + Add quota manually                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2b. Import Flow — CSV/Excel Upload

When user clicks "Upload CSV / Excel":

1. **File dropzone** — accepts .xlsx, .xls, .csv (max 5MB)
2. On drop/select: `POST /api/workspaces/:id/quotas/upload` with the file
3. Show **preview table** with AI-mapped columns:
   ```
   ┌──────────────────────────────────────────────────────┐
   │  Preview — 4 reps detected, Q1 2026, Quarterly       │
   │                                                       │
   │  Rep Name      │ Email         │ Quota                │
   │  Nate Phillips │ nate@...      │ $500,000             │
   │  Sara Bollman  │ sara@...      │ $350,000             │
   │  Carter McKay  │ carter@...    │ $200,000             │
   │  Jack McArdle  │ jack@...      │ $150,000             │
   │                                                       │
   │  ⚠ Warnings:                                         │
   │  • No email column found — matched by name            │
   │                                                       │
   │  [Cancel]                        [Confirm & Import]   │
   └──────────────────────────────────────────────────────┘
   ```
4. On confirm: `POST /api/workspaces/:id/quotas/confirm` with the preview
5. Refresh quota table

### 2c. Import Flow — HubSpot Goals Sync

When user clicks "HubSpot Goals Sync":

1. Call `POST /api/workspaces/:id/quotas/sync-hubspot`
2. If `error: 'missing_scope'`: Show message "Your HubSpot connection needs to be re-authorized to access Goals. [Re-authorize]"
3. If successful: Show preview (same layout as CSV preview but with source = "HubSpot Goals")
4. Show warnings (team goals skipped, missing amounts, etc.)
5. On confirm: `POST /api/workspaces/:id/quotas/sync-hubspot/confirm`
6. Refresh quota table

### 2d. Pending Goals Detection Banner

If the HubSpot sync detected goals during initial sync but they haven't been confirmed yet, show a banner at the top of the page:

```
┌──────────────────────────────────────────────────────────┐
│ 🔄 Pandora detected 6 revenue goals in HubSpot.          │
│    Import them as rep quotas?                             │
│    [Review & Import]  [Dismiss]                           │
└──────────────────────────────────────────────────────────┘
```

This uses the goals preview stored in context_layer during initial sync (from Part 1c).

### 2e. Quota Table Features

The current quotas table should support:

- **Period navigation** — Forward/back arrows to see different quarters
- **Inline edit** — Click the pencil icon to edit quota amount (calls `PUT /api/workspaces/:id/quotas/:quotaId`)
- **Delete** — Trash icon with confirmation (calls `DELETE /api/workspaces/:id/quotas/:quotaId`)
- **Add manually** — "+ Add quota" opens a simple form: rep name, email, amount, period
- **Source indicator** — Shows where each quota came from (HubSpot, Upload, Manual)
- **Team total** — Sum row at the bottom
- **Empty state** — When no quotas exist, show the import options prominently with explanation text:
  ```
  No quotas set up yet.
  
  Quotas enable attainment tracking, gap analysis, and rep performance scoring
  across Pipeline Coverage and Forecast reports.
  
  [Upload CSV / Excel]  [Sync from HubSpot]
  ```

---

## Part 3: Contextual Prompts on Pipeline Coverage & Forecast Pages

### 3a. Missing Quota Banner

On pages that benefit from quota data (Pipeline Coverage, Forecast Rollup), check for quotas and show a contextual prompt if none exist:

```typescript
// In the page component, check for quotas:
const { data: quotas } = useQuery(['quotas', workspaceId], fetchCurrentQuotas);

// If no quotas for current period:
if (!quotas || quotas.length === 0) {
  return (
    <Banner type="info" dismissable>
      <span>
        Set up rep quotas to see attainment %, gap analysis, and coverage ratios.
      </span>
      <Link to="/settings/quotas">Set up quotas →</Link>
    </Banner>
  );
}
```

### 3b. Post-Setup Enhancement

Once quotas exist, the Pipeline Coverage and Forecast pages should show richer data:

- **Pipeline Coverage**: Show coverage ratio per rep (pipeline / quota) instead of just raw pipeline amounts
- **Forecast Rollup**: Show attainment % per rep, team attainment, and gap to target
- **Rep Scorecard**: Include quota attainment as a scoring dimension

These features should already work if the forecast-rollup skill reads from the quotas table. Verify that the frontend components display the attainment data when it's present in the skill output.

### 3c. Stale Quota Warning

If quotas exist but are from a previous period (e.g., it's Q2 but only Q1 quotas exist):

```
⚠ Quotas are set for Q1 2026 but the current period is Q2 2026.
  Update quotas for accurate attainment tracking.
  [Update quotas →]
```

---

## Testing Checklist

### HubSpot Goals Sync:
```
1. Trigger sync: POST /api/workspaces/:id/quotas/sync-hubspot
2. Verify: Preview returns goals with rep names, emails, amounts, periods
3. Verify: Team-level goals are excluded with warning
4. Verify: Goals with no amount are excluded with warning
5. Confirm: POST /api/workspaces/:id/quotas/sync-hubspot/confirm
6. Verify: quotas table has new rows with source = 'hubspot_goals'
7. Re-sync: POST /api/workspaces/:id/quotas/sync-hubspot
8. Confirm again: Verify it updates existing rows (not duplicates)
```

### CSV Upload via UI:
```
1. Navigate to Settings > Quotas & Targets
2. Upload a sample CSV with rep names and amounts
3. Verify: Preview appears with AI-classified columns
4. Confirm: Quotas appear in the table
5. Edit a quota inline → verify PUT endpoint works
6. Delete a quota → verify DELETE endpoint works
7. Add a quota manually → verify creation works
```

### Contextual Prompts:
```
1. Delete all quotas
2. Navigate to Pipeline Coverage page
3. Verify: "Set up quotas" banner appears
4. Click link → verify it navigates to Settings > Quotas
5. Upload quotas
6. Return to Pipeline Coverage → verify banner is gone
7. Verify: Coverage ratios now show as % of quota
```

### Edge Cases:
```
1. HubSpot not connected → "HubSpot Goals Sync" button disabled or hidden
2. HubSpot connected but no goals → "No goals found in HubSpot" message
3. Goals scope missing → Re-authorization prompt
4. Mix of HubSpot and manual quotas → Both show in table with correct source labels
5. Period with no quota data → Navigate back and forth, verify empty state per period
```

---

## DO NOT:

- Auto-apply HubSpot goals without user confirmation — always show preview first
- Overwrite manual quotas with HubSpot sync — only overwrite previous HubSpot-sourced quotas
- Fetch goals on every page load — cache in context_layer, refresh on explicit sync
- Require re-authorization for existing connections that don't need goals — make it optional
- Build quota editing within HubSpot (write-back) — HubSpot Goals API is read-only
- Add Salesforce quota sync in this prompt — that's a separate integration with different API patterns
- Show the quota table if user has no permission to edit settings — respect workspace roles

# HubSpot Contact Role Resolution

## Overview

Automatically infers buying roles for contacts associated with deals when HubSpot doesn't provide explicit role data. Uses a combination of:

1. **Title Pattern Matching** - Regex patterns map job titles to 6 role types
2. **Activity Analysis** - Meeting frequency, call volume, and timing patterns adjust confidence
3. **Batch Association Fetching** - Efficient API usage (100 deals per request)

## Role Types

| Role | Confidence | Characteristics |
|------|-----------|----------------|
| `executive_sponsor` | 0.7-0.9 | CEO, CFO, C-suite, EVP/SVP in relevant orgs |
| `decision_maker` | 0.7-0.9 | VP, Director (sales/revenue/ops), Head of, GM |
| `champion` | 0.7-0.9 | Manager/Lead in sales/revops, Sales Ops, Enablement |
| `technical_evaluator` | 0.7 | Engineer, Developer, Architect, IT Manager |
| `influencer` | 0.3-0.7 | Coordinator, Specialist, Associate, Advisor |
| `end_user` | 0.7 | SDR, BDR, AE, Rep, Agent |

**Fallback**: Unknown titles default to `influencer` with 0.3 confidence.

## Activity-Based Adjustments

The system boosts confidence based on engagement patterns:

- **High meeting count (≥3)**: Likely champion → +0.1 confidence
- **Late-stage executive engagement**: Decision maker enters after deal midpoint → `executive_sponsor`, +0.1
- **Heavy activity (≥5 activities, ≥2 meetings, ≥1 call)**: Unknown/influencer → `champion`, +0.15

Maximum confidence capped at 0.9 to indicate inference (not CRM-sourced).

## How It Works

### 1. Batch Association Fetching

```typescript
const associationsMap = await hubspotClient.batchGetAssociations(
  'deals',
  'contacts',
  dealSourceIds // Up to 100 deal IDs
);
// Returns Map<dealId, contactIds[]>
```

Efficient: 1 API call per 100 deals instead of N individual calls.

### 2. Role Inference

For each contact on a deal:

```typescript
// Step 1: Infer from title
let { role, confidence } = inferRoleFromTitle(contact.title);

// Step 2: Get activity profile
const activityProfile = await getContactDealActivities(contact.id, deal.id);

// Step 3: Adjust based on activity signals
({ role, confidence } = adjustRoleFromActivity(
  role,
  confidence,
  activityProfile,
  dealMidpoint
));
```

### 3. Upsert with Protection

```sql
INSERT INTO deal_contacts (buying_role, role_confidence, role_source)
VALUES ($role, $confidence, 'inferred')
ON CONFLICT (workspace_id, deal_id, contact_id)
DO UPDATE SET
  buying_role = CASE
    -- NEVER override CRM-sourced roles (from Salesforce)
    WHEN deal_contacts.role_source = 'crm' THEN deal_contacts.buying_role
    ELSE EXCLUDED.buying_role
  END
```

**Critical**: Salesforce data (`role_source = 'crm'`) is treated as ground truth and never overwritten.

## Auto-Trigger in Sync Flow

After HubSpot sync completes, automatically triggers if:

- `>50%` of deal_contacts are missing buying roles
- OR `deal_contacts` table is empty

```typescript
// server/connectors/hubspot/sync.ts (lines 743-763)
const dealContactsCheck = await query(`
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE buying_role IS NOT NULL) as with_roles
  FROM deal_contacts WHERE workspace_id = $1
`);

const missingRoles = total - with_roles;
if (total === 0 || missingRoles / total > 0.5) {
  resolveHubSpotContactRoles(client, workspaceId)
    .then(result => console.log('Contact role resolution complete:', result))
    .catch(err => console.error('Contact role resolution failed:', err));
}
```

Runs async (doesn't block sync completion).

## Manual Trigger

### API Endpoint

```bash
POST /api/workspaces/:workspaceId/connectors/hubspot/resolve-contact-roles
```

**Response**:
```json
{
  "success": true,
  "created": 150,
  "updated": 25,
  "skipped": 10,
  "total": 185
}
```

### Example Usage

```bash
curl -X POST http://localhost:3000/api/workspaces/abc-123/connectors/hubspot/resolve-contact-roles
```

## Testing

### 1. Verify Resolution Results

```sql
SELECT
  d.name as deal_name,
  c.first_name || ' ' || c.last_name as contact_name,
  c.title,
  dc.buying_role,
  dc.role_confidence,
  dc.role_source,
  (SELECT COUNT(*) FROM activities a
   WHERE a.contact_id = c.id AND a.deal_id = d.id) as activity_count
FROM deal_contacts dc
JOIN deals d ON d.id = dc.deal_id
JOIN contacts c ON c.id = dc.contact_id
WHERE d.workspace_id = '<workspace-id>'
  AND dc.role_source = 'inferred'
ORDER BY d.name, dc.role_confidence DESC
LIMIT 50;
```

### 2. Check Role Distribution

```sql
SELECT
  buying_role,
  COUNT(*) as count,
  ROUND(AVG(role_confidence), 2) as avg_confidence,
  MIN(role_confidence) as min_confidence,
  MAX(role_confidence) as max_confidence
FROM deal_contacts
WHERE workspace_id = '<workspace-id>'
  AND role_source = 'inferred'
GROUP BY buying_role
ORDER BY count DESC;
```

Expected distribution:
- `champion`: 30-40% (most common inferred role)
- `decision_maker`: 20-30%
- `influencer`: 15-25%
- `executive_sponsor`: 10-15%
- `technical_evaluator`: 5-10%
- `end_user`: 5-10%

### 3. Validate CRM Data Protection

```sql
-- This should return 0 (no CRM roles overwritten)
SELECT COUNT(*)
FROM deal_contacts
WHERE role_source = 'crm'
  AND updated_at > NOW() - INTERVAL '1 hour'
  AND workspace_id = '<workspace-id>';
```

## Activity Profile Schema

The system analyzes these activity metrics:

```typescript
interface ActivityProfile {
  totalActivities: number;  // All activities (meetings + calls + emails)
  meetings: number;         // Meeting count
  calls: number;           // Call count
  emails: number;          // Email count
  firstActivity: Date | null;  // When contact first engaged
  lastActivity: Date | null;   // Most recent activity
}
```

Query:
```sql
SELECT
  COUNT(a.id) as total_activities,
  COUNT(a.id) FILTER (WHERE a.activity_type = 'meeting') as meetings,
  COUNT(a.id) FILTER (WHERE a.activity_type = 'call') as calls,
  COUNT(a.id) FILTER (WHERE a.activity_type = 'email') as emails,
  MIN(a.timestamp) as first_activity,
  MAX(a.timestamp) as last_activity
FROM activities a
WHERE a.contact_id = $1 AND a.deal_id = $2
```

## Performance

- **Batch size**: 100 deals per API call
- **Rate limiting**: None (uses batch API)
- **Expected duration**: ~2-5 seconds per 100 deals (depends on activity volume)

## Known Limitations

1. **No LinkedIn/Apollo data**: Currently only uses HubSpot title data. Future enhancement: integrate enrichment data for better role inference.

2. **Activity history required**: Confidence adjustments rely on synced activities. If activities aren't synced, falls back to title-only inference.

3. **Single association source**: Only uses HubSpot associations. Doesn't cross-reference with Salesforce OpportunityContactRole yet.

## Roadmap

- [ ] Integrate Apollo enrichment data (seniority, department) to improve accuracy
- [ ] Add machine learning model trained on CRM ground truth data
- [ ] Cross-reference HubSpot associations with Salesforce OpportunityContactRole
- [ ] Add confidence threshold configuration (e.g., only show roles with >0.6 confidence)
- [ ] Track resolution accuracy over time (compare inferred vs. CRM-sourced when available)

## Files

- `server/connectors/hubspot/contact-role-resolution.ts` - Core logic
- `server/connectors/hubspot/client.ts:185` - `batchGetAssociations()` method
- `server/connectors/hubspot/sync.ts:743` - Auto-trigger integration
- `server/routes/hubspot.ts:204` - API endpoint

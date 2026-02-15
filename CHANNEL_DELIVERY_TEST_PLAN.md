# Channel Delivery Enhancement Test Plan

## Overview

Test plan to validate the agent channel delivery system before proceeding with Command Center A3-A4 implementation.

**Implementation Date:** 2026-02-15
**Required Migrations:** 032_workspace_downloads.sql, 033_findings_add_agent_run_id.sql

---

## Pre-Test Setup

### 1. Apply Migrations

```bash
npm run migrate
```

**Expected output:**
```
Running migration 032_workspace_downloads.sql
Running migration 033_findings_add_agent_run_id.sql
Migrations complete
```

### 2. Restart Server

```bash
npm run dev
```

**Verify console output includes:**
```
[Renderers] Registered 5 renderers: xlsx, pdf, slack_blocks, command_center, pptx (stub)
[server] Pandora v0.1.0 listening on port 3000
```

### 3. Verify Database Schema

```sql
-- Verify workspace_downloads table
\d workspace_downloads

-- Verify findings has agent_run_id column
\d findings

-- Expected columns in findings:
-- - agent_run_id (UUID, nullable, references agent_runs)
-- - skill_run_id (UUID, nullable)
-- - severity (TEXT with CHECK constraint: 'act', 'watch', 'notable', 'info')
```

---

## Test 1: Slack Message with Block Kit Formatting

### Objective
Verify that agent runs post Slack messages using the Block Kit renderer.

### Steps

1. **Execute Monday Pipeline Operator agent** (or any multi-skill agent)

```bash
curl -X POST http://localhost:3000/api/agents/pipeline-state/execute \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "test-workspace-uuid"
  }'
```

2. **Check Slack channel for posted message**

**Expected result:**
- ✅ Message posted to workspace's default Slack channel
- ✅ Message uses Block Kit format (sections, dividers, context blocks)
- ✅ Header block shows agent name
- ✅ Evidence from multiple skills presented in structured sections
- ✅ Footer shows Pandora Agent timestamp

3. **Query agent_runs table to verify Slack delivery**

```sql
SELECT deliveries FROM agent_runs
WHERE workspace_id = 'test-workspace-uuid'
ORDER BY started_at DESC LIMIT 1;
```

**Expected deliveries JSON:**
```json
[
  {
    "channel": "slack",
    "status": "success",
    "metadata": {
      "slack_message_ts": "1707987654.123456",
      "slack_channel_id": "C1234567890"
    }
  }
]
```

---

## Test 2: XLSX File in Workspace Downloads

### Objective
Verify that rendered files are saved to workspace storage and recorded in workspace_downloads table.

### Steps

1. **Create agent with download channel** (or modify existing agent)

```typescript
// Update agent definition to include download channel
{
  delivery: {
    channels: ['slack', 'download'],
    formats: ['xlsx'],
    download_ttl_hours: 24
  }
}
```

2. **Execute agent**

```bash
curl -X POST http://localhost:3000/api/agents/pipeline-state/execute \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "test-workspace-uuid"
  }'
```

3. **Verify file exists on disk**

```bash
ls -lh workspace_storage/test-workspace-uuid/downloads/

# Expected:
# agent-pipeline-state-2026-02-15.xlsx
```

4. **Query workspace_downloads table**

```sql
SELECT id, filename, format, file_size_bytes, created_at, expires_at
FROM workspace_downloads
WHERE workspace_id = 'test-workspace-uuid'
ORDER BY created_at DESC LIMIT 1;
```

**Expected result:**
- ✅ Row exists with filename matching pattern `agent-{agent-id}-{date}.xlsx`
- ✅ format = 'xlsx'
- ✅ file_size_bytes > 0
- ✅ expires_at = NOW() + 24 hours (if TTL specified)
- ✅ created_by = 'system'

5. **Download via API**

```bash
curl -X GET http://localhost:3000/api/workspaces/test-workspace-uuid/workspace-downloads/{download-id}/file \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -o test-download.xlsx
```

**Expected result:**
- ✅ File downloads successfully
- ✅ Opens in Excel/Google Sheets without errors
- ✅ Contains evidence from agent run (summary tab + skill tabs)

6. **Verify download tracking**

```sql
SELECT downloaded_count, last_downloaded_at
FROM workspace_downloads
WHERE id = '{download-id}';
```

**Expected result:**
- ✅ downloaded_count = 1
- ✅ last_downloaded_at = recent timestamp

---

## Test 3: Findings Table Population (Active Findings)

### Objective
Verify that findings are extracted from agent output and inserted into findings table with correct severity mapping.

### Steps

1. **Execute agent with extract_findings enabled**

```typescript
// Ensure agent has command_center channel
{
  delivery: {
    channels: ['slack', 'download', 'command_center'],
    extract_findings: true
  }
}
```

2. **Execute agent**

```bash
curl -X POST http://localhost:3000/api/agents/pipeline-state/execute \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "test-workspace-uuid"
  }'
```

3. **Query findings table for new findings**

```sql
SELECT id, skill_id, severity, category, message, agent_run_id, skill_run_id, resolved_at
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND resolved_at IS NULL
ORDER BY created_at DESC;
```

**Expected result:**
- ✅ Multiple findings rows inserted (one per claim in skill evidence)
- ✅ agent_run_id is populated (matches agent run UUID)
- ✅ skill_run_id is NULL (extracted from agent, not individual skill run)
- ✅ resolved_at IS NULL (active findings)
- ✅ Severity values mapped correctly:
  - Skills use 'critical' → findings table has 'act'
  - Skills use 'warning' → findings table has 'watch'
  - Skills use 'info' → findings table has 'info'

4. **Verify severity mapping**

```sql
-- Count findings by severity
SELECT severity, COUNT(*) as count
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND resolved_at IS NULL
GROUP BY severity;
```

**Expected result:**
- ✅ Only valid severity values: 'act', 'watch', 'notable', 'info'
- ✅ No 'critical' or 'warning' values (these are skill evidence severities)

5. **Verify entity associations**

```sql
SELECT entity_type, entity_id, message
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND entity_type IS NOT NULL
  AND resolved_at IS NULL
LIMIT 5;
```

**Expected result:**
- ✅ entity_type populated ('deal', 'account', 'contact', 'conversation')
- ✅ entity_id populated (UUID from entity table)
- ✅ message contains specific claim text from skill evidence

---

## Test 4: Findings Auto-Resolution (Superseded Findings)

### Objective
Verify that previous findings from the same skills are auto-resolved when new agent run completes.

### Steps

1. **Execute agent first time** (creates initial findings)

```bash
curl -X POST http://localhost:3000/api/agents/pipeline-state/execute \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "test-workspace-uuid"
  }'
```

2. **Record initial findings count**

```sql
SELECT COUNT(*) as initial_count
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND resolved_at IS NULL;
```

**Note the count** (e.g., 12 findings)

3. **Wait 30 seconds** (simulate time passing)

4. **Execute agent second time** (same skills, new run)

```bash
curl -X POST http://localhost:3000/api/agents/pipeline-state/execute \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "test-workspace-uuid"
  }'
```

5. **Query findings to verify auto-resolution**

```sql
-- Check resolved findings (from first run)
SELECT COUNT(*) as resolved_count
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND resolved_at IS NOT NULL;
```

**Expected result:**
- ✅ resolved_count ≈ initial_count (previous findings auto-resolved)

6. **Verify new findings are active**

```sql
-- Check active findings (from second run)
SELECT COUNT(*) as active_count, MAX(created_at) as latest_created
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND resolved_at IS NULL;
```

**Expected result:**
- ✅ active_count > 0 (new findings inserted)
- ✅ latest_created = recent timestamp (within last minute)

7. **Verify skill-specific resolution**

```sql
-- Show resolution timeline for specific skill
SELECT skill_id, created_at, resolved_at,
       CASE WHEN resolved_at IS NULL THEN 'ACTIVE' ELSE 'RESOLVED' END as status
FROM findings
WHERE workspace_id = 'test-workspace-uuid'
  AND skill_id = 'pipeline-hygiene'
ORDER BY created_at DESC;
```

**Expected result:**
- ✅ Latest findings have resolved_at IS NULL (ACTIVE)
- ✅ Previous findings have resolved_at = timestamp of second run
- ✅ Only findings from the executed skills are resolved (other skills' findings untouched)

---

## Integration Verification

### Verify Channel Delivery Results

```sql
SELECT
  ar.id,
  ar.status,
  ar.deliveries,
  COUNT(f.id) as findings_extracted
FROM agent_runs ar
LEFT JOIN findings f ON f.agent_run_id = ar.id AND f.resolved_at IS NULL
WHERE ar.workspace_id = 'test-workspace-uuid'
GROUP BY ar.id
ORDER BY ar.started_at DESC
LIMIT 1;
```

**Expected result:**
```json
{
  "id": "agent-run-uuid",
  "status": "completed",
  "deliveries": [
    { "channel": "slack", "status": "success", "metadata": { "slack_message_ts": "..." } },
    { "channel": "download", "status": "success", "metadata": { "download_id": "...", "download_url": "..." } },
    { "channel": "command_center", "status": "success", "metadata": { "findings_count": 12 } }
  ],
  "findings_extracted": 12
}
```

---

## Success Criteria (All Must Pass)

✅ **Test 1 PASS:** Slack message posts with Block Kit formatting
✅ **Test 2 PASS:** XLSX file appears in workspace downloads table and on disk
✅ **Test 3 PASS:** Findings table has rows with resolved_at IS NULL for current findings
✅ **Test 4 PASS:** Previous findings from the same skills got resolved_at set (superseded)

**Additional criteria:**
✅ Severity mapping works correctly ('critical' → 'act', 'warning' → 'watch')
✅ Entity associations preserved (deal_id, account_id, entity_type, entity_id)
✅ Download tracking increments correctly
✅ File cleanup respects TTL (if tested after expiry time)

---

## Common Issues & Troubleshooting

### Issue: Slack message doesn't post

**Check:**
1. Workspace has Slack integration configured
2. Agent definition has `delivery.channels` including 'slack'
3. Console logs for Slack delivery errors

**Fix:**
```sql
-- Verify Slack settings
SELECT slack_webhook_url FROM workspaces WHERE id = 'workspace-uuid';

-- Or check Slack app client config
SELECT * FROM slack_settings WHERE workspace_id = 'workspace-uuid';
```

### Issue: XLSX file not found on disk

**Check:**
1. workspace_storage directory exists and has write permissions
2. Console logs for file write errors
3. workspace_downloads record exists but file missing

**Fix:**
```bash
# Create directory if missing
mkdir -p workspace_storage/test-workspace-uuid/downloads
chmod 755 workspace_storage/test-workspace-uuid/downloads
```

### Issue: Findings have wrong severity values

**Check:**
```sql
-- Look for unmapped severity values
SELECT DISTINCT severity FROM findings
WHERE workspace_id = 'workspace-uuid';
```

**Expected:** Only 'act', 'watch', 'notable', 'info'
**If you see:** 'critical', 'warning' → mapping function not applied

**Fix:** Verify `mapSeverity()` function is called in channels.ts line ~416

### Issue: Findings not auto-resolved on second run

**Check:**
```sql
-- Verify skill_ids match between runs
SELECT DISTINCT skill_id FROM findings
WHERE workspace_id = 'workspace-uuid'
ORDER BY created_at DESC;
```

**Common cause:** Agent changed skill list between runs
**Fix:** Run same agent definition twice

### Issue: agent_run_id column doesn't exist

**Error:** `column "agent_run_id" of relation "findings" does not exist`

**Fix:**
```bash
# Apply missing migration
npm run migrate

# Or manually:
psql $DATABASE_URL -c "ALTER TABLE findings ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_runs(id);"
```

---

## Performance Benchmarks

**Expected latencies:**

| Operation | Expected | Acceptable | Slow |
|-----------|----------|------------|------|
| Agent execution (3 skills) | 8-15s | < 30s | > 30s |
| Slack delivery | 200-500ms | < 1s | > 1s |
| File write to disk | 100-300ms | < 1s | > 1s |
| Findings extraction (10 claims) | 50-150ms | < 500ms | > 500ms |
| Download file stream | 50-200ms | < 500ms | > 500ms |

---

## Test Execution Log

**Date:**
**Tester:**
**Environment:** (Replit / Local / Staging)

| Test | Status | Notes |
|------|--------|-------|
| Pre-Test: Migrations applied | ⬜ PENDING |  |
| Pre-Test: Server restarted | ⬜ PENDING |  |
| Pre-Test: Schema verified | ⬜ PENDING |  |
| Test 1: Slack Block Kit | ⬜ PENDING |  |
| Test 2: XLSX Download | ⬜ PENDING |  |
| Test 3: Findings Insertion | ⬜ PENDING |  |
| Test 4: Findings Auto-Resolve | ⬜ PENDING |  |
| Integration: All channels | ⬜ PENDING |  |

**Overall Result:** ⬜ PENDING

---

**End of Test Plan**

Once all tests pass, the Command Center A3-A4 implementation can proceed. The dossier assemblers and scoped analysis endpoints depend on the findings table being correctly populated.

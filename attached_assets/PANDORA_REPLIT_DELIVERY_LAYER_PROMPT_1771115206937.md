# Replit Prompt: Evidence Verification + Delivery Layer Build

## Context

Claude Code just shipped the evidence architecture across two sessions:
- Session 1: Evidence types, evidenceSchema on all 18 skills, agent runtime accumulation, agent_runs migration
- Session 2: EvidenceBuilder utility, 18 per-skill evidence builders, CWD compute functions, adapter registration, runtime wiring, DB persistence

The evidence pipeline is: skill runs → evidence builder assembles claims/records/sources/params → stored in skill_runs.result_data → agent runtime accumulates into agent_runs.skill_evidence.

**Your job: verify it works end-to-end, then build the rendering layer that consumes it.**

---

## PHASE 1: Verify Evidence Architecture (before building anything)

### Test 1: Pipeline-hygiene evidence

```bash
# Run the skill
curl -X POST http://localhost:3000/api/workspaces/<frontera_id>/skills/pipeline-hygiene/run

# Then query
```

```sql
SELECT 
  result_data->'evidence' IS NOT NULL as has_evidence,
  jsonb_array_length(COALESCE(result_data->'evidence'->'claims', '[]')) as claims,
  jsonb_array_length(COALESCE(result_data->'evidence'->'evaluated_records', '[]')) as records,
  jsonb_array_length(COALESCE(result_data->'evidence'->'data_sources', '[]')) as sources,
  jsonb_array_length(COALESCE(result_data->'evidence'->'parameters', '[]')) as params
FROM skill_runs 
WHERE skill_id = 'pipeline-hygiene' 
ORDER BY started_at DESC LIMIT 1;
```

Expected: has_evidence=true, claims>=1, records>0, sources>=1, params>=1

### Test 2: Cross-reference integrity

```sql
-- Every entity_id in claims should exist in evaluated_records
WITH latest AS (
  SELECT result_data->'evidence' as ev
  FROM skill_runs WHERE skill_id = 'pipeline-hygiene'
  ORDER BY started_at DESC LIMIT 1
),
claim_ids AS (
  SELECT jsonb_array_elements_text(
    jsonb_array_elements(ev->'claims')->'entity_ids'
  ) as eid FROM latest
),
record_ids AS (
  SELECT jsonb_array_elements(ev->'evaluated_records')->>'entity_id' as eid 
  FROM latest
)
SELECT c.eid, c.eid IN (SELECT eid FROM record_ids) as found
FROM claim_ids c;
```

Expected: all rows show found=true

### Test 3: Agent-level evidence

```bash
curl -X POST http://localhost:3000/api/workspaces/<frontera_id>/agents/pipeline-state/run
```

```sql
SELECT 
  skill_evidence IS NOT NULL as has_evidence,
  jsonb_object_keys(skill_evidence) as skill_keys
FROM agent_runs 
WHERE agent_id = 'pipeline-state'
ORDER BY started_at DESC LIMIT 1;
```

Expected: has_evidence=true, skill_keys shows each composed skill

### Test 4: Run 3 more skills, verify evidence exists

Run single-thread-alert, deal-risk-review, and pipeline-coverage.
For each, verify evidence exists in skill_runs with the same query 
pattern as Test 1. Pipeline-coverage should have entity_type='rep' 
in evaluated_records.

### Test 5: Data source accuracy

```sql
SELECT 
  ds->>'source' as source,
  ds->>'connected' as connected,
  ds->>'last_sync' as last_sync,
  ds->>'records_available' as records
FROM skill_runs,
  jsonb_array_elements(result_data->'evidence'->'data_sources') as ds
WHERE skill_id = 'pipeline-hygiene'
ORDER BY started_at DESC LIMIT 1;
```

Verify: connected sources match what's actually configured for 
the workspace. Disconnected sources should show connected=false.

### Test 6: Parameter values match workspace config

```sql
SELECT 
  p->>'name' as param,
  p->>'value' as value,
  p->>'configurable' as configurable
FROM skill_runs,
  jsonb_array_elements(result_data->'evidence'->'parameters') as p
WHERE skill_id = 'pipeline-hygiene'
ORDER BY started_at DESC LIMIT 1;
```

Verify: stale_threshold_days matches the workspace config value 
(or default 30 if not configured).

**STOP HERE if any test fails. Fix before proceeding to Phase 2.**

Report results:
- Test 1: PASS/FAIL (claims=?, records=?, sources=?, params=?)
- Test 2: PASS/FAIL (all entity_ids found?)
- Test 3: PASS/FAIL (agent evidence accumulated?)
- Test 4: PASS/FAIL (3 skills verified?)
- Test 5: PASS/FAIL (sources accurate?)
- Test 6: PASS/FAIL (params match config?)

---

## PHASE 2: Slack Formatter Upgrade (~3-4 hours)

### Goal
When a skill or agent delivers to Slack, render evidence as inline 
deal lists with methodology footers instead of flat narrative text.

### Find the existing formatter
Look in server/delivery/, server/slack/, or search for 
'slack' + 'format' or 'webhook'. Find where skill/agent 
output gets turned into Slack blocks before posting.

### New rendering logic

When evidence exists on the output, replace flat narrative with 
structured claim blocks. If no evidence, fall back to existing 
behavior (backward compatible).

For each claim in evidence.claims, render:

```
🔴 **4 deals worth $380K are stale (30+ days, zero activity)**

→ Acme Corp — $140K — Sarah — 41 days inactive
→ Globex — $95K — Mike — 34 days inactive
→ Initech — $85K — Sarah — 67 days inactive
→ Contoso — $60K — James — 28 days inactive

_Based on: HubSpot ✓, Gong ✓, Fireflies ✗ (not connected). Threshold: 30 days._
```

Implementation:

```typescript
function formatEvidenceSlack(output: SkillOutput): SlackBlock[] {
  if (!output.evidence?.claims?.length) {
    // Fallback: render narrative as before
    return formatNarrativeSlack(output.narrative);
  }
  
  const blocks: SlackBlock[] = [];
  
  // Render each claim as a section
  for (const claim of output.evidence.claims) {
    // Severity emoji
    const emoji = claim.severity === 'critical' ? '🔴' 
      : claim.severity === 'warning' ? '🟡' : 'ℹ️';
    
    // Claim header
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${claim.claim_text}*` }
    });
    
    // Deal list (top 5 from the claim's entity_ids)
    const dealLines = claim.entity_ids
      .slice(0, 5)
      .map(id => {
        const record = output.evidence.evaluated_records
          .find(r => r.entity_id === id);
        if (!record) return null;
        const amount = record.fields.amount 
          ? `$${Math.round(record.fields.amount / 1000)}K` : '';
        const metric = claim.metric_values?.[
          claim.entity_ids.indexOf(id)
        ];
        return `→ ${record.entity_name} — ${amount} — ${record.owner_name} — ${metric} ${claim.metric_name?.replace(/_/g, ' ')}`;
      })
      .filter(Boolean)
      .join('\n');
    
    if (dealLines) {
      blocks.push({
        type: 'section', 
        text: { type: 'mrkdwn', text: dealLines }
      });
    }
    
    // Show remaining count if > 5
    if (claim.entity_ids.length > 5) {
      blocks.push({
        type: 'context',
        elements: [{ 
          type: 'mrkdwn', 
          text: `_+ ${claim.entity_ids.length - 5} more_` 
        }]
      });
    }
  }
  
  // Methodology footer
  const sourceList = output.evidence.data_sources
    .map(ds => `${ds.source} ${ds.connected ? '✓' : '✗'}${!ds.connected ? ' (not connected)' : ''}`)
    .join(', ');
  
  const thresholds = output.evidence.parameters
    .filter(p => p.configurable)
    .map(p => `${p.display_name}: ${p.value}`)
    .join(', ');
  
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ 
      type: 'mrkdwn', 
      text: `_Sources: ${sourceList}. ${thresholds ? `Thresholds: ${thresholds}.` : ''}_` 
    }]
  });
  
  return blocks;
}
```

### For agent output (multiple skills)

When an agent delivers, it has multiple skills' evidence. Render 
the narrative sections with claim blocks interspersed. The agent 
synthesis narrative likely has [claim_id] markers that you can use 
to match claims to narrative paragraphs. If not, render claims 
grouped by skill after the narrative.

### Handle both paths

```typescript
async function deliverToSlack(output, webhookUrl) {
  const blocks = output.evidence?.claims?.length
    ? formatEvidenceSlack(output)   // NEW: structured evidence
    : formatNarrativeSlack(output.narrative);  // EXISTING: plain text
  
  await postToSlack(webhookUrl, blocks);
}
```

### Test

Run pipeline-hygiene with Slack delivery enabled. Verify:
- Claim blocks appear with emoji + bold text
- Deal list shows under each claim (up to 5)
- Methodology footer shows connected/disconnected sources
- If you disable evidence (delete it from result), falls back to 
  plain narrative

---

## PHASE 3: WorkbookGenerator Service (~6-8 hours)

### Goal
A shared service that takes any skill or agent run's evidence 
and produces a multi-tab .xlsx file. No per-skill templates — 
it reads column schemas from skill evidenceSchema declarations.

### Install dependency

```bash
npm install exceljs
```

### Create server/delivery/workbook-generator.ts

```typescript
import ExcelJS from 'exceljs';

interface WorkbookOptions {
  agentName?: string;
  skillId?: string;
  runDate: string;
  narrative: string;
  workspaceName: string;
  // For single skill runs:
  evidence?: SkillEvidence;
  evidenceSchema?: EvidenceSchema;
  // For agent runs (multiple skills):
  skillEvidence?: Record<string, SkillEvidence>;
}

export async function generateWorkbook(
  options: WorkbookOptions
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  
  // ============================
  // TAB 1: Summary & Methodology
  // ============================
  const summary = wb.addWorksheet('Summary & Methodology');
  
  // Run metadata
  addMetadataSection(summary, {
    title: options.agentName || options.skillId,
    runDate: options.runDate,
    workspace: options.workspaceName,
  });
  
  // Full narrative
  addNarrativeSection(summary, options.narrative);
  
  // Merge all evidence sources
  const allEvidence = options.skillEvidence 
    ? Object.values(options.skillEvidence)
    : options.evidence ? [options.evidence] : [];
  
  // Data sources section
  const mergedSources = mergeDataSources(allEvidence);
  addDataSourcesSection(summary, mergedSources);
  
  // Parameters section (configurable thresholds in yellow)
  const mergedParams = mergeParameters(allEvidence);
  addParametersSection(summary, mergedParams);
  // Track parameter cell locations for formula references
  const paramCells = getParameterCellMap(summary, mergedParams);
  
  // Key metrics with formulas pointing to data tabs
  addKeyMetricsSection(summary, allEvidence);
  
  // Methodology
  addMethodologySection(summary, mergedSources, mergedParams);
  
  // ============================
  // TAB 2-N: One per skill
  // ============================
  if (options.skillEvidence) {
    // Agent run: one tab per skill
    for (const [key, evidence] of Object.entries(options.skillEvidence)) {
      const skill = getSkillFromRegistry(evidence);
      const schema = skill?.evidenceSchema;
      if (schema && evidence.evaluated_records?.length > 0) {
        addDataTab(wb, {
          tabName: skill.displayName || key,
          schema,
          evidence,
          paramCells,
        });
      }
    }
  } else if (options.evidence && options.evidenceSchema) {
    // Single skill run: one data tab
    addDataTab(wb, {
      tabName: 'Data',
      schema: options.evidenceSchema,
      evidence: options.evidence,
      paramCells,
    });
  }
  
  // Return buffer
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

### addDataTab implementation

This is the key function. It reads the evidenceSchema columns 
and builds the tab dynamically:

```typescript
function addDataTab(wb, { tabName, schema, evidence, paramCells }) {
  const ws = wb.addWorksheet(tabName);
  
  // Styles
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B5797' } };
  const formulaFont = { color: { argb: 'FF0000FF' } };  // blue = formula
  
  // Headers from schema columns
  const columns = schema.columns;
  // Always include: Entity Name, Owner
  const allCols = [
    { key: 'entity_name', display_name: 'Name', format: 'text' },
    { key: 'owner_name', display_name: 'Owner', format: 'text' },
    ...columns,
    { key: 'severity', display_name: 'Severity', format: 'severity' },
  ];
  
  // Write headers
  allCols.forEach((col, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = col.display_name;
    cell.font = headerFont;
    cell.fill = headerFill;
  });
  
  // Write data rows
  evidence.evaluated_records.forEach((record, rowIdx) => {
    const row = rowIdx + 2;
    
    allCols.forEach((col, colIdx) => {
      const cell = ws.getCell(row, colIdx + 1);
      
      // Get value from record
      let value;
      if (col.key === 'entity_name') value = record.entity_name;
      else if (col.key === 'owner_name') value = record.owner_name;
      else if (col.key === 'severity') value = record.severity;
      else value = record.fields?.[col.key] ?? record.flags?.[col.key] ?? '';
      
      cell.value = value;
      
      // Format based on column type
      switch (col.format) {
        case 'currency':
          cell.numFmt = '$#,##0';
          break;
        case 'percentage':
          cell.numFmt = '0.0%';
          break;
        case 'number':
          cell.numFmt = '#,##0';
          break;
      }
    });
    
    // Conditional row coloring based on severity
    const severityVal = record.severity;
    const fill = severityVal === 'critical' 
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } }  // light red
      : severityVal === 'warning'
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } }  // light yellow
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };  // light green
    
    allCols.forEach((_, colIdx) => {
      ws.getCell(row, colIdx + 1).fill = fill;
    });
  });
  
  // Auto-fit columns
  ws.columns.forEach(col => { col.width = 18; });
  
  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  
  // Auto-filter
  ws.autoFilter = { 
    from: { row: 1, column: 1 }, 
    to: { row: evidence.evaluated_records.length + 1, column: allCols.length } 
  };
  
  // Summary row at bottom
  const summaryRow = evidence.evaluated_records.length + 3;
  ws.getCell(summaryRow, 1).value = 'SUMMARY';
  ws.getCell(summaryRow, 1).font = { bold: true };
  
  // Count by severity
  ws.getCell(summaryRow + 1, 1).value = 'Critical:';
  ws.getCell(summaryRow + 1, 2).value = evidence.evaluated_records.filter(r => r.severity === 'critical').length;
  ws.getCell(summaryRow + 2, 1).value = 'Warning:';
  ws.getCell(summaryRow + 2, 2).value = evidence.evaluated_records.filter(r => r.severity === 'warning').length;
  ws.getCell(summaryRow + 3, 1).value = 'Healthy:';
  ws.getCell(summaryRow + 3, 2).value = evidence.evaluated_records.filter(r => r.severity === 'healthy').length;
}
```

### Parameter cells with formula references

The yellow configurable parameter cells on Tab 1 need to be 
referenceable from data tabs. Track their cell positions:

```typescript
function getParameterCellMap(ws, params): Map<string, string> {
  // Returns map like: { 'stale_threshold_days': "'Summary & Methodology'!B51" }
  // So data tab formulas can reference thresholds
}
```

For skills that define formula templates in evidenceSchema.formulas, 
apply them. But this is a v2 enhancement — for v1, use static values 
with the parameter cells available for manual reference. Users can 
still see the thresholds on Tab 1 and understand the assumptions.

### Formatting standards

- Blue text (font color 0000FF): formula cells
- Yellow background (FFFFFF00): configurable parameters on Tab 1
- Red/yellow/green row fills: severity-based
- Header row: dark blue background, white text, frozen
- Auto-filter on all data tabs
- Column width: 18 default, auto-fit where possible

---

## PHASE 4: Export Endpoint (~2-3 hours)

### Routes

```typescript
// Single skill run export
GET /api/workspaces/:id/skills/:skillId/runs/:runId/export?format=xlsx

// Agent run export  
GET /api/workspaces/:id/agents/:agentId/runs/:runId/export?format=xlsx
```

### Implementation

```typescript
router.get('/api/workspaces/:id/skills/:skillId/runs/:runId/export', 
  async (req, res) => {
    const { id, skillId, runId } = req.params;
    const format = req.query.format || 'xlsx';
    
    // Load the skill run
    const run = await db.query(
      'SELECT * FROM skill_runs WHERE id = $1 AND workspace_id = $2',
      [runId, id]
    );
    if (!run.rows[0]) return res.status(404).json({ error: 'Run not found' });
    
    const resultData = run.rows[0].result_data;
    if (!resultData?.evidence) {
      return res.status(400).json({ error: 'No evidence data for this run' });
    }
    
    // Get skill definition for evidenceSchema
    const skill = skillRegistry.get(skillId);
    
    // Get workspace name
    const workspace = await db.query(
      'SELECT name FROM workspaces WHERE id = $1', [id]
    );
    
    // Generate workbook
    const buffer = await generateWorkbook({
      skillId,
      runDate: run.rows[0].started_at,
      narrative: resultData.narrative || '',
      workspaceName: workspace.rows[0]?.name || 'Unknown',
      evidence: resultData.evidence,
      evidenceSchema: skill?.evidenceSchema,
    });
    
    // Return file
    const filename = `pandora-${skillId}-${new Date(run.rows[0].started_at)
      .toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
);
```

Same pattern for agent runs, but pass `skillEvidence` instead of 
single `evidence`.

### Test

```bash
# Get the latest pipeline-hygiene run ID
RUN_ID=$(curl -s http://localhost:3000/api/workspaces/<id>/skills/pipeline-hygiene/runs | jq -r '.[0].id')

# Download the workbook
curl -o test-export.xlsx http://localhost:3000/api/workspaces/<id>/skills/pipeline-hygiene/runs/$RUN_ID/export?format=xlsx

# Verify file is valid xlsx (not empty or error HTML)
file test-export.xlsx
# Should show: Microsoft Excel 2007+
```

Open in Excel/Sheets and verify:
- Tab 1 has metadata, narrative, data sources, parameters
- Tab 2 has deal rows with severity coloring
- Parameters are in yellow cells
- Auto-filter works on data tab

---

## PHASE 5: Agent Deliverable Config (~2 hours)

### Extend AgentDefinition type

In server/agents/types.ts:

```typescript
interface AgentDelivery {
  channels: DeliveryChannel[];
}

interface DeliveryChannel {
  type: 'slack' | 'email' | 'download' | 'command_center';
  config?: {
    webhookUrl?: string;    // for slack
    emailTo?: string[];     // for email (future)
  };
}

interface AgentDeliverable {
  format: 'narrative_only' | 'narrative_plus_data' | 'full_audit';
  exports?: ('xlsx' | 'pdf')[];
  include_methodology?: boolean;
}
```

### Migrate existing agents

All 6 existing agents currently have:
```typescript
delivery: { channel: 'slack', format: 'slack' }
```

Migrate to:
```typescript
delivery: {
  channels: [{ type: 'slack' }]
},
deliverable: {
  format: 'narrative_only',
  exports: [],
}
```

This is backward compatible — existing behavior unchanged.

### Wire deliverable into agent execution

In the agent runtime, after synthesis completes:

```typescript
// After synthesis
if (agent.deliverable?.exports?.includes('xlsx')) {
  const buffer = await generateWorkbook({
    agentName: agent.name,
    runDate: new Date().toISOString(),
    narrative: synthesizedOutput,
    workspaceName: workspace.name,
    skillEvidence: accumulatedEvidence,
  });
  
  // Store for download endpoint
  await storeAgentExport(runId, buffer);
  
  // Optionally attach to Slack (requires files.upload scope)
  // For v1: just make it downloadable via the export endpoint
}
```

### Test

Update one agent definition to include `exports: ['xlsx']`.
Run it. Verify the export endpoint returns a valid workbook 
with multiple tabs (one per composed skill).

---

## Summary of deliverables

| Phase | What ships | User impact |
|-------|-----------|-------------|
| 1 | Verification | Confirms foundation is solid |
| 2 | Slack formatter | Monday briefings show deal names under claims |
| 3 | WorkbookGenerator | Downloadable spreadsheets from any run |
| 4 | Export endpoint | GET route to download xlsx files |
| 5 | Deliverable config | Agents can be configured to produce xlsx |

**Do Phase 1 first. Report results. If all pass, proceed through 2-5 in order.**

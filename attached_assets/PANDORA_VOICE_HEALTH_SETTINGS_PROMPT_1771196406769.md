# Pandora — Voice/Tone, Connector Health, and Settings Pages

## Context

Three pages that build trust and give users control over Pandora's behavior. These ship after the list pages and pipeline chart are complete.

**Do NOT modify:** sidebar, routing, workspace selector, Command Center, deals list, accounts list, deal detail, account detail, Insights Feed, Actions, Skills page. These work. Leave them alone.

---

## Task 1: Voice & Tone Controls (2-3 hours)

### Problem

Pandora's AI-synthesized outputs (findings, Slack briefings, Ask Pandora responses, narrative summaries) sometimes use overly dramatic language that undermines trust with VP-level buyers. Language like "CRITICAL: Pipeline is hemorrhaging deals" reads as an alarm rather than a professional tool. RevOps operators want factual, actionable language — not hype.

### What Exists

The voice configuration infrastructure is already built:

1. **VoiceConfig schema** with three axes:
   - `detail_level`: `'executive'` | `'manager'` | `'analyst'` — controls output length and depth
   - `framing`: `'direct'` | `'diplomatic'` | `'consultative'` — controls tone
   - `alert_threshold`: controls which severity levels surface proactively

2. **Synthesis prompt injection** — the cell populator and skill formatters already read `voiceConfig` and append instructions to Claude prompts based on the settings (e.g., "Executive audience: be extremely concise. 1-2 sentences max.")

3. **Workspace config API** — `GET/PUT/PATCH /api/workspaces/:id/config` stores config including voice settings in the context_layer table

### What Needs to Happen

#### 1a. Verify Voice Config is Stored and Readable

Check if `voiceConfig` (or `voice`) is a field on the workspace config object. If not, add it:

```typescript
// In the WorkspaceConfig type or context_layer storage:
voice: {
  detail_level: 'executive' | 'manager' | 'analyst';  // default: 'manager'
  framing: 'direct' | 'diplomatic' | 'consultative';   // default: 'direct'
  alert_threshold: 'all' | 'watch_and_above' | 'act_only';  // default: 'watch_and_above'
}
```

If voice config doesn't exist yet for a workspace, return sensible defaults: `{ detail_level: 'manager', framing: 'direct', alert_threshold: 'watch_and_above' }`.

#### 1b. Verify Voice Config Flows to Synthesis

Trace the code path from skill execution → Claude synthesis → output. Confirm that:
- The skill runner reads `voiceConfig` from the workspace config
- The synthesis prompt includes voice instructions based on the config
- The findings/narrative output respects the instructions

If any step in this chain is broken or missing, wire it. The synthesis prompt logic from the codebase already has the switch statements for detail_level and framing — verify they're actually called, not just defined.

#### 1c. Add Anti-Hype System Prompt Rules

In the base synthesis prompt (wherever Claude is called for findings, narratives, or analysis), add these rules BEFORE the voice-specific instructions:

```
TONE RULES (apply to all outputs):
- Never use "CRITICAL", "URGENT", "ALARM", or "ALERT" as labels. Use severity levels (act/watch/notable/info) which are displayed as colored indicators.
- Never use dramatic language: "hemorrhaging", "crisis", "catastrophic", "dire", "alarming"
- Never use exclamation marks in findings or analysis
- State facts, then state the implication. Example:
  BAD:  "CRITICAL: Pipeline is dangerously thin! Only 1.2x coverage!"
  GOOD: "Pipeline coverage is 1.2x against a 3.0x target. At current win rates, this covers 40% of quota."
- When something is genuinely severe, the data makes that clear — you don't need to amplify it with language
- Use "consider", "may want to", "worth reviewing" instead of "must", "needs to", "has to" for recommendations
- Reference specific numbers and records. "3 deals totaling $420K have been in Proposal for 30+ days" is better than "Several deals are dangerously stagnant"
```

Add these rules to:
- The skill synthesis phase (Phase 3 of the compute → classify → synthesize pattern)
- The `/analyze` endpoint's system prompt (Ask Pandora)
- The narrative generator in dossiers (if separate from skill synthesis)
- The Slack formatter's synthesis prompt (if it uses one)

#### 1d. QA Existing Findings

Run a quick QA pass on the existing findings in the database:

```sql
SELECT severity, message, skill_name 
FROM findings 
WHERE workspace_id = '<frontera_id>' 
  AND status = 'open' 
ORDER BY created_at DESC 
LIMIT 20;
```

Check if any existing finding messages use dramatic language. If the tone rules are only applied at synthesis time (not retroactively), that's fine — new skill runs will produce better output. But note any existing bad examples so we know the fix is needed.

#### 1e. Test the Full Loop

1. Set Frontera's voice config to `{ detail_level: 'executive', framing: 'direct', alert_threshold: 'act_only' }`
2. Trigger a skill run (Pipeline Hygiene or Single-Thread Alert)
3. Read the output — it should be 1-2 sentences, factual, no drama
4. Change to `{ detail_level: 'analyst', framing: 'consultative' }`
5. Run the same skill again
6. Read the output — it should be 3-5 sentences with data points and "consider" framing
7. Both outputs should follow the anti-hype rules

If the output doesn't change between voice settings, the voice config isn't flowing through to synthesis — fix the wiring.

---

## Task 2: Connector Health Page — `/connector-health` (3-4 hours)

### Purpose

RevOps operators won't trust Pandora's insights if they can't verify the data pipeline is healthy. This page shows sync status, error details, data freshness, and record counts for each connected data source.

### Data Sources

The data already exists in the database:

```sql
-- Connector status
SELECT connector_type, status, last_sync_at, last_error, 
       created_at, metadata
FROM connector_configs 
WHERE workspace_id = $1;

-- Sync history
SELECT sync_type, started_at, completed_at, duration_ms,
       records_synced, errors, status
FROM sync_log 
WHERE workspace_id = $1 
ORDER BY started_at DESC;

-- Record counts per entity
SELECT 
  (SELECT count(*) FROM deals WHERE workspace_id = $1) as deal_count,
  (SELECT count(*) FROM contacts WHERE workspace_id = $1) as contact_count,
  (SELECT count(*) FROM accounts WHERE workspace_id = $1) as account_count,
  (SELECT count(*) FROM conversations WHERE workspace_id = $1) as conversation_count;
```

### API Endpoints Needed

If these don't already exist, create them:

```
GET /api/workspaces/:id/connectors/health
  Returns: array of connector health objects

GET /api/workspaces/:id/sync-log?connector=&limit=20
  Returns: paginated sync history

POST /api/workspaces/:id/connectors/:connectorType/sync
  Triggers a manual sync (if the sync orchestrator supports it)
```

**Connector health response shape:**
```typescript
{
  connectors: [
    {
      type: "hubspot",
      status: "connected" | "error" | "stale" | "disconnected",
      last_sync_at: "2026-02-15T10:00:00Z",
      last_error: null | "Token expired",
      records: {
        deals: 247,
        contacts: 892,
        accounts: 156
      },
      freshness: {
        hours_since_sync: 4,
        is_stale: false,        // true if > 24 hours
        is_critical: false      // true if > 72 hours
      }
    },
    {
      type: "gong",
      status: "connected",
      last_sync_at: "2026-02-14T22:00:00Z",
      records: {
        conversations: 66
      },
      freshness: {
        hours_since_sync: 16,
        is_stale: false,
        is_critical: false
      }
    }
  ],
  totals: {
    deals: 247,
    contacts: 892,
    accounts: 156,
    conversations: 87     // gong + fireflies combined
  }
}
```

### Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Connector Health                                           │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ 🟢 HubSpot  │  │ 🟢 Gong     │  │ 🟡 Fireflies│        │
│  │ Connected   │  │ Connected   │  │ Stale       │        │
│  │ 4h ago      │  │ 16h ago     │  │ 3d ago      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  Record Inventory                                           │
│  ─────────────────────────────────────────────              │
│  Deals        247     from HubSpot                          │
│  Contacts     892     from HubSpot                          │
│  Accounts     156     from HubSpot                          │
│  Conversations 87     from Gong (66) + Fireflies (21)       │
│                                                             │
│  Sync History                                               │
│  ─────────────────────────────────────────────              │
│  Feb 15, 10:00 AM   HubSpot   incremental   247 records    │
│                     4.2s      ✅ success                    │
│  Feb 15, 09:58 AM   Gong      incremental   3 records      │
│                     1.8s      ✅ success                    │
│  Feb 14, 10:00 PM   Fireflies incremental   0 records      │
│                     0.4s      ✅ success                    │
│  Feb 14, 10:00 AM   HubSpot   incremental   245 records    │
│                     3.9s      ✅ success                    │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

### Connector Status Cards

Each connector gets a card showing:
- **Status indicator:** 🟢 green (synced < 24h), 🟡 yellow (synced 24-72h), 🔴 red (synced > 72h or error)
- **Connector name** (HubSpot, Salesforce, Gong, Fireflies)
- **Status text:** "Connected", "Stale", "Error: Token expired", "Disconnected"
- **Last sync:** relative time ("4 hours ago", "3 days ago")
- **Sync Now button:** triggers `POST /connectors/:type/sync`. Shows spinner while running. Disabled if already syncing.

Clicking a connector card expands to show:
- Record counts by entity type
- Last error message (if any) in a red alert box
- Connected since date
- Connection metadata (org name for Salesforce, workspace name for HubSpot, etc.)

### Record Inventory Table

Simple table showing total records per entity type across all connectors:

| Entity | Count | Source |
|--------|-------|--------|
| Deals | 247 | HubSpot |
| Contacts | 892 | HubSpot |
| Accounts | 156 | HubSpot |
| Conversations | 87 | Gong (66) + Fireflies (21) |

### Sync History Log

Chronological list of recent syncs (last 20):
- Timestamp (formatted)
- Connector type
- Sync type (initial / incremental)
- Records synced count
- Duration
- Status (✅ success / ❌ failed)
- If failed: expandable error message

### Data Freshness Alert

If ANY connector is stale (> 24 hours since last sync), show a yellow banner at the top:

```
⚠ Fireflies data is 3 days old. Insights based on conversation data may be outdated.
[Sync Now]
```

If ANY connector has an error, show a red banner:

```
🔴 Salesforce connection error: Token expired. Reconnect in Settings → Connectors.
```

### Empty State

If no connectors are configured:
```
No data sources connected. 
Connect your CRM and conversation intelligence tools to start getting insights.
[Go to Connectors →]
```

Link goes to the existing `/connectors` page.

---

## Task 3: Settings Page — `/settings` (3-4 hours)

### Purpose

Central place to configure workspace behavior. For now, three sections: Voice & Tone, Skill Scheduling, and Token Budget. More sections will be added later.

### Data Sources

```
GET  /api/workspaces/:id/config          — full workspace config
PATCH /api/workspaces/:id/config/:section — update a specific section
GET  /api/workspaces/:id/token-usage     — token consumption data (if exists)
GET  /api/workspaces/:id/skills          — skill list with schedules
```

If the token-usage endpoint doesn't exist, check for token tracking in the database:
```sql
-- Token usage is tracked per skill run
SELECT skill_name, SUM(tokens_used) as total_tokens, COUNT(*) as run_count
FROM skill_runs 
WHERE workspace_id = $1 
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY skill_name;
```

Create a simple endpoint if needed:
```
GET /api/workspaces/:id/token-usage?period=30d
Returns: { total_tokens, budget, usage_by_skill[], usage_by_day[] }
```

### Page Layout

Settings page uses a vertical tab layout on the left, content area on the right:

```
┌──────────────────┬──────────────────────────────────────────┐
│                  │                                          │
│  Voice & Tone    │  Voice & Tone                            │
│  ────────────    │                                          │
│  Skills          │  How Pandora communicates findings and    │
│  Token Budget    │  analysis results.                       │
│                  │                                          │
│                  │  Detail Level                            │
│                  │  ○ Executive — 1-2 sentences, lead with  │
│                  │    the implication                        │
│                  │  ● Manager — balanced detail with enough  │
│                  │    context to act (default)               │
│                  │  ○ Analyst — include data points and      │
│                  │    methodology notes                      │
│                  │                                          │
│                  │  Framing                                  │
│                  │  ● Direct — state findings plainly        │
│                  │  ○ Diplomatic — frame as opportunities    │
│                  │  ○ Consultative — present as expert       │
│                  │    recommendations                        │
│                  │                                          │
│                  │  Alert Threshold                          │
│                  │  ○ All findings — surface everything      │
│                  │  ● Watch and above — skip info-level      │
│                  │    (default)                              │
│                  │  ○ Act only — only surface critical items │
│                  │                                          │
│                  │  [Preview]                    [Save]      │
│                  │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### Section 1: Voice & Tone

Three radio button groups, one per axis.

**Detail Level:**
- Executive — "1-2 sentences. Lead with the implication."
- Manager — "Balanced detail with enough context to act." *(default)*
- Analyst — "Include supporting data points and methodology notes."

**Framing:**
- Direct — "State findings plainly. No hedging." *(default)*
- Diplomatic — "Frame observations as opportunities. Acknowledge what works."
- Consultative — "Present as expert recommendations with reasoning."

**Alert Threshold:**
- All findings — "Surface everything including informational items."
- Watch and above — "Skip info-level findings. Show watch, act, and notable." *(default)*
- Act only — "Only surface items requiring immediate action."

**Preview button:** When clicked, shows a sample finding rendered with the current voice settings. Use a hardcoded example finding and call a lightweight endpoint (or format client-side):

```
Preview (Manager + Direct + Watch and above):
"3 deals totaling $420K have been in Proposal for 30+ days with no activity. 
 Sara Bollman owns 2 of these. Consider reviewing pipeline hygiene with the team."

Preview (Executive + Direct + Act only):  
"$420K stalled in Proposal stage, 30+ days inactive. 3 deals, 2 owned by Sara Bollman."

Preview (Analyst + Consultative + All):
"Pipeline velocity analysis shows 3 deals ($420K total) have exceeded the 14-day 
 threshold in Proposal stage, averaging 34 days without recorded activity. This 
 represents 9% of open pipeline value. Based on historical patterns, deals stalled 
 at this stage for 30+ days have a 23% lower close rate. Consider scheduling a 
 pipeline review with Sara Bollman, who owns 2 of the 3 affected deals, to determine 
 if these should be re-staged or removed."
```

The preview can be generated client-side from hardcoded templates — it doesn't need to call Claude. It just demonstrates the style difference.

**Save button:** Calls `PATCH /api/workspaces/:id/config/voice` (or the appropriate section endpoint) with the selected values. Show a brief success toast: "Voice settings saved."

### Section 2: Skill Scheduling

Show each skill with its current schedule and a way to adjust it:

```
Skill Scheduling
─────────────────────────────────────────────

Pipeline Hygiene
  Schedule: [Mondays 8 AM ▾]    [Enabled ✓]
  Last run: 2 hours ago · ✅ success

Single-Thread Alert  
  Schedule: [Daily 8 AM ▾]      [Enabled ✓]
  Last run: 2 hours ago · ✅ success

Data Quality Audit
  Schedule: [Fridays 4 PM ▾]    [Enabled ✓]
  Last run: 5 days ago · ✅ success

Pipeline Coverage by Rep
  Schedule: [Mondays 8 AM ▾]    [Enabled ✓]
  Last run: 2 hours ago · ✅ success
```

**Schedule dropdown options:**
- Daily 8 AM
- Weekdays 8 AM
- Mondays 8 AM
- Mondays and Thursdays 8 AM
- Fridays 4 PM
- Custom (show cron input if selected — advanced users only)

**Enable/Disable toggle:** When disabled, the cron scheduler skips this skill. The skill can still be run manually from the Skills page.

**Save:** Each skill's schedule change saves individually via `PATCH` to the skills configuration. Show inline "Saved ✓" confirmation.

Don't build a full cron editor — the dropdown with preset options covers 90% of use cases.

### Section 3: Token Budget

Show current month's AI token consumption:

```
Token Budget
─────────────────────────────────────────────

February 2026                    [This Month ▾]

Total Used        12,847 tokens
Monthly Budget    100,000 tokens
Remaining         87,153 tokens

Usage: ████████░░░░░░░░░░░░  12.8%

By Skill:
  Pipeline Hygiene           4,200 tokens (28 runs)
  Single-Thread Alert        3,100 tokens (28 runs)  
  Data Quality Audit           890 tokens (4 runs)
  Pipeline Coverage          1,200 tokens (28 runs)
  Ask Pandora (analysis)     3,457 tokens (12 queries)
```

**Data source:** Query skill_runs for the current month, sum `tokens_used` grouped by skill_name. If `tokens_used` isn't tracked on skill_runs, check the `llm_usage` or `token_tracking` table.

**Budget bar:** Simple progress bar. Green if < 50%, yellow if 50-80%, red if > 80%.

**Period selector:** Dropdown to switch between months. Each selection re-queries the data.

If token tracking data doesn't exist in the database, show:
```
Token usage tracking is not yet configured for this workspace.
Usage data will appear here after your next skill run.
```

Don't show zeros — that implies tracking is working but nothing was used.

---

## Build Order

1. **Task 1** — Voice & Tone (backend wiring + anti-hype rules). This improves every output going forward.
2. **Task 2** — Connector Health page (read-only, uses existing data)
3. **Task 3** — Settings page (UI for voice controls + skill scheduling + token budget)

Task 1 is backend-heavy. Tasks 2-3 are frontend-heavy. If two people are working, 1 can run in parallel with 2.

## Verification Checklist

**Voice & Tone:**
- [ ] Voice config stored in workspace config and retrievable via API
- [ ] Running a skill with `detail_level: 'executive'` produces shorter output than `detail_level: 'analyst'`
- [ ] Running a skill with `framing: 'direct'` vs `framing: 'consultative'` produces noticeably different tone
- [ ] No finding messages contain "CRITICAL", "URGENT", "ALARM", exclamation marks, or dramatic language
- [ ] Ask Pandora responses also respect voice settings

**Connector Health:**
- [ ] Page loads with connector status cards showing correct green/yellow/red indicators
- [ ] Record counts match actual data in the database
- [ ] Sync history shows recent sync log entries
- [ ] Stale connector shows yellow warning banner
- [ ] "Sync Now" button triggers a sync and refreshes the display

**Settings:**
- [ ] Voice & Tone radio buttons save to workspace config
- [ ] Preview shows different output styles for different settings
- [ ] Skill scheduling shows all skills with current schedules
- [ ] Token budget shows current month usage (or graceful empty state)
- [ ] All saves show confirmation feedback

## What NOT to Do

- Don't build OAuth connector setup flows (deferred)
- Don't build the full workspace config editor (pipelines, win rate, thresholds) — that's a Prompt 1 concern
- Don't add user management or permissions
- Don't rebuild the existing Connectors page at `/connectors` — Connector Health is a separate, deeper page
- Don't modify any existing skill logic beyond adding voice config reads and anti-hype prompt rules
- Don't add WebSocket real-time updates for sync status — polling on page load is fine

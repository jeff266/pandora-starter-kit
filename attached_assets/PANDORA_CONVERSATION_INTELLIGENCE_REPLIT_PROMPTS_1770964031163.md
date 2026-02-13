# Pandora — Conversation Intelligence Replit Prompts
## Phase 1: Internal Meeting Filter + Phase 2: CWD Compute & Extraction Trigger

---

## PROMPT 1: Internal Meeting Filter + Schema Changes (Replit)

```
Pull latest from GitHub. Read these files first:

- server/linker/entity-linker.ts — the cross-entity linker that connects
  conversations to deals/accounts/contacts
- server/routes/ — find the linker status endpoint
- The conversations table schema (check migrations)
- PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md in the project knowledge if accessible,
  otherwise the instructions below are complete

You're building the internal meeting filter that prevents internal calls
(standups, 1:1s, team meetings) from being linked to deals. Without this,
internal meetings get false-positive deal links because participant emails
match contacts in the CRM.

1. DATABASE MIGRATION

Create the next migration (check migrations/ for the current number):

ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS internal_classification_reason TEXT;
  -- Values: 'all_participants_internal', 'all_internal_with_title_match'

-- Index for efficiently filtering internals out of analysis queries
CREATE INDEX IF NOT EXISTS idx_conversations_internal 
  ON conversations(workspace_id, is_internal) 
  WHERE is_internal = FALSE;

-- Index for the CWD query (Phase 2 will use this)
CREATE INDEX IF NOT EXISTS idx_conversations_cwd
  ON conversations(workspace_id, started_at DESC)
  WHERE is_internal = FALSE AND account_id IS NOT NULL AND deal_id IS NULL;

2. BUILD WORKSPACE DOMAIN RESOLUTION

Create server/linker/internal-filter.ts

Export:

async function resolveWorkspaceDomains(workspaceId: string): Promise<string[]>

Three strategies in priority order:

a. Check workspace config for explicit domains:
   Look in context_layer.definitions for an 'internal_domains' key.
   If it exists and has values, return them.

b. Infer from connector credentials:
   Check connector_configs for HubSpot or Salesforce connections.
   If found, look at the authenticated user's email domain.
   Exclude generic providers: gmail.com, yahoo.com, hotmail.com, 
   outlook.com, icloud.com, aol.com, protonmail.com

c. Most common email domain across synced contacts:
   SELECT domain, COUNT(*) as cnt FROM (
     SELECT split_part(email, '@', 2) as domain 
     FROM contacts 
     WHERE workspace_id = $1 AND email IS NOT NULL
   ) sub
   WHERE domain NOT IN ('gmail.com','yahoo.com','hotmail.com',
     'outlook.com','icloud.com','aol.com','protonmail.com')
   GROUP BY domain
   ORDER BY cnt DESC
   LIMIT 1

   This is the fallback — if the workspace owner uses gmail, the
   company domain should still be the most common across contacts.

If all strategies fail, return empty array and log a warning.
Internal filtering will be skipped for this workspace.

3. BUILD INTERNAL MEETING CLASSIFIER

In the same file, export:

async function classifyInternalMeeting(
  conversation: { 
    id: string; 
    title: string; 
    participants: any; // JSONB array
  },
  internalDomains: string[]
): Promise<{ 
  isInternal: boolean; 
  reason: string | null 
}>

Dual-layer logic:

LAYER 1 — Participant Domain Check (high confidence, definitive):

  a. Extract all participant emails from the participants JSONB.
     Handle both formats:
     - Gong: [{name, email, speakerId}]
     - Fireflies: [{name, email}]
     - Skip entries with no email (phone-in, unnamed speakers)
  
  b. For each email, check if domain matches ANY internal domain
     (case-insensitive comparison)
  
  c. Count: participantsWithEmail, internalCount, externalCount
  
  d. Decision:
     - If participantsWithEmail === 0: return { isInternal: false, reason: null }
       (can't determine, assume external)
     - If externalCount > 0: return { isInternal: false, reason: null }
       (any external participant = external call)
     - If internalCount > 0 AND externalCount === 0: internal

LAYER 2 — Title Heuristic (supplementary, only for confidence scoring):

  const INTERNAL_TITLE_PATTERNS = [
    /\b(standup|stand-up|sync|alignment|retro|retrospective|sprint|scrum)\b/i,
    /\b(1[:\-]1|one[\-\s]on[\-\s]one|1 on 1)\b/i,
    /\b(team meeting|staff meeting|all[\-\s]hands|town[\-\s]hall)\b/i,
    /\b(weekly|bi-weekly|biweekly|monthly|daily)\b/i,
    /\b(planning|backlog|grooming|refinement)\b/i,
    /\b(fellowship|mentorship|training|onboarding|offsite)\b/i,
    /\b(pipeline review|forecast review|deal review|QBR)\b/i,
    /\b(rev\s?ops|sales ops|marketing ops)\b/i,
  ];

  Title match ALONE is never sufficient (too many false positives — 
  "Weekly Demo with Acme" contains "weekly" but is external).
  
  Use title match only to set the classification reason:
  - all-internal + title match → reason: 'all_internal_with_title_match'
  - all-internal + no title match → reason: 'all_participants_internal'
  - NOT internal regardless of title → reason: null

4. WIRE INTO THE CROSS-ENTITY LINKER

Find the linkConversations() function in server/linker/entity-linker.ts.

Add internal classification as the FIRST step, before any tier of linking:

  async function linkConversations(workspaceId: string): Promise<LinkResult> {
    // Step 0: Resolve internal domains (once per run)
    const internalDomains = await resolveWorkspaceDomains(workspaceId);
    
    // Step 0.5: Classify unclassified conversations
    // Only classify conversations that haven't been classified yet
    const unclassified = await db.query(`
      SELECT id, title, participants 
      FROM conversations 
      WHERE workspace_id = $1 
        AND is_internal IS NULL OR (is_internal = FALSE AND internal_classification_reason IS NULL)
    `, [workspaceId]);
    
    let internalCount = 0;
    for (const conv of unclassified.rows) {
      const result = await classifyInternalMeeting(conv, internalDomains);
      if (result.isInternal) {
        await db.query(`
          UPDATE conversations SET 
            is_internal = true,
            internal_classification_reason = $2,
            deal_id = NULL,      -- clear any existing false-positive deal link
            link_method = 'internal_meeting'
          WHERE id = $1
        `, [conv.id, result.reason]);
        internalCount++;
      } else {
        // Mark as classified even if external, so we don't re-check
        await db.query(`
          UPDATE conversations SET 
            is_internal = false,
            internal_classification_reason = 'classified_external'
          WHERE id = $1 AND is_internal IS DISTINCT FROM false
        `, [conv.id]);
      }
    }
    
    // ... existing Tier 1, 2, 3 linking ...
    // IMPORTANT: Add WHERE is_internal = FALSE to ALL tier queries
    // so internal conversations are never considered for deal linking
    
    // Return internalCount in the result
  }

Update the Tier 1, 2, and 3 queries to exclude internals:

  In Tier 1 (email match) query, add:
    AND is_internal = FALSE
    
  In Tier 3 (deal inference) query, add:
    AND is_internal = FALSE

5. UPDATE LINKER STATUS ENDPOINT

Find the GET /api/workspaces/:id/linker/status endpoint.

Add internal_meetings count to the response:

  COUNT(*) FILTER (WHERE is_internal = TRUE) as internal_meetings

Also add internal_classification breakdown:

  COUNT(*) FILTER (WHERE internal_classification_reason = 'all_participants_internal') as internal_by_participants,
  COUNT(*) FILTER (WHERE internal_classification_reason = 'all_internal_with_title_match') as internal_by_participants_and_title

6. ADD INTERNAL DOMAIN CONFIGURATION ENDPOINT

Add to existing workspace config routes:

GET /api/workspaces/:id/config/internal-domains
  Returns current internal domains (from context_layer or inferred)
  Response: { 
    domains: string[], 
    source: 'config' | 'connector' | 'inferred' | 'none',
    conversation_stats: {
      total: number,
      classified_internal: number,
      classified_external: number,
      unclassified: number
    }
  }

PUT /api/workspaces/:id/config/internal-domains
  Body: { domains: ['fronterahealth.com', 'frontera.health'] }
  Stores in context_layer.definitions under 'internal_domains'
  After saving, re-classify all conversations for this workspace
  (set is_internal = NULL to trigger re-classification on next linker run)

7. TEST WITH FRONTERA

After building, run the linker for Frontera workspace.

Frontera's domain should resolve to 'fronterahealth.com' (or similar —
check the actual contact emails in the database).

Expected results:
- "Frontera Fellowship" → is_internal = true (all participants are @fronterahealth.com)
- "RevOps Weekly Alignment" → is_internal = true
- "Precious Care ABA - Clinical Demo" → is_internal = false (external participants)
- All Sara Bollman + external prospect calls → is_internal = false

Run the linker status endpoint and verify:
- internal_meetings count > 0
- linked_to_deal count should NOT include internal meetings
- Any previously false-positive deal links on internal meetings should be cleared

Log all results.
```

---

## PROMPT 2: CWD Compute + Deal Insights Extraction Trigger (Replit)

```
Pull latest from GitHub. Read these files first:

- server/linker/internal-filter.ts — just built in Prompt 1
- server/linker/entity-linker.ts — the cross-entity linker
- server/context/index.ts — getDataFreshness() and context layer functions
- The conversations table schema (should now have is_internal column)
- The deal_insights table (check if migration exists from Claude Code session —
  if not, create it as described below)

You're building two things:
A. CWD (Conversations Without Deals) compute function with account enrichment
B. Deal insights extraction trigger that runs after Gong/Fireflies sync

PART A: CWD COMPUTE
====================

1. CREATE server/linker/conversations-without-deals.ts

Export the main function:

interface ConversationWithoutDeal {
  conversation_id: string;
  conversation_title: string;
  call_date: string;
  duration_seconds: number;
  rep_name: string;
  rep_email: string;
  
  // Account enrichment
  account_id: string;
  account_name: string;
  account_domain: string | null;
  account_industry: string | null;
  account_employee_count: number | null;
  
  // Account context
  open_deals_at_account: number;
  closed_deals_at_account: number;
  total_contacts_at_account: number;
  last_deal_closed_date: string | null;
  
  // Conversation context
  participant_count: number;
  external_participants: string[];
  call_type_inference: string | null;
  
  // Classification
  days_since_call: number;
  likely_cause: 'deal_not_created' | 'early_stage' | 'disqualified_not_logged' | 'unknown';
  severity: 'high' | 'medium' | 'low';
}

interface CWDResult {
  summary: {
    total_cwd: number;
    by_rep: Record<string, number>;
    by_severity: { high: number; medium: number; low: number };
    estimated_pipeline_gap: string;
  };
  conversations: ConversationWithoutDeal[];
}

async function findConversationsWithoutDeals(
  workspaceId: string
): Promise<CWDResult>

Core query:

SELECT 
  c.id as conversation_id,
  c.title as conversation_title,
  c.started_at as call_date,
  c.duration_seconds,
  c.participants,
  c.account_id,
  a.name as account_name,
  a.domain as account_domain,
  a.industry as account_industry,
  a.employee_count as account_employee_count,
  
  (SELECT COUNT(*) FROM deals d 
   WHERE d.account_id = c.account_id 
   AND d.workspace_id = c.workspace_id
   AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  ) as open_deals_at_account,
  
  (SELECT COUNT(*) FROM deals d 
   WHERE d.account_id = c.account_id 
   AND d.workspace_id = c.workspace_id
   AND d.stage_normalized IN ('closed_won', 'closed_lost')
  ) as closed_deals_at_account,
  
  (SELECT COUNT(*) FROM contacts ct 
   WHERE ct.account_id = c.account_id 
   AND ct.workspace_id = c.workspace_id
  ) as total_contacts_at_account,
  
  (SELECT MAX(d.close_date) FROM deals d 
   WHERE d.account_id = c.account_id 
   AND d.workspace_id = c.workspace_id
   AND d.stage_normalized = 'closed_won'
  ) as last_deal_closed_date

FROM conversations c
JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
WHERE c.workspace_id = $1
  AND c.is_internal = FALSE
  AND c.account_id IS NOT NULL
  AND c.deal_id IS NULL
  AND c.started_at > NOW() - INTERVAL '90 days'
ORDER BY c.started_at DESC;

2. POST-QUERY ENRICHMENT

For each row returned, compute in application code:

a. Extract rep info from participants:
   - Load internal domains via resolveWorkspaceDomains()
   - Find participant whose email domain matches internal domain → that's the rep
   - rep_name, rep_email from that participant
   - external_participants = all other participants with names

b. Call type inference from title:
   const CALL_TYPE_PATTERNS = {
     'intro_demo': /\b(intro|demo|discovery|initial|first)\b/i,
     'follow_up': /\b(follow.?up|check.?in|touch.?base|recap)\b/i,
     'review': /\b(review|assessment|evaluation|audit)\b/i,
     'negotiation': /\b(negotiat|contract|proposal|pricing)\b/i,
   };
   Test title against patterns. If no match, null.

c. Days since call:
   Math.floor((Date.now() - new Date(call_date).getTime()) / 86400000)

d. Severity classification:

   function classifyCWDSeverity(cwd): 'high' | 'medium' | 'low' {
     // HIGH: Demo/intro call, >7 days old, no deals at account
     if (cwd.call_type_inference === 'intro_demo' && 
         cwd.days_since_call > 7 && 
         cwd.open_deals_at_account === 0) return 'high';
     
     // HIGH: Any call >14 days old with no deals at account
     if (cwd.days_since_call > 14 && cwd.open_deals_at_account === 0) return 'high';
     
     // HIGH: Long call (>30 min) with no deals at account
     if (cwd.duration_seconds > 1800 && cwd.open_deals_at_account === 0) return 'high';
     
     // MEDIUM: Recent call (<7 days) — rep may not have logged yet
     if (cwd.days_since_call < 7) return 'medium';
     
     // MEDIUM: Account has other open deals (may be related)
     if (cwd.open_deals_at_account > 0) return 'medium';
     
     // MEDIUM: Short call (<15 min) — may have been a screening call
     if (cwd.duration_seconds < 900) return 'medium';
     
     // LOW: everything else
     return 'low';
   }

e. Likely cause inference:

   function inferLikelyCause(cwd): string {
     // Call was a demo/intro and no deals at account → probably forgot to create
     if (cwd.call_type_inference === 'intro_demo' && 
         cwd.open_deals_at_account === 0) return 'deal_not_created';
     
     // Very recent call — might just be early
     if (cwd.days_since_call < 3) return 'early_stage';
     
     // Short call at account with closed-lost history → likely disqualified
     if (cwd.duration_seconds < 600 && cwd.closed_deals_at_account > 0) 
       return 'disqualified_not_logged';
     
     // Account has other open deals — linker may have missed the connection
     if (cwd.open_deals_at_account > 0) return 'deal_not_created';
     
     return 'unknown';
   }

f. Build summary:
   - Group by rep email, count per rep
   - Group by severity, count per severity
   - estimated_pipeline_gap = 
     `${highCount + mediumCount} conversations suggest untracked pipeline worth investigating`

3. ADD API ENDPOINT

In server/routes/ (find the appropriate route file):

GET /api/workspaces/:id/conversations/without-deals
  Calls findConversationsWithoutDeals(workspaceId)
  Returns the full CWDResult
  
  Optional query params:
  - severity: 'high' | 'medium' | 'low' (filter)
  - rep: email (filter to specific rep)
  - limit: number (default 50)

PART B: DEAL INSIGHTS EXTRACTION TRIGGER
=========================================

4. VERIFY deal_insights TABLE EXISTS

Check if the Claude Code session already created the migration.
If deal_insights table does NOT exist, create the migration:

CREATE TABLE IF NOT EXISTS deal_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  insight_key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_quote TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by UUID REFERENCES deal_insights(id),
  is_current BOOLEAN NOT NULL DEFAULT true,
  exported_to_crm BOOLEAN NOT NULL DEFAULT false,
  exported_at TIMESTAMPTZ,
  crm_field_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_insights_current 
  ON deal_insights(deal_id, insight_type) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_deal_insights_workspace 
  ON deal_insights(workspace_id, insight_type, is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_deal_insights_history 
  ON deal_insights(deal_id, insight_key, extracted_at);
CREATE INDEX IF NOT EXISTS idx_deal_insights_conversation 
  ON deal_insights(source_conversation_id);

5. BUILD EXTRACTION SERVICE

Create server/insights/extract-deal-insights.ts

This service processes conversations that have been linked to deals
but haven't had insights extracted yet.

Export:

interface InsightCandidate {
  insight_type: string;
  value: string;
  confidence: number;
  source_quote: string;
}

interface ExtractionResult {
  processed: number;
  insightsCreated: number;
  insightsSuperseded: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

async function extractDealInsights(workspaceId: string): Promise<ExtractionResult>

Flow:

a. Load workspace insight config from context_layer:
   Look for 'insight_config' in context_layer.definitions.
   If not found, use default 8 universal insight types:
   ['champion', 'decision_maker', 'pain_point', 'timeline', 
    'budget', 'competition', 'next_steps', 'decision_criteria']
   
   Load min_confidence (default 0.6)

b. Find unprocessed conversations linked to deals:
   SELECT c.id, c.title, c.started_at, c.duration_seconds,
          c.transcript_text, c.summary, c.participants,
          c.deal_id, d.name as deal_name, d.stage, d.amount,
          a.name as account_name
   FROM conversations c
   JOIN deals d ON d.id = c.deal_id
   LEFT JOIN accounts a ON a.id = d.account_id
   WHERE c.workspace_id = $1
     AND c.is_internal = FALSE
     AND c.deal_id IS NOT NULL
     AND c.duration_seconds > 120        -- skip very short calls
     AND c.id NOT IN (
       SELECT DISTINCT source_conversation_id 
       FROM deal_insights 
       WHERE workspace_id = $1 
         AND source_conversation_id IS NOT NULL
     )
   ORDER BY c.started_at DESC
   LIMIT 20

c. For each conversation, call DeepSeek to extract insights:

   Use Fireworks API (DeepSeek) — same pattern as other skill DeepSeek calls.
   
   Build prompt:
   
   ```
   You are extracting qualification insights from a sales call transcript.

   Deal: ${deal_name} (${stage}, $${amount})
   Account: ${account_name}
   Call date: ${started_at}
   Participants: ${formatted_participants}

   Active insight types to extract:
   ${activeInsights.map(i => `- ${i.insight_type}: ${i.description}`).join('\n')}

   ${transcript_text ? `Transcript:\n${transcript_text.substring(0, 8000)}` 
     : summary ? `Call Summary:\n${summary}` 
     : 'No transcript available.'}

   For each insight type, extract the relevant information if discussed.
   Only extract insights you have clear evidence for — do not guess.

   Respond with ONLY valid JSON:
   {
     "insights": [
       {
         "insight_type": "champion",
         "value": "Sarah Chen (VP Eng) — actively advocating internally",
         "confidence": 0.85,
         "source_quote": "Sarah mentioned she already briefed the CTO"
       }
     ],
     "no_signal": ["budget", "competition"]
   }
   ```

   If neither transcript_text nor summary exists, skip this conversation.

d. Parse response and apply versioning:

   For each extracted insight with confidence >= min_confidence:
   
   1. Check if deal already has a current insight for this type:
      SELECT id, value FROM deal_insights 
      WHERE deal_id = $1 AND insight_type = $2 AND is_current = true
   
   2. If existing insight found:
      - If values are meaningfully different (simple string comparison,
        or Levenshtein distance > 20% of length):
        - UPDATE old: is_current = false, superseded_by = new_id
        - INSERT new: is_current = true
        - Count as superseded
      - If values are essentially the same: skip, don't create duplicate
   
   3. If no existing insight:
      - INSERT with is_current = true
      - Count as created

e. Return ExtractionResult with counts

6. WIRE EXTRACTION TO POST-SYNC TRIGGER

Find the sync orchestrator (same place where the linker is triggered
after sync). After the linker runs, add extraction:

  // After linker completes
  if (['gong', 'fireflies'].includes(connectorType)) {
    // Run insight extraction after linker has resolved deal links
    extractDealInsights(workspaceId)
      .then(result => {
        console.log(`[Insights] ${workspaceId}: ${result.insightsCreated} created, ${result.insightsSuperseded} superseded, ${result.skipped} skipped (${result.durationMs}ms)`);
      })
      .catch(err => {
        console.error(`[Insights] ${workspaceId} failed:`, err.message);
      });
  }

  Order matters: sync → linker → extraction
  The linker connects conversations to deals.
  Extraction needs those deal links to know which deal each insight belongs to.

7. ADD MANUAL TRIGGER + STATUS ENDPOINTS

POST /api/workspaces/:id/insights/extract
  Triggers extractDealInsights(workspaceId)
  Returns ExtractionResult
  Useful for testing and re-running after config changes

GET /api/workspaces/:id/insights/status
  Returns:
  {
    total_insights: number,
    current_insights: number,      // is_current = true
    superseded_insights: number,
    by_type: Record<string, number>,
    conversations_processed: number,
    conversations_pending: number,  // linked to deals but no insights yet
    last_extraction_at: string | null,
    config: {
      framework: string,
      active_types: string[],
      min_confidence: number
    }
  }

GET /api/workspaces/:id/deals/:dealId/insights
  Returns current insights for a specific deal:
  SELECT insight_type, insight_key, value, confidence, 
         source_quote, extracted_at, source_conversation_id
  FROM deal_insights
  WHERE deal_id = $1 AND is_current = true
  ORDER BY insight_type

GET /api/workspaces/:id/deals/:dealId/insights/history
  Returns full history for a deal (all versions):
  SELECT di.*, c.title as source_call_title
  FROM deal_insights di
  LEFT JOIN conversations c ON c.id = di.source_conversation_id
  WHERE di.deal_id = $1
  ORDER BY di.insight_type, di.extracted_at ASC

PART C: VALIDATION
==================

8. TEST WITH FRONTERA

Run in sequence:

a. Run the linker (should classify internals first):
   POST /api/workspaces/:id/linker/run
   
   Check linker status:
   GET /api/workspaces/:id/linker/status
   Verify: internal_meetings count > 0
   
b. Check CWD:
   GET /api/workspaces/:id/conversations/without-deals
   
   Expected:
   - Precious Care ABA: severity HIGH, cause deal_not_created
   - Helping Hands Behavior Therapy: severity HIGH, cause deal_not_created
   - Guidepost ABA: severity HIGH, cause deal_not_created
   - Frontera Fellowship should NOT appear (is_internal = true)
   - RevOps Weekly Alignment should NOT appear (is_internal = true)
   - Be You Behavior Therapy should NOT appear (linked to deal)

c. Run insight extraction:
   POST /api/workspaces/:id/insights/extract
   
   Check how many insights were created from Gong calls
   that are linked to deals.

d. Check insights for a specific deal:
   Pick a deal that has Gong calls linked to it.
   GET /api/workspaces/:id/deals/:dealId/insights
   Verify insights were extracted with reasonable confidence.

e. Check extraction status:
   GET /api/workspaces/:id/insights/status
   Verify conversations_pending decreases after extraction.

f. Run extraction again — verify idempotency:
   POST /api/workspaces/:id/insights/extract
   Should return insightsCreated: 0 (all already processed)

Log all results with PASS/FAIL for each test.

WHAT NOT TO BUILD:
- No CRM export endpoints (Phase 6, deferred)
- No insight config auto-detect (Claude Code already built framework detection)
- No UI for insight viewing (API only for now)
- No scheduled extraction cron (event-driven via post-sync trigger is sufficient)
```

---

## PROMPT 3: Integration Test + Skill Validation (Replit)

```
Pull latest from GitHub.

You just built the internal meeting filter, CWD compute, and extraction
pipeline (Prompts 1-2). Now validate that everything works end-to-end
with Frontera production data AND that the affected skills produce
correct output.

1. CREATE scripts/test-conversation-intelligence.ts

This script validates the full conversation intelligence pipeline.

Test Group 1: Internal Meeting Filter

  a. GET /api/workspaces/:id/linker/status
     ASSERT: internal_meetings > 0
     LOG: total conversations, internal count, external count

  b. Query conversations directly:
     SELECT title, is_internal, internal_classification_reason
     FROM conversations WHERE workspace_id = $1 AND is_internal = true
     
     ASSERT: Results include "Fellowship" or "Alignment" in title
     ASSERT: All have reason = 'all_participants_internal' or 'all_internal_with_title_match'

  c. Query for false positives:
     SELECT title, is_internal FROM conversations
     WHERE workspace_id = $1 AND title ILIKE '%Precious Care%'
     ASSERT: is_internal = false

  d. Verify no internal meetings linked to deals:
     SELECT COUNT(*) FROM conversations 
     WHERE workspace_id = $1 AND is_internal = true AND deal_id IS NOT NULL
     ASSERT: count = 0

Test Group 2: CWD Compute

  a. GET /api/workspaces/:id/conversations/without-deals
     ASSERT: total_cwd > 0
     ASSERT: by_severity.high > 0
     LOG: full summary

  b. Check specific conversations:
     ASSERT: results include account_name matching 'Precious Care'
     ASSERT: results include account_name matching 'Helping Hands' OR 'Guidepost'
     ASSERT: each has severity = 'high'
     ASSERT: each has likely_cause = 'deal_not_created'

  c. Check account enrichment:
     For each CWD result:
     ASSERT: account_name is not null
     ASSERT: open_deals_at_account is a number
     ASSERT: total_contacts_at_account is a number
     LOG: account context for top 3

  d. Verify filtering:
     ASSERT: no results have is_internal = true
     ASSERT: no results have deal_id IS NOT NULL

Test Group 3: Deal Insights Extraction

  a. POST /api/workspaces/:id/insights/extract
     LOG: ExtractionResult
     ASSERT: processed > 0 OR conversations_pending = 0

  b. GET /api/workspaces/:id/insights/status
     LOG: full status
     If total_insights > 0:
       ASSERT: by_type has at least 2 different insight types
       ASSERT: current_insights <= total_insights

  c. Pick a deal with Gong calls:
     SELECT d.id, d.name FROM deals d
     JOIN conversations c ON c.deal_id = d.id
     WHERE d.workspace_id = $1 AND c.is_internal = FALSE
     LIMIT 1
     
     GET /api/workspaces/:id/deals/:dealId/insights
     LOG: insights found
     If insights exist:
       ASSERT: each has insight_type, value, confidence
       ASSERT: confidence between 0 and 1
       ASSERT: source_conversation_id is not null

  d. Idempotency:
     POST /api/workspaces/:id/insights/extract (second time)
     ASSERT: insightsCreated = 0
     ASSERT: processed = 0 (no unprocessed conversations)

Test Group 4: Skill Execution with Conversation Data

  a. Trigger data-quality-audit for Frontera workspace
     LOG: full output
     Check if output mentions "Conversation Coverage Gaps" section
     (It should if Claude Code wired the CWD step 2.5 correctly)
     NOTE: If the skill doesn't include CWD yet, log as SKIPPED not FAIL —
     Claude Code may need to pick up the integration after this Replit work

  b. Trigger pipeline-coverage-by-rep for Frontera workspace
     LOG: full output
     Check if any rep has conversations_without_deals_count > 0
     NOTE: Same caveat — if not wired yet, log as SKIPPED

  c. Trigger pipeline-hygiene for Frontera workspace
     LOG: full output
     Check if qualification_completeness appears as a risk signal
     NOTE: Same caveat

2. RUN THE SCRIPT

npx tsx scripts/test-conversation-intelligence.ts

Expected: Test Groups 1-3 should all PASS.
Test Group 4 may show SKIPPED if Claude Code integration hasn't been
re-synced after Replit changes — that's fine, those can be validated
in the next Claude Code session.

3. LOG AND REPORT

Print summary:
- Internal filter: X internal meetings classified
- CWD: X conversations without deals (Y high, Z medium)
- Insights: X insights extracted from Y conversations
- Skills: PASS/FAIL/SKIPPED for each

If any unexpected failures in Groups 1-3, debug and fix before completing.
```

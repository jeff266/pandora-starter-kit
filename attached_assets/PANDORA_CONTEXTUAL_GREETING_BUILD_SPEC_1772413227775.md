# Pandora — Contextual Opening Brief Spec
## The Assistant That Already Knows What Matters Today

**Status:** Spec — ready for sequenced build  
**Depends on:** T001–T009 (quota fix + user awareness), workspace_config cadence, skill_runs table, findings table, pandora-role.ts  
**Files to create:** `server/context/opening-brief.ts` (new), prompt template additions  
**Files to modify:** `server/routes/conversation-stream.ts`, `server/context/workspace-memory.ts`

---

## Positioning

Today when a user opens Pandora, the assistant waits for a question. That's a search engine, not an operating system. The opening brief transforms the first message from "Hi, how can I help?" into a situation-aware briefing that makes the user think "this thing already knows what I need."

The brief isn't a canned message. It's assembled from live data and synthesized by Claude into natural language. Two users logging in at the same moment see different briefs because they have different roles, different targets, and different pipelines. The same user logging in Monday morning vs Friday afternoon sees a different brief because the temporal context has shifted.

The goal: the brief is so precisely relevant that the user's next message is a follow-up question about what the assistant just said, not a topic change.

---

## Architecture

```
Login / New Conversation
        │
        ▼
┌──────────────────────────┐
│  resolveUserContext()     │  ← pandora-role.ts (T006)
│  pandora_role + userId    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  computeTemporalContext() │  ← workspace_config.cadence
│  day, week, quarter pos   │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  assembleOpeningBrief()   │  ← targets, deals, skill_runs, findings
│  role-scoped data pull    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Claude synthesis         │  ← ~1,500 token prompt → ~300 word brief
│  conversational narrative │
└──────────────────────────┘
```

The entire pipeline targets **< 2 seconds** from conversation start to rendered brief. The data queries are all SQL against local tables (Layer 1 in the Command Center model — zero LLM cost for data assembly). The only LLM call is the final synthesis.

---

## Part 1: Temporal Context Engine

Create the temporal awareness layer in `server/context/opening-brief.ts`.

### computeTemporalContext(workspaceId)

Reads `workspace_config.cadence` and computes positional context relative to the current moment.

```typescript
interface TemporalContext {
  // Calendar position
  dayOfWeek: string;              // 'Monday'
  dayOfWeekNumber: number;        // 1 (Mon) through 7 (Sun)
  isWeekStart: boolean;           // true if matches cadence.week_start_day
  isWeekEnd: boolean;             // Friday
  isWeekend: boolean;
  
  // Month position
  weekOfMonth: number;            // 1-5
  dayOfMonth: number;
  isMonthStart: boolean;          // first 3 business days
  isMonthEnd: boolean;            // last 5 business days
  isEndOfMonth: boolean;          // last 3 calendar days
  
  // Fiscal quarter position
  fiscalQuarter: string;          // 'Q1', 'Q2', etc.
  fiscalYear: string;             // 'FY2027'
  weekOfQuarter: number;          // 1-13
  quarterPhase: 'early' | 'mid' | 'late' | 'final_week';
  // early = weeks 1-4, mid = weeks 5-9, late = weeks 10-12, final_week = week 13
  daysRemainingInQuarter: number;
  daysElapsedInQuarter: number;
  pctQuarterComplete: number;     // 0.0-1.0
  
  // Fiscal year position
  monthOfFiscalYear: number;      // 1-12
  quarterOfFiscalYear: number;    // 1-4
  pctYearComplete: number;
  
  // Planning cadence alignment
  isPlanningDay: boolean;         // true if today aligns with cadence.planning_cadence
  // e.g., if planning_cadence = 'weekly' and week_start_day = 1 (Monday), 
  // then Monday is the planning day
  
  // Time of day (affects greeting tone, not data)
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  
  // Derived urgency signals
  urgencyLabel: string;
  // Examples:
  // "Week 2 of Q3 — early quarter, pipeline generation mode"
  // "Week 11 of Q1 — late quarter, 14 days to close"
  // "Last week of the quarter — commit or slip decisions due"
  // "First Monday of Q2 — fresh quarter, planning window"
  // "Month-end Friday — pacing check"
}
```

**Implementation notes:**

The fiscal quarter calculation already exists in `workspace-config-loader.ts` → `getQuotaPeriod()`. Reuse it. The week-of-quarter math uses the `fiscal_year_start_month` from cadence config:

```typescript
// Quarter boundaries from getQuotaPeriod()
const period = await configLoader.getQuotaPeriod(workspaceId);
const msPerDay = 86400000;
const daysIntoQuarter = Math.floor((now.getTime() - period.start.getTime()) / msPerDay);
const weekOfQuarter = Math.floor(daysIntoQuarter / 7) + 1;
const totalWeeksInQuarter = Math.ceil(
  (period.end.getTime() - period.start.getTime()) / msPerDay / 7
);

let quarterPhase: string;
if (weekOfQuarter <= 4) quarterPhase = 'early';
else if (weekOfQuarter <= 9) quarterPhase = 'mid';
else if (weekOfQuarter <= totalWeeksInQuarter - 1) quarterPhase = 'late';
else quarterPhase = 'final_week';
```

The `urgencyLabel` is computed from the combination of quarter phase + day of week + month position. This is injected verbatim into the Claude prompt so the model understands the temporal stakes without computing them.

---

## Part 2: Role-Scoped Data Assembly

### assembleOpeningBrief(workspaceId, userId)

This function gathers the data specific to the user's role and the current temporal context. Every query is scoped by the visibility rules from `pandora-role.ts`.

```typescript
interface OpeningBriefData {
  temporal: TemporalContext;
  user: {
    name: string;
    email: string;
    pandoraRole: string;          // 'cro', 'manager', 'ae', 'revops', 'admin'
    workspaceRole: string;        // 'admin', 'member', 'viewer'
  };
  workspace: {
    name: string;
    pipelineType: string;         // from workspace_config.pipelines[0].type
    salesMotion: string;          // derived: 'high_velocity' | 'mid_market' | 'enterprise'
    connectedSources: string[];   // ['hubspot', 'fireflies', 'gong']
  };
  targets: {
    headline: {                   // from getHeadlineTarget()
      amount: number;
      label: string;
      type: string;
    } | null;
    pctAttained: number | null;   // closed-won this period / target
    gap: number | null;           // target - closed-won
  };
  pipeline: {
    totalValue: number;
    dealCount: number;
    weightedValue: number;
    coverageRatio: number | null; // pipeline / remaining target
    closingThisWeek: {            // deals with close_date in next 7 days
      count: number;
      value: number;
      dealNames: string[];        // top 3 by amount
    };
    closingThisMonth: {
      count: number;
      value: number;
    };
    newThisWeek: {                // deals created in last 7 days
      count: number;
      value: number;
    };
  };
  findings: {
    critical: number;             // count of unresolved critical findings
    warning: number;
    topFindings: {                // 3 most recent critical/warning findings
      severity: string;
      message: string;
      skillName: string;
      dealName?: string;
      age: string;                // "2 days ago", "this morning"
    }[];
    lastSkillRunAt: string | null; // when did skills last run?
  };
  movement: {                     // what changed since last login/conversation
    dealsAdvanced: number;        // deals that moved to a later stage
    dealsSlipped: number;         // deals with close_date pushed out
    dealsClosed: number;          // won + lost
    closedWonValue: number;
    closedLostValue: number;
    newFindings: number;          // findings created since last conversation
  };
  conversations: {               // if conversation intelligence is connected
    recentCallCount: number;      // calls in last 7 days
    unlinkedCalls: number;        // calls not linked to a deal
    hasConversationData: boolean;
  } | null;
}
```

### Data Scoping by Role

Each query in the assembly applies the role filter from pandora-role.ts:

| Data Point | CRO / RevOps / Admin | Manager | AE |
|---|---|---|---|
| **Target headline** | Company target | Team target | Individual quota |
| **Pipeline totals** | All deals | Team deals (via group members) | Own deals only |
| **Coverage ratio** | All pipeline / company target | Team pipeline / team target | Own pipeline / individual quota |
| **Closing this week** | All deals closing this week | Team deals | Own deals |
| **Findings** | All findings | Findings on team's deals | Findings on own deals |
| **Movement** | All deal movement | Team movement | Own deal movement |
| **Conversation data** | All calls | Team calls | Own calls (where user is participant) |

The deal scoping uses the same mechanism as T009a: for AEs, `AND owner_email = <user_email>`; for Managers, look up team membership from `workspace_config.teams.groups` where the manager is identified, and filter to those member emails. Full-visibility roles get no deal filter.

### SQL Queries (all Layer 1 — instant)

```sql
-- Pipeline snapshot (scoped by role)
SELECT 
  COUNT(*) as deal_count,
  COALESCE(SUM(amount), 0) as total_value,
  COALESCE(SUM(amount * COALESCE(probability, 0) / 100.0), 0) as weighted_value
FROM deals
WHERE workspace_id = $1
  AND is_open = true
  AND is_deleted = false
  ${dealScopeFilter}  -- from role

-- Closing this week
SELECT name, amount, close_date, owner_email
FROM deals
WHERE workspace_id = $1
  AND is_open = true
  AND is_deleted = false
  AND close_date >= CURRENT_DATE
  AND close_date <= CURRENT_DATE + INTERVAL '7 days'
  ${dealScopeFilter}
ORDER BY amount DESC
LIMIT 5

-- Closed this period (for attainment)
SELECT 
  COALESCE(SUM(amount), 0) as closed_won_value,
  COUNT(*) as closed_won_count
FROM deals
WHERE workspace_id = $1
  AND stage_normalized = 'closed_won'
  AND closed_at >= $2  -- period start
  AND closed_at <= $3  -- period end
  ${dealScopeFilter}

-- Recent findings (scoped)
SELECT f.severity, f.message, f.skill_id, f.created_at,
       d.name as deal_name
FROM findings f
LEFT JOIN deals d ON f.deal_id = d.id
WHERE f.workspace_id = $1
  AND f.resolved_at IS NULL
  AND f.severity IN ('critical', 'warning')
  ${findingsDealScopeFilter}
ORDER BY 
  CASE f.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 END,
  f.created_at DESC
LIMIT 3

-- Movement since last conversation
SELECT 
  COUNT(*) FILTER (WHERE dsh.to_stage > dsh.from_stage) as advanced,
  COUNT(*) FILTER (WHERE stage_normalized = 'closed_won' 
    AND closed_at >= $2) as closed_won,
  COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost' 
    AND closed_at >= $2) as closed_lost,
  COALESCE(SUM(amount) FILTER (WHERE stage_normalized = 'closed_won' 
    AND closed_at >= $2), 0) as closed_won_value
FROM deals
LEFT JOIN deal_stage_history dsh ON dsh.deal_id = deals.id 
  AND dsh.changed_at >= $2
WHERE deals.workspace_id = $1
  ${dealScopeFilter}

-- New deals this week
SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as value
FROM deals
WHERE workspace_id = $1
  AND created_at >= CURRENT_DATE - INTERVAL '7 days'
  AND is_deleted = false
  ${dealScopeFilter}

-- Finding counts
SELECT 
  COUNT(*) FILTER (WHERE severity = 'critical') as critical,
  COUNT(*) FILTER (WHERE severity = 'warning') as warning
FROM findings
WHERE workspace_id = $1
  AND resolved_at IS NULL
  ${findingsDealScopeFilter}
```

### "Since last conversation" anchor

The `movement` section needs a reference point — when did this user last interact with Pandora? Two options:

**Option A (simple):** Use a fixed lookback. If it's Monday morning, show changes since Friday. If it's any other day, show changes since yesterday. If it's the user's first interaction, show this week.

**Option B (precise):** Track `last_conversation_at` per user in workspace_members. Update it when a conversation-stream session starts. Use that timestamp as the movement anchor.

**Recommendation:** Start with Option A. It's good enough and avoids a schema change. The temporal context already encodes "Monday = show weekend changes" logic. Upgrade to Option B later when conversation tracking is more mature.

```typescript
function getMovementAnchor(temporal: TemporalContext): Date {
  const now = new Date();
  if (temporal.isWeekStart) {
    // Monday: show everything since last Friday at 5 PM
    const friday = new Date(now);
    friday.setDate(friday.getDate() - (temporal.dayOfWeekNumber - 5 + 7) % 7);
    // Simplified: 3 days ago for Monday
    return new Date(now.getTime() - 3 * 86400000);
  }
  // Any other day: since yesterday morning
  return new Date(now.getTime() - 24 * 86400000);
}
```

---

## Part 3: Sales Motion Awareness

The brief's tone and focus areas shift based on the workspace's sales motion. This is derived from workspace_config and deal characteristics:

```typescript
interface SalesMotionProfile {
  motion: 'high_velocity' | 'mid_market' | 'enterprise';
  avgDealSize: number;
  avgCycleLength: number;        // days
  dealVolume: 'high' | 'medium' | 'low';
  
  // What this motion cares about most
  primaryMetrics: string[];
  // high_velocity: ['conversion_rate', 'volume', 'velocity', 'activity']
  // mid_market: ['coverage_ratio', 'deal_progression', 'forecast_accuracy']
  // enterprise: ['deal_advancement', 'multi_threading', 'executive_engagement', 'strategic_risk']
}
```

**Derivation logic:**

```typescript
function deriveSalesMotion(config: WorkspaceConfig, dealStats: DealStats): SalesMotionProfile {
  const pipelineType = config.pipelines[0]?.type || 'new_business';
  
  // Use deal statistics to classify
  if (dealStats.avgDealSize < 10000 && dealStats.avgCycleLength < 30) {
    return {
      motion: 'high_velocity',
      primaryMetrics: ['conversion_rate', 'volume', 'velocity', 'activity_cadence'],
      ...dealStats
    };
  }
  
  if (dealStats.avgDealSize > 100000 || dealStats.avgCycleLength > 90) {
    return {
      motion: 'enterprise',
      primaryMetrics: ['deal_advancement', 'multi_threading', 'executive_engagement', 'strategic_risk'],
      ...dealStats
    };
  }
  
  return {
    motion: 'mid_market',
    primaryMetrics: ['coverage_ratio', 'deal_progression', 'forecast_accuracy', 'pipeline_generation'],
    ...dealStats
  };
}
```

The `dealStats` (average deal size, cycle length, deal volume) can be computed once during workspace config inference and cached, or computed on the fly from a simple aggregate query. Since this doesn't change frequently, cache it in workspace_config._meta.

---

## Part 4: Claude Synthesis Prompt

The assembled data is injected into a prompt that Claude synthesizes into a natural opening brief. This is NOT a template with blanks filled in — it's structured context that Claude weaves into a conversational narrative.

### System Prompt Addition

Add to the conversation-stream system prompt (or as a prefixed user message before the user's first turn):

```
You are Pandora, a RevOps intelligence assistant. The user just opened a new conversation. 
Before they ask anything, provide a brief, opinionated opening that tells them what matters 
right now. This is not a dashboard readout — it's a colleague who's been watching the 
numbers and has something to say.

RULES:
1. Lead with the single most important thing — the item that would make this person say 
   "I didn't know that" or "that's exactly what I was going to check"
2. Never list more than 3 items. Depth beats breadth.
3. Be specific: name deals, name reps, cite dollar amounts. Vague summaries are useless.
4. End with an implicit invitation to dig deeper — not "how can I help?" but a natural 
   continuation: "Want me to pull up the details on that Acme deal?" or "I can run a 
   fresh forecast if you want to see how that changes the number."
5. Adapt tone to time of day and day of week:
   - Monday morning: crisp, forward-looking, "here's what the week looks like"
   - Friday afternoon: reflective, "here's how the week went"
   - Mid-week: focused on what's in motion
6. If it's late in the quarter, lead with the gap or the probability of hitting target. 
   If it's early in the quarter, lead with pipeline generation and coverage.
7. Never say "Good morning" followed by a wall of bullets. Write in prose. 
   Two to four short paragraphs, conversational. Like a Slack message from a sharp 
   RevOps analyst, not a BI report.
8. If there are critical findings, lead with them — they're the reason you're speaking up.
9. If nothing is urgent, say so. "Pipeline looks healthy, coverage is at 3.2x, 
   no critical findings this week. Quiet is good." is a valid brief.
10. Match the sales motion:
    - High velocity: talk about volume, conversion rates, activity cadence
    - Mid-market: talk about coverage, deal progression, forecast
    - Enterprise: talk about specific deal advancement, multi-threading, strategic risks

DO NOT:
- List every metric you have access to
- Use headers or bullet points
- Say "based on my analysis" or "according to the data"
- Repeat the user's role or name back to them
- Explain what Pandora is or what you can do
- Use emoji
```

### Context Block Template

Injected as the first user message (before the actual user speaks):

```
[OPENING BRIEF CONTEXT — synthesize this into a natural greeting, then respond to the user's first message normally]

TODAY: {{temporal.dayOfWeek}}, {{temporal.dayOfMonth}} {{month}} {{year}}
POSITION: {{temporal.urgencyLabel}}
QUARTER: {{temporal.fiscalQuarter}} {{temporal.fiscalYear}} — Week {{temporal.weekOfQuarter}} of 13, {{temporal.pctQuarterComplete}}% complete, {{temporal.daysRemainingInQuarter}} days remaining

USER: {{user.name}} ({{user.pandoraRole}})
SALES MOTION: {{workspace.salesMotion}} (avg deal ${{dealStats.avgDealSize}}, {{dealStats.avgCycleLength}}-day cycle)

{{#if targets.headline}}
TARGET: {{targets.headline.label}}: ${{targets.headline.amount}}
ATTAINMENT: ${{targets.closedWonValue}} closed ({{targets.pctAttained}}%) — ${{targets.gap}} gap remaining
COVERAGE: {{pipeline.coverageRatio}}x (pipeline ${{pipeline.totalValue}} / remaining ${{targets.gap}})
{{else}}
TARGET: Not configured
{{/if}}

PIPELINE NOW:
- {{pipeline.dealCount}} open deals worth ${{pipeline.totalValue}} (${{pipeline.weightedValue}} weighted)
{{#if pipeline.closingThisWeek.count}}
- CLOSING THIS WEEK: {{pipeline.closingThisWeek.count}} deals worth ${{pipeline.closingThisWeek.value}} — {{pipeline.closingThisWeek.dealNames}}
{{/if}}
{{#if pipeline.closingThisMonth.count}}
- Closing this month: {{pipeline.closingThisMonth.count}} deals, ${{pipeline.closingThisMonth.value}}
{{/if}}
{{#if pipeline.newThisWeek.count}}
- New this week: {{pipeline.newThisWeek.count}} deals, ${{pipeline.newThisWeek.value}}
{{/if}}

{{#if findings.topFindings.length}}
ATTENTION:
{{#each findings.topFindings}}
- [{{severity}}] {{message}} {{#if dealName}}({{dealName}}){{/if}} — {{age}}
{{/each}}
({{findings.critical}} critical, {{findings.warning}} warning total unresolved)
{{else}}
No critical or warning findings. Pipeline is clean.
{{/if}}

{{#if movement}}
SINCE {{movementAnchorLabel}}:
{{#if movement.dealsAdvanced}}- {{movement.dealsAdvanced}} deals advanced stage{{/if}}
{{#if movement.closedWonValue}}- Closed won: ${{movement.closedWonValue}} ({{movement.dealsClosed}} deals){{/if}}
{{#if movement.closedLostValue}}- Closed lost: ${{movement.closedLostValue}}{{/if}}
{{#if movement.dealsSlipped}}- {{movement.dealsSlipped}} deals pushed close date{{/if}}
{{#if movement.newFindings}}- {{movement.newFindings}} new findings{{/if}}
{{/if}}

{{#if conversations}}
CALLS: {{conversations.recentCallCount}} calls this week{{#if conversations.unlinkedCalls}}, {{conversations.unlinkedCalls}} not linked to a deal{{/if}}
{{/if}}

[END BRIEF CONTEXT]
```

### Role-Specific Emphasis Instructions

Append to the context block based on pandora_role:

**CRO:**
```
ROLE EMPHASIS: You're briefing a CRO. They care about: will we hit the number? 
Which teams are ahead/behind? What's the biggest risk to the forecast? 
What deal could change the quarter? Frame everything in terms of the company target.
If Monte Carlo data is available, mention the probability.
```

**Manager:**
```
ROLE EMPHASIS: You're briefing a team manager. They care about: how is my team performing? 
Which reps need coaching? Which deals on my team need my attention? 
Frame everything in terms of the team target. Call out individual reps by name 
when they need help or recognition.
```

**AE:**
```
ROLE EMPHASIS: You're briefing an AE about their own book of business. 
They care about: am I on track? What should I work on today? 
Which deals need my attention right now? Be direct and tactical — 
they need to know what to do in the next 4 hours, not next quarter.
```

**RevOps / Admin:**
```
ROLE EMPHASIS: You're briefing a RevOps operator. They care about: data quality, 
system health, connector status, skill run outputs, and operational improvements. 
If there are data quality findings, lead with those. If connectors are unhealthy, 
flag it. They're the one who fixes the plumbing.
```

---

## Part 5: Integration into conversation-stream

### Where it hooks in

In `server/routes/conversation-stream.ts`, the conversation-stream already builds a system prompt with workspace context via `buildWorkspaceContextBlock()`. The opening brief extends this in two ways:

1. **On first message of a new conversation:** Before the user's message is processed, assemble the brief context and prepend it as a synthetic first turn. This gives Claude the data it needs to open with a briefing.

2. **The brief IS the first assistant response:** The user opens Pandora, the UI sends an implicit "start" event (or the user sends their first message), and the assistant's first response is the synthesized brief followed by the answer to any question the user asked.

### Implementation

```typescript
// In conversation-stream.ts, when processing a new conversation:

async function handleNewConversation(req, res, workspaceId, userId) {
  // Check if this is the first message in a new conversation
  const isNewConversation = !req.body.conversation_id || req.body.is_new;
  
  if (isNewConversation && userId) {
    // Assemble the brief (target < 500ms for data, < 1.5s for synthesis)
    const briefData = await assembleOpeningBrief(workspaceId, userId);
    const briefContext = renderBriefContext(briefData);
    
    // Prepend to the messages array as a context injection
    const messages = [
      { 
        role: 'user', 
        content: briefContext + '\n\n' + (req.body.message || 'Start of conversation') 
      }
    ];
    
    // If the user sent an actual message, Claude will address both:
    // 1. Deliver the brief
    // 2. Answer the question
    // If no message (just opened the app), Claude delivers just the brief
    
    // Continue with normal conversation-stream processing...
  }
}
```

### Caching Strategy

The brief data changes slowly — pipeline totals, findings, and movement are only updated when skills run (Monday morning cron) or deals sync (every 15-60 minutes). Cache the assembled brief data per user with a 5-minute TTL:

```typescript
const briefCache = new Map<string, { data: OpeningBriefData; expiresAt: number }>();

async function getOrAssembleBrief(workspaceId: string, userId: string): Promise<OpeningBriefData> {
  const key = `${workspaceId}:${userId}`;
  const cached = briefCache.get(key);
  
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  
  const data = await assembleOpeningBrief(workspaceId, userId);
  briefCache.set(key, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
  return data;
}
```

---

## Part 6: Example Outputs

### Example 1: CRO, Monday morning, mid-quarter

> Happy Monday. You're in Week 7 of Q3 with 42 days left — right in the middle of the push. Pipeline sits at $4.2M against a $1.7M annual target, and you've closed $820K so far this year, so the gap is $880K. Coverage is healthy at 4.8x remaining, but it's masking a concentration problem — 38% of your weighted pipeline is one deal, the Meridian Health renewal at $1.6M.
>
> Two things to watch this week: Pipeline hygiene flagged 4 deals totaling $340K that have been in Negotiation for 21+ days with no activity. And the Acme Corp evaluation ($280K) has only one contact engaged — single-threaded at that deal size is a real risk.
>
> Want me to run a fresh forecast rollup, or pull up the details on those stale deals?

### Example 2: AE, Wednesday afternoon, late quarter

> Heads up — you've got 18 days left in the quarter and $85K against your $200K target. That's 42% attainment with three weeks to go. Your pipeline has $340K across 6 deals, so the math works, but two of those close dates are already past due.
>
> The Brightstone deal ($95K) is your fastest path to quota — it's been in Proposal for 8 days and the last call showed strong buying signals. The one risk flagged on it is single-threading: you've only got Sarah Chen engaged. Worth getting her boss into the next conversation.
>
> Your DataVault renewal ($60K) has a close date of last Friday that needs updating. Want me to show you what's closing this month?

### Example 3: RevOps Admin, Friday afternoon, early quarter

> Quiet week, which is what you want in Week 2. Pipeline is at $3.8M with 47 open deals, coverage is 3.4x against the Q1 target. No critical findings — the Monday hygiene run came back clean for the first time in four weeks.
>
> One operational item: Fireflies synced 12 calls this week but 3 aren't linked to any deal. The participant emails don't match any contacts in HubSpot — might be new prospects that haven't been entered yet. Also, the data quality audit found 8 deals missing close dates, all in Discovery stage.
>
> I can pull up those unlinked calls if you want to sort them out before the weekend.

### Example 4: Manager, Monday morning, final week of quarter

> This is it — last 5 days of Q2. Your team target is $850K and you're at $620K closed, so you need $230K this week. Three deals are in Commit with close dates this week: the Pinnacle renewal ($95K, Nate), the LogiSync expansion ($80K, Sara), and the TerraForm new biz ($75K, Carter). If all three close, you're at $870K — just over target.
>
> The risk is Carter's TerraForm deal. Pipeline hygiene flagged it as stale — no activity in 16 days and the procurement contact hasn't responded to the last two emails. Might be worth having Carter escalate or having you join the next touchpoint.
>
> Nate's Pinnacle deal looks solid — the Fireflies call from Thursday showed the champion actively selling internally. Want me to pull up Carter's deal dossier?

---

## Part 7: Graceful Degradation

The brief must work across varying data completeness:

| Data Available | Brief Adjusts |
|---|---|
| Full stack (CRM + CI + skills + targets) | Full brief as designed |
| No targets configured | Skip attainment/gap/coverage; focus on pipeline state and findings |
| No findings (skills haven't run yet) | Skip findings section; note "skills haven't run yet" naturally |
| No conversation intelligence | Skip calls section; don't mention it |
| No deals synced yet | "Your workspace is connected but data is still syncing. I'll have a full briefing ready once deals are loaded." |
| No user role set | Default to admin view (full visibility, operational focus) |
| Single deal workspace (very early) | Don't try to be clever with metrics; focus on that one deal |

The assembly function returns null/empty for missing sections and the Claude prompt handles omissions naturally — it simply doesn't mention what it doesn't have.

---

## Part 8: Token Budget

| Component | Tokens | Cost |
|---|---|---|
| Brief context block (data) | ~800-1,200 input | — |
| System prompt + role emphasis | ~400 input | — |
| Claude synthesis output | ~200-400 output | — |
| **Total per brief** | **~1,600 input + ~300 output** | **~$0.01** |

At $0.01 per conversation start, even 100 users × 5 conversations/day = $5/day. Well within budget.

The SQL queries total ~6 statements, each hitting indexed columns. Target: < 200ms total for data assembly, < 1.5s for Claude synthesis, < 2s end-to-end.

---

## Build Sequence

### Phase 1: Core Engine (Claude Code)
1. Create `server/context/opening-brief.ts` with `computeTemporalContext()` and `assembleOpeningBrief()`
2. Implement all SQL queries with role-scoped deal filters
3. Implement `renderBriefContext()` template function
4. Unit test with Frontera workspace data

### Phase 2: Integration (Replit)
5. Wire into `conversation-stream.ts` — detect new conversations, prepend brief context
6. Add synthesis prompt to system prompt builder
7. Add brief caching layer
8. Handle the "no message" case (user just opened app)

### Phase 3: Polish (Either)
9. Add `deriveSalesMotion()` and inject motion-specific emphasis
10. Add "since last conversation" tracking (Option A: fixed lookback)
11. Test across all four client workspaces
12. Tune prompt based on output quality — the examples above are the target

---

## What NOT to Build

- No UI widget or dashboard card for the brief — it's the assistant's natural opening, rendered in the chat stream
- No user preference to disable the brief — if they don't want it, they just type their question and the assistant pivots immediately
- No separate API endpoint for the brief — it's internal to conversation-stream
- No brief history/storage — it's ephemeral, regenerated each conversation
- No brief for Slack bot interactions — Slack gets skill outputs via cron; the brief is for the chat interface only
- No A/B testing infrastructure — tune the prompt manually based on Jeff's feedback from real conversations

---

## Commit Messages

```
feat: add temporal context engine with fiscal quarter awareness
feat: add role-scoped opening brief data assembly
feat: add Claude synthesis prompt for contextual greeting
feat: wire opening brief into conversation-stream for new conversations
feat: add sales motion derivation for brief emphasis
```

---

## Success Criteria

The brief is working when:
1. Jeff opens Pandora on Monday morning and the assistant leads with the most important thing about his pipeline — not "how can I help you?"
2. The brief mentions specific deal names, dollar amounts, and finding details — not generic summaries
3. An AE opening Pandora sees only their own numbers, and the assistant's first suggestion is relevant to what they should do today
4. The same user opening Pandora on Monday vs Friday gets a meaningfully different brief
5. Late-quarter briefs feel urgent. Early-quarter briefs feel strategic. The tone matches the stakes.
6. Jeff's response to the brief is a follow-up question, not a topic change

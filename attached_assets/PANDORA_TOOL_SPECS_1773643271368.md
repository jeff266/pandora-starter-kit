# Pandora Ask Pandora — Tool Specs
## 11 Missing Tools

All tools follow the three-layer filter architecture:
- Layer 1: Security filters — injected by executor from session, never from Claude
- Layer 2: Recency filters — defaults with capped overrides
- Layer 3: Scope filters — passed by Claude, validated server-side

workspace_id is always $1 and always sourced from session context.

---

## Tool 1 — queryPriorDeals

**Purpose:** Find prior closed deals for the same account.
Used by deliberation engine, Ask Pandora deal analysis, crumb trail detection.

**When Claude calls it:**
- "This is a second attempt" context detection
- Bull/Bear case evidence gathering
- "Have we worked with this account before?"

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 2 (defaults)
monthsBack: 24  // cap at 36

// Layer 3 (Claude-controlled, validated)
accountName: string       // required, fuzzy match, max 200 chars
excludeDealId?: string    // exclude current deal from results
monthsBack?: number       // 1–36, default 24
includeClosedWon?: boolean // default true
includeClosedLost?: boolean // default true
```

**Returns:**
```typescript
{
  deals: {
    id: string
    name: string
    amount: number
    outcome: 'closed_won' | 'closed_lost'
    closeDate: string
    daysSinceClose: number
    ownerName: string
    lossReason: string | null
    products: string[]     // expanded from deal name abbreviations
  }[]
  accountName: string
  totalPriorAttempts: number
  lastOutcome: 'closed_won' | 'closed_lost' | null
}
```

**SQL pattern:**
```sql
WHERE workspace_id = $1              -- Layer 1: always from session
  AND name ILIKE $2                  -- Layer 3: account fuzzy match
  AND stage_normalized IN (
    'closed_won', 'closed_lost'
  )
  AND close_date > NOW() - ($3 || ' months')::INTERVAL
  AND id != $4                       -- exclude current deal if provided
ORDER BY close_date DESC
LIMIT 10
```

---

## Tool 2 — queryRepPerformance

**Purpose:** Historical close rate and performance metrics for a specific rep.
Used by deliberation Defense evidence, Rep Scorecard context, sprint assembler.

**When Claude calls it:**
- Bull Case: "Nate closes 29% of deals at this size"
- "How is Nate performing this quarter?"
- Sprint action specificity: which rep is below target?

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId
// Rep role restriction: reps can only query their own email
repEmailRestriction: session.userRole === 'rep' ? session.userEmail : null

// Layer 2 (defaults)
closedAfterMonths: 12   // rolling 12 months for close rate
activityDays: 90        // pipeline creation pace window

// Layer 3 (Claude-controlled, validated)
ownerEmail: string      // required — validated against rep roster
minAmount?: number      // filter by deal size range (for win rate by size)
maxAmount?: number
stageFilter?: string    // win rate for deals that reached this stage
```

**Returns:**
```typescript
{
  repName: string
  ownerEmail: string
  closeRate: number           // % of deals closed won in window
  avgCycleLength: number      // days from create to close_won
  pipelineCreatedLast90d: number  // total $ created
  pipelineTarget90d: number | null
  pipelineAttainmentPct: number | null
  dealsClosedWon: number
  dealsClosedLost: number
  avgDealSize: number
  topStageByVolume: string
  windowMonths: number        // what window was used
}
```

**Rep role guard:**
If `session.userRole === 'rep'` and `ownerEmail !== session.userEmail`,
return 403 — reps cannot query other reps' performance.

---

## Tool 3 — queryForecastAccuracy

**Purpose:** Historical forecast accuracy for this workspace by method.
Used by Confidence Calibration deliberation, forecast rollup synthesis,
bearing calibration context.

**When Claude calls it:**
- "Should I trust this forecast number?"
- Confidence Calibration pattern — Calibrator agent needs this
- "Which forecasting method has been most accurate for us?"

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 2 (defaults)
minActualArr: 50000    // startup noise filter — exclude early ramp quarters
quartersBack: 8        // max history to consider

// Layer 3 (Claude-controlled, validated)
method?: ForecastMethod   // filter to one method, or null for all
quartersBack?: number     // 2–8, default 8
```

**Returns:**
```typescript
{
  methods: {
    method: string
    avgErrorPct: number | null
    quartersOfData: number
    biasDirection: 'over' | 'under' | 'neutral' | null
    biasMagnitude: number | null
    weight: 'primary' | 'secondary' | 'reference' | 'unavailable'
    caveat: string | null
  }[]
  primaryMethod: string | null
  startupNoiseDetected: boolean
  noisyQuartersExcluded: number
  overallBiasDirection: 'over' | 'under' | 'neutral' | null
  summary: string   // one-sentence accuracy summary
}
```

---

## Tool 4 — queryIcpFit

**Purpose:** How well a specific deal matches the workspace's ICP profile.
Used by deliberation Defense evidence, deal analysis, lead scoring context.

**When Claude calls it:**
- Bull Case: "This account fits our ICP"
- "Is this the kind of company we typically win?"
- Deal analysis when ICP score exists

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 3 (Claude-controlled, validated)
dealId: string    // required — validated against workspace
```

**Returns:**
```typescript
{
  dealId: string
  dealName: string
  icpScore: number | null      // 0–100 if ICP skill has run
  icpTier: 'A' | 'B' | 'C' | 'unscored'
  matchSignals: {
    signal: string
    matches: boolean
    detail: string
  }[]   // e.g. "Industry: Healthcare — matches ICP"
  dealAmountVsMedian: 'above' | 'at' | 'below' | 'unknown'
  medianDealSize: number | null
  icpLastComputedAt: string | null
  hasIcpProfile: boolean    // false if ICP skill hasn't run
}
```

**Graceful degradation:**
If ICP skill hasn't run for this workspace, return `hasIcpProfile: false`
with a `matchSignals` array derived from deal amount vs workspace median
and industry match if available. Never error — always return something.

---

## Tool 5 — queryCompetitorSignals

**Purpose:** Competitor mentions in deal conversations, notes, and CRM fields.
Used by deliberation, deal analysis, win/loss pattern detection.

**When Claude calls it:**
- "Are CentralReach or Passage Health in the mix?"
- Bear Case: "Competitor mentioned on recent call"
- "What competitive dynamics are we seeing?"

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 2 (defaults)
daysBack: 180    // look back 6 months for competitor mentions

// Layer 3 (Claude-controlled, validated)
dealId?: string           // scope to one deal
competitors?: string[]    // specific competitors to search for
                          // defaults to workspace config competitor list
daysBack?: number         // 30–365, default 180
```

**Returns:**
```typescript
{
  mentions: {
    source: 'conversation' | 'note' | 'crm_field'
    competitor: string
    mentionDate: string
    context: string     // one sentence of surrounding context
    dealId: string
    dealName: string
    sentiment: 'evaluating' | 'replacing' | 'lost_to' | 'mentioned' | 'unknown'
  }[]
  competitorsDetected: string[]
  mostRecentMention: string | null
  hasCompetitiveRisk: boolean
  workspaceCompetitors: string[]  // from workspace config
}
```

**Privacy note:**
Context snippets are capped at 150 characters. Full transcripts are
never returned by this tool — they remain in the conversation source.

---

## Tool 6 — queryDealVelocity

**Purpose:** Time in each stage vs. workspace median — is this deal
accelerating or stalling relative to typical pace?

Used by deliberation Prosecutor evidence, stage advancement detection,
sprint assembler deal ranking.

**When Claude calls it:**
- Bear Case: "343 days in stage — typical is 45"
- "Is this deal moving at a normal pace?"
- Stage advancement opportunities panel

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 3 (Claude-controlled, validated)
dealId: string    // required
```

**Returns:**
```typescript
{
  dealId: string
  dealName: string
  currentStage: string
  daysInCurrentStage: number
  medianDaysInStage: number | null    // workspace median for this stage
  velocityRating: 'fast' | 'normal' | 'slow' | 'stalled' | 'unknown'
  stageHistory: {
    stage: string
    enteredAt: string
    exitedAt: string | null
    daysInStage: number
    medianForStage: number | null
    velocityRating: 'fast' | 'normal' | 'slow' | 'stalled'
  }[]
  totalDaysInPipeline: number
  projectedCloseDate: string | null   // based on current velocity
  hasSufficientHistory: boolean       // false if < 10 closed deals for median
}
```

**Velocity thresholds:**
- fast: < 50% of median
- normal: 50–150% of median
- slow: 150–300% of median
- stalled: > 300% of median or > 90 days with no activity
- unknown: no median data available

---

## Tool 7 — searchDeals

**Purpose:** Fuzzy search across deal names and account names.
Used when user refers to a deal by partial name, nickname, or description.
The navigation tool — gets the right deal ID before other tools run.

**When Claude calls it:**
- "What's happening with that autism services deal?"
- "Show me the Butterfly deal"
- Any query referencing a deal without an explicit ID in scope

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId
repFilter: session.userRole === 'rep' ? session.userEmail : null

// Layer 2 (defaults)
includeClosedDeals: false   // only open deals by default

// Layer 3 (Claude-controlled, validated)
query: string              // required, min 2 chars, max 100 chars
includeClosedDeals?: boolean
ownerEmail?: string        // filter to one rep's deals
minAmount?: number
stageFilter?: string
limit?: number             // 1–10, default 5
```

**Returns:**
```typescript
{
  deals: {
    id: string
    name: string            // expanded — AB/RAB resolved to product names
    amount: number
    stage: string
    ownerName: string
    daysSinceActivity: number | null
    closeDate: string | null
    matchScore: number      // 0–1 fuzzy match confidence
  }[]
  totalMatches: number
  query: string
}
```

**Disambiguation:**
If multiple deals match with similar scores (within 0.1 of each other),
Claude should present the options and ask the user to confirm before
proceeding with deal-specific analysis.

---

## Tool 8 — queryCalendarContext

**Purpose:** Calendar events linked to a deal's contacts.
Exposes the calendar integration that's built but currently dark
from Ask Pandora's perspective.

**When Claude calls it:**
- "Do we have anything scheduled with ABS Kids this week?"
- "When is the next touchpoint?"
- Deliberation verdict: "meeting scheduled" as Defense evidence

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 2 (defaults)
pastDays: 30      // show recent meetings for context
futureDays: 60    // show upcoming meetings

// Layer 3 (Claude-controlled, validated)
dealId?: string           // match via deal_contacts → contact email → attendees
contactEmails?: string[]  // explicit contact list if deal not scoped
pastDays?: number         // 0–90, default 30
futureDays?: number       // 0–90, default 60
```

**Returns:**
```typescript
{
  events: {
    id: string
    title: string
    startTime: string
    durationMinutes: number
    attendees: {
      email: string
      name: string | null
      isContact: boolean    // true if in deal_contacts for this deal
    }[]
    isUpcoming: boolean
    isPast: boolean
    source: 'google_calendar'
  }[]
  nextMeeting: {
    title: string
    startTime: string
    daysUntil: number
  } | null
  lastMeeting: {
    title: string
    startTime: string
    daysAgo: number
  } | null
  hasUpcomingMeeting: boolean
  contactsWithNoMeetings: string[]   // contacts linked to deal with no calendar events
}
```

**Graceful degradation:**
If Google Calendar credentials aren't configured for this workspace,
return `{ events: [], hasUpcomingMeeting: false, calendarNotConnected: true }`.
Never error — Ask Pandora should note the gap, not crash.

---

## Tool 9 — getWorkspaceContext

**Purpose:** The workspace vocabulary — products, competitors, stage names,
rep roster, quota targets, methodology. The single source of truth
for workspace-specific knowledge.

This is the tool that prevents AB/RAB hallucinations. Claude calls it
when it encounters abbreviations, internal terminology, or workspace-
specific references it cannot resolve from deal data alone.

**When Claude calls it:**
- Any query where workspace-specific terminology appears
- Deal analysis where product names may be abbreviated
- "What products does Frontera sell?"
- "Who are our reps?"
- Automatically at the start of any workspace-level query

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// No Layer 3 filters — this tool always returns full workspace context
// for the authenticated workspace. No parameters needed.
```

**Returns:**
```typescript
{
  workspace: {
    name: string
    domain: string
    industry: string | null
  }
  products: {
    name: string
    abbreviation: string | null
    description: string | null
  }[]
  competitors: string[]
  reps: {
    email: string
    name: string
    role: 'admin' | 'rep'
    isActive: boolean
    quota: number | null
  }[]
  stages: {
    normalized: string
    displayName: string
    order: number
    isTerminal: boolean
  }[]
  methodology: string | null    // 'MEDDPICC' | 'BANT' | 'SPICED' | null
  fiscalYearStart: number       // month, 1-12
  currentQuarter: string        // 'Q1 2026'
  coverageTarget: number        // e.g. 3.0
  staleThresholdDays: number    // e.g. 14
  crmConnector: 'hubspot' | 'salesforce'
  conversationConnector: 'gong' | 'fireflies' | 'fathom' | null
}
```

**Caching:**
This tool result should be cached in the Ask Pandora session context
after the first call. It doesn't change mid-conversation. Subsequent
calls within the same session return the cached value without a DB hit.

---

## Tool 10 — queryHypothesisHistory

**Purpose:** Trend data for a standing hypothesis metric over time.
Used by Confidence Calibration, Pre-Mortem Panel, Analyst Hierarchy.
The difference between "32% conversion rate" and "conversion rate
that was 38% two months ago and has been declining" is the whole story.

**When Claude calls it:**
- Confidence Calibration: "Is this metric trending toward or away from threshold?"
- "Has our pipeline coverage been improving?"
- Pre-Mortem: "Which failure mode has been getting worse?"

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId

// Layer 2 (defaults)
weeksBack: 12    // rolling 12 weeks of weekly values

// Layer 3 (Claude-controlled, validated)
metric: string       // required — must match a standing_hypotheses.metric value
weeksBack?: number   // 4–24, default 12
```

**Returns:**
```typescript
{
  metric: string
  hypothesis: string      // the hypothesis statement
  currentValue: number
  alertThreshold: number
  alertDirection: 'above' | 'below'
  isBreached: boolean
  weeklyValues: {
    weekOf: string
    value: number
    wasBreached: boolean
  }[]
  trend: 'improving' | 'declining' | 'stable' | 'volatile' | 'insufficient_data'
  trendDescription: string  // "Declining from 38% in January to 32% today"
  weeksAboveThreshold: number
  weeksBelowThreshold: number
  longestBreachStreak: number   // consecutive weeks below threshold
}
```

---

## Tool 11 — getPandoraCapabilities (the meta-tool)

**Purpose:** Tell the user what Pandora can do, what skills are available,
what data is connected, and how to get the most out of the platform.

This is navigation-as-a-tool. As the platform grows, users — especially
new design partners and reps — won't know what's available. This tool
lets Pandora answer "what can you do?" with specifics, not marketing copy.

It's also the tool that makes Pandora self-documenting. Instead of a
help center or onboarding tour, users can just ask.

**When Claude calls it:**
- "What can you do?"
- "How do I use Pandora?"
- "What skills are available?"
- "Can you help me with forecasting?"
- "What data do you have access to?"
- "I'm new here, where do I start?"
- Any query that implies the user doesn't know what's possible

**Filters:**
```typescript
// Layer 1 (injected)
workspace_id: session.workspaceId
userRole: session.userRole    // admin sees everything, rep sees rep-relevant

// Layer 3 (Claude-controlled, validated)
category?: 'skills' | 'data' | 'actions' | 'forecasting' |
           'deals' | 'deliberation' | 'navigation' | null
           // null returns everything
```

**Returns:**
```typescript
{
  skills: {
    id: string
    name: string
    category: string
    description: string     // one sentence, plain English
    lastRunAt: string | null
    isScheduled: boolean
    schedule: string | null   // "Every Monday at 8 AM"
    relevantFor: string[]     // ['pipeline review', 'forecasting', 'coaching']
  }[]
  dataConnected: {
    connector: string
    status: 'connected' | 'syncing' | 'error'
    lastSyncAt: string | null
    recordCount: number | null
  }[]
  capabilities: {
    category: string
    capability: string
    howToAccess: string     // "Ask me: 'What's the risk on [deal name]?'"
    example: string         // example query
  }[]
  quickStartSuggestions: string[]   // 3 suggested first queries based on workspace state
  activeHypotheses: number
  sprintActionsThisWeek: number
  recentInsights: {
    surface: string
    summary: string
    createdAt: string
  }[]   // last 3 notable findings from skill runs
}
```

**The capabilities array** is the core of this tool. It translates
Pandora's technical features into natural language queries the user
can try immediately. Examples:

```typescript
[
  {
    category: 'Deal Analysis',
    capability: 'Detailed analysis of any deal in your pipeline',
    howToAccess: "Click 'Ask →' on any deal card, or ask me directly",
    example: "Tell me about Action Behavior Centers"
  },
  {
    category: 'Risk Assessment',
    capability: 'Bull/Bear case deliberation on whether a deal will close',
    howToAccess: "Ask with a deal in scope",
    example: "Will this deal close by April 1?"
  },
  {
    category: 'Forecasting',
    capability: 'Triangulated forecast using 5 methods with accuracy weighting',
    howToAccess: "Navigate to GTM → Forecast, or ask directly",
    example: "Where will we land this quarter?"
  },
  {
    category: 'Sprint Planning',
    capability: 'Ranked weekly actions with expected value from Monte Carlo',
    howToAccess: "Navigate to Actions → This Week",
    example: "What should we focus on this week?"
  },
  {
    category: 'Hypothesis Monitoring',
    capability: 'Standing alerts when key metrics cross thresholds',
    howToAccess: "Navigate to Actions → Hypotheses",
    example: "Is our conversion rate still above threshold?"
  },
  {
    category: 'Pipeline Health',
    capability: 'Identify stale deals, data quality issues, stage mismatches',
    howToAccess: "Navigate to GTM, or ask directly",
    example: "What deals need attention this week?"
  },
  {
    category: 'Rep Performance',
    capability: 'Scorecard, pipeline pace, and activity analysis per rep',
    howToAccess: "Ask with a rep name",
    example: "How is Nate performing this quarter?"
  },
]
```

**quickStartSuggestions** are dynamically generated from workspace state:

```typescript
// If conversion rate hypothesis is breached:
"Our win rate is below target — ask me: 'Which deals can we still close this quarter?'"

// If it's Monday:
"It's the start of the week — ask me: 'What are my sprint priorities?'"

// If a deal has been silent for 30+ days:
"Action Behavior Centers has been silent for 22 days — ask me: 'What should Nate do this week?'"
```

**Role awareness:**
If `userRole === 'rep'`, filter capabilities to rep-relevant features.
Don't show admin-only features like workspace config, skill scheduling,
or team-wide rep scorecards. Surface deal analysis, personal sprint
actions, and individual coaching capabilities instead.

---

## Implementation Notes

### The tool executor

All 11 tools route through a shared `ToolExecutor` class:

```typescript
class ToolExecutor {
  constructor(private session: AuthenticatedSession) {}

  async execute(toolName: string, params: unknown): Promise<ToolResult> {
    // 1. Validate params against tool's JSON schema
    // 2. Inject Layer 1 security context
    // 3. Apply Layer 2 recency defaults
    // 4. Call tool function
    // 5. Log: workspaceId, tool, params (sanitized), duration, rowCount
    // 6. Return result
  }
}
```

### Registration

All 11 tools must be registered in the Ask Pandora tool map alongside
the existing 11 tools. The tool map now has 22 entries. Every tool
must have:
- A JSON schema definition with `additionalProperties: false`
- A TypeScript function with `context` as first argument
- A description Claude uses to decide when to call it

### The workspace_id rule

In every SQL query across all 11 tools:
- `workspace_id = $1` is always the first WHERE clause
- `$1` is always `context.workspaceId` sourced from the executor
- It is never sourced from Claude's parameters
- It is never interpolated — always parameterized

This is non-negotiable and must be code-reviewed before merging.

### Graceful degradation

Every tool returns an empty array or a structured empty response
on no results. No tool throws an error on missing data. The
`getPandoraCapabilities` tool especially must never error — it is
the fallback when the user is lost.

---

## Build Sequencing

### Build before Wednesday demo:
- `queryPriorDeals` — deliberation evidence gap
- `queryCalendarContext` — exposes built-but-dark calendar integration
- `getPandoraCapabilities` — navigation for Frontera during demo

### Build in next sprint:
- `queryRepPerformance` — deliberation Defense evidence quality
- `searchDeals` — partial name resolution for Ask Pandora
- `getWorkspaceContext` — permanent fix for abbreviation hallucinations
- `queryDealVelocity` — Prosecutor evidence quality

### Build when data matures:
- `queryForecastAccuracy` — needs 4+ quarters of accuracy_log data
- `queryIcpFit` — needs ICP skill to have run
- `queryCompetitorSignals` — needs Gong flowing for Frontera
- `queryHypothesisHistory` — needs 8+ weeks of weekly_values

---

*Pandora Tool Specs v1.0 — March 2026*

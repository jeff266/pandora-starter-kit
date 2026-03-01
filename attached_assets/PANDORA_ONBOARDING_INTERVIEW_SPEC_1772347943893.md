# Pandora Onboarding Interview — Full Specification

## Design Philosophy

Pandora already has the CRM data. Onboarding is not a blank form — it's a consultant doing a first-day discovery session. Pandora scans the data, researches the company, forms hypotheses, and puts the admin in a position to **edit and confirm** rather than build from scratch.

Three principles:

1. **Hypothesis-first.** Every question presents Pandora's best guess. The admin corrects, not constructs.
2. **Graceful degradation.** Every unanswered question has a default. Skills run on day one with zero configuration. Each answered question makes them more accurate.
3. **Earn trust by showing work.** Every hypothesis shows its evidence — deal counts, field values, calculated averages. The admin sees Pandora is reading their data correctly.

---

## Pre-Interview Intelligence Gathering

Before the first question appears, three things happen in parallel. The admin sees a progress indicator: "Pandora is studying your CRM..."

### Source 1: CRM Data Scan (SQL — instant)

```
Pipelines:     SELECT DISTINCT pipeline, COUNT(*), SUM(amount), AVG(amount) FROM deals GROUP BY pipeline
Deal types:    SELECT DISTINCT custom_fields->>'dealtype', COUNT(*) FROM deals GROUP BY 1
Record types:  SELECT DISTINCT custom_fields->>'record_type_name', COUNT(*) FROM deals GROUP BY 1
Stages:        SELECT stage, COUNT(*), AVG(days_in_stage) FROM deals GROUP BY stage ORDER BY MIN(stage_order)
Won/Lost:      SELECT stage, COUNT(*), SUM(amount) FROM deals WHERE stage IN (won/lost stages) GROUP BY stage
Owners:        SELECT owner_email, owner_name, COUNT(*), SUM(amount), pipeline FROM deals GROUP BY 1,2,5
Close dates:   SELECT MIN(close_date), MAX(close_date), COUNT(*) FILTER (WHERE close_date IS NULL) FROM deals
Deal sizes:    Histogram by amount bucket per pipeline
Contacts:      SELECT COUNT(DISTINCT contact_id) per deal average, multi-threading distribution
Activities:    SELECT type, COUNT(*) FROM activities GROUP BY type (if synced)
Conversations: SELECT COUNT(*), source FROM conversations GROUP BY source (if synced)
Accounts:      SELECT COUNT(*), industry distribution, employee_count distribution
Custom fields: SELECT key, COUNT(*) FROM (unnest custom_fields keys) — fill rate per field
Stages unused: Stages in stage_configs with 0 current deals
New owners:    Owner emails appearing in last 30 days not seen before
```

Output: `CRMScanResult` — structured JSON with every dimension summarized.

### Source 2: Company Research (Serper + DeepSeek — 5-10 seconds)

For each workspace, look up the company (from account domain or workspace name):

```
Serper queries:
  "[company name] sales team size"
  "[company name] pricing model SaaS"
  "[company name] G2 reviews competitors"
  "[company name] LinkedIn company page"
  "[company name] annual revenue funding"
```

DeepSeek classifies the search results into:

```json
{
  "company_size_estimate": "50-200 employees",
  "industry": "Healthcare Technology",
  "likely_gtm_motion": "enterprise + mid-market hybrid",
  "pricing_model": "annual contract, usage-based component",
  "competitors": ["Competitor A", "Competitor B"],
  "ipo_status": "Series B",
  "confidence": 0.7,
  "evidence_urls": ["..."]
}
```

This gives Pandora context the CRM doesn't have — industry norms, company size, likely sales motion. The admin doesn't know Pandora researched them; they just notice the questions are smart.

### Source 3: Document Scan (if connected — background)

If Google Drive is connected, scan for common RevOps artifacts:

```
Search queries:
  "sales playbook"
  "quota" OR "compensation plan"
  "QBR" OR "quarterly business review"
  "forecast" OR "pipeline review"
  "territory" OR "territory plan"
  "onboarding" OR "ramp plan"
  "sales process" OR "methodology"
  "org chart" OR "team structure"
```

Flag found documents for potential extraction later in the interview. Don't extract yet — wait until the relevant question to offer: "I found a document called 'Q1 Sales Playbook' in your Drive. Want me to read it?"

---

## Question Priority Tiers

### Tier 0: Critical — Brief won't make sense without these
Skills produce misleading output if these are wrong. Block brief generation until at least hypotheses are confirmed.

### Tier 1: Important — Skills degrade meaningfully without these
Skills work but produce generic or occasionally wrong output. Collect in first session.

### Tier 2: Enriching — Makes analysis deeper
Skills work fine without these, but analysis is richer with them. Collect in first week via follow-up prompts.

### Tier 3: Advanced — Unlocks specialized features
Only relevant for mature RevOps orgs. Surface when the feature is first used or when data patterns suggest relevance.

---

## The Questions

### TIER 0 — Critical (must collect in first session)

---

**Q1: Revenue Motions / Pipeline Definitions**
*Config target: `pipelines[]`, named filters, `revenue_motions`*
*Pre-research: CRM scan (distinct pipelines, deal types, record types, amount distributions)*

Hypothesis presentation:
> I see [N] pipelines in your CRM: [list with deal counts and avg amounts]. I also see [deal type / record type] fields being used.
>
> Here's how I'd segment your revenue motions:
>
> | Motion | Filter | Deals | Avg Size | Avg Cycle |
> |--------|--------|-------|----------|-----------|
> | Enterprise NB | pipeline = 'Enterprise' AND amount >= $150K | 34 | $182K | 92 days |
> | Mid-Market NB | pipeline = 'Growth' | 89 | $41K | 38 days |
> | Renewals | pipeline = 'Renewals' | 12 | $85K | 22 days |
>
> Does this match how you think about your business? What would you change?

What Pandora is really asking:
- How many distinct selling motions do you have?
- Which CRM fields distinguish them? (pipeline, deal type, record type, amount threshold, or combination)
- What's the approximate deal size and cycle length for each?

Graceful degradation if skipped:
- All deals treated as single motion
- Coverage, forecasting, and rep evaluation use blended metrics
- Brief Section 3 (Segments) auto-detects GROUP BY dimension instead of using motions

Why it can't be skipped permanently:
- Blended win rates are misleading (enterprise 22% + SMB 45% = blended 35% that represents neither)
- Coverage ratios need motion-specific targets
- Brief editorial engine can't make motion-aware phase decisions

Voice/upload assist:
- Voice: "Just talk me through your pipelines — what does each one measure?"
- Upload: Screenshot of CRM pipeline settings page → extract pipeline names and stages per pipeline
- Upload: Sales playbook → extract motion definitions

---

**Q2: Fiscal Calendar and Quarterly Targets**
*Config target: `cadence.fiscal_year_start_month`, `cadence.quota_period`, goals per motion*
*Pre-research: CRM scan (deal close date clusters, quarter boundaries), Serper (fiscal year info for public companies)*

Hypothesis presentation:
> Your deals cluster around calendar quarter boundaries, so I'm guessing January fiscal year start. Is that right?
>
> What are your targets this quarter?

If the admin gives a single number:
> Got it — $3.2M for Q1. How does that break down by motion?
> Based on your pipeline distribution, I'd estimate roughly:
> | Motion | Est. Target | Rationale |
> |--------|------------|-----------|
> | Enterprise | $1.9M | 55% of historical closed revenue |
> | Mid-Market | $900K | 35% of historical closed revenue |
> | Renewals | $400K | Based on contracts up for renewal |

Graceful degradation if skipped:
- Brief Section 1 shows absolute pipeline numbers instead of attainment
- No gap calculation, no coverage on gap
- No convergence tracking
- Brief works but is a status report, not evaluative

Voice/upload assist:
- Upload: Quota spreadsheet → extract per-rep and per-team targets
- Upload: Screenshot of forecast tool (Clari, HubSpot forecast board) → extract targets

---

**Q3: Stage Definitions — Won/Lost/Active Classification**
*Config target: `stage_configs`, `win_rate.won_values`, `win_rate.lost_values`*
*Pre-research: CRM scan (existing stage_configs if populated, stages with 0 deals, stage ordering)*

Hypothesis presentation:
> Here's what I see for your deal stages:
>
> | Stage | Deals | Avg Days | Classification |
> |-------|-------|----------|---------------|
> | Discovery | 45 | 12 | Active |
> | Demo | 38 | 8 | Active |
> | Proposal | 22 | 14 | Active |
> | Negotiation | 11 | 18 | Active |
> | Closed Won | 89 | — | ✅ Won |
> | Closed Lost | 67 | — | ❌ Lost |
> | On Hold | 8 | 47 | ⚠️ Unclear — parking lot? |
> | Verbal Commit | 0 | — | ⚠️ No deals — still active? |
>
> Two things I want to confirm:
> 1. "On Hold" — should I exclude these from active pipeline? They look like parking lot deals.
> 2. "Verbal Commit" — no deals here currently. Is this stage retired?

What Pandora is really asking:
- Which stages mean won? Which mean lost?
- Are there parking lot or paused stages that should be excluded from active pipeline?
- Are there dead stages to ignore?
- Is the stage order correct?

Graceful degradation if skipped:
- Uses stage_configs from CRM sync (usually correct for won/lost)
- Unknown stages treated as active
- Pipeline counts may include paused/parking lot deals

---

**Q4: Team Roster — Who Are Your Reps?**
*Config target: `teams.roles[]`, `teams.excluded_owners[]`, rep-to-motion mapping*
*Pre-research: CRM scan (distinct owners, deal distribution per owner, which pipelines each owner touches)*

Hypothesis presentation:
> I found [N] deal owners in your CRM. Here's how I'd classify them:
>
> **Likely sales reps** (regular deal activity):
> | Name | Pipeline Focus | Open Deals | Closed Won (6mo) |
> |------|---------------|------------|-----------------|
> | Nate Chen | Enterprise | 8 | 4 ($720K) |
> | Sarah Lopez | Enterprise | 6 | 3 ($510K) |
> | Jack Rivera | Growth | 15 | 12 ($380K) |
> | ... | ... | ... | ... |
>
> **Likely non-reps** (minimal or admin-pattern activity):
> | Name | Reason |
> |------|--------|
> | admin@company.com | Email pattern suggests system account |
> | CEO Name | Only 2 deals, both large — likely exec sponsor, not rep |
> | Former Employee | No activity in 6+ months, 0 open deals |
>
> **New in the last 30 days:**
> | Name | First deal | Deals so far |
> |------|-----------|-------------|
> | Ben Torres | 2 weeks ago | 3 deals (Growth) |
>
> Who's missing? Anyone miscategorized?

What Pandora is really asking:
- Who should be evaluated as a sales rep vs excluded (admins, execs, former employees)?
- How do reps map to motions?
- Any new hires who need ramp tracking?
- Who are the managers? (Not always in CRM — may need to ask)

Graceful degradation if skipped:
- All deal owners treated as reps
- Brief Section 4 includes system accounts and execs (confusing)
- No ramp tracking for new hires

Voice assist: "Can you walk me through your team structure? Who reports to whom?"

---

### TIER 1 — Important (collect in first session if time allows, otherwise first week)

---

**Q5: Stale Deal Thresholds**
*Config target: `thresholds.stale_deal_days`, per-motion if different*
*Pre-research: CRM scan (days_in_stage distribution, deal velocity by pipeline)*

Hypothesis presentation:
> Based on your deal velocity, here's what "stale" looks like for each motion:
>
> | Motion | Avg Stage Duration | Suggested Stale Threshold | Deals That Would Be Flagged |
> |--------|-------------------|--------------------------|---------------------------|
> | Enterprise | 22 days | 30 days | 14 deals ($1.8M) |
> | Mid-Market | 9 days | 14 days | 23 deals ($540K) |
> | Renewals | 11 days | 21 days | 3 deals ($240K) |
>
> Do these thresholds feel right? Too aggressive, too lenient?

What Pandora is really asking:
- At what point should a deal with no activity be flagged?
- Should it differ by motion? (Almost always yes)
- Are there stages where long durations are normal? (e.g., "Legal Review" might legitimately take 30 days)

Graceful degradation if skipped:
- Default: 14 days stale, 30 days critical (same for all motions)
- Pipeline hygiene runs but may over-flag enterprise deals or under-flag SMB deals

---

**Q6: Forecast Method and Categories**
*Config target: `pipelines[].forecast`, `win_rate.segment_by`*
*Pre-research: CRM scan (custom fields containing 'forecast' or 'category', probability distributions)*

Hypothesis presentation:
> I see a custom field called "[field name]" with values: Commit, Best Case, Pipeline, Omit.
> [OR: I don't see a forecast category field. Do your reps categorize deals by forecast confidence?]
>
> How should I use this for forecasting?
> - Option A: Rep-set forecast categories (trust the field)
> - Option B: Stage-based probability (weighted pipeline)
> - Option C: Hybrid — categories for this quarter's deals, stage-based for everything else

What Pandora is really asking:
- Do you use forecast categories? Which field?
- Should Pandora trust rep-set categories or calculate its own?
- What does "commit" mean in your org? (Hard commit with 90%+ confidence? Or optimistic best guess?)

Graceful degradation if skipped:
- Stage-based weighted pipeline (default probabilities from stage_configs)
- No commit/best-case/upside segmentation in brief
- Forecast section works but is less nuanced

---

**Q7: Win Rate Calculation Rules**
*Config target: `win_rate.*`*
*Pre-research: CRM scan (win/loss distribution, early-stage losses, lookback window analysis)*

Hypothesis presentation:
> Your overall win rate (last 6 months) is 34%. But that includes deals that were lost in Discovery — deals that never really had a chance.
>
> If I exclude deals lost before Demo (Stage 0 losses), your qualified win rate jumps to 47%.
>
> Which win rate should I use?
> - **34%** — All deals (conservative, good for pipe gen planning)
> - **47%** — Qualified deals only (better for forecasting deals already past Demo)
> - **Both** — I'll use qualified for forecasting and total for pipeline generation targets

What Pandora is really asking:
- What's the minimum stage a deal should reach to count in win rate calculations?
- Should win rate be segmented by pipeline/motion?
- Lookback window — 6 months? 12 months?

Graceful degradation if skipped:
- All closed deals included in win rate (no Stage 0 exclusion)
- Single blended win rate across all motions
- 6-month lookback (default)

---

**Q8: Coverage Target**
*Config target: `pipelines[].coverage_target`, `thresholds.coverage_target`*
*Pre-research: CRM scan (current coverage ratios by motion)*

Hypothesis presentation:
> Here's your current pipeline coverage by motion:
>
> | Motion | Pipeline | Target | Coverage | Industry Norm |
> |--------|----------|--------|----------|---------------|
> | Enterprise | $2.4M | $1.8M | 1.3× | 3-4× typical |
> | Mid-Market | $1.1M | $1.0M | 1.1× | 2.5-3× typical |
> | Renewals | $380K | $400K | 0.95× | 1.2-1.5× typical |
>
> What coverage multiple are you targeting for each motion?

What Pandora is really asking:
- What's your pipeline coverage target? (3×? 4×? Depends on motion?)
- Is this a hard org-wide number or does it vary?

Graceful degradation if skipped:
- Default 3× across all motions
- Brief shows coverage but may flag "under-covered" when the org is actually fine

---

**Q9: Required Fields by Stage**
*Config target: `thresholds.required_fields[]`, per-stage validation rules*
*Pre-research: CRM scan (field fill rates by stage, fields that jump from 0% to high fill at certain stages)*

Hypothesis presentation:
> I looked at which fields are filled in at each stage. Interesting patterns:
>
> | Field | Discovery | Demo | Proposal | Negotiation |
> |-------|-----------|------|----------|-------------|
> | Amount | 45% | 88% | 100% | 100% |
> | Close Date | 34% | 82% | 96% | 100% |
> | Next Step | 12% | 22% | 41% | 38% |
> | Contact | 67% | 89% | 94% | 100% |
>
> Looks like Amount and Close Date are effectively required by Proposal stage. Want me to enforce that?
> And it looks like Next Step is rarely filled — is that a field your team uses?

What Pandora is really asking:
- What fields should be filled in at each stage?
- Are there fields in CRM that your team doesn't use? (So Pandora doesn't penalize empty fields that nobody fills)

Graceful degradation if skipped:
- Default required fields: amount and close_date for all stages
- Data quality audit runs but flags everything generically

---

**Q10: Delivery Preferences — Slack, Email, Timing**
*Config target: `cadence.timezone`, delivery routing*
*Pre-research: Workspace Slack config (if connected)*

Direct question (no hypothesis needed — this is preference, not data):
> A few quick questions about how you want to receive updates:
>
> 1. What timezone are you in? (For brief timing)
> 2. Do you have a Monday pipeline review meeting? What time?
> 3. Which Slack channel should pipeline updates go to?
> 4. Who else should receive the brief? (CRO, managers?)

Graceful degradation if skipped:
- Default: 7 AM UTC, no Slack delivery
- Brief generates but isn't sent anywhere

---

### TIER 2 — Enriching (collect in first week via follow-up prompts)

These questions surface contextually — after the first brief runs, after the first skill produces output, or when Pandora encounters an ambiguity.

---

**Q11: Sales Methodology**
*Config target: `definitions.methodology`, `definitions.qualified_definition`*
*Trigger: After first pipeline-hygiene or deal-risk-review run*

> I just ran your first pipeline health check. I flagged deals missing contacts and next steps, but I'm using generic qualification criteria. Do you use a formal methodology?
>
> - MEDDIC / MEDDPICC
> - BANT
> - SPICED
> - SNAP
> - Custom / informal
> - None — just stages
>
> [If Drive connected and playbook found]: I found a doc called "Sales Playbook 2026" in your Drive. Want me to read it and extract your qualification criteria?

Graceful degradation if unanswered:
- Generic qualification checks (has amount, has close date, has contact)
- Single-thread alert uses contact count, not role-based analysis
- No methodology-specific deal scoring

---

**Q12: Activity Expectations**
*Config target: `activities.engagement_weights`, activity benchmarks per role*
*Trigger: After first rep-scorecard run or when activity data is synced*

> Your reps average [X] meetings, [Y] calls, and [Z] emails per week. Here's the distribution:
>
> [histogram of rep activity levels]
>
> What does "good" look like for your team? For enterprise reps specifically? For mid-market?

Graceful degradation if unanswered:
- Rep activity shown as relative (above/below team avg) not absolute
- No "expected meeting count" benchmark, just peer comparison
- Scores still work via z-score normalization

---

**Q13: Deal Discount Patterns**
*Config target: `pipelines[].discount_norm`*
*Trigger: After forecast-rollup or when Pandora notices forecast vs close patterns*

> Looking at your closed-won deals, I see an average discount of [X]% off list. Enterprise averages [Y]%, mid-market averages [Z]%.
>
> Should I adjust weighted forecasts to account for typical discounting? A $200K deal at proposal might realistically close at $170K if enterprise typically discounts 15%.

Graceful degradation if unanswered:
- Forecast uses deal amount at face value
- No discount adjustment on weighted pipeline

---

**Q14: Contract Structure — ACV vs TCV**
*Config target: `pipelines[].booking_model`*
*Trigger: When Pandora detects high-variance deal sizes or multi-year patterns*

> I see some deals at $500K+ alongside $50K deals in the same pipeline. A few questions:
> - Are the large deals multi-year contracts (TCV) or single-year (ACV)?
> - Should pipeline coverage be calculated on ACV or total contract value?
> - Is there a field that indicates contract length?

Graceful degradation if unanswered:
- All amounts treated as-is (no ACV normalization)
- Coverage math uses raw deal amounts

---

**Q15: Competitors**
*Config target: `definitions.competitors[]`*
*Trigger: When conversation intelligence is connected, or after competitive-intelligence skill runs*
*Pre-research: Serper search for competitors already done in pre-interview*

> From your G2 reviews, it looks like your main competitors are [Competitor A] and [Competitor B]. Is that right? Anyone else I should watch for in call transcripts and deal notes?

Graceful degradation if unanswered:
- Competitive intelligence skill still runs but with no competitor watchlist
- No proactive competitor mention alerts from calls

---

**Q16: Close Plan Milestones**
*Config target: `pipelines[].close_plan_milestones[]`*
*Trigger: At week 7-8 of quarter, or when quarter-close brief mode activates*

> We're entering the close phase of the quarter. For your enterprise deals, what does the last-mile look like?
>
> Which of these typically happen before a deal closes?
> - [ ] Legal / MSA review
> - [ ] Procurement / vendor onboarding
> - [ ] Security questionnaire
> - [ ] Executive sponsor meeting
> - [ ] Technical validation / POC
> - [ ] Board or committee approval
>
> I'll use this to flag commit deals that are missing these milestones.

Graceful degradation if unanswered:
- Quarter-close brief shows deals by stage and close date but can't flag "missing legal engagement"
- Deal risk assessment uses stage duration and activity recency instead of milestone completion

---

**Q17: Buying Committee Expectations**
*Config target: `thresholds.minimum_contacts_per_deal`, contact role requirements per motion*
*Trigger: After single-thread-alert or contact-role-resolution runs*

> Based on your won deals, the typical buying committee has [N] people involved:
>
> | Role | % of Won Deals | % of Lost Deals |
> |------|---------------|----------------|
> | Executive Sponsor | 78% | 31% |
> | Technical Champion | 82% | 45% |
> | Procurement Contact | 65% | 22% |
>
> Executive involvement seems to strongly correlate with winning. Want me to flag deals in proposal+ that don't have an exec contact?

Graceful degradation if unanswered:
- Default: flag deals with <2 contacts as single-threaded
- No role-based analysis, just contact count

---

**Q18: Call Recording Coverage**
*Config target: `activities.call_recording_coverage`*
*Trigger: When conversation intelligence is connected and data variance is high*

> I see [X] recorded calls in Gong/Fireflies, but your team logged [Y] calls in CRM. That means about [Z]% of calls are being recorded.
>
> Is recording expected for all calls, or just certain types? I ask because if reps aren't recording, I don't want to penalize them for "low call activity" in conversation intelligence.

Graceful degradation if unanswered:
- Conversation intelligence results shown but no caveat about coverage
- Rep scorecard counts all tracked calls without coverage adjustment

---

### TIER 3 — Advanced (surface when relevant)

---

**Q19: Forecast Call Cadence**
*Config target: `cadence.forecast_review_day`, `cadence.forecast_review_time`*
*Trigger: When brief delivery is configured*

> Do you have a recurring forecast or pipeline review call? I'd like to make sure your brief is ready before it starts.

---

**Q20: QBR Schedule**
*Config target: `cadence.qbr_schedule`*
*Trigger: End of month or when board prep skills are requested*

> Do you run QBRs? Monthly, quarterly? I can pre-assemble the data package before your QBR so you're not scrambling.

---

**Q21: Historical Data Caveats**
*Config target: `definitions.data_caveats[]`*
*Trigger: When Pandora detects CRM migration artifacts or data anomalies*

> I noticed a large batch of deals created on [date] with identical timestamps — looks like a data migration. How far back should I trust your CRM data for trend analysis?

---

**Q22: Territory / Segment Boundaries**
*Config target: Named filters per territory*
*Trigger: When reps have geographic or industry focus visible in deal data*

> Some of your reps seem to specialize by industry — [Name] has 80% healthcare deals, [Name] has 70% financial services. Are there formal territories or specializations?

---

**Q23: Expansion and Land-Expand Patterns**
*Config target: `pipelines[].expansion_model`*
*Trigger: When renewal/expansion motion exists and deal history shows upsell patterns*

> Looking at your accounts with multiple deals, the initial deal averages $50K and the second deal averages $120K. Do you have a formal land-and-expand motion?

---

**Q24: Internal Activity Domains**
*Config target: `activities.internal_domains[]`*
*Trigger: When activity data shows high email volume to internal domains*

> I see a lot of email activity to @yourcompany.com addresses. Should I exclude internal emails from engagement scoring so only external (customer-facing) activity counts?

---

**Q25: Closed-Lost Reason Categories**
*Config target: `definitions.loss_reasons[]`*
*Trigger: After first win/loss analysis or when loss reasons are diverse*

> Your Closed Lost deals have [N] different reason values. Want me to group these into categories for win/loss analysis?
>
> Here's my suggested grouping:
> | Category | Loss Reasons | Count |
> |----------|-------------|-------|
> | Competitive | Lost to competitor, Competitive loss | 23 |
> | Timing | Not now, Budget freeze, Postponed | 18 |
> | No Decision | Went dark, No response, Stalled | 31 |
> | Bad Fit | Wrong product, Not qualified | 12 |

---

## Role-Based Onboarding Paths

Not every user goes through the same interview. The path depends on who they are.

### RevOps Admin (full onboarding)
This is Jeff's use case — the operator setting up the workspace. Gets the full interview starting with Tier 0, progressing through Tier 1, and receiving Tier 2 prompts over the first week.

**Session 1 (10-15 minutes):** Q1-Q4 (motions, targets, stages, team) + Q10 (delivery)
**Session 2 (triggered after first brief):** Q5-Q9 (thresholds, forecasting, required fields)
**Ongoing (contextual):** Q11-Q25 as triggered by data patterns and skill outputs

### CRO / Sales Leader (light onboarding)
Doesn't configure — consumes. Brief should already be set up by RevOps. Their "onboarding" is seeing their first brief and being asked preferences.

**Session 1 (2 minutes):**
> Welcome to Pandora. [RevOps Admin] has configured your workspace. Here's your first brief — take a look.
>
> A couple of preferences:
> - What do you want to see first when you open Pandora? (The number / Pipeline changes / Rep performance / Deal risks)
> - How detailed do you like your briefings? (Headlines only / Standard / Deep dive)

### Manager (medium onboarding)
Sees their team's slice. Might contribute knowledge about their reps that RevOps doesn't have.

**Session 1 (5 minutes):**
> I see you manage [list of reps]. A few questions to help me tailor your view:
> - Any reps currently ramping? When did they start?
> - What does your weekly pipeline review look like? (Day, time, what you cover)
> - Anything I should know about individual reps? (e.g., "Maria is transitioning from mid-market to enterprise")

### Consultant (Jeff's personal path — multi-workspace)
Manages multiple client workspaces. Needs a meta-view and efficient setup across clients.

**Session 1 per client (10-15 minutes):** Same as RevOps Admin
**Cross-workspace view:**
> You have 4 workspaces. Want me to create a cross-workspace summary brief that shows all clients in one view?

---

## Conversation Flow Engine

### Structure

The interview is a state machine. Each question has:

```typescript
interface OnboardingQuestion {
  id: string;                          // 'Q1_motions'
  tier: 0 | 1 | 2 | 3;
  config_targets: string[];            // ['pipelines', 'revenue_motions', 'named_filters']
  
  // Pre-conditions
  requires_data: string[];             // ['deals'] — which synced data tables must have rows
  requires_questions: string[];        // ['Q3_stages'] — must be answered before this
  trigger?: string;                    // 'after:pipeline-hygiene' | 'quarter_week:8' | null
  
  // Hypothesis generation
  hypothesis_sources: ('crm_scan' | 'serper' | 'document_scan' | 'prior_answers')[];
  generate_hypothesis: (scan: CRMScanResult, research: CompanyResearch, priorAnswers: Map) => Hypothesis;
  
  // Presentation
  prompt_template: string;             // Handlebars-style template with hypothesis data
  input_modes: ('text' | 'voice' | 'upload' | 'select')[];
  suggested_uploads?: string[];        // ['quota spreadsheet', 'CRM stage settings screenshot']
  
  // Processing
  parse_response: (response: string, hypothesis: Hypothesis) => ConfigPatch;
  follow_up?: (response: string) => string | null;  // Generate follow-up question if needed
  
  // Skip logic
  can_skip: boolean;
  skip_default: ConfigPatch;           // What config values to use if skipped
  skip_message: string;                // "No problem — I'll use default thresholds. You can adjust anytime in Settings."
  
  // Completion
  on_complete: (patch: ConfigPatch) => void;  // Save to config, create named filters, etc.
  show_artifact: boolean;              // Show the named filter / config that was created
}
```

### Flow Control

```
Start onboarding
    │
    ▼
Run pre-interview intelligence (parallel):
  - CRM scan (instant)
  - Serper research (5-10s)  
  - Document scan (background, if connected)
    │
    ▼
Determine role (from workspace invite or ask):
  - RevOps Admin → full path
  - CRO → light path
  - Manager → medium path
    │
    ▼
Present Tier 0 questions sequentially:
  For each question:
    1. Generate hypothesis from pre-research
    2. Present hypothesis with evidence
    3. Accept response (text/voice/upload/select)
    4. Parse into config patch
    5. Show artifact created (named filter, config value)
    6. Ask follow-up if needed
    7. [Skip] button always available → apply defaults
    │
    ▼
After Tier 0 complete:
  - Assemble first brief preview
  - Show: "Here's what your first brief will look like based on what we set up"
  - Run instant audit (pipeline hygiene, data quality) with new config
    │
    ▼
Tier 1 questions:
  - Present as "A few more things to refine" after first brief preview
  - Can be deferred: "I'll ask you about these later as they come up"
  - Each one has a [Skip for now] that applies defaults
    │
    ▼
Tier 2-3: 
  - Never shown in onboarding session
  - Triggered contextually by data patterns or skill outputs
  - Appear as in-app prompts: "Quick question about your team..."
```

### Skip and Return Logic

Every question can be skipped. The system tracks:

```typescript
interface OnboardingState {
  workspace_id: string;
  started_at: string;
  completed_at: string | null;
  
  questions: {
    [questionId: string]: {
      status: 'pending' | 'answered' | 'skipped' | 'deferred';
      answered_at?: string;
      skipped_at?: string;
      defer_until?: string;          // 'after:pipeline-hygiene' | '2026-03-15'
      response_source?: 'text' | 'voice' | 'upload' | 'select';
      config_patches_applied: string[];   // Which config paths were set
      hypothesis_confidence: number;      // How confident was the hypothesis
      user_changed_hypothesis: boolean;   // Did the user edit or accept as-is
    }
  };
  
  // Progress
  tier0_complete: boolean;
  tier1_complete: boolean;
  first_brief_generated: boolean;
  
  // Re-entry
  can_resume: boolean;
  resume_from: string;              // Question ID to resume from
}
```

For existing workspaces: A "Re-run onboarding" button in Settings triggers the same flow but pre-fills all answers from current config. The admin sees their current setup as editable hypotheses. Anything with `source: 'default'` or `source: 'inferred'` gets highlighted: "This was auto-detected and hasn't been confirmed."

---

## Storage Architecture

Every onboarding answer writes to existing infrastructure. No new tables needed for config storage.

### Where answers land:

| Question | Storage Target | Table/Field |
|----------|---------------|-------------|
| Q1 Motions | WorkspaceConfig.pipelines[] + revenue_motions + named_filters | context_layer (workspace_config key) + revenue_motions table + context_layer (named_filters) |
| Q2 Calendar & Targets | WorkspaceConfig.cadence + goals + quota_periods | context_layer + goals table + quota_periods table |
| Q3 Stages | stage_configs + WorkspaceConfig.win_rate | stage_configs table + context_layer |
| Q4 Team | WorkspaceConfig.teams + rep_quotas | context_layer + rep_quotas table |
| Q5 Stale thresholds | WorkspaceConfig.thresholds | context_layer |
| Q6 Forecast method | WorkspaceConfig.pipelines[].forecast | context_layer |
| Q7 Win rate rules | WorkspaceConfig.win_rate | context_layer |
| Q8 Coverage target | WorkspaceConfig.pipelines[].coverage_target | context_layer |
| Q9 Required fields | WorkspaceConfig.thresholds.required_fields | context_layer |
| Q10 Delivery | Slack config + cadence.timezone | connector_configs + context_layer |
| Q11-Q25 | Various context_layer fields | context_layer |

### ConfigMeta tracking:

Every value written from onboarding gets:

```json
{
  "source": "confirmed",           // User confirmed hypothesis
  "confidence": 1.0,
  "evidence": "User confirmed during onboarding session 2026-03-01",
  "last_validated": "2026-03-01T14:30:00Z"
}
```

Values from accepted-without-editing hypotheses:

```json
{
  "source": "inferred",
  "confidence": 0.85,
  "evidence": "CRM scan: 3 distinct pipelines with different deal size distributions",
  "last_validated": "2026-03-01T14:30:00Z"
}
```

Values from uploaded documents:

```json
{
  "source": "doc_extracted",
  "confidence": 0.75,
  "evidence": "Extracted from 'Sales Playbook 2026.pdf', page 4",
  "last_validated": "2026-03-01T14:30:00Z"
}
```

Skills already read ConfigMeta and add caveats to output when confidence is low. No additional wiring needed.

### Onboarding state storage:

```sql
-- Add to context_layer as a config document
-- key: 'onboarding_state'
-- category: 'settings'
-- value: OnboardingState JSON
```

No new table. Uses the existing context_layer pattern. Query:
```sql
SELECT value FROM context_layer 
WHERE workspace_id = $1 AND category = 'settings' AND key = 'onboarding_state'
```

---

## Document Upload Architecture

### Supported Formats

| Format | Max Size | Processing |
|--------|---------|------------|
| PDF | 50MB | pdf-parse (text) + Claude vision (tables/charts) |
| DOCX | 25MB | pandoc or mammoth for text extraction |
| XLSX/CSV | 25MB | SheetJS for parsing, auto-detect structure |
| PNG/JPG/WEBP | 10MB | Claude vision — CRM screenshots, org charts |
| PPTX | 50MB | python-pptx for text/slide extraction |
| Google Docs/Sheets | Link | Google Drive API fetch (already wired) |
| TXT/MD | 10MB | Direct text read |

### Processing Pipeline

```
User uploads file or drops screenshot
    │
    ▼
File validation:
  - Size check (per format limits)
  - Type detection (magic bytes, not just extension)
  - Virus scan stub (future)
    │
    ▼
Store raw file:
  - S3 or local storage: /uploads/{workspace_id}/{batch_id}/{filename}
  - Record in upload_batches or context_layer as metadata
    │
    ▼
Content extraction (format-specific):
  PDF → pdf-parse for text, Claude vision for tables
  XLSX → SheetJS parse, detect header row, extract as JSON
  DOCX → pandoc to markdown, extract structured sections
  Image → Claude vision with context-specific prompt
  PPTX → python-pptx, extract text per slide
    │
    ▼
Contextual interpretation (Claude call):
  Prompt: "This document was uploaded during onboarding in response to 
  the question: [current question]. Extract relevant configuration 
  data. The workspace sells [context from prior answers]. 
  Return structured JSON matching: [expected schema]."
    │
    ▼
Present extraction as editable hypothesis:
  "Here's what I found in your document. Does this look right?"
    │
    ▼
User confirms/edits → write to config
```

### Large File Handling

Files over 5MB: chunked upload with progress indicator. The backend processes asynchronously and sends a websocket notification when extraction is complete.

For very large files (e.g., 50MB PPTX with 100 slides): extract only relevant sections. The Claude prompt specifies what to look for based on the current onboarding question. A sales playbook upload during Q11 (methodology) only extracts methodology and stage criteria sections, not the entire deck.

### Upload Context

The same file uploaded at different points in the interview extracts different things:

| Current Question | Upload: "Sales Playbook.pdf" | What's Extracted |
|-----------------|------------------------------|------------------|
| Q1 (Motions) | Motion definitions, pipeline descriptions, deal size boundaries |
| Q3 (Stages) | Stage definitions, entry criteria, exit criteria |
| Q11 (Methodology) | MEDDIC fields, qualification criteria, required activities |
| Q16 (Close Plan) | Procurement process, legal review steps, approval workflows |

The extraction prompt is question-aware. One document can be re-processed against multiple questions if the user says "Use the playbook I uploaded earlier."

---

## Voice Implementation

### Flow

```
User taps/holds mic button
    │
    ▼
Browser MediaRecorder API captures audio
  - Format: webm/opus (Chrome) or mp4/aac (Safari)
  - Max duration: 120 seconds (display countdown)
  - Visual feedback: waveform animation
    │
    ▼
User releases / taps stop
    │
    ▼
Audio blob sent to backend
    │
    ▼
Transcription:
  - Primary: Whisper API (OpenAI) or Deepgram
  - Replit may provide built-in — use theirs if available
  - Latency target: <3 seconds for 30s clip
    │
    ▼
Transcript displayed to user in the chat:
  "I heard: [transcript]. Let me process that..."
  (User can correct if transcription is wrong)
    │
    ▼
Transcript fed to onboarding orchestrator as text input
  - Same processing path as typed responses
  - Claude extracts structured config from natural speech
    │
    ▼
Hypothesis/artifact presented for confirmation
```

### Voice-Specific UX

- Mic button always visible during onboarding (not buried in a menu)
- "Hold to talk" on mobile, "Click to start / click to stop" on desktop
- Real-time transcription preview if the transcription service supports streaming
- Automatic silence detection — stop recording after 3s of silence
- "I didn't catch that clearly. Can you say the part about [topic] again?" if transcription confidence is low

### What works well with voice vs what doesn't:

| Great for voice | Not great for voice |
|----------------|-------------------|
| "Walk me through your pipelines" | Specific dollar amounts ($1,847,293) |
| "Tell me about your team" | Email addresses |
| "How does your sales process work?" | Correcting a specific field value |
| "What does commit mean in your org?" | Editing a named filter condition |

When Pandora detects the response requires precision (numbers, emails), it can prompt: "Got it. Let me put that in a form — can you type the exact quota numbers?"

---

## Re-Onboarding for Existing Workspaces

### Manual Trigger

Settings → Workspace → "Re-run Setup Interview"

The interview starts with current config pre-populated. Every question shows the current value as the hypothesis, with ConfigMeta source:

> **Your current motion setup** (configured 6 months ago, last confirmed March 2025):
>
> | Motion | Filter | Current Deals | Config Source |
> |--------|--------|---------------|--------------|
> | Enterprise NB | pipeline = 'Enterprise' AND amount >= 150K | 41 | ✅ Confirmed |
> | Mid-Market NB | pipeline = 'Growth' | 94 | ✅ Confirmed |
> | Renewals | pipeline = 'Renewals' | 12 | ⚠️ Inferred, never confirmed |
>
> Anything changed? New pipelines, different thresholds?

### Drift-Triggered Re-onboarding

The workspace config audit skill (already spec'd in Prompt 4) detects drift:
- New pipeline appeared in CRM
- New reps appeared
- Stage configuration changed
- Deal volume patterns shifted

When drift is significant, Pandora surfaces a contextual prompt:

> I noticed a new pipeline called "Partner" appeared with 7 deals this month. Is this a new revenue motion I should track separately?

This is a single-question micro-onboarding, not a full re-interview. It patches one config value and moves on.

### Bulk Re-validation

For workspaces with mostly `source: 'inferred'` or `source: 'default'` config:

> I noticed most of your workspace configuration hasn't been explicitly confirmed. Want to do a quick review? I'll show you what I'm assuming and you can accept or correct each one. Should take about 5 minutes.

This walks through only unconfirmed values, skipping anything already at `source: 'confirmed'`.

---

## Context Surfacing for Tools, Skills, and Agents

Every config value written by onboarding is immediately available to the system through the existing `configLoader` infrastructure. No additional wiring needed. But the onboarding state itself is also useful context.

### What skills can read:

```typescript
// Existing (already works):
const config = await configLoader.getConfig(workspaceId);
const winRate = await configLoader.getWinRate(workspaceId);
const meta = await configLoader.getConfigMeta(workspaceId, 'win_rate.minimum_stage');

// New (add to configLoader):
const onboarding = await configLoader.getOnboardingState(workspaceId);

// Skills can check:
if (!onboarding.tier0_complete) {
  // Workspace hasn't been onboarded — use extra caution with defaults
  // Add caveat to synthesis: "This workspace hasn't completed setup yet"
}

if (onboarding.questions['Q7_win_rate'].status === 'skipped') {
  // Win rate config is still default — add caveat
  // "Win rate uses all closed deals. Confirm Stage 0 exclusion in Settings."
}
```

### Brief assembler reads onboarding state:

If Tier 0 is not complete, the brief shows a gentle prompt:

> Your brief would be more accurate with a few minutes of setup.
> [Complete setup] → resumes onboarding from where they left off

### Agent prompts include config confidence:

The ConfigAssumptions system (already built) automatically appends low-confidence caveats to Claude synthesis prompts. Onboarding answers with `source: 'confirmed'` never trigger caveats. Defaults and inferences do.

---

## Implementation Sequence

### Phase 1: Pre-Interview Intelligence (backend)
- CRM scan function: `server/onboarding/crm-scanner.ts`
- Serper research function: `server/onboarding/company-research.ts`
- Document scan function: `server/onboarding/document-scanner.ts`
- Hypothesis generators per question: `server/onboarding/hypotheses/`

### Phase 2: Onboarding Flow Engine (backend + frontend)
- State machine: `server/onboarding/flow-engine.ts`
- Question definitions: `server/onboarding/questions/` (one file per tier)
- Response parser: `server/onboarding/response-parser.ts` (Claude-powered)
- API endpoints: `server/routes/onboarding.ts`
  - POST `/:workspaceId/onboarding/start`
  - GET `/:workspaceId/onboarding/state`
  - POST `/:workspaceId/onboarding/answer` (text response)
  - POST `/:workspaceId/onboarding/upload` (file upload)
  - POST `/:workspaceId/onboarding/skip`
  - POST `/:workspaceId/onboarding/resume`

### Phase 3: Voice + Upload (frontend + backend)
- Voice capture component: `client/src/components/onboarding/VoiceCapture.tsx`
- File upload component: `client/src/components/onboarding/FileUpload.tsx`
- Transcription service: `server/onboarding/transcription.ts`
- Document extraction: `server/onboarding/document-extractor.ts`

### Phase 4: Frontend Interview UI
- Onboarding page: `client/src/pages/OnboardingFlow.tsx`
- Question card component (shows hypothesis + edit + confirm)
- Artifact preview component (shows named filter / config created)
- Progress indicator (Tier 0: 4/4 complete)
- Skip / defer controls
- Re-onboarding entry point in Settings

### Phase 5: Contextual Follow-ups
- Trigger system: register triggers per Tier 2-3 question
- In-app prompt component (non-blocking, dismissable)
- Drift detection integration with config audit skill
- Micro-onboarding for single-config-value changes

---

## What NOT to Build

- **AI-generated config without human review** — always show hypothesis, always require confirmation or explicit skip
- **Mandatory onboarding gate** — the system works with all defaults. Onboarding improves accuracy but never blocks usage
- **Multi-step wizards with back buttons** — it's a conversation, not a form. The admin talks to Pandora and Pandora builds config
- **Per-field settings page as alternative** — the interview IS the settings page. Traditional settings is for later edits, not initial setup
- **Real-time CRM field discovery during onboarding** — too slow. Pre-scan before the interview starts
- **Onboarding analytics / completion tracking** — the onboarding state is enough. No need for funnel analytics on setup completion rates
- **Different onboarding per CRM type** — the questions are the same. Only the hypothesis generation changes (HubSpot field names vs Salesforce field names)

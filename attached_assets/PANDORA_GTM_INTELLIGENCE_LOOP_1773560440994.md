# Pandora — The GTM Intelligence Loop
## Product Vision + Skill Architecture

---

## The Core Idea

Replit Agent solves problems through a tight loop: write → execute → read error → 
revise. It works because execution is cheap, feedback is specific, and causality is 
clear.

GTM teams today have none of these properties. Testing a hypothesis costs headcount 
and pipeline. Feedback arrives a quarter later. Causality is almost always ambiguous.

Pandora's job is to manufacture those conditions for revenue operations.

The GTM Intelligence Loop is five capabilities that compose into one continuous 
reasoning system — running backward over history, forward over probability, and 
longitudinally over the team's own stated intentions.

```
Stack Trace     →  why did we get here
Simulation      →  where do the paths lead from here
Hypothesis      →  what would change the path
Intervention    →  did we actually do it
Pre-Mortem      →  sim + hypothesis run before the quarter, not after
```

These are not five features. They are one loop.

---

## Foundational Principle: Pandora Is the Author

The human is the editor, not the author.

Pandora should derive composition hypotheses from data — not wait for a human to 
supply intuition. When a RevOps leader says "we need 3 of our 5 big deals to close 
to hit number," that's the output of pattern recognition over data Pandora already 
has. Pandora should arrive at that conclusion first and present it for validation.

The user's role is two things only:
- **Validation** — confirm when Pandora's reasoning is right, correct it when context 
  exists that isn't in the data (e.g., a champion just left, a deal is in legal review)
- **Stakes** — decide what to do about what Pandora surfaces. That's judgment, not data.

Concierge and Ask Pandora present hypotheses to the user. They do not wait to 
receive them.

---

## Two Simulation Modes

Every simulation question is one of two types. Pandora uses both and presents them 
together.

### Monte Carlo — "Given everything we know, what's the distribution of outcomes?"

Inherently probabilistic. Every deal has a close probability. Every probability has 
variance. Run 10,000 simulations and produce a range: P10, P50, P90.

Right tool for: quarterly forecast, risk assessment, pre-mortem scenario planning.

Monte Carlo already exists as a built skill (`monte-carlo-forecast`). It fits 
Beta distributions to stage win rates, log-normal distributions to deal size and 
cycle length, and runs pure arithmetic simulations with zero LLM tokens.

### "All Else Equal" — "If I change exactly one thing, what moves?"

Holds the entire system constant and isolates one variable. Answers: what is this 
specific lever worth?

Right tool for: hypothesis testing, intervention evaluation, prioritization.

```
All else equal — ACES deal closes:
  Current P50 landing: $910K
  ACES closes (all else equal): $1,090K
  ACES isolated value to quarter: +$180K

All else equal — GlobalPay re-engages this week:
  P50 moves from $910K to $970K
  Worth 3x the effort of a mid-market re-engagement

All else equal — conversion rate improves 5 points:
  P50 moves from $910K to $1,040K
  But requires systematic change, not a single deal action
```

The insight: **"all else equal" is how you prioritize. Monte Carlo is how you plan.**

### How they compose

When Pandora runs the quarter model, it produces both automatically:
- Monte Carlo output → the **forecast**: "you're likely to land between $840K–$1.1M"
- "All else equal" output → the **action menu**: ranked list of specific things that 
  move the number, with individual expected value

The user sees: *here's where you're headed, here's what moves the needle most.*

---

## 1. GTM Stack Trace

### What it is

When a metric moves unexpectedly, trace it back to its causal layer automatically — 
the way a runtime error produces a stack trace that points to the specific line.

The loop executor already sequences skills. The stack trace is that sequencing 
made explicit and recursive: keep running until the layer where the metric breaks 
from its historical pattern.

### The causal layer model

```
Layer 1: Outcome metric         (win rate dropped 8 points)
Layer 2: Segment decomposition  (drop concentrated in enterprise only)
Layer 3: Deal behavior          (enterprise deals without exec sponsor closing lost 3x rate)
Layer 4: Process signal         (exec sponsor engagement dropped in stage 3)
Layer 5: Root cause             (discovery framework changed in January — no exec mapping step)
```

Each layer is a SQL query against data Pandora already has. The recursion terminates 
when the pattern breaks from historical baseline, or when data runs out.

### The ACES example

ACES Corp — $240K, in Discovery stage for an extended period. Behavioral signals 
from call data, email engagement, and multi-threading indicated a deal behaving like 
Late Evaluation. The stage divergence detector caught this.

What didn't happen automatically: the forecast didn't update. The deal was weighted 
at Discovery-stage close probability (~10%) when behavioral evidence suggested ~45%.

The stack trace connects the detection to the forecast:

```
Stage divergence detected: ACES Corp
  CRM stage: Discovery (10% close probability)
  Behavioral stage: Late Evaluation (45% — based on 4 stakeholders engaged,
    2 technical calls completed, pricing discussed on last call)
  
  Forecast impact: +$84K expected value when using behavioral stage
  Current forecast: $24K EV — understated by $60K

  Shadow forecast bearing added: behavioral-adjusted EV = $108K
  (vs. stage-weighted EV = $24K)
```

Stage divergence is a risk signal today. It should be a **forecast input correction**.

### New infrastructure required

**`behavioral-stage-correction` compute function** — added to `forecast-rollup` and 
`monte-carlo-forecast` as an additional bearing:

```typescript
behavioralStageCorrection(workspaceId: string, openDeals: Deal[]) → {
  corrections: [{
    dealId: string,
    dealName: string,
    crmStage: string,
    crmStageCloseProb: number,
    behavioralStage: string,          // from stage-divergence skill output
    behavioralStageCloseProb: number,
    divergenceSignals: string[],      // what signals drove the divergence
    evDelta: number,                  // behavioral EV - CRM stage EV
    direction: 'understated' | 'overstated',
  }],
  totalEvDelta: number,               // net adjustment to portfolio EV
  understatedDeals: number,
  overstatedDeals: number,
}
```

Reads from the most recent `stage-divergence` skill run (Layer 1 — no rerun needed).
Applies the behavioral stage probability to compute a shadow EV for each corrected deal.

**Sixth triangulation bearing** added to `forecast-rollup`:

| Bearing | Source |
|---|---|
| Rep rollup | Rep self-forecast |
| Manager rollup | Manager-adjusted |
| Stage-weighted EV | Pipeline × stage close probabilities |
| Category-weighted EV | Pipeline × forecast category probabilities |
| Capacity model | Ramped reps × historical productivity |
| **Behavioral-adjusted EV** | **Stage-corrected EV using divergence signals** ← new |

### Skills that compose the stack trace

The bowtie funnel, forecast rollup, pipeline coverage, and week-over-week are already 
the causal layers. The loop executor sequences them. The only new thing is:

1. **Termination logic** — stop when the layer where the metric breaks from baseline 
   is found, not after a fixed number of skills
2. **Surfacing the trace** — produce a readable causal chain, not just the terminal finding
3. **Behavioral correction** — wire stage divergence into forecast as a shadow bearing

---

## 2. Portfolio Composition Hypothesis

### The concept

A RevOps leader says: "we need 3 of our 5 big deals to close to hit number."

That's not intuition. That's arithmetic over data Pandora already has. Pandora 
should derive it first.

### How Pandora derives it without being told

```
Quota: $1.2M

Pipeline by segment:
  Large deals (>$80K): 5 deals, $640K total
  Mid-market: 24 deals, $1.8M total

Historical close rates by segment (trailing 6Q):
  Large: 58%   → expected $371K from large cohort
  Mid-market: 31% → expected $558K from mid-market
  Combined expected: $929K → 77% of quota

Gap to quota: $271K

Ways to close that gap:
  Option A: Large deal hit rate → 73% (4-of-5) — within 1 standard deviation of base rate
  Option B: Mid-market conversion → 46% — heroic, 2+ standard deviations above base
  Option C: One new large deal enters and closes — requires 8 weeks minimum
  
Verdict: This quarter is won or lost on the large deal cohort.
Required: approximately 3 of 5 large deals (base rate expectation: 2.9)
```

The hypothesis is: **large deal performance is the swing variable.**

Pandora presents this in the Monday briefing and in the pre-mortem, unprompted.

### How ACES changes the composition

Stage divergence wires directly into the composition model:

```
Before ACES behavioral adjustment:
  Large deal expected closes: 2.6 of 5 → need above-average elsewhere

After ACES behavioral adjustment:
  Large deal expected closes: 3.1 of 5 → mid-market at average is sufficient
  
Concierge: "ACES engagement signals suggest higher close probability than its 
Discovery stage implies. If this holds, your current mid-market pipeline 
is sufficient without heroics."
```

The stack trace caught the divergence → the behavioral adjustment corrected the 
probability → the Monte Carlo re-ran the composition model → the hypothesis updated.
This is the loop closing automatically.

---

## 3. Hypothesis Testing — The Science of GTM

### The product form

User states a belief, or Pandora surfaces one from the stack trace. Pandora 
parses it into a testable claim, runs the minimal data test, returns a verdict, 
then generates the logical follow-on hypothesis.

The loop runs until the hypothesis resolves into something specific enough to act on.

```
Hypothesis: "We're pursuing deals too large for our close rate to support"

Step 1: Parse → testable claim
  Claim: win rate correlates negatively with deal size in recent quarters

Step 2: Design minimal test
  Query: win rate by deal size quartile, current quarter vs. 4Q trailing

Step 3: Verdict
  <$50K: win rate unchanged (24% → 23%)
  >$50K: win rate dropped (22% → 14%)
  CONFIRMED — drop is concentrated in large deals

Step 4: Follow-on hypothesis
  Is the problem qualification (we're taking bad deals in) 
  or execution (losing deals we used to win)?
  
  Test: stage 2 acceptance rate vs. late-stage win rate, segmented by deal size
  → If stage 2 acceptance up but late-stage win rate down: execution problem
  → If stage 2 acceptance unchanged: the deals are getting harder, not cheaper
```

### The chain: Stack Trace → Hypothesis → Simulation

```
Stack trace surfaces anomaly
  → "win rate dropped 8 points, concentrated in large deals, stage 3"
  
Hypothesis frames the question
  → "we think it's qualification failure on large deals entering stage 3"
  
Simulation models the intervention
  → "if we tighten stage 3 qualification criteria and drop 20% of large deal 
     pipeline, what happens to quota attainment?"
  → Monte Carlo: P50 drops $80K but P(hit quota) goes from 34% to 41%
     because the remaining pipeline converts at a higher rate
```

The hypothesis is tested against history. The intervention is tested against 
simulation. The user validates or corrects. This is the scientific method applied 
to GTM, running continuously.

### As a user-facing workflow

Hypotheses should be surfaceable as first-class objects — not just ephemeral chat 
responses. Each validated hypothesis becomes a **standing monitor**:

```
Standing hypothesis: "Large deals (>$80K) are the swing variable this quarter"
  Status: ACTIVE — monitoring weekly
  Current tracking: 2.8-of-5 expected large deal closes as of today
  Threshold: alert if drops below 2.5-of-5 expected
  Next update: Monday briefing
```

The user confirmed this hypothesis two weeks ago. Pandora monitors it until the 
quarter closes. The crumb trail starts here.

---

## 4. Intervention Tracking — The Crumb Trail

### The detection challenge

Interventions rarely show up in Salesforce or HubSpot as structured data. You won't 
detect them from CRM signals alone. The signals that do exist:

**Structural CRM changes — auto-detectable:**
- New stage names or pipeline created → log as candidate intervention
- New required fields added → log as process change
- Forecast category definitions changed → log as methodology change
- Stage order resequenced → log as process change

These are detectable from the workspace config audit skill that already runs weekly.

**Actual interventions — require a different approach:**

Sales enablement hires, new discovery frameworks, comp plan changes, ICP pivots — 
these don't live in the CRM. Two mechanisms to capture them:

**Mechanism 1: The crumb trail from hypothesis responses**

When Concierge surfaces a recommendation and the user responds with "great idea," 
"we're working on it," "we tried that last quarter," or similar — that's a soft 
intervention timestamp. Pandora should:

1. Recognize the response as an intervention signal (pattern match on affirmation language)
2. Record the timestamp and the hypothesis it's attached to
3. Follow up 6–8 weeks later: "In January you mentioned working on exec sponsor 
   mapping in discovery — here's what the data shows since then"
4. If the standing hypothesis metric moved in the right direction, attribute it

**Mechanism 2: Document ingestion**

Periodically ask for:
- Rules of engagement
- Sales process maps
- Enablement session decks
- Comp plan documents

These ARE the interventions, timestamped when uploaded. Pandora parses them, 
extracts the change relative to prior versions, and records the intervention 
automatically.

```
Document uploaded: "AE Discovery Framework v2.pdf" — March 15, 2026
Diff from prior version: Added "exec sponsor mapping" requirement at stage 2
Intervention recorded: discovery_framework_change, effective March 15

Monitoring: stage 2 → stage 3 conversion rate, exec sponsor fill rate
Before (Dec–Mar): stage 2 conversion 41%, exec sponsor on deals: 34%
After (Mar–present): [will populate at 8-week mark]
```

**Mechanism 3: Hypothesis-as-strategy**

When the stack trace produces a root cause that implies a strategy, and Pandora 
surfaces that strategy via Concierge or Ask Pandora, the strategy itself becomes 
a candidate intervention with a creation timestamp. Whether the user acts on it 
is inferred from downstream metric movement and from subsequent conversation signals.

This is the hypothesis testing loop extended over time: the hypothesis is not just 
tested against history, it's monitored against the future.

### The attribution model

Once an intervention is timestamped, before/after attribution is automatic:

```
Intervention: New discovery framework with exec sponsor mapping
Timestamp: March 15, 2026
Measurement window: 8 weeks post-implementation (to May 10)

Metrics tracked:
  Win rate (enterprise):     19% → 24%    ↑ +5pts    POSITIVE
  Stage 2 → 3 conversion:    41% → 48%    ↑ +7pts    POSITIVE  
  Exec sponsor fill rate:    34% → 61%    ↑ +27pts   POSITIVE (leading indicator)
  Avg deal size:             $42K → $38K  ↓ -10%     TRADE-OFF (smaller, more qualified)
  Sales cycle (enterprise):  67d → 71d    ↑ +4d      TRADE-OFF (more thorough discovery)

Verdict: Intervention appears to be working on quality metrics at a moderate 
volume trade-off. Coverage is the leading risk — monitor through Q2.
```

---

## 5. Pre-Mortem — Sim + Hypothesis Before the Quarter

### The product form

At the start of each quarter, the GTM diagnostic runs forward instead of backward. 
The Monte Carlo produces the distribution. The stack trace identifies the most likely 
causal paths to a miss. The composition hypothesis names the swing variable. 
Together they produce a pre-mortem:

```
Q2 2026 Pre-Mortem — generated April 1, 2026

HEADLINE: P50 landing is $910K (76% of quota). You're likely to fall short 
without a change in large deal performance or pipeline generation.

COMPOSITION: This quarter is won or lost on your 5 large deals (>$80K).
  At historical base rate (58%): 2.9 expected closes = $371K contribution
  Mid-market at historical rate: $558K contribution
  Combined P50: $929K → need large deal rate above base rate to hit $1.2M

FAILURE MODE 1: Large deal conversion falls below base rate
  Probability: 38%
  Leading indicator: ACES or DataFlow go quiet before week 6
  Action: assign exec sponsor to both deals by April 15
  Monitor: weekly, every Monday briefing
  Alert threshold: either deal shows no exec engagement by week 4

FAILURE MODE 2: Mid-market pipeline burns off (fake pipeline)
  Probability: 24%  
  Leading indicator: week-6 to-go coverage burns >15% faster than Q1
  Action: pipeline scrub by April 10 — remove sub-standard opportunities now
  Monitor: weekly to-go coverage
  Alert threshold: burn rate exceeds Q1 average by >15%

FAILURE MODE 3: ACES stage divergence doesn't resolve
  Current: ACES in Discovery (CRM), behavioral signals = Late Evaluation
  If CRM stage doesn't advance by week 4: deal may be stalling, not progressing
  Action: stage advance or close-out conversation by April 20
  Monitor: ACES CRM stage update
  Alert threshold: no stage advance by April 20

UPSIDE SCENARIO: 4-of-5 large deals close
  P50 moves from $910K to $1,090K
  This is within 1 standard deviation of historical large deal variance
  Not heroic — achievable if current behavioral signals hold
```

Each failure mode becomes a standing hypothesis. Each standing hypothesis has a 
threshold and an alert date. Concierge monitors weekly and closes the loop.

### The pre-mortem as a skill

**ID:** `quarterly-pre-mortem`
**Schedule:** First Monday of each quarter (auto), on-demand
**Depends on:** `monte-carlo-forecast`, `gtm-health-diagnostic`, `pipeline-progression`, 
               `pipeline-conversion-rate`, `pipeline-coverage`
**Output:** slack (summary), command_center (full), standing hypotheses (persistent)

This skill does not re-query CRM data. It reads from the prior Monday's skill runs 
(Layer 1) and composes them into a forward-looking narrative. Zero CRM queries.
Token cost: ~6,000 (all from synthesis — compute is reading cached skill outputs).

**What it produces beyond the narrative:**

For each failure mode identified, it creates a `standing_hypothesis` record:

```typescript
interface StandingHypothesis {
  id: string,
  workspaceId: string,
  createdAt: string,
  source: 'pre_mortem' | 'stack_trace' | 'user_confirmed' | 'concierge_recommendation',
  hypothesis: string,                    // "Large deal conversion is the swing variable"
  metric: string,                        // "large_deal_expected_closes"
  currentValue: number,                  // 2.9
  alertThreshold: number,                // 2.5
  alertDirection: 'below' | 'above',
  reviewDate: string,                    // 8 weeks out
  status: 'active' | 'resolved' | 'refuted' | 'expired',
  linkedInterventionId: string | null,   // if a crumb trail connects to an intervention
  weeklyValues: { weekOf: string, value: number }[],
}
```

These are stored in a `standing_hypotheses` table and monitored by the Monday 
briefing skill. When a threshold trips, Concierge alerts immediately.

---

## The Unified Loop in Practice

### Monday morning (automated)

```
6:00 AM  monte-carlo-forecast runs → updates P10/P50/P90, variance drivers
8:00 AM  pipeline-coverage, pipeline-progression, pipeline-conversion-rate run
8:05 AM  forecast-rollup runs (reads Monday skill outputs)
8:10 AM  gtm-health-diagnostic runs (reads forecast-rollup + pipeline-coverage)
8:15 AM  quarterly-pre-mortem runs if Q1 of quarter, or standing hypothesis monitor runs
8:20 AM  Concierge Slack briefing delivered
```

The briefing leads with the composition hypothesis Pandora derived from the data:

```
Good morning. Here's where Q2 stands.

You're tracking to $910K (P50) — 76% of quota. The quarter is won or lost on 
your 5 large deals. You need approximately 3 to close at historical rate; 
behavioral signals currently suggest 3.1 expected.

ACES Corp ($240K) is the highest-confidence large deal — engagement signals 
suggest it's further along than its Discovery stage implies. Expected value 
adjusted to $108K vs. the $24K its CRM stage would suggest.

GlobalPay has been quiet for 18 days. That's your highest risk in the large 
cohort. At 2-of-5 instead of 3-of-5, P50 drops to $780K.

Standing hypothesis from last week: discovery framework change (March 15) — 
exec sponsor fill rate is up 27 points. Too early to measure win rate impact.
Check back in 4 weeks.

Two things to do this week:
  1. Re-engage GlobalPay — exec-level outreach before Thursday
  2. Advance ACES to Evaluation in HubSpot — the deal is already there behaviorally
```

### When something breaks mid-week (automated alert)

Stack trace fires when a metric breaks from its pattern between scheduled runs. 
Concierge DMs immediately:

```
⚠️ Signal detected: GlobalPay engagement dropped to zero (last activity: 21 days ago)

Stack trace:
  Win rate risk: -0.2 expected closes from large cohort (2.9 → 2.7)
  P50 impact: $910K → $870K if GlobalPay is lost
  
  Root cause trace:
    No stakeholder activity in 21 days
    Champion (Sarah Chen, VP Ops) last seen on March 8 call
    No exec sponsor on record
    Deal has been in Proposal for 34 days (avg: 18 days)
  
  Behavioral stage: regressing toward Evaluation

All else equal: GlobalPay closing = +$60K to P50
All else equal: GlobalPay lost = -$96K (deal + foregone pipeline slot)

Recommended action: Executive outreach to GlobalPay this week.
Is this on your radar, or would you like me to flag it for the team?
```

The user responds: "Yes, I'm aware — legal review is holding it up." 

That response is a soft intervention timestamp. Pandora records: *GlobalPay is in 
legal review as of March 15*. Adjusts close probability upward slightly (legal review 
is a normal delay, not a loss signal). Removes the alert for 2 weeks.

If the user says "good idea, we'll do executive outreach" — that's a crumb trail 
start. Pandora follows up in 2 weeks: "You mentioned executive outreach to GlobalPay 
— has that happened? Here's where the engagement signals stand."

---

## Skill Architecture Summary

### Existing skills (already built)

| Skill | Role in loop |
|---|---|
| `monte-carlo-forecast` | Simulation — P10/P50/P90 distribution |
| `pipeline-coverage` | Stack trace layer 1 — coverage adequacy |
| `forecast-rollup` | Stack trace layer 2 — forecast composition |
| `pipeline-waterfall` | Stack trace layer 3 — funnel flow |
| `rep-scorecard` | Stack trace layer 4 — rep-level signals |
| `pipeline-hygiene` | Stack trace layer 5 — data quality / fake pipeline |
| `deal-risk-review` | Stack trace layer 5 — individual deal signals |
| `stage-divergence` | Behavioral correction input |

### New skills required

| Skill | Role in loop |
|---|---|
| `pipeline-progression` | Q0/Q+1/Q+2 coverage trend |
| `pipeline-conversion-rate` | Week-3 conversion vs. win rate |
| `gtm-health-diagnostic` | Coverage vs. conversion verdict |
| `quarterly-pre-mortem` | Forward simulation + failure mode identification |
| `all-else-equal` | Single-variable sensitivity analysis |

### New infrastructure required

| Component | Purpose |
|---|---|
| `standing_hypotheses` table | Persist hypotheses with thresholds + weekly tracking |
| `intervention_log` table | Timestamp GTM changes (auto-detected + user-confirmed) |
| `deal_field_history` table | Retroactive accuracy bootstrap (field history backfill) |
| `forecast_accuracy_log` table | Track which forecast method is most accurate per workspace |
| `behavioral-stage-correction` compute function | Wire stage divergence into forecast bearings |
| `all-else-equal` compute function | Single-variable Monte Carlo perturbation |

### Enhancements to existing skills

| Skill | Enhancement |
|---|---|
| `forecast-rollup` | 6th bearing: behavioral-adjusted EV |
| `forecast-rollup` | Triangulation across all 6 bearings with divergence footnotes |
| `monte-carlo-forecast` | Portfolio composition hypothesis (auto-derived) |
| `monte-carlo-forecast` | All-else-equal action menu alongside P50 |
| `pipeline-coverage` | To-go burn + fake pipeline detection |

---

## Implementation Sequencing

**Phase 0 — Foundation (enables retroactive accuracy and behavioral correction):**
1. Extend HubSpot field history backfill (`forecastcategory`, `amount`, `closedate`)
2. Create `deal_field_history` table + populate via extended backfill
3. Create `forecast_accuracy_log` table + retro bootstrap job
4. Create `standing_hypotheses` table + `intervention_log` table
5. Build `behavioral-stage-correction` compute function

**Phase 1 — Core Kellblog skills (highest ROI):**
6. `pipeline-conversion-rate` skill
7. Win rate shared compute function (narrow/broad)
8. To-go coverage + fake pipeline enhancement to `pipeline-coverage`
9. Triangulation forecast + 6th bearing in `forecast-rollup`
10. `gtm-health-diagnostic` skill

**Phase 2 — Simulation layer:**
11. `all-else-equal` compute function + action menu in `monte-carlo-forecast`
12. Portfolio composition hypothesis in `monte-carlo-forecast` (auto-derived)
13. `pipeline-progression` skill

**Phase 3 — The loop closes:**
14. `quarterly-pre-mortem` skill
15. Standing hypothesis monitoring wired into Monday briefing
16. Crumb trail detection in Concierge (affirmation language → intervention timestamp)
17. Document ingestion for intervention detection (rules of engagement, process maps)

**Phase 4 — Accuracy and calibration:**
18. Methodology comparison footnotes + accuracy dashboard
19. Forecast accuracy ranking per workspace (which bearing to weight most)
20. Workspace calibration — synthesis prompts weight bearings by historical accuracy

---

## The North Star

A RevOps leader opens Pandora on Monday morning. They didn't ask any questions. 
They didn't supply any hypotheses. They didn't configure any dashboards.

Pandora tells them:

- Where the quarter is likely to land, and how confident to be
- Which specific variable determines whether they hit or miss
- Which deals are behaviorally ahead or behind their CRM stage
- What they should do this week, in priority order, with the expected value of each action
- What they said they were working on last month, and whether it's working

None of that required the human to supply intuition. All of it was derived from 
data already in the system.

The human reads it, corrects what's wrong ("GlobalPay is in legal, not stalling"), 
confirms what's right ("yes, the big deals are the swing variable"), and decides 
what to do.

Pandora is the author. The human is the editor.

---

*This document synthesizes: Kellblog pipeline methodology (Dave Kellogg), 
Monte Carlo simulation architecture (PANDORA_MONTE_CARLO_BUILD_PROMPT.md), 
Kellblog skill specs (PANDORA_KELLBLOG_SKILL_SPECS.md), and the GTM 
Intelligence Loop design session.*

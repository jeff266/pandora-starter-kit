# Claude Code Prompt: Pandora Voice & Tone — Prompt Refinement + Workspace Voice Config

## Context

Pandora's skill outputs use dramatic, alarmist language that undermines trust with VP-level buyers. A recent Single-Thread Alert said "catastrophic concentration risk" and "if any single contact leaves, ghosts, or loses internal influence, the deal dies." At 82% single-threading (normal for many orgs), this reads as panic, not analysis.

This prompt does two things:
1. **Rewrites synthesis prompts** across all skills to follow a consistent, professional tone
2. **Adds a `voice` config section** to workspace config so customers can tune detail level, framing, and alert thresholds

Before starting:
1. Read every file in `server/skills/library/` — understand each skill's synthesis prompt
2. Read `server/config/workspace-config-loader.ts` — how skills access config
3. Read `server/types/workspace-config.ts` — the WorkspaceConfig schema
4. Read `server/config/defaults.ts` — the default config factory
5. Read the skill runtime (`server/skills/runtime.ts`) — how synthesis prompts are assembled and sent to Claude
6. Read the Slack formatter (`server/skills/formatters/slack-formatter.ts`) — how skill output becomes Slack messages

## Part 1: Workspace Voice Config

### 1A: Add Voice Section to WorkspaceConfig

In `server/types/workspace-config.ts`, add to the WorkspaceConfig interface:

```typescript
interface VoiceConfig {
  /**
   * Controls how much detail skill outputs include.
   * - concise: 1-2 short paragraphs, top 3 deals max, no breakdowns.
   *   Best for: founders, small teams, mobile readers.
   * - standard: 2-3 paragraphs, top 5 deals, stage breakdown if notable.
   *   Best for: most RevOps teams. This is the default.
   * - detailed: 3-4 paragraphs, top 5 deals with full context, 
   *   stage + rep breakdowns, trend comparison.
   *   Best for: VP RevOps at 100+ person orgs, board prep.
   */
  detail_level: 'concise' | 'standard' | 'detailed';
  
  /**
   * Controls how bluntly findings are stated.
   * - direct: "Sara is 40% behind quota with 1.2x coverage."
   *   States facts without softening.
   * - balanced: "Sara's pipeline may need attention — 1.2x coverage 
   *   puts her at risk of missing quota."
   *   States facts with context. This is the default.
   * - diplomatic: "Sara has an opportunity to strengthen her pipeline — 
   *   adding 2-3 qualified deals would improve her coverage from 1.2x 
   *   toward the 3x target."
   *   Frames gaps as growth opportunities.
   */
  framing: 'direct' | 'balanced' | 'diplomatic';
  
  /**
   * Controls which severity tier triggers a Slack message.
   * - all: every skill run posts to Slack, even if nothing changed.
   * - watch_and_act: only posts when there's a Watch or Act finding.
   *   This is the default.
   * - act_only: only posts when specific deals need intervention this week.
   *   Best for: teams drowning in alerts.
   */
  alert_threshold: 'all' | 'watch_and_act' | 'act_only';
}
```

Add `voice: VoiceConfig;` to the WorkspaceConfig interface, alongside the existing sections (pipelines, win_rate, teams, etc.).

### 1B: Add Defaults

In `server/config/defaults.ts`, add to the `getDefaultConfig` return:

```typescript
voice: {
  detail_level: 'standard',
  framing: 'balanced',
  alert_threshold: 'watch_and_act',
},
```

### 1C: Add configLoader Convenience Method

In `server/config/workspace-config-loader.ts`, add:

```typescript
/**
 * Get voice configuration for synthesis prompts.
 * Returns the voice settings + a pre-formatted prompt block 
 * that can be injected directly into any synthesis prompt.
 */
async getVoiceConfig(workspaceId: string): Promise<{
  detail_level: string;
  framing: string;
  alert_threshold: string;
  promptBlock: string;
}> {
  const config = await this.getConfig(workspaceId);
  const voice = config.voice || {
    detail_level: 'standard',
    framing: 'balanced', 
    alert_threshold: 'watch_and_act',
  };
  
  return {
    ...voice,
    promptBlock: buildVoicePromptBlock(voice),
  };
}
```

### 1D: Voice Prompt Block Builder

Create `server/config/voice-prompt-block.ts`:

This is the key piece — it translates the three config settings into prompt instructions that get injected into every Claude synthesis call.

```typescript
import { VoiceConfig } from '../types/workspace-config';

export function buildVoicePromptBlock(voice: VoiceConfig): string {
  const sections: string[] = [];
  
  // --- Detail level ---
  const detailRules: Record<string, string> = {
    concise: `DETAIL LEVEL: Concise.
- Maximum 150 words total
- Top 3 items only in any deal/rep list
- No stage breakdowns or rep pattern analysis
- Skip period comparison unless there's a dramatic swing (>15%)
- If nothing changed, one sentence: "[Topic] stable, no action needed."`,
    
    standard: `DETAIL LEVEL: Standard.
- Maximum 350 words total
- Top 5 items in any deal/rep list
- Include stage breakdown only if it reveals something actionable
- Include period comparison (up/down/stable from last run)
- If nothing changed, 2-3 sentences and stop`,
    
    detailed: `DETAIL LEVEL: Detailed.
- Maximum 500 words total
- Top 5 items with full context (contact names, days in stage, last activity)
- Include stage and rep breakdowns
- Include period comparison with specific deltas
- Include trend direction (improving/worsening/stable over last 3 runs if available)
- Still omit sections where there's nothing notable`,
  };
  sections.push(detailRules[voice.detail_level] || detailRules.standard);
  
  // --- Framing ---
  const framingRules: Record<string, string> = {
    direct: `FRAMING: Direct.
- State findings as facts: "Sara is 40% behind quota" not "Sara may want to consider..."
- Use specific numbers without hedging
- Name individuals when relevant
- Keep recommendations concrete: "Do X by Friday" not "Consider doing X"`,
    
    balanced: `FRAMING: Balanced.
- State findings as facts with context: "Sara's 1.2x coverage is below the 3x target, 
  putting her at risk of missing quota"
- Include both the metric and what it means
- Recommendations should be specific but framed constructively
- When discussing rep performance, pair gaps with what's working`,
    
    diplomatic: `FRAMING: Diplomatic.
- Frame gaps as opportunities: "Sara has room to strengthen her pipeline — 
  adding 2-3 qualified deals would improve coverage toward the 3x target"
- Lead with positive trends when they exist before mentioning gaps
- Recommendations should emphasize growth and improvement
- Avoid naming individuals in negative contexts — use "one rep" or "the team"
  unless there's a specific, actionable recommendation for that person`,
  };
  sections.push(framingRules[voice.framing] || framingRules.balanced);
  
  // --- Global tone rules (always applied, not configurable) ---
  sections.push(`TONE RULES (always apply):
- You are a senior RevOps analyst, not a fire alarm
- State facts and numbers. Do not add severity adjectives like "critical," 
  "catastrophic," "alarming," or "concerning" unless something genuinely 
  changed >20% since last period
- Frame findings as opportunities or observations, not threats or doom
- When comparing to last period: "up from X" or "down from X" — let the 
  reader judge severity
- Maximum one emoji in the entire message (skill header icon only)
- Do not use ALL CAPS for any header or label in body text
- Do not define terms the reader already knows (e.g., don't explain 
  what single-threading means)
- A short report means things are stable. That's good. Don't pad.
- Every recommendation must answer "what do I do this week?" not 
  "what should I be scared of?"

SEVERITY LANGUAGE:
- Use "Notable" for metrics that changed and are worth mentioning
- Use "Worth watching" for trends forming or thresholds approaching  
- Use "Action needed" for specific deals/reps that need intervention this week
- NEVER use: CRITICAL, CATASTROPHIC, URGENT, ALERT, "ticking time bomb," 
  "the deal dies," "alarm," "red flag" in body text

FORMATTING FOR SLACK:
- Start with a bold one-line summary, no emoji
- Use **bold** for section breaks, not ALL CAPS or emoji headers
- No emoji-decorated bullet points (no 📊 🔴 ⚠️ as list markers)
- Deal lists use plain bullets with bold deal name
- Keep the visual hierarchy clean: summary → context → focus deals → recommendation`);
  
  return sections.join('\n\n');
}
```

### 1E: Config API — Add Voice to PATCH

In the workspace config routes (wherever `PATCH /api/workspaces/:id/config/:section` is handled), add `voice` as a valid section. Validation:

```typescript
// Voice config validation
if (section === 'voice') {
  const valid_detail = ['concise', 'standard', 'detailed'];
  const valid_framing = ['direct', 'balanced', 'diplomatic'];
  const valid_threshold = ['all', 'watch_and_act', 'act_only'];
  
  if (body.detail_level && !valid_detail.includes(body.detail_level)) {
    return res.status(400).json({ error: 'detail_level must be concise, standard, or detailed' });
  }
  if (body.framing && !valid_framing.includes(body.framing)) {
    return res.status(400).json({ error: 'framing must be direct, balanced, or diplomatic' });
  }
  if (body.alert_threshold && !valid_threshold.includes(body.alert_threshold)) {
    return res.status(400).json({ error: 'alert_threshold must be all, watch_and_act, or act_only' });
  }
}
```

---

## Part 2: Inject Voice Block into Every Skill

This is the critical wiring step. Every skill's Claude synthesis step must include the voice prompt block.

### 2A: Find the Synthesis Prompt Assembly Point

Search the codebase for where Claude synthesis prompts are built. This is likely in one of:
- `server/skills/runtime.ts` — the main skill runtime
- Each skill's definition file in `server/skills/library/`
- A shared prompt builder utility

There are two possible architectures:

**Architecture A: Centralized (runtime builds the prompt)**
If the runtime assembles the prompt from skill definition + context + data summaries, inject the voice block in the runtime:

```typescript
// In the runtime, when building the Claude synthesis prompt:
const voiceConfig = await configLoader.getVoiceConfig(workspaceId);

const systemPrompt = [
  skill.synthesisPrompt,        // skill-specific instructions
  voiceConfig.promptBlock,       // voice configuration (tone, detail, framing)
  assumptions.formatForSynthesis(), // config confidence caveats
].filter(Boolean).join('\n\n');
```

**Architecture B: Decentralized (each skill builds its own prompt)**
If each skill file contains a complete synthesis prompt string, you need to modify each skill. In this case, add a placeholder that the runtime replaces:

In each skill's synthesis prompt, add at the end:
```
{{voiceBlock}}
```

In the runtime, before sending to Claude:
```typescript
const voiceConfig = await configLoader.getVoiceConfig(workspaceId);
const prompt = skill.synthesisPrompt.replace('{{voiceBlock}}', voiceConfig.promptBlock);
```

**Determine which architecture is in use, then apply the voice block accordingly.** The goal is ONE injection point, not 17 copy-pastes.

### 2B: Wire Alert Threshold to Slack Delivery

The `alert_threshold` setting controls whether a skill run's output gets posted to Slack. Wire this into the Slack delivery step:

```typescript
// After skill synthesis completes, before posting to Slack:
const voiceConfig = await configLoader.getVoiceConfig(workspaceId);

// Determine if this run has findings worth alerting
const severity = determineSeverity(skillOutput);
// severity is one of: 'none', 'notable', 'watch', 'act'

const shouldPost = shouldPostToSlack(voiceConfig.alert_threshold, severity);

function shouldPostToSlack(threshold: string, severity: string): boolean {
  if (threshold === 'all') return true;
  if (threshold === 'watch_and_act') return severity === 'watch' || severity === 'act';
  if (threshold === 'act_only') return severity === 'act';
  return true; // default to posting
}

// determineSeverity needs to read the skill output and classify:
function determineSeverity(output: SkillOutput): string {
  // If skill output includes structured findings with severity levels,
  // return the highest severity found.
  // If skill output is narrative only, look for signals:
  //   - Any deal-specific recommendations = 'act'
  //   - Trend changes or threshold breaches = 'watch'
  //   - Stable metrics, nothing new = 'notable' or 'none'
  
  // Best approach: each skill's compute step should output a 
  // top_severity field in its result. Check if this exists.
  // If not, default to 'watch' (always post for now, until 
  // skills are updated to include severity).
  
  if (output.top_severity) return output.top_severity;
  return 'watch'; // safe default — post unless explicitly nothing
}
```

**Important:** Don't gate Slack delivery on alert_threshold until skills reliably output a `top_severity` field. For the initial build, log what the threshold decision WOULD be, but still post. Once you verify the severity classification is accurate across a few runs, flip the gate on.

---

## Part 3: Rewrite Skill Synthesis Prompts

Now rewrite each skill's synthesis prompt to remove alarmist language and work with the voice block. The voice block handles tone/detail/framing — each skill's prompt should focus on WHAT to analyze, not HOW to say it.

### 3A: Single-Thread Alert (Highest Priority)

Replace the existing synthesis prompt entirely:

```
You are a senior RevOps analyst delivering a single-threading report 
for {{companyName}}.

THREADING DATA:
{{computeSummaries}}

DEAL CLASSIFICATIONS:
{{deepseekClassifications}}

{{#if previousRunData}}
PREVIOUS REPORT ({{previousRunData.date}}):
- Single-threaded: {{previousRunData.singleThreadedPct}}% 
  ({{previousRunData.singleThreadedCount}} deals, ${{previousRunData.singleThreadedValue}})
{{/if}}

{{#if configAssumptions}}
CONFIG NOTES:
{{configAssumptions}}
{{/if}}

STRUCTURE YOUR REPORT:
1. Opening line: single-threading rate, dollar exposure, and trend vs 
   last period (better/worse/stable). One sentence.
2. Where risk concentrates: which stages have the most single-threaded 
   value. Early-stage (Discovery, Qualification) single-threading is 
   normal — mention briefly. Late-stage (Proposal, Negotiation) is 
   where action has the highest ROI.
3. Focus deals: highest-value late-stage single-threaded deals. For 
   each: deal name, amount, stage, single contact's name and title, 
   days in stage.
4. Rep pattern (only if notable): if one rep is significantly different 
   from team average, mention it. If it's consistent across reps, note 
   it's a process pattern, not individual.
5. One recommended action for this week. Be specific.

WHAT TO OMIT:
- Pipeline composition breakdown (single/double/multi counts) unless 
  it changed meaningfully since last report
- Deals in Discovery or Qualification unless they're >2x average deal size
- The same number stated in different formats
- Data freshness disclaimers unless data is actually >7 days old

{{voiceBlock}}
```

Also add the `risk_weight` computation to the Single-Thread Alert's compute step:

```typescript
/**
 * Add risk_weight to each single-threaded deal for prioritization.
 * Late-stage + high-value + long time in stage = highest weight.
 * This ensures Claude focuses on deals where adding a contact 
 * has the highest impact, not just the biggest dollar amounts.
 */
function calculateRiskWeight(
  deal: ThreadedDeal, 
  averageDealSize: number
): number {
  let weight = 0;
  
  // Stage weight: late stage = higher urgency
  const stageWeights: Record<string, number> = {
    'discovery': 5,
    'qualification': 10,
    'evaluation': 20,
    'proposal': 40,
    'negotiation': 60,
    'verbal_commit': 50,
  };
  weight += stageWeights[deal.stage_normalized] || 10;
  
  // Amount weight: normalize to 0-25 based on position in pipeline
  weight += Math.min(25, (deal.amount / Math.max(averageDealSize, 1)) * 10);
  
  // Time in stage: longer = more urgent
  if (deal.days_in_stage > 30) weight += 10;
  if (deal.days_in_stage > 60) weight += 5;
  
  return Math.min(100, weight);
}

// Apply to criticalDeals/warningDeals arrays before passing to synthesis:
deals.sort((a, b) => b.risk_weight - a.risk_weight);
```

### 3B: Pipeline Hygiene

Find and replace the synthesis prompt. Key changes:
- Remove any "CRITICAL" or "ALERT" labels from the prompt template
- Replace "stale deals are a problem" framing with "these deals haven't had activity in X days"
- Add voice block placeholder
- Add previous run comparison if available

```
You are a senior RevOps analyst delivering a pipeline hygiene report 
for {{companyName}}.

PIPELINE DATA:
{{computeSummaries}}

STALE DEAL CLASSIFICATIONS:
{{deepseekClassifications}}

{{#if previousRunData}}
PREVIOUS REPORT ({{previousRunData.date}}):
- Total pipeline: ${{previousRunData.totalPipeline}}
- Stale deals: {{previousRunData.staleCount}} (${{previousRunData.staleValue}})
{{/if}}

STRUCTURE YOUR REPORT:
1. Pipeline snapshot: total open pipeline, deal count, and how it 
   compares to last period.
2. Activity gaps: deals with no activity beyond the configured 
   threshold. Group by stage — late-stage inactivity matters more 
   than early-stage.
3. Focus deals: the deals where re-engagement or cleanup would have 
   the most impact this week. Include deal name, amount, stage, owner, 
   and days since last activity.
4. Data quality flags (only if notable): deals missing close dates, 
   amounts, or other required fields. Brief mention, not the main story.
5. One recommended action for pipeline cleanup this week.

{{voiceBlock}}
```

### 3C: Forecast Roll-up

Find and replace. Key changes:
- Remove "your forecast is wrong" framing
- Remove alarmist whale/concentration language
- Add voice block

```
You are a senior RevOps analyst delivering the Monday morning forecast 
briefing for {{companyName}}.

FORECAST DATA:
{{computeSummaries}}

RISK CLASSIFICATIONS:
{{deepseekClassifications}}

{{#if previousRunData}}
LAST WEEK ({{previousRunData.date}}):
- Commit: ${{previousRunData.commit}} → Actual closed: ${{previousRunData.closed}}
- Accuracy: {{previousRunData.accuracy}}%
{{/if}}

STRUCTURE YOUR REPORT:
1. Forecast summary: closed-won to date, commit pipeline, best case, 
   total open. Compare each to last week.
2. Category movement: deals that changed forecast category this week 
   (upgrades and downgrades). Only the meaningful ones.
3. Pacing: are we ahead or behind where we should be at this point 
   in the quarter? Simple math, no drama.
4. Concentration: if any single deal represents >20% of remaining 
   quota, note it factually. It's worth knowing, not worth panicking about.
5. Reps at risk: anyone pacing below 70% of their target with less 
   than adequate pipeline. Pair with what they'd need to close the gap.
6. Key deals to watch: the 3-5 deals whose outcomes will most affect 
   the quarter. Include amount, stage, forecast category, and next step.

{{voiceBlock}}
```

### 3D: Pipeline Coverage by Rep

Key changes:
- Remove leaderboard/ranking language
- Frame low coverage as coaching opportunity, not failure

```
You are a senior RevOps analyst delivering a pipeline coverage report 
for {{companyName}}.

COVERAGE DATA:
{{computeSummaries}}

{{#if previousRunData}}
PREVIOUS REPORT ({{previousRunData.date}}):
{{previousRunData.repSummary}}
{{/if}}

STRUCTURE YOUR REPORT:
1. Team coverage: overall pipeline-to-quota ratio and trend.
2. Per-rep coverage: each rep's coverage ratio, quota, and pipeline. 
   Start with reps who need attention, then confirm who's on track.
3. Gap analysis (only for reps below target): what would it take to 
   reach the coverage target? "Adding $X in qualified pipeline would 
   bring coverage to target."
4. One recommendation: is the gap a prospecting issue, a qualification 
   issue, or a data issue? Suggest the most likely lever.

Do NOT rank reps from best to worst. Group them: on-track vs needs-attention.

{{voiceBlock}}
```

### 3E: Data Quality Audit

Key changes:
- Remove "your CRM is a mess" undertones
- Frame as improvement opportunity with specific impact

```
You are a senior RevOps analyst delivering a data quality report 
for {{companyName}}.

QUALITY DATA:
{{computeSummaries}}

FIELD COMPLETENESS:
{{fieldCompleteness}}

{{#if previousRunData}}
PREVIOUS REPORT ({{previousRunData.date}}):
- Overall fill rate: {{previousRunData.overallFillRate}}%
{{/if}}

STRUCTURE YOUR REPORT:
1. Overall health: field completeness across required fields, trend 
   vs last period.
2. Highest-impact gaps: which missing fields affect downstream 
   analysis the most? (e.g., missing amounts make forecasting 
   impossible; missing close dates break pipeline views)
3. Quick wins: fields where a small number of updates would make 
   a big difference. "Updating amount on 12 deals adds $X to 
   forecastable pipeline."
4. One recommendation for this week.

Do NOT list every field with its fill rate. Focus on the 3-5 fields 
that matter most for revenue analysis.

{{voiceBlock}}
```

### 3F: Rep Scorecard

Key changes:
- MUST balance strengths with gaps
- Never feel like a performance review delivered by a robot

```
You are a senior RevOps analyst preparing rep performance insights 
for {{companyName}}.

REP DATA:
{{computeSummaries}}

COACHING CLASSIFICATIONS:
{{deepseekClassifications}}

STRUCTURE YOUR REPORT:
1. Team overview: 1-2 sentences on overall team performance.
2. Per-rep insights: for each rep, lead with what's working, then 
   identify one area for development. Every rep gets both a strength 
   and a growth area.
3. Coaching priorities: which 1-2 reps would benefit most from 
   focused coaching this week, and what specific behavior to address?
4. Team-level pattern: is there a common gap across multiple reps 
   that suggests a process or enablement fix rather than individual 
   coaching?

CRITICAL: This report may be shared with sales managers who then 
coach their reps. The framing must be constructive. A manager 
reading "Sara's pipeline is weak" will have a different conversation 
than one reading "Sara's strong qualification skills aren't yet 
matched by pipeline volume — a prospecting focus would leverage 
her high win rate."

{{voiceBlock}}
```

### 3G: Remaining Skills

For these skills, the changes are lighter — add `{{voiceBlock}}` and remove any ALL CAPS severity labels or doom language from the existing prompts:

- **Bowtie Review** — mostly metrics, lowest risk. Add voice block.
- **Attainment vs Goal** — add "trajectory" context (pacing, not just current number). Add voice block.
- **Friday Recap** — this is a summary of the week. Should feel like a wrap-up, not a warning. Add voice block.
- **Strategy & Insights** — Wednesday synthesis. Add voice block.
- **Pipeline State** — Monday morning snapshot. Add voice block.

For each of these: read the existing prompt, apply these rules:
1. Remove ALL CAPS labels (CRITICAL, ALERT, WARNING, etc.)
2. Remove doom language ("the deal dies", "catastrophic", "ticking time bomb")
3. Remove emoji headers (📊 EXECUTIVE SUMMARY)
4. Add `{{voiceBlock}}` at the end of the prompt
5. Verify the word budget aligns with voice config detail levels

---

## Part 4: Previous Run Comparison (Shared Utility)

Multiple skills need to compare to their previous run. Build a shared utility:

```typescript
// server/skills/utils/previous-run.ts

interface PreviousRunData {
  date: string;           // ISO date
  summary: any;           // skill-specific summary from output
  daysSinceLastRun: number;
}

/**
 * Load the previous completed run for a skill+workspace combination.
 * Returns null if this is the first run.
 */
async function getPreviousRun(
  workspaceId: string, 
  skillId: string
): Promise<PreviousRunData | null> {
  const result = await db.query(`
    SELECT output, created_at
    FROM skill_runs
    WHERE workspace_id = $1 
      AND skill_id = $2
      AND status = 'completed'
      AND output IS NOT NULL
    ORDER BY created_at DESC
    OFFSET 1 LIMIT 1
  `, [workspaceId, skillId]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  const output = typeof row.output === 'string' 
    ? JSON.parse(row.output) 
    : row.output;
  
  return {
    date: row.created_at,
    summary: output.summary || output,
    daysSinceLastRun: Math.floor(
      (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)
    ),
  };
}

export { getPreviousRun, PreviousRunData };
```

Wire into each skill's compute step. Each skill decides what fields from the previous run to pass to synthesis — the shared utility just handles the query.

---

## Part 5: Skill Output Severity Classification

Each skill's compute step should output a `top_severity` field so the alert threshold can gate Slack delivery.

```typescript
// server/skills/utils/severity.ts

type Severity = 'none' | 'notable' | 'watch' | 'act';

/**
 * Determine the top severity from skill findings.
 * Each skill's compute step should call this with its findings array.
 */
function classifyTopSeverity(findings: Array<{ severity?: string }>): Severity {
  if (findings.some(f => f.severity === 'act' || f.severity === 'critical')) return 'act';
  if (findings.some(f => f.severity === 'watch' || f.severity === 'warning')) return 'watch';
  if (findings.some(f => f.severity === 'notable' || f.severity === 'info')) return 'notable';
  return 'none';
}

/**
 * Simpler version: classify based on metric changes vs previous run.
 * Use when the skill doesn't have structured findings.
 */
function classifySeverityFromDelta(
  current: number, 
  previous: number | null, 
  threshold: { watch: number; act: number }
): Severity {
  if (previous === null) return 'notable'; // first run, worth mentioning
  
  const delta = Math.abs(current - previous) / Math.max(previous, 1);
  if (delta >= threshold.act) return 'act';
  if (delta >= threshold.watch) return 'watch';
  if (delta > 0.02) return 'notable';
  return 'none';
}

export { Severity, classifyTopSeverity, classifySeverityFromDelta };
```

Wire into each skill: after compute steps complete and before synthesis, set `output.top_severity`.

---

## Part 6: Test & Verify

After all changes:

### Test 1: Voice Config API

```bash
# Get current config — should include voice with defaults
GET /api/workspaces/:id/config

# Update voice settings
PATCH /api/workspaces/:id/config/voice
{ "detail_level": "concise", "framing": "direct" }

# Verify it persists
GET /api/workspaces/:id/config
# voice.detail_level should be "concise", voice.framing should be "direct"

# Test validation
PATCH /api/workspaces/:id/config/voice
{ "detail_level": "verbose" }
# Should return 400
```

### Test 2: Single-Thread Alert Output Quality

Run the Single-Thread Alert against the Imubit workspace (Salesforce) and verify:

| Check | Pass Criteria |
|---|---|
| No ALL CAPS in body | Zero instances of CRITICAL, CATASTROPHIC, ALERT |
| No doom language | Zero instances of "deal dies," "ticking time bomb," "catastrophic" |
| Emoji count | ≤ 1 emoji in entire message |
| Word count (standard) | ≤ 350 words |
| Period comparison | References previous run's metrics (or says "first run") |
| Focus deals are late-stage | Top deals are Proposal/Negotiation, not Discovery |
| Risk-weighted ordering | Deals sorted by risk_weight, not just amount |
| Actionable recommendation | Final paragraph includes specific next step |
| No definitions | Does not explain what single-threading means |

### Test 3: Voice Config Affects Output

Run the same skill three times with different voice configs:

1. `detail_level: concise` — output should be < 150 words
2. `detail_level: detailed` — output should be 300-500 words with breakdowns
3. `framing: direct` vs `framing: diplomatic` — same data, different phrasing

Verify the output actually changes. If it doesn't, the voice block isn't being injected or Claude is ignoring it.

### Test 4: Cross-Skill Consistency

Run Pipeline Hygiene, Forecast Roll-up, and Pipeline Coverage back to back. Verify:
- Same tone across all three (no skill sounds dramatically different)
- No ALL CAPS or doom language in any of them
- Word budgets are respected
- Each starts with a one-line bold summary

### Test 5: Alert Threshold (logging only for now)

Set `alert_threshold: act_only`. Run Single-Thread Alert. In the server logs, verify:
- The log shows "Alert threshold check: severity=watch, threshold=act_only, would_post=false"
- The message still posts to Slack (we're logging, not gating, for now)

---

## Implementation Notes

### What to do FIRST
1. Build Part 1 (voice config schema + defaults + configLoader method + prompt block builder)
2. Build Part 2A (find injection point, inject voice block centrally)
3. Rewrite Single-Thread Alert prompt (Part 3A) — this is the most visible fix
4. Test Single-Thread Alert against a real workspace

### What to do SECOND
5. Build Part 4 (previous run utility)
6. Rewrite Forecast Roll-up and Rep Scorecard prompts (3C, 3F)
7. Add voice block to remaining skills (3G)
8. Build Part 5 (severity classification)

### What to do THIRD
9. Wire alert threshold logging (Part 2B)
10. Test all skills end-to-end
11. After 1-2 weeks of severity logging, flip the gate on for Slack delivery

### What NOT to Build
- No "preview" mode showing different voice settings
- No per-skill voice overrides (global is enough)
- No free-text "custom instructions" field (prompt injection risk)
- No UI for voice config (API only for now — Command Center will add it later)
- No inference of voice preferences from CRM data

# Workspace Voice Patterns
## Claude Code Prompt

Read server/context/opening-brief.ts,
server/skills/formatters/slack-formatter.ts,
server/analysis/ (all files), and the conversations
table schema before writing any code.

Also read how internal_filter is applied to
conversations — understand the is_internal flag
and how it's currently used.

FOUR TASKS. Build in order. Report after each.

---

## CONTEXT

Pandora's synthesis voice is currently static —
every workspace gets identical tone and framing.
This task builds a system that:

1. Learns how each workspace actually talks by
   analyzing their internal calls (Gong/Fireflies)
2. Extracts stable language patterns monthly
3. Injects those patterns into synthesis prompts
4. Makes Pandora sound like it was written by
   the team — not by a generic AI analyst

The internal calls are already being filtered out
from external analysis via is_internal = true.
Instead of discarding them, we route them to
a voice intelligence pipeline.

---

## TASK 1 — Migration: workspace_voice_patterns table

Migration: [next number]_workspace_voice_patterns.sql

CREATE TABLE workspace_voice_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Extracted language patterns
  risk_phrases TEXT[] DEFAULT '{}',
    -- e.g. ["gone quiet", "I'm nervous about", "hasn't moved"]
  urgency_phrases TEXT[] DEFAULT '{}',
    -- e.g. ["needs to close this week", "get in front of them"]
  win_phrases TEXT[] DEFAULT '{}',
    -- e.g. ["crossed the line", "locked it in", "got it done"]
  pipeline_vocabulary TEXT[] DEFAULT '{}',
    -- domain-specific terms they use: ["deployment", "rollout", "go-live"]
  common_shorthand JSONB DEFAULT '{}',
    -- { "ACS situation": "ACS Corp deal", "the fellowship": "Fellowship program" }

  -- Coverage metadata
  calls_analyzed INTEGER DEFAULT 0,
  internal_calls_found INTEGER DEFAULT 0,
  analysis_window_days INTEGER DEFAULT 90,

  -- Voice config (Level 1 — static settings)
  tone TEXT DEFAULT 'direct'
    CHECK (tone IN ('direct', 'consultative', 'coaching')),
  detail_level TEXT DEFAULT 'operational'
    CHECK (detail_level IN ('executive', 'operational', 'detailed')),
  framing_style TEXT DEFAULT 'number_first'
    CHECK (framing_style IN (
      'number_first', 'narrative_first', 'risk_first'
    )),
  sales_motion TEXT DEFAULT 'mixed'
    CHECK (sales_motion IN (
      'high_velocity', 'enterprise', 'mixed'
    )),
  coverage_target NUMERIC DEFAULT 3.0,
    -- workspace-specific, not always 3x

  -- Lifecycle
  extraction_status TEXT DEFAULT 'pending'
    CHECK (extraction_status IN (
      'pending', 'running', 'complete', 'insufficient_data'
    )),
  last_extracted_at TIMESTAMPTZ,
  next_extraction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id)  -- one voice profile per workspace
);

CREATE INDEX idx_voice_patterns_workspace
  ON workspace_voice_patterns(workspace_id);

-- Seed a default row for every existing workspace
INSERT INTO workspace_voice_patterns (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

---

## TASK 2 — Voice Pattern Extraction

Create server/analysis/voice-patterns.ts

### 2a. extractInternalCallLanguage()

  export async function extractInternalCallLanguage(
    workspaceId: string,
    windowDays: number = 90
  ): Promise<InternalCallLanguage>

  Queries conversations WHERE:
    workspace_id = $1
    AND is_internal = true
    AND call_date >= NOW() - INTERVAL '$2 days'
    AND transcript_text IS NOT NULL
    AND LENGTH(transcript_text) > 200

  If fewer than 5 conversations found:
    Return { insufficient: true, callsFound: n }

  For each conversation, extract from transcript_text:

  SELECT
    id,
    title,
    transcript_text,
    participants,
    call_date
  FROM conversations
  WHERE workspace_id = $1
    AND is_internal = true
    AND call_date >= NOW() - INTERVAL '90 days'
    AND transcript_text IS NOT NULL
  ORDER BY call_date DESC
  LIMIT 50;  -- cap at 50 calls for token budget

  Return shape:
  {
    insufficient: false,
    callsFound: number,
    transcripts: Array<{
      id: string,
      title: string,
      text: string,
      date: Date
    }>
  }

### 2b. classifyVoicePatterns() — DeepSeek call

  export async function classifyVoicePatterns(
    transcripts: TranscriptSample[],
    workspaceId: string
  ): Promise<VoicePatternClassification>

  Sends transcript excerpts to DeepSeek for
  pattern classification. NOT Claude — this is
  pure classification, not synthesis.

  Input preparation:
    Concatenate first 500 chars of each transcript
    Total input: max 8,000 tokens
    If over limit: use most recent 20 transcripts

  DeepSeek prompt:
  """
  Analyze these internal sales team call excerpts.
  Extract the specific language patterns this team
  uses. Focus on:

  1. How they describe deals that are at risk or
     going cold (risk_phrases)
  2. How they express urgency or time pressure
     (urgency_phrases)
  3. How they describe wins or positive momentum
     (win_phrases)
  4. Domain-specific vocabulary they use for their
     product or process (pipeline_vocabulary)
  5. Shorthand or nicknames they use for specific
     deals, accounts, or concepts (common_shorthand)

  Return ONLY valid JSON in this exact shape:
  {
    "risk_phrases": ["phrase1", "phrase2"],
    "urgency_phrases": ["phrase1", "phrase2"],
    "win_phrases": ["phrase1", "phrase2"],
    "pipeline_vocabulary": ["term1", "term2"],
    "common_shorthand": { "shorthand": "what it means" },
    "confidence": 0.0-1.0
  }

  Rules:
  - Only include phrases that appear multiple times
    across different calls (not one-off language)
  - Maximum 10 items per array
  - Maximum 10 entries in common_shorthand
  - Do not include generic business language
    ("pipeline", "close", "deal") — only
    distinctive vocabulary specific to this team
  - If insufficient distinctive patterns found,
    return empty arrays rather than generic phrases
  """

  Parse the JSON response.
  If parse fails: return empty pattern set, log warning.
  If confidence < 0.5: flag as low_confidence.

### 2c. updateWorkspaceVoicePatterns()

  export async function updateWorkspaceVoicePatterns(
    workspaceId: string,
    patterns: VoicePatternClassification,
    callsAnalyzed: number
  ): Promise<void>

  Upserts into workspace_voice_patterns:

  INSERT INTO workspace_voice_patterns (
    workspace_id,
    risk_phrases,
    urgency_phrases,
    win_phrases,
    pipeline_vocabulary,
    common_shorthand,
    calls_analyzed,
    extraction_status,
    last_extracted_at,
    next_extraction_at,
    updated_at
  ) VALUES (...)
  ON CONFLICT (workspace_id) DO UPDATE SET
    risk_phrases = EXCLUDED.risk_phrases,
    urgency_phrases = EXCLUDED.urgency_phrases,
    win_phrases = EXCLUDED.win_phrases,
    pipeline_vocabulary = EXCLUDED.pipeline_vocabulary,
    common_shorthand = EXCLUDED.common_shorthand,
    calls_analyzed = EXCLUDED.calls_analyzed,
    extraction_status = EXCLUDED.extraction_status,
    last_extracted_at = EXCLUDED.last_extracted_at,
    next_extraction_at = EXCLUDED.next_extraction_at,
    updated_at = NOW();

  next_extraction_at = NOW() + INTERVAL '30 days'

---

## TASK 3 — Voice Pattern Skill

Create server/skills/library/voice-pattern-extraction.ts

Skill definition:
  id: 'voice-pattern-extraction'
  category: 'intelligence'
  schedule: { cron: '0 6 1 * *' }
    -- 6 AM on the 1st of each month
  output: ['skill_runs']
    -- internal only, no Slack push

Three steps:

Step 1 — extract-internal-calls (COMPUTE)
  Calls extractInternalCallLanguage(workspaceId)
  If insufficient: set result to
    { status: 'insufficient_data',
      message: 'Fewer than 5 internal calls found
      in the last 90 days. Connect Gong or Fireflies
      and ensure internal_filter is configured.' }
  Mark skill run as 'completed' not 'failed' —
  insufficient data is expected for new workspaces.

Step 2 — classify-patterns (DEEPSEEK)
  Calls classifyVoicePatterns(transcripts, workspaceId)
  If classification fails: log and continue with
  empty patterns — never fail the skill run.

Step 3 — update-voice-profile (COMPUTE)
  Calls updateWorkspaceVoicePatterns()
  Returns summary:
  {
    callsAnalyzed: number,
    patternsExtracted: {
      riskPhrases: number,
      urgencyPhrases: number,
      winPhrases: number,
      vocabulary: number,
      shorthand: number
    },
    confidence: number,
    nextRunAt: Date
  }

Register in skill registry.
Add to monthly cron alongside existing schedules.

---

## TASK 4 — Inject Voice Patterns into Synthesis

### 4a. loadWorkspaceVoice()

Create or add to server/context/brief-priorities.ts:

  export async function loadWorkspaceVoice(
    workspaceId: string
  ): Promise<WorkspaceVoice>

  SELECT
    tone,
    detail_level,
    framing_style,
    sales_motion,
    coverage_target,
    risk_phrases,
    urgency_phrases,
    win_phrases,
    pipeline_vocabulary,
    common_shorthand,
    calls_analyzed,
    last_extracted_at
  FROM workspace_voice_patterns
  WHERE workspace_id = $1;

  If no row: return defaults:
  {
    tone: 'direct',
    detailLevel: 'operational',
    framingStyle: 'number_first',
    salesMotion: 'mixed',
    coverageTarget: 3.0,
    riskPhrases: [],
    urgencyPhrases: [],
    winPhrases: [],
    pipelineVocabulary: [],
    commonShorthand: {},
    hasLearnedPatterns: false
  }

  hasLearnedPatterns = calls_analyzed > 0
    AND risk_phrases.length > 0

### 4b. renderVoiceContext()

  export function renderVoiceContext(
    voice: WorkspaceVoice
  ): string

  Returns a string block for injection into
  the synthesis prompt. Only include non-empty
  sections.

  Template:
  """
  WORKSPACE VOICE PROFILE:
  Tone: {tone} — {toneDescription}
  Detail level: {detailLevel} — {detailDescription}
  Coverage target: {coverageTarget}× (workspace-specific)
  Sales motion: {salesMotion}
  {learnedPatternsBlock if hasLearnedPatterns}
  """

  toneDescription mapping:
    direct → "state findings plainly, no hedging"
    consultative → "frame as recommendations with reasoning"
    coaching → "frame as development opportunities for reps"

  detailDescription mapping:
    executive → "one number, one sentence, one action"
    operational → "include reasoning chain and so-what"
    detailed → "include data behind findings, full context"

  learnedPatternsBlock (only if hasLearnedPatterns):
  """
  LEARNED LANGUAGE PATTERNS (from {callsAnalyzed} internal calls):
  {if risk_phrases} Risk language: {phrases joined with ", "}
  {if urgency_phrases} Urgency language: {phrases joined with ", "}
  {if win_phrases} Win language: {phrases joined with ", "}
  {if pipeline_vocabulary} Domain terms: {terms joined with ", "}
  {if common_shorthand} Shorthand: {key → value pairs}

  Mirror these patterns where natural. Do not force them.
  The brief should sound like this team wrote it.
  """

### 4c. Wire into assembleOpeningBrief()

In server/context/opening-brief.ts:

  1. Add call to loadWorkspaceVoice(workspaceId)
     alongside existing brief assembly queries.
     Use Promise.allSettled — voice loading failure
     must never break brief generation.

  2. Add voice to OpeningBriefData interface:
     workspaceVoice: WorkspaceVoice;

  3. In renderBriefContext(), add voice context block
     BEFORE the PRIORITY FRAME block:

     const voiceBlock = renderVoiceContext(voice);
     context += `\n${voiceBlock}\n`;

  4. Update BRIEF_SYSTEM_PROMPT — replace the current
     static voice rules section with:

     "VOICE: Follow the WORKSPACE VOICE PROFILE in the
     context. The coverage target, tone, and any learned
     language patterns override these defaults when present.

     Non-negotiable voice rules regardless of profile:
     - No fear language
     - Show your math — every number must be traceable
     - Name specific deals and amounts, never generics
     - No unfilled template variables"

  The voice profile is additive — it extends and
  personalizes the non-negotiable rules, never
  overrides them.

### 4d. Also wire into Slack formatter

In server/skills/formatters/slack-formatter.ts,
extend formatConciergeDaily() and formatSkillBrief()
to accept an optional voice parameter:

  formatConciergeDaily(input: {
    ...existing fields,
    voice?: WorkspaceVoice  // optional, use defaults if absent
  })

  Use voice.coverageTarget instead of hardcoded 3×:
    "target: ${voice?.coverageTarget ?? 3}×"

  Use voice.detailLevel to adjust output:
    executive → max 2 findings shown
    operational → max 3 findings (current default)
    detailed → max 5 findings

---

## VALIDATION

After all tasks complete:

1. Run migration — confirm workspace_voice_patterns
   table exists with one row per workspace (seeded)

2. Trigger voice-pattern-extraction skill manually
   for Frontera Health:
   POST /api/workspaces/[frontera-id]/skills/run
   Body: { skillId: 'voice-pattern-extraction' }

   Report: how many internal calls were found,
   what patterns were extracted (or insufficient_data)

3. Call loadWorkspaceVoice() for Frontera Health
   and log the result — confirm voice context
   renders without errors

4. Generate a Concierge brief for Frontera Health
   and verify the WORKSPACE VOICE PROFILE block
   appears in the rendered context (check the
   context string sent to Claude, not just the output)

5. Verify coverage_target from workspace_voice_patterns
   appears in formatConciergeDaily() output
   instead of hardcoded 3×

6. Confirm voice-pattern-extraction is registered
   in the skill scheduler with monthly cron

---

## DO NOT TOUCH

- server/chat/orchestrator.ts
- server/chat/pandora-agent.ts
- Any existing skill compute logic
- The conversations table schema
- The is_internal filter logic
- Any existing migrations


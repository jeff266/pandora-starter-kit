# Pandora Build Prompt — Chart Renderer + Voice Model + Workspace Voice Modifiers
## Visual Intelligence + The Teammate Who Owns the Number

**Status:** Ready to build  
**Surfaces:** Ask Pandora (chat), Command Center Assistant (VP RevOps Brief), Admin settings  
**Depends on:** T010–T021 complete, existing renderer pipeline, existing voice config shape in `VoiceConfig`, existing workspace config layer  
**Sequencing:** Chart renderer first (T1–T5), then Voice Model (V1–V3), then Workspace Voice Modifiers (V4–V6). V1 must precede V4.

---

## Before Starting

Read these files before writing any code:

1. `server/renderers/types.ts` — existing `VoiceConfig`, `BrandingConfig`, `RendererInput` shapes
2. `server/agents/orchestrator.ts` — where the LLM system prompt is assembled; this is where voice injection happens
3. `client/src/components/assistant/ProactiveBriefing.tsx` — the brief card; charts render here
4. `client/src/pages/AssistantView.tsx` — session and brief composition
5. `server/agents/session-context.ts` (T010) — `SessionContext`, `sessionFindings`, `sessionCharts`
6. `server/config/workspace-config-loader.ts` — how workspace config is accessed by skills
7. `server/types/workspace-config.ts` — `WorkspaceConfig` shape; voice config will extend this
8. The `context_layer` or `workspace_configs` table — where workspace config is stored
9. `PANDORA_SKILL_DESIGN_GUIDE.md` — three-phase pattern; voice is applied at Phase 3 (synthesize)
10. Existing Recharts usage anywhere in the codebase — check for existing chart components before building new ones

**Do not proceed until you have read all ten.**

---

## Part 1 — Chart Renderer (T1–T5)

These were specced in `PANDORA_ASSISTANT_INTELLIGENCE_BUILD_PROMPT.md` and are now unblocked. The full spec is in that file — implement it exactly as written. Summary for orientation:

**T1** — Add `ChartSpec`, `ChartDataPoint`, `ChartBlock` types to `server/renderers/types.ts`. Add `validateChartSpec(spec, calculationContext)` that rejects specs where `source.calculation_id` doesn't match a real computation from the current session.

**T2** — Build `client/src/components/shared/ChartRenderer.tsx` using Recharts. Six chart types: `bar`, `horizontal_bar`, `line`, `stacked_bar`, `waterfall`, `donut`. Props: `spec: ChartSpec`, `compact?: boolean`. Annotation renders below every chart as italic secondary text. Color tokens from shared constants — never hardcoded hex. Compact mode reduces height 30%, hides subtitle, keeps annotation.

**T3** — Extend the router classification to emit `visualization_hint`. Inject chart spec instructions into the LLM system prompt when a chart is warranted. Parse `chart_spec` JSON blocks from LLM responses the same way table blocks are parsed today. Validate before rendering — fall back to prose if validation fails.

**T4** — Wire `<ChartRenderer compact={true} />` into the chat message renderer in Ask Pandora for `blockType: 'chart'` response blocks.

**T5** — Wire `<ChartRenderer compact={false} />` into the Assistant brief section cards. TheNumberCard gets an attainment pacing `line` chart. RepsCard gets a coverage comparison `horizontal_bar`. WhatChangedCard gets a pipeline movement `waterfall`.

### One addition not in the original spec: Voice-aware chart annotations

Chart annotations (the `spec.annotation` field — the "so what" below every chart) must be generated through the Voice Model (V1–V3 below), not written directly by the LLM. After T1–T5 are built and V1–V3 are built, come back and wire the annotation generation through the voice renderer so annotations inherit the workspace voice config.

Practically: the LLM emits a `raw_annotation` in the chart spec. The voice renderer transforms it into the final `annotation` before the spec reaches the frontend. This is a one-line change once V1–V3 exist.

---

## Part 2 — Voice Model (V1–V3)

This is the most important part of this build. Charts without voice are just data. Voice without charts is just narrative. Together they make Pandora feel like the analyst who already looked at everything before you got in and has a point of view they're prepared to defend.

### The Voice Contract

The target voice for Pandora's VP RevOps Brief and Ask Pandora responses is:

> The RevOps analyst you trust most on your team — one who has already looked at everything before you got in, owns the number alongside you, and has a point of view they're prepared to defend.

**What this means in practice:**

- Uses "we" not "the team." The analyst has stake in the outcome.
- Has a point of view. Doesn't hedge. Doesn't say "it appears" or "it seems." Says "we're short" or "I don't love this number."
- Makes a call. Doesn't present options — recommends one thing. Tradeoffs go in the tradeoffs section, not in the recommendation itself.
- Names people and deals. "Sara's Behavioral Framework" not "a high-value deal in your pipeline."
- Celebrates wins. "Nate just closed the quarter with that deal" not "a Closed Won deal was recorded."
- Notes problems honestly, without blame. "The multi-thread risk was flagged two weeks ago — no second contact was added" not "the rep failed to follow the recommendation."
- Earns trust by acknowledging uncertainty. "I'm less confident on this one — small sample" not false confidence.

**What it explicitly does NOT sound like:**

- McKinsey slide: "Attainment is currently tracking at 21% of the $350K target with 26 days remaining in the quarter."
- System notification: "5 new high-risk deals have been detected."
- Overly casual: "Yikes, things are looking rough lol."
- Hedge-everything: "It appears the pipeline may potentially be at risk of possibly missing the target."

---

### V1 — Voice Renderer Module

**Files:** `server/voice/voice-renderer.ts` (new), `server/voice/types.ts` (new)

The voice renderer is a post-processing layer that transforms raw LLM output into voice-appropriate text. It sits between the orchestrator's raw response and the frontend — the last step before text reaches the user.

```typescript
// server/voice/types.ts

export interface VoiceProfile {
  // Core identity
  persona: 'teammate' | 'advisor' | 'analyst';
  // teammate: uses "we", owns the number, direct recommendations
  // advisor: uses "I'd suggest", slightly more formal, still opinionated
  // analyst: more data-forward, still has POV but leads with evidence
  
  // Pronoun and ownership
  ownership_pronoun: 'we' | 'you';   // "we're short" vs "you're short"
  
  // Directness
  directness: 'direct' | 'diplomatic';
  // direct: "We're not going to hit this" 
  // diplomatic: "We're at risk of missing this — here's what would change it"
  
  // Depth
  detail_level: 'executive' | 'manager' | 'analyst';
  // executive: 1-2 sentences, implication first, no methodology
  // manager: 2-3 sentences, key data points, actionable
  // analyst: 3-5 sentences, supporting data, methodology noted
  
  // Deal/rep naming
  name_entities: boolean;
  // true: "Sara's Behavioral Framework deal"
  // false: "a high-value deal in the pipeline" (for anonymized/demo mode)
  
  // Celebration style
  celebrate_wins: boolean;
  // true: "Nate just closed the quarter with that deal"
  // false: neutral reporting of closed won
  
  // Uncertainty handling
  surface_uncertainty: boolean;
  // true: "I'm less confident on this — small sample size"
  // false: omit uncertainty caveats (executive mode)
  
  // Temporal framing
  temporal_awareness: 'quarter_phase' | 'week_day' | 'both' | 'none';
  // quarter_phase: "Late quarter — close plan view"
  // week_day: "Friday afternoon — here's where we are heading into the weekend"
  // both: combine both signals
}

export interface VoiceRenderInput {
  rawText: string;              // LLM output before voice transformation
  context: VoiceRenderContext;
  profile: VoiceProfile;
  workspaceVoiceOverrides?: WorkspaceVoiceOverrides;  // from V4
}

export interface VoiceRenderContext {
  surface: 'brief' | 'chat' | 'slack' | 'document' | 'chart_annotation';
  quarter_phase: 'early' | 'mid' | 'late';
  day_type: 'weekday_morning' | 'weekday_afternoon' | 'friday' | 'monday';
  attainment_pct: number;       // Current attainment — affects tone
  days_remaining: number;
  entities: {                   // Named entities in scope for this response
    reps?: string[];
    deals?: string[];
    accounts?: string[];
  };
}

export interface VoiceRenderOutput {
  text: string;                 // Voice-transformed text
  transformationsApplied: string[];  // Which rules fired — for debugging
}
```

**Voice transformation rules:**

The voice renderer applies a set of deterministic text transformations BEFORE and AFTER the LLM call, plus injects voice-shaping instructions INTO the LLM prompt. It is not a second LLM call — it's prompt engineering + light post-processing.

**Pre-LLM (injected into system prompt):**

```typescript
function buildVoiceSystemPromptSection(profile: VoiceProfile, context: VoiceRenderContext): string {
  const lines: string[] = [];
  
  // Persona
  if (profile.persona === 'teammate') {
    lines.push(`You are a RevOps analyst who owns the number alongside the VP. Use "we" not "the team." You have stake in the outcome.`);
    lines.push(`You have already looked at everything before the VP got in. Speak as if briefing a trusted colleague, not presenting to a client.`);
  } else if (profile.persona === 'advisor') {
    lines.push(`You are a senior RevOps advisor. Use "I'd recommend" and "my read is." Authoritative but not presumptuous.`);
  } else {
    lines.push(`You are a data-forward RevOps analyst. Lead with evidence, follow with interpretation.`);
  }
  
  // Directness
  if (profile.directness === 'direct') {
    lines.push(`Be direct. Do not hedge. Do not say "it appears" or "it seems" or "it may be." Say what you see.`);
    lines.push(`Make one recommendation. Not a list of options. If you have uncertainty, put it in the tradeoffs — not in the recommendation.`);
  } else {
    lines.push(`Be direct but constructive. Frame risks as opportunities where honest. Acknowledge what's working.`);
  }
  
  // Detail level
  switch (profile.detail_level) {
    case 'executive':
      lines.push(`Audience: executive. Be extremely concise — 1-2 sentences per point. Lead with the implication, not the data. Skip methodology entirely.`);
      break;
    case 'manager':
      lines.push(`Audience: manager. 2-3 sentences per point. Include the key data point that drives the insight. Actionable.`);
      break;
    case 'analyst':
      lines.push(`Audience: analyst. 3-5 sentences where needed. Include supporting data points. Note data quality or sample size if relevant.`);
      break;
  }
  
  // Entity naming
  if (profile.name_entities) {
    lines.push(`Name the people and deals. Say "Sara's Behavioral Framework deal" not "a high-value opportunity."`);
  } else {
    lines.push(`Anonymize all rep names and deal names. Use "Rep A" and "Deal X" instead of real names.`);
  }
  
  // Temporal context
  if (context.days_remaining <= 14) {
    lines.push(`We are in the final stretch — ${context.days_remaining} days left. Urgency is real. Reflect that in your recommendations.`);
  } else if (context.days_remaining <= 30) {
    lines.push(`We are in late quarter with ${context.days_remaining} days remaining. Close plan lens.`);
  }
  
  if (context.attainment_pct < 50 && context.days_remaining < 30) {
    lines.push(`Attainment is at ${context.attainment_pct}% with ${context.days_remaining} days left. Don't sugarcoat — be honest about what's realistic.`);
  } else if (context.attainment_pct >= 100) {
    lines.push(`We've hit target. Acknowledge the win before pivoting to what's next.`);
  }
  
  // Wins
  if (profile.celebrate_wins) {
    lines.push(`When a deal closes or a milestone is hit, say so with genuine acknowledgment. "Nate just closed the quarter with that deal" — not "a Closed Won event was recorded."`);
  }
  
  // Uncertainty
  if (profile.surface_uncertainty) {
    lines.push(`When you're less confident, say so briefly: "I'm less confident on this — small sample" or "worth verifying before the forecast call."`);
  }
  
  return lines.join('\n');
}
```

**Post-LLM (text transformations):**

Apply these transforms to the raw LLM output before sending to the frontend:

```typescript
function applyPostTransforms(text: string, profile: VoiceProfile): string {
  let result = text;
  const transforms: string[] = [];
  
  // Strip hedge phrases if directness === 'direct'
  if (profile.directness === 'direct') {
    const hedges = [
      [/it appears that /gi, ''],
      [/it seems that /gi, ''],
      [/it may be that /gi, ''],
      [/it's possible that /gi, ''],
      [/one could argue that /gi, ''],
      [/based on the available data, /gi, ''],
      [/the data suggests that /gi, ''],
      [/it's worth noting that /gi, ''],
    ];
    for (const [pattern, replacement] of hedges) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement as string);
        transforms.push(`stripped_hedge: ${pattern}`);
      }
    }
  }
  
  // Replace "the team" with "we" if persona === 'teammate'
  if (profile.persona === 'teammate' && profile.ownership_pronoun === 'we') {
    result = result.replace(/\bthe team\b/gi, 'we');
    result = result.replace(/\byour team\b/gi, 'the team'); // don't replace "your team" with "the team" → use "we"
    transforms.push('pronoun_we');
  }
  
  // Capitalize sentence starts after transforms
  result = result.replace(/\.\s+([a-z])/g, (m, c) => '. ' + c.toUpperCase());
  
  return result;
}
```

**Acceptance:** The voice renderer module exists. `buildVoiceSystemPromptSection` returns a non-empty string for all persona/directness/detail_level combinations. `applyPostTransforms` strips hedge phrases when `directness === 'direct'` and replaces "the team" when `persona === 'teammate'`. All transforms are logged to `transformationsApplied`.

---

### V2 — Voice Injection into Orchestrator

**Files:** `server/agents/orchestrator.ts`

Wire the voice renderer into every LLM call made by the orchestrator — brief assembly, chat responses, chart annotations, strategic reasoning (T015), cross-signal findings (T014).

**Step 1 — Get the workspace voice profile at session start.** When a session is initialized (T010 session context), load the workspace voice profile from the workspace config (V4 will store it there; for now use the default profile):

```typescript
// At session initialization, add to SessionContext:
voiceProfile: VoiceProfile;  // loaded from workspace config, falls back to DEFAULT_VOICE_PROFILE

const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  persona: 'teammate',
  ownership_pronoun: 'we',
  directness: 'direct',
  detail_level: 'manager',
  name_entities: true,
  celebrate_wins: true,
  surface_uncertainty: true,
  temporal_awareness: 'both',
};
```

**Step 2 — Build voice context at each turn.** Before every LLM call, construct the `VoiceRenderContext` from the session state:

```typescript
function buildVoiceContext(
  session: SessionContext,
  workspaceMetrics: { attainment_pct: number; days_remaining: number; quarter_phase: string }
): VoiceRenderContext {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  
  let day_type: VoiceRenderContext['day_type'];
  if (day === 1) day_type = 'monday';
  else if (day === 5) day_type = 'friday';
  else if (hour < 12) day_type = 'weekday_morning';
  else day_type = 'weekday_afternoon';
  
  return {
    surface: 'chat',
    quarter_phase: workspaceMetrics.quarter_phase as any,
    day_type,
    attainment_pct: workspaceMetrics.attainment_pct,
    days_remaining: workspaceMetrics.days_remaining,
    entities: {
      reps: session.activeScope.rep ? [session.activeScope.rep] : [],
      deals: session.activeScope.dealName ? [session.activeScope.dealName] : [],
    }
  };
}
```

**Step 3 — Inject voice section into every system prompt.** The orchestrator's `buildSystemPrompt` function (or equivalent) should append the voice section:

```typescript
const voiceSection = buildVoiceSystemPromptSection(session.voiceProfile, voiceContext);
systemPrompt += `\n\n## Voice and Tone\n${voiceSection}`;
```

**Step 4 — Apply post-transforms to every LLM response** before it enters the response block parser:

```typescript
const rawResponse = await llmClient.complete(systemPrompt, userMessage);
const voicedResponse = applyPostTransforms(rawResponse, session.voiceProfile);
const blocks = parseResponseBlocks(voicedResponse, calculationContext);
```

**Step 5 — Brief assembly.** The brief assembler also calls Claude for narrative generation. Wire voice injection there too — same `buildVoiceSystemPromptSection`, same post-transforms. Surface is `'brief'` not `'chat'`.

**Acceptance:** Send a chat message and inspect the system prompt — it should contain a voice section with persona, directness, detail level, entity naming, and temporal context instructions. The raw LLM response should have hedge phrases stripped if present. "The team" should be replaced with "we" in teammate persona. Brief narrative should follow the same voice.

---

### V3 — Voice Calibration Endpoint (Admin)

**Files:** `server/routes/voice-calibration.ts` (new), update admin UI

The voice model is built on a default profile. But the right voice for Frontera (late-quarter, high-pressure, small team) is different from the right voice for a 50-rep enterprise team where the VP wants executive-level brevity.

Before building the full admin UI (V4), create a calibration endpoint that lets you test the voice in isolation:

```
POST /api/workspaces/:id/voice/preview
Body: {
  voiceProfile: VoiceProfile,
  sampleContext: {
    attainment_pct: number,
    days_remaining: number,
    quarter_phase: string,
    sample_scenario: 'late_quarter_behind' | 'on_track' | 'over_target' | 'mid_quarter_review'
  }
}
Response: {
  systemPromptSection: string,    // The voice section that would be injected
  sampleOutputBefore: string,     // Raw LLM sample without voice
  sampleOutputAfter: string,      // Same sample with voice applied
  transformationsApplied: string[]
}
```

The sample scenarios use fixed prose so you can see before/after without running real data. Hard-code representative sample outputs for each scenario:

```typescript
const SAMPLE_OUTPUTS: Record<string, string> = {
  late_quarter_behind: `The current attainment level is 21% with 26 days remaining. The team has several deals in the pipeline. It appears that pipeline movement has been limited this week. Based on the available data, it may be difficult to reach the target.`,
  
  on_track: `Attainment is tracking at 67% with 45 days remaining. The team appears to be on pace. There are several opportunities in late stages that could contribute to the target.`,
  
  over_target: `The target has been exceeded. The team has closed above quota this period. It seems that strong performance has been achieved.`,
  
  mid_quarter_review: `Based on the available data, pipeline coverage appears to be at approximately 2.4x. The team has some deals progressing through the stages. It may be worth reviewing the coverage situation.`
};
```

**Acceptance:** `POST /api/workspaces/:id/voice/preview` returns a response with `sampleOutputBefore` (the hedge-filled version) and `sampleOutputAfter` (voice-transformed). The after version should have no hedge phrases, use "we" for teammate persona, and match the directness and detail level specified.

---

## Part 3 — Workspace Voice Modifiers (V4–V6)

Every workspace has different people, different stakes, and different communication norms. Frontera is a small team where Jeff is deeply in the details. A 50-rep enterprise client might have a CRO who wants three sentences maximum with no deal names. The voice modifier system lets admins configure this per workspace without touching code.

---

### V4 — Workspace Voice Config Schema + Storage

**Files:** `server/types/workspace-config.ts` (extend), `server/config/workspace-config-loader.ts` (extend), DB migration

Extend the `WorkspaceConfig` schema to include voice configuration:

```typescript
// Add to WorkspaceConfig in server/types/workspace-config.ts

interface VoiceModifierConfig {
  // Core profile — maps directly to VoiceProfile
  persona: 'teammate' | 'advisor' | 'analyst';
  ownership_pronoun: 'we' | 'you';
  directness: 'direct' | 'diplomatic';
  detail_level: 'executive' | 'manager' | 'analyst';
  name_entities: boolean;
  celebrate_wins: boolean;
  surface_uncertainty: boolean;
  temporal_awareness: 'quarter_phase' | 'week_day' | 'both' | 'none';
  
  // Brief-specific overrides
  brief_overrides?: {
    opening_style?: 'narrative' | 'metric_first' | 'risk_first';
    // narrative: start with the story ("We're at 21% and I don't love it...")
    // metric_first: start with the numbers, then interpret
    // risk_first: lead with the biggest risk, then context
    
    focus_block_label?: string;
    // Default: "Focus this week" — can change to "Priority" or "What I need from you"
    
    show_assembly_timestamp?: boolean;
    // Default: true — some admins want this hidden
    
    since_last_week_label?: string;
    // Default: "Since last week" — can be "Since last brief" or custom
  };
  
  // Chat-specific overrides
  chat_overrides?: {
    response_max_sentences?: number;
    // null = no limit (default). Set to 3 for executive mode.
    
    always_show_evidence?: boolean;
    // true: every claim includes its calculation_id source
    // false: evidence available on request only (default)
    
    strategic_reasoning_style?: 'full_card' | 'brief_summary';
    // full_card: the six-section T015 card (default)
    // brief_summary: hypothesis + recommendation only, 2 sentences each
  };
  
  // Document-specific overrides
  document_overrides?: {
    executive_summary_length?: 'short' | 'medium' | 'long';
    // short: 1 paragraph, medium: 2 paragraphs (default), long: 3+ paragraphs
    
    include_uncertainty_appendix?: boolean;
    // true: add an appendix noting low-confidence items
    // false: omit (default for executive documents)
    
    throughline_position?: 'header' | 'executive_summary' | 'none';
    // where the documentThroughline appears
  };
  
  // Per-surface demo/anonymize mode
  anonymize_mode?: boolean;
  // true: replace all rep/deal names with placeholders (for demos/LinkedIn)
  
  // Custom vocabulary — workspace-specific terminology
  custom_terms?: {
    deal: string;           // Default: "deal" — some use "opportunity"
    rep: string;            // Default: "rep" — some use "AE" or "account executive"
    commit: string;         // Default: "commit" — some use "forecast"
    pipeline: string;       // Default: "pipeline" — some use "book of business"
    close_date: string;     // Default: "close date" — some use "target date"
    quota: string;          // Default: "target" — some use "quota" or "plan"
  };
}
```

**Storage:** Voice config lives in the workspace config JSON alongside the existing pipeline, threshold, and scoring configs. Add `voice: VoiceModifierConfig` to `WorkspaceConfig`.

**DB migration:** No new table needed — workspace config is already a JSONB column. Add a migration that sets the default voice config for all existing workspaces:

```sql
-- Migration: add default voice config to all workspace configs
UPDATE workspace_configs
SET config = jsonb_set(
  config,
  '{voice}',
  '{
    "persona": "teammate",
    "ownership_pronoun": "we",
    "directness": "direct", 
    "detail_level": "manager",
    "name_entities": true,
    "celebrate_wins": true,
    "surface_uncertainty": true,
    "temporal_awareness": "both",
    "anonymize_mode": false,
    "custom_terms": {
      "deal": "deal",
      "rep": "rep",
      "commit": "commit",
      "pipeline": "pipeline",
      "close_date": "close date",
      "quota": "target"
    }
  }'::jsonb,
  true
)
WHERE config->'voice' IS NULL;
```

**Config loader extension:** Add `getVoiceConfig(workspaceId)` to the config loader:

```typescript
async getVoiceConfig(workspaceId: string): Promise<VoiceModifierConfig> {
  const config = await this.getConfig(workspaceId);
  return config.voice || DEFAULT_VOICE_CONFIG;
}

async getVoiceProfile(workspaceId: string): Promise<VoiceProfile> {
  const voiceConfig = await this.getVoiceConfig(workspaceId);
  
  // VoiceModifierConfig maps directly to VoiceProfile
  return {
    persona: voiceConfig.persona,
    ownership_pronoun: voiceConfig.ownership_pronoun,
    directness: voiceConfig.directness,
    detail_level: voiceConfig.detail_level,
    name_entities: voiceConfig.anonymize_mode ? false : voiceConfig.name_entities,
    celebrate_wins: voiceConfig.celebrate_wins,
    surface_uncertainty: voiceConfig.surface_uncertainty,
    temporal_awareness: voiceConfig.temporal_awareness,
  };
}
```

**Custom terms injection:** When custom terms differ from defaults, inject them into the voice system prompt section:

```
This workspace uses "opportunity" instead of "deal" and "AE" instead of "rep". 
Use their terminology consistently throughout your response.
```

**Acceptance:** The `VoiceModifierConfig` type exists and includes all fields above. `getVoiceConfig` returns the workspace's config or the default. `getVoiceProfile` correctly maps config to profile and applies anonymize_mode. The DB migration sets default voice config on all existing workspaces.

---

### V5 — Admin Voice Settings UI

**Files:** New page `client/src/pages/admin/VoiceSettings.tsx`, add route under admin section

The admin UI lets workspace admins configure the voice without editing JSON. It should be accessible from the existing admin/settings area.

**Page layout:**

```
Voice & Tone Settings

[Live Preview ↻]  — shows a sample brief snippet in real time as settings change

─── Core Voice ──────────────────────────────────────

Persona
  ○ Teammate  — "We're at 21% and I don't love this number"
  ○ Advisor   — "My read is that we're at risk here"  
  ○ Analyst   — "Current attainment is 21%, driven by..."

Ownership
  ○ We  — "We need to close this"
  ○ You — "You need to close this"

Directness
  ○ Direct     — States findings plainly, no hedging
  ○ Diplomatic — Frames risks as opportunities where appropriate

Detail Level
  ○ Executive — 1-2 sentences, implication first
  ○ Manager   — 2-3 sentences, key data points
  ○ Analyst   — 3-5 sentences, full evidence

─── Content Preferences ──────────────────────────────

[✓] Name reps and deals in findings  
[✓] Celebrate wins explicitly
[✓] Surface uncertainty and data quality notes
    Temporal awareness: [Both ▼]

─── Demo Mode ────────────────────────────────────────

[  ] Anonymize all names and amounts (for demos and LinkedIn)
     When on, "Sara" → "Rep A", "$315K deal" → "a six-figure deal"

─── Custom Terminology ───────────────────────────────

Deal:       [deal          ] ← type "opportunity" to override
Rep:        [rep           ]
Commit:     [commit        ]
Pipeline:   [pipeline      ]
Close Date: [close date    ]
Quota:      [target        ]

─── Brief Overrides ──────────────────────────────────

Opening style:  ○ Narrative  ○ Metric first  ○ Risk first
Focus block label: [Focus this week        ]
Show assembly timestamp: [✓]

─── Chat Overrides ───────────────────────────────────

Max response sentences: [No limit ▼]  (3 for executive, unlimited for analyst)
Strategic reasoning style: ○ Full card  ○ Brief summary

─── Document Overrides ───────────────────────────────

Executive summary length: ○ Short  ○ Medium  ○ Long
Include uncertainty appendix: [  ]
Throughline position: ○ Header  ○ Executive Summary  ○ None

[Save Changes]    [Reset to Defaults]    [Preview →]
```

**Live preview:** When any setting changes, call the `POST /api/workspaces/:id/voice/preview` endpoint (V3) and update a preview panel on the right side of the page showing the before/after text for the `late_quarter_behind` scenario. This gives admins immediate feedback on how their settings change the output.

**Save behavior:** Changes to voice config write immediately to the workspace config via `PATCH /api/workspaces/:id/config/voice`. No "pending changes" state — save is immediate. Replit's existing config update endpoint pattern.

**Acceptance:** The Voice Settings page renders with all controls. Changing "Persona" from Teammate to Analyst updates the live preview within 2 seconds. Saving writes the config. The next chat session uses the updated voice profile.

---

### V6 — Voice Config API Endpoints

**Files:** `server/routes/workspace-voice.ts` (new) or extend existing workspace config routes

```
GET  /api/workspaces/:id/config/voice
     → Returns VoiceModifierConfig for the workspace

PATCH /api/workspaces/:id/config/voice
      Body: Partial<VoiceModifierConfig>
      → Merges the partial config into the existing config, writes to DB
      → Invalidates the config loader cache for this workspace
      → Returns the updated VoiceModifierConfig

POST /api/workspaces/:id/voice/preview
     Body: { voiceProfile: VoiceProfile, sampleContext: {...} }
     → Returns { sampleOutputBefore, sampleOutputAfter, transformationsApplied }
     → Does NOT require saved config — uses the profile in the request body
     → Used by the admin UI live preview

POST /api/workspaces/:id/voice/reset
     → Resets voice config to DEFAULT_VOICE_CONFIG
     → Returns the reset config
```

**Auth:** All voice config endpoints require workspace admin role. The preview endpoint can be used by any workspace member (for testing), but write endpoints are admin-only.

**Cache invalidation:** The config loader caches workspace config. When voice config is updated, invalidate the cache for that workspace ID so the next session picks up the new profile immediately.

**Acceptance:** All four endpoints exist and are auth-guarded. `PATCH` correctly merges partial updates — updating `directness` alone doesn't reset other fields. Cache invalidation fires on PATCH and reset. Preview endpoint returns meaningful before/after text for all four sample scenarios.

---

## Sequencing

```
T1 → T2 → T3 → T4 (can parallel T5)
              ↘ T5

V1 → V2 (V2 depends on V1 types)
V1 → V3 (V3 depends on V1 preview logic)
V4 → V5 → V6 (sequential — UI needs API, API needs schema)

After T1–T5 AND V1–V3 are both done:
  → Wire voice-aware chart annotations (the annotation post-processing step)
  → Wire workspace voice profile into session context initialization
```

Build order for this session: T1, T2, T3, T4, T5, V1, V2, V3, V4, V6, V5.

---

## Acceptance Criteria — Full Suite

1. **All six chart types render.** Ask "show me pipeline by stage" → bar chart renders in chat with correct values, teal bars, annotation below. Ask "show me rep coverage" → horizontal bar renders with a reference line at 3x. "What changed this week" → waterfall with teal positive bars and coral negative bars.

2. **Charts render in the brief.** TheNumberCard shows an attainment pacing line chart. RepsCard shows coverage bars. WhatChangedCard shows a waterfall. All three have annotations.

3. **Math is protected.** Inspect any chart spec — every value in `data[]` traces to a `calculation_id`. The LLM never generated, rounded, or estimated a value.

4. **Compact mode works.** Charts in chat are shorter than charts in the brief. No overflow. Annotation still renders in both.

5. **Voice transforms fire.** Send a message. Inspect the system prompt — voice section is present. The response contains no hedge phrases ("it appears", "it seems", "it may be"). "The team" becomes "we" in teammate persona.

6. **Voice is temporal.** A Friday afternoon session has different opening framing than a Monday morning. Late quarter has different urgency language than early quarter.

7. **Preview endpoint works.** `POST /api/workspaces/:id/voice/preview` returns before/after text. The after version is meaningfully different — less hedging, more direct, correct pronoun.

8. **Workspace voice config persists.** Save a voice config in the admin UI. Reload the session. The new voice profile is active — the chat responses reflect the saved settings.

9. **Anonymize mode works.** Toggle anonymize mode on. Rep names become "Rep A", deal names become "Deal X", amounts become approximate. Toggle off — names return. This is the demo mode for LinkedIn posts and client-facing demos.

10. **Custom terms are used.** Set "deal" → "opportunity" in the admin UI. The brief and chat say "opportunity" wherever "deal" would have appeared.

11. **No regression.** T010–T021 all continue to function. The session context, document accumulator, cross-signal analysis, action judgment, and workspace memory are unaffected by voice changes.

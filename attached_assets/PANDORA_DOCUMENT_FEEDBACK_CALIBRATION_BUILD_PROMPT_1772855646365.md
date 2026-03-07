# Pandora Build Prompt — Document Feedback, Workspace Calibration, and Persistent Learning
## Making the Document Renderer Persistently Smarter Per Workspace

**Status:** Ready to build  
**Surfaces:** Document render flow, Admin settings, Brief assembly, Ask Pandora chat  
**Depends on:** T011 (Document Accumulator), T012 (Narrative Synthesis), T013 (Distribution), T019 (Workspace Memory), V1–V4 (Voice Model + Config), existing renderer pipeline  
**North star:** Every document Pandora generates should be measurably better than the one before it. The feedback architecture is the data collection layer for eventual fine-tuning. The correction IS the feedback.

---

## Before Starting

Read these files before writing any code:

1. `server/documents/accumulator.ts` — DocumentAccumulator, AccumulatedDocument, DocumentContribution (T011)
2. `server/documents/synthesizer.ts` — narrative synthesis, documentThroughline, lowConfidenceFlags (T012)
3. `server/documents/distributor.ts` — distribution channels, document_distributions table (T013)
4. `server/memory/workspace-memory.ts` — WorkspaceMemory, writeMemoryFromSkillRun, getRelevantMemories (T019)
5. `server/types/workspace-config.ts` — WorkspaceConfig, VoiceModifierConfig (V4)
6. `server/config/workspace-config-loader.ts` — getVoiceConfig, getVoiceProfile
7. `server/renderers/types.ts` — RendererInput, RenderOutput shapes
8. The `weekly_briefs`, `workspace_memory`, `document_distributions` table schemas
9. `server/agents/orchestrator.ts` — how brief assembly and chat orchestration work
10. `client/src/components/documents/` — whatever document UI components exist from T011/T013

**Do not proceed until you have read all ten.**

---

## Architecture Principles

**The correction is the feedback.** Don't ask users to rate documents. Watch what they change. The diff between what Pandora wrote and what the user sent is the highest-quality training signal available. Every edit is a labeled example: here is what the model produced, here is what a RevOps VP actually wanted.

**Three feedback loops compound on each other.** Explicit corrections (edits before distribution) teach section-level preferences. Implicit signals (recommendation actioning, Slack engagement) teach what produces outcomes. Calibration answers teach structural preferences. All three feed the `WorkspaceDocumentProfile`, which shapes every future document for that workspace.

**Calibration is proactive, not reactive.** Pandora doesn't wait for enough edits to accumulate — it asks targeted questions after the first three documents, after heavy editing sessions, and quarterly. The calibration session is a conversation, not a form. It ends with Pandora confirming what it learned and asking the user to correct anything wrong.

**Training pairs are a first-class artifact.** Every (raw_output, user_corrected_output) pair is stored as a `training_pair` record. These accumulate silently across workspaces. At 5K–10K pairs, they become the fine-tuning dataset for Fireworks AI. The feedback architecture IS the data pipeline.

**Workspace profiles are workspace-scoped, never cross-contaminated.** Frontera's document preferences never bleed into Imubit's documents. The profile is a per-workspace artifact. Cross-workspace learning only happens at the model fine-tuning layer, not at the profile layer.

---

## Task List

### F1 — WorkspaceDocumentProfile Schema + Storage

**Files:** `server/types/document-profile.ts` (new), DB migration, extend `server/config/workspace-config-loader.ts`

The `WorkspaceDocumentProfile` is the central accumulator for everything Pandora learns about how a workspace wants its documents built. It lives alongside the voice config in the workspace config layer.

```typescript
// server/types/document-profile.ts

export interface WorkspaceDocumentProfile {
  workspaceId: string;
  version: number;
  lastUpdatedAt: string;
  
  // ── Section Preferences ──────────────────────────────
  // Learned from Loop 1 (explicit edits) and Loop 3 (calibration)
  sectionPreferences: {
    [templateType: string]: {           // 'weekly_business_review' | 'qbr' | 'board_deck' | etc.
      [sectionId: string]: {            // 'exec_summary' | 'pipeline_health' | etc.
        
        // Structural preferences (from calibration)
        preferredLength: 'shorter' | 'current' | 'longer';
        preferredLeadWith: string | null;  // 'attainment' | 'risk' | 'close_plan' | 'wins' | null
        nameEntitiesInSection: boolean;    // can override workspace-level name_entities per section
        
        // Style signals (derived from edit patterns)
        styleSignals: string[];
        // e.g. ["lead with the implication not the data",
        //       "don't reference close dates in exec summary",
        //       "always name the rep when flagging a risk"]
        
        // Edit history (raw diffs for training pairs)
        editHistory: DocumentEdit[];
        
        // Quality signal
        averageEditDistance: number;    // 0 = never edited, 1 = always heavily edited
        editCount: number;
        lastEditedAt: string | null;
      }
    }
  };
  
  // ── Distribution Patterns ────────────────────────────
  // Learned from Loop 2 (implicit signals)
  distributionPatterns: {
    mostUsedChannels: string[];               // ordered by frequency
    channelByTemplate: Record<string, string[]>;  // which channels per template type
    averageTimeToDistribute: number;          // minutes from render to distribution
    averageTimeToFirstAction: number;         // hours from distribution to first recommendation actioned
    slackEngagementByTemplate: Record<string, {
      averageReactions: number;
      averageReplies: number;
      lastMeasuredAt: string;
    }>;
  };
  
  // ── Calibration Answers ──────────────────────────────
  // Learned from Loop 3 (explicit calibration session)
  calibration: {
    completedAt: string | null;
    completedSessions: number;
    nextScheduledAt: string | null;
    
    answers: {
      // Executive summary preferences
      execSummaryLeadsWith: 'attainment' | 'close_plan' | 'risk' | 'wins' | null;
      execSummaryMaxParagraphs: number;       // 1 | 2 | 3
      
      // Risk section preferences  
      riskSectionNameReps: boolean;           // name reps in risk findings?
      riskSectionNameDeals: boolean;          // name deals in risk findings?
      
      // Comparison block
      comparisonBlockPosition: 'top' | 'appendix' | 'omit';
      
      // Recommendation style
      recommendationsStyle: 'directive' | 'collaborative';
      // directive: "Sara needs to multi-thread Behavioral Framework by Monday"
      // collaborative: "Consider having Sara add a second contact to Behavioral Framework"
      
      // Distribution audience
      primaryAudience: 'vp_revops' | 'cro' | 'full_leadership' | 'ops_team';
      audienceExpectation: 'narrative' | 'metric_first' | 'action_only';
      
      // Custom answers from open-ended questions (stored as key-value)
      customAnswers: Record<string, string>;
    } | null;   // null until first calibration is completed
  };
  
  // ── Quality Scores ───────────────────────────────────
  // Derived after every document generation
  qualityScores: {
    overall: number;                          // 0-100
    byTemplate: Record<string, number>;
    trend: 'improving' | 'stable' | 'declining';
    derivedFrom: {
      editRateWeight: number;               // lower edit rate = higher score
      actionRateWeight: number;             // higher rec actioning = higher score
      distributionRateWeight: number;       // documents that get distributed = higher score
    };
    lastCalculatedAt: string;
  };
  
  // ── Training Pairs Count ─────────────────────────────
  trainingPairsCount: number;               // how many (raw, corrected) pairs accumulated
  fineTuningReadyAt: number;                // target count before fine-tuning (default: 500 per workspace)
}

export interface DocumentEdit {
  id: string;
  documentId: string;
  templateType: string;
  sectionId: string;
  editedAt: string;
  editedBy: string;                         // user ID
  
  // The actual diff — this is the training pair
  rawText: string;                          // what Pandora generated
  editedText: string;                       // what the user sent instead
  editDistance: number;                     // Levenshtein distance normalized 0-1
  
  // Derived style signals (extracted after edit is saved)
  derivedSignals: string[];                 // ["shorter preferred", "lead with risk"]
  
  // Context
  voiceProfileAtTime: Record<string, any>;  // snapshot of voice profile when generated
  quarterPhaseAtTime: string;
  attainmentPctAtTime: number;
}

export interface TrainingPair {
  id: string;
  workspaceId: string;
  templateType: string;
  sectionId: string;
  createdAt: string;
  
  // The pair
  systemPromptAtTime: string;               // full system prompt used for generation
  rawOutput: string;                        // what the model produced
  correctedOutput: string;                  // what the user changed it to
  
  // Labels (for fine-tuning)
  editDistance: number;
  derivedStyleSignals: string[];
  wasDistributed: boolean;                  // did this document actually get sent?
  recommendationsActioned: number;          // how many recs from this doc were actioned
  
  // Quality label (derived)
  qualityLabel: 'good' | 'needs_improvement' | 'poor';
  // good: low edit distance + distributed + recs actioned
  // needs_improvement: moderate edits, distributed
  // poor: heavily edited or not distributed
}
```

**Database migration:**

```sql
-- WorkspaceDocumentProfile: stored as JSONB in workspace_configs
-- (extends existing config column, same pattern as voice config)
UPDATE workspace_configs
SET config = jsonb_set(config, '{document_profile}', '{
  "version": 1,
  "sectionPreferences": {},
  "distributionPatterns": {
    "mostUsedChannels": [],
    "channelByTemplate": {},
    "averageTimeToDistribute": 0,
    "averageTimeToFirstAction": 0,
    "slackEngagementByTemplate": {}
  },
  "calibration": {
    "completedAt": null,
    "completedSessions": 0,
    "nextScheduledAt": null,
    "answers": null
  },
  "qualityScores": {
    "overall": 50,
    "byTemplate": {},
    "trend": "stable",
    "derivedFrom": {
      "editRateWeight": 0.4,
      "actionRateWeight": 0.4,
      "distributionRateWeight": 0.2
    },
    "lastCalculatedAt": null
  },
  "trainingPairsCount": 0,
  "fineTuningReadyAt": 500
}'::jsonb, true)
WHERE config->''document_profile'' IS NULL;

-- Training pairs: dedicated table (these need to be queryable for fine-tuning export)
CREATE TABLE training_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  template_type TEXT NOT NULL,
  section_id TEXT NOT NULL,
  
  system_prompt_at_time TEXT NOT NULL,
  raw_output TEXT NOT NULL,
  corrected_output TEXT NOT NULL,
  
  edit_distance FLOAT NOT NULL,
  derived_style_signals TEXT[] DEFAULT '{}',
  was_distributed BOOLEAN DEFAULT FALSE,
  recommendations_actioned INT DEFAULT 0,
  quality_label TEXT,
  
  voice_profile_snapshot JSONB,
  quarter_phase TEXT,
  attainment_pct FLOAT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_training_pairs_workspace ON training_pairs(workspace_id);
CREATE INDEX idx_training_pairs_quality ON training_pairs(workspace_id, quality_label);
CREATE INDEX idx_training_pairs_template ON training_pairs(workspace_id, template_type);

-- Document edits: track every edit to a generated document section
CREATE TABLE document_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  document_id UUID NOT NULL,
  template_type TEXT NOT NULL,
  section_id TEXT NOT NULL,
  
  raw_text TEXT NOT NULL,
  edited_text TEXT NOT NULL,
  edit_distance FLOAT NOT NULL,
  derived_signals TEXT[] DEFAULT '{}',
  
  voice_profile_snapshot JSONB,
  quarter_phase_at_time TEXT,
  attainment_pct_at_time FLOAT,
  
  edited_by TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_edits_workspace ON document_edits(workspace_id);
CREATE INDEX idx_document_edits_section ON document_edits(workspace_id, template_type, section_id);
```

**Config loader extension:**

```typescript
// Add to server/config/workspace-config-loader.ts

async getDocumentProfile(workspaceId: string): Promise<WorkspaceDocumentProfile> {
  const config = await this.getConfig(workspaceId);
  return config.document_profile || DEFAULT_DOCUMENT_PROFILE;
}

async updateDocumentProfile(
  workspaceId: string,
  updates: DeepPartial<WorkspaceDocumentProfile>
): Promise<void> {
  await this.mergeConfig(workspaceId, { document_profile: updates });
  this.invalidateCache(workspaceId);
}

async getSectionPreferences(
  workspaceId: string,
  templateType: string,
  sectionId: string
): Promise<SectionPreferences | null> {
  const profile = await this.getDocumentProfile(workspaceId);
  return profile.sectionPreferences?.[templateType]?.[sectionId] || null;
}
```

**Acceptance:** `WorkspaceDocumentProfile` type exists with all fields. DB migration runs without error. Config loader returns default profile for workspaces without one. `training_pairs` and `document_edits` tables exist with correct schema and indexes.

---

### F2 — Edit Capture + Diff Engine

**Files:** `server/documents/edit-capture.ts` (new), update document render modal / distribution UI (T013)

This is the core of Loop 1. When a user edits any section of a document before distribution, capture the diff, extract style signals, and write a training pair.

**Edit capture trigger:** The distribution review panel (T013) already shows document sections for low-confidence review. Extend it so every section is editable — not just flagged ones. Add an "Edit" button next to each section that opens an inline textarea pre-populated with the generated text.

When the user saves an edit:

```typescript
// server/documents/edit-capture.ts

import { diffWords } from 'diff';   // npm: diff package

export async function captureDocumentEdit(input: {
  workspaceId: string;
  documentId: string;
  templateType: string;
  sectionId: string;
  rawText: string;
  editedText: string;
  editedBy: string;
  sessionContext: SessionContext;
  systemPromptAtTime: string;
}): Promise<void> {
  
  const { rawText, editedText } = input;
  
  // Calculate edit distance (normalized 0-1)
  const editDistance = calculateNormalizedEditDistance(rawText, editedText);
  
  // Skip if trivial edit (typo fix, punctuation)
  if (editDistance < 0.05) return;
  
  // Extract style signals from the diff
  const derivedSignals = extractStyleSignals(rawText, editedText);
  
  // Write document_edit record
  await db.query(`
    INSERT INTO document_edits
      (workspace_id, document_id, template_type, section_id,
       raw_text, edited_text, edit_distance, derived_signals,
       voice_profile_snapshot, quarter_phase_at_time, attainment_pct_at_time,
       edited_by, edited_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
  `, [
    input.workspaceId, input.documentId, input.templateType, input.sectionId,
    rawText, editedText, editDistance, derivedSignals,
    JSON.stringify(input.sessionContext.voiceProfile),
    input.sessionContext.voiceContext?.quarter_phase,
    input.sessionContext.voiceContext?.attainment_pct,
    input.editedBy
  ]);
  
  // Write training pair
  await db.query(`
    INSERT INTO training_pairs
      (workspace_id, template_type, section_id,
       system_prompt_at_time, raw_output, corrected_output,
       edit_distance, derived_style_signals,
       voice_profile_snapshot, quarter_phase, attainment_pct)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [
    input.workspaceId, input.templateType, input.sectionId,
    input.systemPromptAtTime, rawText, editedText,
    editDistance, derivedSignals,
    JSON.stringify(input.sessionContext.voiceProfile),
    input.sessionContext.voiceContext?.quarter_phase,
    input.sessionContext.voiceContext?.attainment_pct
  ]);
  
  // Update section preferences in WorkspaceDocumentProfile
  await updateSectionPreferencesFromEdit(
    input.workspaceId, input.templateType, input.sectionId,
    editDistance, derivedSignals
  );
  
  // Increment training pairs count
  await configLoader.updateDocumentProfile(input.workspaceId, {
    trainingPairsCount: { $increment: 1 }
  });
}

function calculateNormalizedEditDistance(a: string, b: string): number {
  // Use word-level diff for meaningful distance
  const diff = diffWords(a, b);
  const changedWords = diff.filter(d => d.added || d.removed).reduce((n, d) => n + d.count!, 0);
  const totalWords = diff.reduce((n, d) => n + d.count!, 0);
  return totalWords > 0 ? changedWords / totalWords : 0;
}

function extractStyleSignals(rawText: string, editedText: string): string[] {
  const signals: string[] = [];
  
  // Length preference
  const rawWords = rawText.split(/\s+/).length;
  const editedWords = editedText.split(/\s+/).length;
  const lengthRatio = editedWords / rawWords;
  if (lengthRatio < 0.7) signals.push('prefers_shorter');
  if (lengthRatio > 1.3) signals.push('prefers_longer');
  
  // Hedge phrase removal
  const hedges = ['it appears', 'it seems', 'it may be', 'potentially', 'could potentially'];
  const rawHedgeCount = hedges.filter(h => rawText.toLowerCase().includes(h)).length;
  const editedHedgeCount = hedges.filter(h => editedText.toLowerCase().includes(h)).length;
  if (rawHedgeCount > editedHedgeCount) signals.push('removes_hedge_phrases');
  
  // Pronoun changes
  if (rawText.includes('the team') && editedText.includes('we')) signals.push('prefers_we_pronoun');
  if (rawText.includes('we') && editedText.includes('your team')) signals.push('prefers_you_pronoun');
  
  // Entity naming
  if (rawText.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/) && !editedText.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/)) {
    signals.push('removes_rep_names');
  }
  
  // Lead sentence changes (first sentence heavily changed = lead preference)
  const rawFirstSentence = rawText.split(/[.!?]/)[0];
  const editedFirstSentence = editedText.split(/[.!?]/)[0];
  const firstSentenceDistance = calculateNormalizedEditDistance(rawFirstSentence, editedFirstSentence);
  if (firstSentenceDistance > 0.5) signals.push('changed_opening_framing');
  
  // Numbers added or removed
  const rawNumbers = (rawText.match(/\$[\d,]+[KMB]?|\d+%/g) || []).length;
  const editedNumbers = (editedText.match(/\$[\d,]+[KMB]?|\d+%/g) || []).length;
  if (editedNumbers > rawNumbers) signals.push('adds_more_numbers');
  if (editedNumbers < rawNumbers) signals.push('removes_numbers');
  
  return signals;
}

async function updateSectionPreferencesFromEdit(
  workspaceId: string,
  templateType: string,
  sectionId: string,
  editDistance: number,
  newSignals: string[]
): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  const existing = profile.sectionPreferences?.[templateType]?.[sectionId];
  
  // Accumulate style signals (deduplicate, keep most frequent)
  const allSignals = [...(existing?.styleSignals || []), ...newSignals];
  const signalCounts = allSignals.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {} as Record<string, number>);
  const topSignals = Object.entries(signalCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([s]) => s);
  
  // Update length preference based on accumulated edits
  const preferredLength = newSignals.includes('prefers_shorter') ? 'shorter'
    : newSignals.includes('prefers_longer') ? 'longer'
    : existing?.preferredLength || 'current';
  
  const editCount = (existing?.editCount || 0) + 1;
  const avgEditDistance = existing
    ? (existing.averageEditDistance * existing.editCount + editDistance) / editCount
    : editDistance;
  
  await configLoader.updateDocumentProfile(workspaceId, {
    sectionPreferences: {
      [templateType]: {
        [sectionId]: {
          preferredLength,
          styleSignals: topSignals,
          editCount,
          averageEditDistance: avgEditDistance,
          lastEditedAt: new Date().toISOString(),
        }
      }
    }
  });
}
```

**Acceptance:** Edit any section in the distribution review panel. A `document_edit` record is written. A `training_pair` record is written with the full system prompt, raw output, and corrected output. Style signals are extracted and match the actual changes made. The section's `averageEditDistance` increments in the workspace document profile.

---

### F3 — Profile-Aware Document Assembly

**Files:** `server/documents/synthesizer.ts` (update T012), `server/documents/profile-injector.ts` (new)

The `WorkspaceDocumentProfile` is only useful if it shapes document generation. This task wires the profile into the synthesis prompt before every document is assembled.

```typescript
// server/documents/profile-injector.ts

export function buildProfileAwareSystemPrompt(
  profile: WorkspaceDocumentProfile,
  templateType: string,
  sectionId: string,
  basePrompt: string
): string {
  const sectionPrefs = profile.sectionPreferences?.[templateType]?.[sectionId];
  const calibration = profile.calibration?.answers;
  
  const injections: string[] = [basePrompt];
  
  // ── Calibration-derived instructions ──
  if (calibration) {
    if (calibration.execSummaryLeadsWith && sectionId === 'exec_summary') {
      const leadMap = {
        'attainment': 'Open with current attainment against target.',
        'close_plan': 'Open with what needs to close and by when. Attainment is context, not the headline.',
        'risk': 'Open with the biggest risk to the quarter. Everything else is context.',
        'wins': 'Open by acknowledging what closed or improved. Then pivot to what needs attention.'
      };
      injections.push(leadMap[calibration.execSummaryLeadsWith]);
    }
    
    if (calibration.riskSectionNameReps === false && sectionId === 'key_risks') {
      injections.push('Do not name individual reps in this section. Reference deal names or stages only.');
    }
    
    if (calibration.recommendationsStyle === 'collaborative' && sectionId === 'recommendations') {
      injections.push('Frame recommendations as suggestions, not directives. Use "consider" and "it may be worth" rather than "needs to" and "must".');
    }
    
    if (calibration.audienceExpectation === 'action_only') {
      injections.push('This audience wants actions only. No narrative context. No data unless it directly supports an action. Bullet the actions.');
    }
    
    if (calibration.execSummaryMaxParagraphs && sectionId === 'exec_summary') {
      injections.push(`Keep this to ${calibration.execSummaryMaxParagraphs} paragraph${calibration.execSummaryMaxParagraphs > 1 ? 's' : ''} maximum.`);
    }
  }
  
  // ── Edit-history-derived instructions ──
  if (sectionPrefs?.styleSignals?.length) {
    const signalInstructions: Record<string, string> = {
      'prefers_shorter': 'Be concise. This workspace consistently shortens this section.',
      'prefers_longer': 'Be thorough. This workspace consistently expands this section with more context.',
      'removes_hedge_phrases': 'No hedge phrases. This workspace removes them every time.',
      'prefers_we_pronoun': 'Use "we" consistently. This workspace always changes "the team" to "we".',
      'removes_rep_names': 'Do not name individual reps in this section.',
      'changed_opening_framing': 'The opening sentence of this section is frequently rewritten — vary the framing from the default.',
      'adds_more_numbers': 'Include specific numbers and percentages throughout.',
      'removes_numbers': 'Lead with interpretation, not raw numbers.',
    };
    
    const activeInstructions = sectionPrefs.styleSignals
      .map(s => signalInstructions[s])
      .filter(Boolean);
    
    if (activeInstructions.length) {
      injections.push('\nWorkspace-learned preferences for this section:');
      injections.push(...activeInstructions);
    }
  }
  
  // ── Length preference ──
  if (sectionPrefs?.preferredLength === 'shorter') {
    injections.push('This workspace consistently shortens this section. Be brief.');
  } else if (sectionPrefs?.preferredLength === 'longer') {
    injections.push('This workspace consistently expands this section. Be thorough.');
  }
  
  return injections.join('\n');
}
```

**Wire into synthesizer (T012 update):**

```typescript
// In server/documents/synthesizer.ts
// Before each section synthesis call, inject profile instructions:

const profile = await configLoader.getDocumentProfile(workspaceId);

for (const section of document.sections) {
  const basePrompt = buildSectionSynthesisPrompt(section, document);
  const profileAwarePrompt = buildProfileAwareSystemPrompt(
    profile, document.template, section.id, basePrompt
  );
  
  section.narrativeBridge = await llmClient.complete(profileAwarePrompt, sectionContext);
}
```

**Acceptance:** Generate a document for a workspace that has `sectionPreferences.weekly_business_review.exec_summary.styleSignals = ['prefers_shorter', 'removes_hedge_phrases']`. The generated executive summary should be shorter than the default and contain no hedge phrases. Inspect the system prompt — it should contain the workspace-learned preference instructions.

---

### F4 — Implicit Signal Capture

**Files:** `server/documents/signal-tracker.ts` (new), update `server/documents/distributor.ts` (T013), update T018 (recommendation tracking)

Loop 2 — capture implicit signals without asking the user anything.

**Signal 1 — Slack engagement:** After distributing to Slack (T013), schedule a check 24 hours later to fetch reaction and reply counts on the distribution message:

```typescript
// In server/documents/signal-tracker.ts

async function captureSlackEngagement(
  workspaceId: string,
  documentId: string,
  templateType: string,
  slackMessageTs: string,
  slackChannel: string
): Promise<void> {
  // Schedule a 24h delayed check
  setTimeout(async () => {
    try {
      const reactions = await slackClient.getReactions(slackChannel, slackMessageTs);
      const replies = await slackClient.getReplies(slackChannel, slackMessageTs);
      
      const totalReactions = reactions.reduce((n, r) => n + r.count, 0);
      const totalReplies = replies.length;
      
      // Update distribution record
      await db.query(`
        UPDATE document_distributions
        SET metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{slack_engagement}',
          $1::jsonb
        )
        WHERE document_id = $2 AND channel = 'slack'
      `, [JSON.stringify({ reactions: totalReactions, replies: totalReplies }), documentId]);
      
      // Update workspace document profile engagement averages
      await updateEngagementAverages(workspaceId, templateType, totalReactions, totalReplies);
      
      // Recalculate quality score
      await recalculateQualityScore(workspaceId);
      
    } catch (err) {
      console.warn('[SignalTracker] Slack engagement fetch failed:', err);
    }
  }, 24 * 60 * 60 * 1000);
}
```

**Signal 2 — Distribution rate:** A document that never gets distributed is a document the user didn't trust enough to send. Track this:

```typescript
// After render, if no distribution happens within 48h, flag as "rendered but not sent"
// This is a weak negative signal — low weight but worth tracking

async function checkDistributionDeadline(
  workspaceId: string,
  documentId: string,
  templateType: string
): Promise<void> {
  setTimeout(async () => {
    const distributed = await db.query(
      `SELECT id FROM document_distributions WHERE document_id = $1 LIMIT 1`,
      [documentId]
    );
    
    if (distributed.rows.length === 0) {
      // Document was rendered but never sent
      await writeTrainingSignal(workspaceId, documentId, templateType, 'rendered_not_distributed');
      await recalculateQualityScore(workspaceId);
    }
  }, 48 * 60 * 60 * 1000);
}
```

**Signal 3 — Recommendation actioning rate (from T018):** When T018 resolves a recommendation, update the `training_pairs` record that came from the document containing that recommendation:

```typescript
// In server/documents/recommendation-tracker.ts (update T018)
// After resolveRecommendation():

await db.query(`
  UPDATE training_pairs
  SET recommendations_actioned = recommendations_actioned + 1,
      was_distributed = TRUE
  WHERE workspace_id = $1
    AND id = (
      SELECT tp.id FROM training_pairs tp
      JOIN document_edits de ON de.workspace_id = tp.workspace_id
      WHERE de.document_id = $2
      ORDER BY de.edited_at DESC
      LIMIT 1
    )
`, [workspaceId, documentId]);
```

**Quality score recalculation:**

```typescript
async function recalculateQualityScore(workspaceId: string): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  
  // Pull recent metrics (last 10 documents)
  const recentDocs = await db.query(`
    SELECT 
      AVG(tp.edit_distance) as avg_edit_distance,
      AVG(tp.recommendations_actioned) as avg_recs_actioned,
      COUNT(CASE WHEN tp.was_distributed THEN 1 END)::float / COUNT(*) as distribution_rate
    FROM training_pairs tp
    WHERE tp.workspace_id = $1
    ORDER BY tp.created_at DESC
    LIMIT 10
  `, [workspaceId]);
  
  const { avg_edit_distance, avg_recs_actioned, distribution_rate } = recentDocs.rows[0];
  
  const weights = profile.qualityScores.derivedFrom;
  
  // Lower edit distance = better. Scale 0-1 where 1 = never edited.
  const editScore = Math.max(0, 1 - (avg_edit_distance || 0));
  
  // Higher rec actioning = better. Cap at 3 recs per doc as "excellent".
  const actionScore = Math.min(1, (avg_recs_actioned || 0) / 3);
  
  // Higher distribution rate = better. 1.0 = every document sent.
  const distScore = distribution_rate || 0;
  
  const overall = Math.round(
    (editScore * weights.editRateWeight +
     actionScore * weights.actionRateWeight +
     distScore * weights.distributionRateWeight) * 100
  );
  
  await configLoader.updateDocumentProfile(workspaceId, {
    qualityScores: {
      overall,
      lastCalculatedAt: new Date().toISOString(),
      trend: determineTrend(profile.qualityScores.overall, overall)
    }
  });
}
```

**Acceptance:** Distribute a document to Slack. 24 hours later (or with a test override), the distribution record has slack engagement data. Render a document and don't distribute it — after 48h the document is flagged as rendered-not-sent. The quality score recalculates after each signal capture.

---

### F5 — Calibration Session Engine

**Files:** `server/documents/calibration.ts` (new), `client/src/components/documents/CalibrationSession.tsx` (new)

The calibration session is a structured conversation that Pandora initiates proactively. It's not a settings form — it's a dialogue where Pandora shows examples from recent documents and asks targeted questions about them.

**Trigger conditions:**

```typescript
async function shouldTriggerCalibration(workspaceId: string): Promise<{
  shouldTrigger: boolean;
  reason: string | null;
}> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  const docsGenerated = await countDocumentsGenerated(workspaceId);
  
  // First calibration: after 3 documents generated and never calibrated
  if (docsGenerated >= 3 && !profile.calibration.completedAt) {
    return { shouldTrigger: true, reason: 'first_calibration' };
  }
  
  // Heavy editing: if last 2 documents had avg edit distance > 0.4
  const recentEdits = await getRecentEditDistances(workspaceId, 2);
  if (recentEdits.length >= 2 && recentEdits.every(d => d > 0.4)) {
    return { shouldTrigger: true, reason: 'heavy_editing' };
  }
  
  // Quarterly refresh
  if (profile.calibration.nextScheduledAt) {
    const nextScheduled = new Date(profile.calibration.nextScheduledAt);
    if (new Date() >= nextScheduled) {
      return { shouldTrigger: true, reason: 'quarterly_refresh' };
    }
  }
  
  return { shouldTrigger: false, reason: null };
}
```

**Calibration session structure:**

The calibration runs as a multi-step conversation in the chat interface. It uses the existing Ask Pandora chat surface — the calibration session IS a chat conversation, just one that Pandora initiates with structured questions.

```typescript
// server/documents/calibration.ts

interface CalibrationQuestion {
  id: string;
  question: string;
  context: string;         // Why Pandora is asking this
  exampleA?: string;       // Show two versions (from recent docs) and ask which is better
  exampleB?: string;
  answerType: 'choice' | 'text' | 'example_preference';
  answerOptions?: string[];
  profileField: string;    // Which calibration.answers field this maps to
}

const CALIBRATION_QUESTIONS: CalibrationQuestion[] = [
  {
    id: 'exec_summary_lead',
    question: "When your CRO reads the executive summary — what does she want to see first?",
    context: "I've been leading with attainment. But some leaders want to see the close plan first, others want the biggest risk up front.",
    exampleA: "We're at 21% with 26 days left. The gap is $278K. Here's what needs to close...",
    exampleB: "The quarter closes in 26 days and we need $278K. Behavioral Framework at $105K is the biggest swing deal — it needs an economic buyer by Wednesday.",
    answerType: 'example_preference',
    answerOptions: ['First version (attainment first)', 'Second version (close plan first)', 'Neither — start with the biggest risk'],
    profileField: 'execSummaryLeadsWith'
  },
  {
    id: 'rep_naming_in_risks',
    question: "When I flag a deal risk, should I name the rep responsible?",
    context: "Right now I write 'Sara's Behavioral Framework deal is single-threaded.' Some VPs prefer to keep risks deal-level in shared documents.",
    answerType: 'choice',
    answerOptions: ['Yes — name the rep', 'No — keep it deal-level', 'Depends on who sees the document'],
    profileField: 'riskSectionNameReps'
  },
  {
    id: 'comparison_block',
    question: "The 'Since last week' comparison — where does it belong?",
    context: "I put it near the top of the brief so you see changes immediately. Some prefer it as an appendix so the main brief leads with current state.",
    answerType: 'choice',
    answerOptions: ['Keep it at the top', 'Move it to the appendix', 'I don\'t need it in the document'],
    profileField: 'comparisonBlockPosition'
  },
  {
    id: 'recommendation_style',
    question: "How should I phrase recommendations — directive or collaborative?",
    exampleA: "Sara needs to add an economic buyer to Behavioral Framework by Monday.",
    exampleB: "Consider having Sara add a second contact to Behavioral Framework before the week ends.",
    answerType: 'example_preference',
    answerOptions: ['First version (directive)', 'Second version (collaborative)'],
    profileField: 'recommendationsStyle'
  },
  {
    id: 'primary_audience',
    question: "Who is the primary reader of these documents?",
    context: "The answer changes how I write — a CRO wants executive brevity, an ops team wants the full evidence.",
    answerType: 'choice',
    answerOptions: ['VP RevOps (you)', 'CRO / CEO', 'Full leadership team', 'Ops team internally'],
    profileField: 'primaryAudience'
  },
  {
    id: 'exec_summary_length',
    question: "How long should the executive summary be?",
    context: "Currently writing 2 paragraphs. Some leaders want one punchy paragraph. Analysts want three.",
    answerType: 'choice',
    answerOptions: ['One paragraph — keep it tight', 'Two paragraphs (current)', 'Three or more — I want the full picture'],
    profileField: 'execSummaryMaxParagraphs'
  }
];
```

**Calibration session flow:**

```typescript
export async function runCalibrationSession(workspaceId: string): Promise<void> {
  // Returns questions as a structured conversation turn in the chat
  // Each answer is captured and stored incrementally (don't lose partial completion)
  
  const questions = CALIBRATION_QUESTIONS;
  const answers: Partial<CalibrationAnswers> = {};
  
  // Opening message from Pandora (in teammate voice):
  const opening = `I've generated a few documents now and I want to make sure I'm building the right thing for how Frontera actually runs — not just the default.

I have ${questions.length} quick questions. These aren't a settings form — they're things I've noticed where I'm not sure I'm getting it right. Takes about 3 minutes.`;
  
  // Questions are surfaced one at a time as chat messages
  // Each answer triggers the next question
  // If the user says "skip" or "not sure" — mark as null and move on
  
  // Closing message after all answers:
  const closing = buildCalibrationClosingMessage(answers);
  // "Here's what I heard: Lead with close plan, name deals but not reps in risks, 
  //  keep 'Since last week' at the top, directive recommendations, writing for the CRO.
  //  I'll apply this to every document going forward. If anything sounds wrong, just tell me."
  
  // Save answers to workspace document profile
  await configLoader.updateDocumentProfile(workspaceId, {
    calibration: {
      completedAt: new Date().toISOString(),
      completedSessions: (await configLoader.getDocumentProfile(workspaceId)).calibration.completedSessions + 1,
      nextScheduledAt: getNextQuarterDate(),
      answers: mapAnswersToProfile(answers)
    }
  });
}

function buildCalibrationClosingMessage(answers: Partial<CalibrationAnswers>): string {
  const lines: string[] = ["Here's what I learned:"];
  
  if (answers.execSummaryLeadsWith) {
    const leadMap = {
      'attainment': 'Lead exec summary with attainment',
      'close_plan': 'Lead exec summary with close plan',
      'risk': 'Lead exec summary with biggest risk'
    };
    lines.push(`· ${leadMap[answers.execSummaryLeadsWith]}`);
  }
  
  if (answers.riskSectionNameReps !== undefined) {
    lines.push(`· ${answers.riskSectionNameReps ? 'Name reps' : 'Keep risks deal-level'} in the risk section`);
  }
  // ... etc for each answer
  
  lines.push(`\nI'll apply this to every document going forward. If anything sounds wrong, correct me and I'll update immediately.`);
  
  return lines.join('\n');
}
```

**Calibration UI component:**

The calibration renders in the chat surface as special message cards — not plain text. Each question card shows:
- The question text and context
- If `example_preference`: two labeled code blocks side by side
- If `choice`: pill buttons for each option
- If `text`: a text input

Answer selection is immediate (no "submit" button) and triggers the next question inline.

**Calibration trigger surface:** Show a "Calibrate Pandora for this workspace" prompt in two places:
1. The document pill (T011) — a small "Calibrate →" link below the Render button when calibration hasn't been completed
2. After the distribution review panel (T013) — if the user edited more than 2 sections, show: "You made several edits. Want to spend 3 minutes calibrating so I get this right next time? [Calibrate →] [Not now]"

**Acceptance:** The calibration session triggers after 3 documents or heavy editing. Questions render as structured cards in the chat interface. Each answer is saved incrementally — closing the session mid-way doesn't lose answers already given. The closing message accurately summarizes the answers. After completion, `calibration.completedAt` is set and `calibration.answers` contains the answers. The next document assembly uses the calibration answers in the prompt.

---

### F6 — Training Pair Export + Quality Dashboard

**Files:** `server/routes/training.ts` (new), `client/src/pages/admin/DocumentQuality.tsx` (new)

**Training pair export endpoint:**

```
GET /api/workspaces/:id/training-pairs/export
    Query params: ?format=jsonl&quality=good,needs_improvement&min_edit_distance=0.1
    Auth: admin only
    Returns: JSONL file where each line is:
      {
        "prompt": "...",       // the system_prompt_at_time
        "completion": "...",   // the corrected_output
        "quality": "good",
        "workspace_id": "...",
        "template_type": "...",
        "section_id": "..."
      }
```

This is the Fireworks AI fine-tuning format. When you're ready to fine-tune, export all `good` quality pairs across all workspaces, remove `workspace_id` (anonymize), and submit to Fireworks.

**Cross-workspace export (super-admin only):**

```
GET /api/admin/training-pairs/export-all
    Auth: super-admin only
    Query params: ?quality=good&min_pairs_per_workspace=10
    Returns: JSONL of all good pairs across all workspaces (workspace_id stripped)
```

**Admin Document Quality page:**

A simple admin page at `/admin/document-quality` (or under workspace settings) showing:

```
Document Quality — Frontera Health

Overall Score: 74 / 100  [▲ Improving]

  Edit Rate (last 10 docs):      0.18 avg  → Low edits = high quality
  Rec Actioning Rate:            67%       → 2 of 3 recs actioned within 48h
  Distribution Rate:             90%       → 9 of 10 documents were sent

Training Pairs: 23 / 500
[██░░░░░░░░░░░░░░░░░░] 4.6% toward fine-tuning threshold

By Template:
  Weekly Business Review    Score: 81  [12 pairs]
  Forecast Memo             Score: 68  [8 pairs]
  Ad Hoc Analysis           Score: 61  [3 pairs]

Most Edited Sections:
  exec_summary              Avg edit distance: 0.42  ← needs calibration
  key_risks                 Avg edit distance: 0.28
  recommendations           Avg edit distance: 0.11  ← well-calibrated

Calibration Status: Completed Jan 15, 2026 · Next: Apr 15, 2026
[Run Calibration Now →]

[Export Training Pairs →]
```

The "Most Edited Sections" list is the most actionable part of this page — sections with high average edit distance are the ones where the profile-aware prompt isn't working yet. Those are candidates for targeted calibration questions or manual style signal review.

**Acceptance:** The quality dashboard loads and shows accurate metrics derived from `training_pairs` and `document_edits`. The training pair export endpoint returns valid JSONL. Filtering by quality label works. The cross-workspace export strips workspace_id from all records.

---

## Sequencing

```
F1 (schema + storage) — first, everything else depends on it
  ↓
F2 (edit capture + diff) — depends on F1 schema
F4 (implicit signals) — depends on F1 schema + T018
  ↓ (both can run in parallel after F1)
F3 (profile-aware assembly) — depends on F1 + F2 (needs accumulated preferences)
F5 (calibration session) — depends on F1, can run after F1
  ↓
F6 (export + dashboard) — depends on F1 + F2 + F4, can run last
```

Build order: F1 → F2 and F4 in parallel → F3 and F5 in parallel → F6.

---

## Acceptance Criteria — Full Suite

1. **Edit capture works end-to-end.** Edit the executive summary before distribution. A `document_edit` record exists with the correct diff. A `training_pair` record exists with the full system prompt, raw output, and corrected output. Style signals are extracted and match the changes made.

2. **Profile-aware assembly fires.** After accumulating 3+ edits on a section with `removes_hedge_phrases` signal, generate a new document. Inspect the system prompt — it should contain "No hedge phrases. This workspace removes them every time." The generated section should have no hedge phrases.

3. **Calibration triggers correctly.** Generate 3 documents without completing calibration. A "Calibrate Pandora" prompt appears. Start the calibration — questions render as structured cards. Answer 3 questions, close the session. The 3 answered questions are saved. Reopen and complete — `calibration.completedAt` is set.

4. **Calibration answers shape documents.** Set `execSummaryLeadsWith: 'risk'` via calibration. Generate a new document. The executive summary opens with the biggest risk, not attainment.

5. **Implicit signals accumulate.** Distribute to Slack. 24 hours later the distribution record has engagement data. Render a document and don't distribute — after 48h it's flagged rendered-not-distributed. The quality score updates after each signal.

6. **Quality score reflects real signal.** A workspace with low edit distance, high rec actioning, and 90% distribution rate should score 80+. A workspace with high edits and no distribution should score below 50.

7. **Training pair export is valid JSONL.** Export with `quality=good`. Open the file — each line is valid JSON with `prompt`, `completion`, `quality`, `template_type`, `section_id` fields. No workspace PII in the cross-workspace export.

8. **Quality dashboard loads correctly.** Overall score, by-template scores, most-edited sections, training pair count and progress bar, calibration status — all accurate.

9. **No regression.** T011–T013, T019, V1–V4 all continue to work. The profile-aware assembly is additive — documents still generate correctly if the profile is empty or uncalibrated.

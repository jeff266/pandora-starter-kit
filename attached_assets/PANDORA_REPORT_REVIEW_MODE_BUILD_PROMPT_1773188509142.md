# Pandora Report Review Mode — Build Prompt

## Objective

Build an interactive Report Review Mode for CROs and VP RevOps that transforms static agent
reports into collaborative working documents. Three capabilities, sequenced by value and
implementation complexity:

1. **Inline annotation + V2 versioning** — TipTap-powered edit mode where executives
   strike through items, add notes, and override metric values; saves as a V2 generation
   with human edits clearly distinguished from AI output
2. **Right-click → Ask Pandora contextual deepdive** — select any metric, narrative claim,
   or table row and open Ask Pandora pre-seeded with that data + its backing evidence
3. **Export the annotated V2** — existing PDF/DOCX/PPTX pipeline picks up human
   annotations and renders them into the final document (strikethroughs, callout boxes,
   revised-by footer)

---

## What Exists

- `ReportViewer.tsx` — renders past report generations with a timeline sidebar
- `ReportContent.tsx` + `MetricCard.tsx`, `DataTable.tsx`, `ActionItem.tsx` — individual
  block renderers
- `report_generations` DB table — stores `sections_content` (JSON) and generation metadata
- Show Math: `forecast-math.ts` + `MathBreakdown.tsx` — evidence drill-down already works
- Export: PDF, DOCX, PPTX, XLSX renderers in `server/renderers/`
- `ChatPanel` with `initialSessionId` prop — supports pre-seeded context
- Ask Pandora pipeline resolver — accepts system context injections
- `agent_tuning_pairs` table — captures preference/feedback signal for fine-tuning

---

## What Needs Building

- Migration 156: annotation fields on `report_generations`
- TipTap editor integration replacing raw `contenteditable` approach
- `ReportContextMenu.tsx` — right-click → Ask Pandora with evidence context
- Edit mode toggle + TipTap annotation layer in `ReportViewer`
- V2 save API + version badge rendering
- Annotation-aware export renderer pass-through
- `agent_tuning_pairs` write-back when annotations are saved

---

## Task Sequence

### T1: Migration 156 — Annotation fields on `report_generations`

**Blocked By:** []

**Details:**

Create `migrations/156_report_annotations.sql`. Add to `report_generations`:

```sql
version              INTEGER NOT NULL DEFAULT 1,
-- 1 = AI original, 2+ = human-edited

parent_generation_id UUID REFERENCES report_generations(id),
-- links V2 back to V1

human_annotations    JSONB,
-- Array of:
-- {
--   block_id: string,
--   type: 'strike' | 'override' | 'note',
--   original_value: string,
--   new_value: string | null,
--   annotated_by: uuid,
--   annotated_at: timestamptz
-- }

annotated_by         UUID REFERENCES users(id),
annotated_at         TIMESTAMPTZ
```

Run `npm run migrate`.

**Acceptance:** Migration applies cleanly; `report_generations` has the new columns.

---

### T2: TipTap Annotation Editor

**Blocked By:** [T1]

**Why TipTap over `contenteditable`:**
Raw `contenteditable` is fragile and doesn't produce structured annotation data.
TipTap (built on ProseMirror) supports custom node extensions, stays TypeScript-native,
and serializes to JSON — which maps cleanly to the `human_annotations` JSONB schema.
The annotation diff on "Save as V2" is computed by comparing the original `sections_content`
JSON to the TipTap document JSON, not by diffing free-form HTML.

**Install:**
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-strike @tiptap/extension-placeholder
```

**Details:**

Create `client/src/components/reports/ReportAnnotationEditor.tsx`:

- Accepts `generationId`, `sectionsContent` (the original report JSON), and
  `existingAnnotations` as props
- On mount, serializes `sectionsContent` into a TipTap document schema where:
  - Narrative paragraphs → TipTap `paragraph` nodes (editable)
  - `MetricCard` values → custom `metricNode` extension with an "Override" affordance
  - `ActionItem` entries → custom `actionNode` extension with a strike toggle
- Tracks annotation state in a `Map<blockId, Annotation>` derived from TipTap's
  onChange events
- On "Save as V2", extracts the diff between original and current TipTap doc,
  serializes to the `human_annotations` array schema defined in T1

In `ReportViewer.tsx`:

- Add "Annotate" toggle button in report header toolbar (admin/manager roles only,
  guarded by `usePermissions`)
- When annotation mode is active:
  - Teal "EDIT MODE" banner appears at top of report
  - `ReportContent` is replaced with `ReportAnnotationEditor`
  - Floating annotation toolbar: "Strike", "Add Note", "Reset" actions
  - "Save as V2" button in toolbar

**Files:** `client/src/components/reports/ReportAnnotationEditor.tsx`,
`client/src/pages/ReportViewer.tsx`

**Acceptance:** Toggling annotate mode renders TipTap editor; striking an action item
shows strikethrough styling; "Save as V2" fires the API call with structured annotation JSON.

---

### T3: V2 Save API + Version Badge

**Blocked By:** [T2]

**Details:**

Add endpoint to `server/routes/reports.ts`:

```
POST /api/:workspaceId/reports/:reportId/generations
```

Body:
```json
{
  "parent_generation_id": "<currentGenerationId>",
  "human_annotations": [...],
  "version": 2,
  "sections_content": "<original merged with annotation overrides>"
}
```

Creates a new `report_generations` record with `version = parent.version + 1`.

In `ReportContent.tsx`, when `version > 1`:

- Show "V2 — Edited by [name] on [date]" badge in report header
- Show "View original (V1) →" link that navigates to `parent_generation_id`
- Struck-through `ActionItem` renders with `text-decoration: line-through`, muted
  opacity, and a small "removed by [name]" label
- Overridden `MetricCard` shows original AI value (muted strikethrough) and new human
  value (teal)
- Narrative overrides show teal left border; hovering reveals original AI text in tooltip
- Margin notes render as teal callout block below the parent element

**Files:** `server/routes/reports.ts`, `client/src/components/reports/ReportContent.tsx`,
`MetricCard.tsx`, `ActionItem.tsx`, `client/src/pages/ReportViewer.tsx`

**Acceptance:** "Save as V2" creates a new generation record; timeline sidebar shows V1
and V2; switching to V2 shows annotated version with correct visual treatment.

---

### T4: Feedback Signal → `agent_tuning_pairs`

**Blocked By:** [T3]

**Why this matters:**
When a CRO strikes out a finding or overrides a metric, that annotation is a preference
signal — the human is implicitly saying "this AI output was wrong." These are exactly the
training pairs needed for fine-tuning. Wire this from day one so V2 edits accumulate as
quality training data rather than being discarded.

**Details:**

In the V2 save handler (`server/routes/reports.ts`), after writing the new
`report_generations` record, iterate over `human_annotations` and write to
`agent_tuning_pairs` for each annotation where `type = 'strike' | 'override'`:

```typescript
// For each annotation of type 'strike' or 'override':
await db.insert(agentTuningPairs).values({
  workspace_id,
  skill_id: generation.skill_id,        // which skill produced the finding
  generation_id: newGenerationId,
  input_context: annotation.original_value,   // what the model said
  preferred_output: annotation.new_value,     // what the human corrected it to
  rejected_output: annotation.original_value,
  annotation_type: annotation.type,           // 'strike' or 'override'
  created_by: annotation.annotated_by,
  created_at: annotation.annotated_at,
  source: 'report_annotation'                 // distinguish from other feedback paths
});
```

Only write pairs where `new_value` is non-null (strikes without a replacement are
negative signal but not a training pair yet — skip them for now, add a `negative_only`
flag later).

**Files:** `server/routes/reports.ts`, `server/db/schema.ts` (add `source` field to
`agent_tuning_pairs` if not present)

**Acceptance:** After saving a V2 with one metric override and one strikethrough, query
`agent_tuning_pairs` and confirm a new row exists with `source = 'report_annotation'`
and the correct `input_context` / `preferred_output` values.

---

### T5: Right-click → Ask Pandora Contextual Deepdive

**Blocked By:** [T1]

**Details:**

Create `client/src/components/reports/ReportContextMenu.tsx` — a floating context menu
component anchored to mouse position with:
- "Ask Pandora about this →" action
- "Copy value" action
- "Show backing data" action (if evidence exists in `skill_runs`)

Wrap each block type (`MetricCard`, `DataTable` rows, narrative paragraphs, `ActionItem`)
in `ReportContent.tsx` with an `onContextMenu` handler that captures:
element type, label, value, section title, and any linked evidence records from `skill_runs`.

The "Ask Pandora" action calls a new `openReportDeepDive(context)` function that:

1. Opens the `ChatPanel` (using existing `chatInitialSession` flow)
2. Seeds the conversation with a system-injected context block:

```
"The user is reviewing a report section titled '{section}'.
The specific data point they selected: {label} = {value}.
Backing evidence: {evidence_rows}.
Help them understand this figure or investigate further."
```

The context menu dismisses on outside click or Escape.

**Files:** `client/src/components/reports/ReportContextMenu.tsx`,
`client/src/components/reports/ReportContent.tsx`,
`client/src/pages/ReportViewer.tsx`

**Acceptance:** Right-clicking a metric in a report shows the context menu; clicking
"Ask Pandora about this" opens the chat panel with the metric value and evidence
pre-loaded in the conversation context.

---

### T6: Export Annotated V2

**Blocked By:** [T3]

**Details:**

The existing `GET /reports/:reportId/download/:format` route already loads the generation
record. Ensure it reads `human_annotations` and passes them to the renderer.

Update `server/renderers/docx-renderer.ts` and `server/renderers/report-pdf-renderer.ts`
to accept and apply `human_annotations`:

- Struck action items → strikethrough text style in DOCX/PDF
- Overridden metrics → show original (strikethrough) + new value
- Notes → rendered as indented callout paragraphs in italic
- Add "Revised by [name] · [date]" line to document footer in DOCX and PDF

**Files:** `server/renderers/docx-renderer.ts`, `server/renderers/report-pdf-renderer.ts`,
`server/routes/reports.ts`

**Acceptance:** Downloading a V2 report as PDF or DOCX shows strikethroughs, overridden
values, notes, and the "Revised by" footer.

---

## Design Notes

**Visual language for annotations (Pandora dark theme):**
- Edit mode banner: teal background, `EDIT MODE` in white caps, full-width
- Struck items: `opacity: 0.45`, `text-decoration: line-through`, coral strike color
- Override new values: teal (`#00BFA5`), bold
- Override original values: muted gray strikethrough
- Margin notes: teal left border (`2px solid #00BFA5`), `bg-teal-950/30`, italic text
- V2 badge in header: teal pill, "V2 · Edited by [name] · [date]"
- "View original (V1) →" as a small ghost link adjacent to the V2 badge

**Annotation scope:**
- Only admin and manager roles can enter annotation mode (`usePermissions` guard)
- All workspace members can view V2 annotations in read mode

**TipTap custom node pattern:**
- Each Pandora block type (MetricCard, ActionItem) should be a TipTap Node extension
- The node's `renderHTML` returns the existing React component markup
- The node's `parseHTML` deserializes from `sections_content` JSON on editor init
- On `editor.getJSON()`, extract the structured diff — don't use innerHTML parsing

**Feedback signal quality gate:**
- Minimum 5 annotation pairs per skill before `skill_feedback_scores` table is updated
  (consistent with the existing preference learning threshold)
- `source = 'report_annotation'` distinguishes these pairs from thumbs-up/down feedback
  and A/B comparison votes

**Lock Report (future):**
- After V2 is saved, a "Lock" action freezes it as canonical for that period
- Prevents drift from post-hoc edits and provides audit trail
- Defer until T3 is validated with design partners

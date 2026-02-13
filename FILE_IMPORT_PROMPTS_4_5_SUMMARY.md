# File Import: Prompts 4 & 5 Implementation Summary

**Built**: February 12, 2026
**Prompts**: AI Column Classification (4) + Stage Mapping with DeepSeek (5)

---

## What Was Built

### Prompt 4: DeepSeek-Powered Column Classification

**File**: `server/import/ai-classifier.ts` (301 lines)

**Purpose**: Automatically map CSV/Excel columns to normalized entity fields using DeepSeek AI

**Key Features**:
- Entity-specific prompts for deals, contacts, and accounts
- Confidence scores for each mapped column
- Detects source CRM, currency, date format, amount format
- Extracts unique stage values for deals
- Row issue detection (missing required, unparseable values)
- Falls back to heuristic mapper if AI fails

**Classification Output**:
```typescript
interface DealClassification {
  mapping: {
    name, amount, stage, close_date, owner, pipeline,
    probability, account_name, external_id, created_date,
    forecast_category, stage_entered_date: ColumnMapping
  };
  source_crm: string;
  currency: string;
  date_format: string;
  has_header_row: boolean;
  amount_format: string;
  stage_values: string[];
  unmapped_columns: string[];
  row_issues: { missing_required, unparseable_amounts, unparseable_dates };
  notes: string;
}
```

**Integration**: Updated `server/routes/import.ts` POST `/upload` endpoint
- Tries AI classification first (via LLM router with `capability: 'classify'`)
- Falls back to heuristic if AI fails
- Stores classification source (`'ai'` or `'heuristic'`) in `import_batches`
- Adds confidence warnings for low-confidence mappings (<70%)
- Warns on missing required fields

**Confidence Warnings**:
- Low confidence (<70%): "Column X mapped to field Y with low confidence (65%) — please verify"
- Missing required: "Required field 'amount' was not detected — please map manually"
- AI notes appended to warnings

---

### Prompt 5: Stage Mapping with DeepSeek

**File**: `server/import/stage-classifier.ts` (165 lines)

**Purpose**: Normalize raw CRM stage names into Pandora's standard pipeline stages

**Normalized Stages**:
- `discovery` - Early conversations, demos, intros
- `qualification` - Evaluating fit (BANT, MEDDICC)
- `proposal` - Quote/proposal sent
- `negotiation` - Contract review, legal, procurement
- `closed_won` - Deal won
- `closed_lost` - Deal lost

**Key Features**:
- AI-powered classification with sample deal context
- Detects `is_open` (active vs terminal stage)
- Assigns `display_order` for funnel visualization
- Heuristic fallback using pattern matching
- Integrates with `stage_mappings` table for persistence

**Classification Output**:
```typescript
interface StageMappingResult {
  stageMapping: Record<string, {
    normalized: 'discovery' | 'qualification' | ... ;
    is_open: boolean;
    display_order: number;
  }>;
  confidence: number;
  notes: string;
}
```

**Integration into Upload Flow** (`server/routes/import.ts`):

1. **Load existing mappings** from `stage_mappings` table
2. **Identify unmapped stages** (not in existing mappings)
3. **Build sample deal context** (up to 3 deals per stage)
4. **Call DeepSeek** to classify unmapped stages
5. **Merge** with existing mappings
6. **Return in preview** response with source (`'existing'`, `'ai'`, `'heuristic'`)

**Persistence on Confirm** (`POST /confirm`):
- Upserts stage mappings to `stage_mappings` table
- Stores `normalized_stage`, `is_open`, `display_order`
- Supports both string format (backwards compatible) and object format (new)
- Logs count of persisted mappings

---

### Stage Mapping CRUD API Endpoints

**GET `/api/workspaces/:id/import/stage-mapping`**
- Returns all stage mappings grouped by source
- Sources: `csv_import`, `hubspot`, `salesforce`, etc.
- Response: `{ source_name: [{ id, rawStage, normalizedStage, isOpen, displayOrder, ... }] }`

**PUT `/api/workspaces/:id/import/stage-mapping`**
- Bulk upsert stage mappings
- Body: `{ mappings: [{ rawStage, normalized, isOpen, displayOrder }], source: 'csv_import' }`
- Returns: `{ upserted: number, source: string }`

**DELETE `/api/workspaces/:id/import/stage-mapping/:rawStage`**
- Delete single mapping
- Query param: `?source=csv_import`
- Returns: `{ deleted: true }`

---

## File Changes

### New Files Created

1. **server/import/ai-classifier.ts** (301 lines)
   - `classifyColumns()` - Main AI classification function
   - `buildDealPrompt()` - Deal-specific DeepSeek prompt
   - `buildContactPrompt()` - Contact-specific prompt
   - `buildAccountPrompt()` - Account-specific prompt

2. **server/import/stage-classifier.ts** (165 lines)
   - `classifyStages()` - AI stage mapping
   - `heuristicMapStages()` - Pattern-based fallback

### Modified Files

**server/routes/import.ts** (major updates)

**Lines 8-12**: Added imports
```typescript
import { classifyColumns as aiClassifyColumns, type ClassificationResult } from '../import/ai-classifier.js';
import { classifyStages, heuristicMapStages, type StageMappingResult } from '../import/stage-classifier.js';
```

**Lines 46-80**: AI classification with heuristic fallback
- Try AI classification first
- Catch errors and fall back to heuristic
- Track classification source
- Build confidence warnings

**Lines 90-103**: Store classification with AI metadata
- Include AI-detected currency, date format, source CRM
- Store stage values for deal imports

**Lines 126-191**: Stage mapping with AI
- Load existing mappings from `stage_mappings` table
- Find unmapped stages
- Build sample deal context
- Call AI classifier for unmapped stages
- Merge with existing mappings
- Handle AI failure with heuristic fallback

**Lines 269-286**: Persist stage mappings on confirm
- Upsert to `stage_mappings` table with `is_open` and `display_order`
- Support both string and object mapping formats
- Log persistence count

**Lines 733-856**: Stage Mapping CRUD API (3 new endpoints)

**Lines 665-723**: Helper functions
- `convertAIClassificationToMapping()` - Convert AI format to heuristic format
- `buildConfidenceWarnings()` - Generate warnings for low-confidence mappings

---

## Integration with Existing Systems

### LLM Router
- Uses `callLLM(workspaceId, 'classify', {...})` from `server/utils/llm-router.ts`
- Capability: `'classify'` → routes to DeepSeek v3
- Same pattern as quota upload classification

### Workspace Config Layer
- Reads from `stage_mappings` table (persisted across imports)
- Can also read from `workspace-config.ts` custom stage mapping
- Fallback chain: stage_mappings table → workspace config → default patterns

### Database Schema
- Uses `stage_mappings` table from migration 016
- Columns: `workspace_id`, `source`, `raw_stage`, `normalized_stage`, `is_open`, `display_order`
- Unique constraint: `(workspace_id, source, raw_stage)`

---

## Testing Recommendations

### AI Column Classification
1. **Test with real CRM exports**:
   - HubSpot deals export
   - Salesforce opportunities export
   - Pipedrive deals export
   - Monday.com boards export

2. **Test fallback behavior**:
   - Simulate AI failure (invalid API key)
   - Verify heuristic mapper works
   - Check warnings appear

3. **Test confidence warnings**:
   - Upload file with ambiguous column names
   - Verify low-confidence warnings
   - Check required field warnings

### Stage Mapping
1. **Test unmapped stage detection**:
   - Upload deals with custom stage names
   - Verify AI classification runs
   - Check merged mapping in response

2. **Test persistence**:
   - Confirm import with stage mappings
   - Verify upsert to `stage_mappings` table
   - Re-upload same file, verify no re-classification

3. **Test CRUD API**:
   - GET: Retrieve all mappings, verify grouping by source
   - PUT: Bulk update mappings
   - DELETE: Remove single mapping

4. **Test heuristic fallback**:
   - Simulate DeepSeek failure
   - Verify pattern matching works
   - Check "Negotiation" → negotiation, "Closed Won" → closed_won

---

## Example API Flow

### 1. Upload File (with AI Classification)

**Request**: `POST /api/workspaces/{id}/import/upload?entityType=deal`
```
Body: multipart/form-data with file
```

**Response**:
```json
{
  "batchId": "uuid",
  "entityType": "deal",
  "totalRows": 150,
  "headers": ["Deal Name", "Amount", "Stage", "Close Date", "Owner"],
  "mapping": {
    "name": { "columnIndex": 0, "columnHeader": "Deal Name", "confidence": 0.95, "source": "ai" },
    "amount": { "columnIndex": 1, "columnHeader": "Amount", "confidence": 0.90, "source": "ai" },
    "stage": { "columnIndex": 2, "columnHeader": "Stage", "confidence": 0.95, "source": "ai" },
    "close_date": { "columnIndex": 3, "columnHeader": "Close Date", "confidence": 0.85, "source": "ai" },
    "owner": { "columnIndex": 4, "columnHeader": "Owner", "confidence": 0.80, "source": "ai" }
  },
  "unmappedColumns": [],
  "warnings": [
    "AI Note: Detected HubSpot export format. No pipeline column found."
  ],
  "stageMapping": {
    "uniqueStages": ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"],
    "existingMappings": {},
    "newMappings": {
      "Discovery": { "normalized": "discovery", "is_open": true, "display_order": 1 },
      "Qualification": { "normalized": "qualification", "is_open": true, "display_order": 2 },
      "Proposal": { "normalized": "proposal", "is_open": true, "display_order": 3 },
      "Negotiation": { "normalized": "negotiation", "is_open": true, "display_order": 4 },
      "Closed Won": { "normalized": "closed_won", "is_open": false, "display_order": 5 },
      "Closed Lost": { "normalized": "closed_lost", "is_open": false, "display_order": 6 }
    },
    "source": "ai"
  },
  "previewRows": [...]
}
```

### 2. Confirm Import (Persists Stage Mappings)

**Request**: `POST /api/workspaces/{id}/import/confirm`
```json
{
  "batchId": "uuid",
  "strategy": "replace",
  "overrides": {
    "stageMapping": {
      "Discovery": { "normalized": "discovery", "is_open": true, "display_order": 1 },
      "Qualification": { "normalized": "qualification", "is_open": true, "display_order": 2 },
      ...
    }
  }
}
```

**Result**:
- Stage mappings upserted to `stage_mappings` table
- Deals imported with `stage_normalized` field
- Console log: `[Import] Persisted 6 stage mappings`

### 3. Next Upload (Reuses Mappings)

**Request**: Same file uploaded again

**Response**:
```json
{
  "stageMapping": {
    "uniqueStages": ["Discovery", "Qualification", ...],
    "existingMappings": {
      "Discovery": "discovery",
      "Qualification": "qualification",
      ...
    },
    "newMappings": {},
    "source": "existing"
  }
}
```

**Behavior**: No AI call made, uses persisted mappings

---

## Cost Optimization

### AI Classification Runs Only When Needed

1. **Column Classification**:
   - Runs once per file upload
   - Falls back to heuristic if API fails
   - User can override mappings without re-running AI

2. **Stage Classification**:
   - Only runs for NEW stages not in `stage_mappings` table
   - Existing mappings reused
   - Example: First upload classifies 6 stages, second upload uses existing mappings (0 AI calls)

### Token Usage Estimates

**Column Classification**:
- Input: ~1500 tokens (10 headers + 10 sample rows)
- Output: ~500 tokens (JSON response)
- Total: ~2000 tokens per upload

**Stage Classification**:
- Input: ~800 tokens (6 stages + sample deals)
- Output: ~400 tokens (JSON response)
- Total: ~1200 tokens per unique stage set

**Per Import**: ~3200 tokens (first upload), ~2000 tokens (subsequent uploads with existing stage mappings)

---

## Next Steps (Not Built - Prompt 6)

These features go back to Replit:

1. **Manual mapping UI** - Frontend for column/stage overrides
2. **Stage mapping visualization** - Funnel diagram from stage mappings
3. **Bulk import history** - List all import batches with rollback
4. **Smart deduplication** - ML-based record matching using embeddings
5. **Field value validation** - Domain-specific rules (email format, URL format, etc.)

---

## Validation

Run the following to verify implementation:

```bash
# 1. Check AI classifier exists
ls -l server/import/ai-classifier.ts

# 2. Check stage classifier exists
ls -l server/import/stage-classifier.ts

# 3. Check routes were updated
grep -n "classifyColumns as aiClassifyColumns" server/routes/import.ts
grep -n "classifyStages" server/routes/import.ts
grep -n "stage-mapping" server/routes/import.ts

# 4. Verify stage mapping CRUD endpoints
grep -n "GET.*stage-mapping" server/routes/import.ts
grep -n "PUT.*stage-mapping" server/routes/import.ts
grep -n "DELETE.*stage-mapping" server/routes/import.ts
```

All checks should pass.

---

**Status**: ✅ Prompts 4 & 5 Complete
**Ready for**: Replit testing with real CRM exports
**Blocked by**: None - can test immediately

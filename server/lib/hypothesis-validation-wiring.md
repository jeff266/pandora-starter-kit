# Hypothesis Validation Wiring Guide

## Where to Wire Validation

Hypothesis validation must be applied at ALL write points:

### 1. Auto-generated hypotheses (from skills)
**File:** `server/skills/tool-definitions.ts`
**Lines:** 8275, 10539 (both INSERT INTO standing_hypotheses)

**Change:** Route to `hypothesis_drafts` instead, add validation:

```typescript
import { validateHypothesisUnits } from '../lib/validate-hypothesis-units.js';

// Before INSERT:
const hypothesisData = {
  metric: composition.swingVariable,
  current_value: currentValue,
  alert_threshold: alertThreshold,
  unit: '$', // or detect from metric
};

const validation = validateHypothesisUnits(hypothesisData);

if (validation.errors.length > 0) {
  return { error: validation.errors.join(', '), warnings: validation.warnings };
}

// Apply auto-corrections
if (validation.corrected) {
  Object.assign(hypothesisData, validation.corrected);
}

// Route to drafts instead of standing_hypotheses:
const result = await query(
  `INSERT INTO hypothesis_drafts
     (workspace_id, hypothesis_text, metric, metric_key,
      current_value, alert_threshold, alert_direction, unit,
      source, source_skill_run_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto_generated', $9)
   RETURNING id`,
  [...]
);
```

### 2. Manual hypothesis creation (API routes)
**TODO:** If/when a POST /hypotheses route exists, add validation there

```typescript
router.post('/:workspaceId/hypotheses', async (req, res) => {
  const validation = validateHypothesisUnits(req.body);

  if (validation.errors.length > 0) {
    return res.status(400).json({
      error: 'Hypothesis unit validation failed',
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  // Apply auto-corrections for warnings
  if (validation.corrected) {
    Object.assign(req.body, validation.corrected);
  }

  // INSERT INTO standing_hypotheses...
});
```

### 3. Hypothesis updates
**File:** Search for UPDATE standing_hypotheses
Add same validation before any UPDATE that modifies current_value or alert_threshold

## Ratio Storage Convention

**LOCKED CONVENTION:**
Ratios (percentages) are ALWAYS stored as 0-1 in the database.
Display formatting applies ×100 when showing to user.

Examples:
- Win rate 35.6% → store as 0.356
- Pipeline coverage 2.8x → store as 2.8 (not a ratio)
- Deal close probability 78% → store as 0.78

The validation automatically detects and corrects whole-number percentages.

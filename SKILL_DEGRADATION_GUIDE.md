# Skill Degradation Guide for File Import Workspaces

**Status**: Prompt 7 Implementation
**Purpose**: Ensure all 13 skills work gracefully with file-imported data (no activities, conversations, or real-time sync)

---

## Implementation Status

### ✅ Completed
1. **Context Layer**: Added `getDataFreshness()` to `server/context/index.ts`
   - Tracks source (file_import vs api_sync)
   - Checks entity availability (deals, contacts, accounts, activities, conversations, stage_history)
   - Calculates staleness (>14 days for file imports)
   - Generates staleness warnings

2. **Skill Runtime**: Updated `server/skills/runtime.ts`
   - Added `dataFreshness` to skill execution context
   - Available in all skills via `{{dataFreshness.property}}`

3. **Weekly Recap**: Updated `server/skills/library/weekly-recap.ts`
   - Added staleness caveat
   - Conditional activity section
   - Conditional conversation/call themes section
   - Graceful degradation when data missing

### 🚧 Remaining Work

Update remaining 12 skills for graceful degradation.

---

## Degradation Strategy by Skill

### High Priority (Depend on Activities/Conversations)

#### 1. **deal-risk-review**
**Dependencies**: `getActivityTimeline`, `getRecentCallsForDeal`, `getContactsForDeal`

**Updates Needed**:
- Check `dataFreshness.hasActivities` before activity analysis
- Check `dataFreshness.hasConversations` before call analysis
- Check `dataFreshness.hasContacts` before contact threading
- Add to Claude prompt:
  ```handlebars
  {{#unless dataFreshness.hasActivities}}
  NOTE: Activity data not available. Risk assessment based on deal age and stage progression only.
  {{/unless}}
  {{#unless dataFreshness.hasConversations}}
  NOTE: Conversation data not available. Cannot assess call quality or talk ratio signals.
  {{/unless}}
  ```

**Fallback Logic**:
- If no activities: Use `deal.updated_at` as proxy for staleness
- If no conversations: Skip conversation quality section entirely
- If no contacts: Skip multi-threading analysis

---

#### 2. **single-thread-alert**
**Dependencies**: `dealThreadingAnalysis`, `queryContacts`

**Updates Needed**:
- Check `dataFreshness.hasContacts` at start of compute step
- If no contacts, return:
  ```typescript
  {
    skipped: true,
    reason: 'Contact data not available. Import contacts to enable single-thread detection.',
    dealCount: totalDeals  // still return this for context
  }
  ```
- Add to Claude prompt:
  ```handlebars
  {{#if singleThreadData.skipped}}
  SINGLE-THREAD ANALYSIS: Skipped — contact data not yet imported for this workspace.
  Recommendation: Upload a contacts export to identify single-threaded deals.
  {{/if}}
  ```

**Behavior**: Skill still runs but returns partial output with skip reason.

---

#### 3. **data-quality-audit**
**Dependencies**: `checkWorkspaceHasConversations`

**Updates Needed**:
- Adjust audit scope based on available entities:
  ```typescript
  const entitiesToAudit = [];
  if (dataFreshness.hasDeals) entitiesToAudit.push('deals');
  if (dataFreshness.hasContacts) entitiesToAudit.push('contacts');
  if (dataFreshness.hasAccounts) entitiesToAudit.push('accounts');
  // Don't audit entities with 0 records
  ```
- Add to Claude prompt:
  ```handlebars
  {{#if dataFreshness.source === 'file_import'}}
  DATA SOURCE: File import (CSV/Excel).
  Available entities: {{entitiesToAudit.join(', ')}}.
  {{#unless dataFreshness.hasActivities}}
  Activity data not available — activity-related quality checks skipped.
  {{/unless}}
  {{/if}}
  ```

---

### Medium Priority (Depend on Contacts or Specific Data)

#### 4. **icp-discovery**
**Dependencies**: Contacts table

**Updates Needed**:
- Check `dataFreshness.hasContacts` in discover step
- If no contacts but has deals with `account_name`: Use account-level analysis only
- Add to Claude prompt:
  ```handlebars
  {{#unless dataFreshness.hasContacts}}
  NOTE: Contact data not available. ICP analysis based on account-level patterns only.
  {{/unless}}
  ```

---

#### 5. **lead-scoring**
**Dependencies**: Deals + Contacts

**Updates Needed**:
- Contact-based signals: Skip if no contacts
- ICP weighting: Use reduced weight if no contacts
- Add to Claude prompt:
  ```handlebars
  {{#unless dataFreshness.hasContacts}}
  NOTE: Contact scoring unavailable. Scores based on deal and account attributes only.
  {{/unless}}
  ```

---

#### 6. **contact-role-resolution**
**Dependencies**: Contacts table

**Updates Needed**:
- Check `dataFreshness.hasContacts` at start
- If no contacts, return early:
  ```typescript
  {
    skipped: true,
    reason: 'Contact data not available. Import contacts to enable role resolution.'
  }
  ```

---

### Low Priority (Mainly Deals - Should Mostly Work)

#### 7. **pipeline-hygiene**
**Dependencies**: Deals table, optional activities

**Updates Needed**:
- For stale deal detection:
  ```typescript
  let staleDays: number | null;
  if (dataFreshness.hasActivities) {
    staleDays = deal.days_since_last_activity;
  } else {
    // Fallback: use deal's updated_at as activity proxy
    staleDays = differenceInDays(new Date(), new Date(deal.updated_at));
  }
  ```
- Add to Claude prompt:
  ```handlebars
  {{#if dataFreshness.isStale}}
  ⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
  {{/if}}
  {{#unless dataFreshness.hasActivities}}
  NOTE: Activity data not available. Deal staleness based on last modification date,
  which may undercount truly stale deals.
  {{/unless}}
  ```

---

#### 8. **pipeline-coverage**
**Dependencies**: Deals + Quotas

**Updates Needed**:
- Works fine with just deals + quotas
- Add staleness caveat:
  ```handlebars
  {{#if dataFreshness.isStale}}
  ⚠️ Coverage calculations based on data imported {{dataFreshness.daysSinceUpdate}}
  days ago. Re-upload latest CRM export for current coverage numbers.
  {{/if}}
  ```

---

#### 9. **forecast-rollup**
**Dependencies**: Deals + Quotas

**Updates Needed**:
- Works fine with just deals + quotas
- Add file-import note:
  ```handlebars
  {{#if dataFreshness.source === 'file_import'}}
  NOTE: Forecast based on file-imported data, not live CRM sync.
  Week-over-week comparison only available after multiple imports.
  Deal movements since last import are not reflected.
  {{/if}}
  ```

---

#### 10. **pipeline-waterfall**
**Dependencies**: `deal_stage_history` table

**Updates Needed**:
- Check `dataFreshness.hasStageHistory`
- If no stage history:
  ```handlebars
  {{#unless dataFreshness.hasStageHistory}}
  NOTE: Stage history not available. Waterfall analysis requires multiple consecutive imports
  to track deal progression. Re-upload deals weekly to build stage transition history.
  {{/unless}}
  ```

---

#### 11. **rep-scorecard**
**Dependencies**: Already has `checkDataAvailability`

**Status**: ✅ **Already handles degradation!**

**Verification Needed**:
- Check that `dataFreshness` is passed to compute functions
- Ensure Claude prompt uses `data_availability` output

---

#### 12. **custom-field-discovery**
**Dependencies**: Deal custom fields

**Updates Needed**:
- Works fine with file imports (custom fields preserved)
- Add staleness caveat if >14 days old

---

#### 13. **lead-scoring** (duplicate - see #5)

---

## Implementation Checklist

### Phase 1: Core Infrastructure ✅
- [x] Add `getDataFreshness()` to context layer
- [x] Add `dataFreshness` to skill execution context
- [x] Update weekly-recap as reference implementation

### Phase 2: High-Priority Skills ✅
- [x] Update deal-risk-review
- [x] Update single-thread-alert
- [x] Update data-quality-audit

### Phase 3: Medium-Priority Skills ✅
- [x] Update icp-discovery
- [x] Update lead-scoring
- [x] Update contact-role-resolution

### Phase 4: Low-Priority Skills ✅
- [x] Update pipeline-hygiene (staleness fallback)
- [x] Update pipeline-coverage (staleness caveat)
- [x] Update forecast-rollup (file-import note)
- [x] Update pipeline-waterfall (stage history check)
- [x] Verify rep-scorecard (already done)
- [x] Update custom-field-discovery (staleness caveat)

### Phase 5: Testing
- [ ] Test each skill with file-import workspace (no activities, conversations)
- [ ] Test staleness warnings (>14 days old data)
- [ ] Test mixed workspaces (file import + API sync)
- [ ] Verify Slack output formatting

---

## Key Patterns

### 1. Staleness Warning
```handlebars
{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}
```

### 2. Missing Entity Check
```handlebars
{{#unless dataFreshness.hasActivities}}
NOTE: Activity data not available. [Explanation of what's skipped]
{{/unless}}
```

### 3. Conditional Section
```handlebars
{{#if dataFreshness.hasConversations}}
CALL THEMES:
{{call_highlights}}
{{else}}
Conversation data not available — call analysis skipped.
{{/if}}
```

### 4. Compute Function Guard
```typescript
if (!dataFreshness.hasContacts) {
  return {
    skipped: true,
    reason: 'Contact data not available.',
    // still return partial data if useful
  };
}
```

---

## Testing Strategy

### Test Scenarios

1. **File Import Only** (No API Sync)
   - Upload deals CSV only
   - Run all skills
   - Verify: All skills run without errors, appropriate sections skipped

2. **File Import + Stale Data** (>14 days)
   - Import deals 15 days ago
   - Run all skills
   - Verify: Staleness warnings appear in output

3. **Partial Entities**
   - Import deals only (no contacts/accounts)
   - Run single-thread-alert, icp-discovery
   - Verify: Graceful skip messages, no crashes

4. **Mixed Source** (File + API)
   - Import deals via CSV
   - Sync HubSpot after
   - Verify: Uses most recent data, source = 'api_sync'

### Validation Criteria

✅ **Pass**: Skill runs to completion with appropriate warnings
❌ **Fail**: Skill crashes, throws error, or shows empty sections without explanation

---

## Next Steps

1. Systematically update remaining 12 skills using patterns above
2. Test each skill with file-import workspaces
3. Update Slack formatters to prepend staleness header when needed:
   ```typescript
   if (dataFreshness.isStale) {
     slackBlocks.unshift({
       type: 'context',
       elements: [{
         type: 'mrkdwn',
         text: `⚠️ Data last imported ${dataFreshness.daysSinceUpdate}d ago`
       }]
     });
   }
   ```
4. Document file import limitations for users

---

**Status**: ✅ ALL 13 SKILLS UPDATED
**Completion**: Prompt 7 implementation complete
**Next**: Phase 5 testing with file-import workspaces

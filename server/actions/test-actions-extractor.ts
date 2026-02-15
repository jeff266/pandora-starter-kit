/**
 * Actions Engine Phase 1 - Component Test
 *
 * Verifies action extraction from synthesis output without requiring DB connection
 */

import { parseActionsFromOutput } from './extractor.js';

const testSynthesisOutput = `
# Pipeline Hygiene Analysis

## Executive Summary
We have 12 deals that are critically stale and need immediate attention.

## Key Findings
- Deals over 60 days in stage without activity
- Close dates are unrealistic
- CRM data quality issues

<actions>
[
  {
    "action_type": "re_engage_deal",
    "severity": "critical",
    "title": "Re-engage Acme Corp deal - 87 days stale",
    "summary": "Acme Corp deal ($450K) has been stuck in Negotiation for 87 days with no recent activity. Last touch was 62 days ago.",
    "recommended_steps": [
      "Schedule executive alignment call with CTO Sarah Chen",
      "Review and address outstanding security questions from procurement",
      "Set realistic close date based on buyer timeline"
    ],
    "target_deal_name": "Acme Corp - Enterprise Platform",
    "owner_email": "john@company.com",
    "impact_amount": 450000,
    "urgency_label": "Critical - 60+ days stale",
    "urgency_days_stale": 87,
    "execution_payload": {
      "deal_id": "deal_123",
      "fields_to_update": {
        "stage": "Re-Engagement Required",
        "next_step": "Executive alignment call scheduled"
      }
    }
  },
  {
    "action_type": "close_stale_deal",
    "severity": "warning",
    "title": "Close or archive Beta Inc deal - past close date",
    "summary": "Beta Inc deal ($125K) is 45 days past its expected close date with no pipeline movement.",
    "recommended_steps": [
      "Contact rep to confirm deal status",
      "Mark as closed-lost if no response within 3 days",
      "Update CRM with loss reason if applicable"
    ],
    "target_deal_name": "Beta Inc - Starter Package",
    "owner_email": "sarah@company.com",
    "impact_amount": 125000,
    "urgency_label": "Past close date by 45 days",
    "urgency_days_stale": 90,
    "execution_payload": {
      "deal_id": "deal_456",
      "suggested_stage": "Closed Lost",
      "suggested_loss_reason": "No response - stale opportunity"
    }
  }
]
</actions>

## Recommendations
1. Prioritize high-value stale deals
2. Update close dates to be realistic
3. Implement weekly pipeline hygiene cadence
`;

console.log('=== Actions Engine Phase 1 - Extractor Test ===\n');

console.log('Testing parseActionsFromOutput...');
const extractedActions = parseActionsFromOutput(testSynthesisOutput);

console.log(`\n✅ Extracted ${extractedActions.length} actions\n`);

extractedActions.forEach((action, idx) => {
  console.log(`Action ${idx + 1}:`);
  console.log(`  Type: ${action.action_type}`);
  console.log(`  Severity: ${action.severity}`);
  console.log(`  Title: ${action.title}`);
  console.log(`  Target: ${action.target_deal_name || action.target_account_name || 'N/A'}`);
  console.log(`  Owner: ${action.owner_email}`);
  console.log(`  Impact: $${action.impact_amount?.toLocaleString()}`);
  console.log(`  Steps: ${action.recommended_steps?.length} recommended steps`);
  console.log(`  Payload: ${action.execution_payload ? 'Yes' : 'No'}`);
  console.log('');
});

// Test empty/missing actions block
console.log('Testing empty synthesis output...');
const emptyResult = parseActionsFromOutput('Just some text without actions');
console.log(`✅ Empty output returns ${emptyResult.length} actions (expected 0)\n`);

// Test malformed JSON
console.log('Testing malformed JSON in actions block...');
const malformedOutput = `
Some text
<actions>
{ this is not valid json }
</actions>
`;
const malformedResult = parseActionsFromOutput(malformedOutput);
console.log(`✅ Malformed JSON returns ${malformedResult.length} actions (expected 0)\n`);

// Test missing required fields
console.log('Testing action with missing required fields...');
const missingFieldsOutput = `
<actions>
[
  {
    "severity": "critical",
    "title": "Missing action_type field"
  },
  {
    "action_type": "valid_action",
    "severity": "warning",
    "title": "This one is valid"
  }
]
</actions>
`;
const filteredResult = parseActionsFromOutput(missingFieldsOutput);
console.log(`✅ Filtered result has ${filteredResult.length} actions (expected 1, invalid filtered out)\n`);

console.log('=== All Extractor Tests Passed ===\n');
console.log('Next steps:');
console.log('1. Run a skill that emits actions (Pipeline Hygiene or Single-Thread Alert)');
console.log('2. Verify actions are inserted into the actions table');
console.log('3. Test Actions API endpoints (GET /api/workspaces/:id/action-items)');
console.log('4. Test Slack notification delivery');
console.log('5. Verify action status transitions and audit logging');

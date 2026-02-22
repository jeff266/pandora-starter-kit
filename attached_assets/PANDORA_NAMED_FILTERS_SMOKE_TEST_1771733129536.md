# Named Filters Smoke Test Prompt (Replit Agent)

```
Read these files first:
- server/tools/filter-resolver.ts (or wherever FilterResolver was built)
- server/routes/ — find the named filters API endpoints
- server/skills/tool-definitions.ts — find the named_filter parameter on query tools
- server/types/workspace-config.ts — find the NamedFilter type
- The workspace_config in context_layer for any active workspace

You're validating that the Named Filters system works end-to-end. 
Create scripts/test-named-filters.ts and run it.

== TEST GROUP 1: Filter Preview (Critical Path) ==

For each workspace that has a connector_config with status = 'connected':

  a. GET /api/workspaces/:id/filters
     LOG: all filter IDs, labels, objects, confirmed status
     ASSERT: at least the 5 default filters exist (open_pipeline, new_logo, 
             stale_deal, closing_this_quarter, at_risk)

  b. POST /api/workspaces/:id/filters/open_pipeline/preview
     LOG: record count, SQL preview
     ASSERT: record_count >= 0 (no SQL errors)
     ASSERT: sql_preview contains parameterized placeholders ($1, $2) NOT 
             string-interpolated values
     ASSERT: sql_preview does NOT contain the literal word 'undefined' or 'null' 
             as a string

  c. POST /api/workspaces/:id/filters/stale_deal/preview
     LOG: record count, SQL preview, first 3 sample records
     ASSERT: record_count >= 0
     ASSERT: every sample record has days_since_last_activity >= the threshold 
             in the filter definition

  d. POST /api/workspaces/:id/filters/closing_this_quarter/preview
     LOG: record count
     ASSERT: every sample record has close_date within current quarter bounds

== TEST GROUP 2: Cross-Object Condition (new_logo filter) ==

The new_logo filter uses a cross-object EXISTS subquery — "deals at accounts 
with no prior closed-won deals." This is the hardest compilation path.

  a. POST /api/workspaces/:id/filters/new_logo/preview
     LOG: record count, SQL preview, first 5 sample records
     ASSERT: no SQL syntax errors (preview returns successfully)
     ASSERT: SQL preview contains 'EXISTS' or 'NOT EXISTS'

  b. Manual verification query — run this directly against the database:
     
     SELECT d.name, d.amount, d.stage_normalized, a.name as account_name,
       (SELECT COUNT(*) FROM deals d2 
        WHERE d2.account_id = d.account_id 
        AND d2.workspace_id = d.workspace_id 
        AND d2.is_closed_won = true) as prior_wins
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1 AND d.is_open = true
     ORDER BY d.amount DESC LIMIT 10
     
     Compare: deals where prior_wins = 0 should match the new_logo filter results.
     Deals where prior_wins > 0 should NOT appear in new_logo results.
     LOG: comparison results
     ASSERT: filter matches manual query

== TEST GROUP 3: Tool Integration + Evidence Breadcrumb ==

This tests that skills can pass named_filter to tools and get evidence metadata back.

  a. Find the query_deals tool function (likely in server/skills/tool-definitions.ts 
     or server/tools/deal-query.ts).
     
     Call it programmatically with:
     
     const result = await queryDeals({
       workspace_id: testWorkspaceId,
       named_filter: 'open_pipeline',
       limit: 5
     });
     
     LOG: result keys, record count
     ASSERT: result has _applied_filters array
     ASSERT: _applied_filters[0].filter_id === 'open_pipeline'
     ASSERT: _applied_filters[0].filter_label is a non-empty string
     ASSERT: _applied_filters[0].conditions_summary is a non-empty string
     ASSERT: _applied_filters[0].confidence === 1.0 (default filters are confidence 1.0)

  b. Call with multiple filters combined:
     
     const result = await queryDeals({
       workspace_id: testWorkspaceId,
       named_filters: ['open_pipeline', 'stale_deal'],
       limit: 5
     });
     
     ASSERT: result has _applied_filters with length === 2
     ASSERT: record count <= the count from open_pipeline alone 
             (stale_deal is a subset of open pipeline)

  c. Call with a non-existent filter:
     
     try {
       await queryDeals({
         workspace_id: testWorkspaceId,
         named_filter: 'nonexistent_filter_xyz',
       });
       FAIL: should have thrown an error
     } catch (err) {
       ASSERT: error message mentions 'not found' or 'Available filters'
       LOG: error message (should list available filter IDs)
     }

== TEST GROUP 4: CRUD API ==

  a. Create a custom filter:
     
     POST /api/workspaces/:id/filters
     Body: {
       "id": "test_big_deals",
       "label": "Big Deals (Test)",
       "description": "Deals over $50K for smoke testing",
       "object": "deals",
       "conditions": {
         "operator": "AND",
         "conditions": [
           { "field": "amount", "operator": "gt", "value": 50000 },
           { "field": "is_open", "operator": "is_true", "value": true }
         ]
       }
     }
     
     ASSERT: 201 response
     ASSERT: response has source = 'user_defined'
     ASSERT: response has confirmed = true

  b. Preview the custom filter:
     
     POST /api/workspaces/:id/filters/test_big_deals/preview
     LOG: record count, SQL preview
     ASSERT: all sample records have amount > 50000

  c. Update the filter:
     
     PUT /api/workspaces/:id/filters/test_big_deals
     Body: {
       "conditions": {
         "operator": "AND",
         "conditions": [
           { "field": "amount", "operator": "gt", "value": 100000 },
           { "field": "is_open", "operator": "is_true", "value": true }
         ]
       }
     }
     
     ASSERT: 200 response
     POST preview again — record count should be <= previous count

  d. Use the custom filter in a tool call:
     
     const result = await queryDeals({
       workspace_id: testWorkspaceId,
       named_filter: 'test_big_deals',
       limit: 5
     });
     
     ASSERT: _applied_filters[0].filter_id === 'test_big_deals'
     ASSERT: _applied_filters[0].filter_source === 'user_defined'

  e. Delete the test filter:
     
     DELETE /api/workspaces/:id/filters/test_big_deals
     ASSERT: 200 response
     
     GET /api/workspaces/:id/filters
     ASSERT: test_big_deals is NOT in the list

== TEST GROUP 5: Edge Cases ==

  a. Empty result set:
     
     POST /api/workspaces/:id/filters
     Body: {
       "id": "test_impossible",
       "label": "Impossible Filter",
       "object": "deals",
       "conditions": {
         "operator": "AND",
         "conditions": [
           { "field": "amount", "operator": "gt", "value": 999999999 }
         ]
       }
     }
     
     POST /api/workspaces/:id/filters/test_impossible/preview
     ASSERT: record_count === 0 (no crash, no error)
     
     DELETE /api/workspaces/:id/filters/test_impossible

  b. OR conditions:
     
     POST /api/workspaces/:id/filters
     Body: {
       "id": "test_or_filter",
       "label": "OR Test",
       "object": "deals",
       "conditions": {
         "operator": "OR",
         "conditions": [
           { "field": "stage_normalized", "operator": "eq", "value": "closed_won" },
           { "field": "stage_normalized", "operator": "eq", "value": "closed_lost" }
         ]
       }
     }
     
     POST /api/workspaces/:id/filters/test_or_filter/preview
     ASSERT: all sample records have stage = closed_won OR closed_lost
     ASSERT: SQL preview contains 'OR'
     
     DELETE /api/workspaces/:id/filters/test_or_filter

  c. Nested conditions (AND inside OR):
     
     POST /api/workspaces/:id/filters
     Body: {
       "id": "test_nested",
       "label": "Nested Test",
       "object": "deals",
       "conditions": {
         "operator": "OR",
         "conditions": [
           {
             "operator": "AND",
             "conditions": [
               { "field": "amount", "operator": "gt", "value": 100000 },
               { "field": "stage_normalized", "operator": "eq", "value": "closed_won" }
             ]
           },
           {
             "operator": "AND",
             "conditions": [
               { "field": "amount", "operator": "lt", "value": 10000 },
               { "field": "stage_normalized", "operator": "eq", "value": "closed_lost" }
             ]
           }
         ]
       }
     }
     
     POST /api/workspaces/:id/filters/test_nested/preview
     LOG: SQL preview (should show nested parentheses)
     ASSERT: SQL contains nested parentheses pattern
     ASSERT: no SQL errors
     
     DELETE /api/workspaces/:id/filters/test_nested

  d. Confirm endpoint:
     
     GET /api/workspaces/:id/filters/open_pipeline
     LOG: confirmed status
     
     If not confirmed:
       POST /api/workspaces/:id/filters/open_pipeline/confirm
       ASSERT: 200 response
       GET /api/workspaces/:id/filters/open_pipeline
       ASSERT: confirmed === true

== SUMMARY OUTPUT ==

At the end, print a summary table:

  Test Group 1 (Preview):        PASS/FAIL (x/y tests)
  Test Group 2 (Cross-Object):   PASS/FAIL (x/y tests)
  Test Group 3 (Tool + Evidence): PASS/FAIL (x/y tests)
  Test Group 4 (CRUD):           PASS/FAIL (x/y tests)
  Test Group 5 (Edge Cases):     PASS/FAIL (x/y tests)
  
  Total: x/y passed

Clean up: delete any test_* filters that were created during testing.

Log all raw responses for any FAIL results so we can debug.
```

# E2E Testing Guide

Complete testing suite for validating the 6 features built for Pandora.

## What Was Built

| # | Feature | Description |
|---|---------|-------------|
| 1 | Workspace Configuration | CRUD config layer (fiscal year, currency, deal defaults) stored in context_layer definitions |
| 2 | Custom Funnel Definitions | AI-powered stage discovery, template library, custom funnel definitions per workspace |
| 3 | HubSpot Stage History Backfill | Retroactive deal stage history from HubSpot property history API (residency-based schema) |
| 4 | Contact Role Resolution | Infers buying roles (champion, executive_sponsor, influencer, etc.) from job titles and activity patterns |
| 5 | Deal-Risk Latency Optimization | Reduced deal count to 10, maxTokens to 2500, added batch context step |
| 6 | Skill Output Caching | 30-minute TTL cache at agent level, reuses recent skill_runs to avoid redundant LLM calls |

## How to Run Tests

### Option 1: Automated (Recommended)

```bash
chmod +x test-e2e-replit.sh
./test-e2e-replit.sh
```

Runs 19 automated checks covering all 6 features. Produces color-coded PASS/FAIL/WARN output with a summary at the end.

**Runtime:** ~3-5 minutes (includes skill execution with LLM calls)

### Option 2: Database Validation

```bash
psql $DATABASE_URL -f test-validation.sql
```

Runs SQL queries that validate data quality, coverage targets, and schema correctness without making API calls.

**Runtime:** ~5 seconds

### Option 3: Manual Step-by-Step

```bash
cat test-manual-checklist.md
```

12-point checklist with curl commands, expected outputs, SQL verification queries, and checkboxes for each test.

## Success Criteria

| Metric | Target | Source |
|--------|--------|--------|
| Stage history coverage | >= 80% of deals | `test-validation.sql` section 3 |
| Contact role coverage | >= 50% of deal_contacts | `test-validation.sql` section 4 |
| Pipeline goals rep count | >= 1 rep detected | `test-e2e-replit.sh` section 6 |
| Deal-risk latency | < 90 seconds | `test-e2e-replit.sh` section 7 |
| Skill cache stored | >= 1 recent run | `test-e2e-replit.sh` section 8 |
| Agent cache hit | Log message visible | `test-manual-checklist.md` item 10 |
| Funnel templates | >= 3 available | `test-e2e-replit.sh` section 3 |
| Agent registry | >= 4 agents | `test-e2e-replit.sh` section 9 |

## Troubleshooting

### Server not responding
- Check the Pandora API workflow is running
- Look at workflow logs for startup errors
- Verify port 5000 is not blocked

### Skill runs timing out
- Skills call external LLMs (Claude, DeepSeek) which need 10-40s per call
- Use `--max-time 120` on curl for deal-risk-review
- Check FIREWORKS_API_KEY and Anthropic integration are configured

### Stage history entries lower than expected
- Run the backfill: `curl -X POST http://localhost:5000/api/workspaces/{WS}/connectors/hubspot/stage-history/backfill`
- Some deals may not have property history in HubSpot

### Contact roles showing 0 created
- Roles persist across runs (created on first run, updated on subsequent runs)
- Check `created + updated` total, not just `created`

### Cache not activating on direct skill API
- This is expected behavior. Caching only works at the agent level (when agents compose skills)
- Direct `POST /api/skills/:id/run` always runs fresh
- To test caching: run a skill, then run an agent that includes that skill

### Rep count showing 0
- Verify the activities table has data: `SELECT COUNT(*) FROM activities WHERE workspace_id = '{WS}'`
- The fix changed `owner` to `actor` column in activities queries

### Database connection errors
- Verify `$DATABASE_URL` is set: `echo $DATABASE_URL`
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

## Validated Results

These results were observed during development in Replit:

| Test | Result |
|------|--------|
| Workspace config CRUD | PASS (GET/PUT working, confirmed flag persists) |
| Funnel templates | PASS (5 templates available) |
| Stage history backfill | PASS (357/391 deals, 1503 entries, 91% coverage) |
| Contact role inference | PASS (673 roles inferred, 0.7-0.8 confidence) |
| Pipeline goals | PASS (repCount: 4, completed in ~23s) |
| Deal-risk latency | PASS (51s total, 41s Claude API) |
| Skill caching | PASS (agent-level cache hit confirmed in logs) |
| Agent execution | PASS (attainment-vs-goal completed with 4 skills) |

## File Structure

```
test-e2e-replit.sh        # Automated test script (bash)
test-validation.sql       # Database validation queries
test-manual-checklist.md  # Step-by-step manual checklist
TESTING_README.md         # This file
```

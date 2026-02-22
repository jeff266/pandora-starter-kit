# Agent Briefing Engine — Quick Smoke Test Run

## Context

The Agent Briefing Engine (Phases 1–5) is complete with all UI/UX fixes applied. This prompt runs a single end-to-end generation test to verify everything works before starting the dogfood period.

**Goal:** Create a test agent, trigger one generation, verify the output renders, then clean up.

---

## Step 0: Reconnaissance

```bash
# 1. Find an active workspace with completed skill runs
psql "$DATABASE_URL" -c "
  SELECT w.id, w.name, w.crm_type, COUNT(DISTINCT sr.skill_id) as skills
  FROM workspaces w
  JOIN skill_runs sr ON sr.workspace_id = w.id AND sr.status = 'completed'
  WHERE w.status = 'active'
  GROUP BY w.id, w.name, w.crm_type
  ORDER BY skills DESC;
"

# 2. Check if agent templates are seeded
psql "$DATABASE_URL" -c "SELECT id, name, category FROM agent_templates WHERE is_system = true;"

# 3. Check if any agents already exist
psql "$DATABASE_URL" -c "SELECT id, name, workspace_id, status FROM agents ORDER BY created_at DESC LIMIT 5;"

# 4. Verify the generation endpoint exists
grep -rn "agents.*generate\|generate.*agent" server/routes.ts | head -10

# 5. Check what the server base URL/port is
grep -rn "listen\|PORT" server/index.ts | head -5

# 6. Verify report_generations table has the editorial columns
psql "$DATABASE_URL" -c "\d report_generations" | grep -E "agent_id|run_digest|opening_narrative|editorial_decisions|output"
```

Pick the workspace with the most completed skill runs (likely Imubit or Frontera). Note its ID.

---

## Step 1: Create a Test Agent

Using the API (not direct DB) to test the full creation flow:

```bash
# Replace WORKSPACE_ID with the actual workspace ID from Step 0
# Replace TEMPLATE_ID with a system template ID from Step 0

curl -s -X POST http://localhost:5000/api/workspaces/WORKSPACE_ID/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "[SMOKE TEST] Pipeline Review Agent",
    "role": "Revenue Operations Analyst",
    "audience": {
      "role": "VP Sales",
      "detail_preference": "manager"
    },
    "focus_questions": [
      "What deals are most at risk this week?",
      "Is pipeline coverage adequate for the quarter?",
      "Are there any stalled deals that need intervention?"
    ],
    "output_formats": ["in_app"],
    "status": "active"
  }' | jq .
```

If the POST /agents endpoint doesn't exist or uses a different shape, check the route file and adapt. The key fields are name, workspace_id, and status=active.

Note the returned agent ID.

---

## Step 2: Trigger a Generation

```bash
# Replace WORKSPACE_ID and AGENT_ID with actual values

curl -s -X POST http://localhost:5000/api/workspaces/WORKSPACE_ID/agents/AGENT_ID/generate \
  -H "Content-Type: application/json" \
  -d '{
    "triggered_by": "smoke_test",
    "skip_delivery": true
  }' | jq .
```

This should return a generation ID. Note it.

If the endpoint returns an error, check the server logs:
```bash
# Look at recent server output for errors
# The generation may be async — check the DB directly
```

---

## Step 3: Monitor Generation Progress

The generation may take 30-90 seconds (it runs evidence gathering → editorial synthesis → digest extraction → memory update).

```bash
# Poll for completion — replace GENERATION_ID
psql "$DATABASE_URL" -c "
  SELECT id, status, 
    opening_narrative IS NOT NULL as has_narrative,
    run_digest IS NOT NULL as has_digest,
    output IS NOT NULL as has_output,
    created_at,
    updated_at
  FROM report_generations 
  WHERE id = 'GENERATION_ID';
"
```

Run this every 10-15 seconds until status = 'completed' (or 'failed').

If it fails, check:
```bash
# Look for error details
psql "$DATABASE_URL" -c "
  SELECT id, status, error, 
    substring(output::text, 1, 500) as output_preview
  FROM report_generations 
  WHERE id = 'GENERATION_ID';
"

# Check server logs for the error
```

---

## Step 4: Verify the Output

Once status = 'completed':

```bash
# 1. Check the editorial output structure
psql "$DATABASE_URL" -c "
  SELECT 
    id,
    status,
    substring(opening_narrative, 1, 200) as narrative_preview,
    jsonb_typeof(output) as output_type,
    CASE 
      WHEN jsonb_typeof(output->'sections') = 'array' 
      THEN jsonb_array_length(output->'sections') 
      ELSE 0 
    END as section_count,
    run_digest IS NOT NULL as has_digest
  FROM report_generations 
  WHERE id = 'GENERATION_ID';
"

# 2. Check the run digest content
psql "$DATABASE_URL" -c "
  SELECT jsonb_pretty(run_digest) 
  FROM report_generations 
  WHERE id = 'GENERATION_ID';
" | head -50

# 3. Check if rolling memory was created
psql "$DATABASE_URL" -c "
  SELECT key, 
    substring(value::text, 1, 300) as memory_preview,
    updated_at
  FROM context_layer 
  WHERE category = 'agent_memory' 
  AND key LIKE 'memory:AGENT_ID%';
"

# 4. Check the generations list endpoint (Fix 3)
curl -s http://localhost:5000/api/workspaces/WORKSPACE_ID/agents/AGENT_ID/generations?limit=1 | jq .
```

---

## Step 5: Verify UI Rendering

Open the browser and check:

1. **Navigate to Agents page** — sidebar should show "Agents" only (no "Agent Builder")
2. **Click the smoke test agent** — should see the agent detail/builder page
3. **Check "Run Now" button** — should be visible in the header area
4. **Check "Latest Briefing" card** — should show the completed generation with timestamp
5. **Click "View Briefing"** — should open the report viewer showing:
   - Opening narrative at the top
   - Section cards with titles and narratives
   - Data points and/or deal cards within sections
   - Feedback bars on each section
   - Overall feedback component at the bottom

If the viewer shows a blank page or error, check the browser console for errors.

---

## Step 6: Cleanup

```bash
# Delete the smoke test agent and its data
psql "$DATABASE_URL" -c "
  -- Delete feedback
  DELETE FROM agent_feedback WHERE agent_id = 'AGENT_ID';
  
  -- Delete memory
  DELETE FROM context_layer WHERE category = 'agent_memory' AND key = 'memory:AGENT_ID';
  DELETE FROM context_layer WHERE category = 'agent_tuning' AND key LIKE 'AGENT_ID:%';
  
  -- Delete generation(s)
  DELETE FROM report_generations WHERE agent_id = 'AGENT_ID';
  
  -- Delete agent
  DELETE FROM agents WHERE id = 'AGENT_ID';
"

# Verify cleanup
psql "$DATABASE_URL" -c "SELECT * FROM agents WHERE name LIKE '%SMOKE TEST%';"
```

---

## Expected Results

| Check | Expected |
|-------|----------|
| Agent created | Returns agent ID, status=active |
| Generation triggered | Returns generation ID, skip_delivery honored |
| Generation completes | status=completed within 90 seconds |
| Opening narrative | Non-null, 2-4 sentences |
| Output sections | 3-6 sections with titles and narratives |
| Run digest | JSON with key_findings, actions_recommended |
| Rolling memory | Created in context_layer with deal_history, metric_history |
| UI: Sidebar | "Agents" only, no "Agent Builder" |
| UI: Run Now button | Visible, clickable |
| UI: Latest Briefing | Shows completed generation with View link |
| UI: Report Viewer | Renders editorial output with feedback bars |

## If Something Fails

**Generation never completes (stuck in 'pending'):**
- Check if the generation pipeline function is being called (add a console.log at the entry point)
- The endpoint may return the ID but not actually kick off the async generation

**Generation fails immediately:**
- Check the error column on report_generations
- Common issues: no completed skill runs for evidence, LLM API key not set, missing workspace config

**UI doesn't show latest briefing:**
- Check if the GET /agents/:id/generations endpoint returns data
- Check browser network tab for 404s

**Viewer shows blank:**
- Check if the report viewer route matches the URL pattern from "View Briefing" link
- Check browser console for rendering errors
- The output JSON structure may not match what the viewer expects

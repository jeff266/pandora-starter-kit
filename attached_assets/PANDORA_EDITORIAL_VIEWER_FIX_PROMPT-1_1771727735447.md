# Fix: Editorial Briefing Viewer — Bypass Template System

## Problem

Clicking "View Briefing" from the agent detail page crashes because the frontend builds a URL using `report_template_id`, which doesn't exist for editorial generations. Agent briefings are generated dynamically by the editorial synthesizer — they don't use templates. Routing them through the template-based viewer is architecturally wrong.

## Principle

Agent briefings and template reports are two different rendering paths:

- **Template reports** (legacy): `report_template_id` → load template → render fixed layout
- **Agent briefings** (editorial): `agent_id` → load generation output → render sections/narrative dynamically

The viewer must detect which type it's looking at and branch accordingly.

---

## Step 0: Reconnaissance

```bash
# 1. Find the current report viewer route and component
grep -rn "reports\|ReportViewer\|generation" client/src/ --include="*.tsx" | grep -i "route\|path\|navigate" | head -15

# 2. Find the "View Briefing" click handler in AgentBuilder
grep -rn "View Briefing\|viewBriefing\|latestGeneration\|report_template_id" client/src/ --include="*.tsx" | head -15

# 3. Find the report viewer component itself
grep -rn "ReportViewer\|ReportView\|generation_id\|generationId" client/src/pages/ --include="*.tsx" -l

# 4. Check what the viewer fetches on load
grep -rn "useEffect\|fetch.*generation\|fetch.*report" client/src/pages/Report*.tsx client/src/pages/report*.tsx | head -15

# 5. Check the server-side report/generation fetch endpoint
grep -rn "generation\|report" server/routes.ts server/routes/ --include="*.ts" | grep "get\|GET" | head -15

# 6. Look at what a completed editorial generation actually stores
psql "$DATABASE_URL" -c "
  SELECT id, agent_id, report_template_id, status,
    opening_narrative IS NOT NULL as has_narrative,
    output IS NOT NULL as has_output,
    jsonb_typeof(output) as output_type
  FROM report_generations
  WHERE agent_id IS NOT NULL AND status = 'completed'
  ORDER BY created_at DESC LIMIT 3;
"

# 7. Check the output structure of a real editorial generation
psql "$DATABASE_URL" -c "
  SELECT jsonb_pretty(output) 
  FROM report_generations 
  WHERE agent_id IS NOT NULL AND status = 'completed' 
  ORDER BY created_at DESC LIMIT 1;
" | head -80
```

---

## Fix 1: Update "View Briefing" Navigation (Frontend)

In the agent detail page (likely `AgentBuilder.tsx`), change the "View Briefing" click handler to navigate to a generation-based route, NOT a template-based route.

**Find the current code** (something like):
```tsx
onClick={() => navigate(`/workspaces/${workspaceId}/reports/${latestGeneration.report_template_id}/${latestGeneration.id}`)}
```

**Replace with:**
```tsx
onClick={() => window.open(`/workspaces/${workspaceId}/reports/generation/${latestGeneration.id}`, '_blank')}
```

No template ID needed. The generation ID is the only identifier.

---

## Fix 2: Add Generation-Direct Route (Router)

In the client-side router config, add a route that loads a generation directly:

```tsx
// Add alongside existing report routes
<Route path="/workspaces/:workspaceId/reports/generation/:generationId" element={<ReportViewer />} />
```

If a catch-all or similar route already exists, ensure this more-specific route takes precedence.

---

## Fix 3: Update Report Viewer to Handle Editorial Generations (Frontend)

In the Report Viewer component, add a branch that detects editorial generations and renders them without a template.

**At the top of the component**, detect how the page was reached:

```tsx
const { workspaceId, generationId, templateId } = useParams();

// If we have a generationId but no templateId, this is a direct generation view (editorial)
const isDirectGeneration = !!generationId && !templateId;
```

**Add a fetch path for direct generation viewing:**

```tsx
useEffect(() => {
  if (!isDirectGeneration) return;
  
  const fetchGeneration = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/report-generations/${generationId}`);
      if (!res.ok) throw new Error(`Failed to load generation: ${res.status}`);
      const data = await res.json();
      setGeneration(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  fetchGeneration();
}, [workspaceId, generationId, isDirectGeneration]);
```

**If the endpoint `/api/workspaces/:id/report-generations/:genId` doesn't exist**, create it:

```typescript
// server route
router.get('/api/workspaces/:workspaceId/report-generations/:generationId', async (req, res) => {
  const { workspaceId, generationId } = req.params;
  
  const result = await db.query(`
    SELECT 
      rg.id,
      rg.workspace_id,
      rg.agent_id,
      rg.report_template_id,
      rg.status,
      rg.output,
      rg.opening_narrative,
      rg.editorial_decisions,
      rg.run_digest,
      rg.total_tokens,
      rg.created_at,
      rg.updated_at,
      a.name as agent_name
    FROM report_generations rg
    LEFT JOIN agents a ON a.id = rg.agent_id
    WHERE rg.id = $1 AND rg.workspace_id = $2
  `, [generationId, workspaceId]);
  
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Generation not found' });
  }
  
  res.json(result.rows[0]);
});
```

**Add the editorial rendering branch** in the viewer JSX:

```tsx
// Inside the render section of ReportViewer
if (isDirectGeneration && generation) {
  return <EditorialBriefingView generation={generation} workspaceId={workspaceId} />;
}

// ... existing template-based rendering below
```

---

## Fix 4: Create EditorialBriefingView Component

Create `client/src/components/EditorialBriefingView.tsx`:

```tsx
import { SectionFeedback } from './SectionFeedback';
import { OverallBriefingFeedback } from './OverallBriefingFeedback';

interface Props {
  generation: any;
  workspaceId: string;
}

export function EditorialBriefingView({ generation, workspaceId }: Props) {
  const output = generation.output || {};
  const sections = output.sections || [];
  
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          {generation.agent_name || 'Agent Briefing'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {new Date(generation.created_at).toLocaleString()}
          {generation.total_tokens && ` · ${generation.total_tokens.toLocaleString()} tokens`}
        </p>
      </div>
      
      {/* Opening Narrative */}
      {generation.opening_narrative && (
        <div className="bg-muted/30 rounded-lg p-5 border">
          <p className="text-base leading-relaxed">{generation.opening_narrative}</p>
        </div>
      )}
      
      {/* Sections */}
      {sections.map((section: any, idx: number) => (
        <div key={section.id || idx} className="border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <SectionFeedback
              agentId={generation.agent_id}
              generationId={generation.id}
              sectionId={section.id || `section-${idx}`}
            />
          </div>
          
          {section.narrative && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {section.narrative}
            </p>
          )}
          
          {/* Data Points */}
          {section.data_points?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {section.data_points.map((dp: any, i: number) => (
                <div key={i} className={`p-3 rounded-md bg-muted/50 ${
                  dp.severity === 'critical' ? 'border-l-4 border-red-500' :
                  dp.severity === 'warning' ? 'border-l-4 border-yellow-500' : ''
                }`}>
                  <p className="text-xs text-muted-foreground">{dp.label}</p>
                  <p className="text-lg font-bold">{dp.value}</p>
                  {dp.change && <p className="text-xs">{dp.change}</p>}
                </div>
              ))}
            </div>
          )}
          
          {/* Deal Cards */}
          {section.deal_cards?.length > 0 && (
            <div className="space-y-2">
              {section.deal_cards.map((deal: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-md">
                  <div>
                    <p className="font-medium text-sm">{deal.deal_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {deal.stage}{deal.insight ? ` · ${deal.insight}` : ''}
                    </p>
                  </div>
                  {deal.amount && (
                    <div className="text-right">
                      <p className="font-bold">
                        ${typeof deal.amount === 'number' 
                          ? (deal.amount >= 1000 ? `${(deal.amount / 1000).toFixed(0)}K` : deal.amount)
                          : deal.amount}
                      </p>
                      {deal.risk_level && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          deal.risk_level === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          deal.risk_level === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                          {deal.risk_level}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      
      {/* Recommended Actions */}
      {output.actions_recommended?.length > 0 && (
        <div className="border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">Recommended Actions</h2>
          <div className="space-y-2">
            {output.actions_recommended.map((action: string, i: number) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="text-primary shrink-0">→</span>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Closing Summary */}
      {output.closing_summary && (
        <div className="border-t pt-4">
          <p className="text-sm text-muted-foreground">{output.closing_summary}</p>
        </div>
      )}
      
      {/* Overall Feedback */}
      {generation.agent_id && (
        <OverallBriefingFeedback
          agentId={generation.agent_id}
          generationId={generation.id}
        />
      )}
    </div>
  );
}
```

Adapt the component to use whatever UI library the codebase already uses (shadcn, etc). The structure is what matters: narrative → sections with feedback → actions → overall feedback.

**If `SectionFeedback` and `OverallBriefingFeedback` haven't been created yet** (they were specified in Phase 4), stub them as simple placeholder components that can be filled in later. Don't block the viewer on the feedback UI.

---

## Verification

After applying:

1. Navigate to an agent with a completed generation
2. Click "View Briefing" 
3. Should open `/workspaces/:id/reports/generation/:genId` (NOT `/reports/:templateId/:genId`)
4. Should render: agent name, timestamp, opening narrative, sections with data/deals, actions
5. Should NOT call any template endpoint
6. Existing template-based reports should still work at their current URLs

---

## DO NOT:
- Pass template IDs for editorial generations — they don't have or need them
- Modify the existing template-based report viewer — add a parallel path, don't break what works
- Require a template lookup for editorial output — the generation row has everything needed
- Block on feedback components — stub them if they're not ready

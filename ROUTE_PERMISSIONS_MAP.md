# Route Permission Mapping

This document maps all 377 workspace-scoped routes to their required permissions.

## Permission Summary

**Total Routes:** 377
**Files:** 58

## Permission Mappings by Domain

### Connectors (connectors.view, connectors.connect, connectors.disconnect, connectors.trigger_sync)

**connectors.ts:**
- GET `/:workspaceId/connectors` → `connectors.view`
- POST `/:workspaceId/connectors/*/connect` → `connectors.connect`
- POST `/:workspaceId/connectors/*/sync` → `connectors.trigger_sync`
- GET `/:workspaceId/connectors/*/health` → `connectors.view`
- PATCH `/:workspaceId/connectors/:connectorType/sync-interval` → `connectors.connect`
- GET `/:workspaceId/connectors/status` → `connectors.view`

**hubspot.ts:**
- POST `/:workspaceId/connectors/hubspot/connect` → `connectors.connect`
- POST `/:workspaceId/connectors/hubspot/sync` → `connectors.trigger_sync`
- GET `/:workspaceId/connectors/hubspot/health` → `connectors.view`
- POST `/:workspaceId/connectors/hubspot/discover-schema` → `connectors.connect`
- POST `/:workspaceId/connectors/hubspot/populate-deal-contacts` → `connectors.trigger_sync`

**gong.ts, fireflies.ts:**
- POST `/:workspaceId/connectors/*/connect` → `connectors.connect`
- POST `/:workspaceId/connectors/*/sync` → `connectors.trigger_sync`
- GET `/:workspaceId/connectors/*/health` → `connectors.view`
- GET/POST/DELETE `/:workspaceId/connectors/*/users/track` → `connectors.connect`

### Skills (skills.view_results, skills.view_evidence, skills.run_manual, skills.configure)

**skills.ts:**
- GET `/:workspaceId/skills` → `skills.view_results`
- POST `/:workspaceId/skills/:skillId/run` → `skills.run_manual`
- GET `/:workspaceId/skills/:skillId/results` → `skills.view_results`
- GET `/:workspaceId/skills/:skillId/evidence` → `skills.view_evidence`
- POST `/:workspaceId/skills/run-all` → `skills.run_manual`
- POST `/:workspaceId/skills/:skillId/schedule` → `skills.configure`

### Agents (agents.view, agents.run, agents.draft, agents.publish, agents.edit_own, agents.edit_any, agents.delete_own, agents.delete_any)

**agents.ts, agent-builder.ts:**
- GET `/:workspaceId/agents` → `agents.view`
- POST `/:workspaceId/agents` → `agents.draft`
- GET `/:workspaceId/agents/:id` → `agents.view`
- PATCH `/:workspaceId/agents/:id` → `agents.edit_own` OR `agents.edit_any` (check ownership)
- DELETE `/:workspaceId/agents/:id` → `agents.delete_own` OR `agents.delete_any` (check ownership)
- POST `/:workspaceId/agents/:id/trigger` → `agents.run`
- POST `/:workspaceId/agents/:id/publish` → `agents.publish`

### Data Access (data.deals_view, data.accounts_view, data.reps_view_own, data.reps_view_team, data.reps_view_all, data.export)

**data.ts:**
- GET `/:id/deals/*` → `data.deals_view`
- GET `/:id/accounts/*` → `data.accounts_view`
- GET `/:id/contacts/*` → `data.deals_view`
- GET `/:id/activities/*` → `data.deals_view`
- GET `/:id/conversations/*` → `data.deals_view`
- GET `/:id/tasks/*` → `data.deals_view`
- GET `/:id/documents/*` → `data.deals_view`

**dossiers.ts:**
- GET `/:workspaceId/deals/:dealId/dossier` → `data.deals_view`
- GET `/:workspaceId/accounts/:accountId/dossier` → `data.accounts_view`
- GET `/:workspaceId/deals/:dealId/score-history` → `data.deals_view`

**account-scoring.ts:**
- GET `/:workspaceId/accounts/scores` → `data.accounts_view`
- GET `/:workspaceId/accounts/:accountId/score` → `data.accounts_view`
- POST `/:workspaceId/accounts/:accountId/enrich` → `data.accounts_view`

### Config (config.view, config.edit)

**config.ts:**
- GET `/:workspaceId/config/*` → `config.view`
- PUT `/:workspaceId/config/*` → `config.edit`

**context.ts:**
- GET `/:workspaceId/context/*` → `config.view`
- PUT `/:workspaceId/context/*` → `config.edit`
- POST `/:workspaceId/context/onboard` → `config.edit`

**funnel.ts:**
- GET `/:workspaceId/funnel` → `config.view`
- POST/PUT/PATCH/DELETE `/:workspaceId/funnel` → `config.edit`

### Members (members.view, members.invite, members.remove, members.change_roles)

**members.ts:**
- GET `/:workspaceId/members` → `members.view`
- POST `/:workspaceId/members/invite` → `members.invite`
- DELETE `/:workspaceId/members/:memberId` → `members.remove`
- PATCH `/:workspaceId/members/:memberId/role` → `members.change_roles`

### Findings & Action Items

**findings.ts:**
- GET `/:workspaceId/findings/*` → `skills.view_results`
- PATCH `/:workspaceId/findings/:findingId/*` → `skills.view_results`

**action-items.ts:**
- GET `/:workspaceId/action-items/*` → `skills.view_results`
- PUT/POST `/:workspaceId/action-items/:actionId/*` → `skills.view_results`

### Analysis & Chat

**analysis.ts:**
- POST `/:workspaceId/analyze` → `skills.view_results`
- GET `/:workspaceId/analyze/suggestions` → `skills.view_results`

**chat.ts:**
- POST `/:workspaceId/chat` → `skills.view_results`
- GET `/:workspaceId/chat/:threadId/history` → `skills.view_results`

### Admin/Advanced

**admin-scopes.ts:**
- ALL routes → `config.edit` (admin-only feature)

**feedback.ts:**
- POST `/:workspaceId/feedback` → `data.deals_view`
- POST `/:workspaceId/annotations` → `data.deals_view`
- GET `/:workspaceId/feedback/summary` → `config.view`
- POST `/:workspaceId/config/suggestions/:suggestionId/*` → `config.edit`

## Implementation Priority

1. **High Priority** (Core functionality):
   - connectors.ts
   - skills.ts  
   - agents.ts, agent-builder.ts
   - data.ts
   - config.ts
   - members.ts

2. **Medium Priority** (Important features):
   - hubspot.ts, gong.ts, fireflies.ts
   - findings.ts, action-items.ts
   - dossiers.ts
   - analysis.ts, chat.ts

3. **Low Priority** (Admin/specialized):
   - admin-scopes.ts
   - feedback.ts
   - enrichment.ts
   - All other routes

## Notes

- API keys bypass all permission checks (handled in requirePermission middleware)
- All routes already have `requireWorkspaceAccess` applied
- `attachWorkspaceContext` is now applied to all workspace routes
- Routes without workspaceId parameter don't need permission middleware


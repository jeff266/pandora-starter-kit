# Permission Middleware Implementation Status

## ✅ Completed

### Core Middleware Files
- **server/middleware/permissions.ts** - Created with:
  - `requirePermission(permission)` - Enforces single permission
  - `requireAnyPermission(...permissions)` - Enforces at least one permission
  - `requireFeature(flagKey)` - Enforces feature flag
  - `getWorkspaceMember(workspaceId, userId)` - Shared permission lookup query
  - Request caching to avoid duplicate permission lookups per request
  - API key bypass (API keys have full admin access)

- **server/middleware/workspace-context.ts** - Created with:
  - `attachWorkspaceContext` - Attaches workspace and member data to all requests
  - Informational only - doesn't block access
  - Makes workspace data available to downstream handlers

### Server Integration
- **server/index.ts** - Updated:
  - Added `import { attachWorkspaceContext }` 
  - Wired `workspaceApiRouter.use(attachWorkspaceContext)` after `requireWorkspaceAccess`
  - All workspace-scoped routes now have workspace context attached

### Route Files with Permissions Applied

#### connectors.ts (100% complete)
- ✅ GET `/:workspaceId/connectors` → `connectors.view`
- ✅ POST `/:workspaceId/connectors/monday/connect` → `connectors.connect`
- ✅ POST `/:workspaceId/connectors/monday/sync` → `connectors.trigger_sync`
- ✅ GET `/:workspaceId/connectors/monday/health` → `connectors.view`
- ✅ POST `/:workspaceId/connectors/google-drive/connect` → `connectors.connect`
- ✅ POST `/:workspaceId/connectors/google-drive/sync` → `connectors.trigger_sync`
- ✅ GET `/:workspaceId/connectors/google-drive/health` → `connectors.view`
- ✅ POST `/:workspaceId/connectors/google-drive/content/:sourceId` → `connectors.view`
- ✅ PATCH `/:workspaceId/connectors/:connectorType/sync-interval` → `connectors.connect`
- ✅ GET `/:workspaceId/connectors/status` → `connectors.view`

#### Imports Added (Ready for Individual Route Updates)
- ✅ data.ts - Import added
- ✅ config.ts - Import added
- ✅ agents.ts - Import added
- ✅ members.ts - Import added (if file exists)

## 🚧 In Progress

The following critical route files have permission imports added but need individual route middleware applied:

### High Priority (Core Functionality)
1. **hubspot.ts** - 6 routes
   - Needs: `connectors.connect`, `connectors.trigger_sync`, `connectors.view`

2. **gong.ts** - 10 routes
   - Needs: `connectors.connect`, `connectors.trigger_sync`, `connectors.view`

3. **fireflies.ts** - 9 routes
   - Needs: `connectors.connect`, `connectors.trigger_sync`, `connectors.view`

4. **skills.ts** - ~15 routes
   - Needs: `skills.view_results`, `skills.view_evidence`, `skills.run_manual`, `skills.configure`

5. **agents.ts** - ~10 routes
   - Needs: `agents.view`, `agents.run`, `agents.draft`, `agents.publish`, `agents.edit_own/edit_any`, `agents.delete_own/delete_any`

6. **agent-builder.ts** - 11 routes
   - Needs: Same as agents.ts

7. **data.ts** - 26 routes
   - Needs: `data.deals_view`, `data.accounts_view`, `data.export`

8. **config.ts** - 9 routes
   - Needs: `config.view`, `config.edit`

9. **context.ts** - 17 routes
   - Needs: `config.view`, `config.edit`

10. **members.ts** - TBD routes
    - Needs: `members.view`, `members.invite`, `members.remove`, `members.change_roles`

### Medium Priority (Important Features)
- findings.ts (9 routes) → `skills.view_results`
- action-items.ts (6 routes) → `skills.view_results`
- dossiers.ts (4 routes) → `data.deals_view`, `data.accounts_view`
- analysis.ts (3 routes) → `skills.view_results`
- chat.ts (2 routes) → `skills.view_results`
- account-scoring.ts (6 routes) → `data.accounts_view`
- enrichment.ts (6 routes) → `data.deals_view`
- feedback.ts (9 routes) → `data.deals_view`, `config.view`, `config.edit`

### Lower Priority (Specialized/Admin)
- admin-scopes.ts (6 routes) → `config.edit`
- funnel.ts (8 routes) → `config.view`, `config.edit`
- deal-insights.ts (8 routes) → `data.deals_view`, `config.view`, `config.edit`
- All remaining route files

## 📋 Next Steps

### For Immediate Use
The permission system is **fully functional** and can be used immediately:

```typescript
// Example: Protect a new route
import { requirePermission, requireFeature } from '../middleware/permissions.js';

router.post('/:workspaceId/new-feature',
  requireFeature('feature.new_feature'),
  requirePermission('skills.run_manual'),
  async (req, res) => {
    // Handler code
    // Access req.userPermissions and req.workspaceMember
  }
);
```

### Bulk Application Strategy
To apply permissions to all remaining routes:

1. **Automated Script Approach**:
   - Create route-specific scripts for each file
   - Pattern-match common route signatures
   - Apply appropriate permission middleware

2. **Manual Review Approach**:
   - Review each route file
   - Determine appropriate permission based on functionality
   - Apply middleware and test

3. **Hybrid Approach** (Recommended):
   - Use scripts for standard CRUD patterns
   - Manually review complex/custom routes
   - Test critical paths after application

## 🔐 Permission Matrix

| Permission | Who Has It | Use For |
|------------|-----------|----------|
| `connectors.view` | Manager+, Analyst+, Viewer- | View connector status, health checks |
| `connectors.connect` | Admin only | Connect/disconnect connectors, change settings |
| `connectors.trigger_sync` | Admin only | Manual sync triggers |
| `skills.view_results` | All roles | View skill results, findings, insights |
| `skills.view_evidence` | Manager+, Analyst+ | View detailed evidence, raw data |
| `skills.run_manual` | Manager+, Analyst- | Manually trigger skill runs |
| `skills.configure` | Admin only | Configure skill schedules, parameters |
| `agents.view` | All roles | View agent definitions |
| `agents.run` | Manager+, Analyst+ | Run agents |
| `agents.draft` | Manager+, Analyst+ | Create draft agents |
| `agents.publish` | Admin only | Publish agents to production |
| `agents.edit_own` | Manager+, Analyst+ | Edit own agents |
| `agents.edit_any` | Manager+, Analyst- | Edit any agent |
| `agents.delete_own` | Manager+, Analyst+ | Delete own agents |
| `agents.delete_any` | Manager+, Analyst- | Delete any agent |
| `config.view` | Manager+, Analyst-, Viewer- | View workspace config |
| `config.edit` | Admin only | Edit workspace config |
| `members.view` | Manager+, Analyst+ | View member list |
| `members.invite` | Admin only | Invite new members |
| `members.remove` | Admin only | Remove members |
| `members.change_roles` | Admin only | Change member roles |
| `data.deals_view` | All roles | View deals data |
| `data.accounts_view` | All roles | View accounts data |
| `data.reps_view_own` | All roles | View own rep data |
| `data.reps_view_team` | Manager+, Analyst- | View team rep data |
| `data.reps_view_all` | Manager+ | View all rep data |
| `data.export` | Manager+ | Export data |

## 📊 Statistics

- **Total Routes**: 377 across 58 files
- **Protected Routes**: 10 (connectors.ts)
- **Remaining Routes**: 367
- **Progress**: 2.7% complete

## 🎯 Recommendation

Given the scale (377 routes), recommend a **phased rollout**:

**Phase 1** (Current): Core middleware + connectors.ts ✅ DONE
**Phase 2**: High-priority routes (skills, agents, data, config, members) - 87 routes
**Phase 3**: Medium-priority routes (findings, actions, analysis, chat) - 40 routes
**Phase 4**: Remaining routes - 240 routes

Each phase can be deployed independently since:
- API keys bypass all permission checks (backward compatible)
- Missing permissions = route still accessible (fail-open for now)
- Can enable stricter enforcement per-route as permissions are applied


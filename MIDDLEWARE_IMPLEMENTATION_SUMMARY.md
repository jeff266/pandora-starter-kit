# Permission Middleware Implementation - Complete Summary

## ✅ What Was Built

### 1. Core Middleware Files

**`server/middleware/permissions.ts`** (310 lines)
- `requirePermission(permission)` - Single permission enforcement
- `requireAnyPermission(...permissions)` - At least one permission required
- `requireFeature(flagKey)` - Feature flag enforcement
- `getWorkspaceMember(workspaceId, userId)` - Shared permission lookup
- Request-level caching (no duplicate queries per request)
- API key bypass (API keys = full admin access)
- TypeScript Express type extensions

**`server/middleware/workspace-context.ts`** (90 lines)
- `attachWorkspaceContext` - Attaches workspace data to all requests
- Informational only - doesn't enforce permissions
- Makes workspace/member data available without re-querying

### 2. Server Integration

**`server/index.ts`** - Wired middleware into main router:
```typescript
import { attachWorkspaceContext } from "./middleware/workspace-context.js";

const workspaceApiRouter = express.Router();
workspaceApiRouter.use(requireWorkspaceAccess);
workspaceApiRouter.use(attachWorkspaceContext);  // ← NEW
```

All workspace-scoped routes now have workspace context attached.

### 3. Route Protection Applied

**`server/routes/connectors.ts`** - 100% protected (10 routes):
- GET routes → `connectors.view`
- POST connect routes → `connectors.connect`
- POST sync routes → `connectors.trigger_sync`
- PATCH update routes → `connectors.connect`

### 4. Documentation Created

- **ROUTE_PERMISSIONS_MAP.md** - Complete mapping of all 377 routes
- **PERMISSION_IMPLEMENTATION_STATUS.md** - Current status and next steps
- **This file** - Usage guide and examples

---

## 📖 How to Use

### Protecting a Route

```typescript
import { requirePermission, requireFeature, requireAnyPermission } from '../middleware/permissions.js';

// Single permission
router.get('/:workspaceId/skills',
  requirePermission('skills.view_results'),
  async (req, res) => {
    // req.userPermissions available here
    // req.workspaceMember available here
  }
);

// Feature flag + permission
router.post('/:workspaceId/skills/conversation-intelligence',
  requireFeature('feature.conversation_intelligence'),
  requirePermission('skills.view_results'),
  async (req, res) => {
    // Both checks passed
  }
);

// Any of multiple permissions
router.patch('/:workspaceId/agents/:id',
  requireAnyPermission('agents.edit_own', 'agents.edit_any'),
  async (req, res) => {
    // User has at least one of these permissions
    // Check req.workspaceMember.userId to determine ownership
  }
);
```

### Accessing Permission Data in Handlers

After `requirePermission()` middleware runs:

```typescript
router.post('/:workspaceId/agents/:id/run',
  requirePermission('agents.run'),
  async (req, res) => {
    // Permission data cached on request
    const permissions = req.userPermissions;  // Full PermissionSet
    const member = req.workspaceMember;       // Member info
    
    console.log(permissions['agents.publish']); // true/false
    console.log(member.role);                   // 'admin', 'manager', etc.
    console.log(member.userId);                 // User ID from users table
    console.log(member.isActive);               // true/false
  }
);
```

### Accessing Workspace Context

After `attachWorkspaceContext` middleware runs (on all workspace routes):

```typescript
router.get('/:workspaceId/some-endpoint', async (req, res) => {
  const workspace = req.workspace;
  
  console.log(workspace.id);         // Workspace UUID
  console.log(workspace.name);       // Workspace name
  console.log(workspace.plan);       // 'starter', 'growth', 'pro', 'enterprise'
  console.log(workspace.createdAt);  // Date
});
```

### Checking Ownership for edit_own/delete_own

```typescript
router.delete('/:workspaceId/agents/:id',
  requireAnyPermission('agents.delete_own', 'agents.delete_any'),
  async (req, res) => {
    const agentId = req.params.id;
    const userId = req.workspaceMember!.userId;
    
    // Query to get agent
    const agentResult = await query(
      'SELECT owner_id FROM agents WHERE id = $1',
      [agentId]
    );
    
    const agent = agentResult.rows[0];
    const isOwner = agent.owner_id === userId;
    const canDeleteAny = req.userPermissions!['agents.delete_any'];
    
    if (!isOwner && !canDeleteAny) {
      return res.status(403).json({ 
        error: 'Can only delete own agents' 
      });
    }
    
    // Proceed with deletion
  }
);
```

---

## 🔐 Permission Reference

### Available Permissions

```typescript
// Connectors (4)
'connectors.view'
'connectors.connect'
'connectors.disconnect'
'connectors.trigger_sync'

// Skills (5)
'skills.view_results'
'skills.view_evidence'
'skills.run_manual'
'skills.run_request'
'skills.configure'

// Agents (8)
'agents.view'
'agents.run'
'agents.draft'
'agents.publish'
'agents.edit_own'
'agents.edit_any'
'agents.delete_own'
'agents.delete_any'

// Config (2)
'config.view'
'config.edit'

// Members (5)
'members.view'
'members.invite'
'members.invite_request'
'members.remove'
'members.change_roles'

// Billing (2)
'billing.view'
'billing.manage'

// Flags (1)
'flags.toggle'

// Data (6)
'data.deals_view'
'data.accounts_view'
'data.reps_view_own'
'data.reps_view_team'
'data.reps_view_all'
'data.export'
```

### Role Matrix

| Role    | Permissions Count | Key Abilities |
|---------|-------------------|---------------|
| Admin   | 33/33 (100%)      | Everything |
| Manager | 21/33 (64%)       | View all data, run skills, manage agents, invite requests |
| Analyst | 13/33 (39%)       | View data, run own agents, view evidence |
| Viewer  | 6/33 (18%)        | View basic results, own data only |

---

## 📋 Example Route Patterns

### GET Routes (Read-only)

```typescript
// View connectors
router.get('/:workspaceId/connectors',
  requirePermission('connectors.view'),
  handler
);

// View deals
router.get('/:workspaceId/deals',
  requirePermission('data.deals_view'),
  handler
);

// View config
router.get('/:workspaceId/config',
  requirePermission('config.view'),
  handler
);
```

### POST Routes (Create/Execute)

```typescript
// Connect new connector
router.post('/:workspaceId/connectors/hubspot/connect',
  requirePermission('connectors.connect'),
  handler
);

// Run skill manually
router.post('/:workspaceId/skills/:skillId/run',
  requirePermission('skills.run_manual'),
  handler
);

// Create agent
router.post('/:workspaceId/agents',
  requirePermission('agents.draft'),
  handler
);
```

### PUT/PATCH Routes (Update)

```typescript
// Update config
router.put('/:workspaceId/config',
  requirePermission('config.edit'),
  handler
);

// Edit agent (check ownership)
router.patch('/:workspaceId/agents/:id',
  requireAnyPermission('agents.edit_own', 'agents.edit_any'),
  handler  // Must check ownership inside handler
);
```

### DELETE Routes (Remove)

```typescript
// Delete agent (check ownership)
router.delete('/:workspaceId/agents/:id',
  requireAnyPermission('agents.delete_own', 'agents.delete_any'),
  handler  // Must check ownership inside handler
);
```

---

## ⚙️ Error Responses

### 400 - Missing workspaceId
```json
{
  "error": "Missing workspaceId parameter"
}
```

### 401 - Not Authenticated
```json
{
  "error": "Authentication required"
}
```

### 403 - Insufficient Permission
```json
{
  "error": "Insufficient permissions",
  "required": "connectors.connect"
}
```

### 403 - Multiple Permissions Required
```json
{
  "error": "Insufficient permissions",
  "required_any": ["agents.edit_own", "agents.edit_any"]
}
```

### 403 - Not a Member
```json
{
  "error": "Not a member of this workspace"
}
```

### 403 - Inactive Member
```json
{
  "error": "Workspace membership is not active"
}
```

### 403 - Feature Not Available
```json
{
  "error": "Feature not available",
  "feature": "feature.conversation_intelligence"
}
```

### 403 - Feature Expired
```json
{
  "error": "Feature access expired",
  "feature": "feature.beta_test"
}
```

---

## 🚀 Next Steps

### Immediate (Done)
- ✅ Core middleware created
- ✅ Workspace context wired
- ✅ connectors.ts fully protected

### Phase 2 (High Priority - 87 routes)
Apply permissions to:
- hubspot.ts, gong.ts, fireflies.ts (connector routes)
- skills.ts (skill execution)
- agents.ts, agent-builder.ts (agent management)
- data.ts (data access)
- config.ts, context.ts (configuration)
- members.ts (member management)

### Phase 3 (Medium Priority - 40 routes)
- findings.ts, action-items.ts
- dossiers.ts, analysis.ts, chat.ts
- account-scoring.ts, enrichment.ts, feedback.ts

### Phase 4 (Remaining - 240 routes)
- All other route files

---

## 🎯 Key Points

1. **API Keys Bypass Permissions** - Existing API key auth still works (admin access)
2. **Fail-Open by Default** - Routes without middleware still accessible (backward compatible)
3. **Request Caching** - Permission lookups cached per-request (no duplicate queries)
4. **Type-Safe** - Full TypeScript support with Express type extensions
5. **Composable** - Stack multiple middleware (feature flags + permissions)
6. **Granular Control** - 33 distinct permissions across 8 domains


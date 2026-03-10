# Credit Control Audit - Skill Execution by Role

**Audit Date:** 2026-03-10
**Scope:** Identify all pages with skill execution buttons and verify permission enforcement

---

## Executive Summary

**🔴 2 CRITICAL VULNERABILITIES FOUND**

Two backend endpoints that execute skills are missing `requirePermission('skills.run_manual')` middleware:
1. `POST /scoring/activate` - Accessible by Analyst+ (ICP Profile page)
2. `POST /:workspaceId/agents/:agentId/run` - Accessible by Admin only (Agent Builder page)

**⚠️ UX ISSUE**: No frontend permission checks exist. Users see skill execution buttons they cannot use, leading to failed API calls and poor UX.

---

## Findings by Page

### Pages with Skill Execution Buttons

| Page | Roles | Button/Feature | Backend Endpoint | Protected? | Risk Level |
|------|-------|----------------|------------------|------------|------------|
| **ICP Profile** | Analyst+ | "Run ICP Discovery →" | `POST /scoring/activate` | ❌ **NO** | 🔴 **CRITICAL** |
| **ICP Profile** | Analyst+ | "Re-run" button | `POST /scoring/activate` | ❌ **NO** | 🔴 **CRITICAL** |
| **Forecast** | Analyst+ | "Run Monte Carlo" | `POST /skills/monte-carlo-forecast/run` | ✅ Yes | ✅ Safe |
| **Forecast** | Analyst+ | "Run Forecast Rollup" | `POST /skills/forecast-rollup/run` | ✅ Yes | ✅ Safe |
| **Playbooks** | Manager+ | "Run Playbook" | `POST /playbooks/:id/run` | ✅ Yes | ✅ Safe |
| **Skills** | Admin | "Run Skill" | `POST /skills/:skillId/run` | ✅ Yes | ✅ Safe |
| **Agent Builder** | Admin | "Run Agent" | `POST /agents/:agentId/run` | ❌ **NO** | 🟡 **MEDIUM** |

---

## Vulnerability Details

### 🔴 CRITICAL: ICP Profile Page (scoring/activate)

**File:** `client/src/pages/IcpProfilePage.tsx`
**Lines:** 272, 1183
**Endpoint:** `POST /:workspaceId/scoring/activate`
**Route File:** `server/routes/scoring-state.ts:81`

**Issue:**
```typescript
// VULNERABLE - Missing requirePermission middleware
router.post('/:workspaceId/scoring/activate', async (req, res) => {
  // Executes ICP Discovery skill via runtime.executeSkill()
  // ...
});
```

**Who Can Access:**
- Admin ✓
- Manager ✓
- Analyst ✓ ← **EXPOSED**
- Member ✗
- Viewer ✗

**Impact:** Analysts can trigger expensive ICP Discovery runs, consuming credits and compute resources.

---

### 🟡 MEDIUM: Agent Builder Page (agents/:id/run)

**File:** `client/src/pages/AgentBuilder.tsx`
**Line:** 386
**Endpoint:** `POST /:workspaceId/agents/:agentId/run`
**Route File:** `server/routes/agents.ts:99`

**Issue:**
```typescript
// VULNERABLE - Missing requirePermission middleware
agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/run', async (req, res) => {
  // Executes agent which runs multiple skills
  const result = await runtime.executeAgent(agentId, workspaceId, { dryRun });
  // ...
});
```

**Who Can Access:**
- Admin ✓ (only role with navigation access)

**Impact:** Lower risk since only Admins can navigate to this page, but still missing permission check. If Agent Builder were ever made accessible to Managers, they could run agents without `skills.run_manual` permission.

---

## Protected Endpoints (✅ Correctly Implemented)

These endpoints correctly use `requirePermission('skills.run_manual')`:

1. **Skills Library**
   ```typescript
   // server/routes/skills.ts:136
   router.post('/:workspaceId/skills/:skillId/run',
     requirePermission('skills.run_manual'),
     async (req, res) => { ... }
   );
   ```

2. **Custom Skills**
   ```typescript
   // server/routes/custom-skills.ts:242
   router.post('/:workspaceId/skills/custom/:skillId/run',
     requirePermission('skills.run_manual'),
     async (req, res) => { ... }
   );
   ```

3. **Playbooks**
   ```typescript
   // server/routes/playbooks.ts:265
   router.post('/:workspaceId/playbooks/:playbookId/run',
     requirePermission('skills.run_manual'),
     async (req, res) => { ... }
   );
   ```

4. **Run All Skills**
   ```typescript
   // server/routes/skills.ts:554
   router.post('/:workspaceId/skills/run-all',
     requirePermission('skills.run_manual'),
     async (req, res) => { ... }
   );
   ```

---

## Frontend Permission Checks

**Status:** ❌ **NONE FOUND**

**Issue:** No pages check `skills.run_manual` permission before rendering skill execution buttons.

**Current Behavior:**
- Users without `skills.run_manual` see all skill execution buttons
- Clicking triggers API call → backend rejects with 403 → poor UX

**Recommended Pattern:**
```typescript
import { usePermissions } from '../hooks/usePermissions';

function IcpProfilePage() {
  const { hasPermission } = usePermissions();
  const canRunSkills = hasPermission('skills.run_manual');

  return (
    <button
      onClick={handleRun}
      disabled={!canRunSkills}
      style={{ display: canRunSkills ? 'block' : 'none' }}
    >
      Run ICP Discovery
    </button>
  );
}
```

---

## Recommendations

### 1. Fix Backend Vulnerabilities (URGENT)

**Priority: P0 - Critical**

Add `requirePermission('skills.run_manual')` to vulnerable endpoints:

```typescript
// server/routes/scoring-state.ts:81
router.post('/:workspaceId/scoring/activate',
  requirePermission('skills.run_manual'),  // ← ADD THIS
  async (req, res) => {
    // ...
  }
);

// server/routes/agents.ts:99
agentsWorkspaceRouter.post('/:workspaceId/agents/:agentId/run',
  requirePermission('skills.run_manual'),  // ← ADD THIS
  async (req, res) => {
    // ...
  }
);
```

---

### 2. Add Frontend Permission Checks (HIGH)

**Priority: P1 - High**

Create `usePermissions` hook if it doesn't exist:

```typescript
// client/src/hooks/usePermissions.ts
import { useWorkspace } from '../context/WorkspaceContext';

export function usePermissions() {
  const { currentWorkspace } = useWorkspace();

  const hasPermission = (permission: string): boolean => {
    // Implement permission check based on role
    // Reference: server/permissions/system-roles.ts
    return currentWorkspace?.permissions?.includes(permission) ?? false;
  };

  return { hasPermission };
}
```

Update pages with skill buttons:
- `IcpProfilePage.tsx` (lines 272, 1183)
- `ForecastPage.tsx` (lines 731, 789, 798)
- `Playbooks.tsx` (line 163)
- `SkillsPage.tsx` (line 261)
- `AgentBuilder.tsx` (line 386)

---

### 3. Navigation Access Matrix Compliance

**Current Navigation (from NAVIGATION-ACCESS-MATRIX.md):**

| Page | Admin | Manager | Analyst | Member | Viewer | Has Skill Buttons? |
|------|:-----:|:-------:|:-------:|:------:|:------:|:------------------:|
| ICP Profile | ✓ | ✓ | ✓ | ✗ | ✗ | ✅ YES (vulnerable) |
| Forecast | ✓ | ✓ | ✓ | ✗ | ✗ | ✅ YES (protected) |
| Playbooks | ✓ | ✓ | ✗ | ✗ | ✗ | ✅ YES (protected) |
| Agent Builder | ✓ | ✗ | ✗ | ✗ | ✗ | ✅ YES (vulnerable) |
| Skills | ✓ | ✗ | ✗ | ✗ | ✗ | ✅ YES (protected) |

**Permission Matrix (from system-roles.ts):**

| Role | skills.run_manual |
|------|:-----------------:|
| Admin | ✅ true |
| Manager | ❌ false |
| Analyst | ❌ false |
| Member | ❌ false |
| Viewer | ❌ false |

**Conflict:** Analysts can navigate to ICP Profile and Forecast pages but should NOT be able to run skills.

**Resolution Options:**

**Option A:** Remove navigation access (align with permissions)
- Hide ICP Profile, Forecast from Analyst role
- Move to Admin/Manager only

**Option B:** Add read-only mode (split view/execute permissions)
- Keep navigation access for Analysts
- Hide skill execution buttons from Analysts
- Show results/dashboards only

**Option C:** Grant Analyst skill execution (align navigation with permissions)
- Update `system-roles.ts` to give Analysts `skills.run_manual = true`
- Accept that Analysts can consume credits

**Recommendation:** Choose **Option B** - Analysts need visibility into ICP and Forecasts for analysis, but shouldn't trigger expensive compute.

---

## Testing Checklist

- [ ] **Backend Protection**
  - [ ] Add `requirePermission('skills.run_manual')` to `/scoring/activate`
  - [ ] Add `requirePermission('skills.run_manual')` to `/agents/:id/run`
  - [ ] Test: Analyst user attempts ICP Discovery → 403 Forbidden
  - [ ] Test: Manager user attempts skill run → 403 Forbidden
  - [ ] Test: Admin user runs skills → 200 Success

- [ ] **Frontend Permission Checks**
  - [ ] Create `usePermissions` hook
  - [ ] Hide "Run ICP Discovery" button for Analyst users
  - [ ] Hide "Run Monte Carlo" button for Analyst users
  - [ ] Hide "Run Playbook" button for Analyst users (already protected by nav)
  - [ ] Test: Analyst sees pages but no skill buttons
  - [ ] Test: Admin sees all skill buttons

- [ ] **End-to-End**
  - [ ] Impersonate Analyst → verify no skill execution possible
  - [ ] Impersonate Manager → verify no skill execution possible
  - [ ] Impersonate Admin → verify skill execution works
  - [ ] Check Slack commands → verify role-based scoping applies

---

## Migration Impact

### Breaking Changes
None - adding middleware only restricts previously unprotected behavior.

### Users Affected
- **Analysts** who previously could trigger ICP Discovery will now get 403 errors
- If any Analysts have been running skills, they will need Admin to run them going forward

### Communication Template
```
Hi [Workspace Admins],

We've identified and fixed a permissions gap where Analyst users could trigger
expensive skill runs (ICP Discovery, Forecasting).

Going forward, only Admins can execute skills. Analysts retain read access to
all ICP, Forecast, and Intelligence pages.

If your team needs Analysts to execute skills, please contact support to discuss
granting the skills.run_manual permission to that role.

- Pandora Team
```

---

## Related Files

### Backend Routes
- `server/routes/scoring-state.ts` (❌ vulnerable, line 81)
- `server/routes/agents.ts` (❌ vulnerable, line 99)
- `server/routes/skills.ts` (✅ protected, lines 136, 554)
- `server/routes/custom-skills.ts` (✅ protected, line 242)
- `server/routes/playbooks.ts` (✅ protected, line 265)

### Frontend Pages
- `client/src/pages/IcpProfilePage.tsx` (lines 272, 1183)
- `client/src/pages/ForecastPage.tsx` (lines 731, 789, 798)
- `client/src/pages/Playbooks.tsx` (line 163)
- `client/src/pages/SkillsPage.tsx` (line 261)
- `client/src/pages/AgentBuilder.tsx` (line 386)

### RBAC Implementation
- `server/permissions/system-roles.ts` (defines skills.run_manual by role)
- `server/middleware/permissions.ts` (requirePermission middleware)
- `NAVIGATION-ACCESS-MATRIX.md` (role-based page access)

---

## Summary

**Total Pages with Skill Buttons:** 5
**Total Skill Execution Endpoints:** 7
**Protected Endpoints:** 5 ✅
**Vulnerable Endpoints:** 2 ❌
**Frontend Permission Checks:** 0 ❌

**Action Required:** Fix 2 backend vulnerabilities + add 5 frontend permission checks.

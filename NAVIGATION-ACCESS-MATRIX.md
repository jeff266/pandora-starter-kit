# Navigation Access Control Matrix (RBAC Phase 2 - T6)

## Role-Based Navigation Access

| Navigation Item | Admin | Manager | Analyst | Member | Viewer | Reasoning |
|-----------------|:-----:|:-------:|:-------:|:------:|:------:|-----------|
| **CORE** |
| Command Center | ✓ | ✓ | ✓ | ✓ | ✓ | Everyone needs access to Ask Pandora |
| **PIPELINE** |
| Deals | ✓ | ✓ | ✓ | ✓ | ✓ | Core functionality (data scoping applied via RBAC) |
| Accounts | ✓ | ✓ | ✓ | ✓ | ✓ | Core functionality (data scoping applied via RBAC) |
| Conversations | ✓ | ✓ | ✓ | ✓ | ✓ | Core functionality |
| Prospects | ✓ | ✓ | ✓ | ✓ | ✓ | Core functionality |
| **INTELLIGENCE** |
| ICP Profile | ✓ | ✓ | ✓ | ✗ | ✗ | Strategic insight - managers/analysts need |
| Pipeline Mechanics | ✓ | ✓ | ✓ | ✗ | ✗ | Strategic insight - managers/analysts need |
| Competition | ✓ | ✓ | ✓ | ✗ | ✗ | Strategic insight - managers/analysts need |
| Winning Path | ✓ | ✓ | ✓ | ✗ | ✗ | Strategic insight - managers/analysts need |
| Agents | ✓ | ✓ | ✓ | ✗ | ✗ | Operational - managers/analysts can view/use |
| Agent Builder | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |
| Skills | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |
| Tools | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |
| Governance | ✓ | ✓ | ✗ | ✗ | ✗ | Management oversight - managers need access |
| **OPERATIONS** |
| Targets | ✓ | ✓ | ✓ | ✓ | ✗ | Reps need to see their quotas |
| Playbooks | ✓ | ✓ | ✗ | ✗ | ✗ | Management/strategy - managers define playbooks |
| Forecast | ✓ | ✓ | ✓ | ✗ | ✗ | Strategic planning - managers/analysts forecast |
| Pipeline | ✓ | ✓ | ✓ | ✓ | ✗ | Operational visibility - reps see their pipeline |
| Push | ✓ | ✓ | ✗ | ✗ | ✗ | Management action - managers push their teams |
| Reports | ✓ | ✓ | ✓ | ✗ | ✗ | Analysis - managers/analysts generate reports |
| Insights Feed | ✓ | ✓ | ✓ | ✓ | ✗ | Operational insights - reps see their insights |
| Actions | ✓ | ✓ | ✓ | ✓ | ✗ | Operational - reps take actions on deals |
| **DATA** |
| Connectors | ✓ | ✗ | ✗ | ✗ | ✗ | Infrastructure - admin only |
| Enrichment | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |
| Dictionary | ✓ | ✓ | ✓ | ✗ | ✗ | Operational reference - managers/analysts need |
| **WORKSPACE** |
| Members | ✓ | ✓ | ✗ | ✗ | ✗ | Management - admins/managers manage people |
| Marketplace | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |
| Settings | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only (includes Field Mapping!) |
| **ADMIN** |
| Token Usage | ✓ | ✗ | ✗ | ✗ | ✗ | Infrastructure - admin only |
| Billing Meter | ✓ | ✗ | ✗ | ✗ | ✗ | Infrastructure - admin only |
| Scopes | ✓ | ✗ | ✗ | ✗ | ✗ | Configuration - admin only |

## Key Insights

### Settings (including Field Configuration)
**Should be hidden from:** Manager, Analyst, Member, Viewer
**Reasoning:** Field mapping and CRM configuration are infrastructure concerns. Only admins should modify how data flows from the CRM.

### Intelligence Section
**Hidden from Members/Viewers** because these are strategic insights meant for decision-makers and analysts, not individual contributors.

### Operations Section
**Selective access** based on job function:
- **Playbooks, Push**: Management tools for directing teams
- **Forecast, Reports**: Analysis tools for planning
- **Targets, Pipeline, Actions**: Operational tools for individual contributors

### Data Section
**Mostly admin-only** except Dictionary which helps managers/analysts understand terminology.

## Implementation

Update `NavItem` interface to support flexible role restrictions:
```typescript
interface NavItem {
  label: string;
  path: string;
  icon: string;
  badge?: number;
  allowedRoles?: ('admin' | 'manager' | 'analyst' | 'member' | 'viewer')[];
}
```

If `allowedRoles` is undefined → accessible to all
If `allowedRoles` is defined → only accessible to listed roles

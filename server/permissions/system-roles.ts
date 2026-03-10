/**
 * System Role Permissions
 * Defines the four built-in roles: admin, manager, analyst, viewer
 */

import { PermissionSet, createPermissionSet } from './types.js';

export const SYSTEM_ROLE_PERMISSIONS: Record<string, PermissionSet> = {
  admin: createPermissionSet(true), // All permissions true

  // Member: standard workspace user — can run analyses, see their own data, use AI features
  member: {
    // Connectors: view + trigger sync (no connect/disconnect)
    'connectors.view': true,
    'connectors.connect': false,
    'connectors.disconnect': false,
    'connectors.trigger_sync': true,

    // Skills: full view + manual run (no configure)
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.run_manual': true,
    'skills.run_request': true,
    'skills.configure': false,

    // Agents: view, run, draft, edit/delete own (no publish, no any)
    'agents.view': true,
    'agents.run': true,
    'agents.draft': true,
    'agents.publish': false,
    'agents.edit_own': true,
    'agents.edit_any': false,
    'agents.delete_own': true,
    'agents.delete_any': false,

    // Config: view only
    'config.view': true,
    'config.edit': false,

    // Members: view + invite_request
    'members.view': true,
    'members.invite': false,
    'members.invite_request': true,
    'members.remove': false,
    'members.change_roles': false,

    // Billing: none
    'billing.view': false,
    'billing.manage': false,

    // Flags: none
    'flags.toggle': false,

    // Data: see only own deals/accounts, own data, export
    'data.deals_view': false, // Changed: members see only their own deals (dealsFilter: 'own')
    'data.accounts_view': true,
    'data.reps_view_own': true,
    'data.reps_view_team': false,
    'data.reps_view_all': false,
    'data.export': true,
  },

  manager: {
    // Connectors: view + trigger sync
    'connectors.view': true,
    'connectors.connect': false,
    'connectors.disconnect': false,
    'connectors.trigger_sync': true,

    // Skills: view + run + request
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.run_manual': true,
    'skills.run_request': true,
    'skills.configure': false,

    // Agents: view, run, draft, edit/delete own (no publish, no delete_any)
    'agents.view': true,
    'agents.run': true,
    'agents.draft': true,
    'agents.publish': false,
    'agents.edit_own': true,
    'agents.edit_any': true,
    'agents.delete_own': true,
    'agents.delete_any': false,

    // Config: view only
    'config.view': true,
    'config.edit': false,

    // Members: view + invite_request
    'members.view': true,
    'members.invite': false,
    'members.invite_request': true,
    'members.remove': false,
    'members.change_roles': false,

    // Billing: none
    'billing.view': false,
    'billing.manage': false,

    // Flags: none
    'flags.toggle': false,

    // Data: all including team/all view and export
    'data.deals_view': true,
    'data.accounts_view': true,
    'data.reps_view_own': true,
    'data.reps_view_team': true,
    'data.reps_view_all': true,
    'data.export': true,
  },

  analyst: {
    // Connectors: view only (need to see data freshness)
    'connectors.view': true,
    'connectors.connect': false,
    'connectors.disconnect': false,
    'connectors.trigger_sync': false,

    // Skills: view + request (no manual run, no configure)
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.run_manual': false,
    'skills.run_request': true,
    'skills.configure': false,

    // Agents: view, run, draft, edit/delete own only
    'agents.view': true,
    'agents.run': true,
    'agents.draft': true,
    'agents.publish': false,
    'agents.edit_own': true,
    'agents.edit_any': false,
    'agents.delete_own': true,
    'agents.delete_any': false,

    // Config: none
    'config.view': false,
    'config.edit': false,

    // Members: view + invite_request
    'members.view': true,
    'members.invite': false,
    'members.invite_request': true,
    'members.remove': false,
    'members.change_roles': false,

    // Billing: none
    'billing.view': false,
    'billing.manage': false,

    // Flags: none
    'flags.toggle': false,

    // Data: view deals/accounts, own reps only (no team/all, no export)
    'data.deals_view': true,
    'data.accounts_view': true,
    'data.reps_view_own': true,
    'data.reps_view_team': false,
    'data.reps_view_all': false,
    'data.export': false,
  },

  viewer: {
    // Connectors: none
    'connectors.view': false,
    'connectors.connect': false,
    'connectors.disconnect': false,
    'connectors.trigger_sync': false,

    // Skills: view results + request (no evidence, no manual run)
    'skills.view_results': true,
    'skills.view_evidence': false,
    'skills.run_manual': false,
    'skills.run_request': true,
    'skills.configure': false,

    // Agents: view only
    'agents.view': true,
    'agents.run': false,
    'agents.draft': false,
    'agents.publish': false,
    'agents.edit_own': false,
    'agents.edit_any': false,
    'agents.delete_own': false,
    'agents.delete_any': false,

    // Config: none
    'config.view': false,
    'config.edit': false,

    // Members: view only (can see who else is in the workspace)
    'members.view': true,
    'members.invite': false,
    'members.invite_request': false,
    'members.remove': false,
    'members.change_roles': false,

    // Billing: none
    'billing.view': false,
    'billing.manage': false,

    // Flags: none
    'flags.toggle': false,

    // Data: see only own deals/accounts, own reps only
    'data.deals_view': false, // Changed: viewers see only their own deals (dealsFilter: 'own')
    'data.accounts_view': true,
    'data.reps_view_own': true,
    'data.reps_view_team': false,
    'data.reps_view_all': false,
    'data.export': false,
  },
};

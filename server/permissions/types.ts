/**
 * Permission System Types
 * Defines all permissions organized by domain
 */

export interface PermissionSet {
  // Connectors
  'connectors.view': boolean;
  'connectors.connect': boolean;
  'connectors.disconnect': boolean;
  'connectors.trigger_sync': boolean;

  // Skills
  'skills.view_results': boolean;
  'skills.view_evidence': boolean;
  'skills.run_manual': boolean;
  'skills.run_request': boolean;
  'skills.configure': boolean;

  // Agents
  'agents.view': boolean;
  'agents.run': boolean;
  'agents.draft': boolean;
  'agents.publish': boolean;
  'agents.edit_own': boolean;
  'agents.edit_any': boolean;
  'agents.delete_own': boolean;
  'agents.delete_any': boolean;

  // Config
  'config.view': boolean;
  'config.edit': boolean;

  // Members
  'members.view': boolean;
  'members.invite': boolean;
  'members.invite_request': boolean;
  'members.remove': boolean;
  'members.change_roles': boolean;

  // Billing
  'billing.view': boolean;
  'billing.manage': boolean;

  // Flags
  'flags.toggle': boolean;

  // Data
  'data.deals_view': boolean;
  'data.accounts_view': boolean;
  'data.reps_view_own': boolean;
  'data.reps_view_team': boolean;
  'data.reps_view_all': boolean;
  'data.export': boolean;
}

/**
 * Check if a permission is granted in the given permission set
 */
export function hasPermission(
  permissions: PermissionSet,
  key: keyof PermissionSet
): boolean {
  return permissions[key] === true;
}

/**
 * Helper to create a permission set with all permissions set to a default value
 */
export function createPermissionSet(defaultValue = false): PermissionSet {
  return {
    'connectors.view': defaultValue,
    'connectors.connect': defaultValue,
    'connectors.disconnect': defaultValue,
    'connectors.trigger_sync': defaultValue,

    'skills.view_results': defaultValue,
    'skills.view_evidence': defaultValue,
    'skills.run_manual': defaultValue,
    'skills.run_request': defaultValue,
    'skills.configure': defaultValue,

    'agents.view': defaultValue,
    'agents.run': defaultValue,
    'agents.draft': defaultValue,
    'agents.publish': defaultValue,
    'agents.edit_own': defaultValue,
    'agents.edit_any': defaultValue,
    'agents.delete_own': defaultValue,
    'agents.delete_any': defaultValue,

    'config.view': defaultValue,
    'config.edit': defaultValue,

    'members.view': defaultValue,
    'members.invite': defaultValue,
    'members.invite_request': defaultValue,
    'members.remove': defaultValue,
    'members.change_roles': defaultValue,

    'billing.view': defaultValue,
    'billing.manage': defaultValue,

    'flags.toggle': defaultValue,

    'data.deals_view': defaultValue,
    'data.accounts_view': defaultValue,
    'data.reps_view_own': defaultValue,
    'data.reps_view_team': defaultValue,
    'data.reps_view_all': defaultValue,
    'data.export': defaultValue,
  };
}

import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import Toast from '../Toast';

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  member_count: number;
  permissions: Record<string, boolean>;
}

interface PermissionGroup {
  title: string;
  permissions: PermissionDef[];
}

interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Connectors',
    permissions: [
      { key: 'connectors.view', label: 'View Connectors', description: 'View connector status and sync history' },
      { key: 'connectors.connect', label: 'Connect Sources', description: 'Add new data source connections' },
      { key: 'connectors.disconnect', label: 'Disconnect Sources', description: 'Remove connector integrations' },
      { key: 'connectors.trigger_sync', label: 'Trigger Syncs', description: 'Manually trigger data syncs' },
    ],
  },
  {
    title: 'Skills',
    permissions: [
      { key: 'skills.view_results', label: 'View Results', description: 'View skill run results and findings' },
      { key: 'skills.view_evidence', label: 'View Evidence', description: 'Access detailed evidence and drill-down data' },
      { key: 'skills.run_manual', label: 'Run Manually', description: 'Trigger manual skill runs' },
      { key: 'skills.run_request', label: 'Request Run', description: 'Request admin approval to run skills' },
      { key: 'skills.configure', label: 'Configure', description: 'Edit skill settings and schedules' },
    ],
  },
  {
    title: 'Agents',
    permissions: [
      { key: 'agents.view', label: 'View Agents', description: 'View agent definitions and runs' },
      { key: 'agents.run', label: 'Run Agents', description: 'Trigger agent executions' },
      { key: 'agents.draft', label: 'Create Drafts', description: 'Create draft agents' },
      { key: 'agents.publish', label: 'Publish Agents', description: 'Publish agents to production' },
      { key: 'agents.edit_own', label: 'Edit Own', description: 'Edit agents you created' },
      { key: 'agents.edit_any', label: 'Edit Any', description: 'Edit any agent in the workspace' },
      { key: 'agents.delete_own', label: 'Delete Own', description: 'Delete agents you created' },
      { key: 'agents.delete_any', label: 'Delete Any', description: 'Delete any agent in the workspace' },
    ],
  },
  {
    title: 'Data Access',
    permissions: [
      { key: 'data.deals_view', label: 'View Deals', description: 'Access deal data and pipeline' },
      { key: 'data.accounts_view', label: 'View Accounts', description: 'Access account and contact data' },
      { key: 'data.reps_view_own', label: 'View Own Data', description: 'View data for deals you own' },
      { key: 'data.reps_view_team', label: 'View Team Data', description: 'View data for your team' },
      { key: 'data.reps_view_all', label: 'View All Data', description: 'View all workspace data' },
      { key: 'data.export', label: 'Export Data', description: 'Export data to CSV and Excel' },
    ],
  },
  {
    title: 'Workspace',
    permissions: [
      { key: 'config.view', label: 'View Config', description: 'View workspace configuration' },
      { key: 'config.edit', label: 'Edit Config', description: 'Modify workspace settings' },
      { key: 'flags.toggle', label: 'Toggle Features', description: 'Enable/disable feature flags' },
    ],
  },
  {
    title: 'Members',
    permissions: [
      { key: 'members.view', label: 'View Members', description: 'View workspace member list' },
      { key: 'members.invite', label: 'Invite Members', description: 'Send workspace invitations' },
      { key: 'members.invite_request', label: 'Request Invite', description: 'Request permission to invite others' },
      { key: 'members.remove', label: 'Remove Members', description: 'Remove members from workspace' },
      { key: 'members.change_roles', label: 'Change Roles', description: 'Modify member permissions' },
    ],
  },
  {
    title: 'Billing',
    permissions: [
      { key: 'billing.view', label: 'View Billing', description: 'View subscription and usage' },
      { key: 'billing.manage', label: 'Manage Billing', description: 'Update payment and plan details' },
    ],
  },
];

export default function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewRoleModal, setShowNewRoleModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [customRolesEnabled, setCustomRolesEnabled] = useState(false);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const data = await api.get('/roles');
      setRoles(data.roles || []);
      if (data.roles && data.roles.length > 0) {
        setSelectedRoleId(data.roles[0].id);
      }
      setCustomRolesEnabled(data.custom_roles_enabled !== false); // TODO: Check feature flag
    } catch (err) {
      console.error('Failed to fetch roles:', err);
      setToast({ message: 'Failed to load roles', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const selectedRole = roles.find(r => r.id === selectedRoleId);

  const handlePermissionToggle = (permissionKey: string) => {
    if (!selectedRole || selectedRole.is_system) return;

    setRoles(prev => prev.map(role =>
      role.id === selectedRoleId
        ? { ...role, permissions: { ...role.permissions, [permissionKey]: !role.permissions[permissionKey] } }
        : role
    ));
    setHasUnsavedChanges(true);
  };

  const handleSaveChanges = async () => {
    if (!selectedRole) return;

    try {
      await api.patch(`/roles/${selectedRole.id}`, {
        permissions: selectedRole.permissions,
        name: selectedRole.name,
        description: selectedRole.description,
      });
      setToast({ message: 'Role updated', type: 'success' });
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to save role:', err);
      setToast({ message: 'Failed to save changes', type: 'error' });
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.is_system) return;

    try {
      await api.delete(`/roles/${selectedRole.id}`);
      setToast({ message: 'Role deleted', type: 'success' });
      setShowDeleteConfirm(false);
      await fetchRoles();
    } catch (err) {
      console.error('Failed to delete role:', err);
      setToast({ message: 'Failed to delete role', type: 'error' });
    }
  };

  const handleCreateRole = async (newRole: { name: string; description: string; templateId: string }) => {
    try {
      const template = roles.find(r => r.id === newRole.templateId);
      await api.post('/roles', {
        name: newRole.name,
        description: newRole.description,
        permissions: template?.permissions || {},
      });
      setToast({ message: 'Role created', type: 'success' });
      setShowNewRoleModal(false);
      await fetchRoles();
    } catch (err) {
      console.error('Failed to create role:', err);
      setToast({ message: 'Failed to create role', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 32,
          height: 32,
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const systemRoles = roles.filter(r => r.is_system);
  const customRoles = roles.filter(r => !r.is_system);

  return (
    <div style={{ maxWidth: 1200, fontFamily: fonts.sans }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Roles
        </h1>
        <p style={{ fontSize: 14, color: colors.textSecondary }}>
          Manage workspace roles and permissions
        </p>
      </div>

      <div style={{ display: 'flex', gap: 24, minHeight: 600 }}>
        {/* Role List Sidebar */}
        <div
          style={{
            width: 220,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* System Roles */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textDim, marginBottom: 8, letterSpacing: '0.05em' }}>
              SYSTEM ROLES
            </div>
            {systemRoles.map(role => (
              <button
                key={role.id}
                onClick={() => {
                  if (hasUnsavedChanges) {
                    if (!confirm('You have unsaved changes. Discard them?')) return;
                    setHasUnsavedChanges(false);
                  }
                  setSelectedRoleId(role.id);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  marginBottom: 4,
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: selectedRoleId === role.id ? colors.accent : colors.textSecondary,
                  background: selectedRoleId === role.id ? colors.accentSoft : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textTransform: 'capitalize',
                }}
                onMouseEnter={e => {
                  if (selectedRoleId !== role.id) e.currentTarget.style.background = colors.surfaceHover;
                }}
                onMouseLeave={e => {
                  if (selectedRoleId !== role.id) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: 12, opacity: 0.6 }}>🔒</span>
                <span>{role.name}</span>
              </button>
            ))}
          </div>

          {/* Custom Roles */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textDim, marginBottom: 8, letterSpacing: '0.05em' }}>
              CUSTOM ROLES
            </div>
            {customRoles.length === 0 ? (
              <div style={{ fontSize: 12, color: colors.textMuted, padding: '8px 12px', fontStyle: 'italic' }}>
                No custom roles yet
              </div>
            ) : (
              customRoles.map(role => (
                <button
                  key={role.id}
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      if (!confirm('You have unsaved changes. Discard them?')) return;
                      setHasUnsavedChanges(false);
                    }
                    setSelectedRoleId(role.id);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    marginBottom: 4,
                    fontSize: 13,
                    fontFamily: fonts.sans,
                    color: selectedRoleId === role.id ? colors.accent : colors.textSecondary,
                    background: selectedRoleId === role.id ? colors.accentSoft : 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    if (selectedRoleId !== role.id) e.currentTarget.style.background = colors.surfaceHover;
                  }}
                  onMouseLeave={e => {
                    if (selectedRoleId !== role.id) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span style={{ fontSize: 12, opacity: 0.6 }}>✏️</span>
                  <span>{role.name}</span>
                </button>
              ))
            )}
          </div>

          {/* New Role Button */}
          <button
            onClick={() => customRolesEnabled ? setShowNewRoleModal(true) : null}
            disabled={!customRolesEnabled}
            title={customRolesEnabled ? 'Create new role' : 'Upgrade to Growth plan'}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: customRolesEnabled ? colors.accent : colors.textDim,
              background: 'transparent',
              border: `1px solid ${customRolesEnabled ? colors.accent : colors.border}`,
              borderRadius: 6,
              cursor: customRolesEnabled ? 'pointer' : 'not-allowed',
              marginTop: 12,
            }}
          >
            + New Role
          </button>
        </div>

        {/* Permission Matrix */}
        {selectedRole && (
          <div
            style={{
              flex: 1,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 32,
              overflowY: 'auto',
            }}
          >
            {/* Role Header */}
            <div style={{ marginBottom: 32 }}>
              {selectedRole.is_system ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 600, color: colors.text, marginBottom: 4, textTransform: 'capitalize' }}>
                    {selectedRole.name}
                  </div>
                  <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
                    {selectedRole.description || 'System role'}
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={selectedRole.name}
                    onChange={e => {
                      setRoles(prev => prev.map(r => r.id === selectedRoleId ? { ...r, name: e.target.value } : r));
                      setHasUnsavedChanges(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 20,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      color: colors.text,
                      background: colors.surfaceRaised,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      marginBottom: 8,
                      outline: 'none',
                    }}
                    onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
                    onBlur={e => (e.target.style.borderColor = colors.border)}
                  />
                  <textarea
                    value={selectedRole.description || ''}
                    onChange={e => {
                      setRoles(prev => prev.map(r => r.id === selectedRoleId ? { ...r, description: e.target.value } : r));
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Role description"
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      fontFamily: fonts.sans,
                      color: colors.textMuted,
                      background: colors.surfaceRaised,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      marginBottom: 12,
                      outline: 'none',
                      resize: 'vertical',
                    }}
                    onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
                    onBlur={e => (e.target.style.borderColor = colors.border)}
                  />
                </>
              )}
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                {selectedRole.member_count} member{selectedRole.member_count !== 1 ? 's' : ''} with this role
              </div>
            </div>

            {/* Permissions by Group */}
            {PERMISSION_GROUPS.map((group, groupIndex) => (
              <div key={group.title} style={{ marginBottom: groupIndex < PERMISSION_GROUPS.length - 1 ? 32 : 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
                  {group.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.permissions.map(perm => (
                    <div
                      key={perm.key}
                      title={perm.description}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: colors.surfaceRaised,
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, color: colors.text }}>{perm.label}</div>
                        <div style={{ fontSize: 11, color: colors.textMuted }}>{perm.description}</div>
                      </div>
                      <div
                        onClick={() => handlePermissionToggle(perm.key)}
                        style={{
                          width: 48,
                          height: 26,
                          borderRadius: 13,
                          background: selectedRole.permissions[perm.key] ? colors.accent : colors.surfaceHover,
                          position: 'relative',
                          cursor: selectedRole.is_system ? 'not-allowed' : 'pointer',
                          transition: 'background 0.2s',
                          opacity: selectedRole.is_system ? 0.5 : 1,
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute',
                            top: 3,
                            left: selectedRole.permissions[perm.key] ? 25 : 3,
                            transition: 'left 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Actions */}
            {!selectedRole.is_system && (
              <div style={{ marginTop: 32, paddingTop: 32, borderTop: `1px solid ${colors.border}` }}>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
                  <div>
                    {selectedRole.member_count === 0 && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        style={{
                          padding: '10px 20px',
                          fontSize: 14,
                          fontWeight: 500,
                          fontFamily: fonts.sans,
                          color: colors.red,
                          background: 'transparent',
                          border: `1px solid ${colors.red}`,
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        Delete Role
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {hasUnsavedChanges && (
                      <span style={{ fontSize: 13, color: colors.yellow, alignSelf: 'center' }}>
                        • Unsaved changes
                      </span>
                    )}
                    <button
                      onClick={handleSaveChanges}
                      disabled={!hasUnsavedChanges}
                      style={{
                        padding: '10px 20px',
                        fontSize: 14,
                        fontWeight: 500,
                        fontFamily: fonts.sans,
                        color: '#fff',
                        background: hasUnsavedChanges ? colors.accent : colors.surfaceHover,
                        border: 'none',
                        borderRadius: 6,
                        cursor: hasUnsavedChanges ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Role Modal */}
      {showNewRoleModal && (
        <NewRoleModal
          roles={roles}
          onClose={() => setShowNewRoleModal(false)}
          onCreate={handleCreateRole}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && selectedRole && (
        <ConfirmDialog
          message={`Delete ${selectedRole.name}? This cannot be undone.`}
          onConfirm={handleDeleteRole}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function NewRoleModal({
  roles,
  onClose,
  onCreate,
}: {
  roles: Role[];
  onClose: () => void;
  onCreate: (role: { name: string; description: string; templateId: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState(roles.find(r => r.name.toLowerCase() === 'analyst')?.id || roles[0]?.id || '');
  const [error, setError] = useState('');

  const RESERVED_NAMES = ['admin', 'manager', 'analyst', 'viewer'];

  const handleSubmit = () => {
    setError('');

    if (!name.trim()) {
      setError('Role name is required');
      return;
    }

    if (RESERVED_NAMES.includes(name.toLowerCase())) {
      setError(`"${name}" is a reserved role name`);
      return;
    }

    if (roles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      setError('A role with this name already exists');
      return;
    }

    onCreate({ name: name.trim(), description: description.trim(), templateId });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: fonts.sans,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
          maxWidth: 500,
          width: '90%',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 20 }}>
          Create New Role
        </h2>

        {error && (
          <div style={{
            padding: 12,
            background: colors.redSoft,
            border: `1px solid ${colors.red}`,
            borderRadius: 6,
            color: colors.red,
            fontSize: 13,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Role name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Sales Manager"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
            }}
            onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
            onBlur={e => (e.target.style.borderColor = colors.border)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe this role's purpose"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
              resize: 'vertical',
            }}
            onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
            onBlur={e => (e.target.style.borderColor = colors.border)}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Start from template
          </label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {roles.map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: '#fff',
              background: colors.accent,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Create Role
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: fonts.sans,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
          maxWidth: 400,
          width: '90%',
        }}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ fontSize: 14, color: colors.text, marginBottom: 20 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: '#fff',
              background: colors.red,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

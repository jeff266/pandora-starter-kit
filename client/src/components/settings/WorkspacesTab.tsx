import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace, WorkspaceInfo } from '../../context/WorkspaceContext';
import Toast from '../Toast';

interface WorkspaceWithDetails extends WorkspaceInfo {
  last_login_at?: string | null;
}

interface UserData {
  id: string;
  email: string;
  name: string;
  account_type: string;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getWorkspaceGradient(name: string): string {
  const hash = hashString(name);
  const hue1 = hash % 360;
  const hue2 = (hash + 137) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 60%, 50%), hsl(${hue2}, 60%, 40%))`;
}

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Active just now';
  if (diffMins < 60) return `Active ${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `Active ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `Active ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `Active ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
  return `Active ${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
}

export default function WorkspacesTab() {
  const navigate = useNavigate();
  const { currentWorkspace, workspaces, selectWorkspace } = useWorkspace();
  const [user, setUser] = useState<UserData | null>(null);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('pandora_session');
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch workspaces');
      const data = await res.json();
      setUser(data.user);
      setWorkspaceList(data.workspaces || []);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      setToast({ message: 'Failed to load workspaces', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchWorkspace = (workspace: WorkspaceWithDetails) => {
    selectWorkspace(workspace);
    navigate('/');
    setToast({ message: `Switched to ${workspace.name}`, type: 'success' });
  };

  const handleLeaveWorkspace = async (workspaceId: string, workspaceName: string) => {
    if (!user) return;

    try {
      setLeaving(true);
      const token = localStorage.getItem('pandora_session');

      // Get member ID for this user in this workspace
      // For now, we'll use the user ID - the backend should handle finding the member record
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to leave workspace');
      }

      // Remove from local list
      setWorkspaceList(prev => prev.filter(w => w.id !== workspaceId));
      setLeaveConfirm(null);
      setToast({ message: `Left ${workspaceName}`, type: 'success' });
    } catch (err) {
      console.error('Failed to leave workspace:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to leave workspace';
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setLeaving(false);
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

  const isMultiWorkspace = user?.account_type === 'multi_workspace';

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text }}>
          Your Workspaces
        </h1>
        {isMultiWorkspace && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.accent,
              background: colors.accentSoft,
              padding: '4px 10px',
              borderRadius: 6,
              fontFamily: fonts.mono,
            }}
          >
            {workspaceList.length} workspace{workspaceList.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Manage your workspace memberships
      </p>

      {/* Empty State */}
      {workspaceList.length === 0 ? (
        <div
          style={{
            padding: 60,
            textAlign: 'center',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>▦</div>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            You're not a member of any workspaces yet.
          </p>
        </div>
      ) : (
        <>
          {/* Workspace Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
            {workspaceList.map(workspace => {
              const isCurrent = workspace.id === currentWorkspace?.id;
              const isInLeaveMode = leaveConfirm === workspace.id;

              return (
                <div
                  key={workspace.id}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${isCurrent ? colors.accent : colors.border}`,
                    borderRadius: 8,
                    padding: 20,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Workspace Avatar */}
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: getWorkspaceGradient(workspace.name),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        fontWeight: 700,
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {workspace.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Workspace Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
                        {workspace.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {/* Role Badge */}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: colors.textSecondary,
                            background: colors.surfaceHover,
                            padding: '2px 8px',
                            borderRadius: 4,
                            textTransform: 'capitalize',
                          }}
                        >
                          {workspace.role}
                        </span>
                        {/* Last Active */}
                        <span style={{ fontSize: 12, color: colors.textMuted }}>
                          {formatRelativeTime(workspace.last_login_at)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isCurrent ? (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: colors.accent,
                            background: colors.accentSoft,
                            padding: '6px 12px',
                            borderRadius: 6,
                          }}
                        >
                          Current
                        </span>
                      ) : isMultiWorkspace ? (
                        <button
                          onClick={() => handleSwitchWorkspace(workspace)}
                          style={{
                            padding: '6px 12px',
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
                          Switch
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Leave Workspace Section */}
                  {!isCurrent && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
                      {!isInLeaveMode ? (
                        <button
                          onClick={() => setLeaveConfirm(workspace.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: colors.red,
                            fontSize: 12,
                            cursor: 'pointer',
                            fontFamily: fonts.sans,
                            padding: 0,
                            textDecoration: 'underline',
                          }}
                        >
                          Leave {workspace.name}
                        </button>
                      ) : (
                        <div
                          style={{
                            padding: 12,
                            background: colors.redSoft,
                            border: `1px solid ${colors.red}`,
                            borderRadius: 6,
                          }}
                        >
                          <p style={{ fontSize: 13, color: colors.red, marginBottom: 10, fontWeight: 500 }}>
                            Are you sure? You'll lose access immediately.
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleLeaveWorkspace(workspace.id, workspace.name)}
                              disabled={leaving}
                              style={{
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 500,
                                fontFamily: fonts.sans,
                                color: '#fff',
                                background: leaving ? colors.surfaceHover : colors.red,
                                border: 'none',
                                borderRadius: 4,
                                cursor: leaving ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {leaving ? 'Leaving...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setLeaveConfirm(null)}
                              disabled={leaving}
                              style={{
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 500,
                                fontFamily: fonts.sans,
                                color: colors.text,
                                background: colors.surfaceRaised,
                                border: `1px solid ${colors.border}`,
                                borderRadius: 4,
                                cursor: leaving ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Current Workspace Message */}
                  {isCurrent && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
                      <p style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
                        Switch workspaces to manage membership
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

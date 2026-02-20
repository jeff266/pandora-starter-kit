import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import Toast from '../Toast';
import { api } from '../../lib/api';

type TabView = 'active' | 'pending' | 'requests';

interface Member {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: { id: string; name: string };
  joined_at: string;
  invited_at: string;
  accepted_at: string | null;
  last_login_at: string | null;
  status: 'active' | 'pending' | 'suspended';
}

interface Role {
  id: string;
  name: string;
  is_system: boolean;
}

interface InviteRequest {
  id: string;
  requester: { name: string; email: string };
  proposed_email: string;
  proposed_role: { id: string; name: string };
  note: string | null;
  created_at: string;
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

function getAvatarGradient(name: string): string {
  const hash = hashString(name);
  const hue1 = hash % 360;
  const hue2 = (hash + 137) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 65%, 55%), hsl(${hue2}, 65%, 45%))`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export default function MembersTab() {
  const { currentWorkspace, user } = useWorkspace();
  const [activeTab, setActiveTab] = useState<TabView>('active');
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [inviteRequests, setInviteRequests] = useState<InviteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [actionConfirm, setActionConfirm] = useState<{ memberId: string; action: string; name: string } | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Permissions (derived from workspace role - simplified for now)
  const canChangeRoles = currentWorkspace?.role === 'admin';
  const canInvite = currentWorkspace?.role === 'admin';

  useEffect(() => {
    if (currentWorkspace) {
      fetchMembers();
      fetchRoles();
      if (canInvite) {
        fetchInviteRequests();
      }
    }
  }, [currentWorkspace]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const data = await api.get('/members');
      setMembers(data.members || []);
    } catch (err) {
      console.error('Failed to fetch members:', err);
      setToast({ message: 'Failed to load members', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const data = await api.get('/roles');
      setRoles(data.roles || []);
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  };

  const fetchInviteRequests = async () => {
    try {
      const data = await api.get('/members/invite-requests');
      setInviteRequests(data.requests || []);
    } catch (err) {
      console.error('Failed to fetch invite requests:', err);
    }
  };

  const handleRoleChange = async (memberId: string, newRoleId: string) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    const oldRoleId = member.role.id;

    // Optimistic update
    setMembers(prev =>
      prev.map(m => m.id === memberId ? { ...m, role: { ...m.role, id: newRoleId } } : m)
    );

    try {
      await api.patch(`/members/${memberId}/role`, { role_id: newRoleId });
      setToast({ message: 'Role updated', type: 'success' });
      // Refresh to get updated role name
      await fetchMembers();
    } catch (err) {
      // Revert on error
      setMembers(prev =>
        prev.map(m => m.id === memberId ? { ...m, role: { ...m.role, id: oldRoleId } } : m)
      );
      console.error('Failed to update role:', err);
      setToast({ message: 'Failed to update role', type: 'error' });
    }
  };

  const handleSuspend = async (memberId: string, name: string) => {
    try {
      await api.patch(`/members/${memberId}/status`, { status: 'suspended' });
      setToast({ message: `${name} suspended`, type: 'success' });
      setActionConfirm(null);
      await fetchMembers();
    } catch (err) {
      console.error('Failed to suspend member:', err);
      setToast({ message: 'Failed to suspend member', type: 'error' });
    }
  };

  const handleReactivate = async (memberId: string, name: string) => {
    try {
      await api.patch(`/members/${memberId}/status`, { status: 'active' });
      setToast({ message: `${name} reactivated`, type: 'success' });
      await fetchMembers();
    } catch (err) {
      console.error('Failed to reactivate member:', err);
      setToast({ message: 'Failed to reactivate member', type: 'error' });
    }
  };

  const handleRemove = async (memberId: string, name: string) => {
    try {
      await api.delete(`/members/${memberId}`);
      setToast({ message: `${name} removed`, type: 'success' });
      setActionConfirm(null);
      await fetchMembers();
    } catch (err) {
      console.error('Failed to remove member:', err);
      const errorMsg = err instanceof Error && err.message.includes('last admin')
        ? 'Cannot remove the last admin'
        : 'Failed to remove member';
      setToast({ message: errorMsg, type: 'error' });
    }
  };

  const handleRevokePending = async (memberId: string, email: string) => {
    try {
      await api.delete(`/members/${memberId}`);
      setToast({ message: `Invite to ${email} revoked`, type: 'success' });
      await fetchMembers();
    } catch (err) {
      console.error('Failed to revoke invite:', err);
      setToast({ message: 'Failed to revoke invite', type: 'error' });
    }
  };

  const handleResendInvite = (email: string) => {
    setToast({ message: 'Resend invite coming soon', type: 'info' });
  };

  const handleResolveRequest = async (requestId: string, action: 'approve' | 'reject') => {
    // Optimistic removal
    setInviteRequests(prev => prev.filter(r => r.id !== requestId));

    try {
      await api.post(`/members/invite-requests/${requestId}/resolve`, { action });
      setToast({ message: `Request ${action}d`, type: 'success' });
      if (action === 'approve') {
        await fetchMembers(); // Refresh to show new pending invite
      }
    } catch (err) {
      console.error('Failed to resolve request:', err);
      setToast({ message: 'Failed to resolve request', type: 'error' });
      // Revert optimistic update
      await fetchInviteRequests();
    }
  };

  const activeMembers = members.filter(m => m.status === 'active' || m.status === 'suspended');
  const pendingMembers = members.filter(m => m.status === 'pending');

  const filteredActiveMembers = activeMembers.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  return (
    <div style={{ maxWidth: 1000, fontFamily: fonts.sans }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
            Members
          </h1>
          <p style={{ fontSize: 14, color: colors.textSecondary }}>
            Manage workspace members and invitations
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowInviteModal(true)}
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
            Invite Member
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${colors.border}` }}>
        {(['active', 'pending', 'requests'] as TabView[]).map(tab => {
          const isActive = activeTab === tab;
          const label = tab === 'active' ? 'Active' : tab === 'pending' ? 'Pending' : 'Requests';
          const showTab = tab === 'requests' ? canInvite : true;
          if (!showTab) return null;

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                fontFamily: fonts.sans,
                color: isActive ? colors.accent : colors.textSecondary,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.2s',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Active Members Tab */}
      {activeTab === 'active' && (
        <div>
          {/* Search */}
          <input
            type="text"
            placeholder="Search members..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
              marginBottom: 16,
            }}
            onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
            onBlur={e => (e.target.style.borderColor = colors.border)}
          />

          {/* Members Table */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {filteredActiveMembers.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
                No members found
              </div>
            ) : (
              filteredActiveMembers.map(member => (
                <MemberRow
                  key={member.id}
                  member={member}
                  roles={roles}
                  currentUserId={user?.id}
                  canChangeRoles={canChangeRoles}
                  isActionMenuOpen={actionMenuOpen === member.id}
                  onToggleActionMenu={() => setActionMenuOpen(actionMenuOpen === member.id ? null : member.id)}
                  onRoleChange={handleRoleChange}
                  onSuspend={() => setActionConfirm({ memberId: member.id, action: 'suspend', name: member.name })}
                  onReactivate={() => handleReactivate(member.id, member.name)}
                  onRemove={() => setActionConfirm({ memberId: member.id, action: 'remove', name: member.name })}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Pending Invites Tab */}
      {activeTab === 'pending' && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {pendingMembers.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
              No pending invites
            </div>
          ) : (
            pendingMembers.map(member => (
              <PendingInviteRow
                key={member.id}
                member={member}
                onResend={() => handleResendInvite(member.email)}
                onRevoke={() => handleRevokePending(member.id, member.email)}
              />
            ))
          )}
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && canInvite && (
        <div>
          {inviteRequests.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
              No pending requests
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {inviteRequests.map(request => (
                <InviteRequestCard
                  key={request.id}
                  request={request}
                  onApprove={() => handleResolveRequest(request.id, 'approve')}
                  onReject={() => handleResolveRequest(request.id, 'reject')}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Confirmation */}
      {actionConfirm && (
        <ConfirmDialog
          message={
            actionConfirm.action === 'suspend'
              ? `Suspend ${actionConfirm.name}? They'll lose access immediately.`
              : `Remove ${actionConfirm.name}? This cannot be undone.`
          }
          onConfirm={() => {
            if (actionConfirm.action === 'suspend') {
              handleSuspend(actionConfirm.memberId, actionConfirm.name);
            } else {
              handleRemove(actionConfirm.memberId, actionConfirm.name);
            }
          }}
          onCancel={() => setActionConfirm(null)}
        />
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteModal
          roles={roles}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false);
            fetchMembers();
            setToast({ message: 'Invite sent', type: 'success' });
          }}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

// Subcomponents

function MemberRow({
  member,
  roles,
  currentUserId,
  canChangeRoles,
  isActionMenuOpen,
  onToggleActionMenu,
  onRoleChange,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  member: Member;
  roles: Role[];
  currentUserId?: string;
  canChangeRoles: boolean;
  isActionMenuOpen: boolean;
  onToggleActionMenu: () => void;
  onRoleChange: (memberId: string, roleId: string) => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  const isSuspended = member.status === 'suspended';
  const isSelf = member.user_id === currentUserId;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        borderBottom: `1px solid ${colors.border}`,
        opacity: isSuspended ? 0.5 : 1,
      }}
    >
      {/* Avatar + Name + Email */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 250 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: member.avatar_url ? `url(${member.avatar_url})` : getAvatarGradient(member.name),
            backgroundSize: 'cover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {!member.avatar_url && getInitials(member.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            {member.name}
            {isSuspended && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.yellow,
                background: colors.yellowSoft,
                padding: '2px 6px',
                borderRadius: 4,
              }}>
                Suspended
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>{member.email}</div>
        </div>
      </div>

      {/* Role */}
      <div style={{ width: 140 }}>
        {canChangeRoles && !isSelf ? (
          <select
            value={member.role.id}
            onChange={e => onRoleChange(member.id, e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: 13,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {roles.map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 13, color: colors.textSecondary, textTransform: 'capitalize' }}>
            {member.role.name}
          </span>
        )}
      </div>

      {/* Joined */}
      <div style={{ width: 100, fontSize: 13, color: colors.textMuted }}>
        {formatRelativeTime(member.joined_at)}
      </div>

      {/* Last Active */}
      <div style={{ width: 100, fontSize: 13, color: colors.textMuted }}>
        {formatRelativeTime(member.last_login_at)}
      </div>

      {/* Actions */}
      <div style={{ position: 'relative', width: 40 }}>
        <button
          onClick={onToggleActionMenu}
          disabled={isSelf}
          style={{
            padding: '6px',
            fontSize: 16,
            color: isSelf ? colors.textDim : colors.textSecondary,
            background: 'transparent',
            border: 'none',
            cursor: isSelf ? 'not-allowed' : 'pointer',
            borderRadius: 4,
          }}
          title={isSelf ? 'Cannot modify yourself' : 'Actions'}
        >
          ⋮
        </button>
        {isActionMenuOpen && !isSelf && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 100,
              minWidth: 140,
            }}
          >
            {isSuspended ? (
              <button
                onClick={() => { onReactivate(); onToggleActionMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.green,
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Reactivate
              </button>
            ) : (
              <button
                onClick={() => { onSuspend(); onToggleActionMenu(); }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.yellow,
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Suspend
              </button>
            )}
            <button
              onClick={() => { onRemove(); onToggleActionMenu(); }}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.red,
                background: 'transparent',
                border: 'none',
                borderTop: `1px solid ${colors.border}`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingInviteRow({ member, onResend, onRevoke }: {
  member: Member;
  onResend: () => void;
  onRevoke: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ flex: 1, fontSize: 14, color: colors.text }}>{member.email}</div>
      <div style={{ width: 120, fontSize: 13, color: colors.textMuted, textTransform: 'capitalize' }}>{member.role.name}</div>
      <div style={{ width: 120, fontSize: 13, color: colors.textMuted }}>Invited {formatRelativeTime(member.invited_at)}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onResend}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.accent,
            background: 'transparent',
            border: `1px solid ${colors.accent}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Resend
        </button>
        <button
          onClick={onRevoke}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.red,
            background: 'transparent',
            border: `1px solid ${colors.red}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function InviteRequestCard({ request, onApprove, onReject }: {
  request: InviteRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 20 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: colors.text, fontWeight: 500 }}>{request.requester.name}</span>
        <span style={{ fontSize: 14, color: colors.textSecondary }}> wants to invite </span>
        <span style={{ fontSize: 14, color: colors.text, fontWeight: 500 }}>{request.proposed_email}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: colors.textSecondary,
          background: colors.surfaceHover,
          padding: '4px 8px',
          borderRadius: 4,
          textTransform: 'capitalize',
        }}>
          {request.proposed_role.name}
        </span>
        <span style={{ fontSize: 12, color: colors.textMuted }}>
          {formatRelativeTime(request.created_at)}
        </span>
      </div>
      {request.note && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 12 }}>
          "{request.note}"
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onApprove}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: '#fff',
            background: colors.green,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
        <button
          onClick={onReject}
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
          Reject
        </button>
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

function InviteModal({ roles, onClose, onSuccess }: {
  roles: Role[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id || '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');

    if (!email || !roleId) {
      setError('Email and role are required');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/members/invite', { email, role_id: roleId, note: note || undefined });
      onSuccess();
    } catch (err) {
      console.error('Failed to send invite:', err);
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setSubmitting(false);
    }
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
          Invite Member
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
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
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
            Role
          </label>
          <select
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
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
            }}
          >
            {roles.map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional message to include"
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: '#fff',
              background: submitting ? colors.surfaceHover : colors.accent,
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Sending...' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

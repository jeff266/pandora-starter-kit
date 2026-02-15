import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

const roleBadgeColors: Record<string, string> = {
  admin: colors.accent,
  member: colors.textSecondary,
  viewer: colors.textMuted,
};

export default function MembersPage() {
  const { user, currentWorkspace } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isAdmin = currentWorkspace?.role === 'admin';
  const adminCount = members.filter(m => m.role === 'admin').length;

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const data = await api.get('/members');
      setMembers(data.members || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    try {
      await api.post('/members/invite', { email: inviteEmail.trim(), role: inviteRole });
      showToast('Invite sent successfully', 'success');
      setInviteEmail('');
      setShowInvite(false);
      fetchMembers();
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invite');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await api.patch(`/members/${memberId}`, { role: newRole });
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
      showToast('Role updated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleRemove = async (memberId: string) => {
    try {
      await api.delete(`/members/${memberId}`);
      setMembers(prev => prev.filter(m => m.id !== memberId));
      showToast('Member removed', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  const canModify = (member: Member) => {
    if (!isAdmin) return false;
    if (member.id === user?.id && adminCount <= 1) return false;
    return true;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 14, color: colors.red }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: fonts.sans }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? `${colors.green}15` : `${colors.red}15`,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      {isAdmin && (
        <div style={{ marginBottom: 16 }}>
          {showInvite ? (
            <form onSubmit={handleInvite} style={{
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 10, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end',
            }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="member@company.com" autoFocus
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  style={{ display: 'block', marginTop: 4, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13 }}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <button type="submit" disabled={inviteLoading}
                style={{ padding: '8px 16px', background: inviteLoading ? colors.surfaceHover : colors.accent, color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: inviteLoading ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                {inviteLoading ? 'Sending...' : 'Send Invite'}
              </button>
              <button type="button" onClick={() => setShowInvite(false)}
                style={{ padding: '8px 12px', background: 'none', color: colors.textMuted, borderRadius: 6, fontSize: 12, border: `1px solid ${colors.border}`, cursor: 'pointer' }}>
                Cancel
              </button>
              {inviteError && <p style={{ fontSize: 11, color: colors.red }}>{inviteError}</p>}
            </form>
          ) : (
            <button onClick={() => setShowInvite(true)}
              style={{ padding: '8px 16px', background: colors.accent, color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Invite Member
            </button>
          )}
        </div>
      )}

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1fr 80px' : '2fr 2fr 1fr 1fr',
          padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
          fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span>Name</span><span>Email</span><span>Role</span><span>Joined</span>
          {isAdmin && <span></span>}
        </div>

        {members.map(member => (
          <div key={member.id} style={{
            display: 'grid', gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1fr 80px' : '2fr 2fr 1fr 1fr',
            padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{member.name || '--'}</span>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>{member.email}</span>
            <div>
              {isAdmin && canModify(member) ? (
                <select value={member.role} onChange={e => handleRoleChange(member.id, e.target.value)}
                  style={{ padding: '2px 8px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, color: roleBadgeColors[member.role] || colors.textMuted, fontSize: 11, fontWeight: 600 }}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${roleBadgeColors[member.role] || colors.textMuted}15`, color: roleBadgeColors[member.role] || colors.textMuted, textTransform: 'capitalize' }}>
                  {member.role}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {member.created_at ? new Date(member.created_at).toLocaleDateString() : '--'}
            </span>
            {isAdmin && (
              <div style={{ textAlign: 'right' }}>
                {canModify(member) && (
                  <button onClick={() => handleRemove(member.id)}
                    style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
                    onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
                    onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}>
                    &#10005;
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {members.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>No members found</div>
        )}
      </div>
    </div>
  );
}

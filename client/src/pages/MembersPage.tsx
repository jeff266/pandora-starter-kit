import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api, getAuthToken } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { setImpersonation } from '../components/ImpersonationBanner';

type PandoraRole = 'cro' | 'manager' | 'ae' | 'revops' | 'admin' | null;

const PANDORA_ROLE_OPTIONS: { value: PandoraRole; label: string }[] = [
  { value: null, label: 'Not set' },
  { value: 'ae', label: 'AE' },
  { value: 'manager', label: 'Manager' },
  { value: 'cro', label: 'CRO' },
  { value: 'revops', label: 'RevOps' },
  { value: 'admin', label: 'Admin' },
];

const PANDORA_ROLE_COLORS: Record<string, string> = {
  cro: '#c084fc',
  manager: '#60a5fa',
  ae: '#4ade80',
  revops: '#fb923c',
  admin: '#818cf8',
};

interface Member {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: { id: string; name: string } | string;
  pandora_role?: PandoraRole;
  joined_at: string;
  created_at?: string;
  status?: string;
}

function getRoleName(role: { id: string; name: string } | string): string {
  return typeof role === 'object' ? role.name : role;
}

function getRoleId(role: { id: string; name: string } | string): string {
  return typeof role === 'object' ? role.id : role;
}

const roleBadgeColors: Record<string, string> = {
  admin: colors.accent,
  member: colors.textSecondary,
  viewer: colors.textMuted,
};

interface WorkspaceRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  system_type: string | null;
}

interface RosterRep {
  id: string;
  rep_name: string;
  rep_email: string | null;
  pandora_role: PandoraRole;
  claimed: boolean;
  invited: boolean;
}

interface InviteFormState {
  email: string;
  pandora_role: PandoraRole;
  roleId: string;
  repId: string;
  repName: string;
}

export default function MembersPage() {
  const { user, currentWorkspace } = useWorkspace();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const [members, setMembers] = useState<Member[]>([]);
  const [rosterStubs, setRosterStubs] = useState<RosterRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteFormState>({ email: '', pandora_role: null, roleId: '', repId: '', repName: '' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);

  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);

  const isAdmin = currentWorkspace?.role === 'admin';
  const adminCount = members.filter(m => getRoleName(m.role) === 'admin').length;

  useEffect(() => {
    fetchMembers();
    fetchRoles();
    if (currentWorkspace?.id) fetchRoster();
  }, [currentWorkspace?.id]);

  const fetchRoles = async () => {
    try {
      const data = await api.get('/roles');
      const rolesList = data.roles || [];
      setRoles(rolesList);
      const memberRole = rolesList.find((r: WorkspaceRole) => r.system_type === 'member' || r.name.toLowerCase() === 'member');
      const defaultRoleId = memberRole ? memberRole.id : (rolesList[0]?.id || '');
      setInviteForm(prev => ({ ...prev, roleId: defaultRoleId }));
    } catch {
      setRoles([]);
    }
  };

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

  const fetchRoster = async () => {
    try {
      const data = await api.get(`/workspaces/${currentWorkspace!.id}/sales-reps/roster`);
      const stubs = (data.reps || []).filter((r: RosterRep) => !r.claimed);
      setRosterStubs(stubs);
    } catch {
      setRosterStubs([]);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const openInvite = (prefill?: Partial<InviteFormState>) => {
    setInviteForm(prev => ({
      ...prev,
      email: '',
      pandora_role: null,
      repId: '',
      repName: '',
      ...prefill,
    }));
    setInviteError('');
    setShowInvite(true);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    try {
      await api.post('/members/invite', {
        email: inviteForm.email.trim(),
        roleId: inviteForm.roleId,
        pandora_role: inviteForm.pandora_role,
        note: inviteForm.repName ? `Invited from Sales Roster (${inviteForm.repName})` : undefined,
      });
      showToast('Invite sent successfully', 'success');
      setShowInvite(false);
      fetchMembers();
      fetchRoster();
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invite');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRoleId: string) => {
    try {
      await api.patch(`/members/${memberId}/role`, { roleId: newRoleId });
      const role = roles.find(r => r.id === newRoleId);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: role ? { id: role.id, name: role.name } : m.role } : m));
      showToast('Role updated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleDeactivate = async (memberId: string) => {
    try {
      await api.delete(`/members/${memberId}`);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, status: 'suspended' } : m));
      setConfirmRemove(null);
      showToast('Member deactivated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to deactivate member', 'error');
    }
  };

  const handleReactivate = async (memberId: string) => {
    try {
      await api.patch(`/members/${memberId}/reactivate`, {});
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, status: 'active' } : m));
      showToast('Member reactivated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to reactivate member', 'error');
    }
  };

  const handlePermanentRemove = async (memberId: string) => {
    try {
      await api.delete(`/members/${memberId}/permanent`);
      setMembers(prev => prev.filter(m => m.id !== memberId));
      setConfirmRemove(null);
      showToast('Member permanently removed', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  const handleImpersonate = async (member: Member) => {
    if (!currentWorkspace?.id) return;
    setImpersonatingId(member.id);
    try {
      const data = await fetch(`/api/workspaces/${currentWorkspace.id}/members/impersonate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ targetUserId: member.user_id }),
      }).then(r => r.json());

      if (data.error) throw new Error(data.error);

      setImpersonation({
        targetName: data.targetUser.name,
        targetRole: data.targetUser.role,
        targetEmail: data.targetUser.email,
        workspaceId: currentWorkspace.id,
        adminToken: getAuthToken(),
        impersonationToken: data.token,
      });

      window.location.reload();
    } catch (err: any) {
      showToast(err.message || 'Failed to start impersonation', 'error');
      setImpersonatingId(null);
    }
  };

  const canImpersonate = (member: Member) => {
    if (!isAdmin) return false;
    const roleName = getRoleName(member.role).toLowerCase();
    return roleName !== 'admin';
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

  const activeMembers = members.filter(m => m.status !== 'suspended');
  const deactivatedMembers = members.filter(m => m.status === 'suspended');

  const memberEmails = new Set(members.map(m => m.email?.toLowerCase()));
  const unclaimedStubs = rosterStubs.filter(r => !r.invited && !(r.rep_email && memberEmails.has(r.rep_email.toLowerCase())));
  const invitedStubs = rosterStubs.filter(r => r.invited);

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
              borderRadius: 10, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</label>
                <input type="email" value={inviteForm.email} onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="member@company.com" autoFocus
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Access Role</label>
                <select value={inviteForm.roleId} onChange={e => setInviteForm(prev => ({ ...prev, roleId: e.target.value }))}
                  style={{ display: 'block', marginTop: 4, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13 }}>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name.charAt(0).toUpperCase() + r.name.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pandora Role</label>
                <select value={inviteForm.pandora_role ?? ''} onChange={e => setInviteForm(prev => ({ ...prev, pandora_role: (e.target.value || null) as PandoraRole }))}
                  style={{ display: 'block', marginTop: 4, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13 }}>
                  {PANDORA_ROLE_OPTIONS.map(o => (
                    <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={inviteLoading || !inviteForm.roleId}
                style={{ padding: '8px 16px', background: inviteLoading ? colors.surfaceHover : colors.accent, color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: inviteLoading ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                {inviteLoading ? 'Sending...' : 'Send Invite'}
              </button>
              <button type="button" onClick={() => setShowInvite(false)}
                style={{ padding: '8px 12px', background: 'none', color: colors.textMuted, borderRadius: 6, fontSize: 12, border: `1px solid ${colors.border}`, cursor: 'pointer' }}>
                Cancel
              </button>
              {inviteError && <p style={{ fontSize: 11, color: colors.red, width: '100%', margin: 0 }}>{inviteError}</p>}
            </form>
          ) : (
            <button onClick={() => openInvite()}
              style={{ padding: '8px 16px', background: colors.accent, color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Invite Member
            </button>
          )}
        </div>
      )}

      {/* Active Members */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {!isMobile && (
          <div style={{
            display: 'grid', gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1fr 140px' : '2fr 2fr 1fr 1fr',
            padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
            fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span>Name</span><span>Email</span><span>Role</span><span>Joined</span>
            {isAdmin && <span></span>}
          </div>
        )}

        {activeMembers.map(member => isMobile ? (
          <div key={member.id} style={{ padding: '12px 14px', borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>{member.name ? anon.person(member.name) : '--'}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${roleBadgeColors[getRoleName(member.role)] || colors.textMuted}15`, color: roleBadgeColors[getRoleName(member.role)] || colors.textMuted, textTransform: 'capitalize' }}>
                {getRoleName(member.role)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>{anon.email(member.email)}</div>
          </div>
        ) : (
          <div key={member.id} style={{
            display: 'grid', gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1fr 140px' : '2fr 2fr 1fr 1fr',
            padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{member.name ? anon.person(member.name) : '--'}</span>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>{anon.email(member.email)}</span>
            <div>
              {isAdmin && canModify(member) ? (
                <select value={getRoleId(member.role)} onChange={e => handleRoleChange(member.id, e.target.value)}
                  style={{ padding: '2px 8px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, color: roleBadgeColors[getRoleName(member.role)] || colors.textMuted, fontSize: 11, fontWeight: 600 }}>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name.charAt(0).toUpperCase() + r.name.slice(1)}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${roleBadgeColors[getRoleName(member.role)] || colors.textMuted}15`, color: roleBadgeColors[getRoleName(member.role)] || colors.textMuted, textTransform: 'capitalize' }}>
                  {getRoleName(member.role)}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {(member.joined_at || member.created_at) ? new Date(member.joined_at || member.created_at!).toLocaleDateString() : '--'}
            </span>
            {isAdmin && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                {canImpersonate(member) && (
                  <button
                    onClick={() => handleImpersonate(member)}
                    disabled={impersonatingId === member.id}
                    title={`View as ${member.name}`}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      background: impersonatingId === member.id ? `${colors.accent}20` : 'transparent',
                      border: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                      cursor: impersonatingId === member.id ? 'not-allowed' : 'pointer',
                      opacity: impersonatingId === member.id ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { if (impersonatingId !== member.id) e.currentTarget.style.borderColor = colors.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; }}>
                    {impersonatingId === member.id ? '...' : 'View as'}
                  </button>
                )}
                {canModify(member) && confirmRemove?.id === member.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 11, color: colors.textSecondary }}>Deactivate {member.name}?</span>
                    <button
                      onClick={() => handleDeactivate(member.id)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}>
                      Deactivate
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'transparent', color: colors.textMuted, border: `1px solid ${colors.border}`, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      onClick={() => handlePermanentRemove(member.id)}
                      style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'transparent', color: colors.textMuted, border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Permanently remove — cannot be undone">
                      Remove permanently
                    </button>
                  </div>
                ) : canModify(member) ? (
                  <button onClick={() => setConfirmRemove({ id: member.id, name: member.name })}
                    style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
                    onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
                    onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}>
                    &#10005;
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ))}

        {activeMembers.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>No active members</div>
        )}
      </div>

      {/* Deactivated Members */}
      {deactivatedMembers.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>
            Deactivated Members
          </div>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden', opacity: 0.85 }}>
            {deactivatedMembers.map(member => (
              <div key={member.id} style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '11px 16px', borderBottom: `1px solid ${colors.border}`, fontSize: 13,
              }}>
                <span style={{ flex: 1, fontWeight: 500, color: colors.textSecondary }}>{anon.person(member.name)}</span>
                <span style={{ flex: 1, color: colors.textMuted, fontSize: 12 }}>{anon.email(member.email)}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${colors.textMuted}15`, color: colors.textMuted }}>
                  {getRoleName(member.role).charAt(0).toUpperCase() + getRoleName(member.role).slice(1)}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                  Deactivated
                </span>
                {isAdmin && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => handleReactivate(member.id)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 4, background: `${colors.accent}15`, color: colors.accent, border: `1px solid ${colors.accent}40`, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}25`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = `${colors.accent}15`; }}>
                      Reactivate
                    </button>
                    <button
                      onClick={() => handlePermanentRemove(member.id)}
                      style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
                      title="Permanently remove"
                      onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}>
                      &#10005;
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Roster — Pending Invites */}
      {invitedStubs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>
            Sales Roster — Invited
          </div>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {invitedStubs.map(rep => (
              <div key={rep.id} style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '11px 16px', borderBottom: `1px solid ${colors.border}`, fontSize: 13,
              }}>
                <span style={{ flex: 1, fontWeight: 500, color: colors.text }}>{rep.rep_name}</span>
                <span style={{ flex: 1, color: colors.textSecondary, fontSize: 12 }}>
                  {rep.rep_email || <span style={{ color: colors.textDim, fontStyle: 'italic' }}>No email</span>}
                </span>
                {rep.pandora_role && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${PANDORA_ROLE_COLORS[rep.pandora_role]}20`, color: PANDORA_ROLE_COLORS[rep.pandora_role] }}>
                    {rep.pandora_role.toUpperCase()}
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(249,115,22,0.15)', color: '#fb923c' }}>
                  Invited
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Roster — Unclaimed Stubs */}
      {unclaimedStubs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>
              Sales Roster — Not Yet Invited
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              These reps are on your roster but haven't been invited to Pandora yet.
            </div>
          </div>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {unclaimedStubs.map(rep => (
              <div key={rep.id} style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '11px 16px', borderBottom: `1px solid ${colors.border}`, fontSize: 13,
              }}>
                <span style={{ flex: 1, fontWeight: 500, color: colors.text }}>{rep.rep_name}</span>
                <span style={{ flex: 1, color: colors.textSecondary, fontSize: 12 }}>
                  {rep.rep_email || <span style={{ color: colors.textDim, fontStyle: 'italic' }}>No email set</span>}
                </span>
                {rep.pandora_role ? (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${PANDORA_ROLE_COLORS[rep.pandora_role]}20`, color: PANDORA_ROLE_COLORS[rep.pandora_role] }}>
                    {rep.pandora_role.toUpperCase()}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: colors.textDim, fontStyle: 'italic' }}>Role not set</span>
                )}
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: colors.surfaceHover, color: colors.textMuted }}>
                  Unclaimed
                </span>
                {isAdmin && (
                  <button
                    onClick={() => openInvite({
                      email: rep.rep_email || '',
                      pandora_role: rep.pandora_role ?? 'ae',
                      repId: rep.id,
                      repName: rep.rep_name,
                    })}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px',
                      background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                      border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Invite
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

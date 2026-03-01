import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';

type PandoraRole = 'cro' | 'manager' | 'ae' | 'revops' | 'admin' | null;

const PANDORA_ROLE_OPTIONS: { value: PandoraRole; label: string }[] = [
  { value: null, label: 'Not set' },
  { value: 'ae', label: 'AE' },
  { value: 'manager', label: 'Manager' },
  { value: 'cro', label: 'CRO' },
  { value: 'revops', label: 'RevOps' },
  { value: 'admin', label: 'Admin' },
];

const PANDORA_ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  cro: { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  manager: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  ae: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
  revops: { bg: 'rgba(249,115,22,0.15)', text: '#fb923c' },
  admin: { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
};

interface RosterRep {
  id: string;
  workspace_id: string;
  rep_name: string;
  rep_email: string | null;
  team: string | null;
  pandora_role: PandoraRole;
  pandora_user_id: string | null;
  quota_eligible: boolean;
  is_manager: boolean;
  claimed: boolean;
  invited: boolean;
  member_status: string | null;
}

interface WorkspaceRole {
  id: string;
  name: string;
  system_type: string | null;
}

interface InviteModalProps {
  rep: RosterRep;
  roles: WorkspaceRole[];
  defaultRoleId: string;
  onClose: () => void;
  onInvited: () => void;
}

function InviteModal({ rep, roles, defaultRoleId, onClose, onInvited }: InviteModalProps) {
  const [email, setEmail] = useState(rep.rep_email || '');
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [pandoraRole, setPandoraRole] = useState<PandoraRole>(rep.pandora_role ?? 'ae');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/members/invite', {
        email: email.trim(),
        roleId,
        pandora_role: pandoraRole,
        note: `Invited from Sales Roster (${rep.rep_name})`,
      });
      onInvited();
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: colors.surface, borderRadius: 10, padding: '24px 28px',
        width: 420, fontFamily: fonts.sans, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
          Invite {rep.rep_name}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 20 }}>
          They'll receive an email with a link to join the workspace.
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="rep@company.com"
              autoFocus
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13,
                background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                borderRadius: 6, color: colors.text, fontFamily: fonts.sans, boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
              Access Role
            </label>
            <select
              value={roleId}
              onChange={e => setRoleId(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13,
                background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                borderRadius: 6, color: colors.text, fontFamily: fonts.sans,
              }}
            >
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name.charAt(0).toUpperCase() + r.name.slice(1)}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
              Pandora Role (Data Visibility)
            </label>
            <select
              value={pandoraRole ?? ''}
              onChange={e => setPandoraRole((e.target.value || null) as PandoraRole)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13,
                background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                borderRadius: 6, color: colors.text, fontFamily: fonts.sans,
              }}
            >
              {PANDORA_ROLE_OPTIONS.map(o => (
                <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
              AE = sees their own data · Manager = sees their team · CRO/Admin = sees everything
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: colors.red, marginBottom: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '8px 14px', fontSize: 13, background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.textMuted, cursor: 'pointer', fontFamily: fonts.sans }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !email.trim() || !roleId}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600, background: loading ? colors.surfaceHover : colors.accent,
                color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: fonts.sans,
                opacity: loading || !email.trim() || !roleId ? 0.6 : 1,
              }}>
              {loading ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SalesRosterTab() {
  const { currentWorkspace } = useWorkspace();
  const isAdmin = currentWorkspace?.role === 'admin';

  const [reps, setReps] = useState<RosterRep[]>([]);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [invitingRep, setInvitingRep] = useState<RosterRep | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTeam, setNewTeam] = useState('');
  const [newPandoraRole, setNewPandoraRole] = useState<PandoraRole>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [dealOwners, setDealOwners] = useState<{ rep_name: string; rep_email: string | null }[]>([]);

  const defaultRoleId = roles.find(r => r.system_type === 'member' || r.name.toLowerCase() === 'member')?.id || roles[0]?.id || '';

  useEffect(() => {
    fetchRoster();
    fetchRoles();
  }, [currentWorkspace]);

  useEffect(() => {
    if (showAddForm && currentWorkspace?.id) {
      fetchDealOwners();
    }
  }, [showAddForm, currentWorkspace?.id]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRoster = async () => {
    if (!currentWorkspace?.id) return;
    setLoading(true);
    try {
      const data = await api.get(`/workspaces/${currentWorkspace.id}/sales-reps/roster`);
      setReps(data.reps || []);
    } catch {
      setReps([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const data = await api.get('/roles');
      setRoles(data.roles || []);
    } catch {
      setRoles([]);
    }
  };

  const fetchDealOwners = async () => {
    if (!currentWorkspace?.id) return;
    try {
      const data = await api.get(`/workspaces/${currentWorkspace.id}/sales-reps`);
      const owners: { rep_name: string; rep_email: string | null }[] = (data || [])
        .filter((r: any) => r.rep_name && !r.rep_name.includes('@') && !/^\d+$/.test(r.rep_name))
        .map((r: any) => ({ rep_name: r.rep_name, rep_email: r.rep_email || null }));
      setDealOwners(owners);
    } catch {
      setDealOwners([]);
    }
  };

  const handlePandoraRoleChange = async (rep: RosterRep, role: PandoraRole) => {
    try {
      await api.patch(`/workspaces/${currentWorkspace!.id}/sales-reps/${rep.id}/pandora-role`, { pandora_role: role });
      setReps(prev => prev.map(r => r.id === rep.id ? { ...r, pandora_role: role } : r));
    } catch {
      showToast('Failed to update role', 'error');
    }
  };

  const handleDelete = async (rep: RosterRep) => {
    if (!window.confirm(`Remove ${rep.rep_name} from the roster?`)) return;
    try {
      await api.delete(`/workspaces/${currentWorkspace!.id}/sales-reps/${rep.id}`);
      setReps(prev => prev.filter(r => r.id !== rep.id));
      showToast(`${rep.rep_name} removed`, 'success');
    } catch {
      showToast('Failed to remove rep', 'error');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAddLoading(true);
    setAddError('');
    try {
      await api.post(`/workspaces/${currentWorkspace!.id}/sales-reps`, {
        rep_name: newName.trim(),
        rep_email: newEmail.trim() || undefined,
        team: newTeam.trim() || undefined,
        pandora_role: newPandoraRole,
      });
      setNewName(''); setNewEmail(''); setNewTeam(''); setNewPandoraRole(null);
      setShowAddForm(false);
      fetchRoster();
      showToast('Rep added to roster', 'success');
    } catch (err: any) {
      setAddError(err.message || 'Failed to add rep');
    } finally {
      setAddLoading(false);
    }
  };

  const statusBadge = (rep: RosterRep) => {
    if (rep.claimed) return { label: 'Active', bg: 'rgba(34,197,94,0.15)', text: '#4ade80' };
    if (rep.invited) return { label: 'Invited', bg: 'rgba(249,115,22,0.15)', text: '#fb923c' };
    return { label: 'Unclaimed', bg: colors.surfaceHover, text: colors.textMuted };
  };

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: 13, background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text,
    fontFamily: fonts.sans, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 900, fontFamily: fonts.sans }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000, padding: '10px 16px',
          borderRadius: 8, fontSize: 12, fontWeight: 500,
          background: toast.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
        }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>Sales Roster</div>
            {!loading && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: colors.surfaceRaised, color: colors.textMuted }}>
                {reps.length} reps
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            Manage your sales team members and their data visibility roles. Reps can be on the roster before they have a Pandora login.
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowAddForm(true); setAddError(''); }}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600, flexShrink: 0,
              background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            + Add Rep
          </button>
        )}
      </div>

      {/* Add Rep Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} style={{
          background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
          padding: '16px 20px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Add Rep to Roster</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1.5fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Name *
              </label>
              <input
                list="add-rep-name-options"
                value={newName}
                onChange={e => {
                  const val = e.target.value;
                  setNewName(val);
                  const existingNames = new Set(reps.map(r => r.rep_name));
                  const match = dealOwners.find(o => o.rep_name === val && !existingNames.has(o.rep_name));
                  if (match && !newEmail && match.rep_email) {
                    setNewEmail(match.rep_email);
                  }
                }}
                placeholder="Carter McKay"
                autoFocus
                style={inputStyle}
                autoComplete="off"
              />
              <datalist id="add-rep-name-options">
                {dealOwners
                  .filter(o => !reps.some(r => r.rep_name === o.rep_name))
                  .map(o => (
                    <option key={o.rep_name} value={o.rep_name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Email
              </label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="carter@company.com" style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Team
              </label>
              <input value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="West" style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Pandora Role
              </label>
              <select
                value={newPandoraRole ?? ''}
                onChange={e => setNewPandoraRole((e.target.value || null) as PandoraRole)}
                style={{ ...inputStyle }}
              >
                {PANDORA_ROLE_OPTIONS.map(o => (
                  <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {addError && <div style={{ fontSize: 12, color: colors.red, marginBottom: 10 }}>{addError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={addLoading || !newName.trim()}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 600, background: colors.accent,
                color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                opacity: addLoading || !newName.trim() ? 0.6 : 1,
              }}>
              {addLoading ? 'Adding...' : 'Add Rep'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}
              style={{ padding: '7px 12px', fontSize: 12, background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.textMuted, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1.5fr 100px 80px' : '2fr 2fr 1fr 1.5fr 100px',
          padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
          fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span>Name</span>
          <span>Email</span>
          <span>Team</span>
          <span>Pandora Role</span>
          <span>Status</span>
          {isAdmin && <span></span>}
        </div>

        {loading && (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            Loading roster...
          </div>
        )}

        {!loading && reps.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No reps on roster yet. Click "Add Rep" to get started.
          </div>
        )}

        {!loading && reps.map(rep => {
          const status = statusBadge(rep);
          const prColor = rep.pandora_role ? PANDORA_ROLE_COLORS[rep.pandora_role] : null;
          return (
            <div key={rep.id} style={{
              display: 'grid',
              gridTemplateColumns: isAdmin ? '2fr 2fr 1fr 1.5fr 100px 80px' : '2fr 2fr 1fr 1.5fr 100px',
              padding: '11px 16px', borderBottom: `1px solid ${colors.border}`,
              alignItems: 'center', fontSize: 13,
            }}>
              <div style={{ fontWeight: 500, color: colors.text }}>{rep.rep_name}</div>

              <div style={{ color: colors.textSecondary, fontSize: 12 }}>
                {rep.rep_email || <span style={{ color: colors.textDim, fontStyle: 'italic' }}>No email</span>}
              </div>

              <div style={{ color: colors.textMuted, fontSize: 12 }}>
                {rep.team || '—'}
              </div>

              <div>
                {isAdmin ? (
                  <select
                    value={rep.pandora_role ?? ''}
                    onChange={e => handlePandoraRoleChange(rep, (e.target.value || null) as PandoraRole)}
                    style={{
                      padding: '3px 8px', fontSize: 11, fontWeight: 600,
                      background: prColor ? prColor.bg : colors.surfaceHover,
                      border: `1px solid ${prColor ? prColor.text + '40' : colors.border}`,
                      borderRadius: 4, color: prColor ? prColor.text : colors.textMuted,
                      fontFamily: fonts.sans, cursor: 'pointer',
                    }}
                  >
                    {PANDORA_ROLE_OPTIONS.map(o => (
                      <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: prColor ? prColor.bg : colors.surfaceHover,
                    color: prColor ? prColor.text : colors.textMuted,
                  }}>
                    {rep.pandora_role ?? 'Not set'}
                  </span>
                )}
              </div>

              <div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: status.bg, color: status.text,
                }}>
                  {status.label}
                </span>
              </div>

              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {!rep.claimed && !rep.invited && (
                    <button
                      onClick={() => setInvitingRep(rep)}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px',
                        background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, cursor: 'pointer',
                      }}
                    >
                      Invite
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(rep)}
                    style={{ fontSize: 13, color: colors.textDim, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
                    onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
                    onMouseLeave={e => (e.currentTarget.style.color = colors.textDim)}
                    title={`Remove ${rep.rep_name}`}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Invite Modal */}
      {invitingRep && (
        <InviteModal
          rep={invitingRep}
          roles={roles}
          defaultRoleId={defaultRoleId}
          onClose={() => setInvitingRep(null)}
          onInvited={() => {
            setInvitingRep(null);
            fetchRoster();
            showToast('Invite sent', 'success');
          }}
        />
      )}
    </div>
  );
}

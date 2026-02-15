import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';

export default function WorkspacePicker() {
  const { workspaces, selectWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return colors.accent;
      case 'member': return colors.textSecondary;
      default: return colors.textMuted;
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
      <div style={{ width: 520, maxWidth: '90vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>Select a Workspace</h1>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Choose a workspace to continue</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {workspaces.map(ws => (
            <div key={ws.id} onClick={() => selectWorkspace(ws)}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, cursor: 'pointer', transition: 'border-color 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: colors.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: `${roleBadgeColor(ws.role)}15`, color: roleBadgeColor(ws.role), textTransform: 'capitalize' }}>{ws.role}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textMuted }}>
                <span>{ws.deal_count || 0} deals</span>
                <span>{ws.connector_count || 0} connectors</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button onClick={() => navigate('/join')} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer' }}>
            + Join Another Workspace
          </button>
        </div>
      </div>
    </div>
  );
}

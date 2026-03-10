import React, { useState } from 'react';

const IMPERSONATION_KEY = 'pandora_impersonation_session';
const IMPERSONATION_META_KEY = 'pandora_impersonation_meta';

export interface ImpersonationMeta {
  targetName: string;
  targetRole: string;
  targetEmail: string;
  workspaceId: string;
  adminToken: string;
  impersonationToken: string;
}

export function getImpersonationMeta(): ImpersonationMeta | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setImpersonation(meta: ImpersonationMeta): void {
  localStorage.setItem(IMPERSONATION_KEY, meta.impersonationToken);
  localStorage.setItem(IMPERSONATION_META_KEY, JSON.stringify(meta));
}

export function clearImpersonation(): void {
  localStorage.removeItem(IMPERSONATION_KEY);
  localStorage.removeItem(IMPERSONATION_META_KEY);
}

export function getImpersonationToken(): string | null {
  return localStorage.getItem(IMPERSONATION_KEY);
}

export function isImpersonating(): boolean {
  return !!localStorage.getItem(IMPERSONATION_KEY);
}

export default function ImpersonationBanner() {
  const meta = getImpersonationMeta();
  const [stopping, setStopping] = useState(false);

  if (!meta) return null;

  const roleBadge: Record<string, string> = {
    manager: '#60a5fa',
    member: '#4ade80',
    analyst: '#fb923c',
    viewer: '#a78bfa',
  };
  const roleColor = roleBadge[meta.targetRole] || '#a78bfa';

  async function handleStop() {
    setStopping(true);
    try {
      await fetch(`/api/workspaces/${meta!.workspaceId}/members/impersonate/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${meta!.adminToken}`,
        },
        body: JSON.stringify({
          impersonationToken: meta!.impersonationToken,
          adminId: undefined,
        }),
      });
    } catch {
      // Non-fatal — we exit regardless
    }

    clearImpersonation();
    localStorage.setItem('pandora_session', meta!.adminToken);
    window.location.reload();
  }

  return (
    <div style={{
      width: '100%',
      background: 'linear-gradient(90deg, #78350f, #92400e)',
      borderBottom: '1px solid #b45309',
      padding: '6px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      zIndex: 1000,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', letterSpacing: '0.02em' }}>
          Viewing as
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fef3c7' }}>
          {meta.targetName}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: `${roleColor}25`, color: roleColor,
          textTransform: 'capitalize', letterSpacing: '0.04em',
          border: `1px solid ${roleColor}40`,
        }}>
          {meta.targetRole}
        </span>
        <span style={{ fontSize: 11, color: '#d97706' }}>
          — impersonation session, 2hr limit
        </span>
      </div>

      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          padding: '4px 14px',
          background: stopping ? '#78350f' : '#b45309',
          border: '1px solid #d97706',
          borderRadius: 5,
          color: '#fef3c7',
          fontSize: 11,
          fontWeight: 600,
          cursor: stopping ? 'not-allowed' : 'pointer',
          opacity: stopping ? 0.7 : 1,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {stopping ? 'Exiting...' : 'Exit Impersonation'}
      </button>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace, WorkspaceInfo } from '../context/WorkspaceContext';
import { useDemoMode } from '../contexts/DemoModeContext';
import { colors, fonts } from '../styles/theme';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  badge?: number;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    items: [
      { label: 'Command Center', path: '/', icon: '\u2B21' },
    ],
  },
  {
    title: 'PIPELINE',
    items: [
      { label: 'Deals', path: '/deals', icon: '\u25C6' },
      { label: 'Accounts', path: '/accounts', icon: '\u25C7' },
    ],
  },
  {
    title: 'INTELLIGENCE',
    items: [
      { label: 'ICP Profile', path: '/icp-profile', icon: '\u2605' },
      { label: 'Agents', path: '/agents', icon: '\u25C8' },
      { label: 'Agent Builder', path: '/agent-builder', icon: '\u25C7' },
      { label: 'Skills', path: '/skills', icon: '\u2699' },
      { label: 'Tools', path: '/tools', icon: '\u29EB' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Targets', path: '/targets', icon: '\u25CE' },
      { label: 'Playbooks', path: '/playbooks', icon: '\u25B6' },
      { label: 'Push', path: '/push', icon: '\uD83D\uDD14' },
      { label: 'Insights Feed', path: '/insights', icon: '\u25C9' },
      { label: 'Actions', path: '/actions', icon: '\u26A1' },
    ],
  },
  {
    title: 'DATA',
    items: [
      { label: 'Connectors', path: '/connectors', icon: '\u229E' },
      { label: 'Connector Health', path: '/connectors/health', icon: '\u2661' },
      { label: 'Data Dictionary', path: '/data-dictionary', icon: '\u2261' },
    ],
  },
  {
    title: 'WORKSPACE',
    items: [
      { label: 'Members', path: '/members', icon: '\u2295' },
      { label: 'Marketplace', path: '/marketplace', icon: '\u25EB' },
      { label: 'Settings', path: '/settings', icon: '\u229B' },
      { label: 'Scopes', path: '/admin/scopes', icon: '\u25A4' },
    ],
  },
];

interface SidebarProps {
  badges: Record<string, number>;
  showAllClients?: boolean;
}

export default function Sidebar({ badges, showAllClients }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentWorkspace, workspaces, selectWorkspace, logout, token } = useWorkspace();
  const { isDemoMode, toggleDemoMode, anon } = useDemoMode();
  const [showWsDropdown, setShowWsDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);

  useEffect(() => {
    if (!showAllClients || workspaces.length <= 1 || !token) return;
    fetch('/api/consultant/calls/unassigned', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUnassignedCount(data.total ?? data.calls?.length ?? 0); })
      .catch(() => {});
  }, [showAllClients, workspaces.length, token]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/portfolio') return location.pathname === '/portfolio';
    return location.pathname.startsWith(path);
  };

  const handleSwitchWorkspace = (ws: WorkspaceInfo) => {
    selectWorkspace(ws);
    setShowWsDropdown(false);
    navigate('/');
  };

  const displayWsName = (name: string) => anon.workspace(name);

  return (
    <aside style={{
      width: 220, height: '100vh', position: 'fixed', left: 0, top: 0,
      background: colors.bgSidebar, borderRight: `1px solid ${colors.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 100, fontFamily: fonts.sans,
    }}>
      <div
        style={{
          padding: '16px 14px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', position: 'relative',
        }}
        onClick={() => setShowWsDropdown(!showWsDropdown)}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 6, background: colors.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {(currentWorkspace?.name || 'P').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: colors.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {displayWsName(currentWorkspace?.name || 'Pandora')}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' }}>
            {currentWorkspace?.role || 'Workspace'}
          </div>
        </div>
        <span style={{ fontSize: 10, color: colors.textMuted }}>{showWsDropdown ? '\u25B2' : '\u25BC'}</span>

        {showWsDropdown && workspaces.length > 1 && (
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {workspaces.map(ws => (
              <div
                key={ws.id}
                onClick={() => handleSwitchWorkspace(ws)}
                style={{
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', fontSize: 13, color: colors.text,
                  background: ws.id === currentWorkspace?.id ? colors.accentSoft : 'transparent',
                }}
                onMouseEnter={e => { if (ws.id !== currentWorkspace?.id) e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={e => { if (ws.id !== currentWorkspace?.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 4, background: colors.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <span style={{ flex: 1 }}>{displayWsName(ws.name)}</span>
                {ws.id === currentWorkspace?.id && <span style={{ fontSize: 12, color: colors.accent }}>{'\u2713'}</span>}
              </div>
            ))}
            <div
              onClick={() => { setShowWsDropdown(false); navigate('/join'); }}
              style={{
                padding: '10px 14px', fontSize: 12, color: colors.accent,
                cursor: 'pointer', borderTop: `1px solid ${colors.border}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              + Join Workspace
            </div>
          </div>
        )}
      </div>

      <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {showAllClients && workspaces.length > 1 && (
          <div style={{ marginBottom: 4 }}>
            <div
              onClick={() => navigate('/portfolio')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', marginLeft: 2,
                cursor: 'pointer', fontSize: 13,
                color: isActive('/portfolio') ? colors.accent : colors.textSecondary,
                background: isActive('/portfolio') ? colors.accentSoft : 'transparent',
                borderLeft: isActive('/portfolio') ? `2px solid ${colors.accent}` : '2px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isActive('/portfolio')) e.currentTarget.style.background = colors.surfaceHover; }}
              onMouseLeave={e => { if (!isActive('/portfolio')) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>{'\u25A3'}</span>
              <span style={{ flex: 1, fontWeight: isActive('/portfolio') ? 600 : 400 }}>All Clients</span>
              {unassignedCount > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  background: colors.redSoft, color: colors.red,
                  padding: '1px 6px', borderRadius: 8,
                  fontFamily: fonts.mono,
                }}>
                  {unassignedCount}
                </span>
              )}
            </div>
            <div style={{ height: 1, background: colors.border, margin: '4px 14px' }} />
          </div>
        )}
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: 4 }}>
            {section.title && (
              <div style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, padding: '12px 16px 4px', letterSpacing: '0.08em' }}>
                {section.title}
              </div>
            )}
            {section.items.map(item => {
              const active = isActive(item.path);
              const badgeCount = badges[item.label.toLowerCase()];
              return (
                <div
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', marginLeft: 2,
                    cursor: 'pointer', fontSize: 13,
                    color: active ? colors.accent : colors.textSecondary,
                    background: active ? colors.accentSoft : 'transparent',
                    borderLeft: active ? `2px solid ${colors.accent}` : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = colors.surfaceHover; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>{item.icon}</span>
                  <span style={{ flex: 1, fontWeight: active ? 600 : 400 }}>{item.label}</span>
                  {item.label === 'Targets' && badgeCount !== undefined && badgeCount > 0 && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: badgeCount === 1 || badgeCount === 4 ? colors.green : badgeCount === 2 ? colors.orange : colors.red,
                      flexShrink: 0,
                    }} />
                  )}
                  {item.label !== 'Targets' && badgeCount !== undefined && badgeCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, background: colors.accentSoft, color: colors.accent, padding: '1px 6px', borderRadius: 8, fontFamily: fonts.mono }}>{badgeCount}</span>
                  )}
                  {item.label === 'Marketplace' && (
                    <span style={{ fontSize: 9, fontWeight: 600, background: colors.surfaceHover, color: colors.textMuted, padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' }}>beta</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ borderTop: `1px solid ${colors.border}`, padding: '10px 14px' }}>
        <div
          onClick={toggleDemoMode}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '6px 0',
          }}
        >
          <span style={{ fontSize: 14 }}>{'\uD83C\uDFAD'}</span>
          <span style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}>Demo Mode</span>
          <div style={{
            width: 32, height: 18, borderRadius: 9,
            background: isDemoMode ? colors.purple : colors.surfaceHover,
            position: 'relative', transition: 'background 0.2s',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff', position: 'absolute', top: 2,
              left: isDemoMode ? 16 : 2, transition: 'left 0.2s',
            }} />
          </div>
        </div>
      </div>

      <div style={{
        padding: '12px 14px', borderTop: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
      }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minWidth: 0,
          }}
          onClick={() => setShowUserMenu(!showUserMenu)}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: colors.surfaceHover,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, color: colors.textSecondary, flexShrink: 0,
          }}>
            {(user?.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name || 'User'}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' }}>
              {currentWorkspace?.role || ''}
            </div>
          </div>
        </div>

        {showUserMenu && (
          <div
            style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
            }}
          >
            <div
              onClick={() => { setShowUserMenu(false); navigate('/members'); }}
              style={{ padding: '10px 14px', fontSize: 13, color: colors.text, cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Members
            </div>
            <div
              onClick={() => { setShowUserMenu(false); logout(); }}
              style={{ padding: '10px 14px', fontSize: 13, color: colors.red, cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Sign Out
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

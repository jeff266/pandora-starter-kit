import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace, WorkspaceInfo } from '../context/WorkspaceContext';
import { useDemoMode } from '../contexts/DemoModeContext';
import { colors, fonts } from '../styles/theme';
import NotificationBell from './notifications/NotificationBell';
import SectionErrorBoundary from './SectionErrorBoundary';
import { useIsMobile } from '../hooks/useIsMobile';
import PalettePicker from './PalettePicker';

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
      { label: 'Conversations', path: '/conversations', icon: '\u260E' },
    ],
  },
  {
    title: 'INTELLIGENCE',
    items: [
      { label: 'ICP Profile', path: '/icp-profile', icon: '\u2605' },
      { label: 'Stage Velocity', path: '/stage-velocity', icon: '\u25B6' },
      { label: 'Competition', path: '/competition', icon: '\u229B' },
      { label: 'Prospects', path: '/prospects', icon: '\u25CE' },
      { label: 'Agents', path: '/agents', icon: '\u25C8' },
      { label: 'Skills', path: '/skills', icon: '\u2699' },
      { label: 'Tools', path: '/tools', icon: '\u29EB' },
      { label: 'Governance', path: '/governance', icon: '\u2696' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Targets', path: '/targets', icon: '\u25CE' },
      { label: 'Playbooks', path: '/playbooks', icon: '\u25B6' },
      { label: 'Forecast', path: '/forecast', icon: '\uD83D\uDCC8' },
      { label: 'Push', path: '/push', icon: '\uD83D\uDD14' },
      { label: 'Reports', path: '/reports', icon: '\uD83D\uDCC4' },
      { label: 'Insights Feed', path: '/insights', icon: '\u25C9' },
      { label: 'Actions', path: '/actions', icon: '\u26A1' },
    ],
  },
  {
    title: 'DATA',
    items: [
      { label: 'Connectors', path: '/connectors', icon: '\u229E' },
      { label: 'Enrichment', path: '/enrichment', icon: '\u2B22' },
      { label: 'Connector Health', path: '/connectors/health', icon: '\u2661' },
      { label: 'Filters', path: '/filters', icon: '\u25A7' },
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
      { label: 'Token Usage', path: '/admin/token-usage', icon: '\u25A2' },
    ],
  },
];

interface SidebarProps {
  badges: Record<string, number>;
  showAllClients?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mode?: 'command' | 'assistant';
  onModeChange?: (m: 'command' | 'assistant') => void;
}

export default function Sidebar({ badges, showAllClients, collapsed = false, onToggleCollapse, mobileOpen = false, onMobileClose, mode = 'command', onModeChange }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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

  const mobileNav = (path: string) => {
    navigate(path);
    if (isMobile && onMobileClose) onMobileClose();
  };

  // On mobile: hide completely when closed, show as full-width overlay when open
  if (isMobile && !mobileOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      {isMobile && (
        <div
          onClick={onMobileClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 199, transition: 'opacity 0.2s',
          }}
        />
      )}
      <aside style={{
        width: isMobile ? 260 : (collapsed ? 56 : 220),
        height: '100vh', position: 'fixed', left: 0, top: 0,
        background: colors.bgSidebar, borderRight: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column',
        zIndex: isMobile ? 200 : 100,
        fontFamily: fonts.sans,
        transition: 'width 0.2s ease', overflow: 'hidden',
      }}>
      <div
        style={{
          padding: collapsed ? '16px 0' : '16px 14px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10, cursor: 'pointer', position: 'relative',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
        onClick={() => { if (!collapsed) setShowWsDropdown(!showWsDropdown); }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 6, background: colors.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {(currentWorkspace?.name || 'P').charAt(0).toUpperCase()}
        </div>
        {!collapsed && (
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
        )}
        {!collapsed && <span style={{ fontSize: 10, color: colors.textMuted }}>{showWsDropdown ? '\u25B2' : '\u25BC'}</span>}

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
              onClick={() => { setShowWsDropdown(false); mobileNav('/join'); }}
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
              onClick={() => mobileNav('/portfolio')}
              title={collapsed ? 'All Clients' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 8,
                padding: collapsed ? '7px 0' : '7px 14px', marginLeft: collapsed ? 0 : 2,
                justifyContent: collapsed ? 'center' : 'flex-start',
                cursor: 'pointer', fontSize: 13,
                color: isActive('/portfolio') ? colors.accent : colors.textSecondary,
                background: isActive('/portfolio') ? colors.accentSoft : 'transparent',
                borderLeft: collapsed ? 'none' : (isActive('/portfolio') ? `2px solid ${colors.accent}` : '2px solid transparent'),
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isActive('/portfolio')) e.currentTarget.style.background = colors.surfaceHover; }}
              onMouseLeave={e => { if (!isActive('/portfolio')) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>{'\u25A3'}</span>
              {!collapsed && <span style={{ flex: 1, fontWeight: isActive('/portfolio') ? 600 : 400 }}>All Clients</span>}
              {!collapsed && unassignedCount > 0 && (
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
            <div style={{ height: 1, background: colors.border, margin: collapsed ? '4px 8px' : '4px 14px' }} />
          </div>
        )}
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: 4 }}>
            {section.title && !collapsed && (
              <div style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, padding: '12px 16px 4px', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                {section.title}
              </div>
            )}
            {collapsed && section.title && (
              <div style={{ height: 1, background: colors.border, margin: '6px 10px' }} />
            )}
            {section.items.map(item => {
              const active = isActive(item.path);
              const badgeCount = badges[item.label.toLowerCase()];
              return (
                <div
                  key={item.path}
                  onClick={() => mobileNav(item.path)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 8,
                    padding: collapsed ? '7px 0' : '7px 14px', marginLeft: collapsed ? 0 : 2,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    cursor: 'pointer', fontSize: 13,
                    color: active ? colors.accent : colors.textSecondary,
                    background: active ? colors.accentSoft : 'transparent',
                    borderLeft: collapsed ? 'none' : (active ? `2px solid ${colors.accent}` : '2px solid transparent'),
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = colors.surfaceHover; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>{item.icon}</span>
                  {!collapsed && <span style={{ flex: 1, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{item.label}</span>}
                  {!collapsed && item.label === 'Targets' && badgeCount !== undefined && badgeCount > 0 && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: badgeCount === 1 || badgeCount === 4 ? colors.green : badgeCount === 2 ? colors.orange : colors.red,
                      flexShrink: 0,
                    }} />
                  )}
                  {!collapsed && item.label !== 'Targets' && badgeCount !== undefined && badgeCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, background: colors.accentSoft, color: colors.accent, padding: '1px 6px', borderRadius: 8, fontFamily: fonts.mono }}>{badgeCount}</span>
                  )}
                  {!collapsed && item.label === 'Marketplace' && (
                    <span style={{ fontSize: 9, fontWeight: 600, background: colors.surfaceHover, color: colors.textMuted, padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' }}>beta</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ borderTop: `1px solid ${colors.border}`, padding: collapsed ? '10px 0' : '10px 14px' }}>
        {/* Notification Bell */}
        {currentWorkspace?.id && (
          <SectionErrorBoundary fallbackMessage="">
            <div style={{ padding: '6px 0', marginBottom: 8, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start' }}>
              <NotificationBell workspaceId={currentWorkspace.id} />
            </div>
          </SectionErrorBoundary>
        )}

        <div
          onClick={toggleDemoMode}
          title={collapsed ? 'Demo Mode' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 8, cursor: 'pointer',
            padding: '6px 0', justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <span style={{ fontSize: 14 }}>{'\uD83C\uDFAD'}</span>
          {!collapsed && <span style={{ fontSize: 12, color: colors.textSecondary, flex: 1, whiteSpace: 'nowrap' }}>Demo Mode</span>}
          {!collapsed && (
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
          )}
        </div>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ fontSize: 12, color: colors.textMuted, whiteSpace: 'nowrap' }}>Theme</span>
            <PalettePicker />
          </div>
        )}
      </div>

      {/* View mode toggle */}
      {onModeChange && !collapsed && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>View</div>
          <div style={{ display: 'flex', background: colors.bg, borderRadius: 6, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
            {(['assistant', 'command'] as const).map(m => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                style={{
                  flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
                  background: mode === m ? colors.accentSoft : 'transparent',
                  color: mode === m ? colors.accent : colors.textMuted,
                  transition: 'all 0.15s',
                }}
              >
                {m === 'assistant' ? '✦ Assistant' : '▦ Command'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapse toggle button — hide on mobile since sidebar is an overlay */}
      {!isMobile && (
        <div
          onClick={onToggleCollapse}
          style={{
            borderTop: `1px solid ${colors.border}`, padding: '8px 0',
            display: 'flex', justifyContent: 'center', cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 14, color: colors.textMuted, transition: 'transform 0.2s', transform: collapsed ? 'rotate(180deg)' : 'none' }}>
            {'\u00AB'}
          </span>
        </div>
      )}

      <div style={{
        padding: collapsed ? '12px 0' : '12px 14px', borderTop: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10, position: 'relative',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10, flex: collapsed ? undefined : 1,
            cursor: 'pointer', minWidth: 0,
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
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.name || 'User'}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' }}>
                {currentWorkspace?.role || ''}
              </div>
            </div>
          )}
        </div>

        {showUserMenu && (
          <div
            style={{
              position: 'absolute', bottom: '100%', left: 0, right: collapsed ? 'auto' : 0,
              minWidth: collapsed ? 160 : undefined, marginBottom: 4,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
            }}
          >
            <div
              onClick={() => { setShowUserMenu(false); mobileNav('/members'); }}
              style={{ padding: '10px 14px', fontSize: 13, color: colors.text, cursor: 'pointer', whiteSpace: 'nowrap' }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Members
            </div>
            <div
              onClick={() => { setShowUserMenu(false); logout(); }}
              style={{ padding: '10px 14px', fontSize: 13, color: colors.red, cursor: 'pointer', borderTop: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Sign Out
            </div>
          </div>
        )}
      </div>
    </aside>
    </>
  );
}

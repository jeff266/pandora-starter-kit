import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePandoraRole, type PandoraRole } from '../context/PandoraRoleContext';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import PalettePicker from './PalettePicker';

const S = {
  bg: '#0a0d14',
  border: '#1a1f2b',
  iconRest: '#5a6578',
  iconActive: '#1D9E75',
  iconHover: '#94a3b8',
  labelColor: '#94a3b8',
  labelActive: '#e8ecf4',
  teal: '#1D9E75',
  blue: '#378ADD',
  font: "'IBM Plex Sans', -apple-system, sans-serif",
};

interface NavDef {
  path: string;
  label: string;
  icon: string;
  roles: PandoraRole[] | 'all';
}

const NAV_ITEMS: NavDef[] = [
  { path: '/concierge', label: 'Concierge', icon: '◈', roles: 'all' },
  { path: '/gtm',       label: 'GTM',       icon: '◯', roles: ['admin', 'manager', 'cro', 'revops', null] },
  { path: '/targets',   label: 'Targets',   icon: '◎', roles: ['admin', 'manager', 'cro', 'revops', null] },
  { path: '/actions',   label: 'Actions',   icon: '⚡', roles: 'all' },
  { path: '/agents',    label: 'Agents',    icon: '◎', roles: ['admin', 'cro', 'revops', null] },
  { path: '/data',      label: 'Data',      icon: '⬡', roles: ['admin', 'revops', null] },
  { path: '/settings',  label: 'Settings',  icon: '⚙', roles: ['admin', 'manager', 'cro', 'revops', null] },
];

function isNavVisible(item: NavDef, role: PandoraRole): boolean {
  if (item.roles === 'all') return true;
  return (item.roles as (PandoraRole)[]).includes(role);
}

interface SidebarProps {
  badges?: Record<string, number>;
  showAllClients?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mode?: 'command' | 'assistant';
  onModeChange?: (m: 'command' | 'assistant') => void;
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { currentWorkspace, user, logout } = useWorkspace();
  const { pandoraRole } = usePandoraRole();
  const { isDemoMode, toggleDemoMode, anon } = useDemoMode();

  const [hovered, setHovered] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pinned = !collapsed;
  const expanded = pinned || hovered;
  const width = expanded ? 200 : 48;

  const handleMouseEnter = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (!pinned) setHovered(true);
  }, [pinned]);

  const handleMouseLeave = useCallback(() => {
    if (!pinned) {
      collapseTimer.current = setTimeout(() => setHovered(false), 300);
    }
  }, [pinned]);

  useEffect(() => {
    return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, []);

  useEffect(() => {
    if (pinned) setHovered(false);
  }, [pinned]);

  const handleLogoClick = useCallback(() => {
    if (onToggleCollapse) onToggleCollapse();
  }, [onToggleCollapse]);

  const isActive = useCallback((path: string) => {
    if (path === '/concierge') return location.pathname === '/concierge' || location.pathname === '/';
    if (path === '/gtm') return location.pathname === '/gtm' || location.pathname.startsWith('/gtm/');
    return location.pathname.startsWith(path);
  }, [location.pathname]);

  const go = useCallback((path: string) => {
    navigate(path);
    if (isMobile && onMobileClose) onMobileClose();
  }, [navigate, isMobile, onMobileClose]);

  const wsName = currentWorkspace ? anon.workspace(currentWorkspace.name) : 'Pandora';
  const initials = (user?.name || user?.email || 'P').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const hasConnector = (currentWorkspace?.connector_count ?? 0) > 0;

  if (isMobile && !mobileOpen) return null;

  const visibleItems = NAV_ITEMS.filter(item => isNavVisible(item, pandoraRole));

  return (
    <>
      {isMobile && (
        <div
          onClick={onMobileClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 199 }}
        />
      )}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          height: '100vh',
          width: isMobile ? 200 : width,
          background: S.bg,
          borderRight: `0.5px solid ${S.border}`,
          display: 'flex',
          flexDirection: 'column',
          zIndex: isMobile ? 200 : 100,
          fontFamily: S.font,
          transition: 'width 150ms ease',
          overflow: 'hidden',
        }}
      >
        {/* LOGO / PIN TOGGLE */}
        <div
          onClick={handleLogoClick}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 14px' : '0',
            cursor: 'pointer',
            flexShrink: 0,
            gap: 10,
            borderBottom: `0.5px solid ${S.border}`,
          }}
        >
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: S.teal,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
            userSelect: 'none',
          }}>
            P
          </div>
          {expanded && (
            <span style={{ fontSize: 13, fontWeight: 600, color: S.labelActive, whiteSpace: 'nowrap', userSelect: 'none' }}>
              Pandora {pinned && <span style={{ fontSize: 10, color: S.iconRest, marginLeft: 4 }}>●</span>}
            </span>
          )}
        </div>

        {/* NAV ITEMS */}
        <nav style={{ flex: 1, overflow: 'hidden', padding: '8px 0' }}>
          {visibleItems.map(item => {
            const active = isActive(item.path);
            return (
              <div
                key={item.path}
                onClick={() => go(item.path)}
                title={!expanded ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: expanded ? 10 : 0,
                  height: 36,
                  padding: expanded ? '0 14px' : '0',
                  justifyContent: expanded ? 'flex-start' : 'center',
                  cursor: 'pointer',
                  position: 'relative',
                  borderLeft: active ? `2px solid ${S.teal}` : '2px solid transparent',
                  marginTop: 1,
                  transition: 'border-color 0.1s',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const icon = e.currentTarget.querySelector('.nav-icon') as HTMLElement | null;
                    if (icon) icon.style.color = S.iconHover;
                    const label = e.currentTarget.querySelector('.nav-label') as HTMLElement | null;
                    if (label) label.style.color = S.iconHover;
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const icon = e.currentTarget.querySelector('.nav-icon') as HTMLElement | null;
                    if (icon) icon.style.color = S.iconRest;
                    const label = e.currentTarget.querySelector('.nav-label') as HTMLElement | null;
                    if (label) label.style.color = S.labelColor;
                  }
                }}
              >
                <span
                  className="nav-icon"
                  style={{
                    fontSize: 15,
                    color: active ? S.iconActive : S.iconRest,
                    width: 18,
                    textAlign: 'center',
                    flexShrink: 0,
                    lineHeight: 1,
                    transition: 'color 0.1s',
                    userSelect: 'none',
                  }}
                >
                  {item.icon}
                </span>
                {expanded && (
                  <span
                    className="nav-label"
                    style={{
                      fontSize: 12,
                      color: active ? S.labelActive : S.labelColor,
                      fontWeight: active ? 500 : 400,
                      whiteSpace: 'nowrap',
                      transition: 'color 0.1s',
                      userSelect: 'none',
                    }}
                  >
                    {item.label}
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        {/* BOTTOM: workspace info + user */}
        <div style={{ borderTop: `0.5px solid ${S.border}`, padding: '10px 0', flexShrink: 0 }}>
          {/* Workspace name row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: expanded ? 8 : 0,
              height: 32,
              padding: expanded ? '0 14px' : '0',
              justifyContent: expanded ? 'flex-start' : 'center',
            }}
            title={!expanded ? wsName : undefined}
          >
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: hasConnector ? '#1D9E75' : '#3a4252',
              flexShrink: 0,
            }} />
            {expanded && (
              <span style={{
                fontSize: 11,
                color: S.iconRest,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 140,
                userSelect: 'none',
              }}>
                {wsName}
              </span>
            )}
          </div>

          {/* Palette picker */}
          <div style={{
            padding: expanded ? '4px 14px' : '4px 0',
            display: 'flex',
            justifyContent: expanded ? 'flex-start' : 'center',
          }}>
            <PalettePicker />
          </div>

          {/* Demo mode toggle */}
          <div
            onClick={toggleDemoMode}
            title={!expanded ? 'Demo Mode' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: expanded ? 8 : 0, cursor: 'pointer',
              padding: expanded ? '4px 14px' : '4px 0',
              justifyContent: expanded ? 'flex-start' : 'center',
            }}
          >
            <span style={{ fontSize: 14 }}>🎭</span>
            {expanded && (
              <>
                <span style={{ fontSize: 12, color: S.iconRest, flex: 1, whiteSpace: 'nowrap' }}>Demo Mode</span>
                <div style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: isDemoMode ? S.teal : S.border,
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#fff', position: 'absolute', top: 2,
                    left: isDemoMode ? 16 : 2, transition: 'left 0.2s',
                  }} />
                </div>
              </>
            )}
          </div>

          {/* User avatar row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: expanded ? 8 : 0,
              height: 36,
              padding: expanded ? '0 14px' : '0',
              justifyContent: expanded ? 'flex-start' : 'center',
              cursor: 'pointer',
            }}
            title={!expanded ? (user?.name || user?.email || '') : undefined}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: S.teal,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
              userSelect: 'none',
            }}>
              {initials}
            </div>
            {expanded && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: S.labelActive,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  userSelect: 'none',
                }}>
                  {user?.name || user?.email || ''}
                </div>
                {pandoraRole && (
                  <div style={{
                    display: 'inline-block',
                    fontSize: 9,
                    fontWeight: 600,
                    color: S.teal,
                    background: 'rgba(29,158,117,0.1)',
                    border: `0.5px solid rgba(29,158,117,0.25)`,
                    borderRadius: 99,
                    padding: '1px 6px',
                    marginTop: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    userSelect: 'none',
                  }}>
                    {pandoraRole}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

    </>
  );
}

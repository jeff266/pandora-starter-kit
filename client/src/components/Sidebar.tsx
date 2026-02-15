import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
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
      { label: 'Command Center', path: '/', icon: '⬡' },
    ],
  },
  {
    title: 'INTELLIGENCE',
    items: [
      { label: 'Agents', path: '/agents', icon: '◈' },
      { label: 'Agent Builder', path: '/agent-builder', icon: '◇' },
      { label: 'Skills', path: '/skills', icon: '⚙' },
      { label: 'Tools', path: '/tools', icon: '⧫' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Playbooks', path: '/playbooks', icon: '▶' },
      { label: 'Insights Feed', path: '/insights', icon: '◉' },
      { label: 'Actions', path: '/actions', icon: '⚡' },
    ],
  },
  {
    title: 'DATA',
    items: [
      { label: 'Connectors', path: '/connectors', icon: '⊞' },
      { label: 'Connector Health', path: '/connectors/health', icon: '♡' },
      { label: 'Data Dictionary', path: '/data-dictionary', icon: '≡' },
    ],
  },
  {
    title: 'WORKSPACE',
    items: [
      { label: 'Users & Teams', path: '/users', icon: '⊕' },
      { label: 'Marketplace', path: '/marketplace', icon: '◫' },
      { label: 'Settings', path: '/settings', icon: '⊛' },
    ],
  },
];

interface SidebarProps {
  badges: Record<string, number>;
}

export default function Sidebar({ badges }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspace, logout } = useWorkspace();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside style={{
      width: 220,
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      background: colors.bgSidebar,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
      fontFamily: fonts.sans,
    }}>
      <div
        style={{
          padding: '16px 14px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
        }}
        onClick={() => navigate('/')}
      >
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: colors.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}>
          {(workspace?.workspaceName || 'P').charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {workspace?.workspaceName || 'Pandora'}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>
            Workspace
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: 4 }}>
            {section.title && (
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textDim,
                padding: '12px 16px 4px',
                letterSpacing: '0.08em',
              }}>
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 14px',
                    marginLeft: 2,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: active ? colors.accent : colors.textSecondary,
                    background: active ? colors.accentSoft : 'transparent',
                    borderLeft: active ? `2px solid ${colors.accent}` : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget.style.background = colors.surfaceHover);
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget.style.background = 'transparent');
                  }}
                >
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>
                    {item.icon}
                  </span>
                  <span style={{ flex: 1, fontWeight: active ? 600 : 400 }}>
                    {item.label}
                  </span>
                  {badgeCount !== undefined && badgeCount > 0 && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      background: colors.accentSoft,
                      color: colors.accent,
                      padding: '1px 6px',
                      borderRadius: 8,
                      fontFamily: fonts.mono,
                    }}>
                      {badgeCount}
                    </span>
                  )}
                  {item.label === 'Marketplace' && (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      background: colors.surfaceHover,
                      color: colors.textMuted,
                      padding: '1px 5px',
                      borderRadius: 4,
                      textTransform: 'uppercase',
                    }}>
                      beta
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{
        padding: '12px 14px',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: colors.surfaceHover,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 600,
          color: colors.textSecondary,
          flexShrink: 0,
        }}>
          A
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>Admin</div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>Owner</div>
        </div>
        <button
          onClick={logout}
          style={{
            fontSize: 11,
            color: colors.textMuted,
            background: 'none',
            padding: '2px 6px',
            borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
          onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}
        >
          ✕
        </button>
      </div>
    </aside>
  );
}

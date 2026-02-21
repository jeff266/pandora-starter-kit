import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface SettingsNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin?: boolean;
}

const userTabs: NavItem[] = [
  { key: 'profile', label: 'Profile', icon: '👤' },
  { key: 'security', label: 'Security', icon: '🔒' },
  { key: 'preferences', label: 'Preferences', icon: '⚙️' },
  { key: 'workspaces', label: 'Workspaces', icon: '▦' },
];

const adminTabs: NavItem[] = [
  { key: 'members', label: 'Members', icon: '👥' },
  { key: 'roles', label: 'Roles', icon: '🛡️' },
  { key: 'features', label: 'Features', icon: '⚡' },
  { key: 'crm-sync', label: 'CRM Sync', icon: '🔄' },
  { key: 'billing', label: 'Billing', icon: '💳' },
];

export default function SettingsNav({ activeTab, onTabChange, isAdmin = false }: SettingsNavProps) {
  return (
    <>
      {/* Desktop navigation - vertical */}
      <nav
        style={{
          width: 200,
          flexShrink: 0,
          background: colors.surface,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 0',
          overflowY: 'auto',
          position: 'sticky',
          top: 0,
          height: 'fit-content',
          maxHeight: '100vh',
          fontFamily: fonts.sans,
        }}
        className="settings-nav-desktop"
      >
      {userTabs.map(tab => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              fontFamily: fonts.sans,
              color: isActive ? colors.accent : colors.textSecondary,
              background: isActive ? colors.accentSoft : 'transparent',
              border: 'none',
              borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = colors.surfaceHover;
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ fontSize: 16, opacity: 0.9 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}

      {isAdmin && (
        <>
          <div
            style={{
              padding: '16px 16px 8px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: colors.textDim,
              textTransform: 'uppercase',
            }}
          >
            Workspace Settings
          </div>

          {adminTabs.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  fontFamily: fonts.sans,
                  color: isActive ? colors.accent : colors.textSecondary,
                  background: isActive ? colors.accentSoft : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
                  cursor: 'pointer',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.background = colors.surfaceHover;
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: 16, opacity: 0.9 }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </>
      )}
      </nav>

      {/* Mobile navigation - horizontal scrollable */}
      <nav
        style={{
          display: 'none',
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
          overflowX: 'auto',
          padding: '8px 16px',
          gap: 8,
          fontFamily: fonts.sans,
        }}
        className="settings-nav-mobile"
      >
        {userTabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                fontFamily: fonts.sans,
                color: isActive ? colors.accent : colors.textSecondary,
                background: isActive ? colors.accentSoft : colors.surfaceRaised,
                border: `1px solid ${isActive ? colors.accent : colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{ marginRight: 6 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}

        {isAdmin && adminTabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                fontFamily: fonts.sans,
                color: isActive ? colors.accent : colors.textSecondary,
                background: isActive ? colors.accentSoft : colors.surfaceRaised,
                border: `1px solid ${isActive ? colors.accent : colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{ marginRight: 6 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .settings-nav-desktop {
            display: none !important;
          }
          .settings-nav-mobile {
            display: flex !important;
          }
        }
      `}</style>
    </>
  );
}

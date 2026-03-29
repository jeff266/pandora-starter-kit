import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { Icon, type IconName } from '../icons';
import { useWorkspace } from '../../context/WorkspaceContext';

interface NavItem {
  key: string;
  label: string;
  icon: IconName | string;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// ─── Active section — always visible ─────────────────────────────────────────

const ACTIVE_ITEMS: NavItem[] = [
  { key: 'forward-deploy',  label: 'Forward Deploy',  icon: '🚀',           adminOnly: true },
  { key: 'calibration',     label: 'AI Knowledge',    icon: 'target',        adminOnly: true },
  { key: 'pipeline-config', label: 'Pipeline Config', icon: 'chart-growth',  adminOnly: true },
  { key: 'segments',        label: 'Segments',         icon: 'filter',        adminOnly: true },
  { key: 'sales-roster',    label: 'Sales Roster',     icon: 'network',       adminOnly: true },
  { key: 'connectors',      label: 'Connectors',       icon: 'transfer',      adminOnly: true },
  { key: 'notifications',   label: 'Notifications',    icon: 'wifi',          adminOnly: true },
];

// ─── Advanced subsections — collapsed by default ──────────────────────────────

const ADVANCED_SECTIONS: NavSection[] = [
  {
    label: 'Connect',
    items: [
      { key: 'connectors-health', label: 'Connector Health', icon: 'wifi',         adminOnly: true },
      { key: 'crm-sync',          label: 'CRM Sync',         icon: 'refresh',      adminOnly: true },
      { key: 'deal-fields',       label: 'Deal Fields',      icon: 'edit',         adminOnly: true },
      { key: 'webhooks',          label: 'Webhooks',         icon: 'transfer',     adminOnly: true },
      { key: 'claude',            label: 'Claude',           icon: '✦',            adminOnly: true },
    ],
  },
  {
    label: 'Configure',
    items: [
      { key: 'setup',           label: 'Onboarding',     icon: '✦',  adminOnly: true },
      { key: 'methodology',     label: 'Methodology',    icon: 'target', adminOnly: true },
      { key: 'automations',     label: 'Automations',    icon: '⚡', adminOnly: true },
      { key: 'agentic-actions', label: 'Agentic Actions', icon: '🤖', adminOnly: true },
    ],
  },
  {
    label: 'Manage',
    items: [
      { key: 'members',     label: 'Members',     icon: 'connections',  adminOnly: true },
      { key: 'roles',       label: 'Roles',       icon: 'target',       adminOnly: true },
      { key: 'features',    label: 'Features',    icon: 'lightbulb',    adminOnly: true },
      { key: 'ai-keys',     label: 'AI Keys',     icon: 'brain',        adminOnly: true },
      { key: 'token-usage', label: 'Token Usage', icon: 'trending',     adminOnly: true },
      { key: 'billing',     label: 'Billing',     icon: 'chart-growth', adminOnly: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { key: 'profile',     label: 'Profile',     icon: 'hub' },
      { key: 'security',    label: 'Security',    icon: 'check-flow' },
      { key: 'preferences', label: 'Preferences', icon: 'filter' },
      { key: 'workspaces',  label: 'Workspaces',  icon: 'building' },
    ],
  },
];

// All items flattened — for mobile nav and active-tab lookup
const ALL_ITEMS: NavItem[] = [
  ...ACTIVE_ITEMS,
  ...ADVANCED_SECTIONS.flatMap(s => s.items),
];

const ADVANCED_KEYS = new Set(ADVANCED_SECTIONS.flatMap(s => s.items.map(i => i.key)));

const LS_KEY = 'pandora_settings_nav_advanced';

function readAdvancedFromStorage(): boolean {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

function writeAdvancedToStorage(expanded: boolean) {
  try {
    localStorage.setItem(LS_KEY, expanded ? 'true' : 'false');
  } catch {}
}

// ─── NavButton ────────────────────────────────────────────────────────────────

function NavButton({
  item, isActive, onClick, badge,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  const iconFilter = isActive
    ? 'brightness(0) saturate(100%) invert(47%) sepia(68%) saturate(1869%) hue-rotate(204deg) brightness(96%) contrast(94%)'
    : 'brightness(0) saturate(100%) invert(62%) sepia(11%) saturate(566%) hue-rotate(181deg) brightness(94%) contrast(88%)';

  const isEmoji = typeof item.icon === 'string' && item.icon.length <= 2;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', textAlign: 'left', padding: '9px 16px',
        fontSize: 13, fontWeight: isActive ? 600 : 400,
        fontFamily: fonts.sans,
        color: isActive ? colors.accent : colors.textSecondary,
        background: isActive ? colors.accentSoft : 'transparent',
        border: 'none',
        borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
        cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = colors.surfaceHover; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 16, opacity: 0.9, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
        {isEmoji
          ? item.icon
          : <Icon name={item.icon as IconName} size={16} style={{ filter: iconFilter }} />}
      </span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {badge}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SettingsNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin?: boolean;
}

export default function SettingsNav({ activeTab, onTabChange, isAdmin = false }: SettingsNavProps) {
  const { currentWorkspace, token } = useWorkspace();
  const [calibrationComplete, setCalibrationComplete] = useState<boolean | null>(null);

  // Advanced section expanded state — persisted in localStorage
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => readAdvancedFromStorage());

  // Fetch calibration status for the AI Knowledge badge
  useEffect(() => {
    if (!currentWorkspace?.id || !token) return;
    fetch(`/api/workspaces/${currentWorkspace.id}/calibration-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setCalibrationComplete(data.calibration_status === 'complete');
      })
      .catch(() => {});
  }, [currentWorkspace?.id, token]);

  // Auto-expand Advanced if the active tab lives in it
  useEffect(() => {
    const normalizedTab = activeTab === 'dimensions' ? 'segments' : activeTab;
    if (ADVANCED_KEYS.has(normalizedTab) && !advancedOpen) {
      setAdvancedOpen(true);
      writeAdvancedToStorage(true);
    }
  }, [activeTab]);

  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setAdvancedOpen(next);
    writeAdvancedToStorage(next);
  };

  function getCalibrationBadge() {
    if (calibrationComplete === null) return null;
    if (calibrationComplete) {
      return <span style={{ fontSize: 10, color: colors.green, fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>✓</span>;
    }
    return <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F59E0B', display: 'inline-block', flexShrink: 0 }} />;
  }

  function isActive(key: string) {
    return activeTab === key || (key === 'segments' && activeTab === 'dimensions');
  }

  const advancedHasActiveTab = ADVANCED_KEYS.has(activeTab === 'dimensions' ? 'segments' : activeTab);

  const visibleActiveItems = isAdmin
    ? ACTIVE_ITEMS
    : ACTIVE_ITEMS.filter(i => !i.adminOnly);

  return (
    <>
      {/* Desktop navigation */}
      <nav
        style={{
          width: 200, flexShrink: 0,
          background: colors.surface,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column',
          padding: '0 0 12px',
          overflowY: 'auto',
          position: 'sticky', top: 0,
          height: 'fit-content', maxHeight: '100vh',
          fontFamily: fonts.sans,
        }}
        className="settings-nav-desktop"
      >
        {/* ── Active section ──────────────────────────────────────────── */}
        <div style={{ marginTop: 8 }}>
          <div style={{
            padding: '6px 14px 6px 16px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            color: colors.textDim, textTransform: 'uppercase', fontFamily: fonts.sans,
          }}>
            Active
          </div>
          {visibleActiveItems.map(item => (
            <NavButton
              key={item.key}
              item={item}
              isActive={isActive(item.key)}
              onClick={() => onTabChange(item.key)}
              badge={item.key === 'calibration' ? getCalibrationBadge() : undefined}
            />
          ))}
        </div>

        {/* ── Advanced toggle ─────────────────────────────────────────── */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={toggleAdvanced}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '6px 14px 6px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              borderLeft: '3px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              color: advancedHasActiveTab && !advancedOpen ? colors.accent : colors.textDim,
              textTransform: 'uppercase', fontFamily: fonts.sans,
              transition: 'color 0.15s',
            }}>
              Advanced
              {advancedHasActiveTab && !advancedOpen && (
                <span style={{
                  display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                  background: colors.accent, marginLeft: 6, verticalAlign: 'middle',
                }} />
              )}
            </span>
            <span style={{
              fontSize: 9, color: colors.textDim, lineHeight: 1,
              transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.18s ease',
              display: 'inline-block',
            }}>
              ▾
            </span>
          </button>

          {/* Advanced content */}
          <div style={{
            overflow: 'hidden',
            maxHeight: advancedOpen ? 1200 : 0,
            transition: 'max-height 0.22s ease',
          }}>
            {ADVANCED_SECTIONS.map(section => {
              const visibleItems = section.items.filter(item => !item.adminOnly || isAdmin);
              if (visibleItems.length === 0) return null;
              return (
                <div key={section.label} style={{ marginTop: 4 }}>
                  <div style={{
                    padding: '4px 14px 4px 22px',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                    color: colors.textDim, textTransform: 'uppercase',
                    fontFamily: fonts.sans,
                  }}>
                    {section.label}
                  </div>
                  {visibleItems.map(item => (
                    <NavButton
                      key={item.key}
                      item={item}
                      isActive={isActive(item.key)}
                      onClick={() => onTabChange(item.key)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${colors.border}`, margin: '16px 0 4px' }} />
        <a
          href="/help"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 16px', fontSize: 13, fontWeight: 400,
            fontFamily: 'inherit', color: colors.textSecondary,
            textDecoration: 'none', borderLeft: '3px solid transparent',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = colors.accent; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = colors.textSecondary; }}
        >
          <span>Help & Support</span>
        </a>
      </nav>

      {/* Mobile navigation — flat list of all items */}
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
        {ALL_ITEMS.filter(item => !item.adminOnly || isAdmin).map(item => {
          const active = isActive(item.key);
          const isEmoji = typeof item.icon === 'string' && item.icon.length <= 2;
          const iconFilter = active
            ? 'brightness(0) saturate(100%) invert(47%) sepia(68%) saturate(1869%) hue-rotate(204deg) brightness(96%) contrast(94%)'
            : 'brightness(0) saturate(100%) invert(62%) sepia(11%) saturate(566%) hue-rotate(181deg) brightness(94%) contrast(88%)';

          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              style={{
                padding: '8px 12px', fontSize: 13,
                fontWeight: active ? 600 : 400, fontFamily: fonts.sans,
                color: active ? colors.accent : colors.textSecondary,
                background: active ? colors.accentSoft : colors.surfaceRaised,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                borderRadius: 6, cursor: 'pointer',
                whiteSpace: 'nowrap', transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                {isEmoji
                  ? item.icon
                  : <Icon name={item.icon as IconName} size={14} style={{ filter: iconFilter }} />}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .settings-nav-desktop { display: none !important; }
          .settings-nav-mobile  { display: flex !important; }
        }
      `}</style>
    </>
  );
}

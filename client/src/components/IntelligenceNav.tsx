import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';

interface IntelligenceNavProps {
  activeTab: 'skills' | 'tools' | 'agents' | 'governance';
  pendingCount?: number;
}

const IntelligenceNav: React.FC<IntelligenceNavProps> = ({ activeTab, pendingCount = 0 }) => {
  const navigate = useNavigate();

  const tabs = [
    { id: 'skills', label: 'Skills', path: '/skills' },
    { id: 'tools', label: 'Tools', path: '/tools' },
    { id: 'agents', label: 'Agents', path: '/agents' },
    { id: 'governance', label: 'Governance', path: '/governance', badge: pendingCount },
  ];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 24,
      borderBottom: `1px solid ${colors.border}`,
      paddingBottom: 0,
    }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: isActive ? '#fff' : colors.textMuted,
              background: isActive ? colors.accent : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              position: 'relative',
              marginBottom: -1,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = colors.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = colors.textMuted;
              }
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span style={{
                background: colors.orange,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 10,
                minWidth: 16,
                textAlign: 'center',
              }}>
                {tab.badge}
              </span>
            )}
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 2,
                background: colors.accent,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default IntelligenceNav;

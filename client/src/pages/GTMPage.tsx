import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import PipelinePage from './PipelinePage';
import DealList from './DealList';
import AccountList from './AccountList';
import ConversationsPage from './ConversationsPage';
import ProspectsPage from './ProspectsPage';
import ForecastPage from './ForecastPage';

const TABS = [
  { key: 'pipeline',      label: 'Pipeline' },
  { key: 'deals',         label: 'Deals' },
  { key: 'accounts',      label: 'Accounts' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'prospects',     label: 'Prospects' },
  { key: 'forecast',      label: 'Forecast' },
] as const;

type GTMTab = (typeof TABS)[number]['key'];

const VALID_TABS = new Set<string>(TABS.map(t => t.key));

export default function GTMPage() {
  const { tab = 'pipeline' } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const activeTab: GTMTab = VALID_TABS.has(tab) ? (tab as GTMTab) : 'pipeline';

  const handleTabClick = (key: GTMTab) => {
    navigate(`/gtm/${key}`, { replace: false });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'pipeline':      return <PipelinePage />;
      case 'deals':         return <DealList />;
      case 'accounts':      return <AccountList />;
      case 'conversations': return <ConversationsPage />;
      case 'prospects':     return <ProspectsPage />;
      case 'forecast':      return <ForecastPage />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 24px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bg,
          flexShrink: 0,
        }}
      >
        {TABS.map(({ key, label }) => {
          const active = key === activeTab;
          return (
            <button
              key={key}
              onClick={() => handleTabClick(key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid #1D9E75' : '2px solid transparent',
                padding: '11px 16px 10px',
                fontSize: 13,
                fontFamily: fonts.sans,
                fontWeight: active ? 600 : 400,
                color: active ? '#e8ecf4' : '#5a6578',
                cursor: 'pointer',
                outline: 'none',
                transition: 'color 0.1s, border-color 0.1s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#5a6578';
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {renderContent()}
      </div>
    </div>
  );
}

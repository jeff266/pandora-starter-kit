import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface Deal {
  id: string;
  name: string;
  amount: number;
  stage: string;
  owner_name?: string;
  close_date?: string;
  probability?: number;
}

interface DrillDownPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  deals: Deal[];
  onDealClick?: (dealId: string) => void;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export default function DrillDownPanel({
  open,
  onClose,
  title,
  deals,
  onDealClick,
}: DrillDownPanelProps) {
  if (!open) return null;

  const totalAmount = deals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 999,
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: '90vw',
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.2s ease-out',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: colors.surfaceRaised,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2, fontFamily: fonts.sans }}>
              {deals.length} deal{deals.length !== 1 ? 's' : ''} · {formatCurrency(totalAmount)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {deals.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: colors.textMuted,
                fontSize: 13,
                fontFamily: fonts.sans,
              }}
            >
              No deals to display
            </div>
          ) : (
            deals.map(deal => (
              <div
                key={deal.id}
                style={{
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '10px 14px',
                  marginBottom: 6,
                  cursor: onDealClick ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  if (onDealClick) e.currentTarget.style.background = colors.surfaceHover;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = colors.surfaceRaised;
                }}
                onClick={() => onDealClick?.(deal.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: colors.text,
                        fontFamily: fonts.sans,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {deal.name}
                    </div>
                    {deal.owner_name && (
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: fonts.sans }}>
                        {deal.owner_name}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.green, fontFamily: fonts.mono, flexShrink: 0 }}>
                    {formatCurrency(deal.amount || 0)}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      background: colors.accentSoft,
                      color: colors.accent,
                      borderRadius: 10,
                      fontWeight: 500,
                      fontFamily: fonts.sans,
                    }}
                  >
                    {deal.stage}
                  </span>
                  {deal.probability != null && (
                    <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                      {deal.probability}%
                    </span>
                  )}
                  {deal.close_date && (
                    <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginLeft: 'auto' }}>
                      {new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

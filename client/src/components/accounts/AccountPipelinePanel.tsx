import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency, formatDate } from '../../lib/format';

interface PanelDeal {
  id: string;
  name: string;
  amount: number | string | null;
  stage: string;
  stage_normalized: string;
  close_date: string | null;
  tte_conditional_prob?: number | string | null;
}

interface AccountPipelinePanelProps {
  accountId: string;
  accountName: string;
  workspaceId: string;
  deals: PanelDeal[];
  onClose: () => void;
}

const TTE_DEFAULT = 0.25;

export function AccountPipelinePanel({
  accountId,
  accountName,
  workspaceId,
  deals,
  onClose,
}: AccountPipelinePanelProps) {
  const navigate = useNavigate();

  const openDeals = deals.filter(
    (d) => !['closed_won', 'closed_lost'].includes(d.stage_normalized)
  );

  const rawPipeline = openDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const qualityPipeline = openDeals.reduce((sum, d) => {
    const prob =
      d.tte_conditional_prob != null && Number(d.tte_conditional_prob) > 0
        ? Number(d.tte_conditional_prob)
        : TTE_DEFAULT;
    return sum + (Number(d.amount) || 0) * prob;
  }, 0);

  const sql = `SELECT
  name,
  amount,
  stage,
  close_date,
  COALESCE(tte_conditional_prob, 0.25) AS tte_prob,
  amount * COALESCE(tte_conditional_prob, 0.25) AS quality_value
FROM deals
WHERE workspace_id = '${workspaceId}'
  AND account_id = '${accountId}'
  AND stage_normalized NOT IN ('closed_won', 'closed_lost')
ORDER BY amount DESC`;

  const handleSqlClick = () => {
    navigate('/sql-workspace', {
      state: {
        sql,
        sourceName: `${accountName} Pipeline`,
        sourceType: 'account-pipeline',
      },
    });
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 40,
        }}
      />

      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: Math.min(480, window.innerWidth - 40),
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 50,
          overflowY: 'auto',
          padding: '20px 24px',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Show the Math
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: colors.text }}>
              Pipeline Breakdown
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              {accountName}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 20,
        }}>
          <div style={{
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Open Pipeline
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
              {formatCurrency(rawPipeline)}
            </div>
            <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
              {openDeals.length} open {openDeals.length === 1 ? 'deal' : 'deals'}
            </div>
          </div>

          <div style={{
            background: colors.surfaceRaised,
            border: `1px solid ${colors.accent}30`,
            borderRadius: 8,
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Quality Pipeline
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.accent }}>
              {formatCurrency(qualityPipeline)}
            </div>
            <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
              TTE-weighted
            </div>
          </div>
        </div>

        <div style={{
          background: `${colors.accent}08`,
          border: `1px solid ${colors.accent}20`,
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 20,
          fontFamily: fonts.mono,
          fontSize: 11,
          color: colors.textSecondary,
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: colors.accent, marginBottom: 6, fontFamily: fonts.sans ?? undefined, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Formula
          </div>
          <div>Open Pipeline = SUM(open deal amounts)</div>
          <div style={{ marginTop: 4 }}>Quality Pipeline = SUM(amount × TTE probability)</div>
          <div style={{ marginTop: 4, color: colors.textMuted }}>TTE default = 25% when unscored</div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Open Deals ({openDeals.length})
        </div>

        {openDeals.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.textMuted, padding: '12px 0' }}>No open deals for this account.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {openDeals.map((deal) => {
              const amount = Number(deal.amount) || 0;
              const prob =
                deal.tte_conditional_prob != null && Number(deal.tte_conditional_prob) > 0
                  ? Number(deal.tte_conditional_prob)
                  : TTE_DEFAULT;
              const quality = amount * prob;
              const isDefaultProb = deal.tte_conditional_prob == null || Number(deal.tte_conditional_prob) === 0;

              return (
                <div
                  key={deal.id}
                  style={{
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, flex: 1, minWidth: 0 }}>
                      {deal.name || 'Unnamed Deal'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, flexShrink: 0 }}>
                      {formatCurrency(amount)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                        background: `${colors.accent}14`, color: colors.accent,
                      }}>
                        {deal.stage || deal.stage_normalized}
                      </span>
                      {deal.close_date && (
                        <span style={{ fontSize: 10, color: colors.textMuted }}>
                          closes {formatDate(deal.close_date)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: isDefaultProb ? colors.textMuted : colors.textSecondary, fontFamily: fonts.mono, flexShrink: 0 }}>
                      {Math.round(prob * 100)}%{isDefaultProb ? '*' : ''} → {formatCurrency(quality)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: colors.textMuted, paddingTop: 2 }}>
              * Default 25% TTE probability — unscored deal
            </div>
          </div>
        )}

        <div style={{ paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <button
            onClick={handleSqlClick}
            style={{
              padding: '8px 14px',
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 12,
              color: colors.accent,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Query on SQL
          </button>
        </div>
      </div>
    </>
  );
}

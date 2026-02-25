import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { getBreakdownData, getSqlQuery, fmt, type MathContext, type Deal } from '../../lib/forecast-math';

interface MathBreakdownProps {
  metric: string;
  value: number;
  context: MathContext;
  deals: Deal[];
  workspaceId: string;
  onClose: () => void;
}

export function MathBreakdown({ metric, value, context, deals, workspaceId, onClose }: MathBreakdownProps) {
  const navigate = useNavigate();
  const breakdown = getBreakdownData(metric, value, context, deals);
  const { sql, label } = getSqlQuery(metric, workspaceId, {
    period: context.period,
    repEmail: context.repEmail,
    repName: context.repName,
  });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 40,
        }}
      />

      {/* Panel */}
      <div style={{
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
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Show the Math
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: colors.text }}>
              {breakdown.title}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 18, cursor: 'pointer', padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* How it's calculated */}
        <Section label="How it's calculated">
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.7 }}>
            {breakdown.explanation}
          </div>
        </Section>

        {/* Key inputs */}
        {breakdown.inputs && breakdown.inputs.length > 0 && (
          <Section label="Key inputs">
            {breakdown.inputs.map((input, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '5px 0',
                borderBottom: i < breakdown.inputs.length - 1 ? `1px solid ${colors.border}` : 'none',
              }}>
                <span style={{ fontSize: 12, color: colors.textMuted }}>{input.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: fonts.mono }}>{input.value}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Distribution (MC only) */}
        {breakdown.distribution && (
          <Section label="Result distribution">
            {breakdown.distribution.map((d, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                fontWeight: d.highlight ? 700 : 400,
                color: d.highlight ? colors.accent : colors.textSecondary,
              }}>
                <span style={{ fontSize: 12 }}>{d.label}</span>
                <span style={{ fontSize: 12, fontFamily: fonts.mono }}>{d.value}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Category breakdown (category weighted only) */}
        {breakdown.categories && (
          <Section label="By forecast category">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Category', 'Weight', 'Deals', 'Pipeline', 'Weighted'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Category' ? 'left' : 'right',
                      fontSize: 10,
                      fontWeight: 700,
                      color: colors.textMuted,
                      padding: '4px 0',
                      borderBottom: `1px solid ${colors.border}`,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.categories.map((cat, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, padding: '6px 0' }}>{cat.name}</td>
                    <td style={{ fontSize: 12, textAlign: 'right', color: colors.textMuted }}>×{(cat.weight * 100).toFixed(0)}%</td>
                    <td style={{ fontSize: 12, textAlign: 'right' }}>{cat.count}</td>
                    <td style={{ fontSize: 12, textAlign: 'right', fontFamily: fonts.mono }}>{fmt(cat.pipeline)}</td>
                    <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600, fontFamily: fonts.mono }}>{fmt(cat.weighted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Deal list */}
        {breakdown.deals && breakdown.deals.length > 0 && (
          <Section label={`${breakdown.dealsLabel || 'Contributing deals'} (${breakdown.deals.length})`}>
            {breakdown.deals.slice(0, 20).map((deal, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: i < Math.min(19, breakdown.deals!.length - 1) ? `1px solid ${colors.border}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {deal.name}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>
                    {deal.stage || deal.stage_normalized} · {deal.owner || deal.owner_name}
                  </div>
                </div>
                <div style={{ textAlign: 'right', marginLeft: 12, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, fontFamily: fonts.mono }}>{fmt(deal.amount)}</div>
                  {deal.contribution !== undefined && (
                    <div style={{ fontSize: 10, color: colors.textMuted }}>→ {fmt(deal.contribution)}</div>
                  )}
                </div>
              </div>
            ))}
            {breakdown.deals.length > 20 && (
              <div style={{ fontSize: 11, color: colors.textMuted, padding: '8px 0' }}>
                ... and {breakdown.deals.length - 20} more deals
              </div>
            )}
          </Section>
        )}

        {/* Notes */}
        {breakdown.notes && (
          <Section label="Notes">
            <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6 }}>
              {breakdown.notes}
            </div>
          </Section>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate(`/workspaces/${workspaceId}/tools`, { state: { sql, sourceName: label, sourceType: 'forecast-math' } })}
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
            Query in SQL ↗
          </button>
          <button
            style={{
              padding: '8px 14px',
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 12,
              color: colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            Export to Excel ↗
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

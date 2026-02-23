import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

// ============================================================================
// Types
// ============================================================================

interface TokenUsageRow {
  date: string;
  feature: string;
  pandora_input_tokens: number;
  pandora_output_tokens: number;
  pandora_cost_usd: number;
  byok_input_tokens: number;
  byok_output_tokens: number;
  byok_cost_usd: number;
  calls: number;
}

interface DashboardResponse {
  rows: TokenUsageRow[];
  budget_usd: number;
}

// ============================================================================
// Constants
// ============================================================================

const FEATURES = [
  'ask_pandora',
  'pipeline_hygiene',
  'deal_risk_review',
  'rep_scorecard',
  'forecast_rollup',
  'conversation_intelligence',
  'icp_discovery',
  'lead_scoring',
  'intent_classify',
  'compress',
];

const FEATURE_LABELS: Record<string, string> = {
  ask_pandora: 'Ask Pandora',
  pipeline_hygiene: 'Pipeline Hygiene',
  deal_risk_review: 'Deal Risk Review',
  rep_scorecard: 'Rep Scorecard',
  forecast_rollup: 'Forecast Rollup',
  conversation_intelligence: 'Conversation Intelligence',
  icp_discovery: 'ICP Discovery',
  lead_scoring: 'Lead Scoring',
  intent_classify: 'Intent Classifier',
  compress: 'Result Compression',
};

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'MTD', days: new Date().getDate() },
];

// ============================================================================
// Helpers
// ============================================================================

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

// ============================================================================
// Main Component
// ============================================================================

export default function TokenUsagePage() {
  const { currentWorkspace } = useWorkspace();
  const [period, setPeriod] = useState('MTD');
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [budget, setBudget] = useState(120.0);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('120');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TokenUsageRow[]>([]);

  const fetchData = useCallback(async () => {
    if (!currentWorkspace) return;

    setLoading(true);
    setError(null);

    try {
      const response = await api.get(
        `/token-usage/dashboard?period=${period}`
      ) as DashboardResponse;

      setData(response.rows || []);
      setBudget(response.budget_usd || 120.0);
      setBudgetInput(String(response.budget_usd || 120.0));
    } catch (err: any) {
      setError(err.message || 'Failed to load token usage data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, period]);

  const saveBudget = useCallback(async () => {
    if (!currentWorkspace) return;

    const newBudget = parseFloat(budgetInput);
    if (isNaN(newBudget) || newBudget <= 0) return;

    try {
      await api.put(`/token-usage/budget`, {
        budget_usd: newBudget,
      });
      setBudget(newBudget);
      setEditingBudget(false);
    } catch (err: any) {
      console.error('Failed to save budget:', err);
    }
  }, [currentWorkspace, budgetInput]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate data by feature
  const byFeature: Record<string, {
    feature: string;
    pandora_input: number;
    pandora_output: number;
    pandora_cost: number;
    byok_input: number;
    byok_output: number;
    byok_cost: number;
    calls: number;
  }> = {};

  FEATURES.forEach((f) => {
    byFeature[f] = {
      feature: f,
      pandora_input: 0,
      pandora_output: 0,
      pandora_cost: 0,
      byok_input: 0,
      byok_output: 0,
      byok_cost: 0,
      calls: 0,
    };
  });

  data.forEach((r) => {
    if (!byFeature[r.feature]) {
      byFeature[r.feature] = {
        feature: r.feature,
        pandora_input: 0,
        pandora_output: 0,
        pandora_cost: 0,
        byok_input: 0,
        byok_output: 0,
        byok_cost: 0,
        calls: 0,
      };
    }
    const b = byFeature[r.feature];
    b.pandora_input += r.pandora_input_tokens;
    b.pandora_output += r.pandora_output_tokens;
    b.pandora_cost += r.pandora_cost_usd;
    b.byok_input += r.byok_input_tokens;
    b.byok_output += r.byok_output_tokens;
    b.byok_cost += r.byok_cost_usd;
    b.calls += r.calls;
  });

  const featureRows = Object.values(byFeature)
    .filter((r) => r.pandora_cost > 0 || r.byok_cost > 0)
    .sort((a, b) => b.pandora_cost - a.pandora_cost);

  const totals = featureRows.reduce(
    (acc, r) => ({
      pandora_input: acc.pandora_input + r.pandora_input,
      pandora_output: acc.pandora_output + r.pandora_output,
      pandora_cost: acc.pandora_cost + r.pandora_cost,
      byok_input: acc.byok_input + r.byok_input,
      byok_output: acc.byok_output + r.byok_output,
      byok_cost: acc.byok_cost + r.byok_cost,
      calls: acc.calls + r.calls,
    }),
    {
      pandora_input: 0,
      pandora_output: 0,
      pandora_cost: 0,
      byok_input: 0,
      byok_output: 0,
      byok_cost: 0,
      calls: 0,
    }
  );

  const utilizationPct = Math.min((totals.pandora_cost / budget) * 100, 100);
  const days = PERIODS.find((p) => p.label === period)?.days || 30;
  const projectedMonthly =
    period === 'MTD' ? (totals.pandora_cost / new Date().getDate()) * 30 : null;
  const projectedPct = projectedMonthly ? (projectedMonthly / budget) * 100 : null;
  const budgetStatus = utilizationPct > 90 ? 'critical' : utilizationPct > 70 ? 'warning' : 'ok';
  const statusColor = {
    ok: colors.green,
    warning: colors.yellow,
    critical: colors.red,
  }[budgetStatus];
  const maxCost = Math.max(...featureRows.map((r) => r.pandora_cost), 0.0001);

  // Daily totals for sparkline
  const dailyTotals: Record<string, { pandora: number; byok: number }> = {};
  data.forEach((r) => {
    if (!dailyTotals[r.date]) dailyTotals[r.date] = { pandora: 0, byok: 0 };
    dailyTotals[r.date].pandora += r.pandora_cost_usd;
    dailyTotals[r.date].byok += r.byok_cost_usd;
  });
  const dailyArr = Object.entries(dailyTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
  const maxDailyCost = Math.max(...dailyArr.map((d) => d.pandora + d.byok), 0.0001);

  const cellStyle: React.CSSProperties = {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'right',
  };

  if (loading) {
    return (
      <div style={{ fontFamily: fonts.sans, color: colors.textSecondary, padding: 24 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          fontFamily: fonts.sans,
          color: colors.red,
          padding: 24,
          background: colors.redSoft,
          border: `1px solid ${colors.red}`,
          borderRadius: 6,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: fonts.mono,
        background: colors.bg,
        minHeight: '100vh',
        color: colors.text,
        maxWidth: 1200,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: colors.textMuted,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Workspace Admin · {currentWorkspace?.name}
          </div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 400,
              margin: 0,
              color: colors.text,
              letterSpacing: '-0.02em',
            }}
          >
            Token Usage
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPeriod(p.label)}
              style={{
                padding: '5px 12px',
                fontSize: 10,
                letterSpacing: '0.12em',
                background: period === p.label ? colors.accentSoft : 'transparent',
                color: period === p.label ? colors.accent : colors.textSecondary,
                border: `1px solid ${period === p.label ? colors.accent : colors.border}`,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Budget bar */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${budgetStatus === 'ok' ? colors.border : statusColor}`,
          borderRadius: 6,
          padding: '16px 18px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.18em',
              color: colors.textSecondary,
              textTransform: 'uppercase',
            }}
          >
            Pandora Budget Utilization
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {projectedMonthly && (
              <span style={{ fontSize: 9, color: projectedPct! > 100 ? colors.red : colors.textSecondary }}>
                Projected ${projectedMonthly.toFixed(2)}/mo
                {projectedPct! > 100 ? ' · ⚠ over budget' : ''}
              </span>
            )}
            {editingBudget ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: colors.textSecondary }}>$</span>
                <input
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  style={{
                    width: 60,
                    background: colors.bg,
                    border: `1px solid ${colors.accent}`,
                    borderRadius: 3,
                    color: colors.text,
                    fontSize: 11,
                    padding: '2px 6px',
                    fontFamily: 'inherit',
                  }}
                  autoFocus
                />
                <button
                  onClick={saveBudget}
                  style={{
                    fontSize: 9,
                    padding: '2px 8px',
                    background: colors.accentSoft,
                    color: colors.accent,
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Set
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setBudgetInput(String(budget));
                  setEditingBudget(true);
                }}
                style={{
                  fontSize: 9,
                  color: colors.textMuted,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  letterSpacing: '0.1em',
                }}
              >
                Budget: ${budget.toFixed(2)}/mo
              </button>
            )}
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            height: 8,
            background: colors.border,
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${utilizationPct}%`,
              background: `linear-gradient(90deg, ${colors.accent}, ${statusColor})`,
              borderRadius: 4,
              transition: 'width 0.4s',
            }}
          />
          {projectedPct && projectedPct < 100 && (
            <div
              style={{
                position: 'absolute',
                left: `${Math.min(projectedPct, 99)}%`,
                top: -1,
                bottom: -1,
                width: 1,
                background: colors.textSecondary,
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: statusColor }}>
            ${totals.pandora_cost.toFixed(2)} used ({utilizationPct.toFixed(1)}%)
          </span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            ${(budget - totals.pandora_cost).toFixed(2)} remaining
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          {
            label: 'Pandora Cost',
            value: `$${totals.pandora_cost.toFixed(2)}`,
            sub: 'Billed to Pandora infra',
            color: colors.yellow,
          },
          {
            label: 'BYOK Cost',
            value: `$${totals.byok_cost.toFixed(2)}`,
            sub: 'Billed to customer key',
            color: colors.green,
          },
          {
            label: 'Total Calls',
            value: totals.calls.toLocaleString(),
            sub: `${Math.round(totals.calls / days)}/day avg`,
            color: colors.accent,
          },
          {
            label: 'Pandora / Call',
            value: fmtCost(totals.pandora_cost / Math.max(totals.calls, 1)),
            sub: 'Avg Pandora cost',
            color: colors.textSecondary,
          },
          {
            label: 'BYOK / Call',
            value: totals.byok_input > 0 ? fmtCost(totals.byok_cost / Math.max(totals.calls, 1)) : '—',
            sub: 'Avg customer key cost',
            color: colors.textSecondary,
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '14px 16px',
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.16em',
                color: colors.textMuted,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: 20, color: card.color, letterSpacing: '-0.03em', marginBottom: 3 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 9, color: colors.textMuted }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Sparkline */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: '14px 18px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 10 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.18em',
              color: colors.textSecondary,
              textTransform: 'uppercase',
            }}
          >
            Daily Cost
          </span>
          <span style={{ fontSize: 9, color: colors.accent }}>■ Pandora</span>
          <span style={{ fontSize: 9, color: colors.green }}>■ BYOK (customer key)</span>
        </div>
        <svg width="100%" height="44" viewBox={`0 0 ${dailyArr.length * 18} 44`} preserveAspectRatio="none">
          {dailyArr.map((d, i) => {
            const pH = (d.pandora / maxDailyCost) * 38;
            const bH = (d.byok / maxDailyCost) * 38;
            return (
              <g key={d.date}>
                <rect x={i * 18} y={44 - pH} width={14} height={pH} fill={colors.accentSoft} rx={2} />
                <rect x={i * 18} y={44 - pH - bH} width={14} height={bH} fill={colors.greenSoft} rx={2} />
                <rect x={i * 18} y={44 - pH} width={14} height={Math.min(pH, 2)} fill={colors.accent} rx={2} />
              </g>
            );
          })}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: colors.textMuted, marginTop: 4 }}>
          <span>{dailyArr[0]?.date}</span>
          <span>{dailyArr[dailyArr.length - 1]?.date}</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 18px', borderBottom: `1px solid ${colors.border}`, background: colors.bg }}>
          <span style={{ fontSize: 9, color: colors.textMuted, letterSpacing: '0.08em' }}>
            BYOK = tokens consumed via a customer-provided API key — cost is charged to the customer's account, not
            Pandora infrastructure.
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 70px 90px 90px 90px 90px 56px',
            padding: '9px 18px',
            borderBottom: `1px solid ${colors.border}`,
            fontSize: 9,
            letterSpacing: '0.14em',
            color: colors.textMuted,
            textTransform: 'uppercase',
          }}
        >
          <span>Feature</span>
          <span style={{ textAlign: 'right' }}>Calls</span>
          <span style={{ textAlign: 'right' }}>Pandora Tokens</span>
          <span style={{ textAlign: 'right' }}>Pandora Cost</span>
          <span style={{ textAlign: 'right' }}>Cost / Call</span>
          <span style={{ textAlign: 'right' }}>BYOK Tokens</span>
          <span style={{ textAlign: 'right' }}>Bar</span>
        </div>

        {featureRows.map((row, idx) => {
          const pandoraTotal = row.pandora_input + row.pandora_output;
          const byokTotal = row.byok_input + row.byok_output;
          const costPerCall = row.calls > 0 ? row.pandora_cost / row.calls : 0;
          const barW = maxCost > 0 ? (row.pandora_cost / maxCost) * 100 : 0;
          const isSelected = selectedFeature === row.feature;
          return (
            <div key={row.feature}>
              <div
                onClick={() => setSelectedFeature(isSelected ? null : row.feature)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 70px 90px 90px 90px 90px 56px',
                  padding: '11px 18px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  background: isSelected ? colors.surfaceRaised : idx % 2 === 0 ? colors.surface : colors.bg,
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: colors.text }}>
                    {FEATURE_LABELS[row.feature] || row.feature}
                  </span>
                  {byokTotal > 0 && (
                    <span
                      style={{
                        fontSize: 8,
                        color: colors.green,
                        background: colors.greenSoft,
                        padding: '1px 5px',
                        borderRadius: 2,
                        letterSpacing: '0.1em',
                      }}
                    >
                      BYOK
                    </span>
                  )}
                </div>
                <span style={{ ...cellStyle, color: colors.textSecondary }}>{row.calls}</span>
                <span style={{ ...cellStyle, color: pandoraTotal > 0 ? colors.accent : colors.textMuted }}>
                  {fmt(pandoraTotal)}
                </span>
                <span style={{ ...cellStyle, color: row.pandora_cost > 0.01 ? colors.yellow : colors.textMuted }}>
                  {fmtCost(row.pandora_cost)}
                </span>
                <span style={{ ...cellStyle, color: costPerCall > 0.005 ? colors.yellow : colors.textSecondary }}>
                  {row.calls > 0 ? fmtCost(costPerCall) : '—'}
                </span>
                <span style={{ ...cellStyle, color: byokTotal > 0 ? colors.green : colors.textMuted }}>
                  {byokTotal > 0 ? fmt(byokTotal) : '—'}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      width: 44,
                      height: 4,
                      background: colors.border,
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${barW}%`,
                        height: '100%',
                        background: barW > 66 ? colors.yellow : barW > 33 ? colors.accent : colors.accentSoft,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                </div>
              </div>
              {isSelected && (
                <div
                  style={{
                    background: colors.bg,
                    borderBottom: `1px solid ${colors.border}`,
                    padding: '12px 18px 16px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: colors.textMuted,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      marginBottom: 10,
                    }}
                  >
                    Breakdown
                  </div>
                  <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Input tokens', value: fmt(row.pandora_input) },
                      { label: 'Output tokens', value: fmt(row.pandora_output) },
                      {
                        label: 'Avg tokens / call',
                        value: fmt(Math.round(pandoraTotal / Math.max(row.calls, 1))),
                      },
                      { label: 'Total calls', value: String(row.calls) },
                    ].map((s) => (
                      <div key={s.label}>
                        <div style={{ fontSize: 9, color: colors.textMuted, letterSpacing: '0.1em', marginBottom: 3 }}>
                          {s.label}
                        </div>
                        <div style={{ fontSize: 14, color: colors.textSecondary }}>{s.value}</div>
                      </div>
                    ))}
                    {byokTotal > 0 && (
                      <div
                        style={{
                          marginLeft: 'auto',
                          paddingLeft: 24,
                          borderLeft: `1px solid ${colors.border}`,
                        }}
                      >
                        <div style={{ fontSize: 9, color: colors.green, letterSpacing: '0.1em', marginBottom: 3 }}>
                          BYOK tokens
                        </div>
                        <div style={{ fontSize: 14, color: colors.green }}>{fmt(byokTotal)}</div>
                        <div style={{ fontSize: 9, color: colors.greenSoft, marginTop: 2 }}>
                          Est. ~${row.byok_cost.toFixed(3)} — billed to customer key
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Totals */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 70px 90px 90px 90px 90px 56px',
            padding: '11px 18px',
            borderTop: `2px solid ${colors.border}`,
            background: colors.bg,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 10, color: colors.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Total
          </span>
          <span style={{ ...cellStyle, color: colors.textSecondary }}>{totals.calls}</span>
          <span style={{ ...cellStyle, color: colors.accent }}>{fmt(totals.pandora_input + totals.pandora_output)}</span>
          <span style={{ ...cellStyle, color: colors.yellow, fontWeight: 600 }}>
            ${totals.pandora_cost.toFixed(2)}
          </span>
          <span style={{ ...cellStyle, color: colors.yellow }}>
            {fmtCost(totals.pandora_cost / Math.max(totals.calls, 1))}
          </span>
          <span style={{ ...cellStyle, color: colors.green }}>
            {totals.byok_input > 0 ? fmt(totals.byok_input + totals.byok_output) : '—'}
          </span>
          <span />
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 9, color: colors.textMuted, letterSpacing: '0.08em' }}>
        Pandora cost = tokens consumed via Pandora's infrastructure key. BYOK cost = tokens consumed via
        customer-provided key, estimated at standard provider rates for visibility only — Pandora does not bill for
        BYOK usage.
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { useInvestigationHistory } from '../hooks/useInvestigationHistory';
import InvestigationTimelineChart from '../components/investigation/InvestigationTimelineChart';
import InvestigationHistoryTable from '../components/investigation/InvestigationHistoryTable';
import InvestigationResults from '../components/assistant/InvestigationResults';
import type { InvestigationRun } from '../hooks/useInvestigationHistory';

const SKILL_OPTIONS = [
  { value: '', label: 'All Skills' },
  { value: 'deal-risk-review', label: 'Deal Risk Review' },
  { value: 'data-quality-audit', label: 'Data Quality Audit' },
  { value: 'forecast-rollup', label: 'Forecast Rollup' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'completed_with_errors', label: 'Completed w/ Errors' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
];

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 7,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
  fontSize: 13,
  fontFamily: fonts.sans,
  cursor: 'pointer',
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 7,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
  fontSize: 13,
  fontFamily: fonts.sans,
  outline: 'none',
  colorScheme: 'dark',
};

export default function InvestigationHistoryPage() {
  const navigate = useNavigate();

  const [skillId, setSkillId] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedRun, setSelectedRun] = useState<InvestigationRun | null>(null);

  const filters = { skillId, status, fromDate, toDate };
  const { runs, pagination, loading, error, setPage, offset } = useInvestigationHistory(filters, 20);

  function clearFilters() {
    setSkillId('');
    setStatus('');
    setFromDate('');
    setToDate('');
  }

  const hasFilters = skillId || status || fromDate || toDate;

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.bg,
      fontFamily: fonts.sans,
      color: colors.text,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 7,
              border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textSecondary,
              fontSize: 13, cursor: 'pointer', fontFamily: fonts.sans,
            }}
          >
            ← Back
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: colors.text }}>
              Investigation History
            </h1>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              Full audit trail of all investigation runs
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.textMuted, marginRight: 4 }}>
            FILTERS
          </div>

          <select
            value={skillId}
            onChange={e => setSkillId(e.target.value)}
            style={selectStyle}
          >
            {SKILL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            style={selectStyle}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            placeholder="From date"
            style={{ ...inputStyle, width: 140 }}
          />
          <span style={{ color: colors.textMuted, fontSize: 12 }}>to</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            placeholder="To date"
            style={{ ...inputStyle, width: 140 }}
          />

          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                padding: '6px 12px', borderRadius: 7,
                border: `1px solid ${colors.border}`,
                background: 'transparent', color: colors.textSecondary,
                fontSize: 12, cursor: 'pointer', fontFamily: fonts.sans,
                marginLeft: 4,
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {skillId && (
          <InvestigationTimelineChart skillId={skillId} days={30} />
        )}

        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            color: '#ef4444', fontSize: 13, marginBottom: 16,
          }}>
            Failed to load history: {error}
          </div>
        )}

        <InvestigationHistoryTable
          runs={runs}
          pagination={pagination}
          loading={loading}
          onPageChange={newOffset => setPage(newOffset)}
          onRowClick={run => setSelectedRun(run)}
          selectedRunId={selectedRun?.runId}
        />
      </div>

      {selectedRun && (
        <InvestigationResults
          skillId={selectedRun.skillId}
          runId={selectedRun.runId}
          completedAt={selectedRun.completedAt ?? undefined}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  );
}

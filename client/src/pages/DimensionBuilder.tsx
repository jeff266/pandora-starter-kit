import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useIsMobile } from '../hooks/useIsMobile';
import { Icon } from '../components/icons';

interface FilterCondition {
  field: string;
  operator: string;
  value: any;
}

interface FilterConditionGroup {
  operator: 'AND' | 'OR';
  conditions: (FilterCondition | FilterConditionGroup)[];
}

interface NamedFilter {
  id: string;
  label: string;
  description?: string;
  object: string;
  conditions: FilterConditionGroup;
  is_dimension?: boolean;
  dimension_group?: string;
  dimension_group_label?: string;
  dimension_order?: number;
  usage_count?: number;
}

interface DimensionGroup {
  id: string;
  label: string;
  options: NamedFilter[];
}

export default function DimensionBuilder() {
  const isMobile = useIsMobile();
  const [dimensions, setDimensions] = useState<DimensionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDimensions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/filters/dimensions');
      // The endpoint returns dimensions in a format we can use
      setDimensions(res.dimensions || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load dimensions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDimensions();
  }, [fetchDimensions]);

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 1000, margin: '0 auto', fontFamily: fonts.sans }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: '0 0 8px' }}>
          Dimension Builder
        </h1>
        <p style={{ fontSize: 14, color: colors.textSecondary, maxWidth: 600 }}>
          Define high-level business segments (like Region or Customer Tier) that the AI can use to filter and group data.
        </p>
      </div>

      {error && (
        <div style={{ padding: 16, background: colors.redSoft, color: colors.red, borderRadius: 8, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: colors.textSecondary }}>Loading dimensions...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {dimensions.map(dim => (
            <DimensionGroupCard key={dim.id} dimension={dim} onRefresh={fetchDimensions} />
          ))}

          {dimensions.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', background: colors.surface, border: `1px dashed ${colors.border}`, borderRadius: 12 }}>
              <p style={{ color: colors.textSecondary }}>No custom dimensions defined yet.</p>
            </div>
          )}
          
          <button
            style={{
              padding: '12px 24px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              alignSelf: 'flex-start'
            }}
            onClick={() => {/* Open modal for new group */}}
          >
            + Create Dimension Group
          </button>
        </div>
      )}
    </div>
  );
}

function DimensionGroupCard({ dimension, onRefresh }: { dimension: DimensionGroup; onRefresh: () => void }) {
  // Simplification for now, would need full implementation of adding/editing
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', background: colors.surfaceRaised, borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{dimension.label}</h2>
        <span style={{ fontSize: 12, color: colors.textDim, fontFamily: fonts.mono }}>ID: {dimension.id}</span>
      </div>
      <div style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.textSecondary, borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>Option Label</th>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>Filter ID</th>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>Usage (Week)</th>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dimension.options.map((opt: any) => (
              <tr key={opt.value} style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
                <td style={{ padding: '12px 20px', fontWeight: 500 }}>{opt.label}</td>
                <td style={{ padding: '12px 20px', color: colors.textDim, fontFamily: fonts.mono }}>{opt.filter_id || 'builtin'}</td>
                <td style={{ padding: '12px 20px' }}>
                  {opt.usage_count || 0} times
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <button style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: 12, marginRight: 12 }}>Edit</button>
                  <button style={{ background: 'none', border: 'none', color: colors.red, cursor: 'pointer', fontSize: 12 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '12px 20px' }}>
        <button style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
          + Add Option
        </button>
      </div>
    </div>
  );
}

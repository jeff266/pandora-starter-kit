import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type ChartType = 'bar' | 'horizontalBar' | 'line' | 'pie' | 'doughnut';

interface ChartSuggestion {
  section_id: string;
  chart_type: ChartType;
  title: string;
  data_labels: string[];
  data_values: number[];
  reasoning: string;
  priority: number;
}

interface ReportChart {
  id: string;
  section_id: string;
  chart_type: ChartType;
  title: string;
  data_labels: string[];
  data_values: number[];
  position_in_section: number;
  created_at: string;
  updated_at: string;
}

interface ChartSuggestionPanelProps {
  workspaceId: string;
  reportDocumentId: string;
  sectionId: string;
  token: string;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar',           label: 'Bar' },
  { value: 'horizontalBar', label: 'Horizontal' },
  { value: 'line',          label: 'Line' },
  { value: 'doughnut',      label: 'Donut' },
];

function formatValue(v: number): string {
  if (v >= 1_000_000) return '$' + Math.round(v / 1_000_000) + 'M';
  if (v >= 1_000)     return '$' + Math.round(v / 1_000) + 'K';
  return String(v);
}

const EMPTY_ROWS = () => [
  { label: '', value: '' },
  { label: '', value: '' },
  { label: '', value: '' },
];

export default function ChartSuggestionPanel({
  workspaceId,
  reportDocumentId,
  sectionId,
  token,
}: ChartSuggestionPanelProps) {
  const navigate = useNavigate();
  const [suggestion, setSuggestion] = useState<ChartSuggestion | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [acceptedChart, setAcceptedChart] = useState<ReportChart | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedType, setSelectedType] = useState<ChartType | null>(null);
  const prevPreviewUrl = useRef<string | null>(null);

  // Manual form state
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState<ChartType>('bar');
  const [manualRows, setManualRows] = useState(EMPTY_ROWS());
  const [creating, setCreating] = useState(false);

  const base = `/api/workspaces/${workspaceId}/reports/${reportDocumentId}`;
  const authHeader = { Authorization: `Bearer ${token}` };

  async function loadChartImage(chartId: string): Promise<string> {
    const res = await fetch(`${base}/charts/${chartId}/image`, { headers: authHeader });
    if (!res.ok) throw new Error('Image fetch failed');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  function revokeUrl(url: string | null) {
    if (url) URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [sugRes, chartRes] = await Promise.all([
          fetch(`${base}/chart-suggestions`, { headers: authHeader }),
          fetch(`${base}/charts`, { headers: authHeader }),
        ]);

        const suggestions: ChartSuggestion[] = await sugRes.json();
        const { charts }: { charts: ReportChart[] } = await chartRes.json();

        if (cancelled) return;

        const match = Array.isArray(suggestions)
          ? suggestions.find(s => s.section_id === sectionId) ?? null
          : null;
        if (match) {
          setSuggestion(match);
          setSelectedType(match.chart_type);
        }

        const accepted = Array.isArray(charts)
          ? charts.find(c => c.section_id === sectionId) ?? null
          : null;
        if (accepted) {
          setAcceptedChart(accepted);
          setSelectedType(accepted.chart_type);
          const url = await loadChartImage(accepted.id);
          if (!cancelled) {
            revokeUrl(prevPreviewUrl.current);
            prevPreviewUrl.current = url;
            setPreviewUrl(url);
          } else {
            revokeUrl(url);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reportDocumentId, sectionId]);

  useEffect(() => {
    return () => { revokeUrl(prevPreviewUrl.current); };
  }, []);

  // Post a chart from the AI suggestion (for Add to report + type switching)
  async function postChart(chartType: ChartType) {
    if (!suggestion && !acceptedChart) return null;
    const src = suggestion ?? acceptedChart!;
    const res = await fetch(`${base}/charts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        section_id: sectionId,
        chart_type: chartType,
        title: src.title,
        data_labels: src.data_labels,
        data_values: src.data_values,
      }),
    });
    if (!res.ok) throw new Error('Chart POST failed');
    const { chart } = await res.json();
    return chart as ReportChart;
  }

  async function handleAddToReport() {
    if (!suggestion) return;
    setAdding(true);
    try {
      const chart = await postChart(selectedType ?? suggestion.chart_type);
      if (!chart) return;
      setAcceptedChart(chart);
      setSelectedType(chart.chart_type);
      const url = await loadChartImage(chart.id);
      revokeUrl(prevPreviewUrl.current);
      prevPreviewUrl.current = url;
      setPreviewUrl(url);
    } finally {
      setAdding(false);
    }
  }

  async function handleChangeType(newType: ChartType) {
    if (!acceptedChart && !suggestion) return;
    setSelectedType(newType);
    setAdding(true);
    try {
      const chart = await postChart(newType);
      if (!chart) return;
      setAcceptedChart(chart);
      setSelectedType(chart.chart_type);
      const url = await loadChartImage(chart.id);
      revokeUrl(prevPreviewUrl.current);
      prevPreviewUrl.current = url;
      setPreviewUrl(url);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove() {
    if (!acceptedChart) return;
    await fetch(`${base}/charts/${acceptedChart.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    setAcceptedChart(null);
    revokeUrl(previewUrl);
    prevPreviewUrl.current = null;
    setPreviewUrl(null);
    if (suggestion) setSelectedType(suggestion.chart_type);
  }

  // Manual chart creation
  function addRow() {
    setManualRows(r => [...r, { label: '', value: '' }]);
  }
  function removeRow(i: number) {
    setManualRows(r => r.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, field: 'label' | 'value', val: string) {
    setManualRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }

  async function handleManualCreate() {
    const validRows = manualRows.filter(
      r => r.label.trim() && r.value.trim() && !isNaN(Number(r.value))
    );
    if (!manualTitle.trim() || validRows.length < 2) return;
    setCreating(true);
    try {
      const res = await fetch(`${base}/charts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          section_id: sectionId,
          chart_type: manualType,
          title: manualTitle.trim(),
          data_labels: validRows.map(r => r.label.trim()),
          data_values: validRows.map(r => Number(r.value)),
        }),
      });
      if (!res.ok) throw new Error('Chart POST failed');
      const { chart } = await res.json();
      setAcceptedChart(chart);
      setSelectedType(manualType);
      setShowManualForm(false);
      setManualTitle('');
      setManualRows(EMPTY_ROWS());
      const url = await loadChartImage(chart.id);
      revokeUrl(prevPreviewUrl.current);
      prevPreviewUrl.current = url;
      setPreviewUrl(url);
    } finally {
      setCreating(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#94A3B8' }}>Loading chart...</span>
      </div>
    );
  }

  // Accepted chart — show image + type switcher + remove
  if (acceptedChart && previewUrl) {
    return (
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        {adding && (
          <div style={{
            height: 180,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#F8FAFC', borderRadius: 4, marginBottom: 8,
          }}>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>Re-rendering...</span>
          </div>
        )}
        {!adding && (
          <img
            src={previewUrl}
            alt={acceptedChart.title}
            style={{ width: '100%', maxWidth: 520, height: 'auto', display: 'block', borderRadius: 4 }}
          />
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94A3B8', flex: 1 }}>
            {acceptedChart.title}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {CHART_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => handleChangeType(t.value)}
                disabled={adding}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '0.5px solid',
                  borderColor: selectedType === t.value ? '#0D9488' : '#E2E8F0',
                  background: selectedType === t.value ? '#F0FDF9' : 'white',
                  color: selectedType === t.value ? '#0D9488' : '#64748B',
                  cursor: adding ? 'not-allowed' : 'pointer',
                  opacity: adding ? 0.6 : 1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRemove}
            disabled={adding}
            style={{
              background: 'none', border: 'none',
              fontSize: 11, color: '#94A3B8',
              cursor: 'pointer', padding: '2px 6px',
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // AI suggestion exists — full card or collapsed strip
  if (suggestion) {
    if (collapsed) {
      return (
        <div style={{
          marginTop: 8, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>📊</span>
          <span style={{ fontSize: 11, color: '#64748B' }}>
            Suggested: "{suggestion.title}"
          </span>
          <button
            onClick={() => setCollapsed(false)}
            style={{
              background: 'none', border: 'none',
              fontSize: 11, color: '#0D9488',
              cursor: 'pointer', padding: 0,
            }}
          >
            expand ▾
          </button>
        </div>
      );
    }

    const labels = Array.isArray(suggestion.data_labels) ? suggestion.data_labels : [];
    const values = Array.isArray(suggestion.data_values) ? suggestion.data_values : [];

    return (
      <div style={{
        marginTop: 16, marginBottom: 16,
        border: '0.5px solid #E2E8F0',
        borderRadius: 8, overflow: 'hidden',
        background: '#FAFAFA',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '0.5px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>
            Suggested chart
          </span>
          <button
            onClick={() => setCollapsed(true)}
            style={{
              background: 'none', border: 'none',
              fontSize: 14, color: '#94A3B8',
              cursor: 'pointer', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
            "{suggestion.title}"
            <span style={{ color: '#94A3B8', marginLeft: 6 }}>
              · {suggestion.chart_type.replace('Bar', ' bar')}
            </span>
          </div>

          <div style={{ marginBottom: 12 }}>
            {labels.slice(0, 4).map((label, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: '#64748B', padding: '2px 0',
              }}>
                <span>{label}</span>
                <span style={{ fontWeight: 500, color: '#374151' }}>
                  {formatValue(values[i] ?? 0)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {CHART_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setSelectedType(t.value)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '0.5px solid',
                  borderColor: selectedType === t.value ? '#0D9488' : '#E2E8F0',
                  background: selectedType === t.value ? '#F0FDF9' : 'white',
                  color: selectedType === t.value ? '#0D9488' : '#64748B',
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleAddToReport}
              disabled={adding}
              style={{
                flex: 1,
                padding: '7px 0',
                fontSize: 13,
                fontWeight: 500,
                background: adding ? '#F0FDF9' : '#0D9488',
                color: adding ? '#0D9488' : 'white',
                border: adding ? '0.5px solid #0D9488' : 'none',
                borderRadius: 6,
                cursor: adding ? 'not-allowed' : 'pointer',
              }}
            >
              {adding ? 'Adding...' : 'Add to report'}
            </button>
            <button
              onClick={() => navigate('/assistant', { state: { openChatWithMessage: `Tell me more about: ${suggestion.title}` } })}
              title="Explore in Ask Pandora"
              style={{
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 500,
                background: 'none',
                border: '0.5px solid #CBD5E1',
                borderRadius: 6,
                color: '#64748B',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Explore ↗
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No suggestion, no accepted chart — show "+ Add chart" or manual form
  return (
    <div style={{ marginTop: 8, marginBottom: 16 }}>
      {!showManualForm ? (
        <button
          onClick={() => setShowManualForm(true)}
          style={{
            background: 'none', border: 'none',
            fontSize: 12, color: '#94A3B8',
            cursor: 'pointer', padding: 0,
          }}
        >
          + Add chart
        </button>
      ) : (
        <div style={{
          border: '0.5px solid #E2E8F0',
          borderRadius: 8,
          background: '#FAFAFA',
          padding: 16,
        }}>
          {/* Title */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>
              Chart title
            </label>
            <input
              value={manualTitle}
              onChange={e => setManualTitle(e.target.value)}
              placeholder="e.g. Pipeline by rep ($K)"
              style={{
                width: '100%', boxSizing: 'border-box',
                fontSize: 12, padding: '6px 8px',
                border: '0.5px solid #E2E8F0', borderRadius: 4,
                outline: 'none', background: 'white',
              }}
            />
          </div>

          {/* Type selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>
              Chart type
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {CHART_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setManualType(t.value)}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 4,
                    border: '0.5px solid',
                    borderColor: manualType === t.value ? '#0D9488' : '#E2E8F0',
                    background: manualType === t.value ? '#F0FDF9' : 'white',
                    color: manualType === t.value ? '#0D9488' : '#64748B',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data rows */}
          <div style={{ marginBottom: 12 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 24px',
              gap: 6, marginBottom: 4,
            }}>
              <span style={{ fontSize: 11, color: '#64748B' }}>Label</span>
              <span style={{ fontSize: 11, color: '#64748B' }}>Value</span>
              <span />
            </div>
            {manualRows.map((row, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 24px',
                gap: 6, marginBottom: 6,
              }}>
                <input
                  value={row.label}
                  onChange={e => updateRow(i, 'label', e.target.value)}
                  placeholder="e.g. Rep 1"
                  style={{
                    fontSize: 12, padding: '5px 8px',
                    border: '0.5px solid #E2E8F0', borderRadius: 4,
                    outline: 'none',
                  }}
                />
                <input
                  value={row.value}
                  onChange={e => updateRow(i, 'value', e.target.value)}
                  placeholder="256"
                  type="number"
                  style={{
                    fontSize: 12, padding: '5px 8px',
                    border: '0.5px solid #E2E8F0', borderRadius: 4,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => removeRow(i)}
                  disabled={manualRows.length <= 2}
                  style={{
                    background: 'none', border: 'none',
                    color: '#94A3B8',
                    cursor: manualRows.length <= 2 ? 'not-allowed' : 'pointer',
                    fontSize: 16, padding: 0, lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addRow}
              style={{
                background: 'none', border: 'none',
                fontSize: 12, color: '#0D9488',
                cursor: 'pointer', padding: 0, marginTop: 2,
              }}
            >
              + Add row
            </button>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => {
                setShowManualForm(false);
                setManualTitle('');
                setManualRows(EMPTY_ROWS());
              }}
              style={{
                background: 'none', border: '0.5px solid #E2E8F0',
                borderRadius: 6, padding: '6px 12px',
                fontSize: 12, color: '#64748B', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleManualCreate}
              disabled={
                creating ||
                !manualTitle.trim() ||
                manualRows.filter(r => r.label.trim() && !isNaN(Number(r.value))).length < 2
              }
              style={{
                background: creating ? '#F0FDF9' : '#0D9488',
                border: 'none', borderRadius: 6,
                padding: '6px 16px', fontSize: 12,
                fontWeight: 500,
                color: creating ? '#0D9488' : 'white',
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Creating...' : 'Create chart'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

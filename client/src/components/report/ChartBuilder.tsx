import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DATA_SOURCES, extractField, type DataSourceDef, type DataSourceField } from '../../lib/chartDataSources';
import { resolveColor } from '../../lib/chartColors';

type BuilderView = 'pick_source' | 'pick_field' | 'refine';
type ChartTypeOption = 'bar' | 'horizontal_bar' | 'line' | 'donut';
type NumberFormat = 'K' | 'M' | 'raw' | 'pct';
type ColorScheme = 'semantic' | 'uniform' | 'categorical';

interface Validation {
  type: 'error' | 'warning';
  message: string;
  action?: { label: string; fn: () => void };
}

interface AvailableSource {
  skill_id: string;
  run_id: string;
  created_at: string;
  record_count: number;
}

interface ChartBuilderProps {
  workspaceId: string;
  reportDocumentId: string;
  sectionId: string;
  token: string;
  existingChart?: any;
  onInsert: (chart: any) => void;
  onCancel: () => void;
}

function formatValue(val: number | string, format: NumberFormat, type: string): string {
  if (type === 'string' || type === 'category') return String(val);
  const n = Number(val);
  if (format === 'K') return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
  if (format === 'M') return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
  if (format === 'pct') return `${n.toFixed(1)}%`;
  return n.toLocaleString();
}

function getSemanticTag(record: any, source: DataSourceDef): string {
  if (source.id === 'at_risk_deals') {
    const score = Number(record.fields?.risk_score || 0);
    if (score > 80) return 'dead';
    if (score > 60) return 'at_risk';
    return 'healthy';
  }
  if (source.id === 'stale_deals') {
    const days = record.fields?.days_since_activity || 0;
    if (days > 100) return 'dead';
    if (days > 30) return 'at_risk';
    return 'healthy';
  }
  if (source.id === 'forecast_pipeline') {
    const cat = record.fields?.forecast_category;
    if (cat === 'closed' || cat === 'commit') return 'positive';
    if (cat === 'best_case') return 'at_risk';
    return 'neutral';
  }
  return 'neutral';
}

function suggestTitle(source: DataSourceDef, field: DataSourceField): string {
  const fieldLabel = field.label.replace(' ($K)', '').replace(' (%)', '');
  if (source.id === 'at_risk_deals') return `Top at-risk deals by ${fieldLabel.toLowerCase()}`;
  if (source.id === 'stale_deals') return `Stale deals by ${fieldLabel.toLowerCase()}`;
  if (source.id === 'pipeline_by_rep') return `${fieldLabel} by rep`;
  if (source.id === 'forecast_pipeline') return `Forecast pipeline by ${fieldLabel.toLowerCase()}`;
  return `${source.label} — ${fieldLabel}`;
}

const BAR_HEIGHTS = [62, 38, 85, 50, 72, 42];

function ChartSkeleton({ label }: { label: string }) {
  const shimmer: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    background: '#E9EEF4',
  };
  return (
    <div style={{ height: 208, borderRadius: 8, overflow: 'hidden', background: '#F8FAFC', position: 'relative', flexShrink: 0 }}>
      {/* Y-axis tick lines */}
      {[25, 50, 75].map(pct => (
        <div key={pct} style={{
          position: 'absolute',
          bottom: `${24 + pct * 0.62}px`,
          left: 0, right: 0,
          height: 1,
          background: '#EEF2F7',
        }} />
      ))}
      {/* Bars */}
      <div style={{ position: 'absolute', bottom: 28, left: 16, right: 16, top: 20, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="cb-shimmer"
            style={{
              ...shimmer,
              flex: 1,
              height: `${h}%`,
              borderRadius: '3px 3px 0 0',
            }}
          />
        ))}
      </div>
      {/* X-axis baseline */}
      <div style={{ position: 'absolute', bottom: 28, left: 16, right: 16, height: 1, background: '#DDE3EC' }} />
      {/* Label chips below bars */}
      <div style={{ position: 'absolute', bottom: 10, left: 16, right: 16, display: 'flex', gap: 6 }}>
        {BAR_HEIGHTS.map((_, i) => (
          <div
            key={i}
            className="cb-shimmer"
            style={{ ...shimmer, flex: 1, height: 8, borderRadius: 3 }}
          />
        ))}
      </div>
      {/* Status label centered */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{ fontSize: 11, color: '#94A3B8', background: 'rgba(248,250,252,0.85)', padding: '3px 8px', borderRadius: 4 }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export default function ChartBuilder({
  workspaceId,
  reportDocumentId,
  sectionId,
  token,
  existingChart,
  onInsert,
  onCancel,
}: ChartBuilderProps) {
  const [view, setView] = useState<BuilderView>('pick_source');
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<DataSourceDef | null>(null);
  const [selectedField, setSelectedField] = useState<DataSourceField | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [chartTitle, setChartTitle] = useState('');
  const [chartType, setChartType] = useState<ChartTypeOption>('bar');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('uniform');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(6);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('K');
  const [showLegend, setShowLegend] = useState(false);

  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [inserting, setInserting] = useState(false);

  const authHeader = { Authorization: `Bearer ${token}` };
  const base = `/api/workspaces/${workspaceId}`;

  useEffect(() => {
    fetch(`${base}/chart-data/sources`, { headers: authHeader })
      .then(r => r.json())
      .then(data => setAvailableSources(data.sources || []))
      .catch(err => console.error('[ChartBuilder] Sources error:', err))
      .finally(() => setSourcesLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    if (existingChart?.builder_config && view === 'pick_source') {
      const cfg = existingChart.builder_config;
      const src = DATA_SOURCES.find(s => s.id === cfg.source_id);
      if (src) {
        const fld = src.fields.find(f => f.key === cfg.field_key);
        if (fld) {
          setSelectedSource(src);
          setSelectedField(fld);
          setChartTitle(existingChart.title || '');
          setChartType(cfg.chart_type || src.defaultChartType);
          setColorScheme(cfg.color_scheme || src.defaultColorScheme);
          setSortField(cfg.sort_field || src.defaultSort.field);
          setSortDir(cfg.sort_dir || src.defaultSort.dir);
          setLimit(cfg.limit || 6);
          setNumberFormat(cfg.number_format || 'K');
          setShowLegend(cfg.show_legend || false);
          loadRecords(src).then(() => setView('refine'));
        }
      }
    }
  }, [existingChart]);

  async function loadRecords(src: DataSourceDef): Promise<any[]> {
    setRecordsLoading(true);
    try {
      const res = await fetch(`${base}/chart-data/${src.skillId}`, { headers: authHeader });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const recs = data.records || [];
      setRecords(recs);
      return recs;
    } catch (err) {
      console.error('[ChartBuilder] Records error:', err);
      return [];
    } finally {
      setRecordsLoading(false);
    }
  }

  async function selectSourceAndField(src: DataSourceDef, fld: DataSourceField) {
    setSelectedSource(src);
    setSelectedField(fld);
    setChartType(src.defaultChartType);
    setColorScheme(src.defaultColorScheme as ColorScheme);
    setSortField(src.defaultSort.field);
    setSortDir(src.defaultSort.dir);
    setShowLegend(src.defaultChartType === 'donut');
    setChartTitle(suggestTitle(src, fld));
    await loadRecords(src);
    setView('refine');
    setTimeout(() => triggerPreview(src, fld), 100);
  }

  const filteredRecords = useMemo(() => {
    if (!selectedField || !selectedSource) return [];
    const sf = sortField || selectedSource.defaultSort.field;
    const sfDef = selectedSource.fields.find(f => f.key === sf) || selectedField;
    return [...records]
      .sort((a, b) => {
        const av = Number(extractField(a, sf, sfDef));
        const bv = Number(extractField(b, sf, sfDef));
        return sortDir === 'desc' ? bv - av : av - bv;
      })
      .slice(0, limit);
  }, [records, selectedField, selectedSource, sortField, sortDir, limit]);

  function mapChartType(ct: ChartTypeOption): string {
    if (ct === 'horizontal_bar') return 'horizontalBar';
    if (ct === 'donut') return 'doughnut';
    return ct;
  }

  function buildChartSpec() {
    if (!selectedSource || !selectedField) return null;
    const dataPoints = filteredRecords.map(r => ({
      label: String(r.entity_name || r[selectedSource.nameField] || '').split(' - ')[0].trim(),
      value: Math.round(
        Number(extractField(r, selectedField.key, selectedField)) /
        (numberFormat === 'K' ? 1000 : numberFormat === 'M' ? 1_000_000 : 1)
      ),
      semantic_tag: getSemanticTag(r, selectedSource),
    }));
    return {
      should_chart: true,
      chart_type: mapChartType(chartType),
      title: chartTitle,
      data_points: dataPoints,
      color_scheme: colorScheme,
      show_legend: showLegend,
    };
  }

  const triggerPreview = useCallback(
    async (src?: DataSourceDef, fld?: DataSourceField) => {
      const useSrc = src || selectedSource;
      const useFld = fld || selectedField;
      if (!useSrc || !useFld) return;
      setPreviewLoading(true);
      try {
        const spec = buildChartSpec();
        if (!spec) return;
        const res = await fetch(`${base}/charts/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ spec }),
        });
        if (!res.ok) throw new Error(`Preview ${res.status}`);
        const data = await res.json();
        setPreviewPng(data.png_base64);
      } catch (err) {
        console.error('[ChartBuilder] Preview error:', err);
      } finally {
        setPreviewLoading(false);
      }
    },
    [selectedSource, selectedField, filteredRecords, chartType, colorScheme, showLegend, numberFormat, chartTitle, base, token]
  );

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  function debouncedPreview() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerPreview(), 500);
  }

  function runValidations(): Validation[] {
    const v: Validation[] = [];
    if (!chartTitle.trim()) v.push({ type: 'error', message: 'Chart title is required.' });
    if (chartTitle.trim().endsWith('?')) {
      v.push({
        type: 'warning',
        message: 'Chart titles should state a conclusion, not ask a question.',
        action: { label: 'Remove ?', fn: () => setChartTitle(chartTitle.trim().slice(0, -1)) },
      });
    }
    if (chartType === 'line' && filteredRecords.length < 3) {
      v.push({
        type: 'error',
        message: 'Line charts need 3+ data points to show a meaningful trend.',
        action: { label: 'Switch to bar', fn: () => { setChartType('bar'); debouncedPreview(); } },
      });
    }
    if (chartType === 'donut' && filteredRecords.length > 5) {
      v.push({
        type: 'warning',
        message: `Donut with ${filteredRecords.length} segments is hard to read. Showing top 5 is cleaner.`,
        action: { label: 'Limit to 5', fn: () => setLimit(5) },
      });
    }
    if (selectedField?.type === 'currency' && numberFormat === 'pct') {
      v.push({
        type: 'error',
        message: "Percentage format doesn't make sense for currency values.",
        action: { label: 'Switch to $K', fn: () => { setNumberFormat('K'); debouncedPreview(); } },
      });
    }
    if (selectedField?.key.includes('coverage_ratio') || selectedField?.key.includes('gap_to_quota')) {
      v.push({ type: 'warning', message: 'Revenue targets not configured — this chart will show 0 values.' });
    }
    return v;
  }

  async function handleInsert() {
    if (!selectedSource || !selectedField) return;
    setInserting(true);
    try {
      const spec = buildChartSpec();
      const builderConfig = {
        source_id: selectedSource.id,
        field_key: selectedField.key,
        chart_type: chartType,
        color_scheme: colorScheme,
        sort_field: sortField,
        sort_dir: sortDir,
        limit,
        number_format: numberFormat,
        show_legend: showLegend,
      };
      const chartVersion = existingChart ? (existingChart.version || 1) + 1 : 1;
      const res = await fetch(`${base}/reports/${reportDocumentId}/charts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          section_id: sectionId,
          chart_type: chartType === 'horizontal_bar' ? 'horizontalBar' : chartType === 'donut' ? 'doughnut' : chartType,
          title: chartTitle,
          data_labels: filteredRecords.map(r =>
            String(r.entity_name || r[selectedSource.nameField] || '').split(' - ')[0].trim()
          ),
          data_values: filteredRecords.map(r =>
            Math.round(
              Number(extractField(r, selectedField.key, selectedField)) /
              (numberFormat === 'K' ? 1000 : numberFormat === 'M' ? 1_000_000 : 1)
            )
          ),
          chart_options: { color_scheme: colorScheme, number_format: numberFormat, show_legend: showLegend },
          chart_spec: spec,
          builder_config: builderConfig,
          version: chartVersion,
        }),
      });
      if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
      const saved = await res.json();
      onInsert(saved.chart || saved);
    } catch (err) {
      console.error('[ChartBuilder] Insert error:', err);
    } finally {
      setInserting(false);
    }
  }

  const validations = runValidations();
  const hasErrors = validations.some(v => v.type === 'error');

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12,
    padding: '7px 10px',
    border: '0.5px solid #E2E8F0',
    borderRadius: 6,
    outline: 'none',
    background: 'white',
    color: '#1E293B',
    fontFamily: 'inherit',
  };

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 0,
      height: '100vh',
      width: 680,
      background: 'white',
      borderLeft: '1px solid #E2E8F0',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
      zIndex: 500,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <style>{`
        @keyframes cb-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .cb-shimmer::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.65) 50%, transparent 100%);
          animation: cb-shimmer 1.4s ease-in-out infinite;
        }
      `}</style>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '0.5px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {view !== 'pick_source' && (
            <button
              onClick={() => {
                if (view === 'refine') setView('pick_field');
                else setView('pick_source');
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748B', padding: '0 4px 0 0' }}
            >
              ←
            </button>
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>
            {view === 'pick_source' ? 'Insert chart' : view === 'pick_field' ? selectedSource?.label : 'Refine chart'}
          </span>
        </div>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94A3B8', padding: 4 }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* VIEW: pick_source */}
        {view === 'pick_source' && (
          <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>
              What do you want to show?
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 16 }}>
              Select a data source from your skills
            </div>
            {sourcesLoading ? (
              <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 24 }}>Loading sources...</div>
            ) : (
              DATA_SOURCES.map(source => {
                const available = availableSources.find(s => s.skill_id === source.skillId);
                const recordCount = available?.record_count || 0;
                const isAvailable = recordCount > 0;
                return (
                  <button
                    key={source.id}
                    onClick={() => isAvailable ? (setSelectedSource(source), setView('pick_field')) : undefined}
                    disabled={!isAvailable}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      padding: '12px 14px',
                      marginBottom: 8,
                      background: isAvailable ? 'white' : '#FAFAFA',
                      border: `0.5px solid ${isAvailable ? '#E2E8F0' : '#F1F5F9'}`,
                      borderRadius: 8,
                      cursor: isAvailable ? 'pointer' : 'not-allowed',
                      opacity: isAvailable ? 1 : 0.5,
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => { if (isAvailable) (e.currentTarget as HTMLElement).style.borderColor = '#0D9488'; }}
                    onMouseLeave={e => { if (isAvailable) (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#1E293B', marginBottom: 2 }}>
                        {source.label}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>{source.description}</div>
                      {source.warnings?.map(w => (
                        <div key={w} style={{ fontSize: 10, color: '#D97706', marginTop: 3 }}>⚠ {w}</div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: isAvailable ? '#0D9488' : '#94A3B8', flexShrink: 0, marginLeft: 12 }}>
                      {isAvailable ? `${recordCount} records` : 'No data'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* VIEW: pick_field */}
        {view === 'pick_field' && selectedSource && (
          <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', marginBottom: 16 }}>
              What value do you want to chart?
            </div>
            {selectedSource.fields.map(field => (
              <button
                key={field.key}
                onClick={() => selectSourceAndField(selectedSource, field)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 14px',
                  marginBottom: 6,
                  background: 'white',
                  border: '0.5px solid #E2E8F0',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  color: '#374151',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#0D9488'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
              >
                {field.label}
                <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 8 }}>{field.type}</span>
              </button>
            ))}
          </div>
        )}

        {/* VIEW: refine */}
        {view === 'refine' && selectedSource && selectedField && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', overflow: 'hidden' }}>

            {/* LEFT: Preview */}
            <div style={{
              padding: 20,
              borderRight: '0.5px solid #E2E8F0',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}>
                Preview
              </div>

              {recordsLoading ? (
                <ChartSkeleton label="Fetching data..." />
              ) : previewLoading ? (
                <ChartSkeleton label="Rendering preview…" />
              ) : previewPng ? (
                <img
                  src={`data:image/png;base64,${previewPng}`}
                  alt="Chart preview"
                  style={{ width: '100%', height: 'auto', borderRadius: 6 }}
                />
              ) : (
                <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 11, background: '#F8FAFC', borderRadius: 6, flexDirection: 'column', gap: 6 }}>
                  <span>No preview yet</span>
                  <button onClick={() => triggerPreview()} style={{ fontSize: 11, color: '#0D9488', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Generate preview →
                  </button>
                </div>
              )}

              {/* Validations */}
              {validations.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {validations.map((v, i) => (
                    <div key={i} style={{
                      padding: '8px 12px',
                      marginBottom: 6,
                      background: v.type === 'error' ? '#FEF2F2' : '#FFFBEB',
                      border: `0.5px solid ${v.type === 'error' ? '#FECACA' : '#FDE68A'}`,
                      borderRadius: 6,
                      fontSize: 11,
                      color: v.type === 'error' ? '#991B1B' : '#92400E',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                    }}>
                      <span>{v.type === 'error' ? '✕' : '⚠'}</span>
                      <div>
                        {v.message}
                        {v.action && (
                          <button
                            onClick={v.action.fn}
                            style={{ marginLeft: 8, color: '#0D9488', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}
                          >
                            {v.action.label}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT: Controls */}
            <div style={{ padding: '20px 20px', overflowY: 'auto' }}>

              {/* Title */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Title</label>
                <input
                  value={chartTitle}
                  onChange={e => { setChartTitle(e.target.value); debouncedPreview(); }}
                  placeholder="State a conclusion..."
                  style={inputStyle}
                />
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>
                  State what the chart proves, not what it shows
                </div>
              </div>

              {/* Chart type */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Chart type</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['bar', 'horizontal_bar', 'line', 'donut'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => { setChartType(type); setShowLegend(type === 'donut'); debouncedPreview(); }}
                      style={{
                        padding: '5px 10px',
                        fontSize: 11,
                        border: `1px solid ${chartType === type ? '#0D9488' : '#E2E8F0'}`,
                        background: chartType === type ? '#F0FDF9' : 'white',
                        color: chartType === type ? '#0D9488' : '#374151',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >
                      {type === 'horizontal_bar' ? 'Horizontal' : type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Series */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Series ({filteredRecords.length} items)</label>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '0.5px solid #E2E8F0', borderRadius: 6 }}>
                  {filteredRecords.map((record, i) => {
                    const name = record.entity_name || record[selectedSource.nameField] || `Item ${i + 1}`;
                    const displayName = String(name).split(' - ')[0].trim();
                    const value = extractField(record, selectedField.key, selectedField);
                    return (
                      <div key={i} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '7px 10px',
                        borderBottom: i < filteredRecords.length - 1 ? '0.5px solid #F8FAFC' : 'none',
                        fontSize: 11,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                            background: resolveColor(record, colorScheme, selectedSource),
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>
                            {displayName}
                          </span>
                        </div>
                        <span style={{ color: '#64748B', flexShrink: 0, marginLeft: 8 }}>
                          {formatValue(value, numberFormat, selectedField.type)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Colors */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Colors</label>
                {(['semantic', 'uniform', 'categorical'] as const).map(scheme => (
                  <label key={scheme} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={colorScheme === scheme}
                      onChange={() => { setColorScheme(scheme); debouncedPreview(); }}
                    />
                    <span>
                      {scheme === 'semantic' ? 'Semantic (red=risk, teal=healthy)' : scheme === 'uniform' ? 'Uniform (all teal)' : 'Categorical (by group)'}
                    </span>
                  </label>
                ))}
              </div>

              {/* Number format */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Number format</label>
                {(['K', 'M', 'raw', 'pct'] as const).map(fmt => (
                  <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={numberFormat === fmt}
                      onChange={() => { setNumberFormat(fmt); debouncedPreview(); }}
                    />
                    <span>
                      {fmt === 'K' ? '$K (e.g. $273K)' : fmt === 'M' ? '$M (e.g. $1.2M)' : fmt === 'pct' ? '% (e.g. 93%)' : 'Raw (e.g. 273,000)'}
                    </span>
                  </label>
                ))}
              </div>

              {/* Sort */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Sort by</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={sortField}
                    onChange={e => { setSortField(e.target.value); debouncedPreview(); }}
                    style={{ flex: 1, ...inputStyle }}
                  >
                    {selectedSource.fields.map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    value={sortDir}
                    onChange={e => { setSortDir(e.target.value as 'asc' | 'desc'); debouncedPreview(); }}
                    style={{ width: 110, ...inputStyle }}
                  >
                    <option value="desc">High → Low</option>
                    <option value="asc">Low → High</option>
                  </select>
                </div>
              </div>

              {/* Limit */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Show top {limit} items</label>
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={limit}
                  onChange={e => { setLimit(Number(e.target.value)); debouncedPreview(); }}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94A3B8' }}>
                  <span>2</span><span>10</span>
                </div>
              </div>

              {/* Legend */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Legend</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={showLegend}
                    onChange={e => { setShowLegend(e.target.checked); debouncedPreview(); }}
                  />
                  Show legend
                </label>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '0.5px solid #E2E8F0' }}>
                <button
                  onClick={onCancel}
                  style={{
                    flex: 1, padding: '8px',
                    background: 'none', border: '0.5px solid #CBD5E1',
                    borderRadius: 6, fontSize: 12, color: '#64748B', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleInsert}
                  disabled={hasErrors || !chartTitle.trim() || inserting}
                  style={{
                    flex: 2, padding: '8px',
                    background: hasErrors || !chartTitle.trim() ? '#CBD5E1' : '#0D9488',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    color: 'white',
                    cursor: hasErrors || !chartTitle.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {inserting ? 'Inserting...' : existingChart ? 'Update chart' : 'Insert chart'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

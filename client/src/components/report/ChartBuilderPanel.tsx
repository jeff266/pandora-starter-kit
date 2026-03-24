import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ChartRenderer from '../shared/ChartRenderer';
import type { ChartSpec, ChartDataPoint, ChartType } from '../../types/chart-types';

interface LiveSchemaField {
  name: string;
  label: string;
  field_type: 'id' | 'categorical' | 'numeric' | 'number' | 'date' | 'text' | 'boolean' | 'email';
}

type AggFunc = 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';
type ColorMode = 'semantic' | 'uniform' | 'categorical';
type NumberFmt = 'raw' | 'currency' | 'km' | 'percent';
type DataLabelPos = 'outside_end' | 'inside_end' | 'center' | 'base';

export interface ChartBuilderPanelProps {
  context: 'inline' | 'modal';
  workspaceId: string;
  sectionId?: string;
  documentId?: string;
  onInsert: (spec: ChartSpec) => void;
  onCancel: () => void;
}

interface ChartTypeConfig {
  type: ChartType;
  label: string;
  requires: 'none' | 'series' | 'second_y' | 'skill_data';
  tooltip?: string;
  icon: string;
}

const CHART_TYPES: ChartTypeConfig[] = [
  { type: 'bar',            label: 'Bar',        requires: 'none',       icon: '▊' },
  { type: 'horizontal_bar', label: 'Horizontal',  requires: 'none',       icon: '▬' },
  { type: 'line',           label: 'Line',        requires: 'none',       icon: '╱' },
  { type: 'donut',          label: 'Donut',       requires: 'none',       icon: '◎' },
  { type: 'funnel',         label: 'Funnel',      requires: 'none',       icon: '⌥' },
  { type: 'stacked_bar',    label: 'Stacked',     requires: 'series',     icon: '▤', tooltip: 'Add a series dimension above' },
  { type: 'heatmap',        label: 'Heatmap',     requires: 'series',     icon: '▦', tooltip: 'Add a series dimension above' },
  { type: 'combo',          label: 'Combo',       requires: 'second_y',   icon: '⧈', tooltip: 'Add a second Y axis above' },
  { type: 'scatter',        label: 'Scatter',     requires: 'second_y',   icon: '⋯', tooltip: 'Add a second Y axis above' },
  { type: 'waterfall',      label: 'Waterfall',   requires: 'skill_data', icon: '▟', tooltip: 'Use Skills tab — requires computed data' },
  { type: 'bullet',         label: 'Bullet',      requires: 'skill_data', icon: '▷', tooltip: 'Use Skills tab — requires target data' },
];

const TYPE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  numeric:     { bg: '#EEF2FF', color: '#4338CA', label: 'NUM' },
  number:      { bg: '#EEF2FF', color: '#4338CA', label: 'NUM' },
  text:        { bg: '#F0FDF4', color: '#166534', label: 'TXT' },
  categorical: { bg: '#F0FDF4', color: '#166534', label: 'TXT' },
  date:        { bg: '#FFF7ED', color: '#C2410C', label: 'DAT' },
  boolean:     { bg: '#FDF4FF', color: '#7E22CE', label: 'BOOL' },
  email:       { bg: '#EFF6FF', color: '#1D4ED8', label: 'EMAIL' },
  id:          { bg: '#F1F5F9', color: '#64748B', label: 'ID' },
};

const FIELD_PICKER_TOP_N = 5;

interface FieldPickerProps {
  label: string;
  fields: LiveSchemaField[];
  fillRates: Record<string, number>;
  selected: string | null;
  onChange: (name: string | null) => void;
  numericOnly?: boolean;
  optional?: boolean;
  hint?: string;
  unlocksLabel?: string;
  unlocksActive?: boolean;
}

function FieldPicker({
  label, fields, fillRates, selected, onChange,
  numericOnly, optional, hint, unlocksLabel, unlocksActive,
}: FieldPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const filtered = useMemo(() => {
    const base = numericOnly
      ? fields.filter(f => f.field_type === 'numeric' || f.field_type === 'number')
      : fields;
    const sorted = Object.keys(fillRates).length > 0
      ? [...base].sort((a, b) => (fillRates[b.name] ?? -1) - (fillRates[a.name] ?? -1))
      : base;
    if (!search) return sorted;
    return sorted.filter(f => f.label.toLowerCase().includes(search.toLowerCase()));
  }, [fields, fillRates, numericOnly, search]);

  const topFields = filtered.slice(0, FIELD_PICKER_TOP_N);
  const displayed = expanded || search ? filtered : topFields;
  const hasMore = filtered.length > FIELD_PICKER_TOP_N;
  const selectedField = fields.find(f => f.name === selected);

  if (optional && !showPicker) {
    return (
      <div>
        {selectedField ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', background: '#F0FDFA', border: '0.5px solid #0D9488',
              borderRadius: 6, fontSize: 12, color: '#0D9488',
            }}>
              <span style={{ flex: 1 }}>{selectedField.label}</span>
              {fillRates[selected!] !== undefined && (
                <span style={{ fontSize: 9, background: '#CCFBF1', borderRadius: 3, padding: '1px 4px' }}>
                  {fillRates[selected!]}%
                </span>
              )}
              {unlocksLabel && (
                <span style={{ fontSize: 9, color: '#0D9488' }}>✓ {unlocksLabel}</span>
              )}
            </div>
            <button
              onClick={() => { onChange(null); setShowPicker(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
              title="Remove"
            >×</button>
          </div>
        ) : (
          <div>
            <button
              onClick={() => setShowPicker(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#0D9488', padding: '2px 0', textAlign: 'left',
              }}
            >
              + {label}
            </button>
            {hint && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{hint}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {optional && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div />
          <button
            onClick={() => { onChange(null); setShowPicker(false); setSearch(''); setExpanded(false); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#94A3B8' }}
          >
            ✕ cancel
          </button>
        </div>
      )}
      {/* Search */}
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); if (!expanded) setExpanded(true); }}
        placeholder="Search fields…"
        autoFocus={optional}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '5px 8px', marginBottom: 6,
          border: '0.5px solid #CBD5E1', borderRadius: 5,
          fontSize: 11, color: '#1E293B', background: 'white',
        }}
      />
      {/* Field buttons */}
      {displayed.map(f => {
        const isSelected = f.name === selected;
        const rate = fillRates[f.name];
        const badge = TYPE_BADGE[f.field_type] || TYPE_BADGE.text;
        return (
          <button
            key={f.name}
            onClick={() => {
              onChange(f.name);
              if (optional) { setShowPicker(false); setSearch(''); setExpanded(false); }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '5px 8px', marginBottom: 3,
              background: isSelected ? '#F0FDFA' : 'white',
              border: `0.5px solid ${isSelected ? '#0D9488' : '#E2E8F0'}`,
              borderRadius: 5, cursor: 'pointer',
              fontSize: 11, color: isSelected ? '#0D9488' : '#374151',
              textAlign: 'left',
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = '#94A3B8'; }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
          >
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px',
              borderRadius: 3, background: badge.bg, color: badge.color,
              flexShrink: 0, letterSpacing: '0.03em',
            }}>{badge.label}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
            {rate !== undefined && (
              <span style={{
                fontSize: 9, color: '#94A3B8', background: '#F1F5F9',
                borderRadius: 3, padding: '1px 4px', flexShrink: 0,
              }}>{rate}%</span>
            )}
          </button>
        );
      })}
      {/* See more / see less */}
      {!search && !expanded && hasMore && (
        <button onClick={() => setExpanded(true)} style={{ fontSize: 10, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
          See more ({filtered.length - FIELD_PICKER_TOP_N}) →
        </button>
      )}
      {expanded && !search && (
        <button onClick={() => setExpanded(false)} style={{ fontSize: 10, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
          ↑ See less
        </button>
      )}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
}

function CollapsibleSection({ title, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: '0.5px solid #F1F5F9', paddingTop: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '2px 0', fontSize: 10, fontWeight: 600, color: '#64748B',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

const BAR_HEIGHTS = [62, 38, 85, 50, 72, 42];

function ChartSkeleton() {
  return (
    <div style={{ height: 220, background: '#F8FAFC', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
      <style>{`@keyframes cbp-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}.cbp-sh::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.65) 50%,transparent 100%);animation:cbp-shimmer 1.4s ease-in-out infinite}`}</style>
      {[25, 50, 75].map(p => (
        <div key={p} style={{ position: 'absolute', bottom: `${24 + p * 0.62}px`, left: 0, right: 0, height: 1, background: '#EEF2F7' }} />
      ))}
      <div style={{ position: 'absolute', bottom: 28, left: 16, right: 16, top: 20, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {BAR_HEIGHTS.map((h, i) => (
          <div key={i} className="cbp-sh" style={{ flex: 1, height: `${h}%`, borderRadius: '3px 3px 0 0', background: '#E9EEF4', position: 'relative', overflow: 'hidden' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 28, left: 16, right: 16, height: 1, background: '#DDE3EC' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: '#94A3B8', background: 'rgba(248,250,252,0.9)', padding: '3px 8px', borderRadius: 4 }}>
          Loading preview…
        </span>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
};

const selectStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '6px 8px',
  border: '0.5px solid #E2E8F0', borderRadius: 5, background: 'white',
  color: '#1E293B', cursor: 'pointer',
};

export default function ChartBuilderPanel({
  workspaceId, sectionId, onInsert, onCancel,
}: ChartBuilderPanelProps) {
  const base = `/api/workspaces/${workspaceId}`;
  const token = localStorage.getItem('pandora_session') || '';
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [sourceTab, setSourceTab] = useState<'skills' | 'queries' | 'live'>('live');

  const [liveSchema, setLiveSchema] = useState<Record<string, LiveSchemaField[]>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [fillRates, setFillRates] = useState<Record<string, number>>({});

  const [entityType, setEntityType] = useState('');
  const [xField, setXField] = useState<string | null>(null);
  const [yAggFunc, setYAggFunc] = useState<AggFunc>('COUNT');
  const [yField, setYField] = useState<string | null>(null);
  const [seriesField, setSeriesField] = useState<string | null>(null);
  const [secondYField, setSecondYField] = useState<string | null>(null);
  const [secondYAggFunc, setSecondYAggFunc] = useState<AggFunc>('COUNT');

  const [chartType, setChartType] = useState<ChartType>('bar');
  const [title, setTitle] = useState('');
  const [colorMode, setColorMode] = useState<ColorMode>('uniform');

  const [axisFormat, setAxisFormat] = useState<NumberFmt>('raw');
  const [axisDecimals, setAxisDecimals] = useState<0 | 1 | 2>(0);
  const [yMin, setYMin] = useState('');
  const [yMax, setYMax] = useState('');
  const [axisTitle, setAxisTitle] = useState('');

  const [dataLabelsEnabled, setDataLabelsEnabled] = useState(false);
  const [dataLabelsPos, setDataLabelsPos] = useState<DataLabelPos>('outside_end');
  const [dataLabelsFmt, setDataLabelsFmt] = useState<NumberFmt>('raw');
  const [dataLabelsDecimals, setDataLabelsDecimals] = useState<0 | 1 | 2>(0);

  const [outlierEnabled, setOutlierEnabled] = useState(false);
  const [outlierThreshold, setOutlierThreshold] = useState(3);

  const [legendEnabled, setLegendEnabled] = useState(false);
  const [legendPos, setLegendPos] = useState<'top' | 'bottom' | 'left' | 'right'>('bottom');

  const [previewData, setPreviewData] = useState<ChartDataPoint[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entityTypes = useMemo(() => Object.keys(liveSchema), [liveSchema]);
  const currentFields: LiveSchemaField[] = liveSchema[entityType] || [];

  useEffect(() => {
    setSchemaLoading(true);
    fetch(`${base}/chart-data/schema`, { headers: authHeaders })
      .then(r => r.json())
      .then(data => {
        const map: Record<string, LiveSchemaField[]> = {};
        (data.schema || []).forEach((s: any) => {
          map[s.entity_type] = (s.fields || []).map((f: any) => ({
            name: f.name, label: f.label,
            field_type: f.field_type || 'text',
          }));
        });
        setLiveSchema(map);
        const types = Object.keys(map);
        if (types.length > 0) {
          const first = types[0];
          setEntityType(first);
          setXField(map[first][0]?.name || null);
          loadFillRates(first, map[first]);
        }
      })
      .catch(() => {})
      .finally(() => setSchemaLoading(false));
  }, [workspaceId]);

  function loadFillRates(et: string, fields?: LiveSchemaField[]) {
    fetch(`${base}/chart-data/fill-rates/${et}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const rates: Record<string, number> = {};
        (data.fill_rates || []).forEach((r: { field_name: string; fill_rate: number }) => {
          rates[r.field_name] = r.fill_rate;
        });
        setFillRates(rates);
      })
      .catch(() => {});
  }

  function handleEntityChange(et: string) {
    setEntityType(et);
    setXField(null);
    setYField(null);
    setSeriesField(null);
    setSecondYField(null);
    setFillRates({});
    loadFillRates(et);
  }

  const runQuery = useCallback(async (
    et: string, xf: string | null, yAgg: AggFunc, yf: string | null
  ) => {
    if (!et || !xf) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const body: any = {
        entity_type: et,
        group_by: xf,
        aggregate: { func: yAgg, field: yf || undefined },
        filters: [],
        limit: 20,
      };
      const res = await fetch(`${base}/chart-data/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows: ChartDataPoint[] = (data.data || []).map((r: any) => ({
        label: String(r.label ?? ''),
        value: Number(r.value) || 0,
      }));
      setPreviewData(rows);
      if (!title && xf) {
        const xLabel = (liveSchema[et] || []).find(f => f.name === xf)?.label || xf;
        const verb = yAgg === 'COUNT' ? 'Count' : `${yAgg}`;
        const yLabel = yf ? ((liveSchema[et] || []).find(f => f.name === yf)?.label || yf) : et;
        setTitle(`${verb} of ${yLabel} by ${xLabel}`);
      }
    } catch (err) {
      setPreviewError('Query failed — check field selection');
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [base, token, liveSchema]);

  const fireDebouncedQuery = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runQuery(entityType, xField, yAggFunc, yField);
    }, 500);
  }, [entityType, xField, yAggFunc, yField, runQuery]);

  useEffect(() => {
    if (entityType && xField) fireDebouncedQuery();
  }, [entityType, xField, yAggFunc, yField]);

  function isChartTypeEnabled(ct: ChartTypeConfig): boolean {
    if (ct.requires === 'none') return true;
    if (ct.requires === 'series') return !!seriesField;
    if (ct.requires === 'second_y') return !!secondYField;
    if (ct.requires === 'skill_data') return false;
    return false;
  }

  function buildSpec(): ChartSpec {
    return {
      type: 'chart',
      chartType,
      title,
      data: previewData,
      color_mode: colorMode,
      source: {
        calculation_id: `live-query:${entityType}:${xField}`,
        run_at: new Date().toISOString(),
        record_count: previewData.length,
      },
      ...(seriesField ? { series_field: seriesField } : {}),
      ...(secondYField ? { second_y_field: secondYField, second_y_aggregate: secondYAggFunc } : {}),
      axis_format: {
        number_format: axisFormat,
        decimal_places: axisDecimals,
        ...(yMin ? { y_min: Number(yMin) } : {}),
        ...(yMax ? { y_max: Number(yMax) } : {}),
        ...(axisTitle ? { axis_title: axisTitle } : {}),
      },
      data_labels: {
        enabled: dataLabelsEnabled,
        position: dataLabelsPos,
        number_format: dataLabelsFmt,
        decimal_places: dataLabelsDecimals,
      },
      outlier_mode: {
        enabled: outlierEnabled,
        threshold_multiple: outlierThreshold,
      },
      legend: {
        enabled: legendEnabled,
        position: legendPos,
      },
    };
  }

  function handleInsert() {
    if (!xField || previewData.length === 0) return;
    setInserting(true);
    try {
      onInsert(buildSpec());
    } finally {
      setInserting(false);
    }
  }

  const canInsert = !!xField && previewData.length > 0 && !!title.trim();
  const liveFields = currentFields;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Source tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #E2E8F0', flexShrink: 0, background: 'white' }}>
        {([
          { id: 'skills' as const, label: 'Skills' },
          { id: 'queries' as const, label: 'Saved Queries' },
          { id: 'live' as const, label: 'Live Query' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setSourceTab(tab.id)}
            style={{
              padding: '10px 14px 8px', background: 'none', border: 'none',
              borderBottom: sourceTab === tab.id ? '2px solid #14B8A6' : '2px solid transparent',
              cursor: 'pointer', fontSize: 11,
              fontWeight: sourceTab === tab.id ? 600 : 400,
              color: sourceTab === tab.id ? '#14B8A6' : '#64748B',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body — two columns */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* CONFIG column — scrollable */}
        <div style={{
          width: 280, flexShrink: 0,
          borderRight: '0.5px solid #E2E8F0',
          overflowY: 'auto',
          padding: '16px 14px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {sourceTab === 'live' && (
            <>
              {/* Entity type */}
              {entityTypes.length > 1 && (
                <div>
                  <label style={labelStyle}>Entity</label>
                  <select
                    value={entityType}
                    onChange={e => handleEntityChange(e.target.value)}
                    style={selectStyle}
                  >
                    {entityTypes.map(et => (
                      <option key={et} value={et}>{et.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              )}

              {schemaLoading ? (
                <div style={{ fontSize: 11, color: '#94A3B8' }}>Loading schema…</div>
              ) : (
                <>
                  {/* X Axis */}
                  <div>
                    <label style={labelStyle}>X Axis — group by</label>
                    <FieldPicker
                      label="X axis field"
                      fields={liveFields}
                      fillRates={fillRates}
                      selected={xField}
                      onChange={v => setXField(v)}
                    />
                  </div>

                  {/* Y Axis */}
                  <div>
                    <label style={labelStyle}>Y Axis — measure</label>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select
                        value={yAggFunc}
                        onChange={e => setYAggFunc(e.target.value as AggFunc)}
                        style={{ ...selectStyle, width: 80, flexShrink: 0 }}
                      >
                        {(['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] as AggFunc[]).map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <div style={{ flex: 1, fontSize: 10, color: '#64748B', paddingTop: 8 }}>
                        {yAggFunc === 'COUNT' ? 'rows (no field needed)' : 'of field →'}
                      </div>
                    </div>
                    {yAggFunc !== 'COUNT' && (
                      <FieldPicker
                        label="Y axis field"
                        fields={liveFields}
                        fillRates={fillRates}
                        selected={yField}
                        onChange={v => setYField(v)}
                        numericOnly
                      />
                    )}
                  </div>

                  {/* Series (optional) */}
                  <div>
                    <label style={labelStyle}>Series <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
                    <FieldPicker
                      label="Add series dimension"
                      fields={liveFields}
                      fillRates={fillRates}
                      selected={seriesField}
                      onChange={v => setSeriesField(v)}
                      optional
                      hint="Unlocks stacked bar & heatmap"
                      unlocksLabel="Stacked & Heatmap unlocked"
                      unlocksActive={!!seriesField}
                    />
                  </div>

                  {/* Second Y (optional) */}
                  <div>
                    <label style={labelStyle}>Second Y <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
                    {secondYField ? (
                      <div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <select
                            value={secondYAggFunc}
                            onChange={e => setSecondYAggFunc(e.target.value as AggFunc)}
                            style={{ ...selectStyle, width: 80, flexShrink: 0 }}
                          >
                            {(['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] as AggFunc[]).map(f => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setSecondYField(null)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 12 }}
                          >×</button>
                        </div>
                        <FieldPicker
                          label="Second Y field"
                          fields={liveFields}
                          fillRates={fillRates}
                          selected={secondYField}
                          onChange={v => setSecondYField(v)}
                          numericOnly
                        />
                        <div style={{ fontSize: 10, color: '#0D9488', marginTop: 4 }}>✓ Combo & Scatter unlocked</div>
                      </div>
                    ) : (
                      <div>
                        <button
                          onClick={() => setSecondYField('__pending__')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#0D9488', padding: '2px 0' }}
                        >
                          + Add second measure
                        </button>
                        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Unlocks combo & scatter</div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {sourceTab === 'skills' && (
            <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', paddingTop: 24 }}>
              Skills data source coming soon.<br />Use Live Query to explore your CRM data.
            </div>
          )}

          {sourceTab === 'queries' && (
            <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', paddingTop: 24 }}>
              Saved queries coming soon.<br />Use Live Query to explore your CRM data.
            </div>
          )}

          {/* Divider */}
          <div style={{ borderTop: '0.5px solid #F1F5F9', paddingTop: 12 }}>
            {/* Chart type grid */}
            <label style={labelStyle}>Chart type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {CHART_TYPES.map(ct => {
                const enabled = isChartTypeEnabled(ct);
                const active = chartType === ct.type;
                return (
                  <button
                    key={ct.type}
                    title={!enabled ? ct.tooltip : ct.label}
                    onClick={() => enabled && setChartType(ct.type)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 2, padding: '7px 4px',
                      background: active ? 'rgba(20,184,166,0.08)' : 'white',
                      border: `0.5px solid ${active ? '#14B8A6' : '#E2E8F0'}`,
                      borderRadius: 5, cursor: enabled ? 'pointer' : 'not-allowed',
                      opacity: enabled ? 1 : 0.4,
                      color: active ? '#14B8A6' : '#374151',
                      fontSize: 10,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{ct.icon}</span>
                    <span>{ct.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Axis formatting */}
          <CollapsibleSection title="Axis formatting">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Format</label>
                <select value={axisFormat} onChange={e => setAxisFormat(e.target.value as NumberFmt)} style={selectStyle}>
                  <option value="raw">Raw</option>
                  <option value="currency">Currency</option>
                  <option value="km">K/M</option>
                  <option value="percent">Percent</option>
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Decimals</label>
                <select value={axisDecimals} onChange={e => setAxisDecimals(Number(e.target.value) as 0 | 1 | 2)} style={selectStyle}>
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Y min</label>
                <input value={yMin} onChange={e => setYMin(e.target.value)} placeholder="Auto" style={{ ...selectStyle }} />
              </div>
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Y max</label>
                <input value={yMax} onChange={e => setYMax(e.target.value)} placeholder="Auto" style={{ ...selectStyle }} />
              </div>
            </div>
            <div>
              <label style={{ ...labelStyle, marginBottom: 3 }}>Axis title</label>
              <input value={axisTitle} onChange={e => setAxisTitle(e.target.value)} placeholder="Optional" style={{ ...selectStyle }} />
            </div>
          </CollapsibleSection>

          {/* Data labels */}
          <CollapsibleSection title="Data labels">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div
                onClick={() => setDataLabelsEnabled(v => !v)}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: dataLabelsEnabled ? '#14B8A6' : '#E2E8F0',
                  position: 'relative', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2,
                  left: dataLabelsEnabled ? 18 : 2,
                  transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              <span style={{ fontSize: 11, color: '#374151' }}>Show data labels</span>
            </div>
            {dataLabelsEnabled && (
              <>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Position</label>
                <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                  {(['outside_end', 'inside_end', 'center', 'base'] as DataLabelPos[]).map(pos => (
                    <button
                      key={pos}
                      onClick={() => setDataLabelsPos(pos)}
                      style={{
                        padding: '3px 7px', fontSize: 9, borderRadius: 4,
                        border: `0.5px solid ${dataLabelsPos === pos ? '#14B8A6' : '#E2E8F0'}`,
                        background: dataLabelsPos === pos ? '#F0FDFA' : 'white',
                        color: dataLabelsPos === pos ? '#14B8A6' : '#374151',
                        cursor: 'pointer',
                      }}
                    >
                      {pos.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 3 }}>Format</label>
                    <select value={dataLabelsFmt} onChange={e => setDataLabelsFmt(e.target.value as NumberFmt)} style={selectStyle}>
                      <option value="raw">Raw</option>
                      <option value="currency">Currency</option>
                      <option value="km">K/M</option>
                      <option value="percent">Percent</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 3 }}>Decimals</label>
                    <select value={dataLabelsDecimals} onChange={e => setDataLabelsDecimals(Number(e.target.value) as 0 | 1 | 2)} style={selectStyle}>
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </CollapsibleSection>

          {/* Outlier handling */}
          <CollapsibleSection title="Outlier handling">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div
                onClick={() => setOutlierEnabled(v => !v)}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: outlierEnabled ? '#14B8A6' : '#E2E8F0',
                  position: 'relative', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2,
                  left: outlierEnabled ? 18 : 2, transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              <span style={{ fontSize: 11, color: '#374151' }}>Broken axis</span>
            </div>
            {outlierEnabled && (
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Threshold</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number" min={2} max={10}
                    value={outlierThreshold}
                    onChange={e => setOutlierThreshold(Number(e.target.value))}
                    style={{ ...selectStyle, width: 60 }}
                  />
                  <span style={{ fontSize: 10, color: '#64748B' }}>× the median bar height</span>
                </div>
              </div>
            )}
            {!outlierEnabled && (
              <p style={{ fontSize: 10, color: '#94A3B8', margin: 0 }}>
                When a bar exceeds the threshold, show a visual break instead of compressing other bars.
              </p>
            )}
          </CollapsibleSection>

          {/* Legend */}
          <CollapsibleSection title="Legend">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div
                onClick={() => setLegendEnabled(v => !v)}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: legendEnabled ? '#14B8A6' : '#E2E8F0',
                  position: 'relative', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2,
                  left: legendEnabled ? 18 : 2, transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              <span style={{ fontSize: 11, color: '#374151' }}>Show legend</span>
            </div>
            {legendEnabled && (
              <div>
                <label style={{ ...labelStyle, marginBottom: 3 }}>Position</label>
                <div style={{ display: 'flex', gap: 3 }}>
                  {(['top', 'bottom', 'left', 'right'] as const).map(pos => (
                    <button
                      key={pos}
                      onClick={() => setLegendPos(pos)}
                      style={{
                        padding: '3px 8px', fontSize: 9, borderRadius: 4,
                        border: `0.5px solid ${legendPos === pos ? '#14B8A6' : '#E2E8F0'}`,
                        background: legendPos === pos ? '#F0FDFA' : 'white',
                        color: legendPos === pos ? '#14B8A6' : '#374151',
                        cursor: 'pointer', textTransform: 'capitalize',
                      }}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* PREVIEW column */}
        <div style={{
          flex: 1, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          padding: '16px 16px',
          gap: 12,
          minWidth: 0,
        }}>
          {/* Title input */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="State what this chart proves, not what it shows"
            style={{
              width: '100%', boxSizing: 'border-box',
              fontSize: 13, fontWeight: 500, padding: '8px 10px',
              border: '0.5px solid #E2E8F0', borderRadius: 6,
              background: 'white', color: '#1E293B', outline: 'none',
            }}
          />

          {/* Chart preview area */}
          <div style={{ flex: 1, minHeight: 180, position: 'relative' }}>
            {previewLoading ? (
              <ChartSkeleton />
            ) : previewError ? (
              <div style={{
                height: '100%', minHeight: 180, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: '#FEF2F2', borderRadius: 6,
                border: '0.5px solid #FECACA', fontSize: 11, color: '#DC2626',
              }}>
                {previewError}
              </div>
            ) : previewData.length > 0 ? (
              <ChartRenderer spec={buildSpec()} compact={false} />
            ) : (
              <div style={{
                height: '100%', minHeight: 180, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: '#F8FAFC', borderRadius: 6,
                border: '0.5px dashed #E2E8F0', fontSize: 11, color: '#94A3B8', gap: 6,
              }}>
                <span style={{ fontSize: 24 }}>▤</span>
                <span>Pick an X axis field to see a preview</span>
              </div>
            )}
          </div>

          {/* Color mode */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Color mode
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['semantic', 'uniform', 'categorical'] as ColorMode[]).map(mode => (
                <label key={mode} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: '#374151', cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="colorMode"
                    value={mode}
                    checked={colorMode === mode}
                    onChange={() => setColorMode(mode)}
                    style={{ cursor: 'pointer', accentColor: '#14B8A6' }}
                  />
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 8, padding: '10px 16px',
        borderTop: '0.5px solid #E2E8F0', background: 'white', flexShrink: 0,
      }}>
        {!canInsert && xField && (
          <span style={{ fontSize: 10, color: '#94A3B8', marginRight: 'auto' }}>
            {!title.trim() ? 'Add a title to insert' : previewData.length === 0 ? 'Waiting for data…' : ''}
          </span>
        )}
        <button
          onClick={onCancel}
          style={{
            padding: '6px 14px', fontSize: 12, borderRadius: 6,
            background: 'none', border: '0.5px solid #E2E8F0',
            color: '#64748B', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleInsert}
          disabled={!canInsert || inserting}
          style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            background: canInsert ? '#14B8A6' : '#E2E8F0',
            color: canInsert ? 'white' : '#94A3B8',
            border: 'none', cursor: canInsert ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {inserting ? 'Inserting…' : 'Insert chart →'}
        </button>
      </div>
    </div>
  );
}

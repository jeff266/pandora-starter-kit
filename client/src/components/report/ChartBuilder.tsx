import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DATA_SOURCES, extractField, type DataSourceDef, type DataSourceField } from '../../lib/chartDataSources';
import { resolveColor } from '../../lib/chartColors';

type BuilderView = 'pick_source' | 'pick_field' | 'pick_query_columns' | 'pick_live_query' | 'refine';
type SourceMode = 'skills' | 'queries' | 'live';
type ChartTypeOption = 'bar' | 'horizontal_bar' | 'line' | 'donut' | 'stacked_bar' | 'waterfall' | 'funnel' | 'bullet' | 'heatmap' | 'combo' | 'scatter';
type NumberFormat = 'K' | 'M' | 'raw' | 'pct';
type ColorScheme = 'semantic' | 'uniform' | 'categorical';

interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  last_run_rows?: number;
  last_run_ms?: number;
}

interface LiveSchemaField {
  name: string;
  label: string;
  field_type: 'id' | 'categorical' | 'numeric' | 'date' | 'text';
}


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

function defaultNumberFormat(fld: DataSourceField): NumberFormat {
  if (fld.type === 'currency') return 'K';
  if (fld.label.includes('(%)') || fld.key.includes('probability')) return 'pct';
  return 'raw';
}

const WORD = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'];
function generateVerdict(src: DataSourceDef, fld: DataSourceField, recs: any[], topN: number): string {
  if (recs.length === 0) return suggestTitle(src, fld);
  const count = Math.min(recs.length, topN);
  const n = WORD[count] ?? String(count);
  const deal = count === 1 ? 'deal' : 'deals';

  if (src.id === 'stale_deals' && fld.key === 'fields.days_since_activity') {
    const sorted = [...recs]
      .sort((a, b) => Number(b.fields?.days_since_activity) - Number(a.fields?.days_since_activity))
      .slice(0, topN);
    const minDays = Math.min(...sorted.map(r => Number(r.fields?.days_since_activity) || 0));
    const threshold = Math.floor(minDays / 10) * 10;
    return `${n} ${deal} dark ${threshold}+ days`;
  }

  if (src.id === 'at_risk_deals' && fld.key === 'fields.risk_score') {
    const sorted = [...recs]
      .sort((a, b) => Number(b.fields?.risk_score) - Number(a.fields?.risk_score))
      .slice(0, topN);
    const minScore = Math.min(...sorted.map(r => Number(r.fields?.risk_score) || 0));
    const threshold = Math.floor(minScore / 10) * 10;
    return `${n} ${deal} at risk, ${threshold}+ score`;
  }

  if (src.id === 'at_risk_deals' && fld.key === 'fields.amount') {
    const total = [...recs].slice(0, topN).reduce((s, r) => s + Number(r.fields?.amount || 0), 0);
    return `$${Math.round(total / 1000)}K at risk across ${n.toLowerCase()} ${deal}`;
  }

  if (src.id === 'pipeline_by_rep' && fld.type === 'currency') {
    const fieldKey = fld.key.split('.').pop()!;
    const total = [...recs].slice(0, topN).reduce((s, r) => s + Number(r.fields?.[fieldKey] || 0), 0);
    const label = fld.label.replace(' ($K)', '').toLowerCase();
    return `$${Math.round(total / 1000)}K ${label} across ${n.toLowerCase()} rep${count !== 1 ? 's' : ''}`;
  }

  if (src.id === 'forecast_pipeline' && fld.type === 'currency') {
    const fieldKey = fld.key.split('.').pop()!;
    const total = [...recs].slice(0, topN).reduce((s, r) => s + Number(r.fields?.[fieldKey] || 0), 0);
    const weighted = fld.key.includes('weighted') ? 'weighted ' : '';
    return `$${Math.round(total / 1000)}K ${weighted}forecast pipeline`;
  }

  return suggestTitle(src, fld);
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

// ─── FieldPicker ─────────────────────────────────────────────────────────────

const FIELD_PICKER_TOP_N = 5;

interface FieldPickerProps {
  fields: LiveSchemaField[];
  fillRates: Record<string, number>;
  value: string;
  onChange: (name: string) => void;
}

function FieldPicker({ fields, fillRates, value, onChange }: FieldPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    if (Object.keys(fillRates).length === 0) return fields;
    return [...fields].sort((a, b) => (fillRates[b.name] ?? -1) - (fillRates[a.name] ?? -1));
  }, [fields, fillRates]);

  const topFields = sorted.slice(0, FIELD_PICKER_TOP_N);
  const hasMore = sorted.length > FIELD_PICKER_TOP_N;
  const selectedField = fields.find(f => f.name === value);

  const displayed = expanded
    ? (search ? sorted.filter(f => f.label.toLowerCase().includes(search.toLowerCase())) : sorted)
    : topFields;

  const selectedInDisplayed = displayed.some(f => f.name === value);

  return (
    <div>
      {/* Search input — top of expanded view for autocomplete feel */}
      {expanded && (
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search fields…"
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '5px 8px', marginBottom: 6,
            border: '0.5px solid #CBD5E1', borderRadius: 5,
            fontSize: 11, color: '#1E293B',
          }}
        />
      )}
      {/* Pinned selected banner — shown when selected field is not in the current list */}
      {!selectedInDisplayed && selectedField && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 10px', marginBottom: 4,
          background: '#F0FDFA', border: '0.5px solid #0D9488', borderRadius: 5,
          fontSize: 12, color: '#0D9488',
        }}>
          <span>✓ {selectedField.label}</span>
          {fillRates[value] !== undefined && (
            <span style={{ fontSize: 9, background: '#CCFBF1', borderRadius: 3, padding: '1px 4px' }}>
              {fillRates[value]}%
            </span>
          )}
        </div>
      )}
      {/* Field buttons */}
      {displayed.map(f => {
        const isSelected = f.name === value;
        const rate = fillRates[f.name];
        return (
          <button
            key={f.name}
            onClick={() => onChange(f.name)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '6px 10px', marginBottom: 4,
              background: isSelected ? '#F0FDFA' : 'white',
              border: `0.5px solid ${isSelected ? '#0D9488' : '#E2E8F0'}`,
              borderRadius: 5, cursor: 'pointer',
              fontSize: 12, color: isSelected ? '#0D9488' : '#374151',
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = '#94A3B8'; }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
          >
            <span>{f.label}</span>
            {rate !== undefined && (
              <span style={{
                fontSize: 9, color: '#94A3B8', background: '#F1F5F9',
                borderRadius: 3, padding: '1px 4px', fontVariantNumeric: 'tabular-nums',
                flexShrink: 0, marginLeft: 8,
              }}>
                {rate}%
              </span>
            )}
          </button>
        );
      })}
      {/* See more (collapsed) */}
      {!expanded && hasMore && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            fontSize: 11, color: '#64748B', background: 'none', border: 'none',
            cursor: 'pointer', padding: '2px 0', display: 'block', width: '100%',
            textAlign: 'left',
          }}
        >
          See more ({sorted.length - FIELD_PICKER_TOP_N} more) →
        </button>
      )}
      {/* See less (expanded) */}
      {expanded && (
        <button
          onClick={() => { setExpanded(false); setSearch(''); }}
          style={{
            fontSize: 11, color: '#64748B', background: 'none', border: 'none',
            cursor: 'pointer', padding: '2px 0', display: 'block', width: '100%',
            textAlign: 'left',
          }}
        >
          ↑ See less
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const [sourceMode, setSourceMode] = useState<SourceMode>('skills');
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<DataSourceDef | null>(null);
  const [selectedField, setSelectedField] = useState<DataSourceField | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [queriesLoading, setQueriesLoading] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<SavedQuery | null>(null);
  const [queryRunData, setQueryRunData] = useState<{ rows: any[]; columns: string[] } | null>(null);
  const [queryRunLoading, setQueryRunLoading] = useState(false);
  const [queryLabelCol, setQueryLabelCol] = useState('');
  const [queryValueCol, setQueryValueCol] = useState('');

  const [liveSchema, setLiveSchema] = useState<Record<string, LiveSchemaField[]>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [liveEntityType, setLiveEntityType] = useState('');
  const [liveGroupBy, setLiveGroupBy] = useState('');
  const [liveAggFunc, setLiveAggFunc] = useState('COUNT');
  const [liveAggField, setLiveAggField] = useState('*');
  const [liveRunLoading, setLiveRunLoading] = useState(false);
  const [liveFilters, setLiveFilters] = useState<Array<{ field: string; operator: string; value: string }>>([]);
  const [liveLimit, setLiveLimit] = useState(100);
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string[]>>>({});
  const [fieldValuesLoading, setFieldValuesLoading] = useState<Record<string, Record<string, boolean>>>({});

  const [liveFillRates, setLiveFillRates] = useState<Record<string, Record<string, number>>>({});
  const [filterExpandedIdx, setFilterExpandedIdx] = useState<number | null>(null);

  const [chartTitle, setChartTitle] = useState('');
  const [chartType, setChartType] = useState<ChartTypeOption>('bar');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('uniform');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(6);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('K');
  const [showLegend, setShowLegend] = useState(false);
  const [targetValue, setTargetValue] = useState<number | ''>('');
  const [comboSeriesLabel, setComboSeriesLabel] = useState('');
  const [referenceValue, setReferenceValue] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateField, setDateField] = useState('');

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

  async function loadSavedQueries() {
    setQueriesLoading(true);
    try {
      const res = await fetch(`${base}/chart-data/queries`, { headers: authHeader });
      const data = await res.json();
      setSavedQueries(data.queries || []);
    } catch (err) {
      console.error('[ChartBuilder] Saved queries error:', err);
    } finally {
      setQueriesLoading(false);
    }
  }

  async function runSavedQuery(q: SavedQuery) {
    setSelectedQuery(q);
    setQueryRunLoading(true);
    try {
      const res = await fetch(`${base}/chart-data/queries/${q.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cols = data.columns || [];
      setQueryRunData({ rows: data.data || [], columns: cols });
      const firstStr = cols[0] || '';
      const firstNum = cols.find((c: string) => c !== firstStr) || cols[1] || '';
      setQueryLabelCol(firstStr);
      setQueryValueCol(firstNum);
      setChartTitle(`${q.name}`);
      setChartType('bar');
      setColorScheme('uniform');
      setView('pick_query_columns');
    } catch (err) {
      console.error('[ChartBuilder] Run saved query error:', err);
    } finally {
      setQueryRunLoading(false);
    }
  }

  async function loadLiveSchema() {
    setSchemaLoading(true);
    try {
      const res = await fetch(`${base}/chart-data/schema`, { headers: authHeader });
      const data = await res.json();
      const schemaMap: Record<string, LiveSchemaField[]> = {};
      (data.schema || []).forEach((s: any) => {
        schemaMap[s.entity_type] = (s.fields || []).map((f: any) => ({
          name: f.name,
          label: f.label,
          field_type: f.field_type || 'text',
        }));
      });
      setLiveSchema(schemaMap);
      const entityTypes = Object.keys(schemaMap);
      if (entityTypes.length > 0) {
        const firstEntity = entityTypes[0];
        setLiveEntityType(firstEntity);
        setLiveGroupBy(schemaMap[firstEntity][0]?.name || '');
        setLiveAggField(schemaMap[firstEntity][1]?.name || '*');
        loadFillRates(firstEntity);
      }
    } catch (err) {
      console.error('[ChartBuilder] Schema error:', err);
    } finally {
      setSchemaLoading(false);
    }
  }

  async function loadFieldValues(entityType: string, fieldName: string) {
    if (!entityType || !fieldName) return;
    if (fieldValues[entityType]?.[fieldName] !== undefined) return;
    if (fieldValuesLoading[entityType]?.[fieldName]) return;

    setFieldValuesLoading(prev => ({
      ...prev,
      [entityType]: { ...(prev[entityType] || {}), [fieldName]: true },
    }));

    try {
      const res = await fetch(`${base}/chart-data/field-values/${entityType}/${fieldName}`, { headers: authHeader });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFieldValues(prev => ({
        ...prev,
        [entityType]: { ...(prev[entityType] || {}), [fieldName]: data.values || [] },
      }));
    } catch (err) {
      console.error('[ChartBuilder] Field values error:', err);
      setFieldValues(prev => ({
        ...prev,
        [entityType]: { ...(prev[entityType] || {}), [fieldName]: [] },
      }));
    } finally {
      setFieldValuesLoading(prev => ({
        ...prev,
        [entityType]: { ...(prev[entityType] || {}), [fieldName]: false },
      }));
    }
  }

  async function loadFillRates(entityType: string) {
    if (!entityType) return;
    if (liveFillRates[entityType]) return;
    try {
      const res = await fetch(`${base}/chart-data/fill-rates/${entityType}`, { headers: authHeader });
      if (!res.ok) return;
      const data = await res.json();
      const rates: Record<string, number> = {};
      (data.fill_rates || []).forEach((r: { field_name: string; fill_rate: number }) => {
        rates[r.field_name] = r.fill_rate;
      });
      setLiveFillRates(prev => ({ ...prev, [entityType]: rates }));
    } catch {
      // silent fallback — schema field order preserved
    }
  }

  async function runLiveQuery() {
    setLiveRunLoading(true);
    try {
      const activeFilters = liveFilters.filter(f => f.field && f.value.trim());
      // Add date range filters if specified
      if (dateFrom && dateField) {
        activeFilters.push({ field: dateField, operator: '>=', value: dateFrom });
      }
      if (dateTo && dateField) {
        activeFilters.push({ field: dateField, operator: '<=', value: dateTo });
      }
      const body: any = {
        entity_type: liveEntityType,
        group_by: liveGroupBy,
        aggregate: { func: liveAggFunc, field: liveAggField === '*' ? undefined : liveAggField },
        filters: activeFilters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
        limit: liveLimit,
      };
      const res = await fetch(`${base}/chart-data/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = (data.data || []).map((r: any) => ({ label: r.label, value: Number(r.value) || 0 }));
      setQueryRunData({ rows, columns: ['label', 'value'] });
      setQueryLabelCol('label');
      setQueryValueCol('value');
      const entityLabel = liveEntityType.replace(/_/g, ' ');
      const groupLabel = liveGroupBy.replace(/_/g, ' ');
      let title = `${entityLabel} by ${groupLabel}`;
      if (dateFrom && dateTo && dateField) {
        title += ` (${dateFrom} to ${dateTo})`;
      }
      setChartTitle(title);
      setChartType('bar');
      setColorScheme('uniform');
      setSourceMode('live');
      setView('refine');
      setTimeout(() => triggerPreviewRef.current(), 200);
    } catch (err) {
      console.error('[ChartBuilder] Live query error:', err);
    } finally {
      setLiveRunLoading(false);
    }
  }

  async function selectSourceAndField(src: DataSourceDef, fld: DataSourceField) {
    setSelectedSource(src);
    setSelectedField(fld);
    setChartType(src.defaultChartType);
    setColorScheme(src.defaultColorScheme as ColorScheme);
    setSortField(src.defaultSort.field);
    setSortDir(src.defaultSort.dir);
    setLimit(6);
    setShowLegend(src.defaultChartType === 'donut');
    setNumberFormat(defaultNumberFormat(fld));
    const recs = await loadRecords(src);
    setChartTitle(generateVerdict(src, fld, recs, 6));
    setView('refine');
    setTimeout(() => triggerPreview(src, fld), 100);
  }

  const filteredRecords = useMemo(() => {
    if (sourceMode !== 'skills') {
      if (!queryRunData) return [];
      const rows = [...queryRunData.rows]
        .sort((a, b) => {
          const av = Number(a[queryValueCol]) || 0;
          const bv = Number(b[queryValueCol]) || 0;
          return sortDir === 'desc' ? bv - av : av - bv;
        })
        .slice(0, limit);
      return rows;
    }
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
  }, [records, selectedField, selectedSource, sortField, sortDir, limit, sourceMode, queryRunData, queryValueCol]);

  function mapChartType(ct: ChartTypeOption): string {
    if (ct === 'horizontal_bar') return 'horizontalBar';
    if (ct === 'donut') return 'doughnut';
    if (ct === 'stacked_bar') return 'stackedBar';
    // New types pass through as-is: funnel, bullet, heatmap, combo, scatter, waterfall
    return ct;
  }

  function buildChartSpec() {
    let dataPoints: { label: string; value: number; semantic_tag?: string }[];
    if (sourceMode !== 'skills') {
      if (!queryRunData) return null;
      dataPoints = filteredRecords.map(r => ({
        label: String(r[queryLabelCol] || ''),
        value: Number(r[queryValueCol]) || 0,
      }));
    } else {
      if (!selectedSource || !selectedField) return null;
      dataPoints = filteredRecords.map(r => ({
        label: String(r.entity_name || r[selectedSource.nameField] || '').split(/\s*-\s+/)[0].trim(),
        value: Math.round(
          Number(extractField(r, selectedField.key, selectedField)) /
          (numberFormat === 'K' ? 1000 : numberFormat === 'M' ? 1_000_000 : 1)
        ),
        semantic_tag: getSemanticTag(r, selectedSource),
      }));
    }
    return {
      should_chart: true,
      chart_type: mapChartType(chartType),
      title: chartTitle,
      data_points: dataPoints,
      color_scheme: colorScheme,
      show_legend: showLegend,
      ...(chartType === 'bullet' && targetValue !== '' ? { targetValue } : {}),
      ...(chartType === 'combo' && comboSeriesLabel ? { comboSeriesLabel } : {}),
      ...(referenceValue !== '' ? { referenceValue } : {}),
    };
  }

  const triggerPreview = useCallback(
    async (src?: DataSourceDef, fld?: DataSourceField) => {
      const useSrc = src || selectedSource;
      const useFld = fld || selectedField;
      if (sourceMode === 'skills' && (!useSrc || !useFld)) return;
      if (sourceMode !== 'skills' && !queryRunData) return;
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
    [selectedSource, selectedField, filteredRecords, chartType, colorScheme, showLegend, numberFormat, chartTitle, base, token, sourceMode, queryRunData]
  );

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPreviewRef = React.useRef(triggerPreview);
  React.useEffect(() => { triggerPreviewRef.current = triggerPreview; }, [triggerPreview]);
  function debouncedPreview() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerPreviewRef.current(), 300);
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
    if (sourceMode === 'skills' && (!selectedSource || !selectedField)) return;
    if (sourceMode !== 'skills' && !queryRunData) return;
    setInserting(true);
    try {
      const spec = buildChartSpec();
      let builderConfig: any;
      let dataLabels: string[];
      let dataValues: number[];

      if (sourceMode === 'skills') {
        builderConfig = {
          source_id: selectedSource!.id,
          field_key: selectedField!.key,
          chart_type: chartType,
          color_scheme: colorScheme,
          sort_field: sortField,
          sort_dir: sortDir,
          limit,
          number_format: numberFormat,
          show_legend: showLegend,
        };
        dataLabels = filteredRecords.map(r =>
          String(r.entity_name || r[selectedSource!.nameField] || '').split(/\s*-\s+/)[0].trim()
        );
        dataValues = filteredRecords.map(r =>
          Math.round(
            Number(extractField(r, selectedField!.key, selectedField!)) /
            (numberFormat === 'K' ? 1000 : numberFormat === 'M' ? 1_000_000 : 1)
          )
        );
      } else {
        builderConfig = {
          source_mode: sourceMode,
          query_id: selectedQuery?.id,
          label_col: queryLabelCol,
          value_col: queryValueCol,
          chart_type: chartType,
          color_scheme: colorScheme,
          sort_dir: sortDir,
          limit,
          number_format: numberFormat,
          show_legend: showLegend,
        };
        dataLabels = filteredRecords.map(r => String(r[queryLabelCol] || ''));
        dataValues = filteredRecords.map(r => Number(r[queryValueCol]) || 0);
      }

      const chartVersion = existingChart ? (existingChart.version || 1) + 1 : 1;
      const res = await fetch(`${base}/reports/${reportDocumentId}/charts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          section_id: sectionId,
          chart_type: chartType === 'horizontal_bar' ? 'horizontalBar' : chartType === 'donut' ? 'doughnut' : chartType,
          title: chartTitle,
          data_labels: dataLabels,
          data_values: dataValues,
          chart_options: { color_scheme: colorScheme, number_format: numberFormat, show_legend: showLegend },
          chart_spec: spec,
          builder_config: builderConfig,
          version: chartVersion,
        }),
      });
      if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
      const saved = await res.json();
      const chart = saved.chart || saved;
      onInsert({ ...chart, preview_png: saved.chart_png_base64 || previewPng });
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
                if (view === 'refine' && sourceMode === 'skills') setView('pick_field');
                else if (view === 'refine' && sourceMode === 'queries') setView('pick_query_columns');
                else if (view === 'refine' && sourceMode === 'live') setView('pick_source');
                else if (view === 'pick_query_columns') setView('pick_source');
                else setView('pick_source');
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748B', padding: '0 4px 0 0' }}
            >
              ←
            </button>
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>
            {view === 'pick_source' ? 'Insert chart'
              : view === 'pick_field' ? selectedSource?.label
              : view === 'pick_query_columns' ? (selectedQuery?.name || 'Map columns')
              : 'Refine chart'}
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
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Tier tabs */}
            <div style={{ display: 'flex', borderBottom: '0.5px solid #E2E8F0', padding: '0 24px', flexShrink: 0 }}>
              {([
                { id: 'skills', label: 'Skills', desc: 'Pre-built datasets' },
                { id: 'queries', label: 'Saved Queries', desc: 'Your SQL queries' },
                { id: 'live', label: 'Live Query', desc: 'Pick fields live' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setSourceMode(tab.id);
                    if (tab.id === 'queries' && savedQueries.length === 0) loadSavedQueries();
                    if (tab.id === 'live' && Object.keys(liveSchema).length === 0) loadLiveSchema();
                  }}
                  style={{
                    padding: '12px 16px 10px',
                    background: 'none',
                    border: 'none',
                    borderBottom: sourceMode === tab.id ? '2px solid #0D9488' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: sourceMode === tab.id ? 600 : 400,
                    color: sourceMode === tab.id ? '#0D9488' : '#64748B',
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

              {/* SKILLS TAB */}
              {sourceMode === 'skills' && (
                <>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 16 }}>Select a dataset from your active skills</div>
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
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            width: '100%', padding: '12px 14px', marginBottom: 8,
                            background: isAvailable ? 'white' : '#FAFAFA',
                            border: `0.5px solid ${isAvailable ? '#E2E8F0' : '#F1F5F9'}`,
                            borderRadius: 8, cursor: isAvailable ? 'pointer' : 'not-allowed',
                            opacity: isAvailable ? 1 : 0.5, textAlign: 'left',
                          }}
                          onMouseEnter={e => { if (isAvailable) (e.currentTarget as HTMLElement).style.borderColor = '#0D9488'; }}
                          onMouseLeave={e => { if (isAvailable) (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#1E293B', marginBottom: 2 }}>{source.label}</div>
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
                </>
              )}

              {/* SAVED QUERIES TAB */}
              {sourceMode === 'queries' && (
                <>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 16 }}>Select a saved query to chart its results</div>
                  {queriesLoading ? (
                    <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 24 }}>Loading queries...</div>
                  ) : savedQueries.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 24 }}>
                      No saved queries yet. Create one in the SQL editor.
                    </div>
                  ) : (
                    savedQueries.map(q => (
                      <button
                        key={q.id}
                        onClick={() => !queryRunLoading && runSavedQuery(q)}
                        disabled={queryRunLoading}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          width: '100%', padding: '12px 14px', marginBottom: 8,
                          background: 'white', border: '0.5px solid #E2E8F0',
                          borderRadius: 8, cursor: queryRunLoading ? 'wait' : 'pointer', textAlign: 'left',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#0D9488'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#1E293B', marginBottom: 2 }}>{q.name}</div>
                          {q.description && <div style={{ fontSize: 11, color: '#64748B' }}>{q.description}</div>}
                        </div>
                        <div style={{ fontSize: 11, color: '#0D9488', flexShrink: 0, marginLeft: 12 }}>
                          {q.last_run_rows != null ? `${q.last_run_rows} rows` : 'Run →'}
                        </div>
                      </button>
                    ))
                  )}
                  {queryRunLoading && (
                    <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 12 }}>Running query…</div>
                  )}
                </>
              )}

              {/* LIVE QUERY TAB */}
              {sourceMode === 'live' && (
                <>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 16 }}>Build a live query from whitelisted fields</div>
                  {schemaLoading ? (
                    <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 24 }}>Loading schema...</div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Entity type</label>
                        <select
                          value={liveEntityType}
                          onChange={e => {
                            const et = e.target.value;
                            setLiveEntityType(et);
                            const fields = liveSchema[et] || [];
                            setLiveGroupBy(fields[0]?.name || '');
                            setLiveAggField(fields[1]?.name || '*');
                            setLiveFilters([]);
                            setFilterExpandedIdx(null);
                            loadFillRates(et);
                          }}
                          style={{ width: '100%', padding: '7px 10px', border: '0.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, background: 'white', color: '#1E293B' }}
                        >
                          {Object.keys(liveSchema).map(et => (
                            <option key={et} value={et}>{et.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Group by</label>
                        <FieldPicker
                          fields={liveSchema[liveEntityType] || []}
                          fillRates={liveFillRates[liveEntityType] || {}}
                          value={liveGroupBy}
                          onChange={setLiveGroupBy}
                        />
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Aggregate</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <select
                            value={liveAggFunc}
                            onChange={e => setLiveAggFunc(e.target.value)}
                            style={{ flex: 1, padding: '7px 10px', border: '0.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, background: 'white', color: '#1E293B' }}
                          >
                            <option value="COUNT">COUNT</option>
                            <option value="SUM">SUM</option>
                            <option value="AVG">AVG</option>
                          </select>
                          <select
                            value={liveAggField}
                            onChange={e => setLiveAggField(e.target.value)}
                            style={{ flex: 2, padding: '7px 10px', border: '0.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, background: 'white', color: '#1E293B' }}
                          >
                            <option value="*">* (all rows)</option>
                            {(liveSchema[liveEntityType] || []).map(f => (
                              <option key={f.name} value={f.name}>{f.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filters</label>
                          <button
                            onClick={() => {
                              const firstField = (liveSchema[liveEntityType] || [])[0];
                              setLiveFilters(prev => [...prev, { field: firstField?.name || '', operator: '=', value: '' }]);
                              if (firstField?.field_type === 'categorical') {
                                loadFieldValues(liveEntityType, firstField.name);
                              }
                            }}
                            style={{ fontSize: 11, color: '#0D9488', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            + Add filter
                          </button>
                        </div>
                        {liveFilters.map((f, i) => {
                          const fieldDef = (liveSchema[liveEntityType] || []).find(fld => fld.name === f.field);
                          const isCategorical = fieldDef?.field_type === 'categorical';
                          const isNumericOrDate = fieldDef?.field_type === 'numeric' || fieldDef?.field_type === 'date';
                          const picklist = fieldValues[liveEntityType]?.[f.field] || [];
                          const picklistLoading = fieldValuesLoading[liveEntityType]?.[f.field] || false;
                          const currentFillRate = (liveFillRates[liveEntityType] || {})[f.field];
                          const isFieldExpanded = filterExpandedIdx === i;
                          return (
                            <div key={i} style={{ marginBottom: 6 }}>
                              {/* Compact row: field trigger + operator + value + × */}
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <button
                                  onClick={() => setFilterExpandedIdx(isFieldExpanded ? null : i)}
                                  style={{
                                    flex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '5px 8px', border: `0.5px solid ${isFieldExpanded ? '#0D9488' : '#E2E8F0'}`,
                                    borderRadius: 5, fontSize: 11, background: isFieldExpanded ? '#F0FDFA' : 'white',
                                    color: '#1E293B', cursor: 'pointer', textAlign: 'left',
                                  }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {fieldDef?.label || f.field || '— field —'}
                                  </span>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                    {currentFillRate !== undefined && (
                                      <span style={{ fontSize: 9, color: '#94A3B8', background: '#F1F5F9', borderRadius: 3, padding: '1px 3px' }}>{currentFillRate}%</span>
                                    )}
                                    <span style={{ fontSize: 8, color: '#94A3B8' }}>▾</span>
                                  </span>
                                </button>
                                <select
                                  value={f.operator}
                                  onChange={e => setLiveFilters(prev => prev.map((x, j) => j === i ? { ...x, operator: e.target.value } : x))}
                                  style={{ flex: 1, padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, background: 'white', color: '#1E293B' }}
                                >
                                  <option value="=">=</option>
                                  <option value="!=">!=</option>
                                  {isNumericOrDate && <option value=">">&gt;</option>}
                                  {isNumericOrDate && <option value="<">&lt;</option>}
                                  {isNumericOrDate && <option value=">=">&gt;=</option>}
                                  {isNumericOrDate && <option value="<=">&lt;=</option>}
                                  {!isCategorical && <option value="LIKE">LIKE</option>}
                                </select>
                                {isCategorical ? (
                                  <select
                                    value={f.value}
                                    onChange={e => setLiveFilters(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                                    onFocus={() => loadFieldValues(liveEntityType, f.field)}
                                    style={{ flex: 2, padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, background: 'white', color: '#1E293B' }}
                                  >
                                    <option value="">{picklistLoading ? 'Loading…' : '— pick value —'}</option>
                                    {picklist.map(v => (
                                      <option key={v} value={v}>{v}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    value={f.value}
                                    onChange={e => setLiveFilters(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                                    placeholder="value"
                                    type={fieldDef?.field_type === 'numeric' ? 'number' : 'text'}
                                    style={{ flex: 2, padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, color: '#1E293B' }}
                                  />
                                )}
                                <button
                                  onClick={() => { setLiveFilters(prev => prev.filter((_, j) => j !== i)); if (isFieldExpanded) setFilterExpandedIdx(null); }}
                                  style={{ fontSize: 13, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
                                >×</button>
                              </div>
                              {/* Expanded field picker panel */}
                              {isFieldExpanded && (
                                <div style={{ marginTop: 4, padding: 8, border: '0.5px solid #E2E8F0', borderRadius: 6, background: '#FAFAFA' }}>
                                  <FieldPicker
                                    fields={liveSchema[liveEntityType] || []}
                                    fillRates={liveFillRates[liveEntityType] || {}}
                                    value={f.field}
                                    onChange={newField => {
                                      setLiveFilters(prev => prev.map((x, j) => j === i ? { ...x, field: newField, value: '' } : x));
                                      const newFieldDef = (liveSchema[liveEntityType] || []).find(fld => fld.name === newField);
                                      if (newFieldDef?.field_type === 'categorical') {
                                        loadFieldValues(liveEntityType, newField);
                                      }
                                      setFilterExpandedIdx(null);
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                          Date range (optional)
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={e => setDateFrom(e.target.value)}
                            placeholder="From"
                            style={{ flex: 1, padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, color: '#1E293B' }}
                          />
                          <input
                            type="date"
                            value={dateTo}
                            onChange={e => setDateTo(e.target.value)}
                            placeholder="To"
                            style={{ flex: 1, padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, color: '#1E293B' }}
                          />
                        </div>
                        <select
                          value={dateField}
                          onChange={e => setDateField(e.target.value)}
                          style={{ width: '100%', padding: '5px 8px', border: '0.5px solid #E2E8F0', borderRadius: 5, fontSize: 11, background: 'white', color: '#1E293B' }}
                        >
                          <option value="">— select date field —</option>
                          {(liveSchema[liveEntityType] || [])
                            .filter(f => f.field_type === 'date')
                            .map(f => (
                              <option key={f.name} value={f.name}>{f.label}</option>
                            ))}
                        </select>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Limit (rows returned)</label>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={liveLimit}
                          onChange={e => setLiveLimit(Math.min(1000, Math.max(1, parseInt(e.target.value) || 100)))}
                          style={{ width: '100%', padding: '7px 10px', border: '0.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, color: '#1E293B' }}
                        />
                      </div>

                      <button
                        onClick={runLiveQuery}
                        disabled={liveRunLoading || !liveEntityType || !liveGroupBy}
                        style={{
                          width: '100%', padding: '10px',
                          background: liveRunLoading || !liveEntityType ? '#CBD5E1' : '#0D9488',
                          border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                          color: 'white', cursor: liveRunLoading ? 'wait' : 'pointer',
                        }}
                      >
                        {liveRunLoading ? 'Running…' : 'Run query →'}
                      </button>
                    </>
                  )}
                </>
              )}

            </div>
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

        {/* VIEW: pick_query_columns */}
        {view === 'pick_query_columns' && queryRunData && (
          <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>
              Map columns to chart axes
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 20 }}>
              Query returned {queryRunData.rows.length} rows · {queryRunData.columns.length} columns
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Label column (X axis / categories)</label>
              <select
                value={queryLabelCol}
                onChange={e => setQueryLabelCol(e.target.value)}
                style={{ width: '100%', ...inputStyle }}
              >
                {queryRunData.columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Value column (Y axis / measure)</label>
              <select
                value={queryValueCol}
                onChange={e => setQueryValueCol(e.target.value)}
                style={{ width: '100%', ...inputStyle }}
              >
                {queryRunData.columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Preview ({Math.min(queryRunData.rows.length, limit)} of {queryRunData.rows.length} rows)</label>
              <div style={{ border: '0.5px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                {queryRunData.rows.slice(0, 8).map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: i < 7 ? '0.5px solid #F8FAFC' : 'none', fontSize: 11 }}>
                    <span style={{ color: '#374151' }}>{String(row[queryLabelCol] ?? '—')}</span>
                    <span style={{ color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{String(row[queryValueCol] ?? '—')}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => {
                setSourceMode('queries');
                setView('refine');
                setTimeout(() => triggerPreviewRef.current(), 200);
              }}
              disabled={!queryLabelCol || !queryValueCol}
              style={{
                width: '100%', padding: '10px',
                background: !queryLabelCol || !queryValueCol ? '#CBD5E1' : '#0D9488',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                color: 'white', cursor: 'pointer',
              }}
            >
              Continue to refine →
            </button>
          </div>
        )}

        {/* VIEW: refine */}
        {view === 'refine' && (sourceMode === 'skills' ? (selectedSource && selectedField) : queryRunData) && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', overflow: 'hidden' }}>

            {/* LEFT: Preview */}
            <div style={{
              padding: 20,
              borderRight: '0.5px solid #E2E8F0',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
                Preview
              </div>

              {(recordsLoading || queryRunLoading || liveRunLoading) ? (
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
                      padding: '8px 12px', marginBottom: 6,
                      background: v.type === 'error' ? '#FEF2F2' : '#FFFBEB',
                      border: `0.5px solid ${v.type === 'error' ? '#FECACA' : '#FDE68A'}`,
                      borderRadius: 6, fontSize: 11,
                      color: v.type === 'error' ? '#991B1B' : '#92400E',
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                    }}>
                      <span>{v.type === 'error' ? '✕' : '⚠'}</span>
                      <div>
                        {v.message}
                        {v.action && (
                          <button onClick={v.action.fn} style={{ marginLeft: 8, color: '#0D9488', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
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
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>State what the chart proves, not what it shows</div>
              </div>

              {/* Chart type */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Chart type</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['bar', 'horizontal_bar', 'line', 'donut', 'stacked_bar', 'waterfall', 'funnel', 'bullet', 'heatmap', 'combo', 'scatter'] as const).map(type => {
                    const labels: Record<ChartTypeOption, string> = {
                      bar: 'Bar',
                      horizontal_bar: 'Horizontal',
                      line: 'Line',
                      donut: 'Donut',
                      stacked_bar: 'Stacked',
                      waterfall: 'Waterfall',
                      funnel: 'Funnel',
                      bullet: 'Bullet',
                      heatmap: 'Heatmap',
                      combo: 'Combo',
                      scatter: 'Scatter',
                    };
                    return (
                      <button
                        key={type}
                        onClick={() => { setChartType(type); setShowLegend(type === 'donut'); debouncedPreview(); }}
                        style={{
                          padding: '5px 10px', fontSize: 11,
                          border: `1px solid ${chartType === type ? '#0D9488' : '#E2E8F0'}`,
                          background: chartType === type ? '#F0FDF9' : 'white',
                          color: chartType === type ? '#0D9488' : '#374151',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        {labels[type]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Series */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Series ({filteredRecords.length} items)</label>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '0.5px solid #E2E8F0', borderRadius: 6 }}>
                  {filteredRecords.map((record, i) => {
                    const displayName = sourceMode === 'skills'
                      ? String(record.entity_name || (selectedSource && record[selectedSource.nameField]) || `Item ${i + 1}`).split(/\s*-\s+/)[0].trim()
                      : String(record[queryLabelCol] || `Item ${i + 1}`);
                    const value = sourceMode === 'skills' && selectedField && selectedSource
                      ? formatValue(extractField(record, selectedField.key, selectedField), numberFormat, selectedField.type)
                      : String(record[queryValueCol] ?? '');
                    return (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '7px 10px',
                        borderBottom: i < filteredRecords.length - 1 ? '0.5px solid #F8FAFC' : 'none',
                        fontSize: 11,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                            background: sourceMode === 'skills' && selectedSource ? resolveColor(record, colorScheme, selectedSource) : '#0D9488',
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>{displayName}</span>
                        </div>
                        <span style={{ color: '#64748B', flexShrink: 0, marginLeft: 8 }}>{value}</span>
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
                    <input type="radio" checked={colorScheme === scheme} onChange={() => { setColorScheme(scheme); debouncedPreview(); }} />
                    <span>{scheme === 'semantic' ? 'Semantic (red=risk, teal=healthy)' : scheme === 'uniform' ? 'Uniform (all teal)' : 'Categorical (by group)'}</span>
                  </label>
                ))}
              </div>

              {/* Number format — skills only */}
              {sourceMode === 'skills' && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Number format</label>
                  {(['K', 'M', 'raw', 'pct'] as const).map(fmt => (
                    <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input type="radio" checked={numberFormat === fmt} onChange={() => { setNumberFormat(fmt); debouncedPreview(); }} />
                      <span>{fmt === 'K' ? '$K (e.g. $273K)' : fmt === 'M' ? '$M (e.g. $1.2M)' : fmt === 'pct' ? '% (e.g. 93%)' : 'Raw (e.g. 273,000)'}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Sort — skills mode only (hide for charts with meaningful order) */}
              {sourceMode === 'skills' && selectedSource && !['funnel', 'waterfall', 'heatmap', 'scatter'].includes(chartType) && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Sort by</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={sortField || selectedSource.defaultSort.field}
                      onChange={e => { setSortField(e.target.value); debouncedPreview(); }}
                      style={{ flex: 1, ...inputStyle }}
                    >
                      {selectedSource.fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
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
              )}

              {/* Sort dir — query mode (hide for charts with meaningful order) */}
              {sourceMode !== 'skills' && !['funnel', 'waterfall', 'heatmap', 'scatter'].includes(chartType) && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Sort</label>
                  <select value={sortDir} onChange={e => { setSortDir(e.target.value as 'asc' | 'desc'); debouncedPreview(); }} style={{ width: '100%', ...inputStyle }}>
                    <option value="desc">High → Low</option>
                    <option value="asc">Low → High</option>
                  </select>
                </div>
              )}

              {/* Limit */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Show top {limit} items</label>
                <input
                  type="range" min={2} max={10} value={limit}
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
                  <input type="checkbox" checked={showLegend} onChange={e => { setShowLegend(e.target.checked); debouncedPreview(); }} />
                  Show legend
                </label>
              </div>

              {/* Bullet chart: target value */}
              {chartType === 'bullet' && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Target value</label>
                  <input
                    type="number"
                    value={targetValue}
                    onChange={e => { setTargetValue(e.target.value === '' ? '' : Number(e.target.value)); debouncedPreview(); }}
                    placeholder="e.g. 100000"
                    style={{ width: '100%', ...inputStyle }}
                  />
                  <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                    Target line marker for comparison
                  </div>
                </div>
              )}

              {/* Combo chart: secondary series label */}
              {chartType === 'combo' && (
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Line series label</label>
                  <input
                    type="text"
                    value={comboSeriesLabel}
                    onChange={e => { setComboSeriesLabel(e.target.value); debouncedPreview(); }}
                    placeholder="e.g. Pipeline Value"
                    style={{ width: '100%', ...inputStyle }}
                  />
                  <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                    Map a second numeric field to 'secondaryValue' in your data source to drive the line series.
                  </div>
                </div>
              )}

              {/* Reference value for benchmarking */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Reference value (optional)</label>
                <input
                  type="number"
                  value={referenceValue}
                  onChange={e => { setReferenceValue(e.target.value === '' ? '' : Number(e.target.value)); debouncedPreview(); }}
                  placeholder="e.g. 100000"
                  style={{ width: '100%', ...inputStyle }}
                />
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                  Benchmark line for comparison (renders across all series)
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '0.5px solid #E2E8F0' }}>
                <button
                  onClick={onCancel}
                  style={{ flex: 1, padding: '8px', background: 'none', border: '0.5px solid #CBD5E1', borderRadius: 6, fontSize: 12, color: '#64748B', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleInsert}
                  disabled={hasErrors || !chartTitle.trim() || inserting}
                  style={{
                    flex: 2, padding: '8px',
                    background: hasErrors || !chartTitle.trim() ? '#CBD5E1' : '#0D9488',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'white',
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

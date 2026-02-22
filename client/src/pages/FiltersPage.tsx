import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useIsMobile } from '../hooks/useIsMobile';
import { useLens } from '../contexts/LensContext';

interface NamedFilter {
  id: string;
  label: string;
  description?: string;
  object: string;
  conditions: FilterConditionGroup;
  source: string;
  confidence: number;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  usage_count?: number;
  last_used_at?: string;
}

interface FilterConditionGroup {
  operator: 'AND' | 'OR';
  conditions: FilterCondition[];
}

interface FilterCondition {
  field: string;
  operator: string;
  value: any;
}

interface FieldOption {
  field: string;
  label: string;
  type: string;
  values?: string[];
}

interface PreviewResult {
  record_count: number;
  sample_records: any[];
  sql_preview: string;
}

const ENTITY_TYPES = [
  { value: 'deals', label: 'Deals', icon: '\u25C6' },
  { value: 'contacts', label: 'Contacts', icon: '\u25CB' },
  { value: 'accounts', label: 'Accounts', icon: '\u25C7' },
  { value: 'conversations', label: 'Conversations', icon: '\u25AC' },
];

const OPERATORS: Record<string, { label: string; types: string[] }> = {
  eq: { label: 'equals', types: ['text', 'number', 'date', 'boolean'] },
  neq: { label: 'not equals', types: ['text', 'number', 'date'] },
  gt: { label: 'greater than', types: ['number', 'date'] },
  gte: { label: 'at least', types: ['number', 'date'] },
  lt: { label: 'less than', types: ['number', 'date'] },
  lte: { label: 'at most', types: ['number', 'date'] },
  contains: { label: 'contains', types: ['text'] },
  not_contains: { label: 'does not contain', types: ['text'] },
  is_null: { label: 'is empty', types: ['text', 'number', 'date'] },
  is_not_null: { label: 'is not empty', types: ['text', 'number', 'date'] },
  in: { label: 'is one of', types: ['text'] },
  is_true: { label: 'is true', types: ['boolean'] },
  is_false: { label: 'is false', types: ['boolean'] },
};

function getOperatorsForType(type: string) {
  return Object.entries(OPERATORS)
    .filter(([, v]) => v.types.includes(type))
    .map(([k, v]) => ({ value: k, label: v.label }));
}

const entityColors: Record<string, string> = {
  deals: '#3b82f6',
  contacts: '#a78bfa',
  accounts: '#22c55e',
  conversations: '#f59e0b',
};

export default function FiltersPage() {
  const isMobile = useIsMobile();
  const { refreshFilters } = useLens();
  const [filters, setFilters] = useState<NamedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editFilter, setEditFilter] = useState<NamedFilter | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, { count: number; loading: boolean }>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchFilters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/filters');
      setFilters(res.filters || []);
    } catch {
      setError('Failed to load filters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFilters(); }, [fetchFilters]);

  const handlePreview = async (filterId: string) => {
    setPreviewData(prev => ({ ...prev, [filterId]: { count: 0, loading: true } }));
    try {
      const res = await api.post(`/filters/${filterId}/preview`);
      setPreviewData(prev => ({ ...prev, [filterId]: { count: res.count, loading: false } }));
    } catch {
      setPreviewData(prev => ({ ...prev, [filterId]: { count: -1, loading: false } }));
    }
  };

  const handleConfirm = async (filterId: string) => {
    try {
      await api.post(`/filters/${filterId}/confirm`);
      fetchFilters();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm filter');
    }
  };

  const handleDelete = async (filterId: string) => {
    try {
      await api.delete(`/filters/${filterId}`);
      setDeleteConfirm(null);
      fetchFilters();
      refreshFilters();
    } catch (err: any) {
      setError(err.message || 'Failed to delete filter');
    }
  };

  const handleSave = async (data: { id: string; label: string; description: string; object: string; conditions: FilterConditionGroup }) => {
    try {
      if (editFilter) {
        await api.put(`/filters/${editFilter.id}`, data);
      } else {
        await api.post('/filters', data);
      }
      setShowModal(false);
      setEditFilter(null);
      fetchFilters();
      refreshFilters();
    } catch (err: any) {
      throw err;
    }
  };

  const groupedFilters: Record<string, NamedFilter[]> = {};
  for (const f of filters) {
    const key = f.object || 'deals';
    if (!groupedFilters[key]) groupedFilters[key] = [];
    groupedFilters[key].push(f);
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            Named Filters
          </h1>
          <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, fontFamily: fonts.sans }}>
            Define reusable business concepts. Apply them as workspace lens, agent scope, or skill filters.
          </p>
        </div>
        <button
          onClick={() => { setEditFilter(null); setShowModal(true); }}
          style={{
            padding: '8px 20px',
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: fonts.sans,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          + Create Filter
        </button>
      </div>

      {error && (
        <div style={{
          padding: '10px 16px', marginBottom: 16,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8, color: '#ef4444', fontSize: 13, fontFamily: fonts.sans,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>&times;</button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 80, background: colors.surface, borderRadius: 10, animation: 'pulse 1.5s infinite', opacity: 0.5 }} />
          ))}
        </div>
      ) : filters.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center',
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{'\u2B21'}</div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: '0 0 8px' }}>
            No filters yet
          </h3>
          <p style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans, maxWidth: 400, margin: '0 auto 20px' }}>
            Create named filters to define business concepts like "At Risk Deals" or "Expansion Opportunities." Use them as workspace lens or agent scope.
          </p>
          <button
            onClick={() => { setEditFilter(null); setShowModal(true); }}
            style={{
              padding: '10px 24px', background: colors.accent, color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              fontFamily: fonts.sans, cursor: 'pointer',
            }}
          >
            + Create Your First Filter
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {ENTITY_TYPES.map(et => {
            const group = groupedFilters[et.value];
            if (!group || group.length === 0) return null;
            return (
              <div key={et.value}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  fontSize: 12, fontWeight: 600, color: colors.textMuted,
                  fontFamily: fonts.mono, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  <span style={{ color: entityColors[et.value] }}>{et.icon}</span>
                  {et.label}
                  <span style={{ fontSize: 11, fontWeight: 400, color: colors.textDim }}>({group.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.map(f => (
                    <FilterCard
                      key={f.id}
                      filter={f}
                      preview={previewData[f.id]}
                      deleteConfirm={deleteConfirm === f.id}
                      onEdit={() => { setEditFilter(f); setShowModal(true); }}
                      onPreview={() => handlePreview(f.id)}
                      onConfirm={() => handleConfirm(f.id)}
                      onDeleteStart={() => setDeleteConfirm(f.id)}
                      onDeleteCancel={() => setDeleteConfirm(null)}
                      onDeleteConfirm={() => handleDelete(f.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <FilterModal
          filter={editFilter}
          onClose={() => { setShowModal(false); setEditFilter(null); }}
          onSave={handleSave}
        />
      )}

      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001,
        }} onClick={() => setDeleteConfirm(null)} />
      )}
    </div>
  );
}

function FilterCard({ filter, preview, deleteConfirm, onEdit, onPreview, onConfirm, onDeleteStart, onDeleteCancel, onDeleteConfirm }: {
  filter: NamedFilter;
  preview?: { count: number; loading: boolean };
  deleteConfirm: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onConfirm: () => void;
  onDeleteStart: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const condCount = filter.conditions?.conditions?.length || 0;
  const eColor = entityColors[filter.object] || colors.textMuted;

  return (
    <div style={{
      padding: '14px 18px',
      background: colors.surface,
      border: `1px solid ${filter.confirmed ? colors.border : 'rgba(245,158,11,0.3)'}`,
      borderRadius: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      transition: 'border-color 0.15s',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
            {filter.label}
          </span>
          {!filter.confirmed && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              textTransform: 'uppercase',
            }}>
              unconfirmed
            </span>
          )}
          {filter.source === 'ai_inferred' && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
              background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
            }}>
              AI-inferred
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, marginBottom: 6 }}>
          {filter.description || `${condCount} condition${condCount !== 1 ? 's' : ''} on ${filter.object}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: colors.textDim }}>
          <span style={{ color: eColor, fontFamily: fonts.mono }}>{filter.object}</span>
          <span>{condCount} condition{condCount !== 1 ? 's' : ''}</span>
          <span>ID: {filter.id}</span>
          {preview && !preview.loading && preview.count >= 0 && (
            <span style={{ color: colors.accent, fontWeight: 600 }}>{preview.count} match{preview.count !== 1 ? 'es' : ''}</span>
          )}
          {preview?.loading && <span style={{ color: colors.textMuted }}>counting...</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <ActionBtn label="Preview" onClick={onPreview} />
        {!filter.confirmed && <ActionBtn label="Confirm" onClick={onConfirm} color="#22c55e" />}
        <ActionBtn label="Edit" onClick={onEdit} />
        {deleteConfirm ? (
          <>
            <ActionBtn label="Yes, delete" onClick={onDeleteConfirm} color="#ef4444" />
            <ActionBtn label="Cancel" onClick={onDeleteCancel} />
          </>
        ) : (
          <ActionBtn label="Delete" onClick={onDeleteStart} color="#ef4444" />
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${color ? `${color}33` : colors.border}`,
        background: hovered ? (color ? `${color}15` : 'rgba(255,255,255,0.04)') : 'transparent',
        color: color || colors.textSecondary,
        fontSize: 11, fontWeight: 500, fontFamily: fonts.sans,
        cursor: 'pointer', transition: 'all 0.1s', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function FilterModal({ filter, onClose, onSave }: {
  filter: NamedFilter | null;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const isEdit = !!filter;
  const [id, setId] = useState(filter?.id || '');
  const [label, setLabel] = useState(filter?.label || '');
  const [description, setDescription] = useState(filter?.description || '');
  const [object, setObject] = useState(filter?.object || 'deals');
  const [conditions, setConditions] = useState<FilterCondition[]>(
    filter?.conditions?.conditions || [{ field: '', operator: 'eq', value: '' }]
  );
  const [groupOp, setGroupOp] = useState<'AND' | 'OR'>(filter?.conditions?.operator || 'AND');
  const [standardFields, setStandardFields] = useState<FieldOption[]>([]);
  const [customFields, setCustomFields] = useState<FieldOption[]>([]);
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([]);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    setFieldLoading(true);
    api.get(`/filters/field-options?object=${object}`)
      .then(res => {
        const std = res.standard_fields || [];
        const cust = res.custom_fields || [];
        setStandardFields(std);
        setCustomFields(cust);
        setFieldOptions([...std, ...cust]);
      })
      .catch(() => { setStandardFields([]); setCustomFields([]); setFieldOptions([]); })
      .finally(() => setFieldLoading(false));
  }, [object]);

  const autoId = (lbl: string) => lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  const handleLabelChange = (val: string) => {
    setLabel(val);
    if (!isEdit) setId(autoId(val));
  };

  const addCondition = () => setConditions([...conditions, { field: '', operator: 'eq', value: '' }]);
  const removeCondition = (idx: number) => setConditions(conditions.filter((_, i) => i !== idx));
  const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
    setConditions(conditions.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  const handlePreview = async () => {
    const validConditions = conditions.filter(c => c.field && c.operator);
    if (validConditions.length === 0) return;
    setPreviewLoading(true);
    try {
      const res = await api.post('/filters/preview-inline', {
        object,
        conditions: { operator: groupOp, conditions: validConditions },
      });
      setPreview(res);
    } catch (err: any) {
      setError(err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setPreview(null);
    const noValueOps = ['is_null', 'is_not_null', 'is_true', 'is_false'];
    const ready = conditions.filter(c => c.field && c.operator && (noValueOps.includes(c.operator) || (c.value !== '' && c.value !== undefined)));
    if (ready.length === 0) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      setPreviewLoading(true);
      api.post('/filters/preview-inline', {
        object,
        conditions: { operator: groupOp, conditions: ready },
      }).then(res => setPreview(res))
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    }, 500);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [conditions, groupOp, object]);

  const handleSubmit = async () => {
    if (!id || !label || conditions.filter(c => c.field).length === 0) {
      setError('Name and at least one condition are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const validConditions = conditions.filter(c => c.field && c.operator);
      await onSave({
        id,
        label,
        description,
        object,
        conditions: { operator: groupOp, conditions: validConditions },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const getFieldType = (fieldName: string) => {
    const f = fieldOptions.find(fo => fo.field === fieldName);
    return f?.type || 'text';
  };

  const getFieldValues = (fieldName: string) => {
    const f = fieldOptions.find(fo => fo.field === fieldName);
    return f?.values || [];
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '90%', maxWidth: 640, maxHeight: '85vh', overflow: 'auto',
          background: colors.bg, border: `1px solid ${colors.border}`,
          borderRadius: 14, padding: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            {isEdit ? 'Edit Filter' : 'Create Named Filter'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 16, borderRadius: 6,
            background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 12, fontFamily: fonts.sans,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel>Name</FieldLabel>
            <input
              value={label}
              onChange={e => handleLabelChange(e.target.value)}
              placeholder="e.g. At Risk Deals"
              style={inputStyle}
            />
            {!isEdit && id && (
              <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4, fontFamily: fonts.mono }}>
                ID: {id}
              </div>
            )}
          </div>

          <div>
            <FieldLabel>Description (optional)</FieldLabel>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of what this filter captures"
              style={inputStyle}
            />
          </div>

          <div>
            <FieldLabel>Entity Type</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {ENTITY_TYPES.map(et => (
                <button
                  key={et.value}
                  onClick={() => { setObject(et.value); setConditions([{ field: '', operator: 'eq', value: '' }]); }}
                  disabled={isEdit}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${object === et.value ? colors.accent : colors.border}`,
                    background: object === et.value ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: object === et.value ? colors.accent : colors.textSecondary,
                    fontSize: 13, fontFamily: fonts.sans, fontWeight: 500,
                    cursor: isEdit ? 'not-allowed' : 'pointer',
                    opacity: isEdit && object !== et.value ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {et.icon} {et.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <FieldLabel style={{ marginBottom: 0 }}>Conditions</FieldLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: colors.textMuted }}>Match</span>
                {(['AND', 'OR'] as const).map(op => (
                  <button
                    key={op}
                    onClick={() => setGroupOp(op)}
                    style={{
                      padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${groupOp === op ? colors.accent : colors.border}`,
                      background: groupOp === op ? 'rgba(99,102,241,0.12)' : 'transparent',
                      color: groupOp === op ? colors.accent : colors.textMuted,
                      cursor: 'pointer', fontFamily: fonts.mono,
                    }}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conditions.map((cond, idx) => {
                const fType = getFieldType(cond.field);
                const fValues = getFieldValues(cond.field);
                const operators = getOperatorsForType(fType);
                const needsValue = !['is_null', 'is_not_null', 'is_true', 'is_false'].includes(cond.operator);

                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`, borderRadius: 8,
                  }}>
                    <select
                      value={cond.field}
                      onChange={e => {
                        const newField = e.target.value;
                        const newType = fieldOptions.find(fo => fo.field === newField)?.type || 'text';
                        const defaultOp = newType === 'boolean' ? 'is_true' : 'eq';
                        updateCondition(idx, { field: newField, operator: defaultOp, value: '' });
                      }}
                      style={selectStyle}
                    >
                      <option value="">{fieldLoading ? 'Loading...' : 'Field...'}</option>
                      {standardFields.length > 0 && (
                        <optgroup label="Standard Fields">
                          {standardFields.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                        </optgroup>
                      )}
                      {customFields.length > 0 && (
                        <optgroup label="Custom Fields">
                          {customFields.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                        </optgroup>
                      )}
                    </select>

                    <select
                      value={cond.operator}
                      onChange={e => updateCondition(idx, { operator: e.target.value })}
                      style={{ ...selectStyle, maxWidth: 140 }}
                    >
                      {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>

                    {needsValue && (
                      fType === 'boolean' ? (
                        <select
                          value={cond.value ?? ''}
                          onChange={e => updateCondition(idx, { value: e.target.value })}
                          style={selectStyle}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : fValues.length > 0 ? (
                        <select
                          value={cond.value}
                          onChange={e => updateCondition(idx, { value: e.target.value })}
                          style={selectStyle}
                        >
                          <option value="">Value...</option>
                          {fValues.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input
                          value={cond.value ?? ''}
                          onChange={e => {
                            const val = fType === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
                            updateCondition(idx, { value: val });
                          }}
                          placeholder={fType === 'date' ? 'YYYY-MM-DD' : 'Value...'}
                          type={fType === 'number' ? 'number' : 'text'}
                          style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                        />
                      )
                    )}

                    {conditions.length > 1 && (
                      <button
                        onClick={() => removeCondition(idx)}
                        style={{
                          background: 'none', border: 'none', color: '#ef4444',
                          fontSize: 16, cursor: 'pointer', padding: '0 4px', flexShrink: 0,
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={addCondition}
              style={{
                marginTop: 8, padding: '6px 14px', borderRadius: 6,
                border: `1px dashed ${colors.border}`, background: 'transparent',
                color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sans,
                cursor: 'pointer',
              }}
            >
              + Add Condition
            </button>
          </div>

          {preview && (
            <div style={{
              padding: '12px 16px', background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`, borderRadius: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6, fontFamily: fonts.sans }}>
                Preview: <span style={{ color: colors.accent }}>{preview.record_count}</span> matching records
              </div>
              {preview.sample_records.length > 0 && (
                <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                  {preview.sample_records.map((r: any, i: number) => (
                    <div key={i} style={{ padding: '2px 0', borderBottom: i < preview.sample_records.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                      {Object.entries(r).filter(([k]) => k !== 'id').map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
          <button
            onClick={handlePreview}
            disabled={previewLoading || conditions.filter(c => c.field).length === 0}
            style={{
              padding: '8px 20px', borderRadius: 8,
              border: `1px solid ${colors.border}`, background: 'transparent',
              color: colors.textSecondary, fontSize: 13, fontWeight: 500,
              fontFamily: fonts.sans, cursor: 'pointer',
              opacity: previewLoading ? 0.6 : 1,
            }}
          >
            {previewLoading ? 'Counting...' : 'Preview Matches'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px', borderRadius: 8,
                border: `1px solid ${colors.border}`, background: 'transparent',
                color: colors.textSecondary, fontSize: 13, fontWeight: 500,
                fontFamily: fonts.sans, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: '8px 24px', borderRadius: 8,
                border: 'none', background: colors.accent,
                color: '#fff', fontSize: 13, fontWeight: 600,
                fontFamily: fonts.sans, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : isEdit ? 'Update Filter' : 'Create Filter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{
      display: 'block', fontSize: 12, fontWeight: 600, color: colors.textSecondary,
      fontFamily: fonts.sans, marginBottom: 6, textTransform: 'uppercase',
      letterSpacing: '0.04em', ...style,
    }}>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: `1px solid ${colors.border}`, background: colors.surface,
  color: colors.text, fontSize: 13, fontFamily: fonts.sans,
  outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  flex: 1, padding: '6px 8px', borderRadius: 6,
  border: `1px solid ${colors.border}`, background: colors.surface,
  color: colors.text, fontSize: 12, fontFamily: fonts.sans,
  outline: 'none', minWidth: 0,
};

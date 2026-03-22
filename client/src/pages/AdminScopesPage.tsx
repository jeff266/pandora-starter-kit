import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useDemoMode } from '../contexts/DemoModeContext';

// ============================================================================
// Types
// ============================================================================

interface ScopeRow {
  scope_id: string;
  name: string;
  filter_field: string;
  filter_values: string[];
  deal_count: number;
  confirmed: boolean;
  confidence: number | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  field_overrides?: Record<string, any>;
}

interface NumericField {
  key: string;
  label: string;
}

interface ScopesResponse {
  scopes: ScopeRow[];
  total_deals: number;
  unscoped_deals: number;
  has_confirmed_scopes: boolean;
}

interface DealPreview {
  id: string;
  name: string;
  amount: number | null;
  stage: string | null;
  close_date: string | null;
  owner_email: string | null;
  pipeline: string | null;
  deal_type: string | null;
  scope_id: string;
  scope_override: string | null;
}

interface InferredScope {
  scope_id: string;
  name: string;
  filter_field: string;
  filter_values: string[];
  confidence: number;
  source: string;
  deal_count: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatFilter(field: string, values: string[]): string {
  if (field === '1=1' || values.length === 0) return 'All Deals';
  const displayField = field.includes("custom_fields->>'")
    ? field.replace(/custom_fields->>'([^']+)'/, '$1')
    : field;
  return `${displayField} IN [${values.join(', ')}]`;
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '—';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function formatConfidence(confidence: number | null): string {
  if (confidence == null) return '—';
  return `${Math.round(confidence * 100)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function deriveAdapterSource(scopes: ScopeRow[]): string {
  for (const s of scopes) {
    if (s.source?.startsWith('hubspot')) return 'HubSpot';
    if (s.source?.startsWith('salesforce')) return 'Salesforce';
    if (s.source?.startsWith('custom_field')) return 'Custom Field';
  }
  return 'CSV Import / Unknown';
}

function deriveLastInference(scopes: ScopeRow[]): string {
  const nonDefault = scopes.filter(s => s.scope_id !== 'default');
  if (nonDefault.length === 0) return 'Never';
  const latest = nonDefault.reduce((a, b) =>
    new Date(a.updated_at) > new Date(b.updated_at) ? a : b
  );
  return new Date(latest.updated_at).toLocaleString();
}

// ============================================================================
// Styles
// ============================================================================

const panelStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 24,
  marginBottom: 24,
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: colors.text,
  marginBottom: 16,
  fontFamily: fonts.sans,
  letterSpacing: '0.02em',
  textTransform: 'uppercase' as const,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left' as const,
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: colors.textMuted,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.border}`,
  fontFamily: fonts.sans,
  whiteSpace: 'nowrap' as const,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  color: colors.text,
  fontFamily: fonts.sans,
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle' as const,
};

const monoStyle: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 12,
  color: colors.textSecondary,
};

function Badge({ confirmed }: { confirmed: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      fontFamily: fonts.sans,
      background: confirmed ? colors.greenSoft : colors.yellowSoft,
      color: confirmed ? colors.green : colors.yellow,
    }}>
      {confirmed ? 'Yes' : 'Pending'}
    </span>
  );
}

function Button({
  onClick, children, disabled, variant = 'primary',
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const base: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fonts.sans,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap' as const,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: colors.accent, color: '#fff' },
    secondary: { background: colors.surfaceRaised, color: colors.text, border: `1px solid ${colors.border}` },
    ghost: { background: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}` },
  };
  return (
    <button style={{ ...base, ...variants[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ============================================================================
// Field Overrides Expander — per scope
// ============================================================================

function FieldOverridesExpander({
  scope,
  numericFields,
  onSave,
}: {
  scope: ScopeRow;
  numericFields: NumericField[];
  onSave: (scopeId: string, overrides: Record<string, any>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const overrides = scope.field_overrides || {};
  const currentValueField = overrides.value_field || '';
  const currentValueFormula = overrides.value_formula || '';

  const [valueField, setValueField] = useState(currentValueField);
  const [valueFormula, setValueFormula] = useState(currentValueFormula);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleFieldChange = (v: string) => { setValueField(v); setDirty(true); setSavedOk(false); setSaveError(null); };
  const handleFormulaChange = (v: string) => { setValueFormula(v); setDirty(true); setSavedOk(false); setSaveError(null); };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, any> = {};
      if (valueField) payload.value_field = valueField;
      else payload.value_field = null;
      if (valueFormula.trim()) payload.value_formula = valueFormula.trim();
      else payload.value_formula = null;
      await onSave(scope.scope_id, payload);
      setDirty(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const hasOverrides = !!(overrides.value_field || overrides.value_formula);

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: fonts.sans,
          color: hasOverrides ? colors.accent : colors.textMuted,
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        Field Overrides
        {hasOverrides && <span style={{
          marginLeft: 4,
          padding: '1px 5px',
          borderRadius: 8,
          fontSize: 10,
          background: colors.accentSoft,
          color: colors.accent,
          fontWeight: 700,
        }}>configured</span>}
      </button>

      {open && (
        <div style={{
          marginTop: 8,
          padding: '12px 14px',
          background: colors.surfaceRaised,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 12 }}>
            Override the value field for <strong style={{ color: colors.text }}>{scope.name}</strong> scope.
            Leave blank to use the workspace default.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>
                Value Field
              </label>
              <select
                value={valueField}
                onChange={e => handleFieldChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 5,
                  fontSize: 12,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                }}
              >
                <option value="">— use workspace default —</option>
                {numericFields.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>
                Value Formula (optional)
              </label>
              <input
                type="text"
                value={valueFormula}
                onChange={e => handleFormulaChange(e.target.value)}
                placeholder="{arr_value} / 12"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 5,
                  fontSize: 12,
                  color: colors.text,
                  fontFamily: fonts.mono,
                  boxSizing: 'border-box' as const,
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{
                padding: '5px 14px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: fonts.sans,
                background: dirty && !saving ? colors.accent : colors.surfaceRaised,
                color: dirty && !saving ? '#fff' : colors.textMuted,
                border: 'none',
                cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedOk && (
              <span style={{ fontSize: 11, color: colors.green, fontFamily: fonts.sans }}>Saved</span>
            )}
            {saveError && (
              <span style={{ fontSize: 11, color: colors.red, fontFamily: fonts.sans }}>{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Panel 1: Scope Inventory
// ============================================================================

function ScopeInventoryPanel({
  data,
  loading,
  onConfirm,
  onReInfer,
  confirmingId,
  reInferring,
  anon,
  numericFields,
  onSaveFieldOverrides,
}: {
  data: ScopesResponse | null;
  loading: boolean;
  onConfirm: (scopeId: string) => void;
  onReInfer: () => void;
  confirmingId: string | null;
  reInferring: boolean;
  anon: ReturnType<typeof useDemoMode>['anon'];
  numericFields: NumericField[];
  onSaveFieldOverrides: (scopeId: string, overrides: Record<string, any>) => Promise<void>;
}) {
  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={panelTitleStyle}>Analysis Scopes</div>
        <Button onClick={onReInfer} disabled={reInferring} variant="secondary">
          {reInferring ? 'Running...' : 'Re-run Inference'}
        </Button>
      </div>

      {loading ? (
        <div style={{ color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans }}>Loading...</div>
      ) : !data || data.scopes.length === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans, padding: '16px 0' }}>
          No scopes found. Run inference after syncing deal data.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Scope ID</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Filter</th>
                  <th style={thStyle}>Deals</th>
                  <th style={thStyle}>Confirmed</th>
                  <th style={thStyle}>Confidence</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.scopes.map(scope => (
                  <React.Fragment key={scope.scope_id}>
                    <tr style={{ background: 'transparent' }}>
                      <td style={tdStyle}>
                        <span style={monoStyle}>{scope.scope_id}</span>
                      </td>
                      <td style={tdStyle}>{anon.pipeline(scope.name)}</td>
                      <td style={{ ...tdStyle, maxWidth: 260 }}>
                        <span style={{ ...monoStyle, fontSize: 11 }}>
                          {formatFilter(scope.filter_field, scope.filter_values)}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{scope.deal_count.toLocaleString()}</td>
                      <td style={tdStyle}><Badge confirmed={scope.confirmed} /></td>
                      <td style={tdStyle}>{formatConfidence(scope.confidence)}</td>
                      <td style={{ ...tdStyle, color: colors.textSecondary, fontSize: 12 }}>
                        {scope.source || '—'}
                      </td>
                      <td style={tdStyle}>
                        {!scope.confirmed && (
                          <Button
                            onClick={() => onConfirm(scope.scope_id)}
                            disabled={confirmingId === scope.scope_id}
                            variant="primary"
                          >
                            {confirmingId === scope.scope_id ? 'Confirming...' : 'Confirm'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    <tr style={{ background: 'transparent' }}>
                      <td colSpan={8} style={{ padding: '0 12px 10px', borderBottom: `1px solid ${colors.border}` }}>
                        <FieldOverridesExpander
                          scope={scope}
                          numericFields={numericFields}
                          onSave={onSaveFieldOverrides}
                        />
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stats row */}
          <div style={{ marginTop: 16, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}>
              Total deals: <span style={{ color: colors.text, fontWeight: 600 }}>{data.total_deals.toLocaleString()}</span>
            </div>
            {data.has_confirmed_scopes && data.unscoped_deals > 0 && (
              <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}>
                Unscoped deals: <span style={{ color: colors.yellow, fontWeight: 600 }}>{data.unscoped_deals.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Unscoped warning — only when has_confirmed_scopes=true AND unscoped_deals > 0 */}
          {data.has_confirmed_scopes && data.unscoped_deals > 0 && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: colors.yellowSoft,
              border: `1px solid ${colors.yellow}`,
              borderRadius: 6,
              fontSize: 13,
              color: colors.yellow,
              fontFamily: fonts.sans,
            }}>
              {data.unscoped_deals.toLocaleString()} deals didn't match any scope and are falling back to 'default'.
              Check your scope filters in the preview below.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Panel 2: Filter Preview
// ============================================================================

function FilterPreviewPanel({
  scopes,
  selectedScopeId,
  onSelectScope,
  deals,
  loadingPreview,
  scopeName,
  overrideCount,
  showOverridesOnly,
  onToggleOverridesOnly,
  onOverrideDeal,
  onClearOverride,
  overridingDealId,
  anon,
  valueFieldLabel,
}: {
  scopes: ScopeRow[];
  selectedScopeId: string | null;
  onSelectScope: (scopeId: string) => void;
  deals: DealPreview[];
  loadingPreview: boolean;
  scopeName: string;
  overrideCount: number;
  showOverridesOnly: boolean;
  onToggleOverridesOnly: () => void;
  onOverrideDeal: (dealId: string, scopeId: string) => Promise<void>;
  onClearOverride: (dealId: string) => Promise<void>;
  overridingDealId: string | null;
  anon: ReturnType<typeof useDemoMode>['anon'];
  valueFieldLabel?: string;
}) {
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const nonDefaultScopes = scopes.filter(s => s.scope_id !== 'default');
  const defaultScope = scopes.find(s => s.scope_id === 'default');
  const previewScopes = defaultScope ? [...nonDefaultScopes, defaultScope] : nonDefaultScopes;

  if (previewScopes.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Filter Preview</div>
        <div style={{ color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>
          No scopes to preview.
        </div>
      </div>
    );
  }

  const getScopeName = (scopeId: string): string => {
    return scopes.find(s => s.scope_id === scopeId)?.name || scopeId;
  };

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Filter Preview</div>

      {/* Scope selector buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {previewScopes.map(s => {
          const isDefault = s.scope_id === 'default';
          const isSelected = selectedScopeId === s.scope_id;
          return (
            <button
              key={s.scope_id}
              onClick={() => onSelectScope(s.scope_id)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: fonts.sans,
                cursor: 'pointer',
                border: isSelected
                  ? `1px solid ${isDefault ? colors.textMuted : colors.accent}`
                  : `1px ${isDefault ? 'dashed' : 'solid'} ${colors.border}`,
                background: isSelected
                  ? (isDefault ? colors.surfaceHover : colors.accentSoft)
                  : colors.surfaceRaised,
                color: isSelected
                  ? (isDefault ? colors.textSecondary : colors.accent)
                  : colors.textMuted,
                transition: 'all 0.15s',
              }}
            >
              {isDefault ? 'Default (catch-all)' : anon.pipeline(s.name)}
            </button>
          );
        })}
      </div>

      {loadingPreview ? (
        <div style={{ color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans }}>Loading preview...</div>
      ) : deals.length === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>
          No deals match this scope's filter.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Showing first {deals.length} deal{deals.length !== 1 ? 's' : ''} for <strong style={{ color: colors.text }}>{scopeName}</strong>
            </span>
            {overrideCount > 0 && (
              <button
                onClick={onToggleOverridesOnly}
                style={{
                  background: showOverridesOnly ? colors.accentSoft : 'transparent',
                  border: `1px solid ${showOverridesOnly ? colors.accent : colors.border}`,
                  color: showOverridesOnly ? colors.accent : colors.textSecondary,
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                {overrideCount} manual override{overrideCount !== 1 ? 's' : ''} {showOverridesOnly ? '✓' : ''}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>{valueFieldLabel || 'Amount'}</th>
                  <th style={thStyle}>Scope</th>
                  <th style={thStyle}>Stage</th>
                  <th style={thStyle}>Owner</th>
                  <th style={thStyle}>Pipeline</th>
                  <th style={thStyle}>Close Date</th>
                </tr>
              </thead>
              <tbody>
                {deals.map(deal => {
                  const hasOverride = deal.scope_override !== null;
                  const isExpanded = expandedDealId === deal.id;
                  return (
                    <tr
                      key={deal.id}
                      style={{
                        background: hasOverride ? colors.surfaceRaised : 'transparent',
                        borderLeft: hasOverride ? `3px solid ${colors.accent}` : 'none',
                      }}
                    >
                      <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {deal.name ? anon.deal(deal.name) : '—'}
                      </td>
                      <td style={tdStyle}>{formatAmount(anon.amount(deal.amount))}</td>
                      <td style={{ ...tdStyle, position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: colors.text }}>
                            {anon.pipeline(getScopeName(deal.scope_id))}
                            {hasOverride && <span style={{ marginLeft: 4, fontSize: 14 }}>📌</span>}
                          </span>
                          <button
                            onClick={() => setExpandedDealId(isExpanded ? null : deal.id)}
                            disabled={overridingDealId === deal.id}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: colors.textSecondary,
                              cursor: overridingDealId === deal.id ? 'wait' : 'pointer',
                              fontSize: 14,
                              padding: '2px 4px',
                            }}
                          >
                            {overridingDealId === deal.id ? '⋯' : '⋮'}
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 10,
                            background: colors.surface,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 4,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            minWidth: 160,
                            marginTop: 2,
                          }}>
                            {scopes.filter(s => s.confirmed).map(s => (
                              <button
                                key={s.scope_id}
                                onClick={() => {
                                  onOverrideDeal(deal.id, s.scope_id);
                                  setExpandedDealId(null);
                                }}
                                disabled={s.scope_id === deal.scope_id}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 12px',
                                  textAlign: 'left',
                                  background: s.scope_id === deal.scope_id ? colors.surfaceHover : 'none',
                                  border: 'none',
                                  color: s.scope_id === deal.scope_id ? colors.textMuted : colors.text,
                                  fontSize: 12,
                                  cursor: s.scope_id === deal.scope_id ? 'default' : 'pointer',
                                  fontFamily: fonts.sans,
                                }}
                                onMouseEnter={(e) => {
                                  if (s.scope_id !== deal.scope_id) {
                                    e.currentTarget.style.background = colors.surfaceHover;
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (s.scope_id !== deal.scope_id) {
                                    e.currentTarget.style.background = 'none';
                                  }
                                }}
                              >
                                {anon.pipeline(s.name)}
                              </button>
                            ))}
                            {hasOverride && (
                              <>
                                <div style={{ height: 1, background: colors.border, margin: '4px 0' }} />
                                <button
                                  onClick={() => {
                                    onClearOverride(deal.id);
                                    setExpandedDealId(null);
                                  }}
                                  style={{
                                    display: 'block',
                                    width: '100%',
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    background: 'none',
                                    border: 'none',
                                    color: colors.red,
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    fontFamily: fonts.sans,
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = colors.surfaceHover;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'none';
                                  }}
                                >
                                  Clear override
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary }}>{deal.stage || '—'}</td>
                      <td style={{ ...tdStyle, color: colors.textSecondary, fontSize: 12 }}>
                        {deal.owner_email || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary, fontSize: 12 }}>
                        {deal.pipeline || deal.deal_type || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary }}>{formatDate(deal.close_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Panel 3: Configuration Status
// ============================================================================

function ConfigStatusPanel({ data }: { data: ScopesResponse | null }) {
  if (!data) return null;

  const nonDefaultScopes = data.scopes.filter(s => s.scope_id !== 'default');
  const confirmedCount = nonDefaultScopes.filter(s => s.confirmed).length;
  const adapterSource = deriveAdapterSource(data.scopes);
  const lastInference = deriveLastInference(data.scopes);

  const isScoped = data.has_confirmed_scopes;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>Configuration Status</div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 10, columnGap: 16 }}>
        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>Adapter source</div>
        <div style={{ fontSize: 13, color: colors.text, fontFamily: fonts.sans }}>{adapterSource}</div>

        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>Scopes detected</div>
        <div style={{ fontSize: 13, color: colors.text, fontFamily: fonts.sans }}>
          {nonDefaultScopes.length > 0
            ? `${nonDefaultScopes.length} (via ${nonDefaultScopes[0]?.source || 'unknown'})`
            : 'None detected'}
        </div>

        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>Scopes confirmed</div>
        <div style={{ fontSize: 13, color: colors.text, fontFamily: fonts.sans }}>{confirmedCount}</div>

        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>Skills running as</div>
        <div style={{ fontSize: 13, fontFamily: fonts.sans }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 600,
            background: isScoped ? colors.greenSoft : colors.yellowSoft,
            color: isScoped ? colors.green : colors.yellow,
          }}>
            {isScoped ? 'Scoped (per scope)' : 'Unscoped (all deals)'}
          </span>
        </div>

        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>Last inference run</div>
        <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}>{lastInference}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function AdminScopesPage() {
  const { anon } = useDemoMode();
  const [data, setData] = useState<ScopesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Numeric fields for value field dropdowns
  const [numericFields, setNumericFields] = useState<NumericField[]>([
    { key: 'amount', label: 'Amount (default)' },
  ]);
  const [valueFieldLabel, setValueFieldLabel] = useState<string>('Amount');

  // Preview state
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [previewDeals, setPreviewDeals] = useState<DealPreview[]>([]);
  const [previewScopeName, setPreviewScopeName] = useState('');
  const [overrideCount, setOverrideCount] = useState(0);
  const [showOverridesOnly, setShowOverridesOnly] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Action state
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reInferring, setReInferring] = useState(false);
  const [overridingDealId, setOverridingDealId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ---- Data fetching ----

  const fetchScopes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/admin/scopes') as ScopesResponse;
      setData(result);
      // Auto-select first non-default scope for preview
      const firstNonDefault = result.scopes.find(s => s.scope_id !== 'default');
      if (firstNonDefault && !selectedScopeId) {
        setSelectedScopeId(firstNonDefault.scope_id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load scopes');
    } finally {
      setLoading(false);
    }
  }, [selectedScopeId]);

  const fetchPreview = useCallback(async (scopeId: string, overridesOnlyParam?: boolean) => {
    setLoadingPreview(true);
    const overridesFilter = overridesOnlyParam !== undefined ? overridesOnlyParam : showOverridesOnly;
    try {
      const queryParam = overridesFilter ? '?overrides_only=true' : '';
      const result = await api.get(`/admin/scopes/${encodeURIComponent(scopeId)}/preview${queryParam}`) as {
        deals: DealPreview[];
        scope_name: string;
        override_count: number;
      };
      setPreviewDeals(result.deals || []);
      setPreviewScopeName(result.scope_name || scopeId);
      setOverrideCount(result.override_count || 0);
    } catch (err: any) {
      setPreviewDeals([]);
      setPreviewScopeName(scopeId);
      setOverrideCount(0);
    } finally {
      setLoadingPreview(false);
    }
  }, [showOverridesOnly]);

  useEffect(() => {
    fetchScopes();
    Promise.all([
      api.get('/admin/numeric-fields').catch(() => null),
      api.get('/workspace-config').catch(() => null),
    ]).then(([fieldsRes, configRes]: any[]) => {
      if (fieldsRes?.fields?.length) setNumericFields(fieldsRes.fields);
      // Derive value field label from workspace config default pipeline
      if (configRes?.config?.pipelines?.length) {
        const defaultPipeline = configRes.config.pipelines.find((p: any) => p.included_in_default_scope) || configRes.config.pipelines[0];
        const vf = defaultPipeline?.value_field || 'amount';
        const match = (fieldsRes?.fields || []).find((f: any) => f.key === vf);
        if (match) setValueFieldLabel(match.label);
        else if (vf !== 'amount') setValueFieldLabel(vf.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()));
      }
    });
  }, []);

  useEffect(() => {
    if (selectedScopeId) {
      fetchPreview(selectedScopeId);
    }
  }, [selectedScopeId, showOverridesOnly, fetchPreview]);

  // ---- Actions ----

  const handleConfirm = async (scopeId: string) => {
    setConfirmingId(scopeId);
    try {
      await api.post(`/admin/scopes/${encodeURIComponent(scopeId)}/confirm`);
      setToast({ type: 'success', message: `Scope "${scopeId}" confirmed. Deals are being re-stamped.` });
      await fetchScopes();
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Confirm failed' });
    } finally {
      setConfirmingId(null);
    }
  };

  const handleReInfer = async () => {
    setReInferring(true);
    try {
      const result = await api.post('/admin/scopes/re-infer') as { scopes: InferredScope[]; count: number };
      setToast({
        type: 'success',
        message: result.count > 0
          ? `Inference complete. ${result.count} scope${result.count !== 1 ? 's' : ''} detected.`
          : 'Inference complete. No new scopes detected.',
      });
      await fetchScopes();
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Inference failed' });
    } finally {
      setReInferring(false);
    }
  };

  const handleSelectScope = (scopeId: string) => {
    setSelectedScopeId(scopeId);
  };

  const handleToggleOverridesOnly = () => {
    setShowOverridesOnly(prev => !prev);
  };

  const handleOverrideDeal = async (dealId: string, scopeId: string) => {
    setOverridingDealId(dealId);
    try {
      await api.post(`/admin/scopes/deals/${encodeURIComponent(dealId)}/override`, { scope_id: scopeId });
      setToast({ type: 'success', message: 'Deal scope override set' });
      // Refresh both scopes list (for deal counts) and preview
      await Promise.all([fetchScopes(), selectedScopeId ? fetchPreview(selectedScopeId) : Promise.resolve()]);
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Override failed' });
    } finally {
      setOverridingDealId(null);
    }
  };

  const handleClearOverride = async (dealId: string) => {
    setOverridingDealId(dealId);
    try {
      await api.delete(`/admin/scopes/deals/${encodeURIComponent(dealId)}/override`);
      setToast({ type: 'success', message: 'Deal scope override cleared' });
      // Refresh both scopes list and preview
      await Promise.all([fetchScopes(), selectedScopeId ? fetchPreview(selectedScopeId) : Promise.resolve()]);
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Clear override failed' });
    } finally {
      setOverridingDealId(null);
    }
  };

  const handleSaveFieldOverrides = async (scopeId: string, overrides: Record<string, any>) => {
    await api.patch(`/analysis-scopes/${encodeURIComponent(scopeId)}/field-overrides`, overrides);
    // Refresh scopes so the new field_overrides are reflected in state
    await fetchScopes();
  };

  // ---- Render ----

  return (
    <div style={{ maxWidth: 1200, fontFamily: fonts.sans }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, margin: 0 }}>
          Workspace Scopes
        </h1>
        <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: 0 }}>
          Internal admin view — define and confirm deal segmentation for skill fan-out.
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: colors.redSoft,
          border: `1px solid ${colors.red}`,
          borderRadius: 6,
          color: colors.red,
          fontSize: 13,
          marginBottom: 20,
        }}>
          {error}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          padding: '12px 16px',
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          borderRadius: 6,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 13,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, padding: '0 4px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Panel 1 */}
      <ScopeInventoryPanel
        data={data}
        loading={loading}
        onConfirm={handleConfirm}
        onReInfer={handleReInfer}
        confirmingId={confirmingId}
        reInferring={reInferring}
        anon={anon}
        numericFields={numericFields}
        onSaveFieldOverrides={handleSaveFieldOverrides}
      />

      {/* Panel 2 */}
      <FilterPreviewPanel
        scopes={data?.scopes || []}
        selectedScopeId={selectedScopeId}
        onSelectScope={handleSelectScope}
        deals={previewDeals}
        loadingPreview={loadingPreview}
        scopeName={previewScopeName}
        overrideCount={overrideCount}
        showOverridesOnly={showOverridesOnly}
        onToggleOverridesOnly={handleToggleOverridesOnly}
        onOverrideDeal={handleOverrideDeal}
        onClearOverride={handleClearOverride}
        overridingDealId={overridingDealId}
        anon={anon}
        valueFieldLabel={valueFieldLabel}
      />

      {/* Panel 3 */}
      <ConfigStatusPanel data={data} />
    </div>
  );
}

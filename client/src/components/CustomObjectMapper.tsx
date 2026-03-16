/**
 * CustomObjectMapper
 *
 * UI for mapping custom Salesforce objects (e.g. Transcript__c) to Pandora
 * entity tables. Describes the object live from the connected Salesforce org,
 * presents a field-by-field mapping table, and persists config to workspace_config.
 *
 * Currently supports: mode=map_to_entity, target=conversations
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

const newId = () => crypto.randomUUID();

// ── Pandora fields that users can map ─────────────────────────────────────────

const PANDORA_FIELDS = [
  { key: 'title',            label: 'Call Title / Name',           type: 'string',    required: true  },
  { key: 'call_date',        label: 'Call Date',                   type: 'datetime',  required: true  },
  { key: 'duration_seconds', label: 'Duration (seconds)',          type: 'number',    required: false },
  { key: 'transcript_text',  label: 'Transcript / Body',           type: 'text',      required: false },
  { key: 'summary',          label: 'Summary / Description',       type: 'text',      required: false },
  { key: 'sentiment_score',  label: 'Sentiment Score (0–1)',       type: 'number',    required: false },
  { key: 'participants',     label: 'Participants (email / name)', type: 'string',    required: false },
  { key: 'deal_id',          label: 'Related Opportunity / Deal',  type: 'reference', required: false },
  { key: 'account_id',       label: 'Related Account',             type: 'reference', required: false },
] as const;

type PandoraFieldKey = typeof PANDORA_FIELDS[number]['key'];

// ── Types ──────────────────────────────────────────────────────────────────────

interface SalesforceFieldMeta {
  name: string;
  label: string;
  type: string;
  is_custom: boolean;
}

interface CustomObjectConfig {
  id: string;
  connector: 'salesforce';
  object_name: string;
  label: string;
  mode: 'map_to_entity';
  target: 'conversations';
  field_map: Record<string, string>;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TYPE_BADGE_COLOR: Record<string, string> = {
  string: colors.accent,
  datetime: '#8b5cf6',
  number: '#10b981',
  text: '#f59e0b',
  reference: '#6366f1',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 600,
      fontFamily: fonts.sans,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '2px 6px',
      borderRadius: 4,
      background: `${TYPE_BADGE_COLOR[type] ?? colors.accent}20`,
      color: TYPE_BADGE_COLOR[type] ?? colors.accent,
    }}>
      {type}
    </span>
  );
}

// ── Mapping Panel ─────────────────────────────────────────────────────────────

interface MappingPanelProps {
  initial?: CustomObjectConfig;
  onSave: (config: CustomObjectConfig) => void;
  onCancel: () => void;
}

function MappingPanel({ initial, onSave, onCancel }: MappingPanelProps) {
  const { workspace } = useWorkspace();
  const [objectName, setObjectName] = useState(initial?.object_name ?? 'Transcript__c');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [sfFields, setSfFields] = useState<SalesforceFieldMeta[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(initial?.field_map ?? {});
  const [saving, setSaving] = useState(false);

  // Auto-load fields on mount if editing
  useEffect(() => {
    if (initial?.object_name) {
      loadFields(initial.object_name);
    }
  }, []);

  async function loadFields(name?: string) {
    const obj = (name ?? objectName).trim();
    if (!obj) return;
    setLoadingFields(true);
    setFieldError(null);
    try {
      const data = await api.get(
        `/workspaces/${workspace!.id}/connectors/salesforce/objects/${encodeURIComponent(obj)}/fields`
      );
      setSfFields(data.fields ?? []);
      if (!label) setLabel(data.object_name.replace(/__c$/i, '').replace(/_/g, ' '));

      // Auto-suggest mappings if no prior map
      if (!initial?.field_map) {
        const suggestions: Record<string, string> = {};
        const haystack = data.fields as SalesforceFieldMeta[];
        const find = (keywords: string[]) => {
          for (const kw of keywords) {
            const match = haystack.find(f =>
              f.name.toLowerCase().includes(kw) || f.label.toLowerCase().includes(kw)
            );
            if (match) return match.name;
          }
          return '';
        };
        suggestions.title            = find(['subject', 'name', 'title']);
        suggestions.call_date        = find(['date', 'time', 'start', 'created']);
        suggestions.duration_seconds = find(['duration', 'length', 'seconds']);
        suggestions.transcript_text  = find(['transcript', 'body', 'content', 'text']);
        suggestions.summary          = find(['summary', 'description', 'notes']);
        suggestions.deal_id          = find(['opportunity', 'opportunityid', 'deal']);
        suggestions.account_id       = find(['account', 'accountid']);
        setFieldMap(suggestions);
      }
    } catch (err: any) {
      setFieldError(err?.message ?? 'Failed to load fields. Check the object API name.');
      setSfFields([]);
    } finally {
      setLoadingFields(false);
    }
  }

  function handleFieldMapChange(pandoraKey: string, sfFieldName: string) {
    setFieldMap(prev => ({ ...prev, [pandoraKey]: sfFieldName }));
  }

  function validate(): string | null {
    if (!objectName.trim()) return 'Object API name is required.';
    if (sfFields.length === 0) return 'Load the Salesforce fields first.';
    if (!fieldMap.title) return 'Title mapping is required.';
    if (!fieldMap.call_date) return 'Call Date mapping is required.';
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) { setFieldError(err); return; }
    setSaving(true);
    onSave({
      id: initial?.id ?? newId(),
      connector: 'salesforce',
      object_name: objectName.trim(),
      label: label.trim() || objectName.replace(/__c$/i, '').replace(/_/g, ' '),
      mode: 'map_to_entity',
      target: 'conversations',
      field_map: Object.fromEntries(Object.entries(fieldMap).filter(([, v]) => v)),
      created_at: initial?.created_at ?? new Date().toISOString(),
    });
  }

  const sfFieldOptions = [
    { name: '', label: '— not mapped —' },
    ...sfFields,
  ];

  return (
    <div style={{
      background: colors.surfaceHover,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 20,
      marginTop: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
        {initial ? 'Edit Custom Object Mapping' : 'Map a Custom Object'}
      </div>

      {/* Object name + label */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans, display: 'block', marginBottom: 4 }}>
            Salesforce Object API Name
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={objectName}
              onChange={e => setObjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadFields(); }}
              placeholder="e.g. Transcript__c"
              style={{
                flex: 1,
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '7px 10px',
                color: colors.text,
                fontSize: 12,
                fontFamily: fonts.mono,
                outline: 'none',
              }}
            />
            <button
              onClick={() => loadFields()}
              disabled={loadingFields || !objectName.trim()}
              style={{
                padding: '7px 12px',
                background: colors.accent,
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                cursor: loadingFields || !objectName.trim() ? 'not-allowed' : 'pointer',
                opacity: loadingFields || !objectName.trim() ? 0.6 : 1,
                whiteSpace: 'nowrap',
                fontFamily: fonts.sans,
              }}
            >
              {loadingFields ? 'Loading…' : 'Load Fields'}
            </button>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans, display: 'block', marginBottom: 4 }}>
            Display Label
          </label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Salesforce Transcript"
            style={{
              width: '100%',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '7px 10px',
              color: colors.text,
              fontSize: 12,
              fontFamily: fonts.sans,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Target entity — locked to conversations for now */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: `${colors.accent}10`,
        border: `1px solid ${colors.accent}30`,
        borderRadius: 6,
        marginBottom: 16,
        fontSize: 12,
        color: colors.textSecondary,
        fontFamily: fonts.sans,
      }}>
        <span style={{ color: colors.accent, fontWeight: 600 }}>→</span>
        Maps to: <span style={{ color: colors.text, fontWeight: 600 }}>Conversations</span>
        <span style={{ color: colors.textMuted, fontSize: 11 }}>(call recordings, transcripts)</span>
      </div>

      {/* Error */}
      {fieldError && (
        <div style={{
          padding: '8px 12px',
          background: `${colors.red}10`,
          border: `1px solid ${colors.red}30`,
          borderRadius: 6,
          fontSize: 12,
          color: colors.red,
          marginBottom: 12,
          fontFamily: fonts.sans,
        }}>
          {fieldError}
        </div>
      )}

      {/* Field mapping table */}
      {sfFields.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 24px 1fr',
            gap: '6px 8px',
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Pandora Field
            </div>
            <div />
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Salesforce Field ({sfFields.length} available)
            </div>
          </div>

          {PANDORA_FIELDS.map(pf => (
            <div
              key={pf.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 24px 1fr',
                gap: '4px 8px',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              {/* Left: Pandora field */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                background: colors.surface,
                border: `1px solid ${fieldMap[pf.key] ? colors.accent + '50' : colors.border}`,
                borderRadius: 6,
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: colors.text, fontFamily: fonts.sans }}>
                    {pf.label}
                  </span>
                  {pf.required && (
                    <span style={{ color: colors.red, marginLeft: 3, fontSize: 12 }}>*</span>
                  )}
                </div>
                <TypeBadge type={pf.type} />
              </div>

              {/* Arrow */}
              <div style={{ textAlign: 'center', color: fieldMap[pf.key] ? colors.accent : colors.border, fontSize: 14 }}>
                →
              </div>

              {/* Right: SF field dropdown */}
              <select
                value={fieldMap[pf.key] ?? ''}
                onChange={e => handleFieldMapChange(pf.key, e.target.value)}
                style={{
                  padding: '7px 10px',
                  background: colors.surface,
                  border: `1px solid ${fieldMap[pf.key] ? colors.accent + '50' : colors.border}`,
                  borderRadius: 6,
                  color: fieldMap[pf.key] ? colors.text : colors.textMuted,
                  fontSize: 12,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {sfFieldOptions.map(opt => (
                  <option key={opt.name} value={opt.name}>
                    {opt.name
                      ? `${opt.label}${opt.name !== opt.label ? ` (${opt.name})` : ''}`
                      : opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 4 }}>
            * Required. Unmapped Salesforce fields are stored automatically in custom_fields.
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.textSecondary,
            fontSize: 12,
            fontFamily: fonts.sans,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || sfFields.length === 0}
          style={{
            padding: '8px 16px',
            background: colors.accent,
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            cursor: saving || sfFields.length === 0 ? 'not-allowed' : 'pointer',
            opacity: saving || sfFields.length === 0 ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Mapping'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface CustomObjectMapperProps {
  salesforceConnected: boolean;
}

export default function CustomObjectMapper({ salesforceConnected }: CustomObjectMapperProps) {
  const { workspace } = useWorkspace();
  const [configs, setConfigs] = useState<CustomObjectConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CustomObjectConfig | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const data = await api.get(`/workspaces/${workspace.id}/custom-objects`);
      setConfigs(data.custom_objects ?? []);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => { load(); }, [load]);

  async function persist(updated: CustomObjectConfig[]) {
    setSaveStatus('saving');
    try {
      await api.put(`/workspaces/${workspace!.id}/custom-objects`, { custom_objects: updated });
      setConfigs(updated);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  function handleSave(config: CustomObjectConfig) {
    const updated = editingConfig
      ? configs.map(c => (c.id === config.id ? config : c))
      : [...configs, config];
    persist(updated).then(() => {
      setShowPanel(false);
      setEditingConfig(null);
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Remove this custom object mapping?')) return;
    persist(configs.filter(c => c.id !== id));
  }

  if (!salesforceConnected) return null;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 20,
      marginTop: 24,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
            Custom Object Mappings
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 2 }}>
            Map Salesforce objects (e.g. Transcript__c) to Pandora entities like Conversations
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 11, color: colors.green, fontFamily: fonts.sans }}>Saved</span>
          )}
          {saveStatus === 'error' && (
            <span style={{ fontSize: 11, color: colors.red, fontFamily: fonts.sans }}>Save failed</span>
          )}
          {!showPanel && !editingConfig && (
            <button
              onClick={() => { setShowPanel(true); setEditingConfig(null); }}
              style={{
                padding: '7px 14px',
                background: colors.accent,
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: fonts.sans,
                cursor: 'pointer',
              }}
            >
              + Map Object
            </button>
          )}
        </div>
      </div>

      {/* Existing configs */}
      {!loading && configs.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {configs.map(c => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: colors.surfaceHover,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
                    {c.label || c.object_name}
                  </span>
                  <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                    {c.object_name}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, fontFamily: fonts.sans,
                    padding: '1px 7px', borderRadius: 4,
                    background: `${colors.accent}20`, color: colors.accent,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    → {c.target}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3, fontFamily: fonts.sans }}>
                  {Object.entries(c.field_map).filter(([, v]) => v).length} fields mapped
                  {' · '}
                  {Object.entries(c.field_map).filter(([, v]) => v).map(([k]) => k).join(', ')}
                </div>
              </div>
              <button
                onClick={() => { setEditingConfig(c); setShowPanel(false); }}
                style={{
                  padding: '5px 10px', background: 'transparent',
                  border: `1px solid ${colors.border}`, borderRadius: 5,
                  color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sans, cursor: 'pointer',
                }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                style={{
                  padding: '5px 10px', background: 'transparent',
                  border: `1px solid ${colors.red}40`, borderRadius: 5,
                  color: colors.red, fontSize: 11, fontFamily: fonts.sans, cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 12 }}>
          Loading…
        </div>
      )}

      {/* Add panel */}
      {showPanel && !editingConfig && (
        <MappingPanel
          onSave={handleSave}
          onCancel={() => setShowPanel(false)}
        />
      )}

      {/* Edit panel */}
      {editingConfig && (
        <MappingPanel
          initial={editingConfig}
          onSave={handleSave}
          onCancel={() => setEditingConfig(null)}
        />
      )}

      {/* Empty state */}
      {!loading && configs.length === 0 && !showPanel && (
        <div style={{
          textAlign: 'center',
          padding: '24px 0 8px',
          fontSize: 12,
          color: colors.textMuted,
          fontFamily: fonts.sans,
        }}>
          No custom object mappings configured yet.{' '}
          <button
            onClick={() => setShowPanel(true)}
            style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: 12, fontFamily: fonts.sans, padding: 0 }}
          >
            Add one
          </button>
          {' '}to sync Salesforce custom objects like Transcript__c into Conversations.
        </div>
      )}
    </div>
  );
}

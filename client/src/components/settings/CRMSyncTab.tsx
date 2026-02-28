import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { colors, fonts } from '../../styles/theme';
import Toast from '../Toast';
import { api } from '../../lib/api';

interface Mapping {
  id: string;
  pandora_field: string;
  crm_property_name: string;
  crm_property_label: string;
  crm_object_type: string;
  write_mode: string;
  sync_trigger: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  recent_writes: any[];
}

interface PandoraField {
  key: string;
  label: string;
  description: string;
  applies_to: string[];
  value_type: string;
  example_value: string;
}

interface CRMProperty {
  name: string;
  label: string;
  type: string;
  object_type: string;
  is_custom: boolean;
}

export function CRMSyncTab() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    loadMappings();
  }, [workspaceId]);

  const loadMappings = async () => {
    try {
      const data = await api.get('/crm-writeback/mappings');
      setMappings(data.mappings || []);
    } catch (err) {
      console.error('Failed to load mappings:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 32, height: 32,
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        CRM Sync
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 8, lineHeight: 1.6 }}>
        Write Pandora insights back to your CRM as custom properties.
        Requires custom properties to exist in your CRM first.
      </p>
      <a
        href="https://knowledge.hubspot.com/properties/create-and-edit-properties"
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 13, color: colors.accent, textDecoration: 'none' }}
      >
        How to create custom properties ↗
      </a>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginTop: 24,
        marginBottom: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 10, height: 10,
          borderRadius: '50%',
          background: colors.green,
        }} />
        <span style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>
          Connected CRM: HubSpot
        </span>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>
          Field Mappings
        </h2>
        <button
          onClick={() => setShowAddPanel(true)}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: '#fff',
            background: colors.accent,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          + Add Mapping
        </button>
      </div>

      {mappings.length === 0 ? (
        <div style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 40,
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: 14,
          background: colors.surface,
        }}>
          No mappings configured yet. Click "Add Mapping" to get started.
        </div>
      ) : (
        <div style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          overflow: 'hidden',
          overflowX: 'auto',
          background: colors.surface,
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {['Pandora Field', 'CRM Property', 'Sync', 'Status', ''].map((h) => (
                  <th key={h} style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 12,
                    fontWeight: 600,
                    color: colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  onUpdate={loadMappings}
                  workspaceId={workspaceId}
                  onToast={setToast}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddPanel && (
        <AddMappingPanel
          workspaceId={workspaceId}
          onClose={() => setShowAddPanel(false)}
          onSave={() => {
            setShowAddPanel(false);
            loadMappings();
            setToast({ message: 'Mapping created', type: 'success' });
          }}
        />
      )}

      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Sync Log
        </h2>
        <SyncLog workspaceId={workspaceId} />
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function MappingRow({ mapping, onUpdate, workspaceId, onToast }: any) {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const data = await api.post(
        `/crm-writeback/mappings/${mapping.id}/test`,
        { crm_record_id: 'test-record-id' }
      );
      onToast({
        message: data.result?.success ? 'Test write succeeded' : `Test failed: ${data.result?.error}`,
        type: data.result?.success ? 'success' : 'error',
      });
    } catch (err) {
      onToast({ message: 'Test failed', type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async () => {
    try {
      await api.patch(`/crm-writeback/mappings/${mapping.id}`, {
        is_active: !mapping.is_active,
      });
      onUpdate();
    } catch (err) {
      console.error('Failed to toggle mapping:', err);
    }
  };

  return (
    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>{mapping.pandora_field}</div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{mapping.crm_object_type}</div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>
          {mapping.crm_property_label || mapping.crm_property_name}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono, marginTop: 2 }}>
          {mapping.crm_property_name}
        </div>
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, color: colors.textSecondary }}>
        {mapping.sync_trigger === 'after_skill_run' ? 'Auto' : 'Manual'}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13 }}>
        {mapping.last_sync_status === 'success' ? (
          <span style={{ color: colors.green }}>Synced</span>
        ) : mapping.last_sync_status === 'error' ? (
          <span style={{ color: colors.red }}>Error</span>
        ) : (
          <span style={{ color: colors.textMuted }}>—</span>
        )}
      </td>
      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            fontSize: 12,
            color: colors.accent,
            background: 'none',
            border: 'none',
            cursor: testing ? 'wait' : 'pointer',
            marginRight: 12,
            fontFamily: fonts.sans,
          }}
        >
          {testing ? 'Testing...' : 'Test'}
        </button>
        <button
          onClick={handleToggle}
          style={{
            fontSize: 12,
            color: colors.textSecondary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: fonts.sans,
          }}
        >
          {mapping.is_active ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  );
}

function AddMappingPanel({ workspaceId, onClose, onSave }: any) {
  const [pandoraFields, setPandoraFields] = useState<PandoraField[]>([]);
  const [crmProperties, setCrmProperties] = useState<CRMProperty[]>([]);

  const [selectedPandoraField, setSelectedPandoraField] = useState('');
  const [selectedObjectType, setSelectedObjectType] = useState('deal');
  const [selectedCRMProperty, setSelectedCRMProperty] = useState('');
  const [writeMode, setWriteMode] = useState('overwrite');
  const [syncTrigger, setSyncTrigger] = useState('after_skill_run');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPandoraFields();
  }, []);

  useEffect(() => {
    if (selectedObjectType) {
      loadCRMProperties(selectedObjectType);
    }
  }, [selectedObjectType]);

  const loadPandoraFields = async () => {
    try {
      const data = await api.get('/crm-writeback/fields');
      setPandoraFields(data.fields || []);
    } catch (err) {
      console.error('Failed to load Pandora fields:', err);
    }
  };

  const loadCRMProperties = async (objectType: string) => {
    try {
      const data = await api.get(`/crm-writeback/crm-properties?objectType=${objectType}`);
      setCrmProperties(data.properties || []);
    } catch (err) {
      console.error('Failed to load CRM properties:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedPandoraField || !selectedCRMProperty) return;
    setSaving(true);
    try {
      const selectedCRM = crmProperties.find(p => p.name === selectedCRMProperty);
      await api.post('/crm-writeback/mappings', {
        crm_type: 'hubspot',
        pandora_field: selectedPandoraField,
        crm_object_type: selectedObjectType,
        crm_property_name: selectedCRMProperty,
        crm_property_label: selectedCRM?.label || selectedCRMProperty,
        crm_field_type: selectedCRM?.type || 'text',
        sync_trigger: syncTrigger,
        write_mode: writeMode,
      });
      onSave();
    } catch (err) {
      console.error('Failed to create mapping:', err);
    } finally {
      setSaving(false);
    }
  };

  const selectedField = pandoraFields.find(f => f.key === selectedPandoraField);
  const applicableFields = pandoraFields.filter(f => f.applies_to.includes(selectedObjectType));

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.text,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    outline: 'none',
    marginBottom: 12,
  };

  const radioLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 0',
    cursor: 'pointer',
    fontSize: 14,
    color: colors.text,
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
    }}>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        maxWidth: 600,
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
            Add Field Mapping
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: colors.textMuted, cursor: 'pointer',
              fontSize: 18, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              What to Write
            </h4>

            <label style={{ display: 'block', fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>
              CRM Object Type
            </label>
            <select value={selectedObjectType} onChange={(e) => setSelectedObjectType(e.target.value)} style={selectStyle}>
              <option value="deal">Deals</option>
              <option value="company">Companies</option>
              <option value="contact">Contacts</option>
            </select>

            <label style={{ display: 'block', fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>
              Pandora Field
            </label>
            <select value={selectedPandoraField} onChange={(e) => setSelectedPandoraField(e.target.value)} style={selectStyle}>
              <option value="">Select a field...</option>
              {applicableFields.map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
            {selectedField && (
              <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
                {selectedField.description}
              </p>
            )}

            <label style={{ display: 'block', fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>
              CRM Property
            </label>
            <select value={selectedCRMProperty} onChange={(e) => setSelectedCRMProperty(e.target.value)} style={selectStyle}>
              <option value="">Select a property...</option>
              {crmProperties.filter(p => p.is_custom).map((prop) => (
                <option key={prop.name} value={prop.name}>
                  {prop.label} ({prop.name})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              When to Write
            </h4>
            <label style={radioLabelStyle}>
              <input
                type="radio" value="after_skill_run"
                checked={syncTrigger === 'after_skill_run'}
                onChange={(e) => setSyncTrigger(e.target.value)}
                style={{ marginTop: 2, accentColor: colors.accent }}
              />
              <span>After each skill run (recommended)</span>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio" value="manual"
                checked={syncTrigger === 'manual'}
                onChange={(e) => setSyncTrigger(e.target.value)}
                style={{ marginTop: 2, accentColor: colors.accent }}
              />
              <span>Manual only</span>
            </label>
          </div>

          <div style={{ marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              How to Write
            </h4>
            {[
              { value: 'overwrite', label: 'Overwrite', desc: 'Always replace with new value' },
              { value: 'never_overwrite', label: 'Never overwrite', desc: 'Only write if field is blank' },
              { value: 'append', label: 'Append', desc: 'Add below existing value (text only)' },
            ].map((opt) => (
              <label key={opt.value} style={radioLabelStyle}>
                <input
                  type="radio" value={opt.value}
                  checked={writeMode === opt.value}
                  onChange={(e) => setWriteMode(e.target.value)}
                  style={{ marginTop: 2, accentColor: colors.accent }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>{opt.label}</div>
                  <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 500, fontFamily: fonts.sans,
              color: colors.textSecondary,
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedPandoraField || !selectedCRMProperty}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 500, fontFamily: fonts.sans,
              color: '#fff',
              background: (!selectedPandoraField || !selectedCRMProperty) ? colors.textDim : colors.accent,
              border: 'none',
              borderRadius: 6,
              cursor: saving ? 'wait' : (!selectedPandoraField || !selectedCRMProperty) ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncLog({ workspaceId }: { workspaceId: string }) {
  const [logEntries, setLogEntries] = useState<any[]>([]);

  useEffect(() => {
    loadLog();
  }, [workspaceId]);

  const loadLog = async () => {
    try {
      const data = await api.get('/crm-writeback/log?limit=10');
      setLogEntries(data.log_entries || []);
    } catch (err) {
      console.error('Failed to load sync log:', err);
    }
  };

  if (logEntries.length === 0) {
    return (
      <div style={{
        padding: 32,
        textAlign: 'center',
        color: colors.textMuted,
        fontSize: 13,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
      }}>
        No sync activity yet
      </div>
    );
  }

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {logEntries.map((entry, i) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            fontSize: 13,
            borderBottom: i < logEntries.length - 1 ? `1px solid ${colors.border}` : 'none',
          }}
        >
          <div style={{ color: colors.textSecondary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: colors.textMuted }}>
              {new Date(entry.created_at).toLocaleString()}
            </span>
            {' — '}
            <span style={{ fontWeight: 500, color: colors.text }}>{entry.pandora_field}</span>
            {' → '}
            <span style={{ fontFamily: fonts.mono, color: colors.textSecondary }}>{entry.crm_property_name}</span>
          </div>
          <div style={{ flexShrink: 0 }}>
            {entry.status === 'success' ? (
              <span style={{ color: colors.green, fontWeight: 500 }}>Synced</span>
            ) : (
              <span style={{ color: colors.red, fontWeight: 500 }}>Error</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

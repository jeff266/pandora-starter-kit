/**
 * CRM Sync Settings Tab
 *
 * UI for managing CRM write-back property mappings
 */

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

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
  const { workspaceId } = useWorkspace();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMappings();
  }, [workspaceId]);

  const loadMappings = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/crm-writeback/mappings`);
      const data = await response.json();
      setMappings(data.mappings || []);
    } catch (err) {
      console.error('Failed to load mappings:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading CRM sync settings...</div>;
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-2">CRM Sync</h2>
        <p className="text-gray-600">
          Write Pandora insights back to your CRM as custom properties.
          Requires custom properties to exist in your CRM first.
        </p>
        <a
          href="https://knowledge.hubspot.com/properties/create-and-edit-properties"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm"
        >
          How to create custom properties ↗
        </a>
      </div>

      <div className="bg-gray-100 border border-gray-300 rounded p-4 mb-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span className="font-medium">Connected CRM: HubSpot</span>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Field Mappings</h3>
        <button
          onClick={() => setShowAddPanel(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + Add Mapping
        </button>
      </div>

      {mappings.length === 0 ? (
        <div className="border border-gray-300 rounded p-8 text-center text-gray-500">
          No mappings configured yet. Click "Add Mapping" to get started.
        </div>
      ) : (
        <div className="border border-gray-300 rounded overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Pandora Field</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">CRM Property</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sync</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  onUpdate={loadMappings}
                  workspaceId={workspaceId}
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
          }}
        />
      )}

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Sync Log</h3>
        <SyncLog workspaceId={workspaceId} />
      </div>
    </div>
  );
}

function MappingRow({ mapping, onUpdate, workspaceId }: any) {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      // Would need a test record ID - placeholder for now
      const response = await fetch(
        `/api/workspaces/${workspaceId}/crm-writeback/mappings/${mapping.id}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crm_record_id: 'test-record-id' }),
        }
      );
      const data = await response.json();
      alert(data.result?.success ? 'Test write succeeded!' : `Test failed: ${data.result?.error}`);
    } catch (err) {
      alert('Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/crm-writeback/mappings/${mapping.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !mapping.is_active }),
      });
      onUpdate();
    } catch (err) {
      console.error('Failed to toggle mapping:', err);
    }
  };

  return (
    <tr className="border-b border-gray-200">
      <td className="px-4 py-3 text-sm">
        <div className="font-medium">{mapping.pandora_field}</div>
        <div className="text-gray-500 text-xs">{mapping.crm_object_type}</div>
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="font-medium">{mapping.crm_property_label || mapping.crm_property_name}</div>
        <div className="text-gray-500 text-xs">{mapping.crm_property_name}</div>
      </td>
      <td className="px-4 py-3 text-sm">
        {mapping.sync_trigger === 'after_skill_run' ? 'Auto' : 'Manual'}
      </td>
      <td className="px-4 py-3 text-sm">
        {mapping.last_sync_status === 'success' ? (
          <span className="text-green-600">✓ Synced</span>
        ) : mapping.last_sync_status === 'error' ? (
          <span className="text-red-600">✗ Error</span>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-right">
        <button
          onClick={handleTest}
          disabled={testing}
          className="text-blue-600 hover:underline text-xs mr-2"
        >
          {testing ? 'Testing...' : 'Test'}
        </button>
        <button onClick={handleToggle} className="text-gray-600 hover:underline text-xs">
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
      const response = await fetch(`/api/workspaces/${workspaceId}/crm-writeback/fields`);
      const data = await response.json();
      setPandoraFields(data.fields || []);
    } catch (err) {
      console.error('Failed to load Pandora fields:', err);
    }
  };

  const loadCRMProperties = async (objectType: string) => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/crm-writeback/crm-properties?objectType=${objectType}`
      );
      const data = await response.json();
      setCrmProperties(data.properties || []);
    } catch (err) {
      console.error('Failed to load CRM properties:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedPandoraField || !selectedCRMProperty) {
      alert('Please select both Pandora field and CRM property');
      return;
    }

    setSaving(true);
    try {
      const selectedCRM = crmProperties.find(p => p.name === selectedCRMProperty);

      await fetch(`/api/workspaces/${workspaceId}/crm-writeback/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crm_type: 'hubspot', // TODO: detect from workspace
          pandora_field: selectedPandoraField,
          crm_object_type: selectedObjectType,
          crm_property_name: selectedCRMProperty,
          crm_property_label: selectedCRM?.label || selectedCRMProperty,
          crm_field_type: selectedCRM?.type || 'text',
          sync_trigger: syncTrigger,
          write_mode: writeMode,
        }),
      });

      onSave();
    } catch (err) {
      alert('Failed to create mapping');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const selectedField = pandoraFields.find(f => f.key === selectedPandoraField);
  const applicableFields = pandoraFields.filter(f => f.applies_to.includes(selectedObjectType));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-xl font-semibold">Add Field Mapping</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h4 className="font-medium mb-4">What to Write</h4>

            <label className="block mb-2 text-sm font-medium">CRM Object Type</label>
            <select
              value={selectedObjectType}
              onChange={(e) => setSelectedObjectType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
            >
              <option value="deal">Deals</option>
              <option value="company">Companies</option>
              <option value="contact">Contacts</option>
            </select>

            <label className="block mb-2 text-sm font-medium">Pandora Field</label>
            <select
              value={selectedPandoraField}
              onChange={(e) => setSelectedPandoraField(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 mb-2"
            >
              <option value="">Select a field...</option>
              {applicableFields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
            {selectedField && (
              <p className="text-sm text-gray-600 mb-4">ℹ {selectedField.description}</p>
            )}

            <label className="block mb-2 text-sm font-medium">CRM Property</label>
            <select
              value={selectedCRMProperty}
              onChange={(e) => setSelectedCRMProperty(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">Select a property...</option>
              {crmProperties.filter(p => p.is_custom).map((prop) => (
                <option key={prop.name} value={prop.name}>
                  {prop.label} ({prop.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <h4 className="font-medium mb-4">When to Write</h4>

            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="after_skill_run"
                  checked={syncTrigger === 'after_skill_run'}
                  onChange={(e) => setSyncTrigger(e.target.value)}
                  className="mr-2"
                />
                <span>After each skill run (recommended)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="manual"
                  checked={syncTrigger === 'manual'}
                  onChange={(e) => setSyncTrigger(e.target.value)}
                  className="mr-2"
                />
                <span>Manual only</span>
              </label>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-4">How to Write</h4>

            <div className="space-y-2">
              <label className="flex items-start">
                <input
                  type="radio"
                  value="overwrite"
                  checked={writeMode === 'overwrite'}
                  onChange={(e) => setWriteMode(e.target.value)}
                  className="mr-2 mt-1"
                />
                <div>
                  <div className="font-medium">Overwrite</div>
                  <div className="text-sm text-gray-600">Always replace with new value</div>
                </div>
              </label>
              <label className="flex items-start">
                <input
                  type="radio"
                  value="never_overwrite"
                  checked={writeMode === 'never_overwrite'}
                  onChange={(e) => setWriteMode(e.target.value)}
                  className="mr-2 mt-1"
                />
                <div>
                  <div className="font-medium">Never overwrite</div>
                  <div className="text-sm text-gray-600">Only write if field is blank</div>
                </div>
              </label>
              <label className="flex items-start">
                <input
                  type="radio"
                  value="append"
                  checked={writeMode === 'append'}
                  onChange={(e) => setWriteMode(e.target.value)}
                  className="mr-2 mt-1"
                />
                <div>
                  <div className="font-medium">Append</div>
                  <div className="text-sm text-gray-600">Add below existing value (text only)</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedPandoraField || !selectedCRMProperty}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
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
      const response = await fetch(`/api/workspaces/${workspaceId}/crm-writeback/log?limit=10`);
      const data = await response.json();
      setLogEntries(data.log_entries || []);
    } catch (err) {
      console.error('Failed to load sync log:', err);
    }
  };

  if (logEntries.length === 0) {
    return <div className="text-gray-500 text-sm">No sync activity yet</div>;
  }

  return (
    <div className="space-y-2">
      {logEntries.map((entry) => (
        <div key={entry.id} className="flex justify-between text-sm border-b border-gray-200 pb-2">
          <div>
            <span className="text-gray-600">
              {new Date(entry.created_at).toLocaleString()}
            </span>
            {' — '}
            <span className="font-medium">{entry.pandora_field}</span>
            {' → '}
            <span>{entry.crm_property_name}</span>
          </div>
          <div>
            {entry.status === 'success' ? (
              <span className="text-green-600">✓</span>
            ) : (
              <span className="text-red-600">✗ Error</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

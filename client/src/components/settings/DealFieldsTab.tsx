import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import Toast from '../Toast';

interface FieldSuggestion {
  field_name: string;
  field_label: string;
  field_type: string;
  crm_property_name: string;
  score: number;
  fill_rate: number;
  update_frequency: number;
  won_correlation: number | null;
  reasoning: string;
}

interface EditableField {
  id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  crm_property_name: string;
  crm_property_label: string | null;
  is_editable: boolean;
  is_required: boolean;
  display_order: number;
  help_text: string | null;
}

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'boolean' | 'picklist';

export default function DealFieldsTab() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [loadingFields, setLoadingFields] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingField, setEditingField] = useState<EditableField | null>(null);

  useEffect(() => {
    if (workspaceId) {
      fetchSuggestions();
      fetchFields();
    }
  }, [workspaceId]);

  const fetchSuggestions = async () => {
    try {
      setLoadingSuggestions(true);
      const data = await api.get(`/editable-fields/suggestions?limit=5`);
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      console.error('Failed to fetch field suggestions:', err);
      setToast({ message: 'Failed to load AI suggestions', type: 'error' });
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const fetchFields = async () => {
    try {
      setLoadingFields(true);
      const data = await api.get(`/editable-fields`);
      setFields(data.fields || []);
    } catch (err: any) {
      console.error('Failed to fetch editable fields:', err);
      setToast({ message: 'Failed to load editable fields', type: 'error' });
    } finally {
      setLoadingFields(false);
    }
  };

  const handleAddFromSuggestion = async (suggestion: FieldSuggestion) => {
    try {
      await api.post(`/editable-fields`, {
        field_name: suggestion.field_name,
        field_label: suggestion.field_label,
        field_type: suggestion.field_type,
        crm_property_name: suggestion.crm_property_name,
        is_required: false,
      });
      setToast({ message: `Added "${suggestion.field_label}" to editable fields`, type: 'success' });
      await fetchFields();
      await fetchSuggestions();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to add field';
      setToast({ message: errorMsg, type: 'error' });
    }
  };

  const handleToggleEditable = async (fieldId: string, newValue: boolean) => {
    try {
      await api.patch(`/editable-fields/${fieldId}`, {
        is_editable: newValue,
      });
      setFields(prev => prev.map(f => f.id === fieldId ? { ...f, is_editable: newValue } : f));
      setToast({ message: 'Field updated', type: 'success' });
    } catch (err: any) {
      setToast({ message: 'Failed to update field', type: 'error' });
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!confirm('Are you sure you want to remove this field from the editable list?')) {
      return;
    }

    try {
      await api.delete(`/editable-fields/${fieldId}`);
      setToast({ message: 'Field removed', type: 'success' });
      await fetchFields();
      await fetchSuggestions();
    } catch (err: any) {
      setToast({ message: 'Failed to remove field', type: 'error' });
    }
  };

  const handleReorder = async (fieldId: string, direction: 'up' | 'down') => {
    const fieldIndex = fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;

    const newFields = [...fields];
    const swapIndex = direction === 'up' ? fieldIndex - 1 : fieldIndex + 1;

    if (swapIndex < 0 || swapIndex >= newFields.length) return;

    // Swap elements
    [newFields[fieldIndex], newFields[swapIndex]] = [newFields[swapIndex], newFields[fieldIndex]];

    // Update local state optimistically
    setFields(newFields);

    // Send new order to backend
    try {
      await api.post(`/editable-fields/reorder`, {
        field_ids: newFields.map(f => f.id),
      });
    } catch (err: any) {
      setToast({ message: 'Failed to reorder fields', type: 'error' });
      // Revert on error
      await fetchFields();
    }
  };

  if (loadingSuggestions && loadingFields) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 32,
          height: 32,
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
    <div style={{ maxWidth: 1100, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Deal Fields Configuration
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Configure which CRM fields should be editable inline on the Deal Detail page. Changes are written back to your CRM.
      </p>

      {/* AI Suggestions Section */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
              AI Recommendations
            </h2>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: colors.accentBright,
              background: colors.accentSoft,
              padding: '4px 10px',
              borderRadius: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Powered by AI
            </div>
          </div>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
            Based on fill rate, update frequency, and correlation with won deals
          </p>

          <div style={{ display: 'grid', gap: 12 }}>
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.field_name}
                suggestion={suggestion}
                onAdd={handleAddFromSuggestion}
              />
            ))}
          </div>
        </div>
      )}

      {/* Currently Editable Fields */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
            Editable Fields ({fields.length})
          </h2>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: colors.accent,
              background: colors.accentSoft,
              border: `1px solid ${colors.accent}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            + Add Custom Field
          </button>
        </div>

        {fields.length === 0 ? (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 40,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 14, color: colors.textMuted }}>
              No editable fields configured yet. Add fields from AI suggestions or create custom fields.
            </p>
          </div>
        ) : (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {fields.map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                isFirst={index === 0}
                isLast={index === fields.length - 1}
                onToggleEditable={handleToggleEditable}
                onDelete={handleDeleteField}
                onEdit={setEditingField}
                onReorder={handleReorder}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingField) && (
        <FieldModal
          field={editingField}
          workspaceId={workspaceId}
          onClose={() => {
            setShowAddModal(false);
            setEditingField(null);
          }}
          onSuccess={async () => {
            await fetchFields();
            await fetchSuggestions();
            setShowAddModal(false);
            setEditingField(null);
            setToast({ message: editingField ? 'Field updated' : 'Field added', type: 'success' });
          }}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onAdd,
}: {
  suggestion: FieldSuggestion;
  onAdd: (suggestion: FieldSuggestion) => void;
}) {
  const scoreColor = suggestion.score >= 80 ? colors.green : suggestion.score >= 60 ? colors.accentBright : colors.textSecondary;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      {/* Score Badge */}
      <div style={{
        width: 60,
        height: 60,
        borderRadius: 8,
        background: `${scoreColor}15`,
        border: `2px solid ${scoreColor}40`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor, fontFamily: fonts.mono }}>
          {suggestion.score}
        </div>
        <div style={{ fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          score
        </div>
      </div>

      {/* Field Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          {suggestion.field_label}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono, marginBottom: 6 }}>
          {suggestion.field_name} • {suggestion.field_type}
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary }}>
          {suggestion.reasoning}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <MetricBadge label="Fill Rate" value={`${suggestion.fill_rate.toFixed(0)}%`} />
        <MetricBadge label="Update Freq" value={`${suggestion.update_frequency.toFixed(0)}%`} />
        {suggestion.won_correlation !== null && (
          <MetricBadge
            label="Won Corr"
            value={`${suggestion.won_correlation > 0 ? '+' : ''}${suggestion.won_correlation.toFixed(0)}%`}
          />
        )}
      </div>

      {/* Add Button */}
      <button
        onClick={() => onAdd(suggestion)}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: fonts.sans,
          color: colors.accent,
          background: 'transparent',
          border: `1px solid ${colors.accent}`,
          borderRadius: 6,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Add Field
      </button>
    </div>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: colors.textDim, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.mono }}>
        {value}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  isFirst,
  isLast,
  onToggleEditable,
  onDelete,
  onEdit,
  onReorder,
}: {
  field: EditableField;
  isFirst: boolean;
  isLast: boolean;
  onToggleEditable: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (field: EditableField) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '16px 20px',
      borderBottom: isLast ? 'none' : `1px solid ${colors.border}`,
    }}>
      {/* Reorder Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <button
          onClick={() => onReorder(field.id, 'up')}
          disabled={isFirst}
          style={{
            width: 24,
            height: 20,
            fontSize: 11,
            border: 'none',
            background: isFirst ? 'transparent' : colors.surfaceHover,
            color: isFirst ? colors.textDim : colors.textSecondary,
            borderRadius: 4,
            cursor: isFirst ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ▲
        </button>
        <button
          onClick={() => onReorder(field.id, 'down')}
          disabled={isLast}
          style={{
            width: 24,
            height: 20,
            fontSize: 11,
            border: 'none',
            background: isLast ? 'transparent' : colors.surfaceHover,
            color: isLast ? colors.textDim : colors.textSecondary,
            borderRadius: 4,
            cursor: isLast ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ▼
        </button>
      </div>

      {/* Field Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4 }}>
          {field.field_label}
          {field.is_required && (
            <span style={{ color: colors.red, marginLeft: 4 }}>*</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
          {field.field_name} → {field.crm_property_name}
        </div>
        {field.help_text && (
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' }}>
            "{field.help_text}"
          </div>
        )}
      </div>

      {/* Field Type Badge */}
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: colors.textMuted,
        background: colors.surfaceHover,
        padding: '4px 8px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        flexShrink: 0,
      }}>
        {field.field_type}
      </div>

      {/* Toggle */}
      <div
        onClick={() => onToggleEditable(field.id, !field.is_editable)}
        style={{
          width: 48,
          height: 26,
          borderRadius: 13,
          background: field.is_editable ? colors.accent : colors.surfaceHover,
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 3,
          left: field.is_editable ? 25 : 3,
          transition: 'left 0.2s',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => onEdit(field)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.textSecondary,
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(field.id)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.red,
            background: 'transparent',
            border: `1px solid ${colors.red}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function FieldModal({
  field,
  workspaceId,
  onClose,
  onSuccess,
  onError,
}: {
  field: EditableField | null;
  workspaceId: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [fieldName, setFieldName] = useState(field?.field_name || '');
  const [fieldLabel, setFieldLabel] = useState(field?.field_label || '');
  const [fieldType, setFieldType] = useState<FieldType>(field?.field_type as FieldType || 'text');
  const [crmPropertyName, setCrmPropertyName] = useState(field?.crm_property_name || '');
  const [crmPropertyLabel, setCrmPropertyLabel] = useState(field?.crm_property_label || '');
  const [isRequired, setIsRequired] = useState(field?.is_required || false);
  const [helpText, setHelpText] = useState(field?.help_text || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fieldName || !fieldLabel || !fieldType || !crmPropertyName) {
      onError('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      if (field) {
        // Update existing field
        await api.patch(`/editable-fields/${field.id}`, {
          field_label: fieldLabel,
          is_required: isRequired,
          help_text: helpText || null,
        });
      } else {
        // Create new field
        await api.post(`/editable-fields`, {
          field_name: fieldName,
          field_label: fieldLabel,
          field_type: fieldType,
          crm_property_name: crmPropertyName,
          crm_property_label: crmPropertyLabel || null,
          is_required: isRequired,
          help_text: helpText || null,
        });
      }
      onSuccess();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || `Failed to ${field ? 'update' : 'create'} field`;
      onError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: colors.bg,
        borderRadius: 12,
        width: '100%',
        maxWidth: 600,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 20px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.text, margin: 0 }}>
            {field ? 'Edit Field' : 'Add Custom Field'}
          </h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 24 }}>
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Field Name */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                Field Name (Database Column) *
              </label>
              <input
                type="text"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                disabled={!!field}
                placeholder="e.g., next_steps"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  fontFamily: fonts.mono,
                  color: field ? colors.textMuted : colors.text,
                  background: field ? colors.surfaceHover : colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: field ? 'not-allowed' : 'text',
                }}
              />
              {field && (
                <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                  Field name cannot be changed after creation
                </p>
              )}
            </div>

            {/* Field Label */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                Display Label *
              </label>
              <input
                type="text"
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
                placeholder="e.g., Next Steps"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  color: colors.text,
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                }}
              />
            </div>

            {/* Field Type */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                Field Type *
              </label>
              <select
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as FieldType)}
                disabled={!!field}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  color: field ? colors.textMuted : colors.text,
                  background: field ? colors.surfaceHover : colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: field ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="text">Text</option>
                <option value="textarea">Textarea</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
                <option value="picklist">Picklist</option>
              </select>
            </div>

            {/* CRM Property Name */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                CRM Property Name *
              </label>
              <input
                type="text"
                value={crmPropertyName}
                onChange={(e) => setCrmPropertyName(e.target.value)}
                disabled={!!field}
                placeholder="e.g., next_step (HubSpot) or Next_Steps__c (Salesforce)"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  fontFamily: fonts.mono,
                  color: field ? colors.textMuted : colors.text,
                  background: field ? colors.surfaceHover : colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: field ? 'not-allowed' : 'text',
                }}
              />
            </div>

            {/* CRM Property Label */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                CRM Property Label (Optional)
              </label>
              <input
                type="text"
                value={crmPropertyLabel}
                onChange={(e) => setCrmPropertyLabel(e.target.value)}
                disabled={!!field}
                placeholder="Original label from CRM"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  color: field ? colors.textMuted : colors.text,
                  background: field ? colors.surfaceHover : colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: field ? 'not-allowed' : 'text',
                }}
              />
            </div>

            {/* Help Text */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>
                Help Text (Optional)
              </label>
              <textarea
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Tooltip text to help users understand this field"
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  color: colors.text,
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontFamily: fonts.sans,
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Is Required */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, color: colors.text }}>
                Mark as required field
              </span>
            </label>
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: 12,
            marginTop: 24,
            paddingTop: 20,
            borderTop: `1px solid ${colors.border}`,
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: colors.textSecondary,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: '#fff',
                background: saving ? colors.textDim : colors.accent,
                border: 'none',
                borderRadius: 6,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : field ? 'Update Field' : 'Add Field'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

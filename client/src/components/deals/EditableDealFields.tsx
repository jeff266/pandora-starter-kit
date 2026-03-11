import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Check, X, Edit2, AlertCircle } from 'lucide-react';

interface PicklistOption {
  value: string;
  label: string;
}

interface EditableField {
  id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  crm_property_name: string;
  is_required: boolean;
  help_text: string | null;
  field_options?: PicklistOption[] | null;
}

interface EditableDealFieldsProps {
  dealId: string;
  deal: any;
  onFieldUpdate?: (fieldName: string, newValue: any) => void;
}

function getFieldValue(deal: any, field: EditableField): any {
  const byName = deal?.[field.field_name];
  if (byName !== undefined && byName !== null) return byName;
  const byCRMKey = deal?.custom_fields?.[field.crm_property_name];
  if (byCRMKey !== undefined && byCRMKey !== null) return byCRMKey;
  const byFieldName = deal?.custom_fields?.[field.field_name];
  if (byFieldName !== undefined && byFieldName !== null) return byFieldName;
  return null;
}

function parseCRMError(raw: string): string {
  try {
    const match = raw.match(/^\S+ API \d+: (.+)$/s);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed) && parsed[0]?.message) {
        return parsed[0].message;
      }
    }
  } catch {
  }
  return raw;
}

export default function EditableDealFields({ dealId, deal, onFieldUpdate }: EditableDealFieldsProps) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [fields, setFields] = useState<EditableField[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crmWarnings, setCrmWarnings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (workspaceId) {
      fetchFields();
    }
  }, [workspaceId]);

  const fetchFields = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/editable-fields`);
      setFields(data.fields || []);
    } catch (err: any) {
      console.error('Failed to fetch editable fields:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (field: EditableField) => {
    setEditingField(field.field_name);
    setEditValue(getFieldValue(deal, field) ?? '');
    setError(null);
    setCrmWarnings((prev) => {
      const next = { ...prev };
      delete next[field.field_name];
      return next;
    });
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue(null);
    setError(null);
  };

  const handleSaveEdit = async (field: EditableField) => {
    if (field.is_required && (editValue === null || editValue === undefined || editValue === '')) {
      setError('This field is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await api.patch(`/deals/${dealId}/field`, {
        field_name: field.field_name,
        value: editValue,
      });

      if (onFieldUpdate) {
        onFieldUpdate(field.field_name, editValue);
      }

      setEditingField(null);
      setEditValue(null);

      if (result?.warning) {
        setCrmWarnings((prev) => ({
          ...prev,
          [field.field_name]: parseCRMError(result.crm_error || result.warning),
        }));
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.response?.data?.crm_error || 'Failed to update field';
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: colors.textMuted,
          marginBottom: 12,
        }}>
          Key Deal Information
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted }}>Loading editable fields...</div>
      </div>
    );
  }

  if (fields.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '14px 20px',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: colors.textMuted,
        marginBottom: 14,
      }}>
        Key Deal Information
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            value={getFieldValue(deal, field)}
            isEditing={editingField === field.field_name}
            editValue={editValue}
            saving={saving}
            error={error}
            crmWarning={crmWarnings[field.field_name] ?? null}
            onStartEdit={() => handleStartEdit(field)}
            onCancelEdit={handleCancelEdit}
            onSaveEdit={() => handleSaveEdit(field)}
            onValueChange={setEditValue}
          />
        ))}
      </div>
    </div>
  );
}

interface FieldRowProps {
  field: EditableField;
  value: any;
  isEditing: boolean;
  editValue: any;
  saving: boolean;
  error: string | null;
  crmWarning: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onValueChange: (value: any) => void;
}

function FieldRow({
  field,
  value,
  isEditing,
  editValue,
  saving,
  error,
  crmWarning,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onValueChange,
}: FieldRowProps) {
  const displayValue = formatFieldValue(value, field.field_type, field.field_options);
  const isEmpty = value === null || value === undefined || value === '';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '10px 12px',
      background: isEditing ? colors.accentSoft : 'transparent',
      border: `1px solid ${isEditing ? colors.accent : colors.border}`,
      borderRadius: 6,
      transition: 'all 0.15s',
    }}>
      {/* Label */}
      <div style={{ width: 140, flexShrink: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: colors.textSecondary,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {field.field_label}
          {field.is_required && <span style={{ color: colors.red }}>*</span>}
        </div>
        {field.help_text && (
          <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' }}>
            {field.help_text}
          </div>
        )}
      </div>

      {/* Value / Input */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <div>
            <FieldInput
              type={field.field_type}
              value={editValue}
              onChange={onValueChange}
              disabled={saving}
              options={field.field_options}
            />
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                fontSize: 11,
                color: colors.red,
              }}>
                <AlertCircle size={12} />
                {error}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{
              fontSize: 13,
              color: isEmpty ? colors.textMuted : colors.text,
              fontStyle: isEmpty ? 'italic' : 'normal',
            }}>
              {isEmpty ? 'Not set' : displayValue}
            </div>
            {crmWarning && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 5,
                marginTop: 5,
                padding: '5px 8px',
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: 4,
                fontSize: 11,
                color: '#92400e',
                lineHeight: 1.4,
              }}>
                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1, color: '#b45309' }} />
                <span><strong>CRM sync failed:</strong> {crmWarning}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
        {isEditing ? (
          <>
            <button
              onClick={onSaveEdit}
              disabled={saving}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: 'none',
                borderRadius: 4,
                background: saving ? colors.textDim : colors.green,
                color: '#fff',
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Save"
            >
              <Check size={14} />
            </button>
            <button
              onClick={onCancelEdit}
              disabled={saving}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                background: 'transparent',
                color: colors.textSecondary,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Cancel"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={onStartEdit}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              background: 'transparent',
              color: colors.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.surfaceHover;
              e.currentTarget.style.color = colors.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = colors.textSecondary;
            }}
            title="Edit"
          >
            <Edit2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

interface FieldInputProps {
  type: string;
  value: any;
  onChange: (value: any) => void;
  disabled: boolean;
  options?: PicklistOption[] | null;
}

function FieldInput({ type, value, onChange, disabled, options }: FieldInputProps) {
  const baseStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.text,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box',
  };

  switch (type) {
    case 'picklist':
      if (options && options.length > 0) {
        return (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            style={{ ...baseStyle, cursor: disabled ? 'not-allowed' : 'pointer' }}
          >
            <option value="">— select —</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
      }
      return (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={baseStyle}
        />
      );

    case 'textarea':
      return (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          style={{
            ...baseStyle,
            resize: 'vertical',
            fontFamily: fonts.sans,
          }}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
          disabled={disabled}
          style={baseStyle}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          value={value ? new Date(value).toISOString().split('T')[0] : ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          style={baseStyle}
        />
      );

    case 'boolean':
      return (
        <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={value === true}
              onChange={() => onChange(true)}
              disabled={disabled}
              style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontSize: 13, color: colors.text }}>Yes</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={value === false}
              onChange={() => onChange(false)}
              disabled={disabled}
              style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontSize: 13, color: colors.text }}>No</span>
          </label>
        </div>
      );

    case 'text':
    default:
      return (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={baseStyle}
        />
      );
  }
}

function formatFieldValue(value: any, type: string, options?: PicklistOption[] | null): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  switch (type) {
    case 'picklist': {
      if (options && options.length > 0) {
        const match = options.find((o) => o.value === String(value));
        if (match) return match.label;
      }
      return String(value);
    }
    case 'date':
      return new Date(value).toLocaleDateString();
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}

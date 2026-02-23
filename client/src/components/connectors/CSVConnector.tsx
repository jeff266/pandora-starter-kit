import { useState, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api, getWorkspaceId } from '../../lib/api';
import StatusDot from '../shared/StatusDot';

interface CSVConnectorProps {
  onToast: (toast: { message: string; type: 'success' | 'error' }) => void;
}

interface ColumnMapping {
  source_column: string;
  pandora_field: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ParsedPreview {
  file_info: { filename: string; size: number; format: string };
  headers: string[];
  row_count: number;
  preview_rows: Record<string, any>[];
  suggested_mappings: ColumnMapping[];
  unmapped_columns: string[];
  has_required_fields: boolean;
}

interface ImportResult {
  success: boolean;
  import_id: string;
  records_imported: number;
  records_matched: number;
  records_unmatched: number;
  average_confidence: number;
  unmatched_count: number;
}

const PANDORA_FIELDS = [
  { value: 'skip', label: 'Skip' },
  { value: 'domain', label: 'Domain' },
  { value: 'company_name', label: 'Company Name' },
  { value: 'industry', label: 'Industry' },
  { value: 'employee_count', label: 'Employee Count' },
  { value: 'employee_range', label: 'Employee Range' },
  { value: 'revenue_range', label: 'Revenue Range' },
  { value: 'funding_stage', label: 'Funding Stage' },
  { value: 'hq_country', label: 'HQ Country' },
  { value: 'hq_state', label: 'HQ State' },
  { value: 'hq_city', label: 'HQ City' },
  { value: 'tech_stack', label: 'Tech Stack' },
  { value: 'growth_signal', label: 'Growth Signal' },
  { value: 'founded_year', label: 'Founded Year' },
  { value: 'public_or_private', label: 'Public/Private' },
];

export default function CSVConnector({ onToast }: CSVConnectorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      await handleFileSelect(droppedFile);
    }
  }

  async function handleFileSelect(selectedFile: File) {
    const ext = selectedFile.name.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      onToast({ message: 'Only .csv, .xlsx, and .xls files are supported', type: 'error' });
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      onToast({ message: 'File size must be less than 25MB', type: 'error' });
      return;
    }

    setFile(selectedFile);
    setResult(null);

    // Upload for preview
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const workspaceId = getWorkspaceId();
      const response = await fetch(`/api/workspaces/${workspaceId}/enrichment/csv/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data: ParsedPreview = await response.json();
      setPreview(data);
      setMappings(data.suggested_mappings);

      if (!data.has_required_fields) {
        onToast({
          message: 'No domain or company_name column detected. Map one to proceed.',
          type: 'error',
        });
      }
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to parse file', type: 'error' });
      setFile(null);
      setPreview(null);
    }
  }

  function handleMappingChange(sourceColumn: string, pandoraField: string) {
    setMappings(prev =>
      prev.map(m =>
        m.source_column === sourceColumn ? { ...m, pandora_field: pandoraField } : m
      )
    );
  }

  async function handleImport() {
    if (!file || !preview) return;

    // Validate required fields
    const hasDomain = mappings.some(m => m.pandora_field === 'domain');
    const hasCompanyName = mappings.some(m => m.pandora_field === 'company_name');

    if (!hasDomain && !hasCompanyName) {
      onToast({
        message: 'Please map at least one identifier: domain or company_name',
        type: 'error',
      });
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mappings', JSON.stringify(mappings));

      const workspaceId = getWorkspaceId();
      const response = await fetch(`/api/workspaces/${workspaceId}/enrichment/csv/import`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }

      const data: ImportResult = await response.json();
      setResult(data);
      onToast({
        message: `Import complete: ${data.records_matched} matched, ${data.records_unmatched} unmatched`,
        type: 'success',
      });

      // Reset for next import
      setFile(null);
      setPreview(null);
      setMappings([]);
    } catch (error: any) {
      onToast({ message: error.message || 'Import failed', type: 'error' });
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setFile(null);
    setPreview(null);
    setMappings([]);
    setResult(null);
  }

  async function handleDownloadUnmatched() {
    if (!result) return;

    try {
      const workspaceId = getWorkspaceId();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/enrichment/csv/imports/${result.import_id}/unmatched/download`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unmatched-records-${result.import_id}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      onToast({ message: error.message || 'Download failed', type: 'error' });
    }
  }

  const hasDomain = mappings.some(m => m.pandora_field === 'domain');
  const hasCompanyName = mappings.some(m => m.pandora_field === 'company_name');
  const canImport = hasDomain || hasCompanyName;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
            CSV Upload
          </h2>
          <StatusDot color={result ? colors.green : colors.textMuted} size={8} />
        </div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Universal fallback (.csv, .xlsx, .xls)
        </p>
      </div>

      {/* Upload Result */}
      {result && (
        <div
          style={{
            padding: 16,
            background: colors.greenSoft,
            border: `1px solid ${colors.green}`,
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
            Import Complete
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Imported</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>
                {result.records_imported}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Matched</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>
                {result.records_matched}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Unmatched</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>
                {result.records_unmatched}
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingTop: 12,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            {result.records_unmatched > 0 && (
              <button
                onClick={handleDownloadUnmatched}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Download Unmatched
              </button>
            )}
            <button
              onClick={handleReset}
              style={{
                flex: 1,
                padding: '8px 12px',
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
              Upload Another
            </button>
          </div>
        </div>
      )}

      {/* Upload Area or Mapping UI */}
      {!preview && !result ? (
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: 40,
            border: `2px dashed ${dragActive ? colors.accent : colors.border}`,
            borderRadius: 8,
            background: dragActive ? colors.accentSoft : colors.surfaceRaised,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
            Drop CSV or Excel file here
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary }}>
            or click to browse (.csv, .xlsx, .xls, max 25MB)
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => {
              const selectedFile = e.target.files?.[0];
              if (selectedFile) handleFileSelect(selectedFile);
            }}
          />
        </div>
      ) : preview && !result ? (
        /* Column Mapping UI */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
              {preview.file_info.filename}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              {preview.row_count} rows detected
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.text,
                marginBottom: 12,
              }}
            >
              Column Mappings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mappings.map(mapping => (
                <div
                  key={mapping.source_column}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: 8,
                    background: colors.surfaceRaised,
                    borderRadius: 6,
                  }}
                >
                  <div style={{ flex: 1, fontSize: 12, color: colors.text, fontFamily: fonts.mono }}>
                    {mapping.source_column}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>→</div>
                  <select
                    value={mapping.pandora_field}
                    onChange={e => handleMappingChange(mapping.source_column, e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      fontFamily: fonts.sans,
                      color: colors.text,
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      outline: 'none',
                    }}
                  >
                    {PANDORA_FIELDS.map(field => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background:
                        mapping.confidence === 'high'
                          ? colors.green
                          : mapping.confidence === 'medium'
                          ? colors.yellow
                          : colors.textMuted,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {!canImport && (
            <div
              style={{
                padding: 12,
                background: colors.redSoft,
                border: `1px solid ${colors.red}`,
                borderRadius: 6,
                fontSize: 12,
                color: colors.text,
              }}
            >
              Map at least one identifier: domain or company_name
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleReset}
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
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: !canImport || importing ? colors.textMuted : '#fff',
                background: !canImport || importing ? colors.surfaceHover : colors.accent,
                border: 'none',
                borderRadius: 6,
                cursor: !canImport || importing ? 'not-allowed' : 'pointer',
              }}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import React, { useCallback, useRef, useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';

interface ParsedRow {
  [key: string]: string;
}

interface ImportResult {
  rows_parsed: number;
  rows_applied: number;
  rows_skipped: number;
  dimensions_updated: number;
  errors: string[];
  skip_reasons?: string[];
}

type UploadState = 'idle' | 'preview' | 'uploading' | 'success' | 'error';

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: ParsedRow = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function formatNum(s: string): string {
  const n = parseFloat(s.replace(/,/g, ''));
  if (isNaN(n)) return s;
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;
}

interface QuotaImportSectionProps {
  onImportComplete?: () => void;
}

export default function QuotaImportSection({ onImportComplete }: QuotaImportSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: ParsedRow[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback((f: File) => {
    if (!f.name.endsWith('.csv') && f.type !== 'text/csv') {
      setError('Please select a CSV file.');
      setState('error');
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) {
        setError('The file appears to be empty or invalid.');
        setState('error');
        return;
      }
      setParsed({ headers, rows });
      setState('preview');
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setState('uploading');
    try {
      const formData = new FormData();
      formData.append('quota_csv', file);
      const res = await api.upload('/quota/import', formData) as ImportResult;
      setResult(res);
      setState('success');
      onImportComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Check the file format and try again.');
      setState('error');
    }
  }, [file, onImportComplete]);

  const reset = () => {
    setState('idle');
    setFile(null);
    setParsed(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const SECTION_HEADER: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    margin: '0 0 4px',
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      fontFamily: fonts.sans,
    }}>
      <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 12 }}>
        <div style={SECTION_HEADER}>Quota Import</div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Import quota targets from a spreadsheet. Supports rep-level and team-level CSV formats.
        </p>
      </div>

      {state === 'idle' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          style={{
            border: `2px dashed ${dragOver ? '#14B8A6' : '#2A3F52'}`,
            borderRadius: 8,
            background: dragOver ? 'rgba(20,184,166,0.06)' : colors.surfaceRaised,
            padding: '32px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10, color: '#14B8A6' }}>↑</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Drop a CSV file here, or click to browse
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6 }}>
            <div><strong>Rep-level:</strong> rep_email, quota, period, dimension</div>
            <div><strong>Team-level:</strong> dimension, quota, period</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </div>
      )}

      {state === 'preview' && parsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Preview <strong style={{ color: colors.text }}>{parsed.rows.length} rows detected</strong>
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 6, border: `1px solid ${colors.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: colors.surfaceRaised }}>
                  {parsed.headers.map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: colors.textSecondary, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${colors.border}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {parsed.headers.map(h => (
                      <td key={h} style={{ padding: '7px 12px', color: colors.text, whiteSpace: 'nowrap' }}>
                        {h === 'quota' ? formatNum(row[h]) : row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 5 && (
            <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>
              …and {parsed.rows.length - 5} more rows
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={reset} style={ghostBtn}>Cancel</button>
            <button onClick={handleUpload} style={primaryBtn}>
              Import {parsed.rows.length} rows →
            </button>
          </div>
        </div>
      )}

      {state === 'uploading' && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          Importing…
        </div>
      )}

      {state === 'success' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>✓ Import complete</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <div style={{ color: colors.textSecondary }}>{result.rows_parsed} rows parsed</div>
            <div style={{ color: '#14B8A6', fontWeight: 500 }}>
              {result.rows_applied} rows applied → {result.dimensions_updated} dimension{result.dimensions_updated !== 1 ? 's' : ''} updated
            </div>
            {result.rows_skipped > 0 && (
              <div style={{ color: '#f59e0b', fontWeight: 500 }}>
                {result.rows_skipped} rows skipped
                {result.skip_reasons && result.skip_reasons.length > 0 && (
                  <span style={{ fontWeight: 400 }}> — {result.skip_reasons[0]}</span>
                )}
              </div>
            )}
            {result.errors.map((e, i) => (
              <div key={i} style={{ color: '#f87171', fontSize: 12 }}>{e}</div>
            ))}
          </div>
          <button onClick={reset} style={ghostBtn}>Import another file</button>
        </div>
      )}

      {state === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171' }}>✗ Import failed</div>
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            {error || 'Could not parse the file. Check that it has the correct column headers and is saved as CSV.'}
          </div>
          <button onClick={reset} style={ghostBtn}>Try again</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  background: '#14B8A6',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: '#64748b',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

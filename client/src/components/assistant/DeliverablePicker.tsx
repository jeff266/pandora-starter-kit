import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api, getAuthToken } from '../../lib/api';

export interface DeliverableOption {
  id: string;
  label: string;
  icon: string;
  sub: string;
}

interface DeliverablePickerProps {
  options: DeliverableOption[];
  content?: string;
  title?: string;
}

type ExportState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'download'; url: string }
  | { status: 'sent'; to?: string }
  | { status: 'error'; message: string };

async function downloadViaAuth(url: string) {
  const token = getAuthToken();
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const filename = url.split('/').pop() || 'document';
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}

export default function DeliverablePicker({ options, content = '', title = 'Pandora Analysis' }: DeliverablePickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  const handleSelect = async (id: string) => {
    setSelected(id);
    setExportState({ status: 'generating' });

    try {
      const result = await api.post('/deliverables/generate', { format: id, content, title });

      if (result.downloadUrl) {
        setExportState({ status: 'download', url: result.downloadUrl });
        await downloadViaAuth(result.downloadUrl);
      } else if (result.sent) {
        setExportState({ status: 'sent', to: result.to });
      } else if (result.error) {
        setExportState({ status: 'error', message: result.error });
      } else {
        setExportState({ status: 'idle' });
      }
    } catch (err: any) {
      setExportState({ status: 'error', message: err?.message || 'Export failed' });
    }
  };

  const isGenerating = exportState.status === 'generating';

  const statusLine = () => {
    switch (exportState.status) {
      case 'generating':
        return <span style={{ color: colors.textMuted }}>Generating...</span>;
      case 'download':
        return (
          <span>
            <span
              onClick={() => downloadViaAuth(exportState.url).catch(() => {})}
              style={{ color: colors.accent, textDecoration: 'none', fontWeight: 500, cursor: 'pointer' }}
            >
              Download ↓
            </span>
            <span style={{ color: colors.textMuted }}> — or click again to re-download</span>
          </span>
        );
      case 'sent':
        return (
          <span style={{ color: colors.green }}>
            Sent ✓{exportState.to ? ` to ${exportState.to}` : ''}
          </span>
        );
      case 'error':
        return <span style={{ color: colors.red }}>{exportState.message}</span>;
      default:
        return null;
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontFamily: fonts.sans }}>
        Export As
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {options.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => !isGenerating && handleSelect(opt.id)}
              style={{
                background: isSelected ? colors.accentSoft : colors.surface,
                border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                borderRadius: 8, padding: '10px 12px',
                cursor: isGenerating ? 'default' : 'pointer',
                transition: 'all 0.15s',
                opacity: isGenerating && !isSelected ? 0.5 : 1,
              }}
              onMouseEnter={e => { if (!isSelected && !isGenerating) { (e.currentTarget as HTMLDivElement).style.borderColor = colors.accent; } }}
              onMouseLeave={e => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = colors.border; } }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{opt.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>{opt.sub}</div>
            </div>
          );
        })}
      </div>
      {exportState.status !== 'idle' && (
        <div style={{ marginTop: 10, fontSize: 12, fontFamily: fonts.sans }}>
          {statusLine()}
        </div>
      )}
    </div>
  );
}

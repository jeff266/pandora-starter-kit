import { useState, useEffect } from 'react';
import type { ExportConfig } from '../../types/export';

interface ModalSection {
  id: string;
  title: string;
}

interface ModalReportDocument {
  sections: ModalSection[];
  week_label?: string;
  headline?: string;
}

interface PrepareForClientModalProps {
  reportDocument: ModalReportDocument;
  defaultFormat: 'pdf' | 'docx' | 'pptx';
  workspaceName?: string;
  onExport: (config: ExportConfig) => Promise<void>;
  onClose: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  the_number:             'The Number',
  the_story:              'This Week',
  deals_requiring_action: 'Deals Requiring Action',
  rep_status:             'Rep Status',
  week_in_review:         'Week in Review',
  forecast_position:      'Forecast Position',
  pipeline_health:        'Pipeline Health',
  team_performance:       'Team Performance',
};

const FORMAT_OPTIONS: Array<{ value: ExportConfig['format']; label: string }> = [
  { value: 'pdf',  label: 'PDF'  },
  { value: 'docx', label: 'DOCX' },
  { value: 'pptx', label: 'PPTX' },
];

export default function PrepareForClientModal({
  reportDocument,
  defaultFormat,
  workspaceName = '',
  onExport,
  onClose,
}: PrepareForClientModalProps) {
  const [format, setFormat] = useState<ExportConfig['format']>(defaultFormat);
  const [includedSections, setIncludedSections] = useState<string[]>(
    reportDocument.sections.map(s => s.id)
  );
  const [preparedBy, setPreparedBy] = useState('RevOps Impact');
  const [forCompany, setForCompany] = useState(workspaceName);
  const [anonymize, setAnonymize] = useState(false);
  const [audience, setAudience] = useState<'internal' | 'client'>('client');
  const [includeActions, setIncludeActions] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (audience === 'client') {
      setAnonymize(true);
    } else {
      setAnonymize(false);
    }
  }, [audience]);

  function toggleSection(id: string, checked: boolean) {
    setIncludedSections(prev =>
      checked ? [...prev, id] : prev.filter(s => s !== id)
    );
  }

  async function handleExport() {
    if (includedSections.length === 0 || exporting) return;
    setExporting(true);
    const config: ExportConfig = {
      format,
      audience,
      included_sections: includedSections,
      prepared_by: preparedBy,
      for_company: forCompany,
      anonymize,
      link_target: audience === 'client' ? 'hubspot' : 'command_center',
      include_actions: includeActions,
    };
    try {
      await onExport(config);
    } finally {
      setExporting(false);
    }
  }

  const canExport = includedSections.length > 0 && !exporting;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
            Prepare for Export
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 8px', fontSize: 18, color: '#9CA3AF', lineHeight: 1,
            }}
          >✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Format */}
          <div>
            <div style={sectionHeader}>Format</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {FORMAT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setFormat(opt.value)}
                  style={{
                    padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                    background: format === opt.value ? '#4f46e5' : '#F9FAFB',
                    color: format === opt.value ? '#fff' : '#374151',
                    border: `1px solid ${format === opt.value ? '#4f46e5' : '#E5E7EB'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Include sections */}
          <div>
            <div style={sectionHeader}>Include sections</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {reportDocument.sections.map(section => (
                <label key={section.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', cursor: 'pointer', fontSize: 14, color: '#374151',
                }}>
                  <input
                    type="checkbox"
                    checked={includedSections.includes(section.id)}
                    onChange={e => toggleSection(section.id, e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  {SECTION_LABELS[section.id] || section.title}
                </label>
              ))}
              {includedSections.length === 0 && (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>
                  Select at least one section
                </div>
              )}
            </div>
          </div>

          {/* Branding */}
          <div>
            <div style={sectionHeader}>Branding</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 13, color: '#6B7280', minWidth: 90 }}>Prepared by</label>
                <input
                  type="text"
                  value={preparedBy}
                  onChange={e => setPreparedBy(e.target.value)}
                  placeholder="RevOps Impact"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 13, color: '#6B7280', minWidth: 90 }}>For</label>
                <input
                  type="text"
                  value={forCompany}
                  onChange={e => setForCompany(e.target.value)}
                  placeholder="Client company"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div>
            <div style={sectionHeader}>Options</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Anonymize */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={anonymize}
                  onChange={e => setAnonymize(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 14, color: '#374151' }}>Anonymize rep names</span>
              </label>

              {/* Audience */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(['internal', 'client'] as const).map(a => (
                    <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14, color: '#374151' }}>
                      <input
                        type="radio"
                        name="audience"
                        value={a}
                        checked={audience === a}
                        onChange={() => setAudience(a)}
                        style={{ cursor: 'pointer' }}
                      />
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  {audience === 'client'
                    ? 'Links resolve to HubSpot'
                    : 'Links resolve to Command Center'}
                </div>
              </div>

              {/* Include actions */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeActions}
                  onChange={e => setIncludeActions(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 14, color: '#374151' }}>Include action items</span>
                {audience === 'client' && (
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>(internal only)</span>
                )}
              </label>

            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '16px 24px',
          borderTop: '1px solid #F3F4F6',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 500,
              background: '#F9FAFB', color: '#374151', border: '1px solid #E5E7EB',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            style={{
              padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600,
              background: canExport ? '#4f46e5' : '#E5E7EB',
              color: canExport ? '#fff' : '#9CA3AF',
              border: 'none', cursor: canExport ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {exporting ? (
              <>
                <span style={{
                  width: 12, height: 12,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }} />
                Exporting…
              </>
            ) : (
              `Export ${format.toUpperCase()}`
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#9CA3AF',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #E5E7EB',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  color: '#111827',
  outline: 'none',
  fontFamily: 'inherit',
};

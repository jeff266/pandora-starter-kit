import { useState } from 'react';
import { getWorkspaceId, getAuthToken } from '../../lib/api';

interface ResponseChart {
  spec: any;
  png_base64: string;
  suggested_section_id?: string;
}

interface AddToReportButtonProps {
  chart: ResponseChart;
}

type ButtonState = 'idle' | 'picking' | 'saving' | 'saved' | 'error' | 'hidden';

const FALLBACK_SECTIONS = [
  { id: 'node-deal-execution', title: 'Deal Execution' },
  { id: 'node-pipeline-conv', title: 'Pipeline Conversion' },
  { id: 'node-team-execution', title: 'Team Execution' },
  { id: 'node-forward-look', title: 'Forward Look' },
];

export default function AddToReportButton({ chart }: AddToReportButtonProps) {
  const [btnState, setBtnState] = useState<ButtonState>('idle');
  const [reportId, setReportId] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const [selectedSection, setSelectedSection] = useState(chart.suggested_section_id || '');

  async function handleClick() {
    setBtnState('picking');
    const workspaceId = getWorkspaceId();
    const token = getAuthToken();
    if (!workspaceId) { setBtnState('error'); return; }

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/reports/current`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        setBtnState('hidden');
        return;
      }
      const report = await res.json();
      setReportId(report.id);

      const sectionList = Array.isArray(report.sections) && report.sections.length > 0
        ? report.sections.map((s: any) => ({ id: s.id || s.section_id, title: s.title }))
        : FALLBACK_SECTIONS;

      setSections(sectionList);

      if (!selectedSection && sectionList.length > 0) {
        setSelectedSection(chart.suggested_section_id || sectionList[0].id);
      }
    } catch {
      setBtnState('error');
    }
  }

  async function handleSave() {
    if (!reportId || !selectedSection) return;
    setBtnState('saving');
    const workspaceId = getWorkspaceId();
    const token = getAuthToken();

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/reports/${reportId}/charts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            section_id: selectedSection,
            chart_type: chart.spec?.chart_type || 'bar',
            title: chart.spec?.title || 'Chart',
            data_labels: (chart.spec?.data_points || []).map((d: any) => d.label),
            data_values: (chart.spec?.data_points || []).map((d: any) => d.value),
          }),
        }
      );
      if (!res.ok) throw new Error('Save failed');
      setBtnState('saved');
      setTimeout(() => setBtnState('idle'), 2000);
    } catch {
      setBtnState('error');
    }
  }

  if (btnState === 'hidden') return null;

  if (btnState === 'picking') {
    return (
      <div style={{
        marginTop: 8,
        padding: 12,
        background: 'var(--color-background-secondary, #F8FAFC)',
        borderRadius: 8,
        border: '0.5px solid var(--color-border-tertiary, #E2E8F0)',
        minWidth: 220,
      }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary, #1E293B)', marginBottom: 8 }}>
          Add to report section:
        </div>
        {sections.map(section => (
          <label key={section.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 0', fontSize: 12,
            color: 'var(--color-text-primary, #1E293B)', cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="pandora-chart-section"
              value={section.id}
              checked={selectedSection === section.id}
              onChange={() => setSelectedSection(section.id)}
            />
            {section.title}
          </label>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            onClick={() => setBtnState('idle')}
            style={{
              fontSize: 11, padding: '4px 10px',
              background: 'none',
              border: '0.5px solid var(--color-border-secondary, #CBD5E1)',
              borderRadius: 4,
              color: 'var(--color-text-secondary, #64748B)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedSection}
            style={{
              fontSize: 11, padding: '4px 12px',
              background: selectedSection ? '#0D9488' : '#CBD5E1',
              border: 'none', borderRadius: 4,
              color: 'white', cursor: selectedSection ? 'pointer' : 'not-allowed',
              fontWeight: 500,
            }}
          >
            Add to report
          </button>
        </div>
      </div>
    );
  }

  if (btnState === 'saving') {
    return (
      <button disabled style={{
        fontSize: 11, padding: '3px 10px', opacity: 0.6,
        cursor: 'not-allowed', border: '0.5px solid var(--color-border-tertiary, #E2E8F0)',
        borderRadius: 4, background: 'none',
        color: 'var(--color-text-secondary, #64748B)',
      }}>
        Adding...
      </button>
    );
  }

  if (btnState === 'saved') {
    return (
      <button style={{
        fontSize: 11, padding: '3px 10px',
        background: '#F0FDF9', border: '0.5px solid #0D9488',
        borderRadius: 4, color: '#0D9488', cursor: 'default', fontWeight: 500,
      }}>
        ✓ Added
      </button>
    );
  }

  if (btnState === 'error') {
    return (
      <button onClick={handleClick} style={{
        fontSize: 11, padding: '3px 10px', background: 'none',
        border: '0.5px solid #EF4444', borderRadius: 4,
        color: '#EF4444', cursor: 'pointer',
      }}>
        Retry
      </button>
    );
  }

  return (
    <button onClick={handleClick} style={{
      fontSize: 11, padding: '3px 10px', background: 'none',
      border: '0.5px solid var(--color-border-secondary, #CBD5E1)',
      borderRadius: 4, color: 'var(--color-text-secondary, #64748B)', cursor: 'pointer',
    }}>
      + Add to report
    </button>
  );
}

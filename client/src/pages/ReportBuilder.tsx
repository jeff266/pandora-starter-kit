import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import LivePreviewModal from '../components/reports/LivePreviewModal';
import { colors, fonts } from '../styles/theme';
import {
  GripVertical,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Eye,
  Save,
  X,
  Upload,
  Clock,
  Mail,
  MessageSquare,
  FolderOpen,
} from 'lucide-react';

interface ReportSection {
  id: string;
  label: string;
  description: string;
  skills: string[];
  config: {
    detail_level: 'executive' | 'manager' | 'analyst';
    max_items?: number;
    include_deal_list?: boolean;
    include_chart?: boolean;
  };
  order: number;
  enabled: boolean;
}

interface ReportTemplate {
  id?: string;
  name: string;
  description: string;
  sections: ReportSection[];
  cadence: string;
  schedule_day?: number;
  schedule_time: string;
  schedule_day_of_month?: number;
  timezone: string;
  formats: string[];
  delivery_channels: any[];
  recipients: string[];
  branding_override?: any;
  voice_config: {
    detail_level: 'executive' | 'manager' | 'analyst';
    framing: 'direct' | 'consultative' | 'executive';
  };
  is_active: boolean;
}

const sectionLibrary: Record<string, { label: string; description: string }> = {
  'the-number': { label: 'The Number', description: 'Forecast landing zone with bear/base/bull scenarios and pacing bar' },
  'what-moved': { label: 'What Moved This Week', description: 'Closed-won deals, stage changes, pushed deals, and net pipeline movement' },
  'deals-needing-attention': { label: 'Deals Needing Attention', description: 'Risk-flagged deals with recommended actions and signal severity' },
  'rep-performance': { label: 'Rep Performance', description: 'Performance table with pipeline coverage, win rates, and narrative takeaways' },
  'pipeline-hygiene': { label: 'Pipeline Hygiene', description: 'Data quality issues with quantified pipeline impact and recommended fixes' },
  'call-intelligence': { label: 'Call Intelligence', description: 'Competitor mentions, champion signals, objections, and coaching opportunities' },
  'pipeline-coverage': { label: 'Pipeline Coverage', description: 'Coverage ratios by rep/segment with gap analysis and required new pipeline' },
  'forecast-waterfall': { label: 'Forecast Waterfall', description: 'Pipeline flow visualization showing stage-to-stage conversion' },
  'icp-fit-analysis': { label: 'ICP Fit Analysis', description: 'Account fit scores against ideal customer profile with signal breakdown' },
  'actions-summary': { label: 'Actions Summary', description: 'Recommended actions from skills with urgency and impact priority' },
};

export default function ReportBuilder() {
  const { reportId } = useParams<{ reportId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspaceId = window.location.pathname.split('/')[2] || 'default';

  const [template, setTemplate] = useState<ReportTemplate>({
    name: '',
    description: '',
    sections: [],
    cadence: 'weekly',
    schedule_time: '07:00',
    schedule_day: 1,
    timezone: 'America/Los_Angeles',
    formats: ['pdf'],
    delivery_channels: [],
    recipients: [],
    voice_config: { detail_level: 'manager', framing: 'direct' },
    is_active: true,
  });

  const [availableSections, setAvailableSections] = useState<any[]>([]);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAvailableSections();

    if (reportId && reportId !== 'new') {
      loadReport(reportId);
    } else {
      // Check for template
      const templateId = searchParams.get('template');
      if (templateId && templateId !== 'blank') {
        applyTemplate(templateId);
      }
    }
  }, [reportId]);

  async function loadAvailableSections() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/report-sections`);
      const data = await res.json();
      setAvailableSections(data.sections || []);
    } catch (err) {
      console.error('Failed to load sections:', err);
    }
  }

  async function loadReport(id: string) {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reports/${id}`);
      const data = await res.json();
      setTemplate(data);
    } catch (err) {
      console.error('Failed to load report:', err);
    }
  }

  function applyTemplate(templateId: string) {
    const templates: Record<string, Partial<ReportTemplate>> = {
      'monday-pipeline-briefing': {
        name: 'Monday Pipeline Briefing',
        description: 'Weekly pipeline review for leadership',
        cadence: 'weekly',
        schedule_day: 1,
        schedule_time: '07:00',
        sections: ['the-number', 'what-moved', 'deals-needing-attention', 'actions-summary']
          .map((id, idx) => createSection(id, idx)),
      },
      'executive-monthly': {
        name: 'Executive Monthly Report',
        description: 'High-level monthly summary',
        cadence: 'monthly',
        schedule_day_of_month: 1,
        schedule_time: '07:00',
        sections: ['the-number', 'forecast-waterfall', 'rep-performance', 'actions-summary']
          .map((id, idx) => createSection(id, idx)),
      },
    };

    const templateData = templates[templateId];
    if (templateData) {
      setTemplate((prev) => ({ ...prev, ...templateData }));
    }
  }

  function createSection(sectionId: string, order: number): ReportSection {
    const def = availableSections.find((s) => s.id === sectionId);
    const libDef = sectionLibrary[sectionId];

    if (!def && !libDef) {
      return {
        id: sectionId,
        label: sectionId,
        description: '',
        skills: [],
        config: { detail_level: 'manager' },
        order,
        enabled: true,
      };
    }

    return {
      id: def?.id || sectionId,
      label: libDef?.label || def?.label || sectionId,
      description: libDef?.description || def?.description || '',
      skills: def?.skills || [],
      config: { detail_level: def?.default_detail_level || 'manager' },
      order,
      enabled: true,
    };
  }

  function addSection(sectionId: string) {
    const section = createSection(sectionId, template.sections.length);
    setTemplate((prev) => ({
      ...prev,
      sections: [...prev.sections, section],
    }));
    setShowSectionPicker(false);
  }

  function removeSection(index: number) {
    setTemplate((prev) => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index),
    }));
  }

  function moveSection(index: number, direction: 'up' | 'down') {
    const newSections = [...template.sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newSections.length) return;

    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

    // Update order
    newSections.forEach((section, idx) => {
      section.order = idx;
    });

    setTemplate((prev) => ({ ...prev, sections: newSections }));
  }

  async function saveReport() {
    if (!template.name.trim()) {
      alert('Please enter a report name');
      return;
    }

    if (template.sections.length === 0) {
      alert('Please add at least one section');
      return;
    }

    try {
      setSaving(true);

      const method = reportId && reportId !== 'new' ? 'PUT' : 'POST';
      const url = reportId && reportId !== 'new'
        ? `/api/workspaces/${workspaceId}/reports/${reportId}`
        : `/api/workspaces/${workspaceId}/reports`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });

      if (res.ok) {
        const saved = await res.json();
        navigate(`/reports`);
      } else {
        alert('Failed to save report');
      }
    } catch (err) {
      console.error('Failed to save report:', err);
      alert('Failed to save report');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            {reportId && reportId !== 'new' ? 'Edit Report' : 'New Report'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/reports')}
            style={{
              padding: '8px 16px',
              color: colors.text,
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              fontWeight: 500,
              fontFamily: fonts.sans,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          <button
            onClick={() => setShowLivePreview(true)}
            style={{
              padding: '8px 16px',
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontWeight: 500,
              fontFamily: fonts.sans,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Eye style={{ width: 16, height: 16 }} />
            Preview
          </button>
          <button
            onClick={saveReport}
            disabled={saving}
            style={{
              padding: '8px 16px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 500,
              fontFamily: fonts.sans,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Save style={{ width: 16, height: 16 }} />
            {saving ? 'Saving...' : 'Save Report'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Basic Info */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16, fontFamily: fonts.sans }}>Basic Information</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>
                Report Name
              </label>
              <input
                type="text"
                value={template.name}
                onChange={(e) => setTemplate((prev) => ({ ...prev, name: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: colors.surfaceRaised,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontFamily: fonts.sans,
                  fontSize: 14,
                  outline: 'none',
                }}
                placeholder="e.g., Monday Pipeline Briefing"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>
                Description
              </label>
              <textarea
                value={template.description}
                onChange={(e) => setTemplate((prev) => ({ ...prev, description: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: colors.surfaceRaised,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontFamily: fonts.sans,
                  fontSize: 14,
                  outline: 'none',
                  resize: 'vertical',
                }}
                rows={2}
                placeholder="Brief description of this report"
              />
            </div>
          </div>
        </div>

        {/* Sections */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0, fontFamily: fonts.sans }}>Sections</h2>
            <button
              onClick={() => setShowSectionPicker(true)}
              style={{
                padding: '6px 12px',
                background: colors.accent,
                color: '#fff',
                border: 'none',
                fontSize: 14,
                borderRadius: 6,
                fontWeight: 500,
                fontFamily: fonts.sans,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Plus style={{ width: 16, height: 16 }} />
              Add Section
            </button>
          </div>

          {template.sections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: colors.textMuted }}>
              <p style={{ marginBottom: 12, fontFamily: fonts.sans }}>No sections added yet</p>
              <button
                onClick={() => setShowSectionPicker(true)}
                style={{
                  color: colors.accent,
                  background: 'transparent',
                  border: 'none',
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                }}
              >
                Add your first section
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {template.sections.map((section, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 16,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                  }}
                >
                  <button style={{ color: colors.textMuted, background: 'transparent', border: 'none', cursor: 'move', padding: 0 }}>
                    <GripVertical style={{ width: 20, height: 20 }} />
                  </button>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: colors.text, fontFamily: fonts.sans, marginBottom: 4 }}>{section.label}</div>
                    <div style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>{section.description}</div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 12,
                      padding: '4px 8px',
                      background: colors.surfaceRaised,
                      color: colors.textSecondary,
                      borderRadius: 4,
                      fontFamily: fonts.sans
                    }}>
                      {section.config.detail_level}
                    </span>

                    <button
                      onClick={() => moveSection(idx, 'up')}
                      disabled={idx === 0}
                      style={{
                        padding: 4,
                        color: colors.textMuted,
                        background: 'transparent',
                        border: 'none',
                        cursor: idx === 0 ? 'not-allowed' : 'pointer',
                        opacity: idx === 0 ? 0.3 : 1,
                      }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveSection(idx, 'down')}
                      disabled={idx === template.sections.length - 1}
                      style={{
                        padding: 4,
                        color: colors.textMuted,
                        background: 'transparent',
                        border: 'none',
                        cursor: idx === template.sections.length - 1 ? 'not-allowed' : 'pointer',
                        opacity: idx === template.sections.length - 1 ? 0.3 : 1,
                      }}
                    >
                      ↓
                    </button>

                    <button style={{ padding: 8, color: colors.textMuted, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                      <SettingsIcon style={{ width: 16, height: 16 }} />
                    </button>
                    <button
                      onClick={() => removeSection(idx)}
                      style={{ padding: 8, color: colors.red, background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedule */}
        <ScheduleEditor template={template} setTemplate={setTemplate} />

        {/* Formats & Delivery */}
        <DeliveryEditor template={template} setTemplate={setTemplate} />

        {/* Branding */}
        <BrandingEditor template={template} setTemplate={setTemplate} />
      </div>

      {/* Section Picker Modal */}
      {showSectionPicker && (
        <SectionPickerModal
          availableSections={availableSections}
          selectedSections={template.sections.map((s) => s.id)}
          onSelect={addSection}
          onClose={() => setShowSectionPicker(false)}
        />
      )}

      {/* Live Preview Modal */}
      {showLivePreview && template.id && (
        <LivePreviewModal
          reportId={template.id}
          workspaceId={workspaceId!}
          reportName={template.name}
          onClose={() => setShowLivePreview(false)}
          onRemoveSection={(sectionId) => {
            setTemplate((prev: any) => ({
              ...prev,
              sections: prev.sections.map((s: any) =>
                s.section_id === sectionId ? { ...s, enabled: false } : s
              ),
            }));
          }}
          onActivate={() => {
            setShowLivePreview(false);
            saveReport();
          }}
        />
      )}
    </div>
  );
}

// Schedule Editor Component
function ScheduleEditor({ template, setTemplate }: any) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16, fontFamily: fonts.sans }}>Schedule</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>Cadence</label>
          <select
            value={template.cadence}
            onChange={(e) => setTemplate((prev: any) => ({ ...prev, cadence: e.target.value }))}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontFamily: fonts.sans,
              fontSize: 14,
              outline: 'none',
            }}
          >
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>

        {template.cadence === 'weekly' || template.cadence === 'biweekly' ? (
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>Day</label>
            <select
              value={template.schedule_day}
              onChange={(e) =>
                setTemplate((prev: any) => ({ ...prev, schedule_day: parseInt(e.target.value) }))
              }
              style={{
                width: '100%',
                padding: '8px 12px',
                background: colors.surfaceRaised,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontFamily: fonts.sans,
                fontSize: 14,
                outline: 'none',
              }}
            >
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
              <option value={6}>Saturday</option>
              <option value={0}>Sunday</option>
            </select>
          </div>
        ) : template.cadence === 'monthly' ? (
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>
              Day of Month
            </label>
            <input
              type="number"
              min={1}
              max={28}
              value={template.schedule_day_of_month || 1}
              onChange={(e) =>
                setTemplate((prev: any) => ({
                  ...prev,
                  schedule_day_of_month: parseInt(e.target.value),
                }))
              }
              style={{
                width: '100%',
                padding: '8px 12px',
                background: colors.surfaceRaised,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontFamily: fonts.sans,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        ) : null}

        {template.cadence !== 'manual' && (
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>Time</label>
            <input
              type="time"
              value={template.schedule_time}
              onChange={(e) =>
                setTemplate((prev: any) => ({ ...prev, schedule_time: e.target.value }))
              }
              style={{
                width: '100%',
                padding: '8px 12px',
                background: colors.surfaceRaised,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontFamily: fonts.sans,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>Timezone</label>
          <select
            value={template.timezone}
            onChange={(e) => setTemplate((prev: any) => ({ ...prev, timezone: e.target.value }))}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontFamily: fonts.sans,
              fontSize: 14,
              outline: 'none',
            }}
          >
            <option value="America/Los_Angeles">Pacific Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/New_York">Eastern Time</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// Delivery Editor Component
function DeliveryEditor({ template, setTemplate }: any) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16, fontFamily: fonts.sans }}>Format & Delivery</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>Formats</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {['pdf', 'docx', 'pptx'].map((format) => (
              <label key={format} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={template.formats.includes(format)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setTemplate((prev: any) => ({
                        ...prev,
                        formats: [...prev.formats, format],
                      }));
                    } else {
                      setTemplate((prev: any) => ({
                        ...prev,
                        formats: prev.formats.filter((f: string) => f !== format),
                      }));
                    }
                  }}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 14, textTransform: 'uppercase', fontWeight: 500, color: colors.text, fontFamily: fonts.sans }}>{format}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>Email Recipients</label>
          <input
            type="text"
            value={template.recipients.join(', ')}
            onChange={(e) =>
              setTemplate((prev: any) => ({
                ...prev,
                recipients: e.target.value.split(',').map((s: string) => s.trim()),
              }))
            }
            style={{
              width: '100%',
              padding: '8px 12px',
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontFamily: fonts.sans,
              fontSize: 14,
              outline: 'none',
            }}
            placeholder="email1@company.com, email2@company.com"
          />
        </div>
      </div>
    </div>
  );
}

// Branding Editor Component
function BrandingEditor({ template, setTemplate }: any) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16, fontFamily: fonts.sans }}>Branding</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="radio"
            checked={!template.branding_override}
            onChange={() => setTemplate((prev: any) => ({ ...prev, branding_override: null }))}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text, fontFamily: fonts.sans }}>Use workspace defaults</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="radio"
            checked={!!template.branding_override}
            onChange={() =>
              setTemplate((prev: any) => ({
                ...prev,
                branding_override: { primary_color: '#2563EB' },
              }))
            }
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text, fontFamily: fonts.sans }}>Customize</span>
        </label>
      </div>

      {template.branding_override && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>Primary Color</label>
            <input
              type="color"
              value={template.branding_override.primary_color || '#2563EB'}
              onChange={(e) =>
                setTemplate((prev: any) => ({
                  ...prev,
                  branding_override: { ...prev.branding_override, primary_color: e.target.value },
                }))
              }
              style={{
                width: '100%',
                height: 40,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Section Picker Modal
function SectionPickerModal({ availableSections, selectedSections, onSelect, onClose }: any) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50
    }}>
      <div style={{
        background: colors.surface,
        borderRadius: 8,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        maxWidth: 672,
        width: '100%',
        maxHeight: '80vh',
        overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 24,
          borderBottom: `1px solid ${colors.border}`
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0, fontFamily: fonts.sans }}>Add Section</h2>
          <button onClick={onClose} style={{ color: colors.textMuted, background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <div style={{ padding: 24, overflowY: 'auto', maxHeight: '60vh' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {availableSections.map((section: any) => {
              const isSelected = selectedSections.includes(section.id);
              const libDef = sectionLibrary[section.id];

              return (
                <button
                  key={section.id}
                  onClick={() => !isSelected && onSelect(section.id)}
                  disabled={isSelected}
                  style={{
                    textAlign: 'left',
                    padding: 16,
                    border: `1px solid ${isSelected ? colors.border : colors.border}`,
                    borderRadius: 8,
                    transition: 'border-color 0.2s, background 0.2s',
                    background: isSelected ? colors.surfaceRaised : colors.surface,
                    cursor: isSelected ? 'not-allowed' : 'pointer',
                    opacity: isSelected ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = colors.accent;
                      e.currentTarget.style.background = colors.surfaceRaised;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = colors.border;
                      e.currentTarget.style.background = colors.surface;
                    }
                  }}
                >
                  <div style={{ fontWeight: 500, color: colors.text, marginBottom: 4, fontFamily: fonts.sans }}>
                    {libDef?.label || section.label}
                  </div>
                  <div style={{ fontSize: 14, color: colors.textSecondary, fontFamily: fonts.sans }}>
                    {libDef?.description || section.description}
                  </div>
                  {isSelected && (
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: fonts.sans }}>Already added</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

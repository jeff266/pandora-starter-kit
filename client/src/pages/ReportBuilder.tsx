import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import LivePreviewModal from '../components/reports/LivePreviewModal';
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
    if (!def) {
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
      id: def.id,
      label: def.label,
      description: def.description,
      skills: def.skills,
      config: { detail_level: def.default_detail_level || 'manager' },
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
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {reportId && reportId !== 'new' ? 'Edit Report' : 'New Report'}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/reports')}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => setShowLivePreview(true)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium flex items-center gap-2"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={saveReport}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Report'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Basic Information</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Report Name
              </label>
              <input
                type="text"
                value={template.name}
                onChange={(e) => setTemplate((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Monday Pipeline Briefing"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={template.description}
                onChange={(e) => setTemplate((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                placeholder="Brief description of this report"
              />
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
            <button
              onClick={() => setShowSectionPicker(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Section
            </button>
          </div>

          {template.sections.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p className="mb-3">No sections added yet</p>
              <button
                onClick={() => setShowSectionPicker(true)}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Add your first section
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {template.sections.map((section, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-slate-300"
                >
                  <button className="text-slate-400 hover:text-slate-600 cursor-move">
                    <GripVertical className="w-5 h-5" />
                  </button>

                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{section.label}</div>
                    <div className="text-sm text-slate-500">{section.description}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded">
                      {section.config.detail_level}
                    </span>

                    <button
                      onClick={() => moveSection(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveSection(idx, 'down')}
                      disabled={idx === template.sections.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      ↓
                    </button>

                    <button className="p-2 text-slate-400 hover:text-slate-600">
                      <SettingsIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeSection(idx)}
                      className="p-2 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
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
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Schedule</h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Cadence</label>
          <select
            value={template.cadence}
            onChange={(e) => setTemplate((prev: any) => ({ ...prev, cadence: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
            <select
              value={template.schedule_day}
              onChange={(e) =>
                setTemplate((prev: any) => ({ ...prev, schedule_day: parseInt(e.target.value) }))
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : null}

        {template.cadence !== 'manual' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
            <input
              type="time"
              value={template.schedule_time}
              onChange={(e) =>
                setTemplate((prev: any) => ({ ...prev, schedule_time: e.target.value }))
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
          <select
            value={template.timezone}
            onChange={(e) => setTemplate((prev: any) => ({ ...prev, timezone: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Format & Delivery</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Formats</label>
          <div className="flex gap-3">
            {['pdf', 'docx', 'pptx'].map((format) => (
              <label key={format} className="flex items-center gap-2 cursor-pointer">
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
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm uppercase font-medium">{format}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Email Recipients</label>
          <input
            type="text"
            value={template.recipients.join(', ')}
            onChange={(e) =>
              setTemplate((prev: any) => ({
                ...prev,
                recipients: e.target.value.split(',').map((s: string) => s.trim()),
              }))
            }
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Branding</h2>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={!template.branding_override}
            onChange={() => setTemplate((prev: any) => ({ ...prev, branding_override: null }))}
            className="w-4 h-4 text-blue-600"
          />
          <span className="text-sm">Use workspace defaults</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={!!template.branding_override}
            onChange={() =>
              setTemplate((prev: any) => ({
                ...prev,
                branding_override: { primary_color: '#2563EB' },
              }))
            }
            className="w-4 h-4 text-blue-600"
          />
          <span className="text-sm">Customize</span>
        </label>
      </div>

      {template.branding_override && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Primary Color</label>
            <input
              type="color"
              value={template.branding_override.primary_color || '#2563EB'}
              onChange={(e) =>
                setTemplate((prev: any) => ({
                  ...prev,
                  branding_override: { ...prev.branding_override, primary_color: e.target.value },
                }))
              }
              className="w-full h-10 border border-slate-300 rounded-lg"
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Add Section</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="grid gap-3">
            {availableSections.map((section: any) => {
              const isSelected = selectedSections.includes(section.id);
              return (
                <button
                  key={section.id}
                  onClick={() => !isSelected && onSelect(section.id)}
                  disabled={isSelected}
                  className={`text-left p-4 border rounded-lg transition ${
                    isSelected
                      ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-50'
                      : 'border-slate-200 hover:border-blue-500 hover:bg-blue-50'
                  }`}
                >
                  <div className="font-medium text-slate-900 mb-1">{section.label}</div>
                  <div className="text-sm text-slate-600">{section.description}</div>
                  {isSelected && (
                    <div className="text-xs text-slate-500 mt-2">Already added</div>
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

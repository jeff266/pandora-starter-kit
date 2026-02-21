import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Calendar, Clock, AlertCircle, CheckCircle, Play } from 'lucide-react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  cadence: string;
  schedule_time: string;
  schedule_day?: number;
  is_active: boolean;
  last_generated_at?: string;
  last_generation_status?: string;
  last_generation_error?: string;
  next_due_at?: string;
  sections: any[];
  formats: string[];
  recipients: string[];
  created_at: string;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);

  const workspaceId = window.location.pathname.split('/')[2] || 'default';

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    try {
      setLoading(true);
      const data = await api.get('/reports');
      setReports(data.reports || []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }

  async function generateNow(reportId: string) {
    try {
      const generation = await api.post(`/reports/${reportId}/generate`, { preview: false });
      navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${generation.id}`);
    } catch (err) {
      console.error('Failed to generate report:', err);
      alert('Failed to generate report');
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ fontSize: 14, color: colors.textSecondary, fontFamily: fonts.sans }}>Loading reports...</div>
      </div>
    );
  }

  if (showTemplateGallery) {
    return (
      <TemplateGallery
        workspaceId={workspaceId}
        onSelect={(templateId) => {
          setShowTemplateGallery(false);
          navigate(`/reports/new?template=${templateId}`);
        }}
        onClose={() => setShowTemplateGallery(false)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Reports</h1>
          <p style={{ fontSize: 14, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
            Automated reports delivered on your schedule
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowTemplateGallery(true)}
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
            <FileText style={{ width: 16, height: 16 }} />
            Templates
          </button>
          <button
            onClick={() => navigate('/reports/new')}
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
            }}
          >
            <Plus style={{ width: 16, height: 16 }} />
            New Report
          </button>
        </div>
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 48,
          textAlign: 'center'
        }}>
          <FileText style={{ width: 48, height: 48, color: colors.textMuted, margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>No reports yet</h3>
          <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, fontFamily: fonts.sans }}>
            Create your first automated report to get started
          </p>
          <button
            onClick={() => setShowTemplateGallery(true)}
            style={{
              padding: '8px 16px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 500,
              fontFamily: fonts.sans,
              cursor: 'pointer',
            }}
          >
            Browse Templates
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              workspaceId={workspaceId}
              onGenerate={() => generateNow(report.id)}
              onEdit={() => navigate(`/reports/${report.id}/edit`)}
              onView={() => navigate(`/workspace/${workspaceId}/reports/${report.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ReportCardProps {
  report: ReportTemplate;
  workspaceId: string;
  onGenerate: () => void;
  onEdit: () => void;
  onView: () => void;
}

function ReportCard({ report, workspaceId, onGenerate, onEdit, onView }: ReportCardProps) {
  const statusColors = {
    success: { bg: '#22c55e', text: '#fff' },
    failed: { bg: '#ef4444', text: '#fff' },
    partial: { bg: '#f97316', text: '#fff' },
    running: { bg: colors.accent, text: '#fff' },
  };

  const statusIcons = {
    success: <CheckCircle style={{ width: 16, height: 16 }} />,
    failed: <AlertCircle style={{ width: 16, height: 16 }} />,
    partial: <AlertCircle style={{ width: 16, height: 16 }} />,
    running: <Clock style={{ width: 16, height: 16 }} />,
  };

  const cadenceLabels: Record<string, string> = {
    manual: 'Manual',
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 24,
      transition: 'border-color 0.2s'
    }}>
      <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0, fontFamily: fonts.sans }}>{report.name}</h3>
            {!report.is_active && (
              <span style={{
                padding: '2px 8px',
                background: colors.surfaceRaised,
                color: colors.textSecondary,
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 4,
                fontFamily: fonts.sans
              }}>
                Paused
              </span>
            )}
            {report.last_generation_status && (
              <span
                style={{
                  padding: '2px 8px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: fonts.sans,
                  background: statusColors[report.last_generation_status as keyof typeof statusColors]?.bg || colors.surfaceRaised,
                  color: statusColors[report.last_generation_status as keyof typeof statusColors]?.text || colors.textSecondary,
                }}
              >
                {statusIcons[report.last_generation_status as keyof typeof statusIcons]}
                {report.last_generation_status}
              </span>
            )}
          </div>

          {report.description && (
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16, fontFamily: fonts.sans }}>{report.description}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar style={{ width: 16, height: 16 }} />
              <span>{cadenceLabels[report.cadence]}</span>
              {report.schedule_time && report.cadence !== 'manual' && (
                <span>at {report.schedule_time}</span>
              )}
            </div>

            {report.last_generated_at && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock style={{ width: 16, height: 16 }} />
                <span>
                  Last: {new Date(report.last_generated_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}

            {report.next_due_at && report.is_active && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock style={{ width: 16, height: 16 }} />
                <span>
                  Next: {new Date(report.next_due_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText style={{ width: 16, height: 16 }} />
              <span>{report.sections.length} sections</span>
            </div>
          </div>

          {report.last_generation_error && (
            <div style={{
              marginTop: 12,
              padding: 12,
              background: '#ef444420',
              border: `1px solid #ef4444`,
              borderRadius: 8
            }}>
              <p style={{ fontSize: 14, color: colors.red, margin: 0, fontFamily: fonts.sans }}>{report.last_generation_error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
          <button
            onClick={onView}
            style={{
              padding: '8px 12px',
              fontSize: 14,
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
            View
          </button>
          <button
            onClick={onEdit}
            style={{
              padding: '8px 12px',
              fontSize: 14,
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
            Edit
          </button>
          <button
            onClick={onGenerate}
            style={{
              padding: '8px 12px',
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
            <Play style={{ width: 16, height: 16 }} />
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}

interface TemplateGalleryProps {
  workspaceId: string;
  onSelect: (templateId: string) => void;
  onClose: () => void;
}

function TemplateGallery({ workspaceId, onSelect, onClose }: TemplateGalleryProps) {
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

  const templates = [
    {
      id: 'monday-pipeline-briefing',
      name: 'Monday Pipeline Briefing',
      description: 'Weekly pipeline review for leadership with forecast, deals at risk, and actions',
      cadence: 'weekly',
      sections: ['the-number', 'what-moved', 'deals-needing-attention', 'actions-summary'],
      icon: '📊',
    },
    {
      id: 'executive-monthly',
      name: 'Executive Monthly Report',
      description: 'High-level monthly summary with forecast waterfall, rep performance, and key metrics',
      cadence: 'monthly',
      sections: ['the-number', 'forecast-waterfall', 'rep-performance', 'actions-summary'],
      icon: '📈',
    },
    {
      id: 'deal-review-weekly',
      name: 'Weekly Deal Review',
      description: 'Manager-level deal analysis with hygiene checks, single-thread alerts, and coverage',
      cadence: 'weekly',
      sections: ['deals-needing-attention', 'pipeline-hygiene', 'pipeline-coverage', 'call-intelligence'],
      icon: '🎯',
    },
    {
      id: 'quarterly-business-review',
      name: 'Quarterly Business Review',
      description: 'Comprehensive QBR with all sections, forecast, performance, and strategic actions',
      cadence: 'quarterly',
      sections: [
        'the-number',
        'what-moved',
        'forecast-waterfall',
        'rep-performance',
        'pipeline-hygiene',
        'icp-fit-analysis',
        'actions-summary',
      ],
      icon: '📋',
    },
  ];

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Report Templates</h1>
          <p style={{ fontSize: 14, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
            Start with a pre-built template or create from scratch
          </p>
        </div>
        <button
          onClick={onClose}
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
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template.id)}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 24,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.accent;
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>{template.icon}</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>{template.name}</h3>
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16, fontFamily: fonts.sans }}>{template.description}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
              <span style={{ padding: '4px 8px', background: colors.surfaceRaised, borderRadius: 4 }}>{template.cadence}</span>
              <span>{template.sections.length} sections</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 24,
        textAlign: 'center'
      }}>
        <h3 style={{ fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>Start from Scratch</h3>
        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16, fontFamily: fonts.sans }}>
          Build a custom report with your own sections and schedule
        </p>
        <button
          onClick={() => onSelect('blank')}
          style={{
            padding: '8px 16px',
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            borderRadius: 6,
            fontWeight: 500,
            fontFamily: fonts.sans,
            cursor: 'pointer',
          }}
        >
          Create Blank Report
        </button>
      </div>
    </div>
  );
}

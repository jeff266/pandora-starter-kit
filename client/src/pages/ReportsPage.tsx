import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Calendar, Clock, AlertCircle, CheckCircle, Play } from 'lucide-react';

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
      const res = await fetch(`/api/workspaces/${workspaceId}/reports`);
      const data = await res.json();
      setReports(data.reports || []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }

  async function generateNow(reportId: string) {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reports/${reportId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: false }),
      });

      if (res.ok) {
        const generation = await res.json();
        navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${generation.id}`);
      } else {
        alert('Failed to generate report');
      }
    } catch (err) {
      console.error('Failed to generate report:', err);
      alert('Failed to generate report');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading reports...</div>
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
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated reports delivered on your schedule
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplateGallery(true)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Templates
          </button>
          <button
            onClick={() => navigate('/reports/new')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        </div>
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No reports yet</h3>
          <p className="text-slate-500 mb-6">
            Create your first automated report to get started
          </p>
          <button
            onClick={() => setShowTemplateGallery(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            Browse Templates
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
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
    success: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    partial: 'bg-amber-100 text-amber-800',
    running: 'bg-blue-100 text-blue-800',
  };

  const statusIcons = {
    success: <CheckCircle className="w-4 h-4" />,
    failed: <AlertCircle className="w-4 h-4" />,
    partial: <AlertCircle className="w-4 h-4" />,
    running: <Clock className="w-4 h-4" />,
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
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:border-slate-300 transition">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-slate-900">{report.name}</h3>
            {!report.is_active && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded">
                Paused
              </span>
            )}
            {report.last_generation_status && (
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded flex items-center gap-1 ${
                  statusColors[report.last_generation_status as keyof typeof statusColors] ||
                  'bg-slate-100 text-slate-600'
                }`}
              >
                {statusIcons[report.last_generation_status as keyof typeof statusIcons]}
                {report.last_generation_status}
              </span>
            )}
          </div>

          {report.description && (
            <p className="text-sm text-slate-600 mb-4">{report.description}</p>
          )}

          <div className="flex items-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              <span>{cadenceLabels[report.cadence]}</span>
              {report.schedule_time && report.cadence !== 'manual' && (
                <span>at {report.schedule_time}</span>
              )}
            </div>

            {report.last_generated_at && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>
                  Last: {new Date(report.last_generated_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}

            {report.next_due_at && report.is_active && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
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

            <div className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              <span>{report.sections.length} sections</span>
            </div>
          </div>

          {report.last_generation_error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{report.last_generation_error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onView}
            className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
          >
            View
          </button>
          <button
            onClick={onEdit}
            className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
          >
            Edit
          </button>
          <button
            onClick={onGenerate}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
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
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Report Templates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Start with a pre-built template or create from scratch
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template.id)}
            className="bg-white border border-slate-200 rounded-lg p-6 text-left hover:border-blue-500 hover:shadow-md transition"
          >
            <div className="text-4xl mb-3">{template.icon}</div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{template.name}</h3>
            <p className="text-sm text-slate-600 mb-4">{template.description}</p>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="px-2 py-1 bg-slate-100 rounded">{template.cadence}</span>
              <span>{template.sections.length} sections</span>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
        <h3 className="font-semibold text-slate-900 mb-2">Start from Scratch</h3>
        <p className="text-sm text-slate-600 mb-4">
          Build a custom report with your own sections and schedule
        </p>
        <button
          onClick={() => onSelect('blank')}
          className="px-4 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-lg font-medium"
        >
          Create Blank Report
        </button>
      </div>
    </div>
  );
}

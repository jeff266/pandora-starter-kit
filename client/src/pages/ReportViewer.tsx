import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, Share2, Settings, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

interface MetricCard {
  label: string;
  value: string;
  delta?: string;
  delta_direction?: 'up' | 'down' | 'flat';
  severity?: 'good' | 'warning' | 'critical';
}

interface DealCard {
  name: string;
  amount: string;
  owner: string;
  stage: string;
  signal: string;
  signal_severity: 'critical' | 'warning' | 'info';
  detail: string;
  action: string;
}

interface ActionItem {
  owner: string;
  action: string;
  urgency: 'today' | 'this_week' | 'this_month';
  related_deal?: string;
}

interface TableRow {
  [key: string]: string | number | null;
}

interface SectionContent {
  section_id: string;
  title: string;
  narrative: string;
  metrics?: MetricCard[];
  table?: {
    headers: string[];
    rows: TableRow[];
  };
  deal_cards?: DealCard[];
  action_items?: ActionItem[];
  source_skills: string[];
  data_freshness: string;
  confidence: number;
}

interface ReportGeneration {
  id: string;
  report_template_id: string;
  workspace_id: string;
  formats_generated: Record<string, { filepath: string; size_bytes: number; download_url: string }>;
  delivery_status: Record<string, string>;
  sections_snapshot: any[];
  sections_content: SectionContent[];
  skills_run: string[];
  total_tokens: number;
  generation_duration_ms: number;
  render_duration_ms: number;
  triggered_by: 'schedule' | 'manual' | 'api';
  data_as_of: string;
  created_at: string;
}

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  workspace_id: string;
}

interface GenerationSummary {
  id: string;
  created_at: string;
  triggered_by: string;
  generation_duration_ms: number;
}

export default function ReportViewer() {
  const { workspaceId, reportId, generationId } = useParams<{
    workspaceId: string;
    reportId: string;
    generationId?: string;
  }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState<ReportGeneration | null>(null);
  const [template, setTemplate] = useState<ReportTemplate | null>(null);
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [anonymizeMode, setAnonymizeMode] = useState(false);

  useEffect(() => {
    loadReport();
    loadGenerations();
  }, [workspaceId, reportId, generationId]);

  async function loadReport() {
    try {
      setLoading(true);
      const endpoint = generationId
        ? `/api/workspaces/${workspaceId}/reports/${reportId}/generations/${generationId}`
        : `/api/workspaces/${workspaceId}/reports/${reportId}/generations/latest`;

      const genRes = await fetch(endpoint);
      const genData = await genRes.json();
      setGeneration(genData);

      const templateRes = await fetch(`/api/workspaces/${workspaceId}/reports/${reportId}`);
      const templateData = await templateRes.json();
      setTemplate(templateData);
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadGenerations() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reports/${reportId}/generations?limit=20`);
      const data = await res.json();
      setGenerations(data.generations || []);
    } catch (err) {
      console.error('Failed to load generations:', err);
    }
  }

  function toggleSection(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      // Persist to localStorage
      localStorage.setItem('collapsed-sections', JSON.stringify(Array.from(next)));
      return next;
    });
  }

  async function downloadFormat(format: string) {
    if (!generation) return;
    const fileInfo = generation.formats_generated[format];
    if (fileInfo?.download_url) {
      window.location.href = fileInfo.download_url;
    }
  }

  async function shareReport() {
    if (!generation) return;
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/reports/${reportId}/generations/${generation.id}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access: 'public',
            expires_in: '7d',
            include_download: true,
          }),
        }
      );
      const data = await res.json();
      // Copy link to clipboard
      await navigator.clipboard.writeText(data.share_url);
      alert(`Share link copied to clipboard!\n${data.share_url}\nExpires in 7 days`);
    } catch (err) {
      console.error('Failed to create share link:', err);
      alert('Failed to create share link');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading report...</div>
      </div>
    );
  }

  if (!generation || !template) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Report not found</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Timeline Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-sm text-slate-700">Timeline</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {generations.map((gen) => {
            const isActive = gen.id === generation.id;
            const date = new Date(gen.created_at);
            return (
              <button
                key={gen.id}
                onClick={() => navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${gen.id}`)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-900 font-semibold border border-blue-200'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isActive ? 'bg-blue-500' : 'bg-slate-300'
                    }`}
                  />
                  <span>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <div className="text-xs text-slate-500 ml-4 mt-0.5">
                  {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-200">
          <button className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700">
            Compare
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{template.name}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                <span>
                  Generated {new Date(generation.created_at).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span>•</span>
                <span>{generation.generation_duration_ms}ms</span>
                <span>•</span>
                <span>{generation.skills_run?.length || 0} skills</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAnonymizeMode(!anonymizeMode)}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  anonymizeMode
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Eye className="w-4 h-4" />
                {anonymizeMode ? 'Anonymized' : 'Anonymize'}
              </button>
              {Object.keys(generation.formats_generated).map((format) => (
                <button
                  key={format}
                  onClick={() => downloadFormat(format)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {format.toUpperCase()}
                </button>
              ))}
              <button
                onClick={shareReport}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
              <Link
                to={`/workspace/${workspaceId}/reports/${reportId}/edit`}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Edit Report
              </Link>
            </div>
          </div>
        </div>

        {/* Report Sections */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {generation.sections_content?.map((section) => (
              <ReportSection
                key={section.section_id}
                section={section}
                isCollapsed={collapsedSections.has(section.section_id)}
                onToggle={() => toggleSection(section.section_id)}
                anonymizeMode={anonymizeMode}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span>
              Skills: {generation.skills_run?.join(', ') || 'none'} • {generation.total_tokens} tokens
            </span>
            <span>
              Data as of {new Date(generation.data_as_of).toLocaleString('en-US')} • Powered by Pandora
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReportSectionProps {
  section: SectionContent;
  isCollapsed: boolean;
  onToggle: () => void;
  anonymizeMode: boolean;
}

function ReportSection({ section, isCollapsed, onToggle, anonymizeMode }: ReportSectionProps) {
  return (
    <div id={section.section_id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {/* Section Header */}
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition"
      >
        <h2 className="text-xl font-bold text-slate-900">{section.title}</h2>
        {isCollapsed ? (
          <ChevronRight className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronLeft className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {/* Section Content */}
      {!isCollapsed && (
        <div className="px-6 pb-6 space-y-6">
          {/* Metrics */}
          {section.metrics && section.metrics.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {section.metrics.map((metric, idx) => (
                <MetricCardComponent key={idx} metric={metric} />
              ))}
            </div>
          )}

          {/* Narrative */}
          {section.narrative && (
            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed">
              {section.narrative.split('\n\n').map((para, idx) => (
                <p key={idx}>{para}</p>
              ))}
            </div>
          )}

          {/* Deal Cards */}
          {section.deal_cards && section.deal_cards.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Deals</h3>
              {section.deal_cards.map((deal, idx) => (
                <DealCardComponent key={idx} deal={deal} anonymizeMode={anonymizeMode} />
              ))}
            </div>
          )}

          {/* Table */}
          {section.table && section.table.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    {section.table.headers.map((header, idx) => (
                      <th key={idx} className="px-4 py-2 text-left font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {section.table.rows.slice(0, 20).map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      {section.table!.headers.map((header, cellIdx) => (
                        <td key={cellIdx} className="px-4 py-2 text-slate-700">
                          {row[header]?.toString() || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action Items */}
          {section.action_items && section.action_items.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Action Items</h3>
              {section.action_items.map((action, idx) => (
                <ActionItemComponent key={idx} action={action} index={idx} />
              ))}
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-slate-500 pt-4 border-t border-slate-100">
            Data as of {new Date(section.data_freshness).toLocaleString('en-US')} • Confidence:{' '}
            {Math.round(section.confidence * 100)}%
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCardComponent({ metric }: { metric: MetricCard }) {
  const severityColors = {
    critical: 'border-red-200 bg-red-50',
    warning: 'border-amber-200 bg-amber-50',
    good: 'border-green-200 bg-green-50',
  };

  const severityAccents = {
    critical: 'border-l-red-500',
    warning: 'border-l-amber-500',
    good: 'border-l-green-500',
  };

  const bgClass = metric.severity ? severityColors[metric.severity] : 'border-slate-200 bg-slate-50';
  const accentClass = metric.severity ? severityAccents[metric.severity] : 'border-l-slate-400';

  return (
    <div className={`border ${bgClass} ${accentClass} border-l-4 rounded-lg p-4`}>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{metric.label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{metric.value}</span>
        {metric.delta && (
          <span className="text-sm text-slate-600">
            {metric.delta_direction === 'up' ? '▲' : metric.delta_direction === 'down' ? '▼' : '—'} {metric.delta}
          </span>
        )}
      </div>
    </div>
  );
}

function DealCardComponent({ deal, anonymizeMode }: { deal: DealCard; anonymizeMode: boolean }) {
  const severityColors = {
    critical: 'border-red-500 bg-red-50',
    warning: 'border-amber-500 bg-amber-50',
    info: 'border-blue-500 bg-blue-50',
  };

  const displayName = anonymizeMode ? `Company ${deal.name.charAt(0)}` : deal.name;
  const displayOwner = anonymizeMode ? `Rep ${deal.owner.charAt(0)}` : deal.owner;

  return (
    <div className={`border-l-4 ${severityColors[deal.signal_severity]} bg-white rounded-lg p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold text-slate-900">{displayName}</h4>
          <div className="text-sm text-slate-600 mt-1">
            {displayOwner} • {deal.stage} • {deal.signal}
          </div>
        </div>
        <div className="text-lg font-bold text-slate-900">{deal.amount}</div>
      </div>
      {deal.action && (
        <div className="mt-3 text-sm text-blue-700 font-medium">→ {deal.action}</div>
      )}
    </div>
  );
}

function ActionItemComponent({ action, index }: { action: ActionItem; index: number }) {
  const urgencyColors = {
    today: 'text-red-600',
    this_week: 'text-amber-600',
    this_month: 'text-green-600',
  };

  const urgencyLabels = {
    today: 'TODAY',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
      <input type="checkbox" className="mt-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${urgencyColors[action.urgency]}`}>
            {urgencyLabels[action.urgency]}
          </span>
          <span className="text-sm text-slate-900">{action.action}</span>
        </div>
        {action.owner && (
          <div className="text-xs text-slate-500 mt-1">Owned by: {action.owner}</div>
        )}
      </div>
    </div>
  );
}

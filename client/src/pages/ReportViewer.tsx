import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, Share2, Settings, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import type { SectionContent, MetricCard, DealCard, ActionItem } from '../components/reports/types';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

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
        ? `/reports/${reportId}/generations/${generationId}`
        : `/reports/${reportId}/generations/latest`;

      const genData = await api.get(endpoint);
      setGeneration(genData);

      const templateData = await api.get(`/reports/${reportId}`);
      setTemplate(templateData);
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadGenerations() {
    try {
      const data = await api.get(`/reports/${reportId}/generations?limit=20`);
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
    if (!fileInfo?.download_url) return;

    try {
      // Use authenticated fetch to download the file
      const token = localStorage.getItem('pandora_token');
      const response = await fetch(fileInfo.download_url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      // Convert response to blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template?.name || 'report'}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
      alert(`Failed to download ${format.toUpperCase()} file`);
    }
  }

  async function shareReport() {
    if (!generation) return;
    try {
      const data = await api.post(
        `/reports/${reportId}/generations/${generation.id}/share`,
        {
          access: 'public',
          expires_in: '7d',
          include_download: true,
        }
      );
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: colors.bg }}>
        <div style={{ color: colors.textMuted, fontFamily: fonts.sans }}>Loading report...</div>
      </div>
    );
  }

  if (!generation || !template) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: colors.bg }}>
        <div style={{ color: colors.textMuted, fontFamily: fonts.sans }}>Report not found</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      {/* Timeline Sidebar */}
      <div style={{ width: 256, background: colors.surface, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${colors.border}` }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Timeline</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {generations.map((gen) => {
            const isActive = gen.id === generation.id;
            const date = new Date(gen.created_at);
            return (
              <button
                key={gen.id}
                onClick={() => navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${gen.id}`)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 14,
                  transition: 'background 0.2s, border-color 0.2s',
                  background: isActive ? colors.surfaceRaised : 'transparent',
                  color: isActive ? colors.text : colors.textSecondary,
                  fontWeight: isActive ? 600 : 400,
                  border: isActive ? `1px solid ${colors.accent}` : '1px solid transparent',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = colors.surfaceRaised;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isActive ? colors.accent : colors.border,
                    }}
                  />
                  <span>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 16, marginTop: 2 }}>
                  {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${colors.border}` }}>
          <button
            style={{
              width: '100%',
              padding: '8px 12px',
              background: colors.surfaceRaised,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              color: colors.text,
              border: 'none',
              cursor: 'pointer',
              fontFamily: fonts.sans,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
          >
            Compare
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header Bar */}
        <div style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}`, padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{template.name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setAnonymizeMode(!anonymizeMode)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: anonymizeMode ? '#fef3c7' : colors.surfaceRaised,
                  color: anonymizeMode ? '#78350f' : colors.text,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
                onMouseEnter={(e) => {
                  if (!anonymizeMode) e.currentTarget.style.background = colors.border;
                }}
                onMouseLeave={(e) => {
                  if (!anonymizeMode) e.currentTarget.style.background = colors.surfaceRaised;
                }}
              >
                <Eye style={{ width: 16, height: 16 }} />
                {anonymizeMode ? 'Anonymized' : 'Anonymize'}
              </button>
              {Object.keys(generation.formats_generated).map((format) => (
                <button
                  key={format}
                  onClick={() => downloadFormat(format)}
                  style={{
                    padding: '8px 12px',
                    background: colors.surfaceRaised,
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: colors.text,
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontFamily: fonts.sans,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = colors.border)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
                >
                  <Download style={{ width: 16, height: 16 }} />
                  {format.toUpperCase()}
                </button>
              ))}
              <button
                onClick={shareReport}
                style={{
                  padding: '8px 12px',
                  background: colors.accent,
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#fff',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                <Share2 style={{ width: 16, height: 16 }} />
                Share
              </button>
              <Link
                to={`/workspace/${workspaceId}/reports/${reportId}/edit`}
                style={{
                  padding: '8px 12px',
                  background: colors.surfaceRaised,
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  color: colors.text,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = colors.border)}
                onMouseLeave={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
              >
                <Settings style={{ width: 16, height: 16 }} />
                Edit Report
              </Link>
            </div>
          </div>
        </div>

        {/* Report Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1024, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {generation.sections_content?.map((section) => {
              const isCollapsed = collapsedSections.has(section.section_id);
              return (
                <ReportSection
                  key={section.section_id}
                  section={section}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleSection(section.section_id)}
                  anonymizeMode={anonymizeMode}
                />
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: colors.surface, borderTop: `1px solid ${colors.border}`, padding: '12px 24px', fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
    <div id={section.section_id} style={{ background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
      {/* Section Header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.2s',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{section.title}</h2>
        {isCollapsed ? (
          <ChevronRight style={{ width: 20, height: 20, color: colors.textMuted }} />
        ) : (
          <ChevronLeft style={{ width: 20, height: 20, color: colors.textMuted }} />
        )}
      </button>

      {/* Section Content */}
      {!isCollapsed && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Metrics */}
          {section.metrics && section.metrics.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {section.metrics.map((metric, idx) => (
                <MetricCardComponent key={idx} metric={metric} />
              ))}
            </div>
          )}

          {/* Narrative */}
          {section.narrative && (
            <div style={{ maxWidth: 'none', color: colors.textSecondary, lineHeight: 1.6, fontFamily: fonts.sans }}>
              {section.narrative.split('\n\n').map((para, idx) => (
                <p key={idx} style={{ marginBottom: 16 }}>{para}</p>
              ))}
            </div>
          )}

          {/* Deal Cards */}
          {section.deal_cards && section.deal_cards.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.sans, margin: 0 }}>Deals</h3>
              {section.deal_cards.map((deal, idx) => (
                <DealCardComponent key={idx} deal={deal} anonymizeMode={anonymizeMode} />
              ))}
            </div>
          )}

          {/* Table */}
          {section.table && section.table.rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 14 }}>
                <thead style={{ background: colors.surfaceRaised, color: colors.text }}>
                  <tr>
                    {section.table.headers.map((header, idx) => (
                      <th key={idx} style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 600, fontFamily: fonts.sans }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ borderTop: `1px solid ${colors.border}` }}>
                  {section.table.rows.slice(0, 20).map((row, idx) => (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? colors.surface : colors.surfaceRaised, borderBottom: `1px solid ${colors.border}` }}>
                      {section.table!.headers.map((header, cellIdx) => (
                        <td key={cellIdx} style={{ padding: '8px 16px', color: colors.textSecondary, fontFamily: fonts.sans }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.sans, margin: 0 }}>Action Items</h3>
              {section.action_items.map((action, idx) => (
                <ActionItemComponent key={idx} action={action} index={idx} />
              ))}
            </div>
          )}

          {/* Metadata */}
          <div style={{ fontSize: 12, color: colors.textMuted, paddingTop: 16, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans }}>
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
    critical: { bg: '#7f1d1d', border: '#991b1b', accent: '#dc2626' },
    warning: { bg: '#78350f', border: '#92400e', accent: '#f59e0b' },
    good: { bg: '#14532d', border: '#166534', accent: '#22c55e' },
  };

  const defaultColors = { bg: colors.surfaceRaised, border: colors.border, accent: colors.border };
  const colorScheme = metric.severity ? severityColors[metric.severity] : defaultColors;

  return (
    <div style={{
      border: `1px solid ${colorScheme.border}`,
      background: colorScheme.bg,
      borderLeft: `4px solid ${colorScheme.accent}`,
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textSecondary, fontWeight: 600, fontFamily: fonts.sans }}>{metric.label}</div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>{metric.value}</span>
        {metric.delta && (
          <span style={{ fontSize: 14, color: colors.textSecondary, fontFamily: fonts.sans }}>
            {metric.delta_direction === 'up' ? '▲' : metric.delta_direction === 'down' ? '▼' : '—'} {metric.delta}
          </span>
        )}
      </div>
    </div>
  );
}

function DealCardComponent({ deal, anonymizeMode }: { deal: DealCard; anonymizeMode: boolean }) {
  const severityColors = {
    critical: { border: '#dc2626', bg: '#7f1d1d' },
    warning: { border: '#f59e0b', bg: '#78350f' },
    info: { border: '#3b82f6', bg: '#1e3a8a' },
  };

  const colorScheme = severityColors[deal.signal_severity];
  const displayName = anonymizeMode ? `Company ${deal.name.charAt(0)}` : deal.name;
  const displayOwner = anonymizeMode ? `Rep ${deal.owner.charAt(0)}` : deal.owner;

  return (
    <div style={{
      borderLeft: `4px solid ${colorScheme.border}`,
      background: colorScheme.bg,
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{displayName}</h4>
          <div style={{ fontSize: 14, color: colors.textSecondary, marginTop: 4, fontFamily: fonts.sans }}>
            {displayOwner} • {deal.stage} • {deal.signal}
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>{deal.amount}</div>
      </div>
      {deal.action && (
        <div style={{ marginTop: 12, fontSize: 14, color: colors.accent, fontWeight: 500, fontFamily: fonts.sans }}>→ {deal.action}</div>
      )}
    </div>
  );
}

function ActionItemComponent({ action, index }: { action: ActionItem; index: number }) {
  const urgencyColors = {
    today: '#dc2626',
    this_week: '#f59e0b',
    this_month: '#22c55e',
  };

  const urgencyLabels = {
    today: 'TODAY',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: colors.surfaceRaised, borderRadius: 8 }}>
      <input type="checkbox" style={{ marginTop: 4 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: urgencyColors[action.urgency], fontFamily: fonts.sans }}>
            {urgencyLabels[action.urgency]}
          </span>
          <span style={{ fontSize: 14, color: colors.text, fontFamily: fonts.sans }}>{action.action}</span>
        </div>
        {action.owner && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>Owned by: {action.owner}</div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, Share2, Settings, ChevronLeft, ChevronRight, Eye, Edit3, X } from 'lucide-react';
import type { SectionContent, MetricCard, DealCard, ActionItem, SankeyChartData } from '../components/reports/types';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { renderMarkdown } from '../lib/render-markdown';
import SectionFeedback from '../components/reports/SectionFeedback';
import OverallBriefingFeedback from '../components/reports/OverallBriefingFeedback';
import SankeyChart from '../components/reports/SankeyChart';
import ReportAnnotationEditor, { type Annotation } from '../components/reports/ReportAnnotationEditor';
import ReportContextMenu, { type ReportContextTarget } from '../components/reports/ReportContextMenu';
import { openAskPandora } from '../lib/askPandora';
import { usePermissions } from '../hooks/usePermissions';
import { useWorkspace } from '../context/WorkspaceContext';

interface ReportGeneration {
  id: string;
  report_template_id?: string;
  workspace_id: string;
  agent_id?: string;
  agent_name?: string;
  opening_narrative?: string;
  editorial_decisions?: any;
  run_digest?: any;
  formats_generated?: Record<string, { filepath: string; size_bytes: number; download_url: string }>;
  delivery_status?: Record<string, string>;
  sections_snapshot?: any[];
  sections_content?: SectionContent[];
  skills_run?: string[];
  total_tokens?: number;
  generation_duration_ms?: number;
  render_duration_ms?: number;
  triggered_by?: 'schedule' | 'manual' | 'api';
  data_as_of?: string;
  created_at: string;
  version?: number;
  parent_generation_id?: string;
  human_annotations?: Annotation[];
  annotated_by?: string;
  annotated_at?: string;
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

interface ReportDocSection {
  id: string;
  title: string;
  content: string;
  word_count: number;
  source_skills: string[];
  severity?: 'critical' | 'warning' | 'info';
}

interface ReportDocAction {
  urgency: 'today' | 'this_week' | 'this_month';
  text: string;
  deal_name?: string;
  rep_name?: string;
}

interface ReportDocumentData {
  id: string;
  document_type: string;
  week_label: string;
  headline: string;
  sections: ReportDocSection[];
  actions: ReportDocAction[];
  recommended_next_steps: string;
  skills_included: string[];
  tokens_used: number;
  generated_at: string;
}

interface DocListEntry {
  id: string;
  generated_at: string;
  week_label: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  monday_briefing: 'Monday Briefing',
  weekly_business_review: 'Weekly Business Review',
  qbr: 'Quarterly Business Review',
  board_deck: 'Board Deck',
};

export default function ReportViewer() {
  const { workspaceId, reportId, generationId } = useParams<{
    workspaceId: string;
    reportId?: string;
    generationId?: string;
  }>();
  const navigate = useNavigate();

  const isDirectBriefing = !reportId && !!generationId;

  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState<ReportGeneration | null>(null);
  const [template, setTemplate] = useState<ReportTemplate | null>(null);
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [reportDocument, setReportDocument] = useState<ReportDocumentData | null>(null);
  const [docList, setDocList] = useState<DocListEntry[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [anonymizeMode, setAnonymizeMode] = useState(false);
  const [feedbackSummary, setFeedbackSummary] = useState<any>(null);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ReportContextTarget } | null>(null);
  const { canAnnotateReports } = usePermissions();
  const { currentWorkspace } = useWorkspace();

  useEffect(() => {
    if (isDirectBriefing) {
      loadDirectGeneration();
    } else {
      loadReport();
      loadGenerations();
    }
  }, [workspaceId, reportId, generationId]);

  async function loadDirectGeneration() {
    try {
      setLoading(true);
      const doc = await api.get(`/reports/${generationId}`);
      setReportDocument(doc);
      loadDocumentList();
    } catch (err) {
      console.error('Failed to load report document:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDocumentList() {
    try {
      const data = await api.get('/reports?limit=20');
      setDocList(data.reports || []);
    } catch (err) {
      console.error('Failed to load document list:', err);
    }
  }

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

      if (genData.agent_id) {
        loadFeedbackSummary(genData.id, genData.agent_id);
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFeedbackSummary(generationId: string, agentId: string) {
    try {
      const data = await api.get(`/agents/${agentId}/feedback-summary?generation_id=${generationId}`);
      setFeedbackSummary(data);
    } catch (err) {
      console.error('Failed to load feedback summary:', err);
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
    const fileInfo = generation.formats_generated?.[format];
    if (!fileInfo?.download_url) {
      console.error('No download URL found for format:', format);
      alert(`No download URL available for ${format.toUpperCase()}`);
      return;
    }

    try {
      // Use authenticated fetch to download the file
      const token = localStorage.getItem('pandora_session');
      console.log('Downloading:', fileInfo.download_url);

      const response = await fetch(fileInfo.download_url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('Download response:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Download error response:', errorText);
        throw new Error(`Download failed (${response.status}): ${errorText}`);
      }

      // Convert response to blob and trigger download
      const blob = await response.blob();
      console.log('Downloaded blob size:', blob.size, 'type:', blob.type);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template?.name || 'report'}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('Download complete');
    } catch (err) {
      console.error('Download failed:', err);
      alert(`Failed to download ${format.toUpperCase()} file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, target: ReportContextTarget) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const handleAskPandora = useCallback((target: ReportContextTarget) => {
    openAskPandora({
      source: 'report_block',
      label: target.label,
      value: target.value || '',
      section: target.sectionTitle,
      evidenceRows: target.evidence?.slice(0, 10).map((e: Record<string, any>) => ({
        label: String(e.label ?? e.type ?? 'Finding'),
        value: e.value ?? '',
        meta: e.meta ?? e.deal_name ?? undefined,
      })),
    }, navigate, '/');
  }, [navigate]);

  const handleSaveV2 = useCallback(async (annotations: Annotation[], mergedSections: SectionContent[]) => {
    if (!generation) return;
    const reportPath = reportId
      ? `/reports/${reportId}/generations`
      : `/reports/${generation.report_template_id || 'direct'}/generations`;
    const data = await api.post(reportPath, {
      parent_generation_id: generation.id,
      human_annotations: annotations,
      sections_content: mergedSections,
      annotated_by: currentWorkspace?.id,
    });
    setSaveSuccess(true);
    setAnnotateMode(false);
    setTimeout(() => setSaveSuccess(false), 4000);
    loadGenerations();
    if (data.generation?.id) {
      navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${data.generation.id}`);
    }
  }, [generation, reportId, workspaceId, currentWorkspace]);

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

  if (!generation && !reportDocument) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: colors.bg }}>
        <div style={{ color: colors.textMuted, fontFamily: fonts.sans }}>Report not found</div>
      </div>
    );
  }

  const displayName = reportDocument
    ? (DOC_TYPE_LABELS[reportDocument.document_type] || reportDocument.document_type)
    : (template?.name || generation?.agent_name || 'Agent Briefing');
  const sections = generation?.sections_content || generation?.sections_snapshot || [];
  const isV2 = (generation?.version || 1) > 1;
  const annotations = generation?.human_annotations || [];

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      {/* Context Menu */}
      {contextMenu && (
        <ReportContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          onAskPandora={handleAskPandora}
          onCopy={(val) => { navigator.clipboard.writeText(val).catch(() => {}); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Timeline Sidebar */}
      <div style={{ width: 256, background: colors.surface, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${colors.border}` }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Timeline</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isDirectBriefing && docList.length > 0 ? (
            docList.map((doc) => {
              const isActive = doc.id === generationId;
              const date = new Date(doc.generated_at);
              return (
                <button
                  key={doc.id}
                  onClick={() => navigate(`/workspace/${workspaceId}/briefing/${doc.id}`)}
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
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? colors.accent : colors.border }} />
                    <span style={{ fontSize: 13 }}>{doc.week_label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 16, marginTop: 2 }}>
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </div>
                </button>
              );
            })
          ) : (
            generations.map((gen: any) => {
              const isActive = gen.id === generation?.id;
              const date = new Date(gen.created_at);
              const genVersion = gen.version || 1;
              const isEdited = genVersion > 1;
              return (
                <button
                  key={gen.id}
                  onClick={() => {
                    if (isDirectBriefing) {
                      navigate(`/workspace/${workspaceId}/briefing/${gen.id}`);
                    } else {
                      navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${gen.id}`);
                    }
                  }}
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
                    {isEdited && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 5px',
                        background: colors.accentSoft, color: colors.accent,
                        borderRadius: 4, letterSpacing: '0.04em',
                      }}>V{genVersion}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 16, marginTop: 2 }}>
                    {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {isEdited && <span style={{ marginLeft: 4 }}>✎</span>}
                  </div>
                </button>
              );
            })
          )}
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
        {/* Edit Mode Banner */}
        {annotateMode && (
          <div style={{
            background: colors.accent,
            color: '#fff',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', fontFamily: fonts.sans }}>
              ✎  ANNOTATION MODE — Strike items, override metrics, add notes. Save as V2 when done.
            </span>
            <button
              onClick={() => setAnnotateMode(false)}
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >Exit</button>
          </div>
        )}

        {/* Save success toast */}
        {saveSuccess && (
          <div style={{
            background: '#065f46', color: '#d1fae5',
            padding: '10px 24px', fontSize: 13, fontWeight: 500, fontFamily: fonts.sans, flexShrink: 0,
          }}>
            ✓ V{(generation?.version || 1) + 1} saved — annotations recorded and feedback signals captured
          </div>
        )}

        {/* Header Bar */}
        <div style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}`, padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{displayName}</h1>
                {isV2 && generation && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    background: colors.accentSoft, color: colors.accent,
                    borderRadius: 20, letterSpacing: '0.04em', fontFamily: fonts.sans,
                  }}>
                    V{generation.version} · Edited {generation.annotated_at ? new Date(generation.annotated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
                {reportDocument ? (
                  <>
                    <span>
                      Generated {new Date(reportDocument.generated_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span>•</span>
                    <span>{reportDocument.skills_included.length} skill{reportDocument.skills_included.length !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <span>
                      Generated {new Date(generation!.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>•</span>
                    <span>{generation!.generation_duration_ms ?? '—'}ms</span>
                    <span>•</span>
                    <span>{(generation!.skills_run?.length ?? 0)} skill{(generation!.skills_run?.length ?? 0) !== 1 ? 's' : ''}</span>
                    {isV2 && generation!.parent_generation_id && (
                      <>
                        <span>•</span>
                        <button
                          onClick={() => {
                            if (isDirectBriefing) navigate(`/workspace/${workspaceId}/briefing/${generation!.parent_generation_id}`);
                            else navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${generation!.parent_generation_id}`);
                          }}
                          style={{ background: 'none', border: 'none', color: colors.accent, fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: fonts.sans }}
                        >View original (V1) →</button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {canAnnotateReports && !annotateMode && !reportDocument && (
                <button
                  onClick={() => setAnnotateMode(true)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: colors.accentSoft,
                    color: colors.accent,
                    border: `1px solid ${colors.accent}44`,
                    cursor: 'pointer',
                    fontFamily: fonts.sans,
                  }}
                >
                  <Edit3 style={{ width: 15, height: 15 }} />
                  Annotate
                </button>
              )}
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
              {isV2 && workspaceId && reportId && (
                <>
                  {['pdf', 'docx'].map(format => (
                    <button
                      key={`annotated-${format}`}
                      onClick={() => {
                        const url = `/api/${workspaceId}/reports/${reportId}/generations/${generation?.id}/export/${format}`;
                        window.open(url, '_blank');
                      }}
                      style={{
                        padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: colors.accentSoft, color: colors.accent,
                        border: `1px solid ${colors.accent}44`, cursor: 'pointer', fontFamily: fonts.sans,
                      }}
                    >
                      <Download style={{ width: 14, height: 14 }} />
                      {format.toUpperCase()} (V2)
                    </button>
                  ))}
                </>
              )}
              {!reportDocument && Object.keys(generation?.formats_generated || {}).map((format) => (
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
              {!reportDocument && (
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
              )}
              {reportId && (
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
              )}
            </div>
          </div>
        </div>

        {/* Report Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1024, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

            {reportDocument ? (
              /* ── New path: ReportDocument from orchestrator ── */
              <>
                {/* Headline */}
                <div style={{
                  background: colors.surface,
                  borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  padding: 24,
                }}>
                  <p style={{
                    fontSize: 16,
                    lineHeight: 1.6,
                    color: colors.text,
                    fontFamily: fonts.sans,
                    margin: 0,
                    fontWeight: 500,
                  }}>
                    {reportDocument.headline}
                  </p>
                </div>

                {/* Sections */}
                {reportDocument.sections.map((section) => {
                  const isCollapsed = collapsedSections.has(section.id);
                  return (
                    <div key={section.id} style={{ background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                      <button
                        onClick={() => toggleSection(section.id)}
                        style={{
                          width: '100%',
                          padding: '16px 24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{section.title}</h2>
                        {isCollapsed
                          ? <ChevronRight style={{ width: 20, height: 20, color: colors.textMuted }} />
                          : <ChevronLeft style={{ width: 20, height: 20, color: colors.textMuted }} />
                        }
                      </button>
                      {!isCollapsed && (
                        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                          <div style={{ color: colors.textSecondary, lineHeight: 1.7, fontFamily: fonts.sans, fontSize: 14 }}>
                            {section.content.split('\n\n').map((para, i) => (
                              <p key={i} style={{ marginBottom: 12 }}>{renderMarkdown(para)}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Actions */}
                {reportDocument.actions.length > 0 && (
                  <div style={{ background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`, padding: 24 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: '0 0 16px' }}>Actions</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {reportDocument.actions.map((action, idx) => (
                        <ActionItemComponent
                          key={idx}
                          action={{
                            urgency: action.urgency,
                            action: action.text,
                            owner: [action.deal_name, action.rep_name].filter(Boolean).join(' · ') || '',
                            related_deal: action.deal_name,
                          }}
                          index={idx}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Next Steps */}
                {reportDocument.recommended_next_steps && (
                  <div style={{ background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`, padding: 24 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: '0 0 12px' }}>Recommended Next Steps</h2>
                    <p style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.7, fontFamily: fonts.sans, margin: 0 }}>
                      {reportDocument.recommended_next_steps}
                    </p>
                  </div>
                )}
              </>
            ) : annotateMode && sections && sections.length > 0 ? (
              /* ── Legacy annotate mode ── */
              <ReportAnnotationEditor
                generationId={generation!.id}
                sectionsContent={sections as any}
                existingAnnotations={annotations}
                userId={currentWorkspace?.id || 'unknown'}
                onSave={handleSaveV2}
                onCancel={() => setAnnotateMode(false)}
              />
            ) : (
              /* ── Legacy render path ── */
              <>
                {/* Opening Narrative (for editorial briefings) */}
                {generation?.opening_narrative && (
                  <div style={{
                    background: colors.surface,
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    padding: 24,
                  }}>
                    <p style={{
                      fontSize: 16,
                      lineHeight: 1.6,
                      color: colors.text,
                      fontFamily: fonts.sans,
                      margin: 0,
                    }}>
                      {renderMarkdown(generation.opening_narrative)}
                    </p>
                  </div>
                )}

                {sections?.map((section: any, idx: number) => {
                  const sectionId = section.section_id || `section-${idx}`;
                  const isCollapsed = collapsedSections.has(sectionId);
                  return (
                    <ReportSection
                      key={sectionId}
                      section={{ ...section, section_id: sectionId }}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleSection(sectionId)}
                      anonymizeMode={anonymizeMode}
                      workspaceId={workspaceId}
                      agentId={generation?.agent_id}
                      generationId={generation?.id}
                      existingSignal={feedbackSummary?.sections?.[section.section_id]?.signals?.[0] || null}
                      onContextMenu={handleContextMenu}
                      humanAnnotations={annotations}
                    />
                  );
                })}

                {/* Overall Briefing Feedback (only for agent-generated briefings) */}
                {generation?.agent_id && workspaceId && (
                  <OverallBriefingFeedback
                    workspaceId={workspaceId}
                    agentId={generation.agent_id}
                    generationId={generation.id}
                    existingRating={feedbackSummary?.overall?.rating || null}
                    existingSignal={feedbackSummary?.overall?.signals?.[0] || null}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: colors.surface, borderTop: `1px solid ${colors.border}`, padding: '12px 24px', fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {reportDocument ? (
              <span>
                Skills: {reportDocument.skills_included.join(', ') || 'none'} • {reportDocument.tokens_used ?? 0} tokens
              </span>
            ) : (
              <span>
                Skills: {generation?.skills_run?.join(', ') || 'none'} • {generation?.total_tokens ?? 0} tokens
              </span>
            )}
            <span>
              {generation?.data_as_of ? `Data as of ${new Date(generation.data_as_of).toLocaleString('en-US')} • ` : ''}Powered by Pandora
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
  workspaceId?: string;
  agentId?: string;
  generationId?: string;
  existingSignal?: string | null;
  onContextMenu?: (e: React.MouseEvent, target: import('../components/reports/ReportContextMenu').ReportContextTarget) => void;
  humanAnnotations?: import('../components/reports/ReportAnnotationEditor').Annotation[];
}

function ReportSection({ section, isCollapsed, onToggle, anonymizeMode, workspaceId, agentId, generationId, existingSignal, onContextMenu, humanAnnotations }: ReportSectionProps) {
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
              {section.metrics.map((metric, idx) => {
                const blockId = `${section.section_id}:metric:${idx}`;
                const annotation = humanAnnotations?.find(a => a.block_id === blockId);
                return (
                  <div
                    key={idx}
                    onContextMenu={onContextMenu ? (e) => onContextMenu(e, {
                      type: 'metric',
                      label: metric.label,
                      value: annotation?.new_value || metric.value,
                      sectionTitle: section.title,
                      blockId,
                    }) : undefined}
                  >
                    <MetricCardComponent
                      metric={metric}
                      annotationOverride={annotation?.new_value ?? undefined}
                      annotationOriginal={annotation?.type === 'override' ? annotation.original_value : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Sankey Pipeline Funnel Chart */}
          {(section as any).chart_data?.type === 'sankey' && (
            <SankeyChart
              data={(section as any).chart_data as SankeyChartData}
              workspaceId={workspaceId}
            />
          )}

          {/* Narrative */}
          {section.narrative && (
            <div
              style={{ maxWidth: 'none', color: colors.textSecondary, lineHeight: 1.6, fontFamily: fonts.sans }}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, {
                type: 'narrative',
                label: 'Narrative',
                value: section.narrative || '',
                sectionTitle: section.title,
                blockId: `${section.section_id}:narrative`,
              }) : undefined}
            >
              {(() => {
                const narrativeAnnotation = humanAnnotations?.find(a => a.block_id === `${section.section_id}:narrative`);
                const displayText = narrativeAnnotation?.new_value || section.narrative;
                return (
                  <>
                    {narrativeAnnotation && (
                      <div style={{ fontSize: 11, color: '#00BFA5', marginBottom: 6, fontWeight: 500, borderLeft: '2px solid #00BFA5', paddingLeft: 8 }}>
                        ✎ Narrative edited
                      </div>
                    )}
                    {displayText.split('\n\n').map((para, idx) => (
                      <p key={idx} style={{ marginBottom: 16 }}>{renderMarkdown(para)}</p>
                    ))}
                  </>
                );
              })()}
            </div>
          )}

          {/* Deal Cards */}
          {section.deal_cards && section.deal_cards.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.sans, margin: 0 }}>Deals</h3>
              {section.deal_cards.map((deal, idx) => (
                <div
                  key={idx}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(e, {
                    type: 'deal_card',
                    label: deal.name,
                    value: deal.amount || '',
                    sectionTitle: section.title,
                    blockId: `${section.section_id}:deal:${idx}`,
                  }) : undefined}
                >
                  <DealCardComponent deal={deal} anonymizeMode={anonymizeMode} />
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          {section.table && section.table.rows?.length > 0 && (
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
                  {section.table.rows.slice(0, 20).map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      style={{ background: rowIdx % 2 === 0 ? colors.surface : colors.surfaceRaised, borderBottom: `1px solid ${colors.border}` }}
                      onContextMenu={onContextMenu ? (e) => onContextMenu(e, {
                        type: 'table_row',
                        label: section.table!.headers[0] ? String(row[section.table!.headers[0]] || '') : 'Row',
                        value: Object.values(row).slice(0, 3).join(' · '),
                        sectionTitle: section.title,
                        blockId: `${section.section_id}:table:${rowIdx}`,
                      }) : undefined}
                    >
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
              {section.action_items.map((action, idx) => {
                const blockId = `${section.section_id}:action:${idx}`;
                const isStruck = humanAnnotations?.some(a => a.block_id === blockId && a.type === 'strike');
                const noteAnnotation = humanAnnotations?.find(a => a.block_id === `${blockId}:note`);
                return (
                  <div
                    key={idx}
                    onContextMenu={onContextMenu ? (e) => onContextMenu(e, {
                      type: 'action_item',
                      label: action.action,
                      value: action.urgency || '',
                      sectionTitle: section.title,
                      blockId,
                    }) : undefined}
                  >
                    <ActionItemComponent
                      action={action}
                      index={idx}
                      isStruck={isStruck}
                      noteText={noteAnnotation?.new_value ?? undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Metadata */}
          {(section.data_freshness || section.confidence != null) && (
            <div style={{ fontSize: 12, color: colors.textMuted, paddingTop: 16, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans }}>
              {section.data_freshness && `Data as of ${new Date(section.data_freshness).toLocaleString('en-US')}`}
              {section.data_freshness && section.confidence != null && ' • '}
              {section.confidence != null && `Confidence: ${Math.round(section.confidence * 100)}%`}
            </div>
          )}

          {/* Section Feedback (only for agent-generated briefings) */}
          {workspaceId && agentId && generationId && (
            <SectionFeedback
              workspaceId={workspaceId}
              agentId={agentId}
              generationId={generationId}
              sectionId={section.section_id}
              existingSignal={existingSignal}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MetricCardComponent({ metric, annotationOverride, annotationOriginal }: {
  metric: MetricCard;
  annotationOverride?: string;
  annotationOriginal?: string;
}) {
  const severityColors = {
    critical: { bg: '#7f1d1d', border: '#991b1b', accent: '#dc2626' },
    warning: { bg: '#78350f', border: '#92400e', accent: '#f59e0b' },
    good: { bg: '#14532d', border: '#166534', accent: '#22c55e' },
  };

  const defaultColors = { bg: colors.surfaceRaised, border: colors.border, accent: colors.border };
  const colorScheme = (metric.severity && severityColors[metric.severity]) || defaultColors;
  const hasSeverity = !!metric.severity;

  return (
    <div style={{
      border: `1px solid ${annotationOverride ? '#00BFA544' : colorScheme.border}`,
      background: colorScheme.bg,
      borderLeft: `4px solid ${annotationOverride ? '#00BFA5' : colorScheme.accent}`,
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: hasSeverity ? 'rgba(255,255,255,0.6)' : colors.textSecondary, fontWeight: 600, fontFamily: fonts.sans }}>{metric.label}</div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {annotationOverride ? (
          <>
            <span style={{ fontSize: 18, fontWeight: 700, color: colors.textMuted, textDecoration: 'line-through', opacity: 0.5, fontFamily: fonts.sans }}>{annotationOriginal || metric.value}</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#00BFA5', fontFamily: fonts.sans }}>{annotationOverride}</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 24, fontWeight: 700, color: hasSeverity ? '#ffffff' : colors.text, fontFamily: fonts.sans }}>{metric.value}</span>
            {metric.delta && (
              <span style={{ fontSize: 14, color: hasSeverity ? 'rgba(255,255,255,0.6)' : colors.textSecondary, fontFamily: fonts.sans }}>
                {metric.delta_direction === 'up' ? '▲' : metric.delta_direction === 'down' ? '▼' : '—'} {metric.delta}
              </span>
            )}
          </>
        )}
      </div>
      {annotationOverride && (
        <div style={{ fontSize: 10, color: '#00BFA5', marginTop: 4, fontWeight: 500, fontFamily: fonts.sans }}>✎ Edited</div>
      )}
    </div>
  );
}

function DealCardComponent({ deal, anonymizeMode }: { deal: DealCard; anonymizeMode: boolean }) {
  const severityColors = {
    critical: { border: '#dc2626', bg: '#7f1d1d' },
    warning: { border: '#f59e0b', bg: '#78350f' },
    info: { border: '#3b82f6', bg: '#1e3a8a' },
  };

  const defaultDealColors = { border: colors.border, bg: colors.surfaceRaised };
  const colorScheme = (deal.signal_severity && severityColors[deal.signal_severity]) || defaultDealColors;
  const hasSeverity = !!deal.signal_severity;
  const displayName = anonymizeMode ? `Company ${deal.name?.charAt(0) || '?'}` : (deal.name || 'Unknown');
  const displayOwner = anonymizeMode ? `Rep ${deal.owner?.charAt(0) || '?'}` : (deal.owner || 'Unknown');

  return (
    <div style={{
      borderLeft: `4px solid ${colorScheme.border}`,
      background: colorScheme.bg,
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ fontWeight: 600, color: hasSeverity ? '#ffffff' : colors.text, fontFamily: fonts.sans, margin: 0 }}>{displayName}</h4>
          <div style={{ fontSize: 14, color: hasSeverity ? 'rgba(255,255,255,0.6)' : colors.textSecondary, marginTop: 4, fontFamily: fonts.sans }}>
            {displayOwner} • {deal.stage} • {deal.signal}
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: hasSeverity ? '#ffffff' : colors.text, fontFamily: fonts.sans }}>{deal.amount}</div>
      </div>
      {deal.action && (
        <div style={{ marginTop: 12, fontSize: 14, color: hasSeverity ? 'rgba(255,255,255,0.85)' : colors.accent, fontWeight: 500, fontFamily: fonts.sans }}>→ {deal.action}</div>
      )}
    </div>
  );
}

function ActionItemComponent({ action, index, isStruck, noteText }: {
  action: ActionItem;
  index: number;
  isStruck?: boolean;
  noteText?: string;
}) {
  const urgencyColors: Record<string, string> = {
    today: '#dc2626',
    this_week: '#f59e0b',
    this_month: '#22c55e',
  };

  const urgencyLabels: Record<string, string> = {
    today: 'TODAY',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12,
      background: colors.surfaceRaised, borderRadius: 8,
      opacity: isStruck ? 0.45 : 1,
    }}>
      <input type="checkbox" style={{ marginTop: 4 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: urgencyColors[action.urgency] || colors.textSecondary, fontFamily: fonts.sans }}>
            {urgencyLabels[action.urgency] || 'ACTION'}
          </span>
          <span style={{
            fontSize: 14, color: colors.text, fontFamily: fonts.sans,
            textDecoration: isStruck ? 'line-through' : 'none',
            textDecorationColor: '#f87171',
          }}>{action.action}</span>
        </div>
        {action.owner && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>Owned by: {action.owner}</div>
        )}
        {isStruck && (
          <div style={{ fontSize: 11, color: '#f87171', marginTop: 3, fontFamily: fonts.sans }}>Removed by annotation</div>
        )}
        {noteText && (
          <div style={{
            marginTop: 8, padding: '6px 10px',
            borderLeft: '2px solid #00BFA5',
            background: 'rgba(0,191,165,0.07)',
            borderRadius: '0 5px 5px 0',
            fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', fontFamily: fonts.sans,
          }}>
            {noteText}
          </div>
        )}
      </div>
    </div>
  );
}

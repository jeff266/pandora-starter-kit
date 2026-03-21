import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, Share2, Settings, ChevronLeft, ChevronRight, Eye, Edit3, X, Clock, Plus, MoreHorizontal } from 'lucide-react';
import PandoraRail from '../components/report/PandoraRail';
import type { SectionContent, MetricCard, DealCard, ActionItem, SankeyChartData } from '../components/reports/types';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { renderMarkdown } from '../lib/render-markdown';
import SectionFeedback from '../components/reports/SectionFeedback';
import OverallBriefingFeedback from '../components/reports/OverallBriefingFeedback';
import SankeyChart from '../components/reports/SankeyChart';
import ReportAnnotationEditor, { type Annotation } from '../components/reports/ReportAnnotationEditor';
import AnnotatableSection, { type Annotation as DocAnnotation } from '../components/report/AnnotatableSection';
import { ContextMenu as DocContextMenu } from '../components/report/ContextMenu';
import ChartBuilder from '../components/report/ChartBuilder';
import SectionEditor from '../components/report/SectionEditor';
import PrepareForClientModal from '../components/report/PrepareForClientModal';
import type { ExportConfig } from '../types/export';
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
  tiptap_content?: Record<string, any>;
}

interface DocListEntry {
  id: string;
  generated_at: string;
  week_label: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  monday_briefing: 'Monday Briefing',
  weekly_business_review: 'Weekly Business Review',
  wbr: 'Weekly Business Review',
  qbr: 'Quarterly Business Review',
  board_deck: 'Board Deck',
};

const DOC_TYPE_BANNER: Record<string, { label: string; accent: string; bg: string; pill: string; pillText: string }> = {
  wbr: {
    label: 'Weekly Business Review',
    accent: '#2dd4bf',
    bg: 'linear-gradient(135deg, #042f2e 0%, #0d3330 100%)',
    pill: '#0f766e',
    pillText: '#ccfbf1',
  },
  qbr: {
    label: 'Quarterly Business Review',
    accent: '#fb923c',
    bg: 'linear-gradient(135deg, #431407 0%, #7c2d12 100%)',
    pill: '#c2410c',
    pillText: '#ffedd5',
  },
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
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [docAnnotations, setDocAnnotations] = useState<DocAnnotation[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportModalFormat, setExportModalFormat] = useState<'pdf' | 'docx' | 'pptx'>('pdf');
  const [exportLoading, setExportLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ReportContextTarget } | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [docContextMenu, setDocContextMenu] = useState<{ x: number; y: number; sectionId: string; sectionTitle: string; paragraphIndex: number | null } | null>(null);
  const [chartBuilderSection, setChartBuilderSection] = useState<{ sectionId: string; fromEditor?: boolean } | null>(null);
  const [exportingToGoogleDocs, setExportingToGoogleDocs] = useState(false);
  const [googleDocsUrl, setGoogleDocsUrl] = useState<string | null>(null);
  const [googleDocsError, setGoogleDocsError] = useState<string | null>(null);
  const [editingChart, setEditingChart] = useState<any>(null);
  const [sectionCharts, setSectionCharts] = useState<Record<string, any[]>>({});
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const [hasUsedRightClick] = useState(
    () => localStorage.getItem('pandora-rightclick-hint-dismissed') === 'true'
  );
  const { canAnnotateReports } = usePermissions();
  const { currentWorkspace } = useWorkspace();

  // Collapsible rails
  const [timelineOpen, setTimelineOpen] = useState(() => {
    try { return localStorage.getItem('report_timeline_open') !== 'false'; } catch { return true; }
  });
  const [pandoraOpen, setPandoraOpen] = useState(() => {
    try { return localStorage.getItem('report_pandora_open') === 'true'; } catch { return false; }
  });
  const [pandoraMode, setPandoraMode] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Header dropdowns
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDirectBriefing) {
      loadDirectGeneration();
    } else {
      loadReport();
      loadGenerations();
    }
  }, [workspaceId, reportId, generationId]);

  useEffect(() => {
    const wid = currentWorkspace?.id;
    if (!reportDocument?.id || !wid) return;
    const token = localStorage.getItem('pandora_session');
    fetch(`/api/workspaces/${wid}/reports/${reportDocument.id}/annotations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setDocAnnotations(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to load annotations:', err));
  }, [reportDocument?.id, currentWorkspace?.id]);

  useEffect(() => {
    const wid = currentWorkspace?.id;
    if (!reportDocument?.id || !wid) return;
    const token = localStorage.getItem('pandora_session');
    fetch(`/api/workspaces/${wid}/reports/${reportDocument.id}/charts`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const charts = data.charts || [];
        const grouped: Record<string, any[]> = {};
        for (const c of charts) {
          if (!grouped[c.section_id]) grouped[c.section_id] = [];
          grouped[c.section_id].push(c);
        }
        setSectionCharts(grouped);
      })
      .catch(err => console.error('Failed to load section charts:', err));
  }, [reportDocument?.id, currentWorkspace?.id]);

  // Persist rail open/closed state
  useEffect(() => { try { localStorage.setItem('report_timeline_open', String(timelineOpen)); } catch {} }, [timelineOpen]);
  useEffect(() => { try { localStorage.setItem('report_pandora_open', String(pandoraOpen)); } catch {} }, [pandoraOpen]);

  // Close dropdown menus on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) setShareMenuOpen(false);
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) setOverflowMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Active section tracking via IntersectionObserver
  useEffect(() => {
    const map = sectionRefs.current;
    if (map.size === 0) return;
    const ratioMap = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = (entry.target as HTMLElement).dataset.sectionId;
        if (id) ratioMap.set(id, entry.intersectionRatio);
      });
      let bestId: string | null = null;
      let bestRatio = 0;
      ratioMap.forEach((ratio, id) => {
        if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
      });
      if (bestId) setActiveSectionId(bestId);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] });
    map.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reportDocument?.id]);

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

  function extractVerdict(content?: string): string {
    if (!content) return '';
    const firstSentence = content.split(/[.!?]/)[0].trim();
    return firstSentence.length > 100 ? firstSentence.slice(0, 97) + '...' : firstSentence;
  }

  function scrollToSection(sectionId: string) {
    const el = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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

  async function handleExportWithConfig(config: ExportConfig) {
    if (!reportDocument?.id) {
      alert('Report document not loaded — please refresh the page and try again.');
      return;
    }
    const wid = currentWorkspace?.id || workspaceId;
    if (!wid) {
      alert('No workspace selected.');
      return;
    }
    setExportLoading(true);
    try {
      const token = localStorage.getItem('pandora_session');
      const res = await fetch(
        `/api/workspaces/${wid}/reports/${reportDocument.id}/export`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(config),
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        console.error('[Export] Failed:', errText);
        alert(`Export failed: ${errText}`);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (reportDocument.week_label || 'report').replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
      a.href = url;
      a.download = `${slug}.${config.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err) {
      console.error('[Export] Network error:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportLoading(false);
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

  async function handleExportToGoogleDocs() {
    if (!reportDocument?.id) return;
    const wid = currentWorkspace?.id || workspaceId;
    if (!wid) return;
    setExportingToGoogleDocs(true);
    setGoogleDocsError(null);
    try {
      const token = localStorage.getItem('pandora_session');
      const res = await fetch(
        `/api/workspaces/${wid}/reports/${reportDocument.id}/export/google-docs`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'google_drive_not_connected') {
          setGoogleDocsError('Google Drive not connected. Go to Settings → Integrations to connect.');
        } else {
          setGoogleDocsError(data.message ?? 'Export failed.');
        }
        return;
      }
      setGoogleDocsUrl(data.doc_url);
      window.open(data.doc_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setGoogleDocsError('Export failed. Please try again.');
    } finally {
      setExportingToGoogleDocs(false);
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
    ? (reportDocument.document_type === 'agent_run' && reportDocument.config?.agent_name
        ? reportDocument.config.agent_name
        : (DOC_TYPE_LABELS[reportDocument.document_type] || reportDocument.document_type))
    : (template?.name || generation?.agent_name || 'Agent Briefing');
  const sections = generation?.sections_content || generation?.sections_snapshot || [];
  const isV2 = (generation?.version || 1) > 1;
  const annotations = generation?.human_annotations || [];

  const timelineWidth = timelineOpen ? 256 : 48;
  const pandoraWidth = pandoraOpen ? 360 : 48;

  const dropdownItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', width: '100%', textAlign: 'left',
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 13, fontFamily: fonts.sans, color: colors.text,
    boxSizing: 'border-box',
  };

  const activeSectionTitle = (() => {
    if (!activeSectionId || !reportDocument) return null;
    const sec = reportDocument.sections.find(s => s.id === activeSectionId);
    return sec?.title ?? null;
  })();

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: colors.bg }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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

      {/* Doc Section Context Menu */}
      {docContextMenu && (
        <DocContextMenu
          x={docContextMenu.x}
          y={docContextMenu.y}
          sectionTitle={docContextMenu.sectionTitle}
          onNote={() => {
            const { sectionId, paragraphIndex } = docContextMenu || {};
            if (sectionId !== undefined && paragraphIndex !== null && paragraphIndex !== undefined) {
              window.dispatchEvent(
                new CustomEvent('open-annotation-bubble', {
                  detail: { sectionId, paragraphIndex },
                })
              );
            } else {
              setIsAnnotating(true);
            }
            setDocContextMenu(null);
          }}
          onChart={() => {
            setEditingChart(null);
            setChartBuilderSection({ sectionId: docContextMenu.sectionId });
            setDocContextMenu(null);
          }}
          onFlag={() => setDocContextMenu(null)}
          onClose={() => setDocContextMenu(null)}
        />
      )}

      {/* Chart Builder Panel */}
      {chartBuilderSection && reportDocument && (
        <ChartBuilder
          workspaceId={currentWorkspace?.id || workspaceId || ''}
          reportDocumentId={reportDocument.id}
          sectionId={chartBuilderSection.sectionId}
          token={localStorage.getItem('pandora_session') || ''}
          existingChart={editingChart}
          onInsert={(insertedChart) => {
            const sid = chartBuilderSection.sectionId;
            setSectionCharts(prev => {
              const existing = prev[sid] || [];
              const updated = editingChart
                ? existing.map(c => c.id === editingChart.id ? insertedChart : c)
                : [...existing, insertedChart];
              return { ...prev, [sid]: updated };
            });
            if (chartBuilderSection.fromEditor) {
              window.dispatchEvent(new CustomEvent('section-editor-chart-inserted', {
                detail: { sectionId: sid, chart: insertedChart },
              }));
            }
            setChartBuilderSection(null);
            setEditingChart(null);
          }}
          onCancel={() => {
            setChartBuilderSection(null);
            setEditingChart(null);
          }}
        />
      )}

      {/* Export Modal */}
      {showExportModal && reportDocument && (
        <PrepareForClientModal
          reportDocument={reportDocument}
          defaultFormat={exportModalFormat}
          workspaceName={currentWorkspace?.name}
          onExport={handleExportWithConfig}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Timeline Rail — collapsible left */}
      <div style={{ width: timelineWidth, transition: 'width 150ms ease', flexShrink: 0, position: 'relative', background: colors.surface, borderRight: `1px solid ${colors.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Collapsed icon strip */}
        {!timelineOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 10, flex: 1, overflow: 'hidden' }}>
            <button
              title="Timeline"
              onClick={() => setTimelineOpen(true)}
              style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${colors.border}`, cursor: 'pointer', color: colors.textSecondary, flexShrink: 0, padding: 0 }}
            >
              <Clock style={{ width: 15, height: 15 }} />
            </button>
            {(isDirectBriefing ? docList : generations).slice(0, 5).map((item: any) => {
              const isActive = isDirectBriefing ? item.id === generationId : item.id === generation?.id;
              const label = isDirectBriefing
                ? item.week_label
                : new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              return (
                <button
                  key={item.id}
                  title={label}
                  onClick={() => isDirectBriefing
                    ? navigate(`/workspace/${workspaceId}/briefing/${item.id}`)
                    : navigate(`/workspace/${workspaceId}/reports/${reportId}/generations/${item.id}`)
                  }
                  style={{ width: 10, height: 10, borderRadius: '50%', background: isActive ? colors.accent : colors.border, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                />
              );
            })}
            <div style={{ flex: 1 }} />
            {!isDirectBriefing && reportId && (
              <button
                title="Generate new"
                onClick={() => navigate(`/workspace/${workspaceId}/reports/${reportId}/edit`)}
                style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.accentSoft, border: `1px solid ${colors.accent}44`, cursor: 'pointer', color: colors.accent, flexShrink: 0, padding: 0 }}
              >
                <Plus style={{ width: 15, height: 15 }} />
              </button>
            )}
          </div>
        )}

        {/* Expanded state */}
        {timelineOpen && (<>
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
        </>)}

        {/* Toggle chevron */}
        <button
          onClick={() => setTimelineOpen(o => !o)}
          title={timelineOpen ? 'Collapse timeline' : 'Expand timeline'}
          style={{
            position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)',
            width: 24, height: 24, borderRadius: '50%', border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10, padding: 0, color: colors.textSecondary,
          }}
        >
          <ChevronRight style={{ width: 14, height: 14, transition: 'transform 150ms ease', transform: timelineOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </button>
      </div>

      {/* Center — document */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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

        {/* Doc Annotation Mode Banner */}
        {isAnnotating && reportDocument && (
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
              ✏️ ANNOTATION MODE — Click any paragraph to add notes, overrides, or flags.
            </span>
            <button
              onClick={() => setIsAnnotating(false)}
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

        {/* WBR / QBR document banner */}
        {reportDocument && DOC_TYPE_BANNER[reportDocument.document_type] && (() => {
          const banner = DOC_TYPE_BANNER[reportDocument.document_type];
          const sectionCount = (reportDocument.sections || []).length;
          const generatedAgo = reportDocument.generated_at
            ? (() => {
                const diff = (Date.now() - new Date(reportDocument.generated_at).getTime()) / 1000;
                if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
                return `${Math.round(diff / 86400)}d ago`;
              })()
            : null;
          return (
            <div style={{
              background: banner.bg,
              borderBottom: `1px solid ${banner.accent}33`,
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                  background: banner.pill, color: banner.pillText, borderRadius: 20,
                  fontFamily: fonts.sans, textTransform: 'uppercase',
                }}>
                  {reportDocument.document_type.toUpperCase()}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', fontFamily: fonts.sans }}>
                  {banner.label}
                </span>
                {reportDocument.week_label && (
                  <span style={{ fontSize: 13, color: banner.accent, fontFamily: fonts.sans }}>
                    · {reportDocument.week_label}
                  </span>
                )}
                <span style={{ fontSize: 13, color: `${banner.accent}88`, fontFamily: fonts.sans }}>
                  {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                </span>
                {generatedAgo && (
                  <span style={{ fontSize: 12, color: `${banner.accent}66`, fontFamily: fonts.sans }}>
                    · Generated {generatedAgo}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => window.print()}
                  style={{
                    padding: '6px 14px',
                    background: 'rgba(255,255,255,0.08)',
                    border: `1px solid ${banner.accent}33`,
                    borderRadius: 7,
                    color: banner.accent,
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                >
                  ↓ Download PDF
                </button>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={handleExportToGoogleDocs}
                    disabled={exportingToGoogleDocs || !reportDocument}
                    style={{
                      padding: '6px 14px',
                      background: 'rgba(255,255,255,0.08)',
                      border: `1px solid ${banner.accent}44`,
                      borderRadius: 7,
                      color: banner.accent,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      cursor: exportingToGoogleDocs ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      opacity: exportingToGoogleDocs ? 0.7 : 1,
                    }}
                  >
                    {exportingToGoogleDocs
                      ? 'Exporting...'
                      : googleDocsUrl
                        ? '✓ Opened in Google Docs'
                        : 'Export to Google Docs →'}
                  </button>
                  {googleDocsError && (
                    <div style={{
                      position: 'absolute',
                      top: '110%',
                      left: 0,
                      fontSize: 11,
                      color: '#dc2626',
                      background: '#fff1f2',
                      border: '1px solid #fecaca',
                      borderRadius: 6,
                      padding: '4px 8px',
                      whiteSpace: 'nowrap',
                      zIndex: 100,
                    }}>
                      {googleDocsError}
                      {googleDocsError.includes('not connected') && (
                        <a href="/settings/integrations" style={{ marginLeft: 6, textDecoration: 'underline', color: '#dc2626' }}>Connect now →</a>
                      )}
                    </div>
                  )}
                  {googleDocsUrl && (
                    <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100 }}>
                      <a href={googleDocsUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: banner.accent, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                        Open again →
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

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

              {/* Share dropdown */}
              <div ref={shareMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setShareMenuOpen(o => !o); setOverflowMenuOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                    background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: fonts.sans,
                  }}
                >
                  <Share2 style={{ width: 15, height: 15 }} />
                  Share
                  <ChevronRight style={{ width: 12, height: 12, transform: 'rotate(90deg)', opacity: 0.7 }} />
                </button>
                {shareMenuOpen && (
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 200,
                    background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
                    padding: '4px 0', minWidth: 190, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  }}>
                    {isV2 && workspaceId && reportId && generation?.id && (
                      <button onClick={() => { window.open(`/api/${workspaceId}/reports/${reportId}/generations/${generation?.id}/export/pdf`, '_blank'); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download PDF
                      </button>
                    )}
                    {reportDocument && (
                      <button onClick={() => { setExportModalFormat('pdf'); setShowExportModal(true); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download PDF
                      </button>
                    )}
                    {!reportDocument && Object.keys(generation?.formats_generated || {}).includes('pdf') && (
                      <button onClick={() => { downloadFormat('pdf'); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download PDF
                      </button>
                    )}
                    {isV2 && workspaceId && reportId && generation?.id && (
                      <button onClick={() => { window.open(`/api/${workspaceId}/reports/${reportId}/generations/${generation?.id}/export/docx`, '_blank'); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download DOCX
                      </button>
                    )}
                    {reportDocument && (
                      <button onClick={() => { setExportModalFormat('docx'); setShowExportModal(true); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download DOCX
                      </button>
                    )}
                    {!reportDocument && Object.keys(generation?.formats_generated || {}).includes('docx') && (
                      <button onClick={() => { downloadFormat('docx'); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Download style={{ width: 13, height: 13 }} /> Download DOCX
                      </button>
                    )}
                    {!reportDocument && (
                      <button onClick={() => { shareReport(); setShareMenuOpen(false); }} style={dropdownItemStyle}>
                        <Share2 style={{ width: 13, height: 13 }} /> Copy share link
                      </button>
                    )}
                    <div style={{ height: 1, background: colors.border, margin: '4px 0' }} />
                    {reportDocument && (
                      <button
                        onClick={() => { handleExportToGoogleDocs(); setShareMenuOpen(false); }}
                        disabled={exportingToGoogleDocs}
                        style={{
                          ...dropdownItemStyle,
                          cursor: exportingToGoogleDocs ? 'wait' : 'pointer',
                          opacity: 1,
                          width: '100%',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                        }}
                      >
                        {exportingToGoogleDocs
                          ? 'Exporting...'
                          : googleDocsUrl
                            ? '✓ Opened in Google Docs'
                            : 'Export to Google Docs →'}
                      </button>
                    )}
                    {googleDocsUrl && (
                      <div style={{ padding: '2px 12px 6px' }}>
                        <a href={googleDocsUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: colors.accent, textDecoration: 'underline' }}>
                          Open again →
                        </a>
                      </div>
                    )}
                    {googleDocsError && (
                      <div style={{ fontSize: 11, color: '#dc2626', padding: '2px 12px 6px' }}>
                        {googleDocsError}
                        {googleDocsError.includes('not connected') && (
                          <a href="/settings/integrations" style={{ marginLeft: 6, textDecoration: 'underline', color: '#dc2626' }}>Connect now →</a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Overflow menu */}
              <div ref={overflowMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setOverflowMenuOpen(o => !o); setShareMenuOpen(false); }}
                  title="More options"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 8,
                    background: overflowMenuOpen ? colors.border : colors.surfaceRaised, border: 'none', cursor: 'pointer', color: colors.text,
                  }}
                >
                  <MoreHorizontal style={{ width: 16, height: 16 }} />
                </button>
                {overflowMenuOpen && (
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 200,
                    background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
                    padding: '4px 0', minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  }}>
                    {canAnnotateReports && !annotateMode && !reportDocument && (
                      <button onClick={() => { setAnnotateMode(true); setOverflowMenuOpen(false); }} style={dropdownItemStyle}>
                        <Edit3 style={{ width: 13, height: 13 }} /> Annotate
                      </button>
                    )}
                    {canAnnotateReports && !isAnnotating && reportDocument && (
                      <button onClick={() => { setIsAnnotating(true); setOverflowMenuOpen(false); }} style={dropdownItemStyle}>
                        <Edit3 style={{ width: 13, height: 13 }} /> Annotate
                        {docAnnotations.length > 0 && (
                          <span style={{ fontSize: 11, background: colors.accent, color: '#fff', borderRadius: 10, padding: '1px 6px', marginLeft: 4 }}>
                            {docAnnotations.length}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => { setAnonymizeMode(m => !m); setOverflowMenuOpen(false); }}
                      style={{ ...dropdownItemStyle, color: anonymizeMode ? '#78350f' : colors.text, background: anonymizeMode ? '#fef3c7' : 'transparent' }}
                    >
                      <Eye style={{ width: 13, height: 13 }} />
                      {anonymizeMode ? 'Anonymized ✓' : 'Anonymize'}
                    </button>
                    {reportId && (
                      <Link
                        to={`/workspace/${workspaceId}/reports/${reportId}/edit`}
                        onClick={() => setOverflowMenuOpen(false)}
                        style={{ ...dropdownItemStyle, color: colors.text, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box' }}
                      >
                        <Settings style={{ width: 13, height: 13 }} /> Template settings
                      </Link>
                    )}
                  </div>
                )}
              </div>

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
                {reportDocument.sections.map((section, sectionIndex) => {
                  const wid = currentWorkspace?.id || workspaceId || '';
                  const sectionChartList = sectionCharts[section.id] || [];
                  return (
                    <div
                      key={section.id}
                      data-section-id={section.id}
                      ref={el => { if (el) sectionRefs.current.set(section.id, el); }}
                      style={{ background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`, padding: 24 }}
                      onMouseEnter={() => { setHoveredSection(section.id); setActiveSectionId(section.id); }}
                      onMouseLeave={() => setHoveredSection(null)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        localStorage.setItem('pandora-rightclick-hint-dismissed', 'true');
                        let paragraphIndex: number | null = null;
                        let el = e.target as HTMLElement | null;
                        while (el && el !== e.currentTarget) {
                          const idx = el.dataset.paragraph;
                          if (idx !== undefined) {
                            paragraphIndex = parseInt(idx, 10);
                            break;
                          }
                          el = el.parentElement;
                        }
                        setDocContextMenu({ x: e.clientX, y: e.clientY, sectionId: section.id, sectionTitle: section.title, paragraphIndex });
                      }}
                    >
                      <SectionEditor
                        section={section}
                        tiptapContent={reportDocument.tiptap_content?.[section.id]}
                        annotations={docAnnotations.filter(a => a.section_id === section.id)}
                        isAnnotating={isAnnotating}
                        highlightedParagraphIndex={
                          docContextMenu?.sectionId === section.id
                            ? docContextMenu.paragraphIndex
                            : null
                        }
                        workspaceId={wid}
                        documentId={reportDocument!.id}
                        token={localStorage.getItem('pandora_session') || ''}
                        onOpenChartBuilder={(sectionId, fromEditor) => {
                          setEditingChart(null);
                          setChartBuilderSection({ sectionId, fromEditor });
                        }}
                        onChartInserted={(sectionId, chart) => {
                          setSectionCharts(prev => {
                            const list = [...(prev[sectionId] || [])];
                            const idx = list.findIndex(c => c.id === chart.id);
                            if (idx >= 0) list[idx] = chart;
                            else list.push(chart);
                            return { ...prev, [sectionId]: list };
                          });
                        }}
                        onAnnotationSave={async (data) => {
                          const token = localStorage.getItem('pandora_session');
                          const docId = reportDocument!.id;
                          const res = await fetch(
                            `/api/workspaces/${wid}/reports/${docId}/annotations`,
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify(data),
                            }
                          );
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            console.error('[Annotations] Save failed:', res.status, err);
                            throw new Error(err.error || `Save failed (${res.status})`);
                          }
                          const saved: DocAnnotation = await res.json();
                          setDocAnnotations(prev => [
                            ...prev.filter(a => !(a.section_id === data.section_id && a.paragraph_index === data.paragraph_index)),
                            saved,
                          ]);
                        }}
                        onAnnotationDelete={async (annotationId) => {
                          const token = localStorage.getItem('pandora_session');
                          await fetch(
                            `/api/workspaces/${wid}/reports/${reportDocument!.id}/annotations/${annotationId}`,
                            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
                          );
                          setDocAnnotations(prev => prev.filter(a => a.id !== annotationId));
                        }}
                      />
                      {/* Tip: right-click hint — first section only, dismissed after first right-click */}
                      {!hasUsedRightClick && sectionIndex === 0 && (
                        <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: -8, marginBottom: 8 }}>
                          Tip: right-click any paragraph for more options
                        </div>
                      )}

                      {/* Inserted charts for this section */}
                      {sectionChartList.map(chart => (
                        <div key={chart.id} style={{ marginTop: 16, border: '0.5px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#F8FAFC', borderBottom: '0.5px solid #E2E8F0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{chart.title}</span>
                              <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', background: '#E2E8F0', padding: '2px 6px', borderRadius: 4 }}>
                                v{chart.version || 1}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                setEditingChart(chart);
                                setChartBuilderSection({ sectionId: section.id });
                              }}
                              style={{ fontSize: 11, color: '#0D9488', background: 'none', border: '0.5px solid #0D9488', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                            >
                              ↻ Edit
                            </button>
                          </div>
                          <img
                            src={`/api/workspaces/${wid}/reports/${reportDocument!.id}/charts/${chart.id}/image`}
                            alt={chart.title}
                            style={{ width: '100%', display: 'block' }}
                          />
                        </div>
                      ))}

                      {/* Hover action strip */}
                      {hoveredSection === section.id && (
                        <div style={{
                          display: 'flex',
                          gap: 6,
                          padding: '8px 0 2px',
                          borderTop: '0.5px solid #F1F5F9',
                          marginTop: 12,
                        }}>
                          <button
                            onClick={() => {
                              setEditingChart(null);
                              setChartBuilderSection({ sectionId: section.id });
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', background: 'none',
                              border: '0.5px solid #E2E8F0', borderRadius: 5,
                              fontSize: 11, color: '#64748B', cursor: 'pointer',
                              transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.borderColor = '#0D9488';
                              (e.currentTarget as HTMLElement).style.color = '#0D9488';
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
                              (e.currentTarget as HTMLElement).style.color = '#64748B';
                            }}
                          >
                            <span style={{ fontSize: 13 }}>▤</span>
                            Add chart
                          </button>
                          <button
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('open-annotation-bubble', {
                                detail: { sectionId: section.id, paragraphIndex: 0 },
                              }));
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', background: 'none',
                              border: '0.5px solid #E2E8F0', borderRadius: 5,
                              fontSize: 11, color: '#64748B', cursor: 'pointer',
                              transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.borderColor = '#0D9488';
                              (e.currentTarget as HTMLElement).style.color = '#0D9488';
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
                              (e.currentTarget as HTMLElement).style.color = '#64748B';
                            }}
                          >
                            <span style={{ fontSize: 13 }}>✎</span>
                            Add note
                          </button>
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

                {(() => {
                  const questionSummary = (sections || [])
                    .filter((s: any) => s.standing_question)
                    .map((s: any) => ({
                      question: s.standing_question,
                      verdict: extractVerdict(s.content || s.headline),
                      sectionId: s.section_id,
                    }));
                  return questionSummary.length > 0 ? (
                    <div style={{
                      marginBottom: 24,
                      padding: '14px 18px',
                      background: '#F8FAFC',
                      borderRadius: 8,
                      border: '0.5px solid #E2E8F0',
                    }}>
                      <div
                        onClick={() => setSummaryExpanded(!summaryExpanded)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#64748B',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}>
                          Questions this report answers
                        </span>
                        <span style={{ fontSize: 10, color: '#94A3B8' }}>
                          {summaryExpanded ? '▲ collapse' : '▼ expand'}
                        </span>
                      </div>
                      {summaryExpanded && (
                        <div style={{ marginTop: 12 }}>
                          {questionSummary.map((q: any) => (
                            <div
                              key={q.sectionId}
                              onClick={() => scrollToSection(q.sectionId)}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '16px 1fr',
                                gap: 8,
                                marginBottom: 10,
                                cursor: 'pointer',
                                padding: '4px 0',
                              }}
                            >
                              <span style={{ color: '#0D9488', fontSize: 12, marginTop: 1 }}>✓</span>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 2 }}>
                                  {q.question}
                                </div>
                                {q.verdict && (
                                  <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>
                                    {q.verdict}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}

                {sections?.map((section: any, idx: number) => {
                  const sectionId = section.section_id || `section-${idx}`;
                  const isCollapsed = collapsedSections.has(sectionId);
                  return (
                    <div key={sectionId} id={`section-${sectionId}`}>
                      <ReportSection
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
                    </div>
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

      {/* Right rail — Ask Pandora */}
      <div style={{ width: pandoraWidth, transition: 'width 150ms ease', flexShrink: 0, position: 'relative', borderLeft: `1px solid ${colors.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: colors.surface }}>

        {/* Toggle chevron (left edge of right rail) */}
        <button
          onClick={() => setPandoraOpen(o => !o)}
          title={pandoraOpen ? 'Close Ask Pandora' : 'Open Ask Pandora'}
          style={{
            position: 'absolute', left: -12, top: '50%', transform: 'translateY(-50%)',
            width: 24, height: 24, borderRadius: '50%', border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10, padding: 0, color: colors.textSecondary,
          }}
        >
          <ChevronLeft style={{ width: 14, height: 14, transition: 'transform 150ms ease', transform: pandoraOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </button>

        {/* Collapsed icon strip */}
        {!pandoraOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 10, flex: 1, overflow: 'hidden' }}>
            <button
              title="Ask Pandora"
              onClick={() => setPandoraOpen(true)}
              style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.accentSoft, border: `1px solid ${colors.accent}44`, cursor: 'pointer', color: colors.accent, flexShrink: 0, padding: 0, fontSize: 16 }}
            >
              ✦
            </button>
            {[
              { id: 'bull_bear', avatar: '/avatars/char-21.png', tooltip: 'Bull / Bear · Argue both sides' },
              { id: 'socratic', avatar: '/avatars/char-23.png', tooltip: 'Socratic · Question the assumption' },
              { id: 'boardroom', avatar: '/avatars/char-24.png', tooltip: 'Boardroom · Multiple perspectives' },
              { id: 'prosecutor_defense', avatar: '/avatars/char-25.png', tooltip: 'Prosecutor / Defense · Stress test a plan' },
            ].map(mode => (
              <button
                key={mode.id}
                title={mode.tooltip}
                onClick={() => { setPandoraMode(pandoraMode === mode.id ? null : mode.id); setPandoraOpen(true); }}
                style={{
                  width: 32, height: 32, borderRadius: '50%', padding: 0, cursor: 'pointer', flexShrink: 0,
                  border: `1px solid ${pandoraMode === mode.id ? colors.accent : colors.border}`,
                  background: pandoraMode === mode.id ? `${colors.accent}18` : 'transparent',
                  overflow: 'hidden',
                }}
              >
                <img src={mode.avatar} alt={mode.id} style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated', display: 'block' }} />
              </button>
            ))}
            <button
              title="Auto · Pandora decides"
              onClick={() => { setPandoraMode(null); setPandoraOpen(true); }}
              style={{
                width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${pandoraMode === null ? colors.accent : colors.border}`,
                background: pandoraMode === null ? `${colors.accent}18` : 'transparent',
                cursor: 'pointer', color: pandoraMode === null ? colors.accent : colors.textSecondary,
                flexShrink: 0, padding: 0, fontSize: 15,
              }}
            >
              ✦
            </button>
          </div>
        )}

        {/* Expanded state */}
        {pandoraOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 360, overflow: 'hidden' }}>
            {/* Rail header */}
            <div style={{ flexShrink: 0, padding: '12px 14px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: colors.surface }}>
              <span style={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: 14, color: colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: colors.accent }}>✦</span> Ask Pandora
              </span>
              <button
                onClick={() => setPandoraOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 18, padding: 0, display: 'flex', alignItems: 'center' }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            {/* Chat panel fills remaining height */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <PandoraRail
                workspaceId={workspaceId || ''}
                reportContext={{
                  documentId: reportDocument?.id,
                  documentType: reportDocument?.document_type,
                  periodLabel: reportDocument?.week_label,
                  activeSectionId,
                  activeSectionTitle,
                }}
                forcedMode={pandoraMode}
                onModeChange={setPandoraMode}
              />
            </div>
          </div>
        )}
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

function getPrimaryDelta(metrics?: MetricCard[]): MetricCard | null {
  if (!metrics) return null;
  const withDelta = metrics.filter(m => m.delta && m.delta_direction && m.delta_direction !== 'flat');
  if (!withDelta.length) return null;
  return withDelta[0];
}

function DeltaBadge({ metric }: { metric: MetricCard }) {
  const isUp = metric.delta_direction === 'up';
  const isDown = metric.delta_direction === 'down';
  const color = isUp ? '#16a34a' : isDown ? '#dc2626' : '#94a3b8';
  const arrow = isUp ? '↑' : isDown ? '↓' : '→';
  const tooltip = `${metric.label}\nThis week: ${metric.value}\nChange: ${metric.delta}`;
  return (
    <span
      title={tooltip}
      style={{
        fontSize: 11,
        fontWeight: 500,
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}40`,
        borderRadius: 4,
        padding: '2px 7px',
        marginLeft: 8,
        whiteSpace: 'nowrap',
        fontFamily: fonts.sans,
        cursor: 'default',
        flexShrink: 0,
      }}
    >
      {metric.label}: {metric.value} {arrow} {metric.delta}
    </span>
  );
}

function ReportSection({ section, isCollapsed, onToggle, anonymizeMode, workspaceId, agentId, generationId, existingSignal, onContextMenu, humanAnnotations }: ReportSectionProps) {
  const primaryDelta = getPrimaryDelta(section.metrics);
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
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>{section.title}</h2>
          {primaryDelta && <DeltaBadge metric={primaryDelta} />}
        </div>
        {isCollapsed ? (
          <ChevronRight style={{ width: 20, height: 20, color: colors.textMuted }} />
        ) : (
          <ChevronLeft style={{ width: 20, height: 20, color: colors.textMuted }} />
        )}
      </button>

      {/* Section Content */}
      {!isCollapsed && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── Render path detection ──────────────────────────────────────────
               Full structured render: reasoning_tree present, OR no content field
               Plain text fallback:    content present but no reasoning_tree
          ─────────────────────────────────────────────────────────────────── */}
          {(section.reasoning_tree && section.reasoning_tree.length > 0) || !section.content ? (
            <>
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
            </>
          ) : (
            <>
              {/* ── Plain text fallback for free-form agent output ── */}
              <div style={{ color: colors.textSecondary, lineHeight: 1.7, fontFamily: fonts.sans }}>
                {section.content!.split('\n\n').map((para, idx) => (
                  <p key={idx} style={{ marginBottom: 16 }}>{renderMarkdown(para)}</p>
                ))}
              </div>

              {/* Actions array — rendered if present */}
              {(() => {
                const actionList = section.actions ?? section.action_items;
                return actionList && actionList.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.sans, margin: 0 }}>Action Items</h3>
                    {actionList.map((action, idx) => {
                      const blockId = `${section.section_id}:action:${idx}`;
                      const isStruck = humanAnnotations?.some(a => a.block_id === blockId && a.type === 'strike');
                      const noteAnnotation = humanAnnotations?.find(a => a.block_id === `${blockId}:note`);
                      return (
                        <div key={idx}>
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
                ) : null;
              })()}
            </>
          )}

          {/* Metadata — always shown */}
          {(section.data_freshness || section.confidence != null) && (
            <div style={{ fontSize: 12, color: colors.textMuted, paddingTop: 16, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans }}>
              {section.data_freshness && `Data as of ${new Date(section.data_freshness).toLocaleString('en-US')}`}
              {section.data_freshness && section.confidence != null && ' • '}
              {section.confidence != null && `Confidence: ${Math.round(section.confidence * 100)}%`}
            </div>
          )}

          {/* Section Feedback — always shown for agent-generated briefings */}
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
          }}>{action.action.replace(/\s*—?\s*Owned by:.*$/i, '').trim()}</span>
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

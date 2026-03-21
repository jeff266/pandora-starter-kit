import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Clock, X, CheckCircle, AlertTriangle, AlertCircle, Loader2, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import AvatarDisplay from '../components/avatars/AvatarDisplay';
import IntelligenceNav from '../components/IntelligenceNav';

interface ReportDocSection {
  id: string;
  title: string;
  content: string;
  word_count?: number;
  source_skills?: string[];
  severity?: 'critical' | 'warning' | 'info';
}

interface ReportDocument {
  id: string;
  document_type: string;
  week_label: string;
  headline: string;
  generated_at: string;
  sections: ReportDocSection[];
  skills_included?: string[];
  agent_id?: string;
  config?: { agent_name?: string; agent_goal?: string; run_id?: string };
}

const DOC_TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  monday_briefing:      { label: 'Monday Briefing',          bg: '#1a2744', color: '#6ea8fe' },
  weekly_business_review: { label: 'Weekly Business Review', bg: '#1a2744', color: '#6ea8fe' },
  wbr:                  { label: 'WBR',                      bg: '#0d3330', color: '#2dd4bf' },
  qbr:                  { label: 'QBR',                      bg: '#2d1a0e', color: '#fb923c' },
  board_deck:           { label: 'Board Deck',               bg: '#1a1a2d', color: '#a78bfa' },
  agent_run:            { label: 'Agent Run',                bg: colors.surfaceRaised, color: colors.textSecondary },
};

const SKILL_LABELS: Record<string, string> = {
  'pipeline-hygiene':       'Pipeline Hygiene',
  'pipeline-coverage':      'Pipeline Coverage',
  'forecast-rollup':        'Forecast Rollup',
  'deal-risk-review':       'Deal Risk Review',
  'pipeline-waterfall':     'Pipeline Waterfall',
  'rep-scorecard':          'Rep Scorecard',
  'conversation-intelligence': 'Conversation Intelligence',
};

const WBR_SKILL_IDS = ['pipeline-hygiene', 'pipeline-coverage', 'forecast-rollup', 'deal-risk-review', 'pipeline-waterfall', 'rep-scorecard'];
const QBR_SKILL_IDS = ['pipeline-hygiene', 'pipeline-coverage', 'forecast-rollup', 'deal-risk-review', 'pipeline-waterfall', 'rep-scorecard', 'conversation-intelligence'];

function getMondays(count: number): Date[] {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const result: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() - i * 7);
    result.push(d);
  }
  return result;
}

function getQuarters(): { label: string; start: Date }[] {
  const today = new Date();
  const year = today.getFullYear();
  const currentQ = Math.floor(today.getMonth() / 3);
  const quarters: { label: string; start: Date }[] = [];
  for (let i = 0; i < 4; i++) {
    const q = currentQ - i;
    const y = q < 0 ? year - 1 : year;
    const qi = ((q % 4) + 4) % 4;
    quarters.push({
      label: `Q${qi + 1} ${y}`,
      start: new Date(y, qi * 3, 1),
    });
  }
  return quarters;
}

type SkillStatus = 'fresh' | 'stale' | 'missing';

function getWbrFreshness(lastRunAt: string | null, lastRunStatus: string | null): SkillStatus {
  if (!lastRunAt || lastRunStatus !== 'completed') return 'missing';
  const ageHours = (Date.now() - new Date(lastRunAt).getTime()) / 3600000;
  return ageHours <= 24 ? 'fresh' : 'stale';
}

function getQbrFreshness(lastRunAt: string | null, lastRunStatus: string | null): SkillStatus {
  if (!lastRunAt || lastRunStatus !== 'completed') return 'missing';
  const ageDays = (Date.now() - new Date(lastRunAt).getTime()) / 86400000;
  return ageDays <= 7 ? 'fresh' : 'stale';
}

interface SkillInfo {
  id: string;
  name: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

interface WbrQbrGenerateModalProps {
  workspaceId: string;
  type: 'wbr' | 'qbr';
  templateId: string;
  onClose: () => void;
  onSuccess: (documentId: string) => void;
}

function WbrQbrGenerateModal({ workspaceId, type, templateId, onClose, onSuccess }: WbrQbrGenerateModalProps) {
  const isWbr = type === 'wbr';
  const skillIds = isWbr ? WBR_SKILL_IDS : QBR_SKILL_IDS;
  const getFreshness = isWbr ? getWbrFreshness : getQbrFreshness;

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mondays = getMondays(8);
  const quarters = getQuarters();
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0);
  const [selectedQtrIdx, setSelectedQtrIdx] = useState(0);

  useEffect(() => {
    api.get('/skills')
      .then((data) => {
        const all: SkillInfo[] = (data.skills || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          lastRunAt: s.lastRunAt || null,
          lastRunStatus: s.lastRunStatus || null,
        }));
        const relevant = skillIds.map(sid => {
          const found = all.find(s => s.id === sid);
          return found || { id: sid, name: SKILL_LABELS[sid] || sid, lastRunAt: null, lastRunStatus: null };
        });
        setSkills(relevant);
      })
      .catch(() => {
        setSkills(skillIds.map(sid => ({ id: sid, name: SKILL_LABELS[sid] || sid, lastRunAt: null, lastRunStatus: null })));
      })
      .finally(() => setSkillsLoading(false));
  }, []);

  const periodLabel = isWbr
    ? `Week of ${mondays[selectedWeekIdx].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : quarters[selectedQtrIdx].label;

  const freshCounts = skills.reduce(
    (acc, sk) => {
      const s = getFreshness(sk.lastRunAt, sk.lastRunStatus);
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const data = await api.post(`/reports/${templateId}/generate`, {
        document_type: type,
        period_label: periodLabel,
      });
      if (data?.document_id) {
        onSuccess(data.document_id);
      } else {
        setError('Generation succeeded but no document was returned. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  const statusIcon = (sk: SkillInfo) => {
    const s = getFreshness(sk.lastRunAt, sk.lastRunStatus);
    if (s === 'fresh') return <CheckCircle style={{ width: 14, height: 14, color: '#22c55e', flexShrink: 0 }} />;
    if (s === 'stale') return <AlertTriangle style={{ width: 14, height: 14, color: '#f59e0b', flexShrink: 0 }} />;
    return <AlertCircle style={{ width: 14, height: 14, color: '#ef4444', flexShrink: 0 }} />;
  };

  const statusLabel = (sk: SkillInfo) => {
    const s = getFreshness(sk.lastRunAt, sk.lastRunStatus);
    if (s === 'fresh') return sk.lastRunAt ? `${timeSince(sk.lastRunAt)} ago` : 'Ready';
    if (s === 'stale') return sk.lastRunAt ? `${timeSince(sk.lastRunAt)} ago` : 'Stale';
    return 'No data';
  };

  const allFresh = freshCounts.missing === undefined && freshCounts.stale === undefined;
  const hasMissing = !!freshCounts.missing;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        width: '100%',
        maxWidth: 540,
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '24px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
              Generate {isWbr ? 'Weekly Business Review' : 'Quarterly Business Review'}
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 4 }}>
              {isWbr ? '8 sections · Pipeline, Forecast, Reps, Actions' : '10 sections · Quarter analysis, Win/Loss, Next plan'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 4 }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Period picker */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
              {isWbr ? 'Week' : 'Quarter'}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => isWbr ? setSelectedWeekIdx(i => Math.min(i + 1, mondays.length - 1)) : setSelectedQtrIdx(i => Math.min(i + 1, quarters.length - 1))}
                disabled={isWbr ? selectedWeekIdx >= mondays.length - 1 : selectedQtrIdx >= quarters.length - 1}
                style={{ background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: colors.textSecondary, lineHeight: 1 }}
              >
                <ChevronLeft style={{ width: 14, height: 14 }} />
              </button>
              <div style={{
                flex: 1, textAlign: 'center', padding: '8px 16px',
                background: colors.surfaceRaised, borderRadius: 6,
                fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <Calendar style={{ width: 14, height: 14, color: colors.textMuted }} />
                {periodLabel}
              </div>
              <button
                onClick={() => isWbr ? setSelectedWeekIdx(i => Math.max(i - 1, 0)) : setSelectedQtrIdx(i => Math.max(i - 1, 0))}
                disabled={isWbr ? selectedWeekIdx === 0 : selectedQtrIdx === 0}
                style={{ background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: colors.textSecondary, lineHeight: 1 }}
              >
                <ChevronRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          {/* Skill freshness */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Skill Data Freshness
              </label>
              <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
                {isWbr ? '≤24h = current' : '≤7d = current'}
              </span>
            </div>

            {skillsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>
                <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
                Checking skills...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {skills.map(sk => (
                  <div key={sk.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: colors.surfaceRaised,
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: fonts.sans,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {statusIcon(sk)}
                      <span style={{ color: colors.text }}>{sk.name}</span>
                    </div>
                    <span style={{ color: colors.textMuted, fontSize: 12 }}>{statusLabel(sk)}</span>
                  </div>
                ))}
              </div>
            )}

            {!skillsLoading && hasMissing && (
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 6,
                fontSize: 12, color: '#fca5a5', fontFamily: fonts.sans,
              }}>
                {freshCounts.missing} skill{freshCounts.missing !== 1 ? 's' : ''} have no data — those sections will show placeholder text.
              </div>
            )}
            {!skillsLoading && !hasMissing && !allFresh && (
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 6,
                fontSize: 12, color: '#fcd34d', fontFamily: fonts.sans,
              }}>
                {freshCounts.stale} skill{freshCounts.stale !== 1 ? 's are' : ' is'} stale — content will be based on older data.
              </div>
            )}
            {!skillsLoading && allFresh && (
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 6,
                fontSize: 12, color: '#86efac', fontFamily: fonts.sans,
              }}>
                All skills are current — ready to generate.
              </div>
            )}
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: '10px 12px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6,
              fontSize: 13, color: '#fca5a5', fontFamily: fonts.sans,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              disabled={generating}
              style={{
                padding: '9px 18px', fontSize: 14, fontFamily: fonts.sans, fontWeight: 500,
                background: 'transparent', color: colors.textSecondary,
                border: `1px solid ${colors.border}`, borderRadius: 6, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                padding: '9px 20px', fontSize: 14, fontFamily: fonts.sans, fontWeight: 600,
                background: isWbr ? '#0f766e' : '#c2410c',
                color: '#fff', border: 'none', borderRadius: 6, cursor: generating ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, opacity: generating ? 0.7 : 1,
              }}
            >
              {generating && <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} />}
              {generating ? 'Generating…' : `Generate ${isWbr ? 'WBR' : 'QBR'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeSince(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

interface SeededTemplate { id: string; created_from_template: string; }

export default function ReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [wbrModal, setWbrModal] = useState(false);
  const [qbrModal, setQbrModal] = useState(false);
  const [seededTemplates, setSeededTemplates] = useState<SeededTemplate[]>([]);

  const workspaceId = window.location.pathname.split('/')[2] || 'default';

  useEffect(() => {
    loadReports();
    api.get('/governance/summary')
      .then(s => setPendingCount(s?.pending_approval ?? 0))
      .catch(() => {});
    api.get('/report-templates')
      .then(d => setSeededTemplates(d?.templates || []))
      .catch(() => {});
  }, []);

  async function loadReports() {
    try {
      setLoading(true);
      const data = await api.get('/reports?limit=20');
      setReports(data.reports || []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }

  const wbrTemplateId = seededTemplates.find(t => t.created_from_template === 'wbr_standard')?.id;
  const qbrTemplateId = seededTemplates.find(t => t.created_from_template === 'qbr_standard')?.id;

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
      <IntelligenceNav activeTab="reports" pendingCount={pendingCount} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Reports</h1>
          <p style={{ fontSize: 14, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
            Automated reports delivered on your schedule
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* WBR button */}
          <button
            onClick={() => {
              if (wbrTemplateId) setWbrModal(true);
              else navigate('/reports/new?type=wbr');
            }}
            style={{
              padding: '8px 16px',
              background: '#0f766e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontFamily: fonts.sans,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
            }}
          >
            <Plus style={{ width: 15, height: 15 }} />
            WBR
          </button>
          {/* QBR button */}
          <button
            onClick={() => {
              if (qbrTemplateId) setQbrModal(true);
              else navigate('/reports/new?type=qbr');
            }}
            style={{
              padding: '8px 16px',
              background: '#c2410c',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontFamily: fonts.sans,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
            }}
          >
            <Plus style={{ width: 15, height: 15 }} />
            QBR
          </button>
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
            Reports generated by Pandora will appear here
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {reports.map((report) => (
            <ReportDocumentCard
              key={report.id}
              report={report}
              workspaceId={workspaceId}
              onView={() => navigate(`/workspace/${workspaceId}/briefing/${report.id}`)}
            />
          ))}
        </div>
      )}

      {/* WBR Modal */}
      {wbrModal && wbrTemplateId && (
        <WbrQbrGenerateModal
          workspaceId={workspaceId}
          type="wbr"
          templateId={wbrTemplateId}
          onClose={() => setWbrModal(false)}
          onSuccess={(docId) => navigate(`/workspace/${workspaceId}/briefing/${docId}`)}
        />
      )}

      {/* QBR Modal */}
      {qbrModal && qbrTemplateId && (
        <WbrQbrGenerateModal
          workspaceId={workspaceId}
          type="qbr"
          templateId={qbrTemplateId}
          onClose={() => setQbrModal(false)}
          onSuccess={(docId) => navigate(`/workspace/${workspaceId}/briefing/${docId}`)}
        />
      )}
    </div>
  );
}

function ReportDocumentCard({ report, onView }: {
  report: ReportDocument;
  workspaceId: string;
  onView: () => void;
}) {
  const meta = DOC_TYPE_META[report.document_type] || {
    label: report.document_type,
    bg: colors.surfaceRaised,
    color: colors.textSecondary,
  };
  const displayLabel = report.document_type === 'agent_run' && report.config?.agent_name
    ? report.config.agent_name
    : meta.label;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 24,
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0, fontFamily: fonts.sans }}>
              {report.week_label}
            </h3>
            <span style={{
              padding: '2px 8px',
              background: meta.bg,
              color: meta.color,
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 4,
              fontFamily: fonts.sans,
              letterSpacing: '0.02em',
            }}>
              {displayLabel}
            </span>
          </div>

          {report.headline && (
            <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16, fontFamily: fonts.sans, lineHeight: 1.5 }}>
              {report.headline}
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock style={{ width: 16, height: 16 }} />
              <span>
                Generated {new Date(report.generated_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText style={{ width: 16, height: 16 }} />
              <span>{report.sections.length} sections</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
          <button
            onClick={onView}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              color: '#fff',
              background: colors.accent,
              border: 'none',
              borderRadius: 6,
              fontWeight: 500,
              fontFamily: fonts.sans,
              cursor: 'pointer',
            }}
          >
            View
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
      sections: ['the-number', 'what-moved', 'forecast-waterfall', 'rep-performance', 'pipeline-hygiene', 'icp-fit-analysis', 'actions-summary'],
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
            <div style={{ marginBottom: 12 }}>
              <AvatarDisplay value={template.icon} size={40} fallbackEmoji={template.icon} borderRadius={8} />
            </div>
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

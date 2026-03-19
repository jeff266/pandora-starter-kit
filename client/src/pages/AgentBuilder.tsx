import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, getWorkspaceId } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';
import { ChevronLeft, Plus, X, GripVertical, Save, Zap, Play, Loader2, Pencil } from 'lucide-react';
import LearnedPreferences from '../components/agents/LearnedPreferences';
import RunHistoryPanel from '../components/agents/RunHistoryPanel';
import GuidedAgentChat from '../components/agents/GuidedAgentChat';
import IssueTreeEditor from '../components/agents/IssueTreeEditor';
import SaveAsAgentModal from '../components/SaveAsAgentModal';
import { usePermissions } from '../hooks/usePermissions';
import AgentCopilot from '../components/copilot/AgentCopilot';
import AvatarPicker from '../components/avatars/AvatarPicker';
import AvatarDisplay from '../components/avatars/AvatarDisplay';
import { AVATAR_GALLERY } from '../components/avatars/avatar-data';
import IntelligenceNav from '../components/IntelligenceNav';
import { suggestSkills as staticSuggestSkills } from '../components/copilot/copilot-steps';
import { useSystemAvatars } from '../context/SystemAvatarContext';

interface AudienceConfig {
  role: string;
  detail_preference: 'executive' | 'manager' | 'analyst';
  vocabulary_avoid?: string[];
  vocabulary_prefer?: string[];
}

interface DataWindowConfig {
  primary: string;
  comparison: string;
}

interface ScheduleConfig {
  type: 'cron' | 'event_prep' | 'manual';
  cron?: string;
  prep_days_before?: number;
  event_dates?: string[];
  event_name?: string;
}

interface BriefingConfig {
  audience: AudienceConfig;
  focus_questions: string[];
  data_window: DataWindowConfig;
  output_formats: string[];
  skills: string[];
  schedule: ScheduleConfig;
}

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  defaults: BriefingConfig;
  prep_agent?: any;
  is_system: boolean;
}

interface Agent {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  skill_ids: string[];
  template_id: string | null;
  is_active: boolean;
  is_builtin?: boolean;
  audience: AudienceConfig;
  focus_questions: string[];
  data_window: DataWindowConfig;
  output_formats: string[];
  scope_filters?: string[];
  event_config: any;
  created_at: string;
}

const AUDIENCE_ROLES = ['VP Sales', 'CRO', 'Board of Directors', 'Sales Manager', 'CRO + VP Sales', 'Revenue Operations'];
const DETAIL_LEVELS: { value: AudienceConfig['detail_preference']; label: string; desc: string }[] = [
  { value: 'executive', label: 'Executive', desc: 'High-level strategic view' },
  { value: 'manager', label: 'Manager', desc: 'Actionable with deal-level detail' },
  { value: 'analyst', label: 'Analyst', desc: 'Full data with metrics tables' },
];
const DATA_WINDOWS: { value: string; label: string }[] = [
  { value: 'current_week', label: 'This Week' },
  { value: 'current_month', label: 'This Month' },
  { value: 'current_quarter', label: 'This Quarter' },
  { value: 'trailing_30d', label: 'Trailing 30 Days' },
  { value: 'trailing_90d', label: 'Trailing 90 Days' },
  { value: 'fiscal_year', label: 'Fiscal Year' },
];
const COMPARISONS: { value: string; label: string }[] = [
  { value: 'previous_period', label: 'Previous Period' },
  { value: 'same_period_last_year', label: 'Same Period Last Year' },
  { value: 'none', label: 'No Comparison' },
];
const FORMAT_OPTIONS = ['pdf', 'docx', 'pptx', 'slack', 'email'];
const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: 'Monday 7am', cron: '0 7 * * 1' },
  { label: 'Thursday 4pm', cron: '0 16 * * 4' },
  { label: 'Friday 5pm', cron: '0 17 * * 5' },
  { label: 'Daily 8am', cron: '0 8 * * *' },
  { label: 'Daily 6pm', cron: '0 18 * * *' },
];

type ViewState = 'gallery' | 'builder' | 'list' | 'copilot';
type BuilderTab = 'audience' | 'goals' | 'skills' | 'data_window' | 'scope' | 'schedule' | 'formats' | 'structure';

interface NamedFilterOption {
  id: string;
  label: string;
  description?: string;
  entity_types: string[];
  confirmed: boolean;
}

export default function AgentBuilder() {
  const { canRunSkills } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewState>('list');
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<BuilderTab>('audience');
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState(AVATAR_GALLERY[0].src);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [audience, setAudience] = useState<AudienceConfig>({ role: 'VP Sales', detail_preference: 'manager' });
  const [focusQuestions, setFocusQuestions] = useState<string[]>([]);
  const [goal, setGoal] = useState('');
  const [standingQuestions, setStandingQuestions] = useState<string[]>([]);
  const [standingQInput, setStandingQInput] = useState('');
  const [dataWindow, setDataWindow] = useState<DataWindowConfig>({ primary: 'current_week', comparison: 'previous_period' });
  const [outputFormats, setOutputFormats] = useState<string[]>(['slack']);
  const [skills, setSkills] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleConfig>({ type: 'cron', cron: '0 7 * * 1' });
  const [vocabAvoidInput, setVocabAvoidInput] = useState('');
  const [vocabPreferInput, setVocabPreferInput] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [scopeFilters, setScopeFilters] = useState<string[]>([]);
  const [availableFilters, setAvailableFilters] = useState<NamedFilterOption[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [allSkills, setAllSkills] = useState<Array<{ id: string; name: string }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [runHistoryKey, setRunHistoryKey] = useState(0);
  const [issueTreeKey, setIssueTreeKey] = useState(0);

  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [aiSuggestedQuestions, setAiSuggestedQuestions] = useState<Array<{ text: string; rationale: string; suggested_skills: string[] }>>([]);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);

  const [generatingSections, setGeneratingSections] = useState(false);
  const [suggestedSections, setSuggestedSections] = useState<any[]>([]);
  const [showSectionPreview, setShowSectionPreview] = useState(false);

  const [suggestedSkills, setSuggestedSkills] = useState<{ skill_id: string; reason: string }[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const lastSuggestionKey = useRef<string>('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [guidedChatOpen, setGuidedChatOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [modalExtraction, setModalExtraction] = useState<any>(null);
  const [modalConversationId, setModalConversationId] = useState<string | null>(null);

  const [useIssueTree, setUseIssueTree] = useState(false);
  const [seedConversationId, setSeedConversationId] = useState<string | null>(null);
  const [fromChat, setFromChat] = useState(false);
  const [systemPickerOpen, setSystemPickerOpen] = useState<'pandora' | 'bull' | 'bear' | null>(null);
  const { pandoraSrc, bullSrc, bearSrc, updateAvatar } = useSystemAvatars();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      api.get('/governance/summary').then(s => setPendingCount(s?.pending_approval ?? 0)).catch(() => {});
      const [templatesRes, agentsRes, filtersRes, skillsRes] = await Promise.all([
        api.get('/agent-templates'),
        api.get('/agents-v2'),
        api.get('/filters').catch(() => ({ filters: [] })),
        api.get('/skills/dashboard').catch(() => ({ skills: [] })),
      ]);
      setTemplates(templatesRes.templates || []);
      setAgents(agentsRes || []);
      setAvailableFilters((filtersRes.filters || []).map((f: any) => ({
        id: f.id,
        label: f.label,
        description: f.description,
        entity_types: f.entity_types || [],
        confirmed: f.confirmed ?? false,
      })));
      setAllSkills((skillsRes.skills || []).map((s: any) => ({ id: s.id, name: s.name })));
    } catch (err) {
      console.error('Failed to load agent data:', err);
    } finally {
      setLoading(false);
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const prefill = location.state?.chatPrefill;
    const threadId = location.state?.threadId;
    if (!prefill) return;
    setSelectedTemplate(null);
    setName(prefill.suggested_name || '');
    setDescription(prefill.goal || '');
    setIcon(AVATAR_GALLERY[0].src);
    setGoal(prefill.goal || '');
    setStandingQuestions(prefill.standing_questions || []);
    setSkills(prefill.detected_skills || []);
    setOutputFormats(prefill.suggested_delivery?.format ? [prefill.suggested_delivery.format] : ['slack']);
    setSchedule(
      prefill.suggested_schedule?.cron
        ? { type: 'cron', cron: prefill.suggested_schedule.cron }
        : { type: 'manual' }
    );
    setScopeFilters([]);
    setFocusQuestions([]);
    setDataWindow({ primary: 'current_week', comparison: 'previous_period' });
    setAudience({ role: 'VP Sales', detail_preference: 'manager' });
    setEditingAgentId(null);
    setSeedConversationId(threadId || null);
    setFromChat(true);
    setView('builder');
    setActiveTab('goals');
  }, []);  

  useEffect(() => {
    if (activeTab !== 'skills') return;
    const key = `${goal}||${standingQuestions.join('|')}`;
    if (!goal && standingQuestions.length === 0) {
      setSuggestedSkills([]);
      return;
    }
    if (key === lastSuggestionKey.current) return;
    lastSuggestionKey.current = key;

    const staticIds = staticSuggestSkills(standingQuestions.length > 0 ? standingQuestions : goal ? [goal] : []);
    setSuggestedSkills(staticIds.map(id => ({ skill_id: id, reason: '' })));
    setSuggestionsLoading(true);

    api.post('/agents/suggest-skills', { goal, standing_questions: standingQuestions })
      .then((res: any) => {
        if (res.suggested?.length > 0) {
          setSuggestedSkills(res.suggested);
        }
      })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [activeTab, goal, standingQuestions]);

  function populateFromTemplate(t: AgentTemplate) {
    setSelectedTemplate(t);
    setName(t.name);
    setDescription(t.description);
    setIcon(t.icon);
    setAudience(t.defaults.audience);
    setFocusQuestions([...t.defaults.focus_questions]);
    setDataWindow(t.defaults.data_window);
    setOutputFormats([...t.defaults.output_formats]);
    setSkills([...t.defaults.skills]);
    setSchedule(t.defaults.schedule);
    setScopeFilters((t.defaults as any).scope_filters || []);
    setEditingAgentId(null);
    setView('builder');
    setActiveTab('audience');
  }

  function populateFromAgent(a: Agent) {
    setSelectedTemplate(null);
    setName(a.name);
    setDescription(a.description || '');
    setIcon(a.icon);
    setAudience(a.audience?.role ? a.audience : { role: 'VP Sales', detail_preference: 'manager' });
    setFocusQuestions(a.focus_questions || []);
    setGoal((a as any).goal || '');
    setStandingQuestions((a as any).standing_questions || []);
    setDataWindow(a.data_window?.primary ? a.data_window : { primary: 'current_week', comparison: 'previous_period' });
    setOutputFormats(a.output_formats || ['slack']);
    setSkills(a.skill_ids || []);
    setScopeFilters(a.scope_filters || []);
    setSchedule({ type: 'manual' });
    setUseIssueTree(!!(a as any).use_issue_tree);
    setEditingAgentId(a.id);
    setSeedConversationId((a as any).seed_conversation_id ?? null);
    setFromChat(false);
    setView('builder');
    setActiveTab('audience');
  }

  function startBlank() {
    setSelectedTemplate(null);
    setName('');
    setDescription('');
    setIcon('🤖');
    setAudience({ role: 'VP Sales', detail_preference: 'manager' });
    setFocusQuestions([]);
    setGoal('');
    setStandingQuestions([]);
    setUseIssueTree(false);
    setDataWindow({ primary: 'current_week', comparison: 'previous_period' });
    setOutputFormats(['slack']);
    setSkills([]);
    setScopeFilters([]);
    setSchedule({ type: 'manual' });
    setEditingAgentId(null);
    setView('builder');
    setActiveTab('audience');
  }

  async function handleSave() {
    setSaving(true);
    try {
      const audiencePayload = {
        ...audience,
        vocabulary_avoid: audience.vocabulary_avoid?.length ? audience.vocabulary_avoid : undefined,
        vocabulary_prefer: audience.vocabulary_prefer?.length ? audience.vocabulary_prefer : undefined,
      };

      if (editingAgentId) {
        await api.patch(`/agents-v2/${editingAgentId}`, {
          name,
          description,
          icon,
          skill_ids: skills,
          audience: audiencePayload,
          focus_questions: focusQuestions,
          data_window: dataWindow,
          output_formats: outputFormats,
          scope_filters: scopeFilters,
          goal: goal || undefined,
          standing_questions: standingQuestions.length > 0 ? standingQuestions : undefined,
          event_config: schedule.type === 'event_prep' ? {
            event_name: schedule.event_name,
            prep_days_before: schedule.prep_days_before,
            event_dates: schedule.event_dates,
          } : null,
        });
      } else if (selectedTemplate) {
        await api.post('/agents/from-template', {
          template_id: selectedTemplate.id,
          overrides: {
            name: name !== selectedTemplate.name ? name : undefined,
            audience: audiencePayload,
            focus_questions: focusQuestions,
            data_window: dataWindow,
            output_formats: outputFormats,
            scope_filters: scopeFilters,
            skills,
            schedule,
          },
        });
      } else {
        await api.post('/agents-v2', {
          name: name || 'New Agent',
          description,
          icon,
          skill_ids: skills.length > 0 ? skills : ['pipeline-hygiene'],
          trigger_config: { type: schedule.type === 'event_prep' ? 'cron' : schedule.type, schedule: schedule.cron },
          filter_config: { severities: ['critical', 'warning'], max_findings: 20 },
          audience: audiencePayload,
          focus_questions: focusQuestions,
          data_window: dataWindow,
          output_formats: outputFormats,
          scope_filters: scopeFilters,
          goal: goal || undefined,
          standing_questions: standingQuestions.length > 0 ? standingQuestions : undefined,
          created_from: seedConversationId ? 'conversation' : undefined,
          seed_conversation_id: seedConversationId || undefined,
          event_config: schedule.type === 'event_prep' ? {
            event_name: schedule.event_name,
            prep_days_before: schedule.prep_days_before,
            event_dates: schedule.event_dates,
          } : null,
        });
      }
      await loadData();
      setView('list');
    } catch (err: any) {
      console.error('Save failed:', err);
      alert(err.message || 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (!editingAgentId) return;
    setIsGenerating(true);
    setLastRunStatus(null);
    try {
      const res = await api.post(`/agents/${editingAgentId}/run`, {});
      setLastRunStatus(`Run complete (ID: ${res.runId || res.run_id || ''})`);
      setRunHistoryKey(k => k + 1);
    } catch (err: any) {
      setLastRunStatus(`Error: ${err.message || 'Run failed'}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function addVocabAvoid() {
    const term = vocabAvoidInput.trim();
    if (!term) return;
    setAudience(prev => ({
      ...prev,
      vocabulary_avoid: [...(prev.vocabulary_avoid || []), term],
    }));
    setVocabAvoidInput('');
  }

  function removeVocabAvoid(idx: number) {
    setAudience(prev => ({
      ...prev,
      vocabulary_avoid: (prev.vocabulary_avoid || []).filter((_, i) => i !== idx),
    }));
  }

  function addVocabPrefer() {
    const term = vocabPreferInput.trim();
    if (!term) return;
    setAudience(prev => ({
      ...prev,
      vocabulary_prefer: [...(prev.vocabulary_prefer || []), term],
    }));
    setVocabPreferInput('');
  }

  function removeVocabPrefer(idx: number) {
    setAudience(prev => ({
      ...prev,
      vocabulary_prefer: (prev.vocabulary_prefer || []).filter((_, i) => i !== idx),
    }));
  }

  function addQuestion() {
    const q = newQuestion.trim();
    if (!q || focusQuestions.length >= 8) return;
    setFocusQuestions(prev => [...prev, q]);
    setNewQuestion('');
  }

  function removeQuestion(idx: number) {
    setFocusQuestions(prev => prev.filter((_, i) => i !== idx));
  }

  if (loading) {
    return (
      <div style={{ padding: 32 }}>
        <Skeleton width="200px" height="28px" />
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} height="180px" />)}
        </div>
      </div>
    );
  }

  // ─── Agent List View ──────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <IntelligenceNav activeTab="agents" pendingCount={pendingCount} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ font: `600 22px ${fonts.sans}`, color: colors.text, margin: 0 }}>Agent Builder</h1>
            <p style={{ font: `400 14px ${fonts.sans}`, color: colors.textSecondary, margin: '4px 0 0' }}>
              Configure AI agents that produce editorial briefings for your team
            </p>
          </div>
          <button onClick={() => setPickerOpen(true)} style={btnPrimary}>
            <Plus size={16} /> New Agent
          </button>
        </div>

        {(() => {
          const builtInAgents = agents.filter((a: any) => a.is_builtin);
          const userAgents = agents.filter((a: any) => !a.is_builtin);

          const renderAgentCard = (a: Agent, readonly = false) => (
            <div
              key={a.id}
              onClick={() => !readonly && populateFromAgent(a)}
              style={{ ...card, cursor: readonly ? 'default' : 'pointer', opacity: readonly ? 0.92 : 1 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <AvatarDisplay value={a.icon} size={36} fallbackEmoji={a.icon} borderRadius={8} />
                <div style={{ flex: 1 }}>
                  <div style={{ font: `500 15px ${fonts.sans}`, color: colors.text }}>{a.name}</div>
                  {a.template_id && (
                    <div style={{ font: `400 11px ${fonts.sans}`, color: colors.accent, marginTop: 2 }}>
                      From template
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {readonly && (
                    <div style={{
                      padding: '2px 8px', borderRadius: 9999, font: `500 11px ${fonts.sans}`,
                      background: colors.surfaceHover, color: colors.textMuted,
                      border: `1px solid ${colors.border}`,
                    }}>
                      System
                    </div>
                  )}
                  <div style={{
                    padding: '2px 8px', borderRadius: 9999, font: `500 11px ${fonts.sans}`,
                    background: a.is_active ? colors.greenSoft : colors.surfaceHover,
                    color: a.is_active ? colors.green : colors.textMuted,
                  }}>
                    {a.is_active ? 'Active' : 'Draft'}
                  </div>
                </div>
              </div>
              {a.description && (
                <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textSecondary, margin: '0 0 12px', lineHeight: 1.4 }}>
                  {a.description}
                </p>
              )}
              {(a as any).goal && (
                <p style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted, margin: '0 0 8px', lineHeight: 1.4, fontStyle: 'italic' }}>
                  Goal: {(a as any).goal}
                </p>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {a.audience?.role && <span style={badge}>{a.audience.role}</span>}
                <span style={{ ...badge, background: colors.purpleSoft, color: colors.purple }}>{a.skill_ids?.length || 0} skills</span>
                {(a as any).standing_questions?.length > 0 && (
                  <span style={{ ...badge, background: colors.accentSoft, color: colors.accent }}>{(a as any).standing_questions.length} questions</span>
                )}
                {(a as any).created_from === 'conversation' && (
                  <span style={{ ...badge, background: '#1a2a1a', color: '#4ade80' }}>from chat</span>
                )}
                {(a.output_formats || []).map(f => <span key={f} style={{ ...badge, background: colors.surfaceHover, color: colors.textSecondary }}>{f}</span>)}
              </div>
            </div>
          );

          const systemChars: { role: 'pandora' | 'bull' | 'bear'; label: string; desc: string; src: string; color: string }[] = [
            { role: 'pandora', label: 'Pandora', desc: 'Your RevOps AI concierge — appears in chat and briefings', src: pandoraSrc, color: '#6488ea' },
            { role: 'bull',    label: 'Bull Case', desc: 'Argues why the deal will close in Bull/Bear deliberations', src: bullSrc,    color: '#14b8a6' },
            { role: 'bear',    label: 'Bear Case', desc: 'Argues why the deal won\'t close in Bull/Bear deliberations', src: bearSrc,   color: '#f97068' },
          ];

          return (
            <>
              <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <h3 style={{ font: `600 13px ${fonts.sans}`, color: colors.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Pandora Characters
                  </h3>
                  <div style={{ flex: 1, height: 1, background: colors.border }} />
                  <span style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted }}>
                    Avatars shared across all workspaces
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                  {systemChars.map(({ role, label, desc, src, color }) => (
                    <div key={role} style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 12,
                      padding: '16px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <img
                          src={src}
                          alt={label}
                          style={{ width: 52, height: 52, borderRadius: 10, imageRendering: 'pixelated', objectFit: 'cover', display: 'block' }}
                        />
                        <button
                          onClick={() => setSystemPickerOpen(role)}
                          title="Change avatar"
                          style={{
                            position: 'absolute', bottom: -4, right: -4,
                            width: 20, height: 20, borderRadius: 9999,
                            background: colors.surface, border: `1px solid ${colors.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', padding: 0,
                          }}
                        >
                          <Pencil size={10} color={colors.textMuted} />
                        </button>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ font: `600 14px ${fonts.sans}`, color: colors.text }}>{label}</span>
                          <span style={{
                            padding: '1px 7px', borderRadius: 9999,
                            font: `500 10px ${fonts.sans}`,
                            background: color + '22', color,
                            border: `1px solid ${color}44`,
                          }}>character</span>
                        </div>
                        <p style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, margin: 0, lineHeight: 1.4 }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {builtInAgents.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <h3 style={{ font: `600 13px ${fonts.sans}`, color: colors.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      System Agents
                    </h3>
                    <div style={{ flex: 1, height: 1, background: colors.border }} />
                    <span style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted }}>
                      Managed by Pandora · read-only
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                    {builtInAgents.map(a => renderAgentCard(a, true))}
                  </div>
                </div>
              )}

              {userAgents.length > 0 && (
                <div>
                  {builtInAgents.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <h3 style={{ font: `600 13px ${fonts.sans}`, color: colors.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Custom Agents
                      </h3>
                      <div style={{ flex: 1, height: 1, background: colors.border }} />
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                    {userAgents.map(a => renderAgentCard(a, false))}
                  </div>
                </div>
              )}

              {agents.length === 0 && (
                <div style={{ ...card, textAlign: 'center', padding: 48 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
                  <h3 style={{ font: `500 16px ${fonts.sans}`, color: colors.text, margin: '0 0 8px' }}>No agents yet</h3>
                  <p style={{ font: `400 14px ${fonts.sans}`, color: colors.textSecondary, margin: '0 0 20px' }}>
                    Create your first agent from a template or start from scratch
                  </p>
                  <button onClick={() => setPickerOpen(true)} style={btnPrimary}>
                    <Plus size={16} /> Create Agent
                  </button>
                </div>
              )}
            </>
          );
        })()}

        {/* ─── System Character Avatar Picker ─── */}
        {systemPickerOpen && (
          <AvatarPicker
            currentValue={
              systemPickerOpen === 'pandora' ? pandoraSrc :
              systemPickerOpen === 'bull'    ? bullSrc    : bearSrc
            }
            onSelect={src => updateAvatar(systemPickerOpen, src)}
            onClose={() => setSystemPickerOpen(null)}
          />
        )}

        {/* ─── Creation Path Picker Modal ─── */}
      {pickerOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1050,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }} onClick={e => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            padding: 28,
            width: '100%', maxWidth: 540,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ font: `600 16px ${fonts.sans}`, color: colors.text }}>
                How do you want to build this Agent?
              </div>
              <button onClick={() => setPickerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 2 }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Conversation path */}
              <div
                onClick={() => { setPickerOpen(false); setGuidedChatOpen(true); }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = colors.accent;
                  (e.currentTarget as HTMLElement).style.background = 'rgba(20,184,166,0.05)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = colors.border;
                  (e.currentTarget as HTMLElement).style.background = colors.surfaceRaised;
                }}
                style={{
                  background: colors.surfaceRaised,
                  border: `1.5px solid ${colors.border}`,
                  borderRadius: 10, padding: 18, cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ fontSize: 28 }}>💬</div>
                <div>
                  <div style={{ font: `600 14px ${fonts.sans}`, color: colors.text, marginBottom: 4 }}>
                    Start from conversation
                  </div>
                  <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.5 }}>
                    Tell Pandora what you want. It figures out the rest.
                  </div>
                </div>
                <div style={{ font: `400 11px ${fonts.sans}`, color: colors.textMuted, marginTop: 'auto' }}>
                  Best for: "I want a weekly pipeline review"
                </div>
              </div>

              {/* Manual path */}
              <div
                onClick={() => { setPickerOpen(false); setView('copilot'); }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = colors.textMuted;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = colors.border;
                }}
                style={{
                  background: colors.surfaceRaised,
                  border: `1.5px solid ${colors.border}`,
                  borderRadius: 10, padding: 18, cursor: 'pointer',
                  transition: 'border-color 0.15s',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ fontSize: 28 }}>⚙️</div>
                <div>
                  <div style={{ font: `600 14px ${fonts.sans}`, color: colors.text, marginBottom: 4 }}>
                    Build manually
                  </div>
                  <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.5 }}>
                    Pick skills, set schedule, configure delivery yourself.
                  </div>
                </div>
                <div style={{ font: `400 11px ${fonts.sans}`, color: colors.textMuted, marginTop: 'auto' }}>
                  Best for: power users who know exactly what they need.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Guided Agent Chat ─── */}
      {guidedChatOpen && (
        <GuidedAgentChat
          workspaceId={getWorkspaceId()}
          onReadyToSave={(result, convId) => {
            setGuidedChatOpen(false);
            setModalExtraction(result);
            setModalConversationId(convId);
            setAgentModalOpen(true);
          }}
          onClose={() => setGuidedChatOpen(false)}
        />
      )}

      {/* ─── Save as Agent Modal (from guided flow) ─── */}
      {agentModalOpen && modalExtraction && (
        <SaveAsAgentModal
          extraction={modalExtraction}
          threadId={modalConversationId || ''}
          onSave={(_agentId: string, _agentName: string) => {
            setAgentModalOpen(false);
            loadData();
          }}
          onClose={() => setAgentModalOpen(false)}
        />
      )}
    </div>
    );
  }

  // ─── Copilot View ───────────────────────────────────────────────
  if (view === 'copilot') {
    const wsId = getWorkspaceId();
    return (
      <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <button onClick={() => setView('list')} style={btnBack}>
          <ChevronLeft size={16} /> Back to Agents
        </button>
        <div style={{ marginTop: 16 }}>
          <AgentCopilot
            workspaceId={wsId}
            onAgentCreated={() => {
              loadData();
              setView('list');
            }}
            onSwitchToManual={() => setView('gallery')}
          />
        </div>
      </div>
    );
  }

  // ─── Template Gallery ─────────────────────────────────────────────
  if (view === 'gallery') {
    return (
      <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <IntelligenceNav activeTab="agents" pendingCount={pendingCount} />
        <button onClick={() => setView('list')} style={btnBack}>
          <ChevronLeft size={16} /> Back to Agents
        </button>
        <h1 style={{ font: `600 22px ${fonts.sans}`, color: colors.text, margin: '16px 0 4px' }}>Choose a Template</h1>
        <p style={{ font: `400 14px ${fonts.sans}`, color: colors.textSecondary, margin: '0 0 24px' }}>
          Start with a pre-configured template and customize it, or build from scratch
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {templates.map(t => (
            <div key={t.id} onClick={() => populateFromTemplate(t)} style={{ ...card, cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
            >
              <div style={{ marginBottom: 12 }}>
                <AvatarDisplay value={t.icon} size={40} fallbackEmoji={t.icon} borderRadius={8} />
              </div>
              <h3 style={{ font: `500 16px ${fonts.sans}`, color: colors.text, margin: '0 0 6px' }}>{t.name}</h3>
              <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textSecondary, margin: '0 0 14px', lineHeight: 1.5 }}>
                {t.description}
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={badge}>{t.defaults.audience.role}</span>
                <span style={{ ...badge, background: colors.purpleSoft, color: colors.purple }}>
                  {t.defaults.skills.length} skills
                </span>
                {t.prep_agent && (
                  <span style={{ ...badge, background: colors.yellowSoft, color: colors.yellow }}>Prep agent</span>
                )}
              </div>
            </div>
          ))}

          <div onClick={startBlank} style={{ ...card, cursor: 'pointer', borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 180 }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
          >
            <Plus size={32} style={{ color: colors.textMuted, marginBottom: 12 }} />
            <h3 style={{ font: `500 16px ${fonts.sans}`, color: colors.text, margin: '0 0 4px' }}>Blank Agent</h3>
            <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textSecondary, margin: 0 }}>Start from scratch</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Builder View ─────────────────────────────────────────────────
  const tabs: { key: BuilderTab; label: string }[] = [
    { key: 'audience', label: 'Audience' },
    { key: 'goals', label: 'Goals' },
    { key: 'skills', label: 'Skills' },
    { key: 'data_window', label: 'Data Window' },
    { key: 'scope', label: 'Scope Filters' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'formats', label: 'Output Formats' },
    ...(editingAgentId ? [{ key: 'structure' as BuilderTab, label: 'Report Structure' }] : []),
  ];

  const SKILL_QUESTION_SUGGESTIONS: Record<string, string[]> = {
    'forecast-rollup': [
      'What is the current base case and gap to quota?',
      'Which deals changed forecast category this week?',
    ],
    'pipeline-hygiene': [
      'Which deals are stale or missing required fields?',
    ],
    'rep-scorecard': [
      'Which reps are behind on coverage or attainment?',
    ],
    'single-thread-alert': [
      'Which enterprise deals have only one contact?',
    ],
    'data-quality': [
      'What is the current data quality score by field?',
    ],
    'pipeline-coverage': [
      'Is pipeline coverage above 3x for the current quarter?',
    ],
  };

  const suggestedQuestions = Array.from(
    new Set(skills.flatMap(s => SKILL_QUESTION_SUGGESTIONS[s] || []))
  ).filter(q => !standingQuestions.includes(q));

  function getSkillName(skillId: string): string {
    const found = allSkills.find(s => s.id === skillId);
    if (found) return found.name;
    return skillId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function addQuestionFromSuggestion(text: string) {
    if (standingQuestions.length < 5 && !standingQuestions.includes(text)) {
      setStandingQuestions(prev => [...prev, text]);
      setFocusQuestions(prev => [...prev, text]);
    }
  }

  async function handleGenerateQuestions() {
    if (!editingAgentId) return;
    setGeneratingQuestions(true);
    setShowAiSuggestions(false);
    try {
      const data = await api.post(`/agents/${editingAgentId}/generate-questions`, { goal });
      setAiSuggestedQuestions(data.questions || []);
      setShowAiSuggestions(true);
    } catch (err) {
      console.error('Question generation failed:', err);
    } finally {
      setGeneratingQuestions(false);
    }
  }

  async function handleGenerateSections() {
    if (!editingAgentId) return;
    setGeneratingSections(true);
    try {
      const data = await api.post(`/agents/${editingAgentId}/generate-sections`, {
        goal,
        questions: standingQuestions,
      });
      setSuggestedSections(data.sections || []);
      setShowSectionPreview(true);
    } catch (err) {
      console.error('Section generation failed:', err);
    } finally {
      setGeneratingSections(false);
    }
  }

  async function handleSaveGeneratedSections() {
    if (!editingAgentId) return;
    for (const section of suggestedSections) {
      await api.post(`/agents/${editingAgentId}/issue-tree`, {
        title: section.title,
        standing_question: section.standing_question,
        mece_category: section.section_intent,
        primary_skill_ids: section.primary_skill_ids,
        position: section.position,
        section_intent: section.section_intent,
        action_format: section.action_format,
        data_extraction_config: section.data_extraction_config,
        reasoning_layers: section.reasoning_layers,
      });
    }
    setIssueTreeKey(k => k + 1);
    setShowSectionPreview(false);
    setSuggestedSections([]);
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <IntelligenceNav activeTab="agents" pendingCount={pendingCount} />
      <button onClick={() => setView('list')} style={btnBack}>
        <ChevronLeft size={16} /> Back to Agents
      </button>

      {selectedTemplate && (
        <div style={{ ...badge, marginTop: 12, background: colors.accentSoft, color: colors.accent, fontSize: 12, padding: '4px 10px' }}>
          Based on {selectedTemplate.name}
        </div>
      )}

      {fromChat && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 12, marginBottom: 4,
          background: colors.accentSoft,
          border: `1px solid ${colors.accent}33`,
          borderRadius: 8,
          padding: '8px 12px',
          gap: 8,
        }}>
          <span style={{ fontSize: 12, color: colors.accent }}>
            ✦ Pre-filled from your Ask Pandora conversation — review and adjust below
          </span>
          <button
            onClick={() => setFromChat(false)}
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {seedConversationId && (
        <div style={{ marginTop: fromChat ? 4 : 12, marginBottom: 4 }}>
          <button
            onClick={() => navigate('/', { state: { openChatSession: seedConversationId } })}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 12, color: colors.accent, display: 'flex', alignItems: 'center', gap: 5,
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 14 }}>💬</span>
            <span style={{ textDecoration: 'underline' }}>View originating Ask Pandora conversation →</span>
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 24px' }}>
        <button
          onClick={() => setShowIconPicker(true)}
          style={{
            background: 'none',
            border: `2px dashed ${colors.border}`,
            borderRadius: 10,
            padding: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Change avatar"
        >
          <AvatarDisplay value={icon} size={40} fallbackEmoji={icon} borderRadius={8} />
        </button>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Agent name"
          style={{ ...input, flex: 1, font: `600 20px ${fonts.sans}`, background: 'transparent', border: 'none', padding: 0, color: colors.text }}
        />
        {editingAgentId && canRunSkills && (
          <button onClick={handleRunNow} disabled={isGenerating} style={{
            ...btnPrimary,
            opacity: isGenerating ? 0.6 : 1,
            cursor: isGenerating ? 'not-allowed' : 'pointer',
          }}>
            {isGenerating ? (
              <>
                <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
                Generating...
              </>
            ) : (
              <>
                <Play style={{ width: 16, height: 16 }} />
                Run Now
              </>
            )}
          </button>
        )}
      </div>

      {lastRunStatus && (
        <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12, fontFamily: fonts.sans }}>
          {lastRunStatus}
        </div>
      )}

      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description..."
        style={{ ...input, width: '100%', marginBottom: 24 }}
      />

      {/* Goal Header — shown when editing an agent that has a goal */}
      {editingAgentId && goal && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 20,
        }}>
          <div style={{ font: `500 11px ${fonts.sans}`, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Goal</div>
          <div style={{ font: `400 14px ${fonts.sans}`, color: colors.text, lineHeight: 1.5 }}>{goal}</div>
          {standingQuestions.length > 0 && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
              <div style={{ font: `500 11px ${fonts.sans}`, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Standing Questions ({standingQuestions.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.7 }}>
                {standingQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}


      {/* Run History Panel */}
      {editingAgentId && (
        <div style={{ marginBottom: 24 }}>
          <RunHistoryPanel
            key={`${editingAgentId}-${runHistoryKey}`}
            agentId={editingAgentId}
            onRetry={() => handleRunNow()}
          />
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${colors.border}`, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            font: `500 13px ${fonts.sans}`,
            color: activeTab === t.key ? colors.accent : colors.textSecondary,
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 16px',
            borderBottom: activeTab === t.key ? `2px solid ${colors.accent}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Audience Tab ────────────────────────────── */}
      {activeTab === 'audience' && (
        <div>
          <SectionLabel>Role</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {AUDIENCE_ROLES.map(r => (
              <button key={r} onClick={() => { setAudience(prev => ({ ...prev, role: r })); setCustomRole(''); }} style={{
                ...chipBtn,
                ...(audience.role === r ? chipBtnActive : {}),
              }}>
                {r}
              </button>
            ))}
            <input
              value={customRole}
              onChange={e => { setCustomRole(e.target.value); setAudience(prev => ({ ...prev, role: e.target.value })); }}
              placeholder="Custom role..."
              style={{ ...input, width: 140 }}
            />
          </div>

          <SectionLabel>Detail Level</SectionLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {DETAIL_LEVELS.map(d => (
              <button key={d.value} onClick={() => setAudience(prev => ({ ...prev, detail_preference: d.value }))} style={{
                ...card, cursor: 'pointer', flex: 1, padding: '12px 16px', textAlign: 'left',
                borderColor: audience.detail_preference === d.value ? colors.accent : colors.border,
              }}>
                <div style={{ font: `500 14px ${fonts.sans}`, color: colors.text }}>{d.label}</div>
                <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, marginTop: 2 }}>{d.desc}</div>
              </button>
            ))}
          </div>

          <SectionLabel>Vocabulary to Avoid</SectionLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={vocabAvoidInput} onChange={e => setVocabAvoidInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addVocabAvoid()}
              placeholder="e.g. MEDDPICC, single-thread" style={{ ...input, flex: 1 }} />
            <button onClick={addVocabAvoid} style={btnSmall}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {(audience.vocabulary_avoid || []).map((t, i) => (
              <span key={i} style={{ ...tag, background: colors.redSoft, color: colors.red }}>
                {t} <X size={12} style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => removeVocabAvoid(i)} />
              </span>
            ))}
          </div>

          <SectionLabel>Vocabulary to Prefer</SectionLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={vocabPreferInput} onChange={e => setVocabPreferInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addVocabPrefer()}
              placeholder="e.g. revenue, attainment" style={{ ...input, flex: 1 }} />
            <button onClick={addVocabPrefer} style={btnSmall}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(audience.vocabulary_prefer || []).map((t, i) => (
              <span key={i} style={{ ...tag, background: colors.greenSoft, color: colors.green }}>
                {t} <X size={12} style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => removeVocabPrefer(i)} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ─── Goals Tab ───────────────────────────────── */}
      {activeTab === 'goals' && (
        <div>
          <SectionLabel>Goal <span style={{ color: colors.textMuted, fontWeight: 400 }}>(optional but recommended)</span></SectionLabel>
          <p style={{ margin: '0 0 8px', font: `400 12px ${fonts.sans}`, color: colors.textSecondary }}>
            What business outcome is this Agent working toward?
          </p>
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value.slice(0, 200))}
            placeholder="Ensure pipeline is healthy and on track to hit Q1 quota of $2.1M"
            rows={3}
            style={{ ...input, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 8 }}
          />

          {goal.length >= 20 && editingAgentId && (
            <button
              onClick={handleGenerateQuestions}
              disabled={generatingQuestions}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '6px 12px',
                background: generatingQuestions ? 'transparent' : '#F0FDF9',
                border: '1px solid #0D9488',
                borderRadius: 6,
                color: '#0D9488',
                cursor: generatingQuestions ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                marginTop: 8,
                transition: 'opacity 0.15s',
              }}
            >
              {generatingQuestions ? 'Thinking...' : '✦ Suggest questions'}
            </button>
          )}

          {showAiSuggestions && aiSuggestedQuestions.length > 0 && (
            <div style={{
              marginTop: 12,
              padding: '14px 16px',
              background: '#FAFAFA',
              border: '0.5px solid #E2E8F0',
              borderRadius: 8,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748B',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}>
                  Suggested questions
                </span>
                <button
                  onClick={() => setShowAiSuggestions(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 14,
                    color: '#94A3B8',
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  ×
                </button>
              </div>

              {aiSuggestedQuestions.map((q, i) => {
                const alreadyAdded = standingQuestions.includes(q.text);
                return (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    padding: '8px 0',
                    borderBottom: i < aiSuggestedQuestions.length - 1 ? '0.5px solid #F1F5F9' : 'none',
                    gap: 12,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: '#1E293B', lineHeight: 1.5, marginBottom: 2 }}>
                        {q.text}
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>
                        {q.rationale}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {alreadyAdded ? (
                        <span style={{ fontSize: 11, color: '#0D9488', padding: '3px 8px' }}>
                          ✓ Added
                        </span>
                      ) : (
                        <button
                          onClick={() => addQuestionFromSuggestion(q.text)}
                          style={{
                            fontSize: 11,
                            padding: '3px 10px',
                            background: '#0D9488',
                            border: 'none',
                            borderRadius: 4,
                            color: 'white',
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {aiSuggestedQuestions.some(q => !standingQuestions.includes(q.text)) && (
                <button
                  onClick={() => {
                    aiSuggestedQuestions
                      .filter(q => !standingQuestions.includes(q.text))
                      .forEach(q => addQuestionFromSuggestion(q.text));
                  }}
                  style={{
                    marginTop: 12,
                    fontSize: 11,
                    padding: '5px 12px',
                    background: 'none',
                    border: '0.5px solid #0D9488',
                    borderRadius: 4,
                    color: '#0D9488',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  Add all questions
                </button>
              )}
            </div>
          )}

          <p style={{ margin: '8px 0 24px', font: `400 11px ${fonts.sans}`, color: colors.textMuted }}>
            Without a goal, you get a findings list. With a goal, you get a verdict + evidence.
          </p>

          <SectionLabel>Questions <span style={{ color: colors.textMuted, fontWeight: 400 }}>(optional, max 5)</span></SectionLabel>
          <p style={{ margin: '0 0 8px', font: `400 12px ${fonts.sans}`, color: colors.textSecondary }}>
            What specific questions should this Agent answer on every run?
          </p>

          {standingQuestions.map((q, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <GripVertical size={14} style={{ color: colors.textMuted, flexShrink: 0 }} />
              <span style={{ flex: 1, font: `400 13px ${fonts.sans}`, color: colors.text, padding: '6px 0' }}>
                {i + 1}. {q}
              </span>
              <button
                onClick={() => {
                  setStandingQuestions(prev => prev.filter((_, j) => j !== i));
                  setFocusQuestions(prev => prev.filter((_, j) => j !== i));
                }}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: '4px' }}
              >
                ×
              </button>
            </div>
          ))}

          {standingQuestions.length < 5 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 8 }}>
              <input
                value={standingQInput}
                onChange={e => setStandingQInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && standingQInput.trim() && standingQuestions.length < 5) {
                    const q = standingQInput.trim();
                    setStandingQuestions(prev => [...prev, q]);
                    setFocusQuestions(prev => [...prev, q]);
                    setStandingQInput('');
                  }
                }}
                placeholder="e.g. Which deals moved out of commit since last week?"
                style={{ ...input, flex: 1 }}
              />
              <button
                onClick={() => {
                  if (standingQInput.trim() && standingQuestions.length < 5) {
                    const q = standingQInput.trim();
                    setStandingQuestions(prev => [...prev, q]);
                    setFocusQuestions(prev => [...prev, q]);
                    setStandingQInput('');
                  }
                }}
                style={btnSmall}
              >
                <Plus size={14} /> Add
              </button>
            </div>
          )}

          {standingQuestions.length === 0 && (
            <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textMuted, marginTop: 4, marginBottom: 16 }}>
              Add recurring questions to focus the agent's analysis and synthesis on what matters most.
            </p>
          )}

          {suggestedQuestions.length > 0 && (
            <div>
              <p style={{ margin: '16px 0 8px', font: `500 11px ${fonts.sans}`, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Suggestions based on your skills
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {suggestedQuestions.map(q => (
                  <button
                    key={q}
                    onClick={() => {
                      if (standingQuestions.length < 5) {
                        setStandingQuestions(prev => [...prev, q]);
                        setFocusQuestions(prev => [...prev, q]);
                      }
                    }}
                    disabled={standingQuestions.length >= 5}
                    style={{
                      background: colors.accentSoft, border: `1px solid ${colors.border}`,
                      borderRadius: 20, padding: '4px 12px', cursor: standingQuestions.length >= 5 ? 'not-allowed' : 'pointer',
                      font: `400 12px ${fonts.sans}`, color: colors.accent,
                    }}
                  >
                    + {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Skills Tab ──────────────────────────────── */}
      {activeTab === 'skills' && (
        <div>
          {/* Tradeoff explainer */}
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
          }}>
            <div>
              <div style={{ font: `600 11px ${fonts.sans}`, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Too few (0–1)</div>
              <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.5 }}>
                Limited data coverage. The agent can only answer what that one skill sees — blind spots are likely.
              </div>
            </div>
            <div style={{ borderLeft: `1px solid ${colors.border}`, paddingLeft: 12 }}>
              <div style={{ font: `600 11px ${fonts.sans}`, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Sweet spot (2–4)</div>
              <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.5 }}>
                Enough coverage for a focused goal. Synthesis stays tight and coherent.
              </div>
            </div>
            <div style={{ borderLeft: `1px solid ${colors.border}`, paddingLeft: 12 }}>
              <div style={{ font: `600 11px ${fonts.sans}`, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Too many (5+)</div>
              <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, lineHeight: 1.5 }}>
                Each skill adds ~15K tokens and ~30s. Synthesis dilutes — Claude struggles to stay on goal.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ font: `500 12px ${fonts.sans}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: colors.textSecondary }}>
              Skills to run ({skills.length})
            </span>
            {suggestionsLoading && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: `400 11px ${fonts.sans}`, color: colors.textMuted }}>
                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Suggesting…
              </span>
            )}
          </div>
          {suggestedSkills.length > 0 && !suggestionsLoading && (
            <p style={{ margin: '0 0 10px', font: `400 11px ${fonts.sans}`, color: colors.textMuted }}>
              Highlighted skills are suggested based on your goal and questions.
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {skillsLoading ? (
              <span style={{ fontSize: 12, color: colors.textMuted }}>Loading skills…</span>
            ) : allSkills.map(s => {
              const suggestion = suggestedSkills.find(sg => sg.skill_id === s.id);
              const isSelected = skills.includes(s.id);
              return (
                <div key={s.id} style={{ position: 'relative' }} className="skill-chip-wrap">
                  <button
                    onClick={() => setSkills(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                    title={suggestion?.reason || undefined}
                    style={{
                      ...chipBtn,
                      ...(isSelected ? chipBtnActive : {}),
                      ...(suggestion && !isSelected ? {
                        borderColor: '#d97706',
                        color: '#d97706',
                        background: 'rgba(217,119,6,0.06)',
                      } : {}),
                    }}
                  >
                    {isSelected ? '✓ ' : ''}{s.name}
                    {suggestion && !isSelected && (
                      <span style={{
                        marginLeft: 6,
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        background: '#d97706',
                        color: '#fff',
                        borderRadius: 3,
                        padding: '1px 4px',
                        verticalAlign: 'middle',
                      }}>
                        Suggested
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Dynamic count feedback */}
          {(() => {
            const n = skills.length;
            const estTokens = n === 0 ? 0 : n * 15000 + 5000;
            const estSecs = n === 0 ? 0 : n * 20 + 10;
            const fmtTokens = estTokens >= 1000 ? `~${Math.round(estTokens / 1000)}K` : `~${estTokens}`;
            const fmtTime = estSecs >= 60 ? `~${Math.round(estSecs / 60)}m` : `~${estSecs}s`;

            if (n === 0) return (
              <div style={{ marginTop: 12, font: `400 12px ${fonts.sans}`, color: '#d97706' }}>
                No skills selected — the agent has nothing to run.
              </div>
            );
            if (n <= 4) return (
              <div style={{ marginTop: 12, font: `400 12px ${fonts.sans}`, color: '#16a34a' }}>
                {n} skill{n > 1 ? 's' : ''} · {fmtTokens} tokens per run · {fmtTime} run time
                {n >= 2 && n <= 4 && <span style={{ marginLeft: 6, color: colors.textMuted }}>— recommended range</span>}
              </div>
            );
            if (n <= 6) return (
              <div style={{ marginTop: 12, font: `400 12px ${fonts.sans}`, color: '#d97706' }}>
                {n} skills · {fmtTokens} tokens · {fmtTime} run time · synthesis may lose focus with this many inputs
              </div>
            );
            return (
              <div style={{ marginTop: 12, font: `400 12px ${fonts.sans}`, color: '#dc2626' }}>
                {n} skills is unusually high — consider narrowing to the most relevant ones. {fmtTokens} tokens · {fmtTime} run time.
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── Data Window Tab ─────────────────────────── */}
      {activeTab === 'data_window' && (
        <div>
          <SectionLabel>Primary Window</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {DATA_WINDOWS.map(w => (
              <button key={w.value} onClick={() => setDataWindow(prev => ({ ...prev, primary: w.value }))} style={{
                ...chipBtn,
                ...(dataWindow.primary === w.value ? chipBtnActive : {}),
              }}>
                {w.label}
              </button>
            ))}
          </div>

          <SectionLabel>Compare Against</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {COMPARISONS.map(c => (
              <button key={c.value} onClick={() => setDataWindow(prev => ({ ...prev, comparison: c.value }))} style={{
                ...chipBtn,
                ...(dataWindow.comparison === c.value ? chipBtnActive : {}),
              }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Schedule Tab ────────────────────────────── */}
      {activeTab === 'scope' && (
        <div>
          <SectionLabel>Named Filters</SectionLabel>
          <p style={{ font: `400 13px ${fonts.sans}`, color: colors.textSecondary, marginBottom: 16 }}>
            Scope this agent's analysis using workspace-defined business concepts. When applied, every skill query will be filtered to match these definitions.
          </p>
          {availableFilters.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary, font: `400 13px ${fonts.sans}` }}>
              No named filters defined yet.{' '}
              <a href="/filters" style={{ color: colors.accent, textDecoration: 'none' }}>Manage Filters &rarr;</a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {availableFilters.map(f => {
                const isSelected = scopeFilters.includes(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => setScopeFilters(prev => isSelected ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 16px',
                      background: isSelected ? colors.accentSoft : colors.surfaceRaised,
                      border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                      border: `2px solid ${isSelected ? colors.accent : colors.border}`,
                      background: isSelected ? colors.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 11, fontWeight: 700,
                    }}>
                      {isSelected ? '\u2713' : ''}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: `500 13px ${fonts.sans}`, color: colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {f.label}
                        {!f.confirmed && (
                          <span style={{ font: `400 10px ${fonts.sans}`, color: colors.yellow, background: `${colors.yellow}15`, padding: '1px 6px', borderRadius: 4 }}>
                            unconfirmed
                          </span>
                        )}
                      </div>
                      {f.description && (
                        <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textSecondary, marginTop: 2 }}>
                          {f.description}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {f.entity_types.map(et => (
                          <span key={et} style={{ font: `400 10px ${fonts.sans}`, color: colors.textSecondary, background: colors.surface, padding: '1px 6px', borderRadius: 3 }}>
                            {et}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {scopeFilters.length > 0 && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: colors.accentSoft, borderRadius: 6, font: `400 12px ${fonts.sans}`, color: colors.accent }}>
              {scopeFilters.length} filter{scopeFilters.length > 1 ? 's' : ''} selected — all skill queries will be scoped to these definitions
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <a href="/filters" style={{ font: `400 12px ${fonts.sans}`, color: colors.accent, textDecoration: 'none' }}>
              Manage Filters &rarr;
            </a>
          </div>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div>
          <SectionLabel>Trigger Type</SectionLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {(['cron', 'event_prep', 'manual'] as const).map(t => (
              <button key={t} onClick={() => setSchedule(prev => ({ ...prev, type: t }))} style={{
                ...chipBtn,
                ...(schedule.type === t ? chipBtnActive : {}),
              }}>
                {t === 'cron' ? 'Recurring' : t === 'event_prep' ? 'Event Prep' : 'Manual'}
              </button>
            ))}
          </div>

          {schedule.type === 'cron' && (
            <>
              <SectionLabel>Schedule Preset</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {SCHEDULE_PRESETS.map(p => (
                  <button key={p.cron} onClick={() => setSchedule(prev => ({ ...prev, cron: p.cron }))} style={{
                    ...chipBtn,
                    ...(schedule.cron === p.cron ? chipBtnActive : {}),
                  }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input value={schedule.cron || ''} onChange={e => setSchedule(prev => ({ ...prev, cron: e.target.value }))}
                placeholder="Custom cron (e.g. 0 7 * * 1)" style={{ ...input, width: '100%', fontFamily: fonts.mono }} />
            </>
          )}

          {schedule.type === 'event_prep' && (
            <>
              <SectionLabel>Event Name</SectionLabel>
              <input value={schedule.event_name || ''} onChange={e => setSchedule(prev => ({ ...prev, event_name: e.target.value }))}
                placeholder="Board Meeting" style={{ ...input, width: '100%', marginBottom: 16 }} />

              <SectionLabel>Prep Window (days before)</SectionLabel>
              <input type="number" value={schedule.prep_days_before || 5}
                onChange={e => setSchedule(prev => ({ ...prev, prep_days_before: parseInt(e.target.value) || 5 }))}
                style={{ ...input, width: 100, marginBottom: 16 }} />

              <SectionLabel>Event Dates</SectionLabel>
              {(schedule.event_dates || []).map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ font: `400 14px ${fonts.sans}`, color: colors.text }}>{d}</span>
                  <X size={14} style={{ color: colors.textMuted, cursor: 'pointer' }}
                    onClick={() => setSchedule(prev => ({ ...prev, event_dates: (prev.event_dates || []).filter((_, idx) => idx !== i) }))} />
                </div>
              ))}
              <input type="date" onChange={e => {
                if (e.target.value) {
                  setSchedule(prev => ({ ...prev, event_dates: [...(prev.event_dates || []), e.target.value] }));
                  e.target.value = '';
                }
              }} style={{ ...input }} />
            </>
          )}
        </div>
      )}

      {/* ─── Output Formats Tab ──────────────────────── */}
      {activeTab === 'formats' && (
        <div>
          <SectionLabel>Delivery Formats</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FORMAT_OPTIONS.map(f => (
              <button key={f} onClick={() => setOutputFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])} style={{
                ...chipBtn,
                ...(outputFormats.includes(f) ? chipBtnActive : {}),
              }}>
                {outputFormats.includes(f) ? '✓ ' : ''}{f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Report Structure Tab ────────────────────── */}
      {activeTab === 'structure' && editingAgentId && (
        <div>
          {useIssueTree ? (
            <>
              {/* Generate structure banner */}
              {!showSectionPreview && goal.trim().length > 0 && standingQuestions.length >= 2 && (
                <div style={{
                  marginBottom: 20,
                  padding: '14px 16px',
                  background: '#F0FDF9',
                  borderRadius: 8,
                  border: '1px solid #CCFBF1',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#0D9488', marginBottom: 2 }}>
                      Generate from your questions
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>
                      {standingQuestions.length} questions ready → build report structure
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateSections}
                    disabled={generatingSections}
                    style={{
                      padding: '8px 16px',
                      background: generatingSections ? '#94A3B8' : '#0D9488',
                      border: 'none',
                      borderRadius: 6,
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: generatingSections ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {generatingSections ? 'Building...' : '✦ Generate structure'}
                  </button>
                </div>
              )}

              {/* Section preview */}
              {showSectionPreview && suggestedSections.length > 0 && (
                <div style={{ marginBottom: 24, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{
                    padding: '12px 16px',
                    background: '#F8FAFC',
                    borderBottom: '0.5px solid #E2E8F0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Generated report structure</span>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>Review before saving</span>
                  </div>

                  {suggestedSections.map((section, i) => (
                    <div key={i} style={{
                      padding: '14px 16px',
                      borderBottom: i < suggestedSections.length - 1 ? '0.5px solid #F1F5F9' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#0D9488', minWidth: 20, marginTop: 2 }}>
                          {i + 1}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', marginBottom: 3 }}>
                            {section.title}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6, fontStyle: 'italic' }}>
                            "{section.standing_question}"
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {(section.primary_skill_ids || []).map((skillId: string) => (
                              <span key={skillId} style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                background: '#F1F5F9',
                                borderRadius: 10,
                                color: '#475569',
                              }}>
                                {getSkillName(skillId)}
                              </span>
                            ))}
                            {section.section_intent && (
                              <span style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                background: '#F0FDF9',
                                borderRadius: 10,
                                color: '#0D9488',
                                border: '0.5px solid #CCFBF1',
                              }}>
                                {section.section_intent}
                              </span>
                            )}
                            {section.action_format && (
                              <span style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                background: '#FAFAFA',
                                borderRadius: 10,
                                color: '#94A3B8',
                                border: '0.5px solid #E2E8F0',
                              }}>
                                {section.action_format?.replace('_', ' ')} actions
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div style={{
                    padding: '12px 16px',
                    background: '#F8FAFC',
                    borderTop: '0.5px solid #E2E8F0',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                  }}>
                    <button
                      onClick={() => { setShowSectionPreview(false); setSuggestedSections([]); }}
                      style={{
                        padding: '7px 14px',
                        background: 'none',
                        border: '0.5px solid #CBD5E1',
                        borderRadius: 6,
                        color: '#64748B',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Edit manually
                    </button>
                    <button
                      onClick={handleSaveGeneratedSections}
                      style={{
                        padding: '7px 16px',
                        background: '#0D9488',
                        border: 'none',
                        borderRadius: 6,
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Use this structure
                    </button>
                  </div>
                </div>
              )}

              <IssueTreeEditor
                key={issueTreeKey}
                workspaceId={getWorkspaceId()}
                agentId={editingAgentId}
                agentGoal={goal}
                onSave={() => {}}
              />
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748B' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#1E293B', marginBottom: 8 }}>
                MECE Issue Tree
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 360, margin: '0 auto 20px' }}>
                Replace the standard template with a structured issue tree. Each section covers a
                distinct MECE category. The report learns from prior weeks and tracks unresolved actions.
              </div>
              <button
                onClick={async () => {
                  try {
                    await api.patch(`/agents-v2/${editingAgentId}`, { use_issue_tree: true });
                    setUseIssueTree(true);
                  } catch (err: any) {
                    alert(err.message || 'Failed to upgrade');
                  }
                }}
                style={{
                  padding: '8px 20px',
                  background: '#0D9488',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Upgrade to Issue Tree
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Save Bar ────────────────────────────────── */}
      <div style={{ marginTop: 32, paddingTop: 20, borderTop: activeTab === 'structure' ? 'none' : `1px solid ${colors.border}`, display: activeTab === 'structure' ? 'none' : 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button onClick={() => setView('list')} style={btnSecondary}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving...' : <><Save size={14} /> {editingAgentId ? 'Update Agent' : 'Create Agent'}</>}
        </button>
      </div>

      {/* Learned Preferences (only for existing agents) */}
      {editingAgentId && (
        <LearnedPreferences
          workspaceId={getWorkspaceId()}
          agentId={editingAgentId}
        />
      )}

      {showIconPicker && (
        <AvatarPicker
          currentValue={icon}
          onSelect={setIcon}
          onClose={() => setShowIconPicker(false)}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ font: `500 12px ${fonts.sans}`, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{children}</div>;
}

const card: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 20,
};

const badge: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 6,
  font: `500 11px ${fonts.sans}`,
  background: colors.accentSoft, color: colors.accent,
};

const tag: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 10px', borderRadius: 6,
  font: `400 12px ${fonts.sans}`,
};

const input: React.CSSProperties = {
  font: `400 14px ${fonts.sans}`,
  color: colors.text,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '8px 12px',
  outline: 'none',
};

const chipBtn: React.CSSProperties = {
  font: `400 13px ${fonts.sans}`,
  color: colors.textSecondary,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const chipBtnActive: React.CSSProperties = {
  background: colors.accentSoft,
  color: colors.accent,
  borderColor: colors.accent,
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  font: `500 13px ${fonts.sans}`,
  color: '#fff', background: colors.accent,
  border: 'none', borderRadius: 6,
  padding: '8px 16px', cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  font: `500 13px ${fonts.sans}`,
  color: colors.textSecondary, background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`, borderRadius: 6,
  padding: '8px 16px', cursor: 'pointer',
};

const btnSmall: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  font: `500 12px ${fonts.sans}`,
  color: colors.accent, background: colors.accentSoft,
  border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer',
};

const btnBack: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  font: `400 13px ${fonts.sans}`,
  color: colors.textSecondary, background: 'none',
  border: 'none', cursor: 'pointer', padding: 0,
};

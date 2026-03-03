import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import Greeting, { type GreetingPhase, type GreetingPayload } from '../components/assistant/Greeting';
import ProactiveBriefing, { type InvestigationPath } from '../components/assistant/ProactiveBriefing';
import MorningBrief from '../components/assistant/MorningBrief';
import OperatorStrip from '../components/assistant/OperatorStrip';
import StickyInput from '../components/assistant/StickyInput';
import ConversationView from '../components/assistant/ConversationView';
import BriefSection from '../components/assistant/BriefSection';
import TheNumberCard from '../components/assistant/TheNumberCard';
import WhatChangedCard from '../components/assistant/WhatChangedCard';
import SegmentsCard from '../components/assistant/SegmentsCard';
import RepsCard from '../components/assistant/RepsCard';
import DealsToWatchCard from '../components/assistant/DealsToWatchCard';
import SendBriefDialog from '../components/assistant/SendBriefDialog';
import BriefEmptyState from '../components/assistant/BriefEmptyState';
import AnnotatedText from '../components/assistant/AnnotatedText';
import QuickActionPills from '../components/assistant/QuickActionPills';

type ViewMode = 'home' | 'conversation';

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text: string, speed: number, active: boolean, onComplete: () => void) {
  const [displayed, setDisplayed] = useState('');
  const doneRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (!active || !text) return;
    doneRef.current = false;
    setDisplayed('');
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setDisplayed(textRef.current.slice(0, i));
      if (i >= textRef.current.length) {
        clearInterval(id);
        if (!doneRef.current) { doneRef.current = true; onComplete(); }
      }
    }, speed);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, text, speed]);

  return displayed;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWeekLabel(brief: any): string {
  if (!brief?.period_start || !brief?.period_end) return '';
  const s = new Date(brief.period_start + 'T00:00:00Z');
  const e = new Date(brief.period_end + 'T00:00:00Z');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatDate(dateStr?: string | Date): string {
  if (!dateStr) return '';
  if (dateStr instanceof Date) return dateStr.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const s = String(dateStr);
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SECTION_ORDER = ['the_number', 'what_changed', 'reps', 'deals'];

// ─── Main component ───────────────────────────────────────────────────────────

export default function AssistantView() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id || '';

  // ── View mode ────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [greeting, setGreeting] = useState<GreetingPayload | null>(null);
  const [brief, setBrief] = useState<any>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [operators, setOperators] = useState<any[] | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [expandedNumberRow, setExpandedNumberRow] = useState<'pipeline' | 'attainment' | 'gap' | null>(null);

  // ── Phase machine ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<GreetingPhase>('blank');
  const [visibleQuestions, setVisibleQuestions] = useState(0);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [investigationJobs, setInvestigationJobs] = useState<Map<string, {
    jobId: string;
    skillId: string;
    question: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    runId?: string;
    error?: string;
  }>>(new Map());
  const phaseRef = useRef<GreetingPhase>('blank');
  phaseRef.current = phase;

  // ── Section refs for scroll ──────────────────────────────────────────────────
  const numberSectionRef = useRef<HTMLDivElement>(null);
  const whatChangedSectionRef = useRef<HTMLDivElement>(null);
  const repsSectionRef = useRef<HTMLDivElement>(null);
  const dealsSectionRef = useRef<HTMLDivElement>(null);

  // ── Advance phase ─────────────────────────────────────────────────────────────
  const advance = useCallback((to: GreetingPhase, delayMs = 0) => {
    const go = () => setPhase(to);
    if (delayMs > 0) setTimeout(go, delayMs);
    else go();
  }, []);

  // Skip to pills immediately (click-to-skip or fallback)
  const skipToReady = useCallback(() => {
    if (['pills', 'browsing'].includes(phaseRef.current)) return;
    setPhase('pills');
    setVisibleQuestions(greeting?.questions?.length ?? 0);
  }, [greeting]);

  // ── Greeting data → kick off phase sequence ───────────────────────────────────
  useEffect(() => {
    if (!greeting) return;
    // Wait 300ms after greeting arrives, then start streaming headline
    const t = setTimeout(() => {
      if (phaseRef.current === 'blank') advance('headline');
    }, 300);
    return () => clearTimeout(t);
  }, [greeting, advance]);

  // Typewriter active flags per segment
  const headlineActive = phase === 'headline';
  const sublineActive = phase === 'subline';
  const contextActive = phase === 'context';

  const typedHeadline = useTypewriter(
    greeting?.headline ?? '',
    22,
    headlineActive,
    () => advance('subline', 350),
  );
  const typedSubline = useTypewriter(
    greeting?.subline ?? '',
    24,
    sublineActive,
    () => advance('context', 250),
  );
  const typedContext = useTypewriter(
    greeting?.state_summary ?? '',
    20,
    contextActive,
    () => advance('questions', 200),
  );

  // Questions stagger
  useEffect(() => {
    if (phase !== 'questions') return;
    const questions = greeting?.questions ?? [];
    if (questions.length === 0) { advance('pills', 100); return; }
    let count = 0;
    const id = setInterval(() => {
      count += 1;
      setVisibleQuestions(count);
      if (count >= questions.length) {
        clearInterval(id);
        setTimeout(() => advance('pills'), 220);
      }
    }, 130);
    return () => clearInterval(id);
  }, [phase, greeting, advance]);

  // ── Fallback: if greeting hasn't arrived in 2s, skip to pills ────────────────
  useEffect(() => {
    const t = setTimeout(() => { if (phaseRef.current === 'blank') skipToReady(); }, 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────────
  const fetchBrief = useCallback(async () => {
    if (!wsId) return;
    try {
      const res = await api.get('/brief');
      setBrief(res?.available ? res.brief : null);
    } catch {
      setBrief(null);
    } finally {
      setBriefLoading(false);
    }
  }, [wsId]);

  const fetchAll = useCallback(async () => {
    if (!wsId) return;
    setBriefLoading(true);
    const [greetRes, opsRes] = await Promise.allSettled([
      api.get(`/briefing/greeting?localHour=${new Date().getHours()}`),
      api.get('/briefing/operators'),
    ]);
    if (greetRes.status === 'fulfilled') setGreeting(greetRes.value as GreetingPayload);
    if (opsRes.status === 'fulfilled') setOperators(Array.isArray(opsRes.value) ? opsRes.value : []);
    await fetchBrief();
  }, [wsId, fetchBrief]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const onFocus = () => fetchBrief();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchBrief]);

  useEffect(() => {
    if (!wsId) return;
    const interval = setInterval(() => {
      if (!brief || brief.status === 'assembling') fetchBrief();
    }, 60_000);
    return () => clearInterval(interval);
  }, [wsId, brief, fetchBrief]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback((text: string) => {
    setInitialMessage(text);
    setViewMode('conversation');
  }, []);

  const handleInvestigateSkill = async (path: InvestigationPath) => {
    if (!path.skill_id) {
      // No skill mapped, just send question to chat
      handleSend(path.question);
      return;
    }

    try {
      // Trigger background skill execution
      const response = await api.post(
        `/workspaces/${wsId}/investigation/trigger-skill`,
        {
          skillId: path.skill_id,
          investigationPath: path,
          metadata: {
            role: greeting?.metrics ? 'detected_from_greeting' : undefined,
            triggeredFrom: 'proactive_briefing',
          },
        }
      );

      const { jobId } = response;

      // Track job
      setInvestigationJobs(prev => new Map(prev).set(path.skill_id!, {
        jobId,
        skillId: path.skill_id!,
        question: path.question,
        status: 'pending',
      }));

      // Start polling for status
      pollInvestigationStatus(jobId, path.skill_id!);
    } catch (err) {
      console.error('Failed to trigger investigation:', err);
      alert('Failed to start investigation. Please try again.');
    }
  };

  const pollInvestigationStatus = async (jobId: string, skillId: string) => {
    const maxPolls = 120;  // 4 minutes (2s interval)
    let polls = 0;

    const poll = async () => {
      try {
        const job = await api.get(`/jobs/${jobId}`);

        setInvestigationJobs(prev => {
          const updated = new Map(prev);
          const existing = updated.get(skillId);
          if (existing) {
            updated.set(skillId, {
              ...existing,
              status: job.status,
              runId: job.result?.runId,
              error: job.error,
            });
          }
          return updated;
        });

        if (job.status === 'completed' || job.status === 'failed') {
          // Stop polling
          return;
        }

        // Continue polling
        polls++;
        if (polls < maxPolls) {
          setTimeout(poll, 2000);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    poll();
  };

  const handleBack = useCallback(() => {
    setViewMode('home');
    setInitialMessage(undefined);
  }, []);

  const handleSection = useCallback((section: string) => {
    setOpenSections(prev => {
      if (prev.includes(section)) return prev.filter(s => s !== section);
      // Maintain consistent order
      const next = SECTION_ORDER.filter(s => prev.includes(s) || s === section);
      return next;
    });
    setPhase('browsing');
  }, []);

  const handleDrilldown = useCallback((drilldown: string) => {
    const scroll = (ref: React.RefObject<HTMLDivElement | null>) =>
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (drilldown === 'attainment') { setExpandedNumberRow('attainment'); scroll(numberSectionRef); }
    else if (drilldown === 'gap') { setExpandedNumberRow('gap'); scroll(numberSectionRef); }
    else if (drilldown === 'pipeline_total') { setExpandedNumberRow('pipeline'); scroll(numberSectionRef); }
    else if (drilldown === 'pipeline_change') { scroll(whatChangedSectionRef); }
    else if (drilldown === 'deals_at_risk' || drilldown.startsWith('deal:')) { scroll(dealsSectionRef); }
    else if (drilldown.startsWith('rep:')) { scroll(repsSectionRef); }
  }, []);

  // ── Conversation view ─────────────────────────────────────────────────────────
  if (viewMode === 'conversation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <ConversationView initialMessage={initialMessage} onBack={handleBack} />
      </div>
    );
  }

  // ── Brief metadata ────────────────────────────────────────────────────────────
  const bt = brief?.brief_type;
  const ef = brief?.editorial_focus || {};
  const highlightReps: string[] = ef.highlight_reps || [];
  const highlightDeals: string[] = ef.highlight_deals || [];

  const weekLabel = formatWeekLabel(brief);
  const briefHeader = !brief ? null : bt === 'pulse' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: '#E5E7EB' }}>Pulse</span>
      <span style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(brief.generated_date)}</span>
    </div>
  ) : bt === 'friday_recap' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: '#E5E7EB' }}>Week of {weekLabel || formatDate(brief.generated_date)}</span>
    </div>
  ) : bt === 'monday_setup' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: '#E5E7EB' }}>Week ahead</span>
      {weekLabel && <span style={{ fontSize: 13, color: '#6B7280' }}>{weekLabel}</span>}
    </div>
  ) : null;

  // Determine cursor position
  const cursorTarget: 'headline' | 'subline' | 'context' | null =
    phase === 'headline' ? 'headline' :
    phase === 'subline' ? 'subline' :
    phase === 'context' ? 'context' : null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}
      onClick={() => {
        if (!['pills', 'browsing'].includes(phase)) skipToReady();
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {greeting?.proactive_briefing && phase === 'pills' ? (
          <ProactiveBriefing
            greeting={greeting}
            onInvestigatePath={handleInvestigateSkill}
            investigationStatus={investigationJobs}
            onQuestionClick={handleSend}
            onEscalate={() => {
              // TODO: Implement escalation alert
              alert('Escalation feature coming soon');
            }}
            onAskPandora={() => {
              // Focus input
              const input = document.querySelector('input[type="text"]') as HTMLInputElement;
              if (input) input.focus();
            }}
          />
        ) : (
          <Greeting
            data={greeting ?? undefined}
            phase={phase}
            typedHeadline={phase === 'blank' ? '' : typedHeadline}
            typedSubline={['blank', 'headline'].includes(phase) ? '' : typedSubline}
            typedContext={['blank', 'headline', 'subline'].includes(phase) ? '' : typedContext}
            visibleQuestions={visibleQuestions}
            cursorTarget={cursorTarget}
          />
        )}

        <QuickActionPills
          onSend={handleSend}
          onSection={handleSection}
          openSections={openSections}
          hasBrief={!!brief && !briefLoading}
          phase={phase}
        />

        {/* Brief cards — revealed on demand */}
        {phase === 'browsing' && openSections.length > 0 && brief && (
          <div style={{ marginTop: 4 }}>
            {/* Brief header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 10, padding: '0 2px',
              animation: 'pandora-fade-up 250ms ease-out forwards',
            }}>
              <div>
                {briefHeader}
                {brief.generated_at && (
                  <div style={{ fontSize: 11, color: '#4B5563', marginTop: 3 }}>
                    Updated {timeAgo(brief.generated_at)}
                    {ef.primary && ef.primary !== 'overview' && (
                      <span style={{ marginLeft: 8, color: '#F59E0B' }}>· {ef.primary.replace('_', ' ')}</span>
                    )}
                  </div>
                )}
                {ef.reason && ef.primary !== 'overview' && (
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>{ef.reason}</div>
                )}
              </div>
              <button
                onClick={e => { e.stopPropagation(); setShowSendDialog(true); }}
                style={{ fontSize: 12, color: '#6488EA', background: 'none', border: '1px solid #6488EA40', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', flexShrink: 0 }}
              >
                Send ✉
              </button>
            </div>

            {/* Quarter-close sticky banner */}
            {bt === 'quarter_close' && brief.the_number && (
              <div style={{
                background: 'linear-gradient(135deg, #1C1206, #1A1A1A)',
                border: '1px solid #F59E0B40', borderRadius: 8, padding: '10px 14px',
                marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                animation: 'pandora-fade-up 250ms ease-out forwards',
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F59E0B' }}>{brief.the_number.days_remaining} days left</span>
                {brief.the_number.gap > 0 && (
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>
                    {brief.the_number.gap >= 1_000_000 ? `$${(brief.the_number.gap/1_000_000).toFixed(1)}M` : brief.the_number.gap >= 1_000 ? `$${(brief.the_number.gap/1_000).toFixed(0)}K` : `$${brief.the_number.gap}`} gap
                  </span>
                )}
                {brief.the_number.coverage_on_gap > 0 && (
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>Coverage: {brief.the_number.coverage_on_gap.toFixed(1)}×</span>
                )}
              </div>
            )}

            {/* AI summary blurb above cards */}
            {(() => {
              const blurb =
                bt === 'monday_setup' ? brief.ai_blurbs?.overall_summary :
                bt === 'pulse' ? brief.ai_blurbs?.pulse_summary :
                bt === 'friday_recap' ? brief.ai_blurbs?.week_summary :
                bt === 'quarter_close' ? brief.ai_blurbs?.quarter_situation : null;
              const follow =
                bt === 'pulse' ? brief.ai_blurbs?.key_action :
                bt === 'friday_recap' ? brief.ai_blurbs?.next_week_focus :
                bt === 'quarter_close' ? brief.ai_blurbs?.close_plan : null;
              const followColor = bt === 'quarter_close' ? '#F59E0B' : '#6488EA';
              if (!blurb) return null;
              return (
                <div style={{ fontSize: 13, color: '#9CA3AF', padding: '0 2px 12px', lineHeight: 1.55, animation: 'pandora-fade-up 280ms ease-out forwards' }}>
                  <AnnotatedText text={blurb} claims={brief.ai_blurbs?.claims} onDrilldown={handleDrilldown} />
                  {follow && (
                    <span style={{ color: followColor }}>
                      {' '}<AnnotatedText text={follow} claims={brief.ai_blurbs?.claims} onDrilldown={handleDrilldown} style={{ color: followColor }} />
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Friday won-this-week */}
            {bt === 'friday_recap' && brief.deals_to_watch?.won_this_week?.length > 0 && openSections.includes('deals') && (
              <div style={{ background: '#0D1F14', border: '1px solid #34D39940', borderRadius: 8, padding: '10px 14px', marginBottom: 8, animation: 'pandora-fade-up 300ms ease-out forwards' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#34D399', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Won this week</div>
                {brief.deals_to_watch.won_this_week.map((d: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1F2937', fontSize: 13 }}>
                    <span style={{ color: '#E5E7EB' }}>{d.name}</span>
                    <span style={{ color: '#34D399', fontWeight: 600 }}>
                      {d.amount >= 1_000_000 ? `$${(d.amount/1_000_000).toFixed(1)}M` : d.amount >= 1_000 ? `$${(d.amount/1_000).toFixed(0)}K` : `$${d.amount}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* On-demand cards in the order user opened them */}
            {openSections.map(section => (
              <div key={section} style={{ animation: 'pandora-fade-up 300ms ease-out forwards' }}>
                {section === 'the_number' && (
                  <div ref={numberSectionRef}>
                    <BriefSection
                      title="The Number"
                      subtitle={bt === 'quarter_close' ? 'Attainment · Gap · Coverage' : bt === 'pulse' ? 'Changes since Monday' : undefined}
                      defaultExpanded
                      highlighted={ef.primary === 'attainment_risk' || ef.primary === 'attainment_countdown'}
                    >
                      <TheNumberCard theNumber={brief.the_number} briefType={bt} deltaMode={bt === 'pulse'} reps={brief.reps} expandedRow={expandedNumberRow} onExpandedRowChange={setExpandedNumberRow} />
                    </BriefSection>
                  </div>
                )}

                {section === 'what_changed' && (
                  <div ref={whatChangedSectionRef}>
                    <BriefSection
                      title={bt === 'pulse' ? 'What Changed' : 'Activity'}
                      subtitle={brief.what_changed?.since_date ? `Since ${brief.what_changed.since_date}` : undefined}
                      defaultExpanded
                      highlighted={ef.primary === 'pipeline_decline'}
                    >
                      <WhatChangedCard whatChanged={brief.what_changed} briefType={bt} />
                    </BriefSection>
                  </div>
                )}

                {section === 'reps' && (
                  <div ref={repsSectionRef}>
                    <BriefSection
                      title={bt === 'quarter_close' ? 'Reps — Gap to Quota' : 'Reps'}
                      defaultExpanded
                      highlighted={ef.primary === 'rep_coaching'}
                      omitted={brief.reps?.omitted}
                      omitMessage={brief.reps?.reason}
                    >
                      <RepsCard reps={brief.reps} highlightEmails={highlightReps} briefType={bt} onAsk={handleSend} />
                    </BriefSection>
                    {bt === 'monday_setup' && brief.ai_blurbs?.rep_conversation && (
                      <div style={{ padding: '8px 14px', borderLeft: '2px solid #6488EA', marginBottom: 6, background: '#141420', animation: 'pandora-fade-up 300ms ease-out forwards' }}>
                        <div style={{ fontSize: 11, color: '#6488EA', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Rep to talk to</div>
                        <div style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.5 }}>{brief.ai_blurbs.rep_conversation}</div>
                      </div>
                    )}
                  </div>
                )}

                {section === 'deals' && (
                  <div ref={dealsSectionRef}>
                    <BriefSection
                      title={bt === 'quarter_close' ? 'Closeable this Quarter' : bt === 'friday_recap' ? 'Going into next week' : 'Deals to Watch'}
                      defaultExpanded
                      highlighted={ef.primary === 'deal_risk'}
                    >
                      <DealsToWatchCard deals={brief.deals_to_watch} highlightNames={highlightDeals} briefType={bt} onAsk={handleSend} />
                    </BriefSection>
                    {bt === 'monday_setup' && brief.ai_blurbs?.deal_recommendation && (
                      <div style={{ padding: '8px 14px', borderLeft: '2px solid #F59E0B', background: '#141414', animation: 'pandora-fade-up 300ms ease-out forwards' }}>
                        <div style={{ fontSize: 11, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Deal to focus on</div>
                        <div style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.5 }}>{brief.ai_blurbs.deal_recommendation}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* No-brief fallback — shown once pills phase is reached */}
        {['pills', 'browsing'].includes(phase) && !briefLoading && !brief && (
          <>
            <BriefEmptyState workspaceId={wsId} onAssembled={fetchBrief} />
            <div style={{ textAlign: 'center', padding: '8px 0 0 0' }}>
              <a href="/onboarding" style={{ fontSize: 12, color: 'var(--color-textMuted)', textDecoration: 'underline dotted' }}>
                Your brief will be more accurate with a 10-minute setup. Start setup →
              </a>
            </div>
            <MorningBrief items={undefined} loading={false} onItemClick={(item) => handleSend(item.headline)} />
            <OperatorStrip operators={operators ?? undefined} loading={false} onOperatorClick={(name) => handleSend(`Give me the latest ${name}`)} />
          </>
        )}
      </div>

      <StickyInput onSend={handleSend} />

      {showSendDialog && brief && (
        <SendBriefDialog brief={brief} workspaceId={wsId} onClose={() => setShowSendDialog(false)} />
      )}
    </div>
  );
}

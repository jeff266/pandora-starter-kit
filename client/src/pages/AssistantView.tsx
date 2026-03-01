import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import Greeting from '../components/assistant/Greeting';
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

type ViewMode = 'home' | 'conversation';

const BRIEF_TYPE_LABELS: Record<string, string> = {
  monday_setup: 'Monday Setup',
  pulse: 'Pulse',
  friday_recap: 'Week Recap',
  quarter_close: 'Quarter Close',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatWeekLabel(brief: any): string {
  if (!brief?.period_start) return '';
  const s = new Date(brief.period_start + 'T00:00:00Z');
  const e = new Date(brief.period_end + 'T00:00:00Z');
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatDate(dateStr?: string | Date): string {
  if (!dateStr) return '';
  if (dateStr instanceof Date) {
    return dateStr.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  const s = String(dateStr);
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default function AssistantView() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id || '';

  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);

  const [greeting, setGreeting] = useState<any>(null);
  const [brief, setBrief] = useState<any>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [operators, setOperators] = useState<any[] | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);

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

    if (greetRes.status === 'fulfilled') setGreeting(greetRes.value);
    if (opsRes.status === 'fulfilled') setOperators(Array.isArray(opsRes.value) ? opsRes.value : []);

    await fetchBrief();
  }, [wsId, fetchBrief]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const onFocus = () => fetchBrief();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchBrief]);

  // 60s polling for brief readiness while assembling
  useEffect(() => {
    if (!wsId) return;
    const interval = setInterval(() => {
      if (!brief || brief.status === 'assembling') fetchBrief();
    }, 60_000);
    return () => clearInterval(interval);
  }, [wsId, brief, fetchBrief]);

  const handleSend = useCallback((text: string) => {
    setInitialMessage(text);
    setViewMode('conversation');
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('home');
    setInitialMessage(undefined);
  }, []);

  if (viewMode === 'conversation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <ConversationView initialMessage={initialMessage} onBack={handleBack} />
      </div>
    );
  }

  const bt = brief?.brief_type;
  const ef = brief?.editorial_focus || {};
  const openSections: string[] = ef.open_sections || [];
  const suppressSections: string[] = ef.suppress || [];
  const highlightReps: string[] = ef.highlight_reps || [];
  const highlightDeals: string[] = ef.highlight_deals || [];

  const isOpen = (section: string) => openSections.includes(section);
  const isSuppressed = (section: string) => suppressSections.includes(section);

  // Brief header by type
  const briefHeader = !brief ? null : bt === 'pulse' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#E5E7EB' }}>Pulse</span>
      <span style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(brief.generated_date)}</span>
    </div>
  ) : bt === 'friday_recap' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#E5E7EB' }}>Week of {formatWeekLabel(brief)}</span>
    </div>
  ) : bt === 'monday_setup' ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#E5E7EB' }}>Week ahead</span>
      <span style={{ fontSize: 13, color: '#6B7280' }}>{formatWeekLabel(brief)}</span>
    </div>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <Greeting data={greeting} loading={false} />

        {/* Brief section */}
        {briefLoading ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <div style={{ width: 20, height: 20, border: '2px solid #1F2937', borderTopColor: '#6488EA', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : brief ? (
          <div style={{ padding: '0 0 12px' }}>
            {/* Quarter-close sticky banner */}
            {bt === 'quarter_close' && brief.the_number && (
              <div style={{
                background: 'linear-gradient(135deg, #1C1206, #1A1A1A)',
                border: '1px solid #F59E0B40',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F59E0B' }}>
                  {brief.the_number.days_remaining} days left
                </span>
                {brief.the_number.gap > 0 && (
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>
                    {(() => { const n = brief.the_number.gap; return n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toFixed(0)}`; })()} gap
                  </span>
                )}
                {brief.the_number.coverage_on_gap > 0 && (
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>
                    Coverage: {brief.the_number.coverage_on_gap.toFixed(1)}×
                  </span>
                )}
              </div>
            )}

            {/* Brief header + meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, padding: '0 2px' }}>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setShowSendDialog(true)}
                  style={{ fontSize: 12, color: '#6488EA', background: 'none', border: '1px solid #6488EA40', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}
                >
                  Send ✉
                </button>
              </div>
            </div>

            {/* Friday won-this-week highlight */}
            {bt === 'friday_recap' && brief.deals_to_watch?.won_this_week?.length > 0 && (
              <div style={{ background: '#0D1F14', border: '1px solid #34D39940', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
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

            {/* AI summary blurb */}
            {brief.ai_blurbs?.overall_summary && bt === 'monday_setup' && (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: '8px 2px 10px', lineHeight: 1.5 }}>
                {brief.ai_blurbs.overall_summary}
              </div>
            )}
            {brief.ai_blurbs?.pulse_summary && bt === 'pulse' && (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: '8px 2px 10px', lineHeight: 1.5 }}>
                {brief.ai_blurbs.pulse_summary}
                {brief.ai_blurbs.key_action && <span style={{ color: '#6488EA' }}> {brief.ai_blurbs.key_action}</span>}
              </div>
            )}
            {brief.ai_blurbs?.week_summary && bt === 'friday_recap' && (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: '8px 2px 10px', lineHeight: 1.5 }}>
                {brief.ai_blurbs.week_summary}
                {brief.ai_blurbs.next_week_focus && <span style={{ color: '#6488EA' }}> {brief.ai_blurbs.next_week_focus}</span>}
              </div>
            )}
            {brief.ai_blurbs?.quarter_situation && bt === 'quarter_close' && (
              <div style={{ fontSize: 13, color: '#9CA3AF', padding: '8px 2px 10px', lineHeight: 1.5 }}>
                {brief.ai_blurbs.quarter_situation}
                {brief.ai_blurbs.close_plan && <span style={{ color: '#F59E0B' }}> {brief.ai_blurbs.close_plan}</span>}
              </div>
            )}

            {/* Sections */}
            <BriefSection
              title="The Number"
              subtitle={bt === 'quarter_close' ? 'Attainment · Gap · Coverage' : bt === 'pulse' ? `Changes since Monday` : undefined}
              defaultExpanded={isOpen('the_number') || bt === 'quarter_close'}
              highlighted={ef.primary === 'attainment_risk' || ef.primary === 'attainment_countdown'}
              hidden={isSuppressed('the_number')}
            >
              <TheNumberCard theNumber={brief.the_number} briefType={bt} deltaMode={bt === 'pulse'} />
            </BriefSection>

            <BriefSection
              title={bt === 'pulse' ? 'What Changed' : 'Activity'}
              subtitle={brief.what_changed?.since_date ? `Since ${brief.what_changed.since_date}` : undefined}
              defaultExpanded={isOpen('what_changed') || ef.primary === 'pipeline_decline'}
              highlighted={ef.primary === 'pipeline_decline'}
              hidden={isSuppressed('what_changed')}
            >
              <WhatChangedCard whatChanged={brief.what_changed} briefType={bt} />
            </BriefSection>

            <BriefSection
              title="Pipeline by Segment"
              defaultExpanded={isOpen('segments')}
              hidden={isSuppressed('segments')}
              omitted={brief.segments?.omitted && !isSuppressed('segments')}
              omitMessage={brief.segments?.reason}
            >
              <SegmentsCard segments={brief.segments} />
            </BriefSection>

            <BriefSection
              title={bt === 'quarter_close' ? 'Reps — Gap to Quota' : 'Reps'}
              defaultExpanded={isOpen('reps') || ef.primary === 'rep_coaching'}
              highlighted={ef.primary === 'rep_coaching'}
              hidden={isSuppressed('reps')}
              omitted={brief.reps?.omitted && !isSuppressed('reps')}
              omitMessage={brief.reps?.reason}
            >
              <RepsCard
                reps={brief.reps}
                highlightEmails={highlightReps}
                briefType={bt}
                onAsk={handleSend}
              />
            </BriefSection>

            <BriefSection
              title={bt === 'quarter_close' ? 'Closeable this Quarter' : bt === 'friday_recap' ? 'Going into next week' : 'Deals to Watch'}
              defaultExpanded={isOpen('deals_to_watch') || ef.primary === 'deal_risk' || bt === 'quarter_close'}
              highlighted={ef.primary === 'deal_risk'}
              hidden={isSuppressed('deals_to_watch')}
            >
              <DealsToWatchCard
                deals={brief.deals_to_watch}
                highlightNames={highlightDeals}
                briefType={bt}
                onAsk={handleSend}
              />
            </BriefSection>

            {/* Rep conversation / deal recommendation for monday */}
            {bt === 'monday_setup' && (brief.ai_blurbs?.rep_conversation || brief.ai_blurbs?.deal_recommendation) && (
              <div style={{ marginTop: 4 }}>
                {brief.ai_blurbs.rep_conversation && (
                  <div style={{ padding: '8px 14px', borderLeft: '2px solid #6488EA', marginBottom: 6, background: '#141420' }}>
                    <div style={{ fontSize: 11, color: '#6488EA', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Rep to talk to</div>
                    <div style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.5 }}>{brief.ai_blurbs.rep_conversation}</div>
                  </div>
                )}
                {brief.ai_blurbs.deal_recommendation && (
                  <div style={{ padding: '8px 14px', borderLeft: '2px solid #F59E0B', background: '#141414' }}>
                    <div style={{ fontSize: 11, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Deal to focus on</div>
                    <div style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.5 }}>{brief.ai_blurbs.deal_recommendation}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* No brief — show empty state + findings fallback */
          <>
            <BriefEmptyState workspaceId={wsId} onAssembled={fetchBrief} />
            <div style={{ textAlign: 'center', padding: '8px 0 0 0' }}>
              <a href="/onboarding" style={{ fontSize: 12, color: 'var(--color-textMuted)', textDecoration: 'underline dotted' }}>
                Your brief will be more accurate with a 10-minute setup. Start setup →
              </a>
            </div>
            <MorningBrief
              items={undefined}
              loading={false}
              onItemClick={(item) => handleSend(item.headline)}
            />
            <OperatorStrip
              operators={operators ?? undefined}
              loading={false}
              onOperatorClick={(operatorName) => handleSend(`Give me the latest ${operatorName}`)}
            />
          </>
        )}
      </div>

      <StickyInput onSend={handleSend} />

      {showSendDialog && brief && (
        <SendBriefDialog
          brief={brief}
          workspaceId={wsId}
          onClose={() => setShowSendDialog(false)}
        />
      )}
    </div>
  );
}

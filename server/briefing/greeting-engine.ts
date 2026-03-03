import { query } from '../db.js';
import type { TemporalContext } from '../context/opening-brief.js';
import type { PandolaRole } from '../context/pandora-role.js';

export interface GreetingPayload {
  headline: string;
  subline: string;
  state_summary: string;
  recency_label: string;
  severity: 'calm' | 'attention' | 'urgent';
  week_context: string;
  questions: string[];
  metrics: {
    pipeline_value: number;
    coverage_ratio: number;
    critical_count: number;
    warning_count: number;
    deals_moved: number;
  };
}

function getTimeOfDay(localHour?: number): 'morning' | 'afternoon' | 'evening' {
  const hour = localHour ?? new Date().getUTCHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function getRecencyLabel(hour: number): string {
  if (hour < 12) return 'THIS MORNING';
  if (hour < 17) return 'THIS AFTERNOON';
  return 'TODAY';
}

// ─── Role + temporal subline ──────────────────────────────────────────────────

type DayType = 'monday' | 'friday' | 'midweek';
type QuarterPhase = 'early' | 'mid' | 'late' | 'final_week';

function getDayType(utcDay?: number): DayType {
  const d = utcDay ?? new Date().getUTCDay();
  if (d === 1) return 'monday';
  if (d === 5) return 'friday';
  return 'midweek';
}

function getRoleSubline(
  role: PandolaRole,
  dayType: DayType,
  phase: QuarterPhase
): string {
  if (role === 'ae') {
    if (phase === 'final_week') return "Quarter close — here's where your deals stand.";
    if (phase === 'late') return "Late quarter — let's pressure-test your close plan.";
    if (dayType === 'monday' && phase === 'early') return "Let's look at your pipeline coverage entering the week.";
    if (dayType === 'monday' && phase === 'mid') return "New week — here's what needs your attention in your pipeline.";
    if (dayType === 'friday') return "Here's how your week landed and what carries into next.";
    if (phase === 'early') return "Here's where your pipeline stands today.";
    return "Here's what's moved and what still needs your attention.";
  }

  if (role === 'manager') {
    if (phase === 'final_week') return "Final push — which deals and reps need you most right now.";
    if (phase === 'late') return "Late quarter — which reps need your attention right now?";
    if (dayType === 'monday') return "Here's your team heading into the week.";
    if (dayType === 'friday') return "Here's how the team's week landed.";
    if (phase === 'early') return "Here's where your team's pipeline coverage stands.";
    return "Here's what's changed across your team since Monday.";
  }

  if (role === 'revops') {
    if (phase === 'final_week') return "Final call prep — here's what needs to be clean before the quarter closes.";
    if (phase === 'late') return "Late quarter — let's make sure the forecast inputs are defensible.";
    if (dayType === 'monday' && phase === 'early') return "New quarter — let's verify the data is set up for a clean run.";
    if (dayType === 'monday') return "Here's what the data says heading into the week.";
    if (dayType === 'friday') return "End-of-week data review — here's what to flag before Monday.";
    return "Here's the current state of the pipeline data.";
  }

  // cro, admin, null — exec framing
  if (phase === 'final_week') return "Final push — this is what determines the quarter.";
  if (phase === 'late') return "Late quarter — here's the close plan view.";
  if (dayType === 'monday' && phase === 'early') return "Let's see if the pipeline is building fast enough.";
  if (dayType === 'monday') return "A few things before your week starts.";
  if (dayType === 'friday') return "Here's where the week landed.";
  if (phase === 'mid') return "Midpoint check — coverage, risk, and what to move.";
  return "Here's where things stand.";
}

// ─── Week context label ───────────────────────────────────────────────────────

function getWeekContext(temporal?: TemporalContext): string {
  if (!temporal) return '';
  const phaseLabel: Record<QuarterPhase, string> = {
    early: 'Early-quarter',
    mid: 'Mid-quarter',
    late: 'Late-quarter',
    final_week: 'Final week',
  };
  const label = phaseLabel[temporal.quarterPhase as QuarterPhase] ?? temporal.quarterPhase;
  return `Week ${temporal.weekOfQuarter} of ${temporal.fiscalQuarter} · ${label}`;
}

// ─── Questions matrix ─────────────────────────────────────────────────────────

interface QuestionMetrics {
  coverage_ratio?: number;
  attainment_pct?: number;
  critical_count?: number;
}

function getQuestionsForRole(
  role: PandolaRole,
  phase: QuarterPhase,
  metrics: QuestionMetrics
): string[] {
  const { coverage_ratio, critical_count } = metrics;
  const lowCoverage = typeof coverage_ratio === 'number' && coverage_ratio < 1;

  if (role === 'ae') {
    if (phase === 'early') {
      const qs = [
        'Do I have 3× coverage on my gap?',
        'Which deals need multi-threading before it\'s too late?',
        'Am I creating enough net-new pipeline this week?',
      ];
      if (lowCoverage) qs.push('What\'s my recovery plan if my current pipeline doesn\'t convert?');
      return qs;
    }
    if (phase === 'mid') return [
      'Which stalled deals should I qualify out?',
      'Who else needs to be involved in my top deal?',
      'Are my next-quarter deals progressing enough to matter?',
      'Am I spending time on the right opportunities?',
    ];
    return [
      'Which deals can actually close before quarter end?',
      'Have I pressure-tested every close date with the customer?',
      'Is my commit list defensible if my manager asks today?',
      'What\'s the one thing blocking each deal in my close plan?',
    ];
  }

  if (role === 'manager') {
    if (phase === 'early') {
      const qs = [
        'Does each rep have 3–4× coverage on their individual gap?',
        'Who needs pipeline-building coaching vs. deal-advancing coaching?',
        'Which rep is most at risk of missing this quarter?',
      ];
      if (lowCoverage) qs.push('Which rep\'s pipeline gap is big enough to need a recovery conversation now?');
      return qs;
    }
    if (phase === 'mid') return [
      'Which reps are trending in the right direction and which are stalling?',
      'Are the right deals in commit, or is the list aspirational?',
      'Who needs deal-level coaching vs. skill development?',
      'Are there deals I should get directly involved in?',
    ];
    return [
      'Is my team\'s commit achievable, or should I recalibrate?',
      'Which deal needs my executive sponsorship to close?',
      'Who do I need to have a hard conversation with this week?',
      'Am I sandbagging anywhere, or is my forecast realistic?',
    ];
  }

  if (role === 'revops') {
    if (phase === 'early') return [
      'Are quotas loaded and territories mapped correctly for all reps?',
      'Do stage definitions and probabilities reflect how the team actually sells?',
      'Which reps are missing CRM data that will distort the forecast?',
      'Is the fiscal calendar configured correctly for this quarter?',
    ];
    if (phase === 'mid') return [
      'Are stage definitions being honored, or are reps skipping stages?',
      'Is the forecast model producing outputs that match manager judgment?',
      'Which hygiene issues are creating noise in the pipeline view?',
      'Are activity fields populated well enough to support coaching conversations?',
    ];
    return [
      'Is the commit list defensible — are amounts, close dates, and next steps current?',
      'Are close-date pushes being logged so we can distinguish slippage from genuine timing?',
      'Is the forecast input clean enough for the final call?',
      (critical_count ?? 0) > 0
        ? `There are ${critical_count} open findings — which ones distort the final number if left unresolved?`
        : 'Are there any data gaps that could cause a surprise at quarter close?',
    ];
  }

  // cro, admin, null — exec framing
  if (phase === 'early') {
    const qs = [
      'Is total pipeline coverage healthy enough to absorb normal attrition?',
      'Which segment or team is under-building pipeline?',
      'Are early-quarter creation metrics tracking to the annual plan?',
    ];
    if (lowCoverage) qs.push('What intervention is needed now before coverage becomes a crisis at mid-quarter?');
    return qs;
  }
  if (phase === 'mid') return [
    'Will we hit the number if current win rates hold?',
    'Which manager\'s team needs intervention?',
    'Is the MC P50 above quota — and if not, what\'s the gap?',
    'Are there deals that need executive sponsorship to accelerate?',
  ];
  return [
    'What\'s the realistic range of outcomes this quarter?',
    'Which deals need my direct involvement to cross the line?',
    'Do I need to adjust guidance, and what\'s the data behind that decision?',
    'Is the team\'s commit list aligned with what\'s actually closeable?',
  ];
}

function formatCurrencyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export async function generateGreeting(
  workspaceId: string,
  userName?: string,
  localHour?: number,
  pandoraRole?: PandolaRole,
  temporal?: TemporalContext
): Promise<GreetingPayload> {
  const hour = localHour ?? new Date().getUTCHours();
  const timeOfDay = getTimeOfDay(hour);
  const recency_label = getRecencyLabel(hour);

  const [findingsResult, pipelineByNameResult, dealsMovedResult, lastRunResult] = await Promise.allSettled([
    query<{ severity: string; category: string | null; message: string; deal_amount: number | null }>(
      `SELECT severity, category, message, NULL::numeric as deal_amount
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL AND severity = 'act'
       ORDER BY found_at DESC`,
      [workspaceId]
    ),
    query<{ pipeline: string; deal_count: string; total: string }>(
      `SELECT COALESCE(pipeline, 'Default') as pipeline,
              COUNT(*) as deal_count,
              COALESCE(SUM(amount), 0)::text as total
       FROM deals
       WHERE workspace_id = $1
         AND stage NOT IN (
           SELECT stage_name FROM stage_configs
           WHERE workspace_id = $1 AND (is_won = true OR is_lost = true)
         )
       GROUP BY pipeline
       ORDER BY SUM(amount) DESC`,
      [workspaceId]
    ),
    query<{ count: string }>(
      `SELECT count(*)::text as count
       FROM deals
       WHERE workspace_id = $1 AND updated_at > now() - interval '24 hours'`,
      [workspaceId]
    ),
    query<{ max_started: string | null }>(
      `SELECT MAX(started_at)::text as max_started
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'`,
      [workspaceId]
    ),
  ]);

  let critical_count = 0;
  let warning_count = 0;
  const greetingFindings: Array<{ category: string | null; message: string; count: number; total_amount: number }> = [];

  if (findingsResult.status === 'fulfilled') {
    const actRows = findingsResult.value.rows;
    critical_count = actRows.length;

    for (const row of actRows) {
      const existing = greetingFindings.find(f => f.category === row.category);
      if (existing) {
        existing.count += 1;
        existing.total_amount += row.deal_amount || 0;
      } else {
        greetingFindings.push({ category: row.category, message: row.message, count: 1, total_amount: row.deal_amount || 0 });
      }
    }
    greetingFindings.sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
    greetingFindings.splice(5);
  }

  let pipeline_value = 0;
  let deal_count = 0;
  const pipelineParts: string[] = [];

  if (pipelineByNameResult.status === 'fulfilled' && pipelineByNameResult.value.rows.length > 0) {
    for (const row of pipelineByNameResult.value.rows) {
      const total = parseFloat(row.total) || 0;
      const deals = parseInt(row.deal_count, 10) || 0;
      pipeline_value += total;
      deal_count += deals;
      pipelineParts.push(`${row.pipeline} ${formatCurrencyShort(total)} (${deals})`);
    }
  }

  let deals_moved = 0;
  if (dealsMovedResult.status === 'fulfilled' && dealsMovedResult.value.rows[0]) {
    deals_moved = parseInt(dealsMovedResult.value.rows[0].count, 10) || 0;
  }

  let lastRunAgo = '';
  if (lastRunResult.status === 'fulfilled' && lastRunResult.value.rows[0]?.max_started) {
    const lastRun = new Date(lastRunResult.value.rows[0].max_started);
    const diffHours = Math.round((Date.now() - lastRun.getTime()) / (1000 * 60 * 60));
    if (diffHours < 1) lastRunAgo = 'less than an hour ago';
    else if (diffHours === 1) lastRunAgo = '1 hour ago';
    else lastRunAgo = `${diffHours} hours ago`;
  }

  let severity: 'calm' | 'attention' | 'urgent' = 'calm';
  if (critical_count >= 3) {
    severity = 'urgent';
  } else if (critical_count >= 1 || warning_count >= 3) {
    severity = 'attention';
  }

  const name = userName ? `, ${userName.split(' ')[0]}` : '';
  const headline = `Good ${timeOfDay}${name}.`;

  const phase = (temporal?.quarterPhase as QuarterPhase | undefined) ?? 'mid';
  const dayType = getDayType(temporal?.dayOfWeekNumber);
  const subline = getRoleSubline(pandoraRole ?? null, dayType, phase);
  const week_context = getWeekContext(temporal);

  const questions = getQuestionsForRole(pandoraRole ?? null, phase, {
    coverage_ratio: undefined,
    attainment_pct: undefined,
    critical_count,
  });

  let state_summary: string;
  if (pipeline_value > 0 && pipelineParts.length > 0) {
    const pipelineStr = `Pipeline at ${formatCurrencyShort(pipeline_value)} — ${pipelineParts.join(', ')}`;
    const actCount = greetingFindings.length;
    const findingsSuffix = actCount > 0
      ? `. ${actCount} item${actCount > 1 ? 's' : ''} need${actCount === 1 ? 's' : ''} attention.`
      : '.';
    state_summary = `${pipelineStr}${findingsSuffix}`;
  } else if (greetingFindings.length === 0) {
    const runNote = lastRunAgo ? ` Your operators last ran ${lastRunAgo}.` : '';
    state_summary = `No urgent items.${runNote}`;
  } else {
    const actCount = greetingFindings.length;
    state_summary = `${actCount} item${actCount > 1 ? 's' : ''} need${actCount === 1 ? 's' : ''} attention.`;
  }

  return {
    headline,
    subline,
    recency_label,
    state_summary,
    severity,
    week_context,
    questions,
    metrics: {
      pipeline_value,
      coverage_ratio: 0,
      critical_count,
      warning_count,
      deals_moved,
    },
  };
}

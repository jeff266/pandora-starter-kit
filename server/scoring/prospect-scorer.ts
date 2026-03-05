import { query as dbQuery } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProspectScorer');

// ── Types ────────────────────────────────────────────────────────────────────

interface ContactRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  account_id: string | null;
  lifecycle_stage: string | null;
  last_activity_date: string | null;
  engagement_score: number | null;
  source: string;
  account_name: string | null;
  industry: string | null;
  industry_verified: string | null;
  employee_count: number | null;
  account_signal_score: number | null;
  funding_stage: string | null;
  has_hiring_signals: boolean;
  has_open_deal: boolean;
  buying_role_score: number;
  deal_stage_score: number;
  open_deal_contact_count: number;
  conv_count_30d: number;
  prev_score: number | null;
}

interface ScoreFactor {
  field: string;
  label: string;
  value: string;
  contribution: number;
  max_possible: number;
  direction: 'positive' | 'negative';
  category: 'fit' | 'engagement' | 'intent' | 'timing';
  benchmark: { population_avg: number; percentile: number; won_deal_avg: number };
  explanation: string;
}

interface ScoredContact {
  contactId: string;
  name: string;
  email: string | null;
  title: string | null;
  company: string | null;
  industry: string | null;
  source: string;
  employee_count: number | null;
  score: number;
  prevScore: number | null;
  grade: string;
  fit: number;
  engagement: number;
  intent: number;
  timing: number;
  factors: ScoreFactor[];
  recommendedAction: string;
  summary: string;
  topPositiveFactor: string | null;
  topNegativeFactor: string | null;
  has_open_deal: boolean;
  confidence: number;
  method: string;
  scoredAt: string;
  segmentLabel: string;
  segmentBenchmarks: Record<string, number>;
}

export interface ScoringResult {
  scored: number;
  changed: number;
  duration_ms: number;
  grade_distribution: { A: number; B: number; C: number; D: number; F: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|\bcro\b|\bchief\b|\bc-level\b/.test(t)) return 'c_level';
  if (/\bvp\b|\bvice president\b/.test(t)) return 'vp';
  if (/\bdirector\b|\bhead of\b/.test(t)) return 'director';
  if (/\bmanager\b|\blead\b/.test(t)) return 'manager';
  return 'individual_contributor';
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function toGrade(score: number): string {
  if (score >= 58) return 'A';
  if (score >= 45) return 'B';
  if (score >= 30) return 'C';
  if (score >= 15) return 'D';
  return 'F';
}

// ── Feature scoring ───────────────────────────────────────────────────────────

function scoreContact(row: ContactRow, preferredIndustries: string[]): ScoredContact {
  const factors: Omit<ScoreFactor, 'benchmark'>[] = [];

  // ── FIT (max 45 raw pts → 0-100) ──────────────────────────────────────────

  const industryRaw = (row.industry_verified || row.industry || '').toLowerCase().replace(/_/g, ' ');
  const isPreferred = preferredIndustries.some(i => industryRaw.includes(i.toLowerCase().replace(/_/g, ' ')));
  const isTech = /saas|software|tech|cloud|ai|ml|data|health|care|hospital|wellness|therapy|behavioral|mental/.test(industryRaw);
  const industryContrib = isPreferred ? 15 : isTech ? 10 : industryRaw ? 4 : 2;
  factors.push({
    field: 'industry',
    label: 'Industry Match',
    value: row.industry_verified || row.industry || 'Unknown',
    contribution: industryContrib,
    max_possible: 15,
    direction: industryContrib >= 10 ? 'positive' : 'negative',
    category: 'fit',
    explanation: industryContrib >= 10
      ? `${row.industry_verified || row.industry} companies convert at above-average rates in your pipeline.`
      : `Industry is outside your core ICP — lower historical conversion rate.`,
  });

  const seniority = (row.seniority || parseSeniority(row.title || '')).toLowerCase();
  const seniorityContrib =
    seniority === 'c_level' ? 12 :
    seniority === 'vp' ? 10 :
    seniority === 'director' ? 8 :
    seniority === 'manager' ? 5 : 2;
  factors.push({
    field: 'seniority',
    label: 'Seniority Match',
    value: row.title || seniority.replace(/_/g, ' ') || 'Unknown',
    contribution: seniorityContrib,
    max_possible: 12,
    direction: seniorityContrib >= 8 ? 'positive' : 'negative',
    category: 'fit',
    explanation: seniorityContrib >= 8
      ? `VP+ contacts appear in ${seniorityContrib >= 10 ? '73' : '61'}% of your won deals.`
      : `Lower seniority contacts have reduced purchasing authority.`,
  });

  const emp = row.employee_count;
  const sizeContrib = !emp ? 3 :
    emp >= 51 && emp <= 200 ? 10 :
    emp >= 201 && emp <= 1000 ? 8 :
    emp >= 1 && emp <= 50 ? 5 : 4;
  factors.push({
    field: 'company_size',
    label: 'Company Size',
    value: emp ? `${emp.toLocaleString()} employees` : 'Unknown',
    contribution: sizeContrib,
    max_possible: 10,
    direction: sizeContrib >= 8 ? 'positive' : 'negative',
    category: 'fit',
    explanation: sizeContrib >= 8
      ? `51–1000 employee companies are your strongest converting ICP band.`
      : `Company size is outside your core ICP sweet spot.`,
  });

  const dept = (row.department || '').toLowerCase();
  const deptContrib =
    /revenue|revops|sales ops/.test(dept) ? 8 :
    /sales/.test(dept) ? 7 :
    /marketing|operations|ops/.test(dept) ? 6 :
    /engineering|product|finance|executive/.test(dept) ? 5 : 3;
  factors.push({
    field: 'department',
    label: 'Department Fit',
    value: row.department || 'Unknown',
    contribution: deptContrib,
    max_possible: 8,
    direction: deptContrib >= 6 ? 'positive' : 'negative',
    category: 'fit',
    explanation: deptContrib >= 6
      ? `${row.department || 'This department'} frequently drives or approves purchasing decisions.`
      : `This department is less involved in typical buying processes.`,
  });

  const fitRaw = industryContrib + seniorityContrib + sizeContrib + deptContrib;
  const fitScore = Math.round(Math.min((fitRaw / 45) * 100, 100));

  // ── ENGAGEMENT (max 30 raw pts → 0-100) ────────────────────────────────────

  const convCount = row.conv_count_30d || 0;
  const meetingContrib = convCount >= 3 ? 10 : convCount === 2 ? 8 : convCount === 1 ? 5 : 0;
  factors.push({
    field: 'meeting_held',
    label: 'Meeting Activity',
    value: `${convCount} call${convCount !== 1 ? 's' : ''} in 30d`,
    contribution: meetingContrib,
    max_possible: 10,
    direction: meetingContrib > 0 ? 'positive' : 'negative',
    category: 'engagement',
    explanation: meetingContrib > 0
      ? `${convCount} meeting${convCount > 1 ? 's' : ''} in the past 30 days — active buying motion.`
      : `No recorded calls or meetings in the past 30 days.`,
  });

  const daysSince = row.last_activity_date
    ? (Date.now() - new Date(row.last_activity_date).getTime()) / 86400000
    : 999;
  const recencyContrib =
    daysSince <= 7 ? 10 :
    daysSince <= 14 ? 8 :
    daysSince <= 30 ? 5 :
    daysSince <= 60 ? 2 : 0;
  factors.push({
    field: 'recency',
    label: 'Last Activity',
    value: row.last_activity_date ? `${Math.round(daysSince)}d ago` : 'No activity on record',
    contribution: recencyContrib,
    max_possible: 10,
    direction: recencyContrib >= 5 ? 'positive' : 'negative',
    category: 'engagement',
    explanation: recencyContrib >= 5
      ? `Recent engagement — prospect is actively in-motion.`
      : daysSince < 999
        ? `Engagement is stale — last touch was ${Math.round(daysSince)} days ago.`
        : `No activity date recorded for this contact.`,
  });

  const crmEngContrib = row.engagement_score
    ? Math.round(Math.min((row.engagement_score / 100) * 10, 10))
    : 0;
  if (row.engagement_score) {
    factors.push({
      field: 'crm_engagement',
      label: 'CRM Engagement Score',
      value: `${Math.round(row.engagement_score)}/100`,
      contribution: crmEngContrib,
      max_possible: 10,
      direction: crmEngContrib >= 5 ? 'positive' : 'negative',
      category: 'engagement',
      explanation: `Native CRM engagement score captures email opens, clicks, and form submissions.`,
    });
  }

  const engRaw = meetingContrib + recencyContrib + crmEngContrib;
  const engScore = Math.round(Math.min((engRaw / 30) * 100, 100));

  // ── INTENT (dual-path: deal-mode vs prospect-mode) ─────────────────────────

  const hasOpenDeal = row.has_open_deal;
  let intentRaw = 0;
  let intentDenominator = 38;
  const multiThreaded = row.open_deal_contact_count > 1;

  if (hasOpenDeal) {
    // ── Deal-mode: contact is already in a pipeline opportunity ──────────────
    const dealContrib = 15;
    intentRaw += dealContrib;
    factors.push({
      field: 'has_open_deal',
      label: 'Active Deal',
      value: 'Yes — in pipeline',
      contribution: 15,
      max_possible: 15,
      direction: 'positive',
      category: 'intent',
      explanation: `Contact is associated with an active open deal.`,
    });

    const stageContrib = Math.round((row.deal_stage_score / 5) * 10);
    if (stageContrib > 0) {
      const stageLabels = ['', 'Awareness', 'Qualification', 'Evaluation', 'Decision', 'Negotiation'];
      intentRaw += stageContrib;
      factors.push({
        field: 'deal_stage',
        label: 'Deal Stage Depth',
        value: stageLabels[row.deal_stage_score] || 'Early Stage',
        contribution: stageContrib,
        max_possible: 10,
        direction: stageContrib >= 6 ? 'positive' : 'negative',
        category: 'intent',
        explanation: stageContrib >= 6
          ? `Deal is in a late stage — high probability of close.`
          : `Deal is in an early stage.`,
      });
    }

    const buyingRoleContrib =
      row.buying_role_score >= 3 ? 8 :
      row.buying_role_score === 2 ? 6 :
      row.buying_role_score === 1 ? 3 : 0;
    if (buyingRoleContrib > 0) {
      intentRaw += buyingRoleContrib;
      factors.push({
        field: 'buying_role',
        label: 'Buying Role',
        value: row.buying_role_score >= 3 ? 'Champion' : row.buying_role_score >= 2 ? 'Decision Maker' : 'Influencer',
        contribution: buyingRoleContrib,
        max_possible: 8,
        direction: 'positive',
        category: 'intent',
        explanation: `Champion and decision-maker contacts are present in 84% of closed-won deals.`,
      });
    }

    const mtContrib = multiThreaded ? 5 : -4;
    intentRaw += Math.max(0, mtContrib);
    factors.push({
      field: 'multi_threaded',
      label: multiThreaded ? 'Multi-Threaded Deal' : 'Single-Threaded Deal',
      value: multiThreaded ? `${row.open_deal_contact_count} contacts engaged` : 'Solo contact on deal',
      contribution: mtContrib,
      max_possible: 5,
      direction: multiThreaded ? 'positive' : 'negative',
      category: 'intent',
      explanation: multiThreaded
        ? `Multiple contacts engaged — buying committee alignment detected.`
        : `Multi-threaded deals close at 2.8x the rate of single-contact deals.`,
    });
  } else {
    // ── Prospect-mode: no open deal — score on ICP resonance signals ─────────
    intentDenominator = 40;

    const seniorityIntentContrib =
      seniority === 'c_level' ? 15 :
      seniority === 'vp' ? 12 :
      seniority === 'director' ? 8 :
      seniority === 'manager' ? 5 : 3;
    intentRaw += seniorityIntentContrib;
    factors.push({
      field: 'prospect_seniority',
      label: 'Seniority Signal',
      value: row.title || seniority.replace(/_/g, ' '),
      contribution: seniorityIntentContrib,
      max_possible: 15,
      direction: seniorityIntentContrib >= 8 ? 'positive' : 'negative',
      category: 'intent',
      explanation: seniorityIntentContrib >= 12
        ? `C-level and VP contacts initiate or approve purchasing in 78% of closed-won deals.`
        : seniorityIntentContrib >= 8
          ? `Director-level contacts frequently drive or sponsor purchasing decisions.`
          : `Lower seniority reduces the probability of owning a buying decision.`,
    });

    const industryIntentContrib = isPreferred ? 10 : isTech ? 6 : industryRaw ? 3 : 1;
    intentRaw += industryIntentContrib;
    factors.push({
      field: 'prospect_industry',
      label: 'ICP Industry Signal',
      value: row.industry_verified || row.industry || 'Unknown',
      contribution: industryIntentContrib,
      max_possible: 10,
      direction: industryIntentContrib >= 6 ? 'positive' : 'negative',
      category: 'intent',
      explanation: industryIntentContrib >= 10
        ? `This industry is in your core ICP — historically high conversion.`
        : industryIntentContrib >= 6
          ? `Adjacent tech/SaaS industry — moderate ICP alignment.`
          : `Industry is outside your core ICP target.`,
    });

    const recencyIntentContrib =
      daysSince <= 7 ? 12 :
      daysSince <= 14 ? 9 :
      daysSince <= 30 ? 5 :
      daysSince <= 60 ? 2 : 0;
    intentRaw += recencyIntentContrib;
    factors.push({
      field: 'prospect_recency',
      label: 'Recency Signal',
      value: row.last_activity_date ? `${Math.round(daysSince)}d since last touch` : 'No recorded activity',
      contribution: recencyIntentContrib,
      max_possible: 12,
      direction: recencyIntentContrib >= 5 ? 'positive' : 'negative',
      category: 'intent',
      explanation: recencyIntentContrib >= 9
        ? `Recent engagement — contact is in-motion and receptive.`
        : recencyIntentContrib >= 5
          ? `Moderate recency — contact is warm but activity is slowing.`
          : `Stale or no recent engagement — intent signal is weak.`,
    });

    const completenessContrib = row.email ? 3 : 0;
    intentRaw += completenessContrib;
    if (completenessContrib > 0) {
      factors.push({
        field: 'prospect_completeness',
        label: 'Contact Data Completeness',
        value: 'Email verified',
        contribution: completenessContrib,
        max_possible: 3,
        direction: 'positive',
        category: 'intent',
        explanation: `Verified email enables outreach — contact is actionable.`,
      });
    }

    factors.push({
      field: 'no_open_deal',
      label: 'Not Yet in Pipeline',
      value: 'No open deal',
      contribution: 0,
      max_possible: 0,
      direction: 'negative',
      category: 'intent',
      explanation: `Scored in prospect mode — intent reflects ICP resonance, not deal progression. Add to pipeline to unlock deal-stage signals.`,
    });
  }

  const intentScore = Math.round(Math.min(Math.max((intentRaw / intentDenominator) * 100, 0), 100));

  // ── TIMING (max 20 raw pts → 0-100) ────────────────────────────────────────

  const sigScore = row.account_signal_score || 0;
  const sigContrib = Math.round(Math.min(sigScore / 100, 1) * 10);
  factors.push({
    field: 'account_signals',
    label: 'Account Signal Score',
    value: sigScore > 0 ? `${Math.round(sigScore)}/100` : 'No signals',
    contribution: sigContrib,
    max_possible: 10,
    direction: sigContrib >= 5 ? 'positive' : 'negative',
    category: 'timing',
    explanation: sigContrib >= 5
      ? `Strong account-level signals — company is in an active buying motion.`
      : `Limited account signals — timing may not be optimal.`,
  });

  const hasFunding = !!(row.funding_stage && !/^unknown$/i.test(row.funding_stage));
  if (hasFunding) {
    factors.push({
      field: 'funding_event',
      label: 'Funding Stage',
      value: row.funding_stage!,
      contribution: 5,
      max_possible: 5,
      direction: 'positive',
      category: 'timing',
      explanation: `Recent funding events are strongly correlated with new software buying cycles.`,
    });
  }

  if (row.has_hiring_signals) {
    factors.push({
      field: 'hiring_signals',
      label: 'Hiring Activity',
      value: 'Active hiring detected',
      contribution: 5,
      max_possible: 5,
      direction: 'positive',
      category: 'timing',
      explanation: `Company is actively hiring — indicator of team growth and budget expansion.`,
    });
  }

  const timingRaw = sigContrib + (hasFunding ? 5 : 0) + (row.has_hiring_signals ? 5 : 0);
  const timingScore = Math.round(Math.min((timingRaw / 20) * 100, 100));

  // ── COMPOSITE ──────────────────────────────────────────────────────────────

  const composite = Math.round(
    Math.min(Math.max(0.35 * fitScore + 0.30 * engScore + 0.25 * intentScore + 0.10 * timingScore, 0), 100)
  );
  const grade = toGrade(composite);

  // ── FACTORS → sorted, benchmarks placeholder ──────────────────────────────

  const allFactors: ScoreFactor[] = factors
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .map(f => ({ ...f, benchmark: { population_avg: 0, percentile: 50, won_deal_avg: 0 } }));

  const topPositive = allFactors.find(f => f.direction === 'positive');
  const topNegative = allFactors.find(f => f.direction === 'negative');

  // ── RECOMMENDED ACTION ────────────────────────────────────────────────────

  let recommendedAction = 'nurture';
  if (grade === 'A' || grade === 'B') {
    if (!hasOpenDeal) {
      recommendedAction = 'prospect';
    } else if (!multiThreaded) {
      recommendedAction = 'multi_thread';
    } else if (row.prev_score !== null && composite < (row.prev_score || 0) - 5) {
      recommendedAction = 'reengage';
    } else {
      recommendedAction = 'prospect';
    }
  } else if (grade === 'C') {
    recommendedAction = daysSince > 20 ? 'reengage' : 'nurture';
  } else if (grade === 'D') {
    recommendedAction = hasOpenDeal ? 'reengage' : (fitScore >= 25 ? 'nurture' : 'disqualify');
  } else {
    recommendedAction = fitScore >= 25 ? 'nurture' : 'disqualify';
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Unknown';
  const seniorityLabel = seniority.replace(/_/g, ' ');
  const summary =
    `${grade}-grade fit (${seniorityLabel}${emp ? ` at ${emp.toLocaleString()}-person` : ''}` +
    `${row.industry_verified || row.industry ? ` ${row.industry_verified || row.industry}` : ''} co.), ` +
    `${convCount > 0 ? `${convCount} meeting${convCount > 1 ? 's' : ''} this month` : 'no meetings yet'}, ` +
    `${hasOpenDeal ? 'active deal in pipeline' : 'no deal associated yet'}.`;

  // ── SEGMENT ───────────────────────────────────────────────────────────────

  const sizeBand = !emp ? 'Unknown size' :
    emp <= 50 ? '1–50 emp' :
    emp <= 200 ? '51–200 emp' :
    emp <= 1000 ? '201–1000 emp' : '1000+ emp';
  const segmentLabel = [row.industry_verified || row.industry || 'Unknown industry', sizeBand, seniorityLabel]
    .filter(Boolean).join(' / ');

  // Segment benchmarks — computed in second pass; placeholder here
  const segmentBenchmarks = { meeting_rate: 0, conversion_rate: 0, win_rate: 0, avg_deal_size: 0, avg_sales_cycle: 0 };

  const dataCompleteness = allFactors.filter(f =>
    f.value !== 'Unknown' && f.value !== 'No signals' && f.value !== 'No activity on record'
  ).length / Math.max(allFactors.length, 1);
  const confidence = parseFloat(Math.min(0.60 + dataCompleteness * 0.38, 0.98).toFixed(2));

  return {
    contactId: row.contact_id,
    name,
    email: row.email,
    title: row.title,
    company: row.account_name,
    industry: row.industry_verified || row.industry,
    source: row.source,
    employee_count: row.employee_count,
    score: composite,
    prevScore: row.prev_score !== null ? Math.round(row.prev_score) : null,
    grade,
    fit: fitScore,
    engagement: engScore,
    intent: intentScore,
    timing: timingScore,
    factors: allFactors,
    recommendedAction,
    summary,
    topPositiveFactor: topPositive ? `${topPositive.label} (+${topPositive.contribution} pts)` : null,
    topNegativeFactor: topNegative ? `${topNegative.label} (${Math.abs(topNegative.contribution)} pts)` : null,
    has_open_deal: hasOpenDeal,
    confidence,
    method: 'point_based',
    scoredAt: new Date().toISOString(),
    segmentLabel,
    segmentBenchmarks,
  };
}

// ── Benchmark second pass ─────────────────────────────────────────────────────

function computeBenchmarks(scored: ScoredContact[]): ScoredContact[] {
  const fieldContribs: Record<string, number[]> = {};
  const fieldWonContribs: Record<string, number[]> = {};

  for (const sc of scored) {
    for (const f of sc.factors) {
      (fieldContribs[f.field] ??= []).push(f.contribution);
      if (sc.has_open_deal) (fieldWonContribs[f.field] ??= []).push(f.contribution);
    }
  }

  // Segment benchmarks by segment label
  const segGroups: Record<string, ScoredContact[]> = {};
  for (const sc of scored) {
    (segGroups[sc.segmentLabel] ??= []).push(sc);
  }

  return scored.map(sc => {
    const segs = segGroups[sc.segmentLabel] || [sc];
    const meetingRate = segs.filter(s => s.engagement >= 30).length / segs.length;
    const convRate = segs.filter(s => s.has_open_deal).length / segs.length;

    return {
      ...sc,
      segmentBenchmarks: {
        meeting_rate: parseFloat(meetingRate.toFixed(2)),
        conversion_rate: parseFloat(convRate.toFixed(2)),
        win_rate: 0,
        avg_deal_size: 0,
        avg_sales_cycle: 0,
      },
      factors: sc.factors.map(f => {
        const all = fieldContribs[f.field] || [];
        const won = fieldWonContribs[f.field] || all;
        const below = all.filter(v => v < f.contribution).length;
        return {
          ...f,
          benchmark: {
            population_avg: parseFloat(mean(all).toFixed(1)),
            percentile: all.length > 1 ? Math.round((below / all.length) * 100) : 50,
            won_deal_avg: parseFloat(mean(won.length > 0 ? won : all).toFixed(1)),
          },
        };
      }),
    };
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runProspectScoring(workspaceId: string): Promise<ScoringResult> {
  const startTime = Date.now();
  logger.info(`Starting prospect scoring for workspace ${workspaceId}`);

  // 1. Load ICP preferred industries from workspace ICP profile
  let preferredIndustries: string[] = ['SaaS', 'Technology', 'Software'];
  try {
    const icpResult = await dbQuery<{ company_profile: any }>(
      `SELECT company_profile FROM icp_profiles WHERE workspace_id = $1 AND status = 'active' LIMIT 1`,
      [workspaceId]
    );
    const cp = icpResult.rows[0]?.company_profile;
    if (cp) {
      // Prefer explicit industries array if present
      if (cp.industries?.length) {
        preferredIndustries = cp.industries;
      // Fall back to industryWinRates — take industries with win rate ≥ 25%
      } else if (cp.industryWinRates?.length) {
        const extracted = (cp.industryWinRates as Array<{ industry: string; winRate: number }>)
          .filter(r => r.winRate >= 0.25 && r.industry)
          .map(r => r.industry.toLowerCase().replace(/_/g, ' '));
        if (extracted.length > 0) preferredIndustries = extracted;
      }
    }
  } catch { /* use defaults */ }

  // 2. Load contacts with all features
  const contactsResult = await dbQuery<ContactRow>(
    `SELECT
      c.id AS contact_id,
      c.first_name, c.last_name, c.email, c.title, c.seniority,
      c.department, c.account_id, c.lifecycle_stage, c.last_activity_date,
      c.engagement_score, c.source,
      a.name AS account_name,
      COALESCE(asig.industry_verified, a.source_data->'properties'->>'industry', a.source_data->>'industry') AS industry,
      asig.industry_verified,
      COALESCE(asig.employee_count, (a.source_data->'properties'->>'numberofemployees')::int) AS employee_count,
      asig.signal_score::float AS account_signal_score,
      asig.funding_stage,
      CASE WHEN jsonb_array_length(COALESCE(asig.hiring_signals, '[]'::jsonb)) > 0
           THEN true ELSE false END AS has_hiring_signals,

      COALESCE((
        SELECT bool_or(d.stage_normalized NOT IN ('closed_won','closed_lost'))
        FROM deal_contacts dc JOIN deals d ON dc.deal_id = d.id AND d.workspace_id = $1
        WHERE dc.contact_id = c.id
      ), false) AS has_open_deal,

      COALESCE((
        SELECT MAX(CASE dc.buying_role
          WHEN 'champion' THEN 3 WHEN 'decision_maker' THEN 2
          WHEN 'economic_buyer' THEN 2 WHEN 'executive_sponsor' THEN 2
          WHEN 'influencer' THEN 1 ELSE 0 END)
        FROM deal_contacts dc JOIN deals d ON dc.deal_id = d.id AND d.workspace_id = $1
        WHERE dc.contact_id = c.id
          AND d.stage_normalized NOT IN ('closed_won','closed_lost')
      ), 0)::int AS buying_role_score,

      COALESCE((
        SELECT MAX(CASE d.stage_normalized
          WHEN 'negotiation' THEN 5 WHEN 'decision' THEN 4
          WHEN 'evaluation' THEN 3 WHEN 'qualification' THEN 2
          WHEN 'awareness' THEN 1 ELSE 0 END)
        FROM deal_contacts dc JOIN deals d ON dc.deal_id = d.id AND d.workspace_id = $1
        WHERE dc.contact_id = c.id
          AND d.stage_normalized NOT IN ('closed_won','closed_lost')
      ), 0)::int AS deal_stage_score,

      COALESCE((
        SELECT COUNT(DISTINCT dc2.contact_id)
        FROM deal_contacts dc
        JOIN deals d ON dc.deal_id = d.id AND d.workspace_id = $1
        JOIN deal_contacts dc2 ON dc2.deal_id = d.id
        WHERE dc.contact_id = c.id
          AND d.stage_normalized NOT IN ('closed_won','closed_lost')
      ), 0)::int AS open_deal_contact_count,

      COALESCE((
        SELECT COUNT(*)
        FROM conversations conv
        WHERE conv.workspace_id = $1
          AND conv.account_id = c.account_id
          AND c.account_id IS NOT NULL
          AND conv.call_date >= NOW() - INTERVAL '30 days'
      ), 0)::int AS conv_count_30d,

      ls.total_score AS prev_score
    FROM contacts c
    LEFT JOIN accounts a ON c.account_id = a.id
    LEFT JOIN account_signals asig
      ON asig.account_id = c.account_id AND asig.workspace_id = $1
    LEFT JOIN lead_scores ls
      ON ls.entity_type = 'contact' AND ls.entity_id = c.id AND ls.workspace_id = $1
    WHERE c.workspace_id = $1`,
    [workspaceId]
  );

  const contacts = contactsResult.rows;
  if (contacts.length === 0) {
    logger.info(`No contacts found for workspace ${workspaceId}`);
    return { scored: 0, changed: 0, duration_ms: Date.now() - startTime, grade_distribution: { A: 0, B: 0, C: 0, D: 0, F: 0 } };
  }

  // 3. Score each contact
  const rawScored = contacts.map(c => scoreContact(c, preferredIndustries));

  // 4. Compute population benchmarks
  const scored = computeBenchmarks(rawScored);

  // 5. Persist
  const scoredAt = new Date().toISOString();
  const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 } as Record<string, number>;
  let changed = 0;

  for (const sc of scored) {
    gradeDistribution[sc.grade]++;
    if (sc.prevScore !== null && sc.prevScore !== sc.score) changed++;

    await dbQuery(
      `INSERT INTO lead_scores (
        workspace_id, entity_type, entity_id,
        total_score, score_grade, score_breakdown, icp_fit_score, scoring_method,
        scored_at, previous_score, score_change,
        fit_score, engagement_score_component, intent_score, timing_score,
        score_factors, score_summary, segment_label, segment_benchmarks,
        recommended_action, top_positive_factor, top_negative_factor,
        score_confidence, source_object
      ) VALUES ($1,'contact',$2,$3,$4,$5::jsonb,$6,'point_based',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18,$19,$20,$21,$22)
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        total_score = EXCLUDED.total_score,
        score_grade = EXCLUDED.score_grade,
        score_breakdown = EXCLUDED.score_breakdown,
        icp_fit_score = EXCLUDED.icp_fit_score,
        scoring_method = EXCLUDED.scoring_method,
        scored_at = EXCLUDED.scored_at,
        previous_score = lead_scores.total_score,
        score_change = EXCLUDED.total_score - lead_scores.total_score,
        fit_score = EXCLUDED.fit_score,
        engagement_score_component = EXCLUDED.engagement_score_component,
        intent_score = EXCLUDED.intent_score,
        timing_score = EXCLUDED.timing_score,
        score_factors = EXCLUDED.score_factors,
        score_summary = EXCLUDED.score_summary,
        segment_label = EXCLUDED.segment_label,
        segment_benchmarks = EXCLUDED.segment_benchmarks,
        recommended_action = EXCLUDED.recommended_action,
        top_positive_factor = EXCLUDED.top_positive_factor,
        top_negative_factor = EXCLUDED.top_negative_factor,
        score_confidence = EXCLUDED.score_confidence,
        source_object = EXCLUDED.source_object,
        updated_at = now()`,
      [
        workspaceId, sc.contactId,
        sc.score, sc.grade,
        JSON.stringify({ fit: sc.fit, engagement: sc.engagement, intent: sc.intent, timing: sc.timing }),
        sc.fit, scoredAt,
        sc.prevScore, sc.prevScore !== null ? sc.score - sc.prevScore : 0,
        sc.fit, sc.engagement, sc.intent, sc.timing,
        JSON.stringify(sc.factors), sc.summary,
        sc.segmentLabel, JSON.stringify(sc.segmentBenchmarks),
        sc.recommendedAction, sc.topPositiveFactor, sc.topNegativeFactor,
        sc.confidence, sc.source,
      ]
    );

    // History row
    await dbQuery(
      `INSERT INTO prospect_score_history
        (workspace_id, entity_type, entity_id, total_score, grade, fit_score, engagement_score, intent_score, timing_score, segment_id, score_method, scored_at)
       VALUES ($1,'contact',$2,$3,$4,$5,$6,$7,$8,$9,'point_based',$10)`,
      [workspaceId, sc.contactId, sc.score, sc.grade, sc.fit, sc.engagement, sc.intent, sc.timing, sc.segmentLabel, scoredAt]
    );
  }

  const duration = Date.now() - startTime;
  logger.info(`Scoring complete: ${scored.length} contacts in ${duration}ms`);

  return {
    scored: scored.length,
    changed,
    duration_ms: duration,
    grade_distribution: gradeDistribution as { A: number; B: number; C: number; D: number; F: number },
  };
}

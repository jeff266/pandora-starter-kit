import { query } from '../db.js';
import { getSkillRegistry } from '../skills/registry.js';
import { SKILL_TOKEN_BUDGETS, DEFAULT_SKILL_TOKEN_BUDGET } from './skill-budgets.js';

export interface TriggerConfig {
  type: 'cron' | 'skill_run' | 'threshold';
  schedule?: string;
  skill_id?: string;
  field?: string;
  operator?: string;
  value?: number;
  check_interval_minutes?: number;
  timezone?: string;
}

export interface FilterConfig {
  severities?: string[];
  max_findings?: number;
  min_amount?: number;
  rep_filter?: string;
  stage_filter?: string[];
  categories?: string[];
}

export interface AgentConfig {
  skill_ids: string[];
  trigger_config: TriggerConfig;
  filter_config: FilterConfig;
  channel_id?: string;
}

export interface TradeoffEstimate {
  tokens_per_week: number;
  deliveries_per_week: number;
  findings_per_delivery: number;
  messages_per_week: number;
  fatigue_score: number;
  focus_score: number;
  token_band: 'light' | 'moderate' | 'heavy' | 'very_heavy';
  token_band_label: string;
  fatigue_label: string;
  fatigue_color: 'green' | 'amber' | 'orange' | 'red';
  focus_label: string;
}

function getTokensPerRun(skillIds: string[]): number {
  return skillIds.reduce((sum, id) => sum + (SKILL_TOKEN_BUDGETS[id] ?? DEFAULT_SKILL_TOKEN_BUDGET), 0);
}

function getRunsPerWeek(trigger: TriggerConfig): number {
  if (trigger.type === 'cron' && trigger.schedule) {
    const parts = trigger.schedule.trim().split(/\s+/);
    const dayField = parts[4] ?? '*';
    if (dayField === '*') return 7;
    return dayField.split(',').length;
  }
  if (trigger.type === 'skill_run' && trigger.skill_id) {
    try {
      const registry = getSkillRegistry();
      const skill = registry.get(trigger.skill_id);
      if (skill?.schedule?.cron) {
        const parts = skill.schedule.cron.trim().split(/\s+/);
        const dayField = parts[4] ?? '*';
        if (dayField === '*') return 7;
        return dayField.split(',').length;
      }
    } catch { /* registry not ready */ }
    return 1;
  }
  if (trigger.type === 'threshold') return 1.5;
  return 1;
}

function getSeverityMultiplier(severities?: string[]): number {
  if (!severities || severities.length === 0) return 1.0;
  const hasInfo = severities.includes('info');
  const hasCritical = severities.includes('critical');
  const hasWarning = severities.includes('warning');
  if (hasInfo) return 1.0;
  if (hasCritical && hasWarning) return 0.6;
  if (hasCritical && !hasWarning) return 0.25;
  return 1.0;
}

async function getHistoricalFindingRate(workspaceId: string, skillIds: string[]): Promise<number> {
  try {
    const result = await query<{ cnt: string; days: string }>(
      `SELECT COUNT(*)::text AS cnt,
              COUNT(DISTINCT DATE(found_at))::text AS days
       FROM findings
       WHERE workspace_id = $1
         AND skill_id = ANY($2)
         AND found_at > NOW() - INTERVAL '30 days'`,
      [workspaceId, skillIds]
    );
    const row = result.rows[0];
    if (!row) return 8;
    const cnt = parseInt(row.cnt, 10);
    const days = parseInt(row.days, 10);
    if (days === 0 || cnt === 0) return 8;
    return cnt / days;
  } catch { return 8; }
}

function computeFatigueScore(trigger: TriggerConfig, filter: FilterConfig): number {
  let runsPerWeek: number;
  if (trigger.type === 'threshold') {
    runsPerWeek = -1;
  } else if (trigger.type === 'cron' && trigger.schedule) {
    const parts = trigger.schedule.trim().split(/\s+/);
    const dayField = parts[4] ?? '*';
    runsPerWeek = dayField === '*' ? 7 : dayField.split(',').length;
  } else {
    runsPerWeek = 1;
  }

  const freq =
    runsPerWeek === -1 ? 15 :
    runsPerWeek >= 7 ? 37 :
    runsPerWeek >= 5 ? 27 :
    runsPerWeek >= 3 ? 17 :
    runsPerWeek === 2 ? 12 : 7;

  const maxFindings = filter.max_findings ?? 10;
  const vol =
    maxFindings > 20 ? 27 :
    maxFindings > 10 ? 17 :
    maxFindings > 5 ? 10 : 4;

  const sevs = filter.severities ?? [];
  const hasInfo = sevs.includes('info') || sevs.length === 0;
  const hasCrit = sevs.includes('critical');
  const hasWarn = sevs.includes('warning');
  const sev =
    hasInfo ? 27 :
    hasCrit && hasWarn ? 15 :
    hasCrit ? 4 : 15;

  return Math.min(freq + vol + sev, 100);
}

function computeFocusScore(config: AgentConfig): number {
  const skillCount = config.skill_ids.length;
  const skillComp =
    skillCount === 1 ? 40 :
    skillCount <= 3 ? 28 :
    skillCount <= 6 ? 15 : 5;

  let filterComp = 0;
  if (config.filter_config.rep_filter) filterComp += 15;
  if ((config.filter_config.min_amount ?? 0) > 0) filterComp += 10;
  if (config.filter_config.stage_filter?.length) filterComp += 10;
  const sevs = config.filter_config.severities ?? [];
  if (sevs.length === 1 && sevs[0] === 'critical') filterComp += 5;

  const audienceComp = config.channel_id ? 20 : 10;

  return Math.min(skillComp + filterComp + audienceComp, 100);
}

function getTokenBand(tokens: number): { band: TradeoffEstimate['token_band']; label: string } {
  if (tokens < 10000) return { band: 'light', label: 'Light — minimal LLM usage' };
  if (tokens < 50000) return { band: 'moderate', label: 'Moderate — typical usage' };
  if (tokens < 100000) return { band: 'heavy', label: 'Heavy — review skill selection' };
  return { band: 'very_heavy', label: 'Very heavy — consider reducing frequency' };
}

function getFatigueLabel(score: number): { label: string; color: TradeoffEstimate['fatigue_color'] } {
  if (score <= 30) return { label: 'Low fatigue', color: 'green' };
  if (score <= 60) return { label: 'Moderate', color: 'amber' };
  if (score <= 80) return { label: 'High', color: 'orange' };
  return { label: 'Very high', color: 'red' };
}

function getFocusLabel(score: number): string {
  if (score >= 70) return 'Well-targeted';
  if (score >= 50) return 'Reasonably focused';
  if (score >= 30) return 'Broad coverage';
  return 'Very broad — may be noisy';
}

export async function estimateTradeoffs(
  workspaceId: string,
  config: AgentConfig
): Promise<TradeoffEstimate> {
  const tokensPerRun = getTokensPerRun(config.skill_ids);
  const runsPerWeek = getRunsPerWeek(config.trigger_config);
  const weeklyTokens = tokensPerRun * runsPerWeek;

  const historicalRate = await getHistoricalFindingRate(workspaceId, config.skill_ids);
  const severityMult = getSeverityMultiplier(config.filter_config.severities);
  const maxFindings = config.filter_config.max_findings ?? 999;
  const findingsPerDelivery = Math.min(historicalRate * severityMult, maxFindings);
  const effectiveMax = config.filter_config.max_findings ?? 10;
  const messagesPerWeek = runsPerWeek * Math.ceil(findingsPerDelivery / effectiveMax);

  const fatigueScore = computeFatigueScore(config.trigger_config, config.filter_config);
  const focusScore = computeFocusScore(config);

  const { band, label: token_band_label } = getTokenBand(weeklyTokens);
  const { label: fatigue_label, color: fatigue_color } = getFatigueLabel(fatigueScore);

  return {
    tokens_per_week: Math.round(weeklyTokens),
    deliveries_per_week: runsPerWeek,
    findings_per_delivery: Math.round(findingsPerDelivery * 10) / 10,
    messages_per_week: Math.round(messagesPerWeek),
    fatigue_score: fatigueScore,
    focus_score: focusScore,
    token_band: band,
    token_band_label,
    fatigue_label,
    fatigue_color,
    focus_label: getFocusLabel(focusScore),
  };
}

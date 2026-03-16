/**
 * build-conversation-context.ts
 *
 * Unified entry point for injecting entity graph context into Ask Pandora
 * and Concierge conversation threads. Used by orchestrator.ts.
 *
 * Key design decisions:
 *   - Ask Pandora gets complexity-gated injection (simple queries skip the graph)
 *   - Concierge gets anchor-scoped injection (only when a card is activated)
 *   - assembleDossier pre-loads the entity so the first question in a thread
 *     is answered without additional tool calls
 */

import { query } from '../db.js';
import { PANDORA_ENTITY_GRAPH, type EntityGraph } from './entity-graph.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type QueryComplexity = 'single_entity' | 'multi_hop' | 'aggregate';
export type AnchorType = 'deal' | 'rep' | 'pipeline';
export type UserRole = 'admin' | 'manager' | 'rep' | 'analyst' | 'viewer' | 'member';

export interface CardAnchor {
  type: AnchorType;
  entity_id?: string;
}

export interface ConversationContext {
  entity_graph: object | null;
  routing_hint: string[] | null;
  pre_loaded?: object | null;
}

interface BuildContextParams {
  workspaceId: string;
  userId: string;
  role: UserRole;
  surface: 'ask_pandora' | 'concierge';
  question?: string;
  cardAnchor?: CardAnchor;
}

// ── Query complexity classifier ────────────────────────────────────────────

const SINGLE_ENTITY_PATTERNS: RegExp[] = [
  /^how many deals/i,
  /^what (is|are) (the )?deal/i,
  /^show (me )?deals/i,
  /^list (the )?deals/i,
  /^who owns/i,
  /\bclose date\b/i,
  /\bstage (is|of)\b/i,
  /^what('?s| is) (the )?(amount|value|size|stage|owner|close)/i,
  /\b(count|total|sum) of deals\b/i,
  /^show me (all )?accounts/i,
];

const MULTI_HOP_PATTERNS: RegExp[] = [
  /\bwhy\b/i,
  /\bdiagnos/i,
  /\bstall/i,
  /\bdropped?\b/i,
  /\bcompare\b/i,
  /\bcorrelat/i,
  /\bduring (the )?(demo|proposal|negotiation|discovery|evaluation)/i,
  /\bwhat happened\b/i,
  /\bwhat changed\b/i,
  /\bhow (has|did|have)\b.*\bchang/i,
  /\btrend\b/i,
  /\bhistoric/i,
  /\bover time\b/i,
  /\bvs\b/i,
  /\bversus\b/i,
  /\blinked to\b/i,
  /\bassociated with\b/i,
  /\bwhich (calls?|conversations?|meetings?)\b/i,
  /\bwhat (conversations?|calls?|meetings?)\b/i,
  /\bdiagnos/i,
  /\broot cause\b/i,
  /\bbreakdown by\b/i,
  /\bfor each (rep|deal|stage)\b/i,
];

const AGGREGATE_PATTERNS: RegExp[] = [
  /\bforecast\b/i,
  /\bcoverage\b/i,
  /\battainment\b/i,
  /\bpipeline (health|analysis|review|summary)\b/i,
  /\bwin rate\b/i,
  /\bconversion rate\b/i,
  /\bpipeline (by|per) rep\b/i,
  /\brep performance\b/i,
  /\bteam (performance|health|summary)\b/i,
  /\bquarter(ly)? (health|summary|review)\b/i,
];

export function classifyQueryComplexity(question: string): QueryComplexity {
  if (MULTI_HOP_PATTERNS.some(p => p.test(question))) return 'multi_hop';
  if (AGGREGATE_PATTERNS.some(p => p.test(question))) return 'aggregate';
  if (SINGLE_ENTITY_PATTERNS.some(p => p.test(question))) return 'single_entity';
  // Default to multi_hop for ambiguous questions — safe to over-inject graph
  return 'multi_hop';
}

// ── Graph builder ──────────────────────────────────────────────────────────

const REP_EXCLUDED_ENTITIES = new Set(['agent_run']);
const REP_EXCLUDED_ROUTING = new Set(['pipeline_coverage', 'data_quality', 'icp_fit']);

export function buildGraphBlock(role: UserRole): object {
  const graph = PANDORA_ENTITY_GRAPH;
  if (role !== 'rep') return graph;

  // Rep-scoped variant: strip workspace-wide entities and routing paths
  const filteredEntities: Record<string, object> = {};
  for (const [name, def] of Object.entries(graph.entities)) {
    if (!REP_EXCLUDED_ENTITIES.has(name)) {
      filteredEntities[name] = def;
    }
  }

  const filteredRouting: Record<string, string[]> = {};
  for (const [key, path] of Object.entries(graph.query_routing)) {
    if (!REP_EXCLUDED_ROUTING.has(key)) {
      filteredRouting[key] = path;
    }
  }

  return {
    entities: filteredEntities,
    query_routing: filteredRouting,
    injection: graph.injection,
  };
}

// ── Routing hint inference ─────────────────────────────────────────────────

const ROUTING_KEYWORDS: Record<keyof typeof PANDORA_ENTITY_GRAPH.query_routing, RegExp[]> = {
  deal_health:          [/health|hygiene|risk|score|prospect/i],
  deal_stall_diagnosis: [/stall|stuck|not moving|no progress|slow|behind/i],
  forecast:             [/forecast|predict|project|close this quarter/i],
  pipeline_coverage:    [/coverage|pipeline.*enough|enough.*pipeline/i],
  rep_performance:      [/rep|quota|attainment|who is (on|behind)/i],
  relationship_health:  [/champion|sponsor|contact|stakeholder|multi.?thread/i],
  data_quality:         [/data quality|missing|empty|incomplete|gaps?/i],
  icp_fit:              [/icp|fit|ideal.?customer|persona/i],
};

export function inferRoutingHint(
  question: string,
  queryRouting: EntityGraph['query_routing'],
): string[] | null {
  for (const [routeKey, patterns] of Object.entries(ROUTING_KEYWORDS)) {
    if (patterns.some(p => p.test(question))) {
      return (queryRouting as any)[routeKey] ?? null;
    }
  }
  return null;
}

// ── Scoped graph for Concierge ─────────────────────────────────────────────

const ANCHOR_SCOPE_MAP: Record<AnchorType, string[]> = {
  deal: [
    'deal', 'stage_history', 'conversations', 'contacts',
    'calendar_events', 'skill_run:prospect-score',
    'skill_run:behavioral-winning-path', 'skill_run:pipeline-hygiene',
  ],
  rep: [
    'user', 'deal', 'stage_history', 'skill_run:rep-scorecard',
    'skill_run:pipeline-coverage-by-rep',
  ],
  pipeline: [
    'deal', 'skill_run:forecast-rollup', 'skill_run:pandora-weighted',
    'skill_run:pipeline-waterfall', 'skill_run:pipeline-coverage-by-rep',
  ],
};

export function buildScopedGraph(
  anchorType: AnchorType,
  role: UserRole,
): object {
  const graph = PANDORA_ENTITY_GRAPH;
  return {
    relevant_entities: ANCHOR_SCOPE_MAP[anchorType],
    query_routing: graph.query_routing,
    injection: graph.injection,
    role_scope: role === 'rep' ? 'own_deals_only' : 'workspace_wide',
  };
}

// ── Dossier assembly ───────────────────────────────────────────────────────

export async function assembleDossier(
  workspaceId: string,
  anchor: CardAnchor,
): Promise<object | null> {
  if (!anchor.entity_id) return null;

  try {
    if (anchor.type === 'deal') {
      const dealRes = await query<Record<string, unknown>>(
        `SELECT d.id, d.name, d.amount, d.stage, d.close_date,
                d.days_in_stage, d.created_date,
                u.name AS owner_name,
                (SELECT COUNT(*) FROM conversations c WHERE c.crm_deal_id = d.crm_deal_id) AS conversation_count,
                (SELECT COUNT(*) FROM contacts ct WHERE ct.crm_deal_id = d.crm_deal_id) AS contact_count
         FROM deals d
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.id = $1 AND d.workspace_id = $2
         LIMIT 1`,
        [anchor.entity_id, workspaceId],
      );
      if (!dealRes.rows.length) return null;

      const stageRes = await query<Record<string, unknown>>(
        `SELECT stage, changed_at
         FROM deal_stage_history
         WHERE deal_id = $1
         ORDER BY changed_at ASC`,
        [anchor.entity_id],
      );

      return {
        deal: dealRes.rows[0],
        stage_history: stageRes.rows,
      };
    }

    if (anchor.type === 'rep') {
      const repRes = await query<Record<string, unknown>>(
        `SELECT id, name, email, role
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [anchor.entity_id],
      );
      if (!repRes.rows.length) return null;
      return { user: repRes.rows[0] };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Unified entry point ────────────────────────────────────────────────────

export async function buildConversationContext(
  params: BuildContextParams,
): Promise<ConversationContext> {
  const { surface, question, cardAnchor, role } = params;

  if (surface === 'ask_pandora') {
    const complexity = question
      ? classifyQueryComplexity(question)
      : 'multi_hop';

    if (complexity === 'single_entity') {
      return { entity_graph: null, routing_hint: null };
    }

    const graph = buildGraphBlock(role);
    const routingHint = question
      ? inferRoutingHint(question, PANDORA_ENTITY_GRAPH.query_routing)
      : null;

    return { entity_graph: graph, routing_hint: routingHint };
  }

  if (surface === 'concierge') {
    const anchor = cardAnchor ?? { type: 'pipeline' as AnchorType };
    const scopedGraph = buildScopedGraph(anchor.type, role);
    const dossier = anchor.entity_id
      ? await assembleDossier(params.workspaceId, anchor)
      : null;
    return { entity_graph: scopedGraph, routing_hint: null, pre_loaded: dossier };
  }

  return { entity_graph: null, routing_hint: null };
}

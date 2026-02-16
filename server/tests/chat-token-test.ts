import { handleConversationTurn } from '../chat/orchestrator.js';
import { query } from '../db.js';

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const THREAD_ID = `test_token_${Date.now()}`;
const CHANNEL_ID = 'test_verification';

const TURNS = [
  { msg: 'How many deals do we have?',             expect_tier: 'heuristic' },
  { msg: "What's our pipeline looking like?",       expect_tier: 'heuristic' },
  { msg: 'Which deals are most at risk right now?', expect_tier: 'llm' },
  { msg: 'Tell me more about the top risk',         expect_tier: 'follow_up' },
  { msg: 'How many open deals?',                    expect_tier: 'heuristic' },
  { msg: 'What should we focus on this week?',      expect_tier: 'llm' },
  { msg: 'Can you break that down by rep?',         expect_tier: 'follow_up' },
  { msg: "What's our win rate?",                    expect_tier: 'heuristic' },
];

interface TurnResult {
  turn: number;
  question: string;
  router_decision: string;
  data_strategy: string;
  tokens_used: number;
  answer_length: number;
  latency_ms: number;
  expected_tier: string;
  tier_match: boolean;
}

async function runTest(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PANDORA CONVERSATIONAL AGENT — 8-TURN TOKEN VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Workspace: ${WORKSPACE_ID}`);
  console.log(`  Thread:    ${THREAD_ID}`);
  console.log(`  Turns:     ${TURNS.length}`);
  console.log('');

  const results: TurnResult[] = [];
  let cumulativeTokens = 0;

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    const turnNum = i + 1;
    const start = Date.now();

    try {
      const result = await handleConversationTurn({
        surface: 'in_app',
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        channelId: CHANNEL_ID,
        message: turn.msg,
      });

      const latency = Date.now() - start;
      cumulativeTokens += result.tokens_used;

      const isHeuristic = result.router_decision === 'heuristic';
      const isFollowUp = result.router_decision === 'follow_up';
      const isLlm = !isHeuristic && !isFollowUp && result.tokens_used > 0;
      const actualTier = isHeuristic ? 'heuristic' : isFollowUp ? 'follow_up' : isLlm ? 'llm' : result.router_decision;

      const tierMatch = turn.expect_tier === actualTier ||
        (turn.expect_tier === 'llm' && result.tokens_used > 0 && !isHeuristic) ||
        (turn.expect_tier === 'follow_up' && (isFollowUp || isLlm));

      results.push({
        turn: turnNum,
        question: turn.msg.slice(0, 45),
        router_decision: result.router_decision,
        data_strategy: result.data_strategy,
        tokens_used: result.tokens_used,
        answer_length: result.answer.length,
        latency_ms: latency,
        expected_tier: turn.expect_tier,
        tier_match: tierMatch,
      });

      const tokenStr = result.tokens_used === 0 ? '   0 ✓ FREE' : String(result.tokens_used).padStart(5);
      console.log(`  Turn ${turnNum}/8 | ${tokenStr} tokens | ${latency}ms | ${result.router_decision} | ${turn.msg.slice(0, 40)}`);
    } catch (err) {
      const latency = Date.now() - start;
      console.error(`  Turn ${turnNum}/8 | ERROR after ${latency}ms: ${err instanceof Error ? err.message : err}`);
      results.push({
        turn: turnNum,
        question: turn.msg.slice(0, 45),
        router_decision: 'ERROR',
        data_strategy: 'none',
        tokens_used: 0,
        answer_length: 0,
        latency_ms: latency,
        expected_tier: turn.expect_tier,
        tier_match: false,
      });
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('');
  console.log('  Turn │ Tokens │ Router Decision     │ Strategy          │ Latency');
  console.log('  ─────┼────────┼─────────────────────┼───────────────────┼────────');
  for (const r of results) {
    const t = String(r.turn).padStart(4);
    const tok = String(r.tokens_used).padStart(6);
    const rd = r.router_decision.padEnd(19);
    const ds = r.data_strategy.padEnd(17);
    const lat = `${r.latency_ms}ms`;
    console.log(`  ${t} │ ${tok} │ ${rd} │ ${ds} │ ${lat}`);
  }

  console.log('');

  const heuristicTurns = results.filter(r => r.router_decision === 'heuristic');
  const llmTurns = results.filter(r => r.tokens_used > 0);
  const errorTurns = results.filter(r => r.router_decision === 'ERROR');
  const heuristicTokens = heuristicTurns.reduce((s, r) => s + r.tokens_used, 0);
  const llmTokenCosts = llmTurns.map(r => r.tokens_used);

  console.log('  KEY METRICS:');
  console.log(`  ├─ Total turns:              ${results.length}`);
  console.log(`  ├─ Heuristic (zero-token):   ${heuristicTurns.length} turns (${heuristicTokens} tokens total)`);
  console.log(`  ├─ LLM-powered turns:        ${llmTurns.length} turns`);
  console.log(`  ├─ Errors:                   ${errorTurns.length}`);
  console.log(`  ├─ Cumulative tokens:        ${cumulativeTokens}`);
  if (llmTurns.length > 0) {
    const avgLlm = Math.round(llmTurns.reduce((s, r) => s + r.tokens_used, 0) / llmTurns.length);
    const maxLlm = Math.max(...llmTokenCosts);
    const minLlm = Math.min(...llmTokenCosts);
    console.log(`  ├─ Avg LLM tokens/turn:      ${avgLlm}`);
    console.log(`  ├─ Min LLM tokens:           ${minLlm}`);
    console.log(`  ├─ Max LLM tokens:           ${maxLlm}`);
    console.log(`  ├─ LLM cost variance:        ${maxLlm - minLlm} tokens (max - min)`);

    const early = llmTurns.filter(r => r.turn <= 4);
    const late = llmTurns.filter(r => r.turn > 4);
    if (early.length > 0 && late.length > 0) {
      const earlyAvg = Math.round(early.reduce((s, r) => s + r.tokens_used, 0) / early.length);
      const lateAvg = Math.round(late.reduce((s, r) => s + r.tokens_used, 0) / late.length);
      const growth = lateAvg > 0 ? ((lateAvg - earlyAvg) / earlyAvg * 100).toFixed(1) : 'N/A';
      console.log(`  ├─ Early LLM avg (T1-4):     ${earlyAvg} tokens`);
      console.log(`  ├─ Late LLM avg (T5-8):      ${lateAvg} tokens`);
      console.log(`  └─ Growth early→late:         ${growth}%`);
    }
  }

  console.log('');

  const flat = llmTurns.length < 2 || (Math.max(...llmTokenCosts) - Math.min(...llmTokenCosts)) < 500;
  const heuristicsFree = heuristicTokens === 0;
  const noErrors = errorTurns.length === 0;

  console.log('  VERDICT:');
  console.log(`  ├─ Heuristics zero-cost:     ${heuristicsFree ? '✓ PASS' : '✗ FAIL — heuristic turns consumed tokens'}`);
  console.log(`  ├─ Token cost flat:          ${flat ? '✓ PASS — cost not growing with turns' : '✗ FAIL — cost growing with conversation length'}`);
  console.log(`  ├─ No errors:                ${noErrors ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  └─ Production-ready:         ${flat && heuristicsFree && noErrors ? '✓ YES' : '✗ NEEDS HARDENING'}`);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');

  const stateResult = await query<any>(
    `SELECT context FROM conversation_state
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [WORKSPACE_ID, CHANNEL_ID, THREAD_ID]
  );

  if (stateResult.rows.length > 0) {
    const ctx = stateResult.rows[0].context;
    console.log('');
    console.log('  CONVERSATION STATE (from DB):');
    console.log(`  ├─ turn_count:        ${ctx.turn_count || 'not tracked'}`);
    console.log(`  ├─ total_token_cost:  ${ctx.total_token_cost || 'not tracked'}`);
    console.log(`  ├─ last_scope:        ${JSON.stringify(ctx.last_scope || {})}`);
    console.log(`  └─ entities_discussed: ${JSON.stringify(ctx.entities_discussed || [])}`);
    console.log('');
  }

  await query(
    `DELETE FROM conversation_state WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [WORKSPACE_ID, CHANNEL_ID, THREAD_ID]
  );
  console.log('  [cleanup] Test conversation state removed');

  await query(
    `DELETE FROM conversation_rate_limits WHERE workspace_id = $1`,
    [WORKSPACE_ID]
  );
  console.log('  [cleanup] Rate limit counters cleared');
  console.log('');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });

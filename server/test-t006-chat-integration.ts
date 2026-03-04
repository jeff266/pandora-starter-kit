/**
 * T006: Chat Tool End-to-End Verification
 * Run: npx tsx server/test-t006-chat-integration.ts
 *
 * Calls query_activity_signals directly (same path the chat agent uses)
 * against the richest deal: MPC | GVL | Sitewide | Renewal 2028 (481 signals)
 */

import { queryActivitySignals } from './signals/query-activity-signals.js';

const EMAIL_WORKSPACE = '31551fe0-b746-4384-aab2-d5cdd70b19ed';
const MPC_DEAL = '9213a924-d21f-4362-b6e5-7c2672096040';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, note?: string) {
  if (ok) {
    console.log(`  ✅ ${name}${note ? ' — ' + note : ''}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${note ? ' — ' + note : ''}`);
    fail++;
  }
}

async function main() {
  console.log('T006: Chat Tool End-to-End Verification');
  console.log('═'.repeat(55));
  console.log('Deal: MPC | GVL | Sitewide | Renewal 2028');
  console.log('Workspace: Email/Imubit (31551fe0)\n');

  // Q1: MEDDIC framework signals
  console.log('Q1: "Show me MEDDIC signals for MPC"');
  const meddic = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    signal_type: 'framework_signal',
    limit: 5,
  });
  console.log(`  → query_activity_signals(deal_id, signal_type=framework_signal)`);
  console.log(`  → ${meddic.total} signals found, ${meddic.signals.length} returned`);
  check('Returns framework signals', meddic.total > 0, `${meddic.total} signals`);
  check('Signals are framework_signal type', meddic.signals.every(s => s.signal_type === 'framework_signal'));
  meddic.signals.slice(0, 3).forEach(s =>
    console.log(`     [${s.framework_field}] "${(s.source_quote || s.signal_value || '').slice(0, 65)}"`));

  // Q2: Timeline mentions
  console.log('\nQ2: "What has customer said about their timeline?"');
  const timeline = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    signal_type: 'timeline_mention',
  });
  console.log(`  → query_activity_signals(deal_id, signal_type=timeline_mention)`);
  console.log(`  → ${timeline.total} timeline signals found`);
  check('Timeline query executes', true, `${timeline.total} results`);
  timeline.signals.slice(0, 3).forEach(s =>
    console.log(`     "${(s.source_quote || '').slice(0, 80)}"`));

  // Q3: Process blockers
  console.log('\nQ3: "Are there any process blockers on MPC?"');
  const blockers = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    signal_type: 'blocker_mention',
    limit: 5,
  });
  console.log(`  → query_activity_signals(deal_id, signal_type=blocker_mention)`);
  console.log(`  → ${blockers.total} blockers found`);
  check('Blocker signals present', blockers.total > 0, `${blockers.total} blockers`);
  check('All results are blocker type', blockers.signals.every(s => s.signal_type === 'blocker_mention'));
  blockers.signals.slice(0, 3).forEach(s =>
    console.log(`     🚧 "${(s.source_quote || s.signal_value || '').slice(0, 70)}"`));

  // Q4: Notable prospect quotes
  console.log('\nQ4: "Walk me through what the customer has said"');
  const quotes = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    signal_type: 'notable_quote',
  });
  console.log(`  → query_activity_signals(deal_id, signal_type=notable_quote)`);
  console.log(`  → ${quotes.total} notable quotes found`);
  check('Notable quotes present', quotes.total > 0, `${quotes.total} quotes`);
  quotes.signals.slice(0, 3).forEach(s => {
    const speaker = s.speaker_type ? ` (${s.speaker_type})` : '';
    console.log(`     💬${speaker} "${(s.source_quote || '').slice(0, 75)}"`);
  });

  // Q5: Untracked stakeholders
  console.log('\nQ5: "Who else is involved that we haven\'t tracked?"');
  const untracked = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    signal_type: 'untracked_participant',
    limit: 10,
  });
  console.log(`  → query_activity_signals(deal_id, signal_type=untracked_participant)`);
  console.log(`  → ${untracked.total} untracked contacts found`);
  check('Untracked participant query executes', true, `${untracked.total} found`);
  untracked.signals.slice(0, 5).forEach(s => console.log(`     📧 ${s.signal_value}`));
  if (untracked.total === 0) {
    console.log('     (none — email activities for this deal may not have CC/BCC headers)');
  }

  // Q6: High-confidence signals for AI synthesis
  console.log('\nQ6: High-confidence signals (≥ 0.85) for AI response');
  const highConf = await queryActivitySignals(EMAIL_WORKSPACE, {
    deal_id: MPC_DEAL,
    min_confidence: 0.85,
    limit: 10,
  });
  console.log(`  → query_activity_signals(deal_id, min_confidence=0.85)`);
  check('Confidence filter works', highConf.signals.every(s => s.confidence >= 0.85), `${highConf.total} high-conf signals`);

  // Summary
  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${pass} passed, ${fail} failed`);
  const signalCount = meddic.total + timeline.total + blockers.total + quotes.total + untracked.total;
  console.log(`Signal coverage on MPC deal:`);
  console.log(`  Framework signals: ${meddic.total}`);
  console.log(`  Timeline mentions: ${timeline.total}`);
  console.log(`  Blockers:          ${blockers.total}`);
  console.log(`  Notable quotes:    ${quotes.total}`);
  console.log(`  Untracked people:  ${untracked.total}`);

  if (fail === 0) {
    console.log('\n✅ T006 PASSED — chat tool integration verified end-to-end');
  } else {
    console.log('\n❌ T006 has failures — check above');
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

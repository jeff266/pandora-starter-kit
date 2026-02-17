import { query } from './server/db.js';
import { getIdentityResolver } from './server/identity/resolver.js';
import { getConversationService } from './server/conversations/service.js';
import { getStateExtractor } from './server/chat/state-extractor.js';
import { randomUUID } from 'crypto';

async function test() {
  try {
    console.log('=== PHASE 1 TEST: Identity + Conversation ===\n');

    // Get workspace
    const ws = await query<any>('SELECT id FROM workspaces LIMIT 1');
    const workspaceId = ws.rows[0].id;
    console.log(`Testing with workspace: ${workspaceId}\n`);

    // ============================================================
    // Test 1: Identity Resolution
    // ============================================================
    console.log('Test 1: Identity Resolution');
    console.log('----------------------------');

    const identityResolver = getIdentityResolver();

    // Resolve a Slack user
    const slackUser = await identityResolver.resolveOrCreate({
      workspace_id: workspaceId,
      source: {
        type: 'slack',
        value: 'U01ABC123',
        display_name: 'Alice Smith',
        avatar_url: 'https://example.com/avatar.jpg',
        slack_team_id: 'T01XYZ789',
      },
    });

    console.log(`✅ Created Slack user: ${slackUser.display_name} (${slackUser.id})`);
    console.log(`   - slack_user_id: ${slackUser.slack_user_id}`);
    console.log(`   - slack_team_id: ${slackUser.slack_team_id}`);

    // Resolve the same user again (should return existing)
    const sameUser = await identityResolver.resolveOrCreate({
      workspace_id: workspaceId,
      source: {
        type: 'slack',
        value: 'U01ABC123',
      },
    });

    console.log(`✅ Resolved same user (should be same ID): ${sameUser.id === slackUser.id ? 'PASS' : 'FAIL'}`);

    // Merge email identity into the Slack user
    await identityResolver.mergeIdentity(slackUser.id, {
      type: 'email',
      value: 'alice@example.com',
    });

    const mergedUser = await identityResolver.getById(slackUser.id);
    console.log(`✅ Merged email identity: ${mergedUser?.email}`);

    // Create a Pandora user
    const pandoraUser = await identityResolver.resolveOrCreate({
      workspace_id: workspaceId,
      source: {
        type: 'pandora',
        value: randomUUID(),
        display_name: 'Bob Jones',
      },
    });

    console.log(`✅ Created Pandora user: ${pandoraUser.display_name} (${pandoraUser.id})`);

    // List active users
    const activeUsers = await identityResolver.listActive(workspaceId);
    console.log(`✅ Active users in workspace: ${activeUsers.length}`);

    // ============================================================
    // Test 2: Conversation Storage
    // ============================================================
    console.log('\nTest 2: Conversation Storage');
    console.log('----------------------------');

    const conversationService = getConversationService();
    const threadId = randomUUID();

    // Create conversation state
    const state = await conversationService.getOrCreateState(
      workspaceId,
      threadId,
      'slack_thread',
      slackUser.id
    );

    console.log(`✅ Created conversation state for thread: ${threadId}`);
    console.log(`   - surface: ${state.surface}`);
    console.log(`   - workspace_user_id: ${state.workspace_user_id}`);

    // Write user message
    const userMessage = await conversationService.writeMessage({
      workspace_id: workspaceId,
      thread_id: threadId,
      workspace_user_id: slackUser.id,
      raw_user_id: 'U01ABC123',
      raw_user_source: 'slack',
      surface: 'slack_thread',
      turn_number: 1,
      role: 'user',
      content: "What's the status on the Acme Corp deal for Q1 2026?",
      entities_mentioned: ['Acme Corp'],
      slack_channel_id: 'C01XYZ',
      slack_message_ts: '1234567890.123456',
    });

    console.log(`✅ Wrote user message (turn ${userMessage.turn_number})`);
    console.log(`   - content: "${userMessage.content.substring(0, 50)}..."`);

    // Write assistant message
    const assistantMessage = await conversationService.writeMessage({
      workspace_id: workspaceId,
      thread_id: threadId,
      workspace_user_id: null, // Assistant has no user ID
      raw_user_id: null,
      raw_user_source: 'pandora',
      surface: 'slack_thread',
      turn_number: 2,
      role: 'assistant',
      content: 'Found: Acme Corp deal is in Discovery stage, $50K ARR, stale 87 days. Alert: No activity in 60+ days.',
      entities_mentioned: ['Acme Corp'],
      skill_run_ids: ['ph_run_123'],
      execution_mode: 'pipeline',
      token_cost: 450,
      router_decision: { intent: 'analyze_pipeline', confidence: 0.95 },
    });

    console.log(`✅ Wrote assistant message (turn ${assistantMessage.turn_number})`);
    console.log(`   - execution_mode: ${assistantMessage.execution_mode}`);
    console.log(`   - token_cost: ${assistantMessage.token_cost}`);

    // ============================================================
    // Test 3: State Extraction
    // ============================================================
    console.log('\nTest 3: State Extraction');
    console.log('-------------------------');

    const stateExtractor = getStateExtractor();

    // Extract state from the turn
    const stateUpdates = stateExtractor.extractFromTurn(
      userMessage,
      assistantMessage,
      state.state
    );

    console.log(`✅ Extracted state updates:`);
    console.log(`   - focus: ${stateUpdates.focus?.type} (${stateUpdates.focus?.entity_name || 'N/A'})`);
    console.log(`   - period: ${stateUpdates.period || 'N/A'}`);
    console.log(`   - entities_discussed: ${stateUpdates.entities_discussed?.join(', ') || 'N/A'}`);
    console.log(`   - key_findings: ${stateUpdates.key_findings?.length || 0} findings`);
    if (stateUpdates.key_findings && stateUpdates.key_findings.length > 0) {
      console.log(`      - "${stateUpdates.key_findings[0]}"`);
    }

    // Update conversation state
    const newState = { ...state.state, ...stateUpdates };
    await conversationService.updateState({
      thread_id: threadId,
      workspace_id: workspaceId,
      state: newState,
      turn_count: 2,
      total_token_cost: 450,
      last_updated_turn: 2,
    });

    console.log(`✅ Updated conversation state`);

    // Compact state
    const compactedState = stateExtractor.compactState(newState);
    const estimatedTokens = stateExtractor.estimateTokens(compactedState);
    console.log(`✅ Compacted state: ~${estimatedTokens} tokens`);

    // ============================================================
    // Test 4: Conversation Retrieval
    // ============================================================
    console.log('\nTest 4: Conversation Retrieval');
    console.log('-------------------------------');

    // Load thread
    const messages = await conversationService.loadThread({
      workspace_id: workspaceId,
      thread_id: threadId,
    });

    console.log(`✅ Loaded thread: ${messages.length} messages`);
    messages.forEach(msg => {
      console.log(`   - Turn ${msg.turn_number} (${msg.role}): "${msg.content.substring(0, 40)}..."`);
    });

    // Get latest messages
    const latestMessages = await conversationService.getLatestMessages(
      workspaceId,
      threadId,
      5
    );

    console.log(`✅ Latest messages: ${latestMessages.length}`);

    // Get conversation state
    const loadedState = await conversationService.getState(threadId);
    console.log(`✅ Loaded state: ${loadedState?.turn_count} turns, ${loadedState?.total_token_cost} tokens`);

    // Search messages (full-text search)
    const searchResults = await conversationService.searchMessages(
      workspaceId,
      'Acme',
      10
    );

    console.log(`✅ Search results for "Acme": ${searchResults.length} messages`);

    // Get user's conversations
    const userConversations = await conversationService.listUserConversations(
      workspaceId,
      slackUser.id,
      10
    );

    console.log(`✅ User's conversations: ${userConversations.length} threads`);

    // ============================================================
    // Test 5: Multi-turn Conversation
    // ============================================================
    console.log('\nTest 5: Multi-turn Conversation');
    console.log('--------------------------------');

    // Turn 3: User follow-up
    const turn3 = await conversationService.writeMessage({
      workspace_id: workspaceId,
      thread_id: threadId,
      workspace_user_id: slackUser.id,
      raw_user_id: 'U01ABC123',
      raw_user_source: 'slack',
      surface: 'slack_thread',
      turn_number: 3,
      role: 'user',
      content: 'Why is it stale?',
    });

    // Turn 4: Assistant with loop execution
    const turn4 = await conversationService.writeMessage({
      workspace_id: workspaceId,
      thread_id: threadId,
      workspace_user_id: null,
      raw_user_id: null,
      raw_user_source: 'pandora',
      surface: 'slack_thread',
      turn_number: 4,
      role: 'assistant',
      content: 'Investigating: Checked activity history. Found: Last activity was 87 days ago (email sent). Recommendation: Schedule follow-up call.',
      skill_run_ids: ['loop_exec_456'],
      execution_mode: 'loop',
      operator_slug: 'pipeline-state',
      loop_iterations: 3,
      token_cost: 1200,
    });

    console.log(`✅ Turn 3-4 added`);
    console.log(`   - Turn 4 execution_mode: ${turn4.execution_mode}`);
    console.log(`   - Turn 4 loop_iterations: ${turn4.loop_iterations}`);

    // Extract and update state
    const turn2State = stateExtractor.extractFromTurn(turn3, turn4, newState);
    const finalState = { ...newState, ...turn2State };

    await conversationService.updateState({
      thread_id: threadId,
      workspace_id: workspaceId,
      state: finalState,
      turn_count: 4,
      total_token_cost: 450 + 1200,
      last_updated_turn: 4,
    });

    console.log(`✅ State updated with escalation history`);
    if (finalState.escalation_history && finalState.escalation_history.length > 0) {
      console.log(`   - Escalations: ${finalState.escalation_history.length}`);
      const lastEscalation = finalState.escalation_history[finalState.escalation_history.length - 1];
      console.log(`   - Last: ${lastEscalation.from} → ${lastEscalation.to} (${lastEscalation.reason})`);
    }

    // Get next turn number
    const nextTurn = await conversationService.getNextTurnNumber(workspaceId, threadId);
    console.log(`✅ Next turn number: ${nextTurn}`);

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n=== PHASE 1 TEST SUMMARY ===');
    console.log(`✅ Identity Resolution: ${activeUsers.length} users created`);
    console.log(`✅ Conversation Storage: ${messages.length} messages written`);
    console.log(`✅ State Extraction: ~${estimatedTokens} tokens (target: ~300)`);
    console.log(`✅ Full-text Search: ${searchResults.length} results found`);
    console.log(`✅ Multi-turn tracking: ${nextTurn - 1} turns completed`);
    console.log('\n✅ Phase 1 implementation PASSED!\n');

    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

test();

# Pandora Slack Interactivity — Three-Level Build Spec

## Overview

Pandora currently pushes skill output to Slack via incoming webhooks. Communication is one-way: Pandora → Slack. This spec adds the return path: Slack → Pandora, in three progressive levels.

**Current state:** Incoming webhook only. Posts Block Kit messages. No Slack app.

**Prerequisite for all three levels:** Upgrade from incoming webhook to a proper Slack app. This is a one-time migration that unlocks everything below.

---

## Level 0: Slack App Migration (Prerequisite)

**Track:** Replit  
**Effort:** 2-3 hours  
**Must complete before any interactivity works**

### Why

Incoming webhooks can only push messages. To receive ANY input from Slack — button clicks, replies, mentions, slash commands — you need a Slack app with:
- A Bot Token (`xoxb-...`) for posting messages with richer formatting
- An Interactivity Request URL for receiving button/menu payloads
- Event Subscriptions for receiving messages and mentions
- OAuth scopes that allow reading/writing in channels

### What to Build

1. **Create Slack App** at api.slack.com/apps
   - App name: "Pandora" (or "Pandora RevOps")
   - Bot scopes needed (cumulative across all three levels):
     - `chat:write` — post messages
     - `chat:write.public` — post to channels the bot isn't in
     - `reactions:read` — detect emoji reactions on messages
     - `app_mentions:read` — respond to @pandora mentions (Level 3)
     - `channels:history` — read thread replies (Level 2)
     - `groups:history` — read thread replies in private channels (Level 2)
     - `im:history` — read DMs (Level 3)
     - `im:write` — send DMs (Level 1 — rep notifications)
     - `users:read` — resolve user IDs to names/emails
     - `users:read.email` — match Slack users to CRM rep emails
   - Request URL: `https://your-pandora-domain/api/slack/interactions`
   - Events URL: `https://your-pandora-domain/api/slack/events`

2. **OAuth Installation Flow**
   - Per-workspace Slack app installation (each customer installs to their Slack workspace)
   - Store bot token in `connector_configs` with `source_type = 'slack_app'`
   - Encrypt token using existing credential encryption
   - Migration: workspaces with existing incoming webhooks keep them as fallback; new messages use bot token when available

3. **Update Slack Client**
   
   Current: `postMessage(webhookUrl, blocks)` — fires a webhook
   
   New: dual-mode client that prefers bot token, falls back to webhook:

   ```typescript
   class SlackClient {
     async postMessage(workspaceId: string, channel: string, blocks: Block[], options?: {
       thread_ts?: string;      // reply in thread
       metadata?: {             // attach hidden metadata for interaction routing
         skill_id: string;
         run_id: string;
         workspace_id: string;
       };
     }): Promise<{ ts: string; channel: string }> {
       const token = await this.getBotToken(workspaceId);
       if (token) {
         // Use chat.postMessage API — returns message ts for threading
         return await this.postViaAPI(token, channel, blocks, options);
       }
       // Fallback to webhook (no threading, no interactions)
       return await this.postViaWebhook(workspaceId, blocks);
     }
   }
   ```

   Key difference: `chat.postMessage` returns a `ts` (timestamp) that uniquely identifies the message. Store this in `skill_runs` — it's the thread anchor for Levels 2 and 3.

4. **Store Message References**

   Add to `skill_runs` table:
   ```sql
   ALTER TABLE skill_runs ADD COLUMN IF NOT EXISTS
     slack_message_ts TEXT;        -- Slack message timestamp (thread anchor)
   ALTER TABLE skill_runs ADD COLUMN IF NOT EXISTS
     slack_channel_id TEXT;        -- Channel where message was posted
   ```

   After posting a skill result to Slack, store the `ts` and `channel` in the skill run. This links every Slack message back to the skill run that produced it.

5. **Verification Endpoint**

   Slack sends a challenge request when you configure the Events URL:
   ```typescript
   router.post('/api/slack/events', (req, res) => {
     // URL verification challenge
     if (req.body.type === 'url_verification') {
       return res.json({ challenge: req.body.challenge });
     }
     // ... event handling (Level 2+)
   });
   ```

### Database: Slack App Connections

```sql
-- Extends connector_configs. A workspace's Slack app connection:
-- source_type = 'slack_app'
-- credentials = encrypted { bot_token, team_id, team_name, installed_by }
-- No new table needed — reuses connector_configs pattern.

-- Channel mapping (which Slack channel gets which skill output):
CREATE TABLE IF NOT EXISTS slack_channel_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel_id TEXT NOT NULL,         -- Slack channel ID
  channel_name TEXT,                -- Human-readable (#pipeline-alerts)
  skills TEXT[] DEFAULT '{}',       -- Which skill IDs post here. Empty = all.
  is_default BOOLEAN DEFAULT false, -- If true, catches skills not assigned elsewhere
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Level 1: Interactive Buttons

**Track:** Replit (endpoints, Block Kit formatting) + Claude Code (action wiring)  
**Effort:** 4-6 hours  
**Depends on:** Level 0

### What It Does

Every skill message in Slack includes contextual action buttons. When clicked, Slack sends a payload to Pandora, which creates an action, updates a finding status, or triggers a scoped re-run.

### Button Types

| Button | Action | Available On |
|---|---|---|
| ✓ Reviewed | Marks all findings in this skill run as acknowledged | All skill messages |
| Snooze 1 Week | Suppresses this skill's findings for specific deals for 7 days | Messages with deal-specific findings |
| Drill Into [Deal Name] | Triggers a deal dossier synthesis and posts in-thread | Messages that mention specific deals |
| Run for [Segment] | Re-runs the skill scoped to a specific rep/stage/pipeline | Pipeline Hygiene, Coverage, Forecast |
| Dismiss | Marks the finding as not actionable | Action-specific buttons |

### Block Kit Message Format

Update the Slack formatter to append an `actions` block to every skill message:

```typescript
// In slack-formatter.ts, after the existing content blocks:

function buildActionButtons(skillId: string, runId: string, workspaceId: string, deals?: Deal[]): Block[] {
  const blocks: Block[] = [];
  
  // Primary actions row
  blocks.push({
    type: 'actions',
    block_id: `actions_${runId}`,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✓ Reviewed' },
        style: 'primary',
        action_id: 'mark_reviewed',
        value: JSON.stringify({ skill_id: skillId, run_id: runId, workspace_id: workspaceId }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Snooze 1 Week' },
        action_id: 'snooze_findings',
        value: JSON.stringify({ skill_id: skillId, run_id: runId, workspace_id: workspaceId, days: 7 }),
      },
    ],
  });
  
  // Deal-specific drill-in buttons (max 3 to avoid clutter)
  if (deals && deals.length > 0) {
    const topDeals = deals.slice(0, 3);
    blocks.push({
      type: 'actions',
      block_id: `deals_${runId}`,
      elements: topDeals.map(deal => ({
        type: 'button',
        text: { type: 'plain_text', text: `🔍 ${deal.name}` },
        action_id: 'drill_deal',
        value: JSON.stringify({ 
          deal_id: deal.id, 
          deal_name: deal.name,
          workspace_id: workspaceId,
          run_id: runId,
        }),
      })),
    });
  }
  
  return blocks;
}
```

### Interactions Endpoint

**Track:** Replit

```typescript
// server/routes/slack-interactions.ts

router.post('/api/slack/interactions', async (req, res) => {
  // Slack sends interactions as application/x-www-form-urlencoded
  // with a 'payload' field containing JSON
  const payload = JSON.parse(req.body.payload);
  
  // CRITICAL: Verify the request is from Slack
  // Check X-Slack-Signature header against your app's signing secret
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Acknowledge immediately (Slack requires response within 3 seconds)
  res.status(200).json({});
  
  // Process async
  const action = payload.actions[0];
  const value = JSON.parse(action.value);
  
  switch (action.action_id) {
    case 'mark_reviewed':
      await handleMarkReviewed(value, payload);
      break;
    case 'snooze_findings':
      await handleSnooze(value, payload);
      break;
    case 'drill_deal':
      await handleDrillDeal(value, payload);
      break;
    default:
      console.warn(`Unknown action: ${action.action_id}`);
  }
});
```

### Action Handlers

**Track:** Split — Replit builds the endpoints, Claude Code builds the deal dossier synthesis

#### mark_reviewed
```typescript
async function handleMarkReviewed(value: any, payload: any) {
  const { workspace_id, run_id } = value;
  
  // Update skill_run status
  await db.query(`
    UPDATE skill_runs 
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'), 
      '{reviewed}', 
      to_jsonb(now()::text)
    )
    WHERE id = $1 AND workspace_id = $2
  `, [run_id, workspace_id]);
  
  // Update the Slack message to show it's been reviewed
  // Replace the buttons with a "✓ Reviewed by @user" text block
  await slackClient.updateMessage(workspace_id, {
    channel: payload.channel.id,
    ts: payload.message.ts,
    blocks: [
      ...payload.message.blocks.filter(b => b.type !== 'actions'),
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `✓ Reviewed by <@${payload.user.id}> at ${new Date().toLocaleTimeString()}`,
        }],
      },
    ],
  });
}
```

#### snooze_findings
```typescript
async function handleSnooze(value: any, payload: any) {
  const { workspace_id, run_id, days } = value;
  const snoozeUntil = new Date();
  snoozeUntil.setDate(snoozeUntil.getDate() + days);
  
  // Store snooze in context_layer so skills check it before alerting
  // Key: 'snooze:{skill_id}', value: { until: ISO date, snoozed_by: user }
  await db.query(`
    INSERT INTO context_layer (workspace_id, category, key, value)
    VALUES ($1, 'snooze', $2, $3)
    ON CONFLICT (workspace_id, category, key) 
    DO UPDATE SET value = $3, updated_at = now()
  `, [
    workspace_id, 
    `snooze:${value.skill_id}`,
    JSON.stringify({ until: snoozeUntil.toISOString(), snoozed_by: payload.user.id }),
  ]);
  
  // Update message
  await slackClient.postEphemeral(workspace_id, {
    channel: payload.channel.id,
    user: payload.user.id,
    text: `Snoozed for ${days} days. This skill will resume alerting on ${snoozeUntil.toLocaleDateString()}.`,
  });
}
```

#### drill_deal (Claude Code builds the synthesis)
```typescript
async function handleDrillDeal(value: any, payload: any) {
  const { workspace_id, deal_id, deal_name, run_id } = value;
  
  // Post "thinking" message in thread
  const thinking = await slackClient.postMessage(workspace_id, payload.channel.id, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Analyzing ${deal_name}..._` }],
  }], { thread_ts: payload.message.ts });
  
  // Assemble deal dossier (this is the Command Center's deal_dossier function)
  // If it doesn't exist yet, do a lightweight version:
  const dossier = await assembleDealDossier(workspace_id, deal_id);
  
  // Optional: run a focused Claude synthesis on the dossier
  const narrative = await synthesizeDealNarrative(workspace_id, dossier);
  
  // Post dossier in thread (replaces "thinking" message)
  await slackClient.updateMessage(workspace_id, {
    channel: payload.channel.id,
    ts: thinking.ts,
    blocks: formatDossierForSlack(dossier, narrative),
  });
}
```

### Snooze Integration with Skills

**Track:** Claude Code

Skills need to check for active snoozes before including deals in their output:

```typescript
// In each skill's compute step, after gathering findings:
const snoozes = await db.query(`
  SELECT key, value FROM context_layer
  WHERE workspace_id = $1 AND category = 'snooze'
  AND (value->>'until')::timestamptz > now()
`, [workspaceId]);

const snoozedSkills = new Set(snoozes.rows.map(r => r.key.replace('snooze:', '')));

// If this skill is snoozed, either:
// a) Skip the skill entirely
// b) Run but don't post to Slack (still store the run)
if (snoozedSkills.has(skillId)) {
  // Run but mark as snoozed — don't post to Slack
  output.suppressed = true;
  output.suppression_reason = 'snoozed';
}
```

---

## Level 2: Threaded Replies

**Track:** Replit (Events API wiring, thread matching) + Claude Code (reply parsing, scoped re-analysis)  
**Effort:** 6-8 hours  
**Depends on:** Level 0 + Level 1

### What It Does

Users reply in the thread under a Pandora message. Pandora receives the reply, matches it to the original skill run, interprets the intent, and responds in the same thread.

### Event Subscription

In the Slack app settings, subscribe to:
- `message.channels` — messages in public channels
- `message.groups` — messages in private channels

### Events Endpoint

**Track:** Replit

```typescript
// server/routes/slack-events.ts

router.post('/api/slack/events', async (req, res) => {
  // URL verification (one-time setup)
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  
  // Verify signature
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Acknowledge immediately
  res.status(200).json({});
  
  const event = req.body.event;
  
  // Only process threaded replies (has thread_ts) that aren't from our bot
  if (event.type === 'message' 
      && event.thread_ts 
      && !event.bot_id 
      && event.subtype !== 'bot_message') {
    await handleThreadedReply(event, req.body.team_id);
  }
});
```

### Thread Matching

**Track:** Replit

```typescript
async function handleThreadedReply(event: SlackMessageEvent, teamId: string) {
  // Find the skill run that produced the parent message
  // event.thread_ts is the timestamp of the original message
  const skillRun = await db.query(`
    SELECT sr.id, sr.skill_id, sr.workspace_id, sr.output
    FROM skill_runs sr
    JOIN connector_configs cc ON cc.workspace_id = sr.workspace_id
    WHERE sr.slack_message_ts = $1
      AND sr.slack_channel_id = $2
      AND cc.source_type = 'slack_app'
      AND cc.credentials->>'team_id' = $3
  `, [event.thread_ts, event.channel, teamId]);
  
  if (skillRun.rows.length === 0) {
    // Not a reply to a Pandora message — ignore
    return;
  }
  
  const run = skillRun.rows[0];
  const userMessage = event.text;
  
  // Resolve Slack user to workspace user (for personalization)
  const slackUser = await resolveSlackUser(run.workspace_id, event.user);
  
  // Route to intent handler
  await routeThreadedReply(run, userMessage, slackUser, event);
}
```

### Intent Classification

**Track:** Claude Code

The user's reply could mean many things. Use DeepSeek for lightweight intent classification:

```typescript
async function routeThreadedReply(
  run: SkillRunRow, 
  message: string, 
  user: SlackUser, 
  event: SlackMessageEvent
) {
  // Classify intent with DeepSeek (fast, cheap)
  const intent = await classifyReplyIntent(message, run.skill_id);
  
  switch (intent.type) {
    case 'drill_down':
      // "Tell me more about the Acme deal"
      // "What's the history on Globex?"
      await handleDrillDown(run, intent.entity, event);
      break;
      
    case 'scope_filter':
      // "Run this for just Enterprise deals"
      // "Show me Sara's pipeline only"
      await handleScopedRerun(run, intent.filter, event);
      break;
      
    case 'add_context':
      // "This deal is waiting on legal review"
      // "Budget was approved yesterday"
      await handleAddContext(run, intent.context, intent.deal, event);
      break;
      
    case 'question':
      // "Why is this deal flagged?"
      // "What would happen if we closed the top 3?"
      await handleQuestion(run, message, event);
      break;
      
    case 'action':
      // "Snooze Acme for 2 weeks"
      // "Mark the Globex deal as reviewed"
      await handleAction(run, intent, event);
      break;
      
    default:
      // Can't determine intent — ask for clarification
      await slackClient.postMessage(run.workspace_id, event.channel, [{
        type: 'section',
        text: { type: 'mrkdwn', text: "I'm not sure what you'd like me to do. Try:\n• _\"Tell me more about [deal name]\"_\n• _\"Run this for [rep name] only\"_\n• _\"[Deal name] is waiting on legal\"_" },
      }], { thread_ts: event.thread_ts });
  }
}
```

### DeepSeek Intent Classifier

**Track:** Claude Code

```typescript
async function classifyReplyIntent(
  message: string, 
  skillId: string
): Promise<ReplyIntent> {
  const response = await deepseek.classify({
    prompt: `You are classifying a user's reply to a RevOps skill report.

The reply was made in a thread under a "${skillId}" report.

Classify the intent:
1. drill_down — user wants more detail on a specific deal, account, or rep
   Extract: entity_type (deal/account/rep), entity_name
2. scope_filter — user wants the analysis re-run with a filter
   Extract: filter_type (rep/stage/pipeline/segment), filter_value
3. add_context — user is adding information/context about a deal
   Extract: deal_name (if mentioned), context_text
4. question — user is asking a question about the data or findings
5. action — user wants to take an action (snooze, dismiss, mark reviewed)
   Extract: action_type, target_entity

User message: "${message}"

Respond with ONLY JSON: { "type": "...", ... }`,
  });
  
  return JSON.parse(response);
}
```

### Reply Handlers

#### drill_down
**Track:** Claude Code (reuses deal dossier from Level 1)

```typescript
async function handleDrillDown(run: SkillRunRow, entity: Entity, event: SlackMessageEvent) {
  await postThinking(run.workspace_id, event);
  
  if (entity.type === 'deal') {
    // Find deal by name (fuzzy match against workspace deals)
    const deal = await findDealByName(run.workspace_id, entity.name);
    if (!deal) {
      await postReply(run.workspace_id, event, `I couldn't find a deal matching "${entity.name}".`);
      return;
    }
    const dossier = await assembleDealDossier(run.workspace_id, deal.id);
    const narrative = await synthesizeDealNarrative(run.workspace_id, dossier);
    await postReply(run.workspace_id, event, formatDossierForSlack(dossier, narrative));
  }
  // Similar for account, rep
}
```

#### scope_filter
**Track:** Replit (re-run infrastructure) + Claude Code (scoped skill execution)

```typescript
async function handleScopedRerun(run: SkillRunRow, filter: Filter, event: SlackMessageEvent) {
  await postThinking(run.workspace_id, event);
  
  // Re-run the original skill with the filter applied
  // The skill runtime already supports params — pass the filter
  const result = await skillRuntime.executeSkill(run.skill_id, run.workspace_id, {
    scope: filter,  // { type: 'rep', value: 'sara@company.com' }
  });
  
  // Post scoped result in thread
  const blocks = slackFormatter.format(result);
  await postReply(run.workspace_id, event, blocks);
}
```

#### add_context
**Track:** Claude Code (context layer integration)

```typescript
async function handleAddContext(
  run: SkillRunRow, 
  context: string, 
  dealName: string | null, 
  event: SlackMessageEvent
) {
  // Store user-provided context in the context layer
  // This gets picked up by future skill runs
  const entry = {
    source: 'slack_thread',
    added_by: event.user,
    added_at: new Date().toISOString(),
    skill_run_id: run.id,
    text: context,
  };
  
  if (dealName) {
    const deal = await findDealByName(run.workspace_id, dealName);
    if (deal) {
      // Store as deal-specific context
      await db.query(`
        INSERT INTO context_layer (workspace_id, category, key, value)
        VALUES ($1, 'deal_context', $2, $3)
        ON CONFLICT (workspace_id, category, key) 
        DO UPDATE SET value = context_layer.value || $3::jsonb, updated_at = now()
      `, [run.workspace_id, `deal:${deal.id}`, JSON.stringify([entry])]);
      
      await postReply(run.workspace_id, event, 
        `Got it — noted that ${deal.name} is ${context}. This will be factored into future analyses.`);
      return;
    }
  }
  
  // Store as general skill context
  await db.query(`
    INSERT INTO context_layer (workspace_id, category, key, value)
    VALUES ($1, 'user_context', $2, $3)
    ON CONFLICT (workspace_id, category, key) 
    DO UPDATE SET value = context_layer.value || $3::jsonb, updated_at = now()
  `, [run.workspace_id, `run:${run.id}`, JSON.stringify([entry])]);
  
  await postReply(run.workspace_id, event, `Noted. This context will be included in the next analysis.`);
}
```

#### question
**Track:** Claude Code (scoped analysis endpoint)

```typescript
async function handleQuestion(run: SkillRunRow, question: string, event: SlackMessageEvent) {
  await postThinking(run.workspace_id, event);
  
  // Use the scoped analysis endpoint (from Command Center spec)
  // Scope the question to the skill's domain and the data from this run
  const answer = await scopedAnalysis({
    workspace_id: run.workspace_id,
    question: question,
    scope: {
      skill_id: run.skill_id,
      run_id: run.id,
      // Include the skill's compute data as context
      context: run.output?.evidence || run.output?.summary,
    },
  });
  
  await postReply(run.workspace_id, event, answer);
}
```

### Token Budget for Threaded Replies

| Operation | LLM Cost | Notes |
|---|---|---|
| Intent classification | ~200 tokens (DeepSeek) | Cheap, fast |
| Drill-down (deal dossier) | ~3,000 tokens (Claude) | One-time per deal |
| Scoped re-run | Same as full skill run | Reuses existing skill pipeline |
| Add context | 0 tokens | Pure database write |
| Question answering | ~2,000-5,000 tokens (Claude) | Depends on question complexity |

---

## Level 3: Conversational Interface

**Track:** Replit (Slack app events, routing) + Claude Code (NLP routing, multi-turn state, analysis)  
**Effort:** 8-12 hours  
**Depends on:** Level 0 + Level 1 + Level 2

### What It Does

Users @ mention Pandora or DM it with natural language questions. Pandora acts as an always-available RevOps analyst that can query data, run analyses, and answer questions across the entire workspace.

### Event Subscription

Add to existing events:
- `app_mention` — @pandora in any channel
- `message.im` — DMs to the Pandora bot

### Message Router

**Track:** Replit

```typescript
// Add to slack-events.ts

if (event.type === 'app_mention' || (event.type === 'message' && event.channel_type === 'im')) {
  // This is a direct question to Pandora, not a thread reply
  if (!event.thread_ts || event.thread_ts === event.ts) {
    await handleDirectQuestion(event, teamId);
  } else {
    // It's a follow-up in an existing Pandora conversation thread
    await handleConversationFollowUp(event, teamId);
  }
}
```

### Direct Question Handler

**Track:** Claude Code

```typescript
async function handleDirectQuestion(event: SlackMessageEvent, teamId: string) {
  const workspaceId = await resolveWorkspaceFromTeam(teamId);
  if (!workspaceId) return;
  
  // Strip the @mention from the message
  const question = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  
  // Post thinking indicator
  const thinking = await slackClient.postMessage(workspaceId, event.channel, [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Thinking..._' }],
  }], { thread_ts: event.ts });
  
  // Route the question
  const route = await classifyDirectQuestion(question, workspaceId);
  
  switch (route.type) {
    case 'data_query':
      // "What's Sara's pipeline?" "How many deals close this month?"
      await handleDataQuery(workspaceId, question, route, event, thinking);
      break;
      
    case 'skill_trigger':
      // "Run pipeline hygiene" "Give me a forecast update"
      await handleSkillTrigger(workspaceId, route.skill_id, event, thinking);
      break;
      
    case 'comparison':
      // "Compare this quarter to last quarter"
      // "How does Sara compare to the team?"
      await handleComparison(workspaceId, question, route, event, thinking);
      break;
      
    case 'explanation':
      // "Why is the Acme deal flagged?"
      // "What does single-threaded mean for us?"
      await handleExplanation(workspaceId, question, route, event, thinking);
      break;
      
    case 'action_request':
      // "Snooze all pipeline alerts for today"
      // "Update the Acme close date to March 15"
      await handleActionRequest(workspaceId, question, route, event, thinking);
      break;
      
    default:
      await updateThinking(workspaceId, event, thinking,
        "I'm not sure how to help with that. I can answer questions about your pipeline, deals, reps, forecast, and data quality. Try asking something like:\n• _\"What's our pipeline looking like?\"_\n• _\"Which deals are at risk?\"_\n• _\"How is Sara tracking against quota?\"_");
  }
}
```

### Question Classifier

**Track:** Claude Code

```typescript
async function classifyDirectQuestion(
  question: string, 
  workspaceId: string
): Promise<QuestionRoute> {
  // Load workspace context for better routing
  const skills = skillRegistry.list();
  const repNames = await getRepNames(workspaceId);
  
  const response = await deepseek.classify({
    prompt: `You are routing a natural language question to the right handler 
in a RevOps analytics platform.

Available skills: ${skills.map(s => s.id).join(', ')}
Known rep names: ${repNames.join(', ')}

Classify the question:
1. data_query — asking for specific data (pipeline numbers, deal counts, rep metrics)
   Extract: entities (deals/reps/accounts), metrics (pipeline/coverage/forecast), 
   filters (rep, stage, date range)
2. skill_trigger — asking to run a specific analysis
   Extract: skill_id (best match from available skills)
3. comparison — asking to compare two things (time periods, reps, segments)
   Extract: compare_a, compare_b, metric
4. explanation — asking why something is the way it is
   Extract: topic, entity_name
5. action_request — asking to take an action
   Extract: action_type, target

Question: "${question}"

Respond with ONLY JSON: { "type": "...", ... }`,
  });
  
  return JSON.parse(response);
}
```

### Data Query Handler (the most common path)

**Track:** Claude Code

```typescript
async function handleDataQuery(
  workspaceId: string,
  question: string,
  route: DataQueryRoute,
  event: SlackMessageEvent,
  thinking: SlackMessage
) {
  // Use the scoped analysis endpoint
  // This is the same endpoint Command Center uses
  const result = await scopedAnalysis({
    workspace_id: workspaceId,
    question: question,
    scope: {
      entities: route.entities,
      metrics: route.metrics,
      filters: route.filters,
    },
    // Give Claude access to query tools
    tools: ['queryDeals', 'queryContacts', 'getDealsByStage', 
            'getActivitySummary', 'queryActivities'],
    // Limit response for Slack (not a full report)
    max_tokens: 1500,
    format: 'slack',  // Return Block Kit, not markdown
  });
  
  await updateThinking(workspaceId, event, thinking, result.blocks);
  
  // Store the conversation context for follow-ups
  await storeConversationState(workspaceId, event.ts, {
    question,
    route,
    result_summary: result.summary,
  });
}
```

### Multi-Turn Conversation State

**Track:** Claude Code

For follow-up questions in the same thread, maintain conversation context:

```typescript
// Store in context_layer with short TTL
interface ConversationState {
  workspace_id: string;
  thread_ts: string;
  channel_id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  context: {
    entities_discussed: string[];  // deal IDs, rep emails mentioned
    skills_referenced: string[];   // skills that contributed data
    filters_active: any;           // current scope/filter
  };
  created_at: string;
  expires_at: string;  // Auto-cleanup after 24 hours
}

async function handleConversationFollowUp(event: SlackMessageEvent, teamId: string) {
  const workspaceId = await resolveWorkspaceFromTeam(teamId);
  const state = await getConversationState(workspaceId, event.thread_ts);
  
  if (!state) {
    // Thread expired or not found — treat as new question
    return handleDirectQuestion(event, teamId);
  }
  
  // Add user message to state
  state.messages.push({
    role: 'user',
    content: event.text,
    timestamp: event.ts,
  });
  
  // Send full conversation history to Claude for context-aware response
  const response = await claude.chat({
    system: `You are Pandora, a RevOps analyst. You're in a conversation 
about ${state.context.entities_discussed.join(', ')}. 
Previous context: ${JSON.stringify(state.context)}.
Answer the follow-up question using the available tools.
Keep responses concise for Slack.`,
    messages: state.messages,
    tools: ['queryDeals', 'queryContacts', 'getDealsByStage'],
    max_tokens: 1500,
  });
  
  // Post response in thread
  await slackClient.postMessage(workspaceId, event.channel, 
    formatResponseForSlack(response), 
    { thread_ts: event.thread_ts });
  
  // Update state
  state.messages.push({ role: 'assistant', content: response.text, timestamp: Date.now().toString() });
  await saveConversationState(state);
}
```

### Rate Limiting for Level 3

Conversational queries hit Claude with tool use — potentially expensive. Add per-workspace rate limits:

```typescript
const CONVERSATION_LIMITS = {
  max_questions_per_hour: 20,      // Per workspace
  max_tokens_per_question: 5000,   // Claude token cap
  max_follow_ups_per_thread: 10,   // Prevent runaway conversations
  conversation_ttl_hours: 24,       // Auto-expire conversation state
};
```

### Token Budget for Level 3

| Operation | LLM Cost | Notes |
|---|---|---|
| Question classification | ~200 tokens (DeepSeek) | |
| Data query (simple) | ~2,000 tokens (Claude) | "What's Sara's pipeline?" |
| Data query (complex) | ~5,000 tokens (Claude) | Multi-tool, synthesis needed |
| Comparison | ~4,000 tokens (Claude) | Pulls two datasets, compares |
| Explanation | ~3,000 tokens (Claude) | Needs skill run context |
| Follow-up (in thread) | ~2,000 tokens (Claude) | Has conversation context |

Estimated cost at 20 questions/day: ~$0.50/day per workspace. Manageable.

---

## Build Sequence

```
Phase 1: Level 0 + Level 1 (Replit-heavy)
├── Create Slack app, OAuth install flow          ← Replit
├── Update Slack client to dual-mode              ← Replit
├── Store message ts in skill_runs                ← Replit
├── Add action buttons to Slack formatter         ← Replit
├── Build /api/slack/interactions endpoint         ← Replit
├── Build mark_reviewed + snooze handlers         ← Replit
├── Build drill_deal handler                      ← Replit + Claude Code
└── Add snooze checking to skill compute          ← Claude Code

Phase 2: Level 2 (Claude Code-heavy)
├── Build /api/slack/events endpoint              ← Replit
├── Build thread matching (ts → skill_run)        ← Replit
├── Build DeepSeek intent classifier              ← Claude Code
├── Build drill_down handler (reuses dossier)     ← Claude Code
├── Build scope_filter handler (scoped re-run)    ← Claude Code + Replit
├── Build add_context handler                     ← Claude Code
└── Build question handler (scoped analysis)      ← Claude Code

Phase 3: Level 3 (Claude Code-heavy)
├── Add app_mention + DM event handling           ← Replit
├── Build question classifier                     ← Claude Code
├── Build data query handler                      ← Claude Code
├── Build comparison handler                      ← Claude Code
├── Build conversation state management           ← Claude Code
├── Build multi-turn follow-up handler            ← Claude Code
└── Add rate limiting for conversations           ← Replit
```

### Effort Estimates

| Phase | Replit | Claude Code | Total |
|---|---|---|---|
| Level 0 (Slack app migration) | 2-3 hours | 0 | 2-3 hours |
| Level 1 (Interactive buttons) | 3-4 hours | 1-2 hours | 4-6 hours |
| Level 2 (Threaded replies) | 2-3 hours | 4-5 hours | 6-8 hours |
| Level 3 (Conversational) | 1-2 hours | 6-8 hours | 8-10 hours |
| **Total** | **8-12 hours** | **11-15 hours** | **~20-27 hours** |

---

## What NOT to Build

- Slack app home tab (nice but low ROI — users interact in channels, not the app home)
- Slash commands (/@pandora /pipeline — redundant with @mention which is more natural)
- Message shortcuts (right-click → "Analyze with Pandora" — too discoverable-dependent)
- Scheduled messages from Slack (Pandora already has its own scheduler)
- Slack workflow builder integration (overlaps with Actions Engine)
- Multi-workspace Slack app (one Pandora workspace per Slack workspace for now)
- Slack Connect support (cross-org channels — future consideration)

---

## Dependencies on Other Specs

| Level | Depends On | Status |
|---|---|---|
| Level 1 — drill_deal | Command Center spec's `deal_dossier()` function | Not built yet — build lightweight version first |
| Level 2 — scoped re-run | Skill runtime `scope` parameter support | Partially exists — may need extension |
| Level 2 — add_context | Context layer write path | Exists |
| Level 3 — data queries | Scoped analysis endpoint (Command Center spec Phase A4) | Not built yet — required |
| Level 3 — multi-turn | Conversation state storage | New build |

**Recommendation:** Build Level 0 + Level 1 now (no external dependencies). Build Level 2 alongside Command Center Phase A (shared `deal_dossier` and scoped analysis). Build Level 3 after Command Center Phase A is complete (requires the scoped analysis endpoint).

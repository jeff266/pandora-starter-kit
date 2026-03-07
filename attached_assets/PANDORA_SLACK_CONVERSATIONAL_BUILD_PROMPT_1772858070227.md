# Pandora Build Prompt — Slack Conversational Interface
## Slash Commands + Thread Replies + DM Bot + Brief Consolidation

**Status:** Ready to build  
**Depends on:** Existing Slack OAuth bot integration, existing orchestrator (T010 session context), existing voice model (V1–V3), existing renderer pipeline, existing brief assembly  
**Goal:** Transform Slack from a push notification surface into a pull-first conversational surface. Reduce noise from multiple skill-run posts to one voice-modeled brief per cadence. Enable Ask Pandora and Assistant functionality directly in Slack without opening the app.

---

## Before Starting

Read these files before writing any code:

1. Existing Slack integration — find where Slack messages are posted today, what OAuth scopes are configured, what the bot token setup looks like
2. `server/agents/orchestrator.ts` — the full orchestrator including session context (T010), voice injection (V2), live deal lookup (T6), chart emitter (T3)
3. `server/voice/voice-renderer.ts` (V1) — voice transformation; Slack responses use `surface: 'slack'`
4. `server/renderers/slack-renderer.ts` — existing Block Kit formatter; understand current output shape
5. `server/briefs/brief-assembler.ts` — how weekly_briefs are assembled and what fields are available
6. `server/documents/accumulator.ts` (T011) — session findings accumulation; Slack sessions should accumulate too
7. `server/agents/session-context.ts` (T010) — SessionContext shape; Slack threads need their own session contexts
8. `server/llm/router.ts` — capability routing; Slack responses use the same router as app chat
9. `PANDORA_EVIDENCE_ARCHITECTURE_REFERENCE.md` — the pre-routed interaction table; slash commands are already specified as Type 2 / Type 4
10. The existing `workspace_configs` table — where Slack channel and webhook config is stored

**Do not proceed until you have read all ten.**

---

## Architecture Principles

**Pull over push.** Scheduled skill dumps are replaced by one consolidated brief per cadence. Everything else is on-demand — slash commands, thread replies, DM conversations. The user chooses when to engage.

**Same orchestrator, different renderer.** A slash command question goes through the exact same session context, live deal lookup, voice model, and cross-signal analysis as an Ask Pandora chat message. The only difference is the response renders as Block Kit instead of React. No separate Slack-specific intelligence.

**Thread = session.** Each Slack thread gets its own `SessionContext`. When you reply to a brief in a thread, the thread inherits the brief's context — current attainment, deals surfaced, scope. Subsequent replies accumulate in the thread session and can be rendered as a document via the document accumulator.

**Ephemeral by default, shareable by choice.** Slash command responses are visible only to the person who asked, by default. Add a "Share in channel" button to every ephemeral response so the user can choose to broadcast.

**Brief consolidation is the noise fix.** Three skill runs a week → one brief. The brief uses the voice model. It tells the story, not the list. Thread replies handle drill-down.

---

## Task List

---

### S1 — Slack Bot Event Handler Infrastructure

**Files:** `server/slack/event-handler.ts` (new), `server/slack/types.ts` (new), update `server/index.ts` to register routes

Slack sends events to a webhook endpoint. This task sets up the infrastructure to receive and route them.

**Slack app configuration (requires manual setup in Slack API dashboard):**

```
OAuth Scopes needed:
  Bot Token Scopes:
    chat:write           — post messages
    chat:write.public    — post to channels without joining
    commands             — slash commands
    im:history           — read DM history
    im:write             — send DMs
    channels:history     — read channel messages (for thread context)
    reactions:read       — read reactions for implicit signal capture (F4)
    users:read           — resolve user IDs to names/emails
    
Event Subscriptions:
    message.im           — DM messages to bot
    message.channels     — @mentions in channels
    app_mention          — @Pandora mentions
```

**Incoming event endpoint:**

```typescript
// server/slack/event-handler.ts

import { verifySlackRequest } from './verify';   // HMAC-SHA256 signature verification

export function registerSlackRoutes(app: Express): void {
  
  // Slack URL verification challenge (required during app setup)
  app.post('/api/slack/events', async (req, res) => {
    
    // Verify request signature
    if (!verifySlackRequest(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { type, challenge, event } = req.body;
    
    // URL verification handshake
    if (type === 'url_verification') {
      return res.json({ challenge });
    }
    
    // Acknowledge immediately — Slack requires response within 3 seconds
    res.status(200).send();
    
    // Process event asynchronously
    setImmediate(() => handleSlackEvent(event));
  });
  
  // Slash command endpoint
  app.post('/api/slack/commands', async (req, res) => {
    if (!verifySlackRequest(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Acknowledge with deferred response
    res.json({
      response_type: 'ephemeral',
      text: '✦ Pandora is thinking...'
    });
    
    // Process asynchronously with response_url
    setImmediate(() => handleSlashCommand(req.body));
  });
  
  // Interactive components (button clicks in Block Kit messages)
  app.post('/api/slack/interactions', async (req, res) => {
    if (!verifySlackRequest(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    res.status(200).send();
    
    const payload = JSON.parse(req.body.payload);
    setImmediate(() => handleSlackInteraction(payload));
  });
}

async function handleSlackEvent(event: SlackEvent): Promise<void> {
  switch (event.type) {
    case 'message':
      if (event.channel_type === 'im' && !event.bot_id) {
        // DM to bot — full conversational mode
        await handleDMMessage(event);
      } else if (event.thread_ts && !event.bot_id) {
        // Thread reply in a channel
        await handleThreadReply(event);
      }
      break;
    case 'app_mention':
      await handleAppMention(event);
      break;
  }
}
```

**Workspace resolution:** Every incoming Slack event must resolve to a Pandora workspace. Store the mapping in workspace config:

```sql
-- Add to workspace_configs or a separate slack_integrations table
ALTER TABLE workspace_configs ADD COLUMN IF NOT EXISTS slack_config JSONB DEFAULT '{}';

-- slack_config shape:
{
  "team_id": "T1234567",          -- Slack workspace ID
  "bot_token": "xoxb-...",        -- encrypted
  "signing_secret": "...",        -- encrypted  
  "default_channel": "C1234567",  -- #revenue-ops channel ID
  "brief_channel": "C1234567",    -- where scheduled briefs post
  "admin_user_ids": ["U1234567"]  -- Slack user IDs of workspace admins
}
```

```typescript
async function resolveWorkspaceFromSlack(teamId: string): Promise<string | null> {
  const result = await db.query(`
    SELECT id FROM workspaces
    WHERE config->>'slack_config'->>'team_id' = $1
  `, [teamId]);
  return result.rows[0]?.id || null;
}
```

**Acceptance:** The `/api/slack/events`, `/api/slack/commands`, and `/api/slack/interactions` endpoints are registered. HMAC-SHA256 signature verification rejects requests without a valid Slack signature. URL verification handshake works. A test DM to the bot logs the event without errors.

---

### S2 — Slash Command: `/pandora`

**Files:** `server/slack/slash-command.ts` (new)

The `/pandora` slash command is the primary on-demand interface. It routes to the full orchestrator — the same path as Ask Pandora in the app.

**Command syntax:**

```
/pandora [question or subcommand]

Subcommands:
  /pandora [natural language question]   → Ask Pandora (default)
  /pandora brief                         → Post the current VP RevOps brief
  /pandora run [skill_name]              → Run a specific skill
  /pandora status                        → Workspace sync status + last brief time
  /pandora help                          → List available commands
```

**Implementation:**

```typescript
// server/slack/slash-command.ts

export async function handleSlashCommand(payload: SlackSlashCommandPayload): Promise<void> {
  const { text, user_id, team_id, channel_id, response_url } = payload;
  
  const workspaceId = await resolveWorkspaceFromSlack(team_id);
  if (!workspaceId) {
    await postToResponseUrl(response_url, {
      response_type: 'ephemeral',
      text: '⚠️ This Slack workspace is not connected to a Pandora workspace. Contact your admin.'
    });
    return;
  }
  
  const trimmed = text.trim();
  
  // Route to subcommand or Ask Pandora
  if (trimmed === 'brief') {
    await handleBriefCommand(workspaceId, user_id, channel_id, response_url);
  } else if (trimmed === 'status') {
    await handleStatusCommand(workspaceId, response_url);
  } else if (trimmed === 'help') {
    await handleHelpCommand(response_url);
  } else if (trimmed.startsWith('run ')) {
    const skillName = trimmed.slice(4).trim();
    await handleRunCommand(workspaceId, skillName, response_url);
  } else if (trimmed.length > 0) {
    // Default: treat as Ask Pandora question
    await handleAskCommand(workspaceId, user_id, channel_id, trimmed, response_url);
  } else {
    await handleHelpCommand(response_url);
  }
}

async function handleAskCommand(
  workspaceId: string,
  slackUserId: string,
  channelId: string,
  question: string,
  responseUrl: string
): Promise<void> {
  
  // Resolve Slack user to Pandora user (match on email via Slack users.info API)
  const slackUser = await getSlackUserInfo(workspaceId, slackUserId);
  
  // Create or retrieve a Slack session context for this user
  // Key: workspace_id + slack_user_id (Slack sessions are per-user, not per-thread)
  const sessionContext = await getOrCreateSlackSession(workspaceId, slackUserId);
  
  // Run through the full orchestrator — same as Ask Pandora
  const response = await orchestrator.handleMessage({
    workspaceId,
    message: question,
    sessionContext,
    surface: 'slack',                // voice renderer uses this
  });
  
  // Render to Block Kit
  const blocks = renderToBlockKit(response, {
    includeShareButton: true,        // "Share in channel" button
    includeDeepLink: true,           // "Open in Pandora" button
    ephemeral: true,
  });
  
  // Post ephemeral response (only visible to the person who asked)
  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    blocks,
    replace_original: true,         // replace the "thinking..." message
  });
  
  // Update session context with this exchange
  await updateSlackSession(workspaceId, slackUserId, sessionContext, question, response);
}
```

**Session persistence for slash commands:**

Slash command sessions are per-user-per-workspace. The session context accumulates across slash command uses within the same day (TTL: end of business day or 8 hours, whichever comes first). This gives scope inheritance — if you `/pandora show me Sara's pipeline` and then `/pandora what are her stale deals?` the second command inherits the Sara scope.

```typescript
interface SlackSessionStore {
  [key: string]: {          // key: `${workspaceId}:${slackUserId}`
    sessionContext: SessionContext;
    lastActiveAt: string;
    expiresAt: string;
  }
}

// In-memory store with TTL (replace with Redis if scale demands it)
const slackSessions: SlackSessionStore = {};

async function getOrCreateSlackSession(
  workspaceId: string,
  slackUserId: string
): Promise<SessionContext> {
  const key = `${workspaceId}:${slackUserId}`;
  const existing = slackSessions[key];
  
  if (existing && new Date(existing.expiresAt) > new Date()) {
    return existing.sessionContext;
  }
  
  // Create new session
  const sessionContext = await createSessionContext(workspaceId);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  
  slackSessions[key] = { sessionContext, lastActiveAt: new Date().toISOString(), expiresAt };
  return sessionContext;
}
```

**Brief command:**

```typescript
async function handleBriefCommand(
  workspaceId: string,
  userId: string,
  channelId: string,
  responseUrl: string
): Promise<void> {
  
  // Pull current brief from weekly_briefs table
  const brief = await getLatestBrief(workspaceId);
  
  if (!brief) {
    await postToResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      text: 'No brief available yet. Briefs are generated daily — check back this evening.'
    });
    return;
  }
  
  // Render brief as Block Kit (uses the brief slack renderer from S3)
  const blocks = renderBriefToBlockKit(brief, { compact: true });
  
  // Post ephemeral — user can share if they want
  await postToResponseUrl(responseUrl, {
    response_type: 'ephemeral',
    blocks,
    replace_original: true
  });
}
```

**Acceptance:** `/pandora how's our pipeline coverage?` returns an ephemeral response in under 10 seconds with the answer, a "Share in channel" button, and an "Open in Pandora" deep link. `/pandora brief` returns the current brief summary. `/pandora run pipeline-hygiene` triggers the skill and posts results. Scope inheritance: asking about Sara in one command and her stale deals in the next correctly inherits the Sara scope.

---

### S3 — Brief Slack Renderer (Consolidation)

**Files:** `server/slack/brief-renderer.ts` (new), update `server/briefs/brief-assembler.ts` to use it for scheduled posts

This task replaces the current pattern of multiple skill-run Slack posts with a single consolidated brief post. One message per cadence. Voice-modeled. Tells the story, not the list.

**The current pattern (replace this):**

```
Monday 8:00 AM — Pipeline Hygiene results posted (12 block kit blocks)
Monday 8:05 AM — Single Thread Alert results posted (8 block kit blocks)
Monday 8:10 AM — Data Quality Audit results posted (6 block kit blocks)
Monday 8:15 AM — Weekly Recap posted (10 block kit blocks)
```

**The new pattern:**

```
Monday 8:00 AM — One brief post (the VP RevOps Brief narrative + top 3 findings + action buttons)
```

**Brief Block Kit structure:**

```typescript
// server/slack/brief-renderer.ts

export function renderBriefToBlockKit(
  brief: WeeklyBrief,
  options: { compact?: boolean; includeFullFindingsButton?: boolean } = {}
): Block[] {
  const blocks: Block[] = [];
  
  // ── Header ────────────────────────────────────────────
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `VP RevOps Brief · ${formatDate(brief.assembled_at)}`
    }
  });
  
  // ── Narrative (the voice-modeled prose) ───────────────
  // Use ai_blurbs.week_summary or pulse_summary — NOT template text
  const narrative = brief.ai_blurbs?.pulse_summary || brief.ai_blurbs?.week_summary;
  if (narrative) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: narrative }
    });
  }
  
  // ── Metrics strip ─────────────────────────────────────
  if (brief.the_number) {
    const { attainment_pct, coverage_ratio, gap, days_remaining } = brief.the_number;
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: [
          attainment_pct != null ? `*${Math.round(attainment_pct)}% attainment*` : null,
          coverage_ratio != null ? `${coverage_ratio.toFixed(1)}x coverage` : null,
          gap != null ? `$${formatAmount(gap)} gap` : null,
          days_remaining != null ? `${days_remaining}d remaining` : null,
        ].filter(Boolean).join('  ·  ')
      }]
    });
  }
  
  // ── Since last week (comparison block) ───────────────
  if (brief.comparison && !options.compact) {
    const { resolved, persisted, new: newItems } = brief.comparison;
    const lines: string[] = [];
    resolved.slice(0, 2).forEach(r => lines.push(`✓  ${r.summary}`));
    persisted.slice(0, 2).forEach(p => lines.push(`→  ${p.summary}${p.occurrenceCount >= 3 ? ` · ${p.occurrenceCount} weeks` : ''}`));
    newItems.slice(0, 2).forEach(n => lines.push(`⚡  ${n.summary}`));
    
    if (lines.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Since last week*\n${lines.join('\n')}` }
      });
    }
  }
  
  // ── Focus block ───────────────────────────────────────
  const focus = brief.ai_blurbs?.key_action || brief.ai_blurbs?.next_week_focus;
  if (focus) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Focus this week*\n${focus}` }
    });
  }
  
  // ── Top findings (max 3, by severity) ────────────────
  if (brief.top_findings?.length && !options.compact) {
    blocks.push({ type: 'divider' });
    
    const topFindings = brief.top_findings.slice(0, 3);
    topFindings.forEach(finding => {
      const icon = finding.severity === 'critical' ? '🔴' : finding.severity === 'warning' ? '🟡' : '🔵';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} ${finding.message}` }
      });
    });
  }
  
  // ── Staleness warning ─────────────────────────────────
  if (brief.is_potentially_stale) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `⚠️ A sync ran after this brief was assembled. Some numbers may have changed.`
      }]
    });
  }
  
  // ── Assembly timestamp ────────────────────────────────
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `As of ${formatTime(brief.assembled_at)}  ·  Reply to ask a follow-up question`
    }]
  });
  
  // ── Action buttons ────────────────────────────────────
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Pandora' },
        url: `${process.env.APP_URL}/command-center`,
        action_id: 'open_in_pandora'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Ask a question' },
        action_id: 'open_ask_modal',   // opens a modal for free-text question
        value: JSON.stringify({ workspaceId: brief.workspace_id })
      },
      ...(options.includeFullFindingsButton ? [{
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: 'All findings →' },
        action_id: 'view_all_findings',
        value: brief.workspace_id
      }] : [])
    ]
  });
  
  return blocks;
}
```

**Brief post consolidation:** Update the brief assembly scheduler to post ONE brief message instead of per-skill posts. When skills complete their cron runs, they write to `skill_runs` as before — but they no longer post to Slack independently. The brief assembler reads all skill runs for the period and posts the consolidated brief.

```typescript
// In brief-assembler.ts — update the post-assembly step

async function postBriefToSlack(workspaceId: string, brief: WeeklyBrief): Promise<void> {
  const slackConfig = await getSlackConfig(workspaceId);
  if (!slackConfig?.brief_channel) return;
  
  const blocks = renderBriefToBlockKit(brief, { includeFullFindingsButton: true });
  
  const response = await slackClient.chat.postMessage({
    channel: slackConfig.brief_channel,
    blocks,
    text: `VP RevOps Brief · ${formatDate(brief.assembled_at)}`  // fallback for notifications
  });
  
  // Store the message timestamp for thread reply routing (S4)
  await db.query(`
    UPDATE weekly_briefs
    SET slack_message_ts = $1, slack_channel_id = $2
    WHERE id = $3
  `, [response.ts, slackConfig.brief_channel, brief.id]);
}
```

**Acceptance:** Skills run on their schedule but no longer post to Slack individually. One brief posts Monday morning (or on cadence). The brief block contains the voice-modeled narrative, metrics strip, since-last-week comparison, focus block, and top 3 findings. The "Ask a question" button opens a modal. Reply count in #revenue-ops drops from 4+ messages per week to 1.

---

### S4 — Thread Reply Routing

**Files:** `server/slack/thread-handler.ts` (new)

When someone replies to a Pandora brief or alert in Slack, the reply routes through the orchestrator with the brief's context pre-loaded. The thread becomes a live Q&A session about the brief.

```typescript
// server/slack/thread-handler.ts

export async function handleThreadReply(event: SlackMessageEvent): Promise<void> {
  const { text, user, channel, thread_ts, ts, team_id } = event;
  
  // Ignore bot messages and empty messages
  if (event.bot_id || !text?.trim()) return;
  
  const workspaceId = await resolveWorkspaceFromSlack(team_id);
  if (!workspaceId) return;
  
  // Find the parent message — is it a Pandora brief or alert?
  const parentMessage = await findPandoraParentMessage(workspaceId, channel, thread_ts);
  if (!parentMessage) return;  // not a Pandora thread, ignore
  
  // Get or create thread session context
  // Thread sessions are keyed by channel + thread_ts — persistent for the thread's lifetime
  const sessionContext = await getOrCreateThreadSession(
    workspaceId, channel, thread_ts, parentMessage
  );
  
  // Load thread history for conversational context
  const threadHistory = await getThreadHistory(workspaceId, channel, thread_ts);
  sessionContext.conversationHistory = threadHistory;
  
  // Run through orchestrator
  const response = await orchestrator.handleMessage({
    workspaceId,
    message: text,
    sessionContext,
    surface: 'slack',
  });
  
  // Render and post as thread reply (visible to everyone in the thread)
  const blocks = renderToBlockKit(response, {
    includeShareButton: false,    // already in a channel
    includeDeepLink: true,
    ephemeral: false,
  });
  
  await slackClient.chat.postMessage({
    channel,
    thread_ts,                    // reply in the thread
    blocks,
    text: extractPlainText(response)  // fallback
  });
  
  // Update thread session
  await updateThreadSession(workspaceId, channel, thread_ts, sessionContext, text, response);
}

async function findPandoraParentMessage(
  workspaceId: string,
  channel: string,
  thread_ts: string
): Promise<PandoraParentMessage | null> {
  
  // Check if this thread_ts matches a brief we posted
  const brief = await db.query(`
    SELECT * FROM weekly_briefs
    WHERE workspace_id = $1
      AND slack_message_ts = $2
      AND slack_channel_id = $3
  `, [workspaceId, thread_ts, channel]);
  
  if (brief.rows[0]) {
    return { type: 'brief', data: brief.rows[0] };
  }
  
  // Check if it matches an alert or action card
  const alert = await db.query(`
    SELECT * FROM slack_messages
    WHERE workspace_id = $1
      AND message_ts = $2
      AND channel_id = $3
  `, [workspaceId, thread_ts, channel]);
  
  if (alert.rows[0]) {
    return { type: 'alert', data: alert.rows[0] };
  }
  
  return null;
}

async function getOrCreateThreadSession(
  workspaceId: string,
  channel: string,
  thread_ts: string,
  parentMessage: PandoraParentMessage
): Promise<SessionContext> {
  const key = `thread:${channel}:${thread_ts}`;
  
  if (slackSessions[key]) {
    return slackSessions[key].sessionContext;
  }
  
  // Create session pre-loaded with the brief's context
  const sessionContext = await createSessionContext(workspaceId);
  
  if (parentMessage.type === 'brief') {
    const brief = parentMessage.data;
    
    // Pre-load brief metrics into session
    sessionContext.computedThisSession['current_attainment'] = {
      data: brief.the_number,
      calculationId: `brief:${brief.id}`,
      fetchedAt: brief.assembled_at,
      ttlMinutes: 60,
    };
    
    // Pre-load deals to watch as already-fetched scope
    if (brief.deals_to_watch?.length) {
      sessionContext.dealsLookedUp = Object.fromEntries(
        brief.deals_to_watch.map((d: any) => [d.name, d])
      );
    }
  }
  
  slackSessions[key] = {
    sessionContext,
    lastActiveAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()  // 24h for threads
  };
  
  return sessionContext;
}
```

**Acceptance:** Reply to a Pandora brief in Slack with "what about Action Behavior Centers?" — Pandora responds in the thread with deal-scoped context. Reply again with "what are Sara's single-threaded deals?" — the response correctly scopes to Sara. The thread reads as a natural conversation, not disconnected responses.

---

### S5 — DM Bot: Full Conversational Mode

**Files:** `server/slack/dm-handler.ts` (new)

A DM to the Pandora bot is the most natural Ask Pandora interface. No slash commands, no channels — just a direct message thread that behaves exactly like the in-app chat.

```typescript
// server/slack/dm-handler.ts

export async function handleDMMessage(event: SlackMessageEvent): Promise<void> {
  const { text, user, channel, team_id } = event;
  
  if (event.bot_id || !text?.trim()) return;
  
  const workspaceId = await resolveWorkspaceFromSlack(team_id);
  if (!workspaceId) return;
  
  // Show typing indicator
  await slackClient.chat.postMessage({
    channel,
    text: '✦ thinking...',
  }).then(async (thinkingMsg) => {
    
    // Get or create DM session for this user
    // DM sessions are persistent per user — they accumulate across days
    // (unlike slash command sessions which expire after 8 hours)
    const sessionContext = await getOrCreateSlackSession(workspaceId, user, {
      ttlHours: 72,    // DM sessions persist 72 hours
      persistent: true
    });
    
    // Run through orchestrator
    const response = await orchestrator.handleMessage({
      workspaceId,
      message: text,
      sessionContext,
      surface: 'slack',
    });
    
    // Delete typing indicator
    await slackClient.chat.delete({ channel, ts: thinkingMsg.ts });
    
    // Render and post
    const blocks = renderToBlockKit(response, {
      includeShareButton: true,   // "Share in #revenue-ops" button
      includeDeepLink: true,
      ephemeral: false,           // DMs are already private
    });
    
    await slackClient.chat.postMessage({
      channel,
      blocks,
      text: extractPlainText(response)
    });
    
    // Update session
    await updateSlackSession(workspaceId, user, sessionContext, text, response);
    
    // Document accumulator: DM sessions can also build documents
    // If the user types "render as WBR" — accumulate and offer render
    if (shouldTriggerDocumentAccumulator(text, response)) {
      await postDocumentAccumulatorStatus(channel, workspaceId, user, sessionContext);
    }
  });
}

async function postDocumentAccumulatorStatus(
  channel: string,
  workspaceId: string,
  userId: string,
  sessionContext: SessionContext
): Promise<void> {
  if (sessionContext.sessionFindings.length < 3) return;  // not enough to render
  
  const sectionCounts = summarizeAccumulatorSections(sessionContext);
  
  await slackClient.chat.postMessage({
    channel,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📄 *We've covered a lot.* I can render this conversation as a document:\n${sectionCounts}`
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Render as WBR →' },
        action_id: 'render_document_from_dm',
        value: JSON.stringify({ workspaceId, userId, template: 'weekly_business_review' })
      }
    }]
  });
}
```

**DM onboarding message:** When a user DMs the bot for the first time, send a brief intro:

```
Hi! I'm Pandora — your RevOps analyst.

Ask me anything about your pipeline, forecast, reps, or deals. Try:
• "How's our pipeline coverage?"
• "What's Sara's biggest risk this week?"
• "Show me deals closing this month"
• "Why are we missing mid-market?"

Or type /pandora in any channel to ask without leaving your conversation.
```

**Acceptance:** DM "how's our pipeline coverage?" to the Pandora bot. Get a response in under 10 seconds. Reply "what about Sara specifically?" — inherits Sara scope. DM session persists across multiple messages. After 5+ substantive exchanges, the document accumulator status appears offering to render as WBR.

---

### S6 — Block Kit Response Renderer

**Files:** `server/slack/block-kit-renderer.ts` (new)

The Block Kit renderer transforms orchestrator `ResponseBlock[]` (prose, table, chart) into Slack Block Kit blocks. This is the Slack equivalent of the React renderer in the app.

```typescript
// server/slack/block-kit-renderer.ts

export function renderToBlockKit(
  response: OrchestratorResponse,
  options: BlockKitRenderOptions
): Block[] {
  const blocks: Block[] = [];
  
  for (const block of response.blocks) {
    switch (block.blockType) {
      case 'prose':
        blocks.push(...renderProseBlock(block));
        break;
      case 'table':
        blocks.push(...renderTableBlock(block));
        break;
      case 'chart':
        // Charts can't render natively in Slack — convert to table + annotation
        blocks.push(...renderChartAsTable(block));
        break;
      case 'strategic_reasoning':
        blocks.push(...renderStrategicReasoningBlock(block));
        break;
      case 'action_card':
        blocks.push(...renderActionCard(block));
        break;
    }
  }
  
  // Share button
  if (options.includeShareButton) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Share in channel' },
        action_id: 'share_in_channel',
        value: JSON.stringify({ blocks: response.blocks })  // re-render as public
      }]
    });
  }
  
  // Deep link
  if (options.includeDeepLink) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `<${process.env.APP_URL}/command-center|Open in Pandora →>`
      }]
    });
  }
  
  return blocks;
}

function renderChartAsTable(block: ChartBlock): Block[] {
  // Charts don't render in Slack — convert data to a formatted table
  const { spec } = block;
  const blocks: Block[] = [];
  
  // Title
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*${spec.title}*${spec.subtitle ? `\n_${spec.subtitle}_` : ''}` }
  });
  
  // Data as formatted text table
  const rows = spec.data.map(point => {
    const value = spec.yAxis?.format === 'currency'
      ? `$${formatAmount(point.value)}`
      : spec.yAxis?.format === 'percent'
      ? `${point.value}%`
      : String(point.value);
    
    const annotation = point.annotation ? ` ⚠` : '';
    return `${point.label.padEnd(20)} ${value}${annotation}`;
  });
  
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `\`\`\`\n${rows.join('\n')}\n\`\`\`` }
  });
  
  // Annotation (the "so what")
  if (spec.annotation) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${spec.annotation}_` }]
    });
  }
  
  return blocks;
}

function renderStrategicReasoningBlock(block: StrategicReasoningBlock): Block[] {
  const { output } = block;
  const blocks: Block[] = [];
  
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: [
        `🧠 *Hypothesis*\n${output.hypothesis}`,
        `\n*Recommendation*\n${output.recommendation}`,
        output.watchFor?.length ? `\n*Watch for:* ${output.watchFor.join(', ')}` : '',
        `\n_Confidence: ${output.confidence}_`
      ].filter(Boolean).join('\n')
    }
  });
  
  return blocks;
}
```

**Charts in Slack:** Native chart rendering isn't possible in Block Kit. The renderer converts charts to formatted monospace tables with the annotation preserved. Optionally, for workspaces where the Slack app has file upload scope, render the chart as a PNG image using a server-side canvas library and upload it. This is a stretch goal — monospace table is the v1.

**Acceptance:** Ask a pipeline-by-stage question via `/pandora`. The Slack response includes the data as a formatted monospace table with the annotation below it. The "Open in Pandora" deep link is present. A strategic reasoning question renders all six sections in a single block.

---

### S7 — Noise Reduction: Skill Run Slack Suppression

**Files:** Update `server/skills/runtime.ts` or wherever post-skill Slack posts happen

Skills should no longer post to Slack independently. Their findings are consolidated into the brief (S3). This task removes the per-skill Slack posts.

```typescript
// In skill runtime, find the post-execution Slack post and gate it:

async function postSkillResultsToSlack(
  workspaceId: string,
  skillId: string,
  result: SkillOutput
): Promise<void> {
  
  // Check workspace config — are we in brief-consolidation mode?
  const slackConfig = await getSlackConfig(workspaceId);
  
  if (slackConfig?.use_consolidated_brief) {
    // Don't post skill results individually — they'll be included in the next brief
    console.log(`[Skill] ${skillId} results suppressed — consolidated brief mode active`);
    return;
  }
  
  // Legacy mode: post individually (for workspaces not yet migrated)
  await postToSlack(workspaceId, result);
}
```

**Migration flag:** Add `use_consolidated_brief: boolean` to the Slack config. Default `false` for existing workspaces (no breaking change). New workspaces default `true`. Existing workspaces can opt in via the admin settings.

**Admin setting:** In the Slack settings section of the workspace admin, show:

```
Slack Notifications

  Brief style:
  ○ Consolidated (recommended) — One weekly brief instead of per-skill notifications
  ○ Per-skill — Post each skill run result separately (legacy)
  
  [Save]
```

**Acceptance:** With `use_consolidated_brief: true`, running pipeline-hygiene does not post to Slack. The Monday brief post contains the pipeline hygiene findings. With `use_consolidated_brief: false` (legacy), behavior is unchanged.

---

## Sequencing

```
S1 (infrastructure) — first, everything else depends on the event handler
  ↓
S2 (slash commands) — depends on S1
S5 (DM bot) — depends on S1
  ↓ (S2 and S5 can run in parallel)
S3 (brief renderer + consolidation) — depends on S1, can parallel S2/S5
S6 (block kit renderer) — depends on S1, needed by S2/S4/S5
  ↓
S4 (thread replies) — depends on S1 + S3 (needs brief message_ts) + S6
  ↓
S7 (noise suppression) — last, after brief consolidation is working
```

Build order: S1 → S6 and S3 in parallel → S2 and S5 in parallel → S4 → S7.

---

## Acceptance Criteria — Full Suite

1. **Slash command works end-to-end.** `/pandora how's our pipeline coverage?` returns an ephemeral response in under 10 seconds. Response uses the teammate voice. "Open in Pandora" deep link works. "Share in channel" posts the response publicly.

2. **Scope inheritance works.** `/pandora show me Sara's pipeline` then `/pandora what are her single-threaded deals?` — second command inherits Sara scope without restating it.

3. **Brief renders as one message.** Monday morning one brief appears in #revenue-ops. It contains the narrative prose (not template text), metrics strip, since-last-week block, focus block, and top 3 findings. No separate skill-run messages appear.

4. **Thread replies work.** Reply to the Monday brief with "what about Action Behavior Centers?" — Pandora responds in the thread with deal-scoped context in under 10 seconds.

5. **DM bot works.** DM "show me deals closing this month" to the Pandora bot. Get a response. Reply "which one is highest risk?" — inherits scope. After 5+ exchanges, the document accumulator status appears.

6. **Charts render as tables in Slack.** A pipeline-by-stage chart from the orchestrator renders as a formatted monospace table in Slack with the annotation below it.

7. **Noise is reduced.** In `use_consolidated_brief: true` mode, a week passes with 4 skills running — only 1 Slack post appears (the brief). In legacy mode, behavior is unchanged.

8. **No regression.** All T010–T021, F1–FT6, V1–V6 features work. The orchestrator is not modified — only called from new Slack entry points. The brief assembler continues to work for the in-app Command Center.

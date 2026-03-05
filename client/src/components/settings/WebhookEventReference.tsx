import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';

// ---------------------------------------------------------------------------
// Syntax highlighter — pure CSS, no external deps
// Tokenises a raw JSON string and returns spans with colour coding.
// ---------------------------------------------------------------------------
function highlight(json: string): React.ReactNode {
  const tokens: { type: string; value: string }[] = [];
  let i = 0;

  while (i < json.length) {
    // Whitespace
    if (/\s/.test(json[i])) {
      let w = '';
      while (i < json.length && /\s/.test(json[i])) w += json[i++];
      tokens.push({ type: 'ws', value: w });
      continue;
    }
    // String
    if (json[i] === '"') {
      let s = '"';
      i++;
      while (i < json.length) {
        if (json[i] === '\\') { s += json[i] + json[i + 1]; i += 2; continue; }
        if (json[i] === '"') { s += '"'; i++; break; }
        s += json[i++];
      }
      // Peek ahead past whitespace for colon → it's a key
      let j = i;
      while (j < json.length && json[j] === ' ') j++;
      tokens.push({ type: json[j] === ':' ? 'key' : 'string', value: s });
      continue;
    }
    // Number
    if (/[-\d]/.test(json[i])) {
      let n = '';
      while (i < json.length && /[-\d.eE+]/.test(json[i])) n += json[i++];
      tokens.push({ type: 'number', value: n });
      continue;
    }
    // true / false / null
    if (json.slice(i, i + 4) === 'true') { tokens.push({ type: 'bool', value: 'true' }); i += 4; continue; }
    if (json.slice(i, i + 5) === 'false') { tokens.push({ type: 'bool', value: 'false' }); i += 5; continue; }
    if (json.slice(i, i + 4) === 'null') { tokens.push({ type: 'null', value: 'null' }); i += 4; continue; }
    // Comment (not valid JSON but we use it in examples)
    if (json[i] === '/' && json[i + 1] === '/') {
      let c = '';
      while (i < json.length && json[i] !== '\n') c += json[i++];
      tokens.push({ type: 'comment', value: c });
      continue;
    }
    // Punctuation
    tokens.push({ type: 'punct', value: json[i++] });
  }

  const colour: Record<string, string> = {
    key: '#94a3b8',
    string: '#86efac',
    number: '#fbbf24',
    bool: '#f87171',
    null: '#f87171',
    punct: '#64748b',
    ws: 'inherit',
    comment: '#64748b',
  };

  return tokens.map((t, idx) => (
    <span key={idx} style={{ color: colour[t.type] ?? 'inherit' }}>
      {t.value}
    </span>
  ));
}

// ---------------------------------------------------------------------------
// CodeBlock — dark background, copy button, syntax-highlighted JSON
// ---------------------------------------------------------------------------
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: 'relative', marginTop: 12 }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          padding: '3px 10px',
          borderRadius: 4,
          border: '1px solid #334155',
          background: '#1e293b',
          color: copied ? '#86efac' : '#94a3b8',
          fontSize: 11,
          fontFamily: fonts.sans,
          cursor: 'pointer',
          zIndex: 1,
          transition: 'color 0.15s',
        }}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <pre
        style={{
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: 8,
          padding: '20px 20px 20px 20px',
          margin: 0,
          overflowX: 'auto',
          fontSize: 12,
          lineHeight: 1.65,
          fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, monospace',
        }}
      >
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventCard — one card per event type
// ---------------------------------------------------------------------------
interface EventCardProps {
  eventType: string;
  badgeColor: string;
  description: string;
  firesWhen: string;
  automations: string[];
  payload: string;
  fields: { name: string; type: string; description: string }[];
}

function EventCard({
  eventType,
  badgeColor,
  description,
  firesWhen,
  automations,
  payload,
  fields,
}: EventCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 16,
        fontFamily: fonts.sans,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          background: colors.surface,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: '"Fira Code", "Cascadia Code", Menlo, monospace',
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 5,
            background: `${badgeColor}18`,
            color: badgeColor,
            border: `1px solid ${badgeColor}35`,
            flexShrink: 0,
          }}
        >
          {eventType}
        </span>
        <span style={{ fontSize: 13, color: colors.text, flex: 1 }}>{description}</span>
        <span style={{ fontSize: 14, color: colors.muted, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '0 18px 20px', background: colors.bg }}>
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18 }}>

            {/* Fires when */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted }}>
                Fires when
              </span>
              <p style={{ margin: '5px 0 0', fontSize: 13, color: colors.text, lineHeight: 1.55 }}>
                {firesWhen}
              </p>
            </div>

            {/* Common automations */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted }}>
                Common automations
              </span>
              <ul style={{ margin: '7px 0 0', paddingLeft: 18 }}>
                {automations.map((a, i) => (
                  <li key={i} style={{ fontSize: 13, color: colors.text, marginBottom: 4, lineHeight: 1.5 }}>{a}</li>
                ))}
              </ul>
            </div>

            {/* Key fields */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted }}>
                Key fields
              </span>
              <div style={{ marginTop: 8, border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
                {fields.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '180px 80px 1fr',
                      borderBottom: i < fields.length - 1 ? `1px solid ${colors.border}` : 'none',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#94a3b8', background: '#0f172a' }}>
                      {f.name}
                    </div>
                    <div style={{ padding: '7px 10px', color: '#fbbf24', background: '#0f172a', fontFamily: 'monospace' }}>
                      {f.type}
                    </div>
                    <div style={{ padding: '7px 12px', color: colors.muted }}>
                      {f.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Example payload */}
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted }}>
                Example payload
              </span>
              <CodeBlock code={payload} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared envelope fields (same for all events)
// ---------------------------------------------------------------------------
const ENVELOPE_FIELDS = [
  { name: 'event', type: 'string', description: 'The event type, e.g. "prospect.scored"' },
  { name: 'event_id', type: 'string', description: 'Unique delivery ID — use for idempotency checks' },
  { name: 'timestamp', type: 'string', description: 'ISO 8601 UTC timestamp of when the event occurred' },
  { name: 'workspace_id', type: 'string', description: 'Pandora workspace UUID the event belongs to' },
  { name: 'api_version', type: 'string', description: 'Payload schema version — currently "2026-03-01"' },
  { name: 'data', type: 'object', description: 'Event-specific payload (see each event below)' },
];

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------
const EVENTS: EventCardProps[] = [
  {
    eventType: 'prospect.scored',
    badgeColor: '#7c3aed',
    description: 'A deal or contact score changed by 5 or more points during a scoring run.',
    firesWhen:
      'After each scoring run completes, Pandora filters for any deal or contact whose total score moved by ±5 points or more since the previous run. One event is emitted per entity, per registered endpoint. Runs that produce no significant changes emit nothing.',
    automations: [
      'Write the new score and grade back to a HubSpot or Salesforce custom property using the source_id.',
      'Trigger a Clay enrichment sequence when an entity first reaches grade A.',
      'Post a Slack message to the #deals channel when a key deal drops a full grade.',
    ],
    fields: [
      { name: 'data.prospect.pandora_id', type: 'string', description: 'Internal Pandora UUID for the entity' },
      { name: 'data.prospect.entity_type', type: 'string', description: '"deal" or "contact"' },
      { name: 'data.prospect.source', type: 'string', description: 'CRM source: "hubspot" or "salesforce"' },
      { name: 'data.prospect.source_id', type: 'string', description: 'The CRM record ID — use to write back' },
      { name: 'data.prospect.pandora_prospect_score', type: 'number', description: 'Current score (0–100)' },
      { name: 'data.prospect.pandora_prospect_grade', type: 'string', description: '"A", "B", "C", "D", or "F"' },
      { name: 'data.prospect.score_change', type: 'number', description: 'Delta since last run (positive or negative)' },
      { name: 'data.prospect.previous_score', type: 'number', description: 'Score from the previous run' },
    ],
    payload: `{
  "event": "prospect.scored",
  "event_id": "evt_ps_f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-03-10T07:04:58.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "prospect": {
      "pandora_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "entity_type": "deal",
      "source": "hubspot",
      "source_object": "deal",
      "source_id": "hs_deal_8472910",
      "name": "Acme Corp – Enterprise Platform",
      "pandora_prospect_score": 82,
      "pandora_prospect_grade": "A",
      "pandora_fit_score": 74,
      "pandora_engagement_score": 91,
      "pandora_intent_score": 80,
      "pandora_timing_score": 85,
      "pandora_score_method": "icp_point_based",
      "pandora_score_confidence": 0.87,
      "pandora_scored_at": "2026-03-10T07:04:55.000Z",
      "pandora_score_summary": "Strong engagement and tight timeline. Champion identified.",
      "pandora_top_positive_factor": "3 calls with transcript in the last 14 days",
      "pandora_top_negative_factor": "No mutual action plan documented",
      "pandora_recommended_action": "Share a mutual action plan before next call",
      "pandora_score_factors": [],
      "previous_score": 71,
      "score_change": 11
    }
  }
}`,
  },

  {
    eventType: 'deal.stage_changed',
    badgeColor: '#2563eb',
    description: 'A deal moved from one pipeline stage to another during CRM sync.',
    firesWhen:
      'During every incremental CRM sync (HubSpot and Salesforce), Pandora compares the incoming stage for each deal against what is stored locally. If the stage changed, it records the transition in deal_stage_history and emits this event — including backwards movements such as a deal slipping from Negotiation back to Proposal.',
    automations: [
      'Log stage transitions to a revenue attribution or waterfall analysis tool.',
      'Auto-create a CRM task or Slack notification when a deal enters a high-value stage like "Contract Sent".',
      'Trigger a win/loss survey workflow when a deal reaches "Closed Won" or "Closed Lost".',
    ],
    fields: [
      { name: 'data.deal.pandora_id', type: 'string', description: 'Internal Pandora UUID for the deal' },
      { name: 'data.deal.source', type: 'string', description: 'CRM source: "hubspot" or "salesforce"' },
      { name: 'data.deal.source_id', type: 'string', description: 'The CRM deal ID — use to look up or update the record' },
      { name: 'data.deal.from_stage', type: 'string', description: 'Raw CRM stage name before the change' },
      { name: 'data.deal.from_stage_normalized', type: 'string', description: 'Pandora-normalised stage (e.g. "demo", "proposal")' },
      { name: 'data.deal.to_stage', type: 'string', description: 'Raw CRM stage name after the change' },
      { name: 'data.deal.to_stage_normalized', type: 'string', description: 'Pandora-normalised stage after the change' },
      { name: 'data.deal.changed_at', type: 'string', description: 'ISO 8601 timestamp of when the change was detected' },
    ],
    payload: `{
  "event": "deal.stage_changed",
  "event_id": "evt_dsc_3c6ef371-a2b1-4d5e-8f9a-1b2c3d4e5f6a",
  "timestamp": "2026-03-10T10:30:00.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "deal": {
      "pandora_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "name": "Acme Corp – Enterprise Platform",
      "amount": 240000,
      "owner_email": "sarah.chen@acmecorp.io",
      "source": "hubspot",
      "source_id": "hs_deal_8472910",
      "from_stage": "Demo Scheduled",
      "from_stage_normalized": "demo",
      "to_stage": "Proposal Sent",
      "to_stage_normalized": "proposal",
      "changed_at": "2026-03-10T10:28:41.000Z"
    }
  }
}`,
  },

  {
    eventType: 'deal.flagged',
    badgeColor: '#ea580c',
    description: 'An AI skill identified a risk or issue on a specific deal that requires attention.',
    firesWhen:
      'After any skill run (pipeline hygiene, single-thread alert, deal risk review, etc.) inserts a finding with severity "act" or "watch" against a specific deal. Workspace-level summary findings that are not linked to a deal — such as aggregate data quality scores — do not emit this event.',
    automations: [
      'Auto-create a CRM task assigned to the deal owner when category is "single_threaded" or "stale_deal".',
      'Post an alert to the rep\'s Slack DM with the flag reason and a direct link to the deal in Pandora.',
      'Add the deal to a high-risk watchlist in a BI tool or Google Sheet.',
    ],
    fields: [
      { name: 'data.finding.deal_id', type: 'string', description: 'Pandora UUID for the flagged deal' },
      { name: 'data.finding.deal_name', type: 'string', description: 'Deal name for display purposes' },
      { name: 'data.finding.category', type: 'string', description: 'Flag type: "stale_deal", "single_threaded", "deal_risk", "data_quality"' },
      { name: 'data.finding.severity', type: 'string', description: '"act" (immediate action needed) or "watch" (monitor closely)' },
      { name: 'data.finding.message', type: 'string', description: 'Human-readable description of the issue' },
      { name: 'data.finding.source_skill', type: 'string', description: 'The skill that generated this finding' },
      { name: 'data.finding.owner_email', type: 'string', description: 'Deal owner email — use for routing' },
      { name: 'data.finding.metadata', type: 'object', description: 'Skill-specific detail (days inactive, contact count, risk score, etc.)' },
    ],
    payload: `{
  "event": "deal.flagged",
  "event_id": "evt_df_7e9a1b2c-3d4e-5f6a-7b8c-9d0e1f2a3b4c",
  "timestamp": "2026-03-10T07:05:12.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "finding": {
      "id": "b3c4d5e6-f7a8-9b0c-1d2e-3f4a5b6c7d8e",
      "deal_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "deal_name": "Globex Industries – Growth",
      "category": "single_threaded",
      "severity": "act",
      "message": "Only 1 contact mapped — no economic buyer or champion identified",
      "source_skill": "single-thread-alert",
      "skill_run_id": "run_4a5b6c7d-8e9f-0a1b-2c3d-4e5f6a7b8c9d",
      "owner_email": "james.wright@globex.io",
      "metadata": {
        "contact_count": 1,
        "roles_present": [],
        "risk_level": "critical",
        "likely_cause": "Relationship concentrated in a single mid-level contact"
      }
    }
  }
}`,
  },

  {
    eventType: 'action.created',
    badgeColor: '#16a34a',
    description: 'A skill generated a new recommended action tied to a deal or account.',
    firesWhen:
      'After a skill run (pipeline hygiene, deal risk review, single-thread alert, etc.) produces an AI-recommended action and inserts it into the actions table with status "open". One event is emitted per action created — a single skill run that produces three distinct recommendations emits three events.',
    automations: [
      'Auto-create a CRM task in HubSpot or Salesforce with the action title, recommended steps, and due date from expires_at.',
      'Post a structured Slack message to the rep using owner_email with the title and a direct Pandora link.',
      'Route critical-severity actions to the sales manager for review via a Make or Zapier workflow.',
    ],
    fields: [
      { name: 'data.action.id', type: 'string', description: 'Pandora action UUID — use for deduplication' },
      { name: 'data.action.action_type', type: 'string', description: 'Machine-readable type: "re_engage_deal", "close_stale_deal", "notify_rep", etc.' },
      { name: 'data.action.severity', type: 'string', description: '"critical", "warning", or "info"' },
      { name: 'data.action.title', type: 'string', description: 'Short human-readable action title' },
      { name: 'data.action.recommended_steps', type: 'array', description: 'Ordered list of steps the rep should take' },
      { name: 'data.action.owner_email', type: 'string', description: 'Rep responsible for this action' },
      { name: 'data.action.impact_amount', type: 'number', description: 'Deal value at risk (dollars)' },
      { name: 'data.action.expires_at', type: 'string', description: 'ISO 8601 deadline — action auto-expires if not acted on' },
      { name: 'data.action.source_skill', type: 'string', description: 'The skill that generated this action' },
    ],
    payload: `{
  "event": "action.created",
  "event_id": "evt_ac_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "timestamp": "2026-03-10T07:05:15.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "action": {
      "id": "c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f",
      "action_type": "re_engage_deal",
      "severity": "critical",
      "title": "Re-engage Globex Industries – Growth immediately",
      "summary": "No activity logged in 34 days. Deal is drifting toward stale.",
      "recommended_steps": [
        "Send a personal video message to the primary contact this week",
        "Loop in an exec sponsor to elevate the conversation",
        "Confirm the proposed close date is still realistic"
      ],
      "target_deal_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "target_entity_name": "Globex Industries – Growth",
      "owner_email": "james.wright@globex.io",
      "impact_amount": 85000,
      "urgency_label": "34 days stale",
      "source_skill": "pipeline-hygiene",
      "expires_at": "2026-03-17T07:05:15.000Z",
      "created_at": "2026-03-10T07:05:15.000Z"
    }
  }
}`,
  },

  {
    eventType: 'action.completed',
    badgeColor: '#0891b2',
    description: 'A rep or the CRM write-back engine successfully executed a recommended action.',
    firesWhen:
      'When all CRM write operations for an action succeed and its status is set to "executed" — either by the automated write-back engine or by a rep manually marking it complete in the Pandora UI. Actions where only some operations succeed (partial failures) do not emit this event.',
    automations: [
      'Track time-to-action per rep in a BI dashboard — subtract created_at from executed_at.',
      'Mark a corresponding CRM task as complete using the target_deal_id to look up the task.',
      'Trigger a congratulatory Slack message or update a rep leaderboard.',
    ],
    fields: [
      { name: 'data.action.id', type: 'string', description: 'Pandora action UUID — matches the id from action.created' },
      { name: 'data.action.action_type', type: 'string', description: 'Same action type as when it was created' },
      { name: 'data.action.executed_by', type: 'string', description: 'Email of the rep or "system" if automated' },
      { name: 'data.action.executed_at', type: 'string', description: 'ISO 8601 UTC timestamp of completion' },
      { name: 'data.action.impact_amount', type: 'number', description: 'Deal value that was at risk' },
      { name: 'data.action.source_skill', type: 'string', description: 'The skill that originally created this action' },
    ],
    payload: `{
  "event": "action.completed",
  "event_id": "evt_acp_2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
  "timestamp": "2026-03-12T14:22:08.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "action": {
      "id": "c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f",
      "action_type": "re_engage_deal",
      "severity": "critical",
      "title": "Re-engage Globex Industries – Growth immediately",
      "target_deal_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "target_entity_name": "Globex Industries – Growth",
      "owner_email": "james.wright@globex.io",
      "impact_amount": 85000,
      "source_skill": "pipeline-hygiene",
      "executed_by": "james.wright@globex.io",
      "executed_at": "2026-03-12T14:22:08.000Z"
    }
  }
}`,
  },

  {
    eventType: 'action.expired',
    badgeColor: '#dc2626',
    description: 'A recommended action passed its deadline without being executed or dismissed.',
    firesWhen:
      'The action expiry scheduler runs every hour and marks any open action past its expires_at timestamp as "expired". This event fires in batches — multiple expired actions across a workspace may produce multiple events in close succession. The days_open field tells you exactly how long the action sat ignored.',
    automations: [
      'Escalate to the sales manager via Slack if severity is "critical" and days_open is 7 or more.',
      'Log the missed action in a rep accountability report or performance tracking sheet.',
      'Create a follow-up action automatically — e.g. re-open the same recommendation with a new expiry.',
    ],
    fields: [
      { name: 'data.action.id', type: 'string', description: 'Pandora action UUID' },
      { name: 'data.action.action_type', type: 'string', description: 'The action type that was ignored' },
      { name: 'data.action.severity', type: 'string', description: 'Original severity — "critical" expirations warrant escalation' },
      { name: 'data.action.owner_email', type: 'string', description: 'The rep who did not act on this' },
      { name: 'data.action.expired_at', type: 'string', description: 'ISO 8601 UTC timestamp of expiry' },
      { name: 'data.action.days_open', type: 'number', description: 'Number of days the action was open before expiring' },
      { name: 'data.action.source_skill', type: 'string', description: 'The skill that originally generated this action' },
    ],
    payload: `{
  "event": "action.expired",
  "event_id": "evt_aex_4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  "timestamp": "2026-03-17T06:00:00.000Z",
  "workspace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "api_version": "2026-03-01",
  "data": {
    "workspace_name": "Acme Corp",
    "action": {
      "id": "c5d6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f",
      "action_type": "re_engage_deal",
      "severity": "critical",
      "title": "Re-engage Globex Industries – Growth immediately",
      "target_deal_id": "d9e8f7a6-b5c4-3d2e-1f0a-9b8c7d6e5f4a",
      "target_entity_name": "Globex Industries – Growth",
      "owner_email": "james.wright@globex.io",
      "impact_amount": 85000,
      "source_skill": "pipeline-hygiene",
      "expired_at": "2026-03-17T06:00:00.000Z",
      "days_open": 7
    }
  }
}`,
  },
];

// ---------------------------------------------------------------------------
// HMAC verification snippet
// ---------------------------------------------------------------------------
const HMAC_SNIPPET = `// Node.js — verify the X-Pandora-Signature header
const crypto = require('crypto');

function verifySignature(rawBody, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your Express handler:
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-pandora-signature'];
  if (!verifySignature(req.body, sig, process.env.PANDORA_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body);
  console.log('Received:', event.event, event.event_id);
  res.sendStatus(200);
});`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function WebhookEventReference() {
  return (
    <div style={{ fontFamily: fonts.sans }}>

      {/* Overview */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: colors.text }}>
          How webhooks work
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
          Pandora sends an HTTPS <code style={{ background: colors.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>POST</code> to your registered endpoints when these events occur.
          Every request includes a <code style={{ background: colors.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>X-Pandora-Signature</code> header
          containing an HMAC-SHA256 digest of the raw request body, signed with your endpoint's secret.
          Always verify this signature before processing a payload.
        </p>

        {/* Envelope fields */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted, marginBottom: 8 }}>
            Shared envelope fields
          </div>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {ENVELOPE_FIELDS.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 70px 1fr',
                  borderBottom: i < ENVELOPE_FIELDS.length - 1 ? `1px solid ${colors.border}` : 'none',
                  fontSize: 12,
                }}
              >
                <div style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#94a3b8', background: '#0f172a' }}>{f.name}</div>
                <div style={{ padding: '7px 10px', color: '#fbbf24', background: '#0f172a', fontFamily: 'monospace' }}>{f.type}</div>
                <div style={{ padding: '7px 12px', color: colors.muted }}>{f.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* HMAC verification */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.muted, marginBottom: 4 }}>
            Signature verification
          </div>
          <CodeBlock code={HMAC_SNIPPET} />
        </div>
      </div>

      {/* Event cards */}
      <div>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: colors.text }}>
          Event types
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
          Click any event to see when it fires, what automations it enables, and a full example payload.
          When registering an endpoint you can subscribe to all events or select specific types.
        </p>
        {EVENTS.map(e => (
          <EventCard key={e.eventType} {...e} />
        ))}
      </div>
    </div>
  );
}

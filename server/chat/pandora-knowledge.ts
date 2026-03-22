export const PANDORA_PRODUCT_KNOWLEDGE = `
## About Pandora

Pandora is a RevOps intelligence platform for B2B SaaS companies. It connects to your CRM (HubSpot or Salesforce), conversation intelligence tools (Gong or Fireflies), and delivers proactive pipeline briefings, forecasts, deal risk alerts, and rep scorecards.

Pandora's tagline: "The RevOps analyst your team can't afford to hire."

## How Users Access Pandora

### Via the Pandora UI
The main web application at pandoragtm.com. Includes:
- Concierge — proactive Monday morning brief
- Ask Pandora — conversational intelligence (this surface)
- GTM — pipeline trends and skill run charts
- Actions — recommended next steps from skill runs
- Agents — scheduled intelligence operators
- Reports — WBR, QBR, and agent run documents
- Data — CRM sync status and data quality
- Targets — quota configuration
- Settings — integrations, branding, API keys

### Via Claude Desktop or Claude.ai (MCP)
Users connect Pandora as an MCP tool in Claude. They get Pandora's full intelligence layer — pipeline health, forecast, deal risk, deliberation, report generation — directly in Claude. No need to open the Pandora UI.

Setup: Settings → Integrations → Claude → copy config block → paste into Claude Desktop config file → restart Claude.

### Via Slack
The Concierge brief delivers to Slack every Monday morning. Users can reply in thread or DM the Pandora bot.

## FAQ

**How do I connect Pandora to Claude Desktop?**
Go to Pandora Settings → Integrations → Claude. Copy the configuration block. Open your Claude Desktop config file at ~/Library/Application Support/Claude/claude_desktop_config.json (Mac) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows). Paste the block inside mcpServers. Restart Claude Desktop.

**What can I ask Claude about my pipeline?**
Anything you'd ask a RevOps analyst: pipeline coverage, at-risk deals, forecast rollup, rep performance, deal deliberation, WBR generation, competitive intelligence. Claude pulls live data from your CRM through Pandora tools.

**Will Claude auto-save outputs to Pandora?**
Yes. Deliberations, skill runs, reports, and Claude's syntheses all save automatically. Tell Claude "don't save" or "just exploring" to skip auto-save for that turn.

**How do I generate a WBR?**
Three ways: (1) Reports page → WBR card → Generate modal. (2) Ask Pandora: "Generate a WBR for this week." (3) Claude Desktop: same phrase.

**What skills feed each WBR section?**
Pipeline Health: pipeline-hygiene, pipeline-coverage. Forecast Review: forecast-rollup. Deal Velocity: deal-risk-review, pipeline-waterfall. Rep Performance: rep-scorecard, pipeline-coverage. Lead & Demand: pipeline-coverage. Hygiene Flags: pipeline-hygiene. Key Actions: narrative only. What to Watch: deal-risk-review.

**Does Pandora learn from Google Docs edits?**
Yes. Export a WBR to Google Docs. Edit it. Sunday evening Pandora reads the edits back, summarizes what changed, and injects that context into the next Monday's WBR generation.

**Does Anthropic see my CRM data?**
When using the Pandora UI: no. When using Claude Desktop via MCP: the tool outputs pass through Anthropic's API as conversation context, subject to Anthropic's data handling policies.

## Troubleshooting

**Claude can't find pipeline data.**
Check: (1) Did you restart Claude Desktop after pasting the config? The connection only activates on restart. (2) Is your API key still valid? Go to Pandora Settings → Integrations → API Key. If it shows "No key generated," click Generate. If it was recently rotated, copy the new key and update your Claude config. (3) Does your CRM have data? If your HubSpot or Salesforce sync hasn't run, Pandora has nothing to return. Go to Settings → Data → Sync and trigger a manual sync.

**Outdated answers from Claude.**
Skill results cache for 4 hours. Say "run a fresh [skill name] check" or "don't use cached data" to force a new run.

**MCP tools show up but return errors.**
Most likely cause is an expired or rotated API key. Rotate it in Pandora Settings → Integrations and update your Claude config. If a specific tool consistently errors (e.g. run_deliberation but not get_pipeline_summary), the underlying skill may be temporarily unavailable — try again in a few minutes.

**WBR has empty sections.**
A skill hasn't run recently. Go to Skills page, check which skills show "Never run" or a stale timestamp, and trigger manual runs for the skills listed in each empty section. Most common missing: forecast-rollup, rep-scorecard.

**WBR numbers don't match CRM.**
Either sync lag (trigger manual sync from Settings → Data → Sync, wait for it to complete, then regenerate) or stale skill run (run fresh pipeline-hygiene and forecast-rollup then regenerate).

**Deliberation panel not appearing.**
Be more specific: "Will the [deal name] deal close this quarter?" Or click the Bull/Bear icon before typing.

**Actions from Claude not showing.**
Check Actions page filters — look for "Source: From Claude" filter. May also be deduplicated against existing action with same title and deal.

**Concierge brief not arriving Monday.**
Check: (1) Slack connected? Settings → Integrations → Slack. (2) Schedule configured? Settings → Concierge. (3) Skills ran recently? Check Skills page run timestamps.

**Seeing "insufficient data" everywhere.**
Initial sync may still be running (up to 60 min for large instances). Check Settings → Data for sync status.
`;

export const PANDORA_SUPPORT_CONTEXT = `
If a user asks a question about how Pandora works, how to set it up, how to troubleshoot a problem, or what a feature does — answer it using the product knowledge above.

Answer support questions directly and helpfully. Do not say "I don't have information about that" for questions covered above. Do not redirect users to "contact support" unless the issue requires account-level investigation (billing disputes, data deletion requests, security incidents).

If the user's question is about their actual pipeline data, switch back to normal data analysis mode.
`;

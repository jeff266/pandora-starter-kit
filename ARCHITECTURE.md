# PANDORA — Architecture Overview v3
## With Skill Library + Connector Library + Copilot Port Map

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         PHASE 5: EXPERIENCE LAYER                          ║
║                                                                            ║
║   ┌─────────────┐    ┌─────────────────┐    ┌──────────────────────────┐   ║
║   │  Chat UI     │    │  Dashboards &   │    │  Multi-Agent             │   ║
║   │  "Talk to    │    │  Analytics      │    │  Orchestration           │   ║
║   │   Pandora"   │    │  (Crown Layer)  │    │  (Agents collaborate)    │   ║
║   └──────┬───────┘    └────────┬────────┘    └────────────┬─────────────┘   ║
╚══════════╪═════════════════════╪══════════════════════════╪═════════════════╝
           │                     │                          │
           ▼                     ▼                          ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PHASE 4: AGENT TEAM (Reactive + Scheduled)              ║
║                                                                            ║
║   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ║
║   │  Monday      │  │  Friday      │  │  Deal Risk   │  │  On-Demand   │  ║
║   │  Planner     │  │  Recap       │  │  Alerts      │  │  Analysis    │  ║
║   │  ⏰ Mon 7am  │  │  ⏰ Fri 3pm  │  │  ⚡ Event    │  │  💬 Chat     │  ║
║   │              │  │              │  │   Driven     │  │   Triggered  │  ║
║   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  ║
╚══════════╪═════════════════╪════════════════╪═══════════════════╪══════════╝
           │                 │                │                   │
           ▼                 ▼                ▼                   ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║               PHASE 3: AGENT FRAMEWORK + TOOLS + SKILLS                    ║
║                                                                            ║
║  ┌─ Agent Runtime ────────────────────────────────────────────────────┐    ║
║  │  YAML Definition ──► Context Injection ──► Claude API ──► Output  │    ║
║  └──────────────────────────────────────────────┬─────────────────────┘    ║
║                                                 │                          ║
║         ┌───────────────────────────────────────┼──────────────────┐       ║
║         │                                       │                  │       ║
║         ▼                                       ▼                  ▼       ║
║  ┌─ Skill Library ──────────────┐  ┌─ Tool Library ──┐  ┌─ Output ──────┐ ║
║  │                              │  │                  │  │ Skills        │ ║
║  │  ┌────────────────────────┐  │  │  DATA QUERY      │  │               │ ║
║  │  │ Win/Loss Analysis      │  │  │  deal_query      │  │ generate_pptx │ ║
║  │  │ Sales Process Map      │  │  │  contact_query   │  │ generate_docx │ ║
║  │  │ Pipeline Review        │  │  │  account_query   │  │ generate_pdf  │ ║
║  │  │ QBR Deck Builder       │  │  │  activity_query  │  │ generate_chart│ ║
║  │  │ Forecast Model         │  │  │  call_query ◄────┤  │               │ ║
║  │  │ Comp Plan Analysis     │  │  │  task_query ◄────┤  └───────────────┘ ║
║  │  │ Rep Scorecard          │  │  │  doc_query  ◄────┤                    ║
║  │  │ Territory Analysis     │  │  │                  │  ◄── New tools     ║
║  │  │ GTM Motion Assessment  │  │  │  ANALYSIS        │      enabled by    ║
║  │  │ Onboarding Diagnostic  │  │  │  forecast        │      expanded      ║
║  │  │ Call Pattern Analysis◄─┤  │  │  pipeline_vel    │      connectors    ║
║  │  │ Meeting Prep Brief  ◄──┤  │  │  win_rate        │                    ║
║  │  │ Account Intelligence◄──┤  │  │  rep_performance │                    ║
║  │  └────────────────────────┘  │  │  call_insights◄──┤                    ║
║  │                              │  │                  │                    ║
║  │  Skills marked ◄ leverage    │  │  CONTEXT         │                    ║
║  │  conversation + task data    │  │  get_biz_context │                    ║
║  │                              │  │  get_goals       │                    ║
║  └──────────────────────────────┘  │  get_definitions │                    ║
║                                    │                  │                    ║
║                                    │  ACTION          │                    ║
║                                    │  send_slack      │                    ║
║                                    │  send_email      │                    ║
║                                    │  create_task ◄───┤  (write back to   ║
║                                    │                  │   Monday/Asana)    ║
║                                    └──────────────────┘                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
           │                                              │
           ▼                                              ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║              PHASE 2: NORMALIZATION + CONTEXT LAYER                        ║
║                                                                            ║
║  ┌─ Context Layer ───────────────────────────────────────────────────┐    ║
║  │  Business Model  │  Team & Roles  │  Goals & Targets              │    ║
║  │  Definitions     │  Operational Maturity                          │    ║
║  └───────────────────────────────────────────────────────────────────┘    ║
║                                                                            ║
║  ┌─ Normalized Schema ───────────────────────────────────────────────┐    ║
║  │                                                                    │    ║
║  │  ┌────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐   │    ║
║  │  │ Deal   │ │ Contact │ │ Account │ │ Activity │ │  Call    │   │    ║
║  │  └────────┘ └─────────┘ └─────────┘ └──────────┘ └──────────┘   │    ║
║  │                                                                    │    ║
║  │  + NEW ENTITIES FROM EXPANDED CONNECTORS:                         │    ║
║  │                                                                    │    ║
║  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐                      │    ║
║  │  │  Task    │ │ Document │ │ Conversation │                      │    ║
║  │  │          │ │          │ │  Transcript  │                      │    ║
║  │  │ from:    │ │ from:    │ │              │                      │    ║
║  │  │ Monday   │ │ Google   │ │ from:        │                      │    ║
║  │  │ Asana    │ │ Drive    │ │ Gong         │                      │    ║
║  │  │          │ │          │ │ Fathom       │                      │    ║
║  │  │          │ │          │ │ Fireflies    │                      │    ║
║  │  └──────────┘ └──────────┘ └──────────────┘                      │    ║
║  │                                                                    │    ║
║  │  ┌─ Computed Fields ──────────────────────────────────────────┐   │    ║
║  │  │ days_in_stage │ engagement_score │ velocity │ health_score │   │    ║
║  │  │ pipeline_coverage │ days_since_activity                    │   │    ║
║  │  │                                                            │   │    ║
║  │  │ + NEW computed fields from expanded data:                  │   │    ║
║  │  │ call_sentiment │ objection_frequency │ multi_thread_score  │   │    ║
║  │  │ action_item_completion_rate │ doc_engagement               │   │    ║
║  │  └────────────────────────────────────────────────────────────┘   │    ║
║  └────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════╝
           ▲                           ▲                          ▲
           │                           │                          │
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PHASE 1: DATA FOUNDATION                                ║
║                                                                            ║
║  ┌─ Connector Library ───────────────────────────────────────────────┐    ║
║  │                                                                    │    ║
║  │  CRM                    CONVERSATIONS         OPERATIONS          │    ║
║  │  ┌─────────────────┐   ┌──────────────────┐  ┌────────────────┐  │    ║
║  │  │                 │   │                  │  │                │  │    ║
║  │  │  🟢 HubSpot     │   │  🟢 Gong         │  │  🟢 Monday.com │  │    ║
║  │  │  • Export API   │   │  • Call pulls    │  │  • Task sync   │  │    ║
║  │  │  • Incremental  │   │  • Transcripts   │  │  • Board data  │  │    ║
║  │  │  • Backfill     │   │  • Scorecards    │  │                │  │    ║
║  │  │    scheduler    │   │                  │  │  🟢 Asana       │  │    ║
║  │  │  • Schema       │   │  🟢 Fathom       │  │  • Task sync   │  │    ║
║  │  │    discovery    │   │  • Call pulls    │  │  • Project data│  │    ║
║  │  │                 │   │  • Transcripts   │  │                │  │    ║
║  │  │  🔲 Salesforce   │   │                  │  │  🟢 Google     │  │    ║
║  │  │  (Phase 2+)     │   │  🟢 Fireflies    │  │    Drive       │  │    ║
║  │  │                 │   │  • Meeting pulls │  │  • Doc sync    │  │    ║
║  │  │                 │   │  • Transcripts   │  │  • SOWs, decks │  │    ║
║  │  │                 │   │  • AI summaries  │  │                │  │    ║
║  │  └─────────────────┘   └──────────────────┘  └────────────────┘  │    ║
║  │                                                                    │    ║
║  │  🟢 = Working code in Copilot (port to Pandora)                   │    ║
║  │  🔲 = Future build                                                 │    ║
║  │                                                                    │    ║
║  │  Standard Connector Interface:                                     │    ║
║  │  ┌──────────────────────────────────────────────────────────┐     │    ║
║  │  │  connect(credentials) → Connection                       │     │    ║
║  │  │  discover(connection) → Schema                           │     │    ║
║  │  │  sync(connection, lastSyncAt) → RawRecords               │     │    ║
║  │  │  health() → { status, lastSync, errors }                 │     │    ║
║  │  └──────────────────────────────────────────────────────────┘     │    ║
║  └────────────────────────────────────────────────────────────────────┘    ║
║                                                                            ║
║  ┌─ Multi-Tenant Workspace ──┐    ┌─ Quick Win ────────────────────┐     ║
║  │                            │    │                                │     ║
║  │  workspace_id scopes       │    │  Pipeline snapshot from live   │     ║
║  │  ALL data across ALL       │    │  HubSpot data ──► Slack       │     ║
║  │  connectors:               │    │                                │     ║
║  │  • GrowthX                 │    │  (Proof the pipes work)        │     ║
║  │  • Frontera Health         │    │                                │     ║
║  │  • Future clients...       │    └────────────────────────────────┘     ║
║  │                            │                                           ║
║  └────────────────────────────┘                                           ║
║                                                                            ║
║  Tech: Replit + PostgreSQL (Neon) + Claude API (Anthropic)                 ║
╚══════════════════════════════════════════════════════════════════════════════╝


╔══════════════════════════════════════════════════════════════════════════════╗
║                     GTM KNOWLEDGE BASE (Evolving)                          ║
║                                                                            ║
║  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     ║
║  │ Winning by   │ │ MEDDIC /     │ │ PLG / Usage  │ │ Enterprise   │     ║
║  │ Design       │ │ MEDDPICC     │ │ Playbooks    │ │ Sales Ops    │     ║
║  ├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤     ║
║  │ Forrester /  │ │ Pavilion     │ │ Stage-gate   │ │ Forecasting  │     ║
║  │ SiriDecisions│ │ Frameworks   │ │ Models       │ │ Methods      │     ║
║  ├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤     ║
║  │ Jeff's       │ │ Industry     │ │ Benchmark    │ │ Community    │     ║
║  │ Experience   │ │ Benchmarks   │ │ Data         │ │ Patterns     │     ║
║  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘     ║
╚══════════════════════════════════════════════════════════════════════════════╝


═══════════════════════════════════════════════════════════════════════════════
       WHAT CONVERSATION + TASK DATA UNLOCKS (New Skills & Tools)
═══════════════════════════════════════════════════════════════════════════════

  Without conversation data         With Gong/Fathom/Fireflies
  ─────────────────────────         ──────────────────────────────
  "Deal is stale"            ──►   "Deal is stale AND last call had
                                     3 unresolved objections about
                                     pricing and security"

  "Rep is underperforming"   ──►   "Rep's talk-to-listen ratio is
                                     72/28, discovery calls average
                                     4 min vs team avg of 18 min"

  "Pipeline is at risk"      ──►   "Pipeline is at risk: 60% of
                                     deals in Evaluation have no
                                     call scheduled in next 14 days"

  Without task data                 With Monday/Asana
  ─────────────────                 ──────────────────────────────
  "Recommended: fix data     ──►   "Recommended: fix data quality.
   quality"                          Action item already exists in
                                     Monday (stale 14 days). Reassign
                                     or escalate?"

  "Action items from         ──►   "Action items from Friday recap
   Friday recap"                     auto-created as tasks in client's
                                     Monday board with owner + due date"


═══════════════════════════════════════════════════════════════════════════════
       NEW NORMALIZED ENTITIES (from expanded connectors)
═══════════════════════════════════════════════════════════════════════════════

  Conversation (normalized from Gong, Fathom, Fireflies)
  ┌──────────────────────────────────────────────────────────────────┐
  │  id                     │ Internal UUID                          │
  │  source                 │ gong | fathom | fireflies              │
  │  source_id              │ Native call ID                         │
  │  workspace_id           │ Multi-tenant isolation                 │
  │                         │                                        │
  │  call_date              │ When the call happened                 │
  │  duration_seconds       │ Call length                            │
  │  participants           │ Contact[] + User[] (linked)            │
  │  deal_id                │ FK to normalized Deal (if associated)  │
  │  account_id             │ FK to normalized Account               │
  │                         │                                        │
  │  transcript_text        │ Full transcript                        │
  │  summary                │ AI-generated summary                   │
  │  action_items           │ Extracted action items                 │
  │  objections             │ Extracted objections                   │
  │  sentiment_score        │ Overall call sentiment (0-100)         │
  │  talk_listen_ratio      │ { rep: 0.65, prospect: 0.35 }         │
  │  topics                 │ ["pricing", "security", "timeline"]    │
  │  competitor_mentions    │ ["Competitor A", "Competitor B"]       │
  │  custom_fields          │ JSON (source-specific extras)          │
  └──────────────────────────────────────────────────────────────────┘

  Task (normalized from Monday.com, Asana)
  ┌──────────────────────────────────────────────────────────────────┐
  │  id                     │ Internal UUID                          │
  │  source                 │ monday | asana                         │
  │  source_id              │ Native task ID                         │
  │  workspace_id           │ Multi-tenant isolation                 │
  │                         │                                        │
  │  title                  │ Task name                              │
  │  description            │ Task details                           │
  │  status                 │ normalized: open | in_progress | done  │
  │  assignee               │ FK to User or Contact                  │
  │  due_date               │ When it's due                          │
  │  created_date           │ When created                           │
  │  completed_date         │ When completed (nullable)              │
  │  priority               │ low | medium | high | critical         │
  │  project                │ Board/project name                     │
  │  tags                   │ ["revops", "data-quality", "q4"]       │
  │  deal_id                │ FK to Deal (if linked)                 │
  │  account_id             │ FK to Account (if linked)              │
  │  created_by_agent       │ boolean (was this created by Pandora?) │
  │  custom_fields          │ JSON                                   │
  └──────────────────────────────────────────────────────────────────┘

  Document (normalized from Google Drive)
  ┌──────────────────────────────────────────────────────────────────┐
  │  id                     │ Internal UUID                          │
  │  source                 │ google_drive                           │
  │  source_id              │ Drive file ID                          │
  │  workspace_id           │ Multi-tenant isolation                 │
  │                         │                                        │
  │  title                  │ Document name                          │
  │  doc_type               │ sow | proposal | deck | report | other│
  │  mime_type              │ application/pdf, .docx, .pptx, etc.   │
  │  content_text           │ Extracted text (for search/analysis)   │
  │  summary                │ AI-generated summary                   │
  │  last_modified          │ When last edited                       │
  │  modified_by            │ Who last edited                        │
  │  shared_with            │ Contact[] / User[]                     │
  │  deal_id                │ FK to Deal (if associated)             │
  │  account_id             │ FK to Account (if associated)          │
  │  custom_fields          │ JSON                                   │
  └──────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
       SKILLS UNLOCKED BY EXPANDED DATA (Examples)
═══════════════════════════════════════════════════════════════════════════════

  ┌─ Meeting Prep Brief ───────────────────────────────────────────────┐
  │                                                                    │
  │  REQUIRES: CRM data + Conversation data + Document data            │
  │                                                                    │
  │  Before Jeff's call with a prospect:                               │
  │  • Deal context (stage, amount, days in stage, health score)       │
  │  • Last 3 call summaries + unresolved objections (Gong/Fathom)     │
  │  • Action items from last call and their status (Monday/Asana)     │
  │  • Relevant docs shared (proposals, SOWs from Google Drive)        │
  │  • Recommended talking points based on deal risk factors           │
  │                                                                    │
  │  This skill is IMPOSSIBLE without the expanded connectors.         │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ Call Pattern Analysis ────────────────────────────────────────────┐
  │                                                                    │
  │  REQUIRES: CRM data + Conversation data                            │
  │                                                                    │
  │  Across all reps:                                                  │
  │  • Avg talk/listen ratio for won vs lost deals                     │
  │  • Discovery call depth (avg questions asked, topics covered)      │
  │  • Objection handling patterns that correlate with wins            │
  │  • Competitor mention frequency and response effectiveness         │
  │  • Follow-up speed after calls (call → next action gap)            │
  │                                                                    │
  │  Output: "Your reps who win talk 40% of the time. Your reps       │
  │  who lose talk 68% of the time. Here's the coaching plan."         │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ Account Intelligence Report ──────────────────────────────────────┐
  │                                                                    │
  │  REQUIRES: CRM + Conversations + Tasks + Documents                 │
  │                                                                    │
  │  Full 360° account view:                                           │
  │  • All deals (open + historical) with health scores                │
  │  • All calls chronologically with sentiment trend                  │
  │  • All open action items and completion rates                      │
  │  • All shared documents and engagement                             │
  │  • Stakeholder map (who's been on calls, who's engaged)            │
  │  • Risk signals across all data sources                            │
  │  • Recommended next actions                                        │
  │                                                                    │
  │  This is the "know everything about this account in 60 seconds"    │
  │  skill that no single tool provides today.                         │
  └────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
       COPILOT → PANDORA PORT MAP
═══════════════════════════════════════════════════════════════════════════════

  ┌─────────────────────────────┬──────────────┬──────────────────────┐
  │  Component                  │  Status      │  Port Work Needed    │
  ├─────────────────────────────┼──────────────┼──────────────────────┤
  │                             │              │                      │
  │  CONNECTORS (Phase 1)       │              │                      │
  │  HubSpot OAuth + API client │  🟢 Working  │  Add workspace_id    │
  │  HubSpot Export API sync    │  🟢 Working  │  Add workspace_id    │
  │  HubSpot nightly backfill   │  🟢 Working  │  Multi-tenant sched  │
  │  HubSpot schema discovery   │  🟢 Working  │  Store per workspace │
  │  Gong API client + sync     │  🟢 Working  │  Add workspace_id    │
  │  Fathom API client + sync   │  🟢 Working  │  Add workspace_id    │
  │  Fireflies API + sync       │  🟢 Working  │  Add workspace_id    │
  │  Monday.com API + sync      │  🟢 Working  │  Add workspace_id    │
  │  Asana API + sync           │  🟢 Working  │  Add workspace_id    │
  │  Google Drive API + sync    │  🟢 Working  │  Add workspace_id    │
  │  Salesforce connector       │  🔲 Future   │  New build           │
  │                             │              │                      │
  │  NORMALIZATION (Phase 2)    │              │                      │
  │  Deal entity + mapping      │  🟡 Designed │  Implement in PG     │
  │  Contact entity + mapping   │  🟡 Designed │  Implement in PG     │
  │  Account entity + mapping   │  🟡 Designed │  Implement in PG     │
  │  Activity entity + mapping  │  🟡 Designed │  Implement in PG     │
  │  Call entity + mapping      │  🟡 Designed │  Implement in PG     │
  │  Conversation entity        │  🟡 Partial  │  Normalize across 3  │
  │  Task entity                │  🟡 Partial  │  Normalize across 2  │
  │  Document entity            │  🟡 Partial  │  Normalize Drive     │
  │  AI field mapping           │  🟡 Designed │  Build confirmation  │
  │  Computed fields            │  🟡 Designed │  Implement + config  │
  │  Engagement scoring         │  🟢 Working  │  Make configurable   │
  │  Context Layer              │  🔲 New      │  Full new build      │
  │                             │              │                      │
  │  TOOLS + SKILLS (Phase 3)   │              │                      │
  │  Deal query tool            │  🟡 Partial  │  Build on normalized │
  │  Forecast analysis          │  🟡 Partial  │  Exists in briefing  │
  │  Pipeline velocity          │  🟡 Partial  │  Exists in briefing  │
  │  Win rate analysis          │  🟡 Partial  │  Exists in briefing  │
  │  Rep performance            │  🟡 Partial  │  Exists in briefing  │
  │  Call insights tool         │  🟡 Partial  │  Gong/Fathom queries │
  │  Task query tool            │  🔲 New      │  New build           │
  │  Doc query tool             │  🔲 New      │  New build           │
  │  Skill framework            │  🔲 New      │  New build           │
  │  Output skills (pptx/docx)  │  🔲 New      │  New build           │
  │  Agent YAML runtime         │  🔲 New      │  New build           │
  │  Agent scheduler            │  🟡 Partial  │  Expand existing     │
  │                             │              │                      │
  │  AGENTS (Phase 4)           │              │                      │
  │  Pipeline Hygiene           │  🟡 Partial  │  Briefing → agent    │
  │  Monday Planner             │  🟡 Partial  │  Briefing → agent    │
  │  Friday Recap               │  🟡 Partial  │  Briefing → agent    │
  │  Deal Risk Alerts           │  🔲 New      │  New build           │
  │  Meeting Prep               │  🔲 New      │  New build           │
  │                             │              │                      │
  │  EXPERIENCE (Phase 5)       │              │                      │
  │  Chat UI                    │  🔲 New      │  New build           │
  │  Dashboards                 │  🔲 New      │  New build           │
  │  Multi-agent orchestration  │  🔲 New      │  New build           │
  │                             │              │                      │
  ├─────────────────────────────┼──────────────┼──────────────────────┤
  │  LEGEND                     │              │                      │
  │  🟢 Working = code exists, runs in production                     │
  │  🟡 Designed/Partial = schema or logic exists, needs refactor     │
  │  🔲 New = build from scratch                                      │
  └─────────────────────────────┴──────────────┴──────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
       CONNECTOR INTERFACE (Standard for all sources)
═══════════════════════════════════════════════════════════════════════════════

  Every connector implements the same interface.
  New sources plug in without changing the normalization layer.

  ┌────────────────────────────────────────────────────────────────────┐
  │                                                                    │
  │  interface PandoraConnector {                                       │
  │                                                                    │
  │    // Identity                                                     │
  │    name: string              // "hubspot", "gong", "monday"        │
  │    category: string          // "crm", "conversations", "ops"      │
  │    authMethod: string        // "oauth" | "api_key"                │
  │                                                                    │
  │    // Lifecycle                                                    │
  │    connect(credentials, workspaceId): Connection                   │
  │    disconnect(workspaceId): void                                   │
  │                                                                    │
  │    // Schema                                                       │
  │    discoverSchema(connection): SourceSchema                        │
  │    proposeMapping(schema, normalizedSchema): FieldMapping[]        │
  │                                                                    │
  │    // Sync                                                         │
  │    initialSync(connection): RawRecords[]     // Export/bulk        │
  │    incrementalSync(connection, since): RawRecords[]  // Delta      │
  │    backfillSync(connection): RawRecords[]    // Associations/gaps  │
  │                                                                    │
  │    // Health                                                       │
  │    health(): {                                                     │
  │      status: "healthy" | "degraded" | "error" | "disconnected"    │
  │      lastSync: datetime                                            │
  │      recordsSynced: number                                         │
  │      errors: Error[]                                               │
  │    }                                                               │
  │  }                                                                 │
  │                                                                    │
  │  Every connector feeds into the same normalization pipeline:       │
  │                                                                    │
  │  Connector.sync() ──► Raw Records ──► Field Mapping ──► Normalize │
  │                                           │                        │
  │                                    (per workspace,                 │
  │                                     AI-proposed,                   │
  │                                     human-confirmed)               │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
       TWO-WAY ACTION: WRITE-BACK TO TASK SYSTEMS
═══════════════════════════════════════════════════════════════════════════════

  Most RevOps tools are read-only. Pandora writes back.

  Friday Recap Agent
       │
       │  "3 action items identified this week"
       │
       ▼
  ┌──────────────────┐     ┌──────────────────┐
  │  create_task     │────►│  Monday.com      │
  │  tool            │     │  or Asana         │
  │                  │     │                   │
  │  Inputs:         │     │  Creates real     │
  │  • title         │     │  tasks with:      │
  │  • assignee      │     │  • owner          │
  │  • due_date      │     │  • due date       │
  │  • priority      │     │  • linked deal    │
  │  • deal_id       │     │  • "Created by    │
  │  • workspace_id  │     │    Pandora" tag   │
  │                  │     │                   │
  └──────────────────┘     └──────────────────┘

  Then next week, the Monday Planner agent checks:
  "Last week's action items: 2/3 completed, 1 overdue (reassign?)"

  This is the loop that makes Pandora feel like a team member,
  not a reporting tool.
```

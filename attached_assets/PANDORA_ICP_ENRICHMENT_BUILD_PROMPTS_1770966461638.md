# Pandora — Conversation Webhook Ingestion Endpoint

**Priority:** Deprioritized (below ICP Enrichment, above Agent Builder)
**Effort:** Small (~3-4 hours)
**Customer trigger:** Imubit (Otter.ai, no direct API)
**Replaces:** Zapier Tables connector concept

---

## Design

A generic webhook endpoint that accepts conversation data from any source Zapier (or any automation tool) can trigger. Not Otter-specific — works for Fathom, Avoma, Chorus, Fireflies (redundant but valid), or any custom source.

### Endpoint

```
POST /api/workspaces/:id/webhooks/conversation
Headers:
  Authorization: Bearer <workspace_webhook_token>
  Content-Type: application/json
```

### Authentication

Each workspace gets a webhook token (generated, stored in `workspace_config`):

```
POST /api/workspaces/:id/webhooks/token/generate
  Returns: { token: "pwh_xxxxxxxxxxxx", created_at: "..." }
  Stores hashed token in workspace_config.webhook_token_hash

POST /api/workspaces/:id/webhooks/token/rotate
  Invalidates old token, generates new one
```

Validation: hash incoming Bearer token, compare to stored hash. Reject with 401 if mismatch.

### Payload Schema

Pandora accepts a flexible payload and normalizes server-side. The caller doesn't need to match Pandora's internal schema exactly.

```typescript
interface WebhookConversationPayload {
  // Required
  title: string;                           // "Intro Call with Acme Corp"
  date: string;                            // ISO 8601 or common date format
  
  // Strongly recommended
  participants?: {
    name?: string;
    email?: string;
    role?: string;                         // 'host', 'attendee', etc.
  }[];
  duration_seconds?: number;
  
  // Content (at least one recommended)
  transcript_text?: string;                // full transcript as plain text
  summary?: string;                        // AI-generated summary
  
  // Optional metadata
  source?: string;                         // 'otter', 'fathom', 'custom'
  external_id?: string;                    // source system's ID (for dedup)
  recording_url?: string;
  tags?: string[];
  
  // Flexible catch-all
  metadata?: Record<string, any>;          // anything else, stored in source_data
}
```

### Processing Pipeline

```
1. Validate auth token
2. Validate payload (title + date required, reject otherwise)
3. Dedup check: if external_id provided, check for existing conversation
   with same source + external_id in this workspace. If exists, update instead of insert.
4. Normalize to conversations table row:
   - title, started_at (parse date flexibly), duration_seconds
   - participants → JSONB array
   - transcript_text, summary
   - source = payload.source || 'webhook'
   - source_data = { ...payload.metadata, recording_url, tags, external_id }
   - connector_type = 'webhook'
5. Insert into conversations table
6. Trigger post-ingest pipeline (fire and forget):
   a. Internal meeting classification
   b. Cross-entity linker (email → account → deal)
   c. Deal insights extraction (if linked to deal + transcript exists)
7. Return: { id: conversation_id, status: 'ingested', linked: { account, deal } | null }
```

### Zapier Configuration (for Imubit)

```
Trigger: Otter.ai → New Recording
Action: Webhooks by Zapier → POST

URL: https://pandora.app/api/workspaces/<WORKSPACE_ID>/webhooks/conversation
Headers: 
  Authorization: Bearer pwh_xxxxxxxxxxxx

Body (Custom):
{
  "title": "{{recording_title}}",
  "date": "{{recording_date}}",
  "participants": [
    { "name": "{{speaker_1_name}}", "email": "{{speaker_1_email}}" }
  ],
  "duration_seconds": {{duration_seconds}},
  "transcript_text": "{{transcript_text}}",
  "summary": "{{summary}}",
  "source": "otter",
  "external_id": "{{recording_id}}"
}
```

### What to build

| Component | Notes |
|-----------|-------|
| Migration: add `webhook_token_hash` to workspace config | Small |
| Token generate/rotate endpoints | Small |
| `POST /webhooks/conversation` endpoint | Medium — payload validation, flexible date parsing, dedup |
| Post-ingest trigger | Already exists — reuse Gong/Fireflies post-sync chain |
| `GET /webhooks/history` | Optional — show recent webhook deliveries for debugging |

### What NOT to build

- No Zapier-specific integration (the caller handles mapping)
- No Otter-specific transforms (generic payload)
- No batch endpoint (one conversation per POST is fine for webhook volume)
- No retry/queue (if Pandora is down, Zapier retries automatically)

---
---

# ICP Discovery External Enrichment — Build Plan

**Priority:** #1 on active stack
**Spec:** `PANDORA_LEAD_SCORING_SKILL_SPECS.md` (comprehensive, already written)
**Effort:** Large (estimated 12-16 hours across both tracks)

---

## What Already Exists

Before writing prompts, inventory what's built:

| Component | Status | Where |
|-----------|--------|-------|
| ICP Discovery skill (descriptive mode) | ✅ Built, validated | Claude Code |
| Lead Scoring skill (point-based, v1) | ✅ Built, validated | Claude Code |
| Contact Role Resolution skill | ✅ Built, validated | Claude Code |
| Conversation intelligence in ICP/Scoring | ✅ Built | Claude Code |
| deal_contacts table | ❌ Not built | Needs Replit migration |
| account_signals table | ❌ Not built | Needs Replit migration |
| icp_profiles table | ❌ Not built | Needs Replit migration |
| lead_scores table | ❌ Not built | Needs Replit migration |
| Apollo API integration | ❌ Not built | Replit |
| Serper API integration | ❌ Not built | Replit |
| LinkedIn API integration | ❌ Not built | Replit |
| Closed Deal Enrichment pipeline | ❌ Not built | Replit |
| ICP Discovery consuming enriched data | ❌ Not wired | Claude Code |
| Lead Scoring consuming ICP weights | ❌ Not wired | Claude Code |

**Assessment:** The skills exist but consume only CRM data today. The enrichment pipeline that feeds external data INTO those skills doesn't exist yet. That pipeline is infrastructure — Replit territory.

## Why It's Mostly Replit

The heavy lift is:
- 4 new database tables (deal_contacts, account_signals, icp_profiles, lead_scores)
- 3 external API integrations (Apollo, Serper, LinkedIn/RapidAPI)
- Rate limiting, caching, cost tracking per API
- Closed Deal Enrichment pipeline (event-triggered, multi-step)
- API key management in workspace config

That's all infrastructure/wiring. Replit.

Claude Code's role is smaller but critical:
- Update ICP Discovery to read enriched deal_contacts + account_signals
- Update Lead Scoring to use ICP-derived weights when available
- Update Contact Role Resolution to use Apollo-verified seniority
- These are surgical edits to existing skills, not new builds

**Sequence: Replit first (build the data pipeline), Claude Code second (skills consume it).**

---

## Replit Prompts — 4 Total

### Prompt 1: Schema + Contact Role Resolution Infrastructure

```
Pull latest from GitHub. Read PANDORA_LEAD_SCORING_SKILL_SPECS.md 
in project knowledge — it contains the complete spec for these tables.

You're building the data foundation for ICP external enrichment.
The skills that consume this data already exist (ICP Discovery, Lead Scoring,
Contact Role Resolution). Your job is the schema and the compute-layer
functions that populate it.

1. DATABASE MIGRATIONS

Create the next migration with these tables:

a. deal_contacts — the buying committee resolution table

CREATE TABLE deal_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  
  buying_role TEXT,                    -- champion, economic_buyer, decision_maker,
                                      -- technical_evaluator, influencer, coach, blocker, end_user
  role_source TEXT NOT NULL DEFAULT 'pending',
                                      -- crm_contact_role, crm_deal_field, cross_deal_match,
                                      -- title_match, activity_inference, llm_classification
  role_confidence NUMERIC DEFAULT 0,  -- 0.0-1.0
  is_primary BOOLEAN DEFAULT false,
  
  enrichment_status TEXT DEFAULT 'pending',  -- pending, enriched, partial, failed, skipped
  enriched_at TIMESTAMPTZ,
  
  apollo_data JSONB DEFAULT '{}',
  linkedin_data JSONB DEFAULT '{}',
  linkedin_scraped_at TIMESTAMPTZ,
  
  tenure_months INTEGER,
  career_trajectory TEXT,             -- rising, lateral, stable, declining
  previous_companies JSONB DEFAULT '[]',
  seniority_verified TEXT,            -- ic, manager, director, vp, c_level
  department_verified TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, deal_id, contact_id)
);

CREATE INDEX idx_deal_contacts_deal ON deal_contacts(deal_id);
CREATE INDEX idx_deal_contacts_workspace ON deal_contacts(workspace_id);
CREATE INDEX idx_deal_contacts_role ON deal_contacts(workspace_id, buying_role);
CREATE INDEX idx_deal_contacts_enrichment ON deal_contacts(workspace_id, enrichment_status);

b. account_signals — Serper enrichment results

CREATE TABLE account_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id),
  
  signals JSONB NOT NULL DEFAULT '[]',
  signal_summary TEXT,
  signal_score NUMERIC,
  
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, account_id, deal_id)
);

CREATE INDEX idx_account_signals_workspace ON account_signals(workspace_id);
CREATE INDEX idx_account_signals_account ON account_signals(account_id);

c. icp_profiles — ICP Discovery output storage

CREATE TABLE icp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL DEFAULT 'descriptive',  -- descriptive, point_based, regression
  
  company_profile JSONB DEFAULT '{}',
  persona_patterns JSONB DEFAULT '[]',
  scoring_weights JSONB DEFAULT '{}',
  
  model_accuracy NUMERIC,
  sample_size INTEGER,
  
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_icp_profiles_active ON icp_profiles(workspace_id) WHERE is_active = true;

d. lead_scores — persisted scores per contact and deal

CREATE TABLE lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  
  score_type TEXT NOT NULL,           -- 'contact', 'deal', 'account'
  total_score INTEGER NOT NULL,       -- 0-100
  grade TEXT NOT NULL,                -- A, B, C, D, F
  
  breakdown JSONB NOT NULL DEFAULT '{}',  -- per-category scores
  scoring_mode TEXT NOT NULL,         -- 'point_based', 'regression'
  icp_profile_id UUID REFERENCES icp_profiles(id),
  
  scored_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lead_scores_contact ON lead_scores(workspace_id, contact_id) WHERE score_type = 'contact';
CREATE INDEX idx_lead_scores_deal ON lead_scores(workspace_id, deal_id) WHERE score_type = 'deal';

2. BUILD CONTACT ROLE RESOLUTION FUNCTION

Create server/enrichment/resolve-contact-roles.ts

This resolves the buying committee for a deal by walking a priority chain.
The Claude Code Contact Role Resolution skill already has the LOGIC —
you're building the INFRASTRUCTURE function it calls.

Export:

async function resolveContactRoles(
  workspaceId: string,
  dealId: string,
  source: 'hubspot' | 'salesforce' | 'file_import'
): Promise<{
  contactCount: number;
  rolesResolved: number;
  rolesSummary: Record<string, number>;
}>

Priority chain (stop filling a role once it has a high-confidence assignment):

Priority 1 — CRM Contact Roles (confidence 0.95):
  For HubSpot: check deal-to-contact associations for role field
  For Salesforce: check OpportunityContactRole records
  For file import: check any 'role' column in imported data

  SELECT c.id, c.name, c.email, c.title
  FROM contacts c
  JOIN <association_table> a ON a.contact_id = c.id
  WHERE a.deal_id = $1 AND a.workspace_id = $2

  Map CRM role labels to Pandora's buying_role taxonomy:
  - 'Decision Maker', 'DM' → 'decision_maker'
  - 'Economic Buyer', 'Budget Holder' → 'economic_buyer'
  - 'Champion', 'Advocate', 'Internal Sponsor' → 'champion'
  - 'Technical Evaluator', 'Technical Buyer' → 'technical_evaluator'
  - 'Influencer', 'Stakeholder' → 'influencer'
  - 'End User', 'User' → 'end_user'
  - Everything else → store as-is, role_source = 'crm_contact_role'

Priority 2 — CRM Deal Fields (confidence 0.85):
  Check for deal-level fields like 'champion_name', 'economic_buyer', etc.
  Match field values against contacts by name.

Priority 3 — Cross-Deal Pattern Match (confidence 0.70):
  If Contact X has a role on Deal A at the same account, 
  apply that role to Deal B at the same account.

Priority 4 — Title-Based Inference (confidence 0.50):
  Map contact titles to likely roles:
  - /\b(vp|vice president|director).*finance/i → 'economic_buyer'
  - /\b(cto|vp|director).*engineer|tech/i → 'technical_evaluator'  
  - /\b(ceo|coo|cro|president|gm|general manager)/i → 'decision_maker'
  - /\b(manager|team lead|head of)/i → 'influencer'
  
  Only apply if no higher-priority role exists for this contact on this deal.

Insert or update deal_contacts rows. If a row already exists for this
(workspace_id, deal_id, contact_id), only update if new role has higher confidence.

3. ADD ENRICHMENT CONFIG TO CONTEXT LAYER

Add to the workspace config endpoints:

GET /api/workspaces/:id/config/enrichment
  Returns: {
    apollo_api_key: boolean,          // true if set (never return actual key)
    serper_api_key: boolean,
    linkedin_rapidapi_key: boolean,
    auto_enrich_on_close: boolean,    // default true
    enrich_lookback_months: number,   // default 6
    cache_days: number,               // default 90
  }

PUT /api/workspaces/:id/config/enrichment
  Body: {
    apollo_api_key?: string,          // encrypt before storing
    serper_api_key?: string,
    linkedin_rapidapi_key?: string,
    auto_enrich_on_close?: boolean,
    enrich_lookback_months?: number,
  }
  
  Store API keys encrypted in workspace_config (not in context_layer —
  these are secrets, not configuration). Use the same pattern as
  connector OAuth tokens if one exists, or AES-256 with env-level key.

4. TEST

a. Run migration, verify all 4 tables created
b. Pick a Frontera deal with known contacts:
   Call resolveContactRoles(workspaceId, dealId, 'hubspot')
   Log: how many contacts found, what roles resolved, from which sources
c. Verify enrichment config endpoints work
d. Log results
```

### Prompt 2: Apollo + Serper API Integration

```
Pull latest from GitHub. Read the deal_contacts and account_signals
tables from the migration you just created. Also read
PANDORA_LEAD_SCORING_SKILL_SPECS.md for the enrichment pipeline design.

You're building the first two external API integrations for deal enrichment.
These are called by the Closed Deal Enrichment pipeline (Prompt 3) but
are built as standalone services so they can be tested independently.

1. BUILD APOLLO SERVICE

Create server/enrichment/apollo.ts

Export:

interface ApolloPersonResult {
  found: boolean;
  verified_email: string | null;
  current_title: string | null;
  seniority: string | null;          // ic, manager, director, vp, c_level
  department: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_size: string | null;       // '1-10', '11-50', '51-200', etc.
  company_industry: string | null;
  raw_data: Record<string, any>;     // full API response for future use
}

async function enrichContactViaApollo(
  email: string,
  apiKey: string
): Promise<ApolloPersonResult>

Apollo People Enrichment API:
  POST https://api.apollo.io/api/v1/people/match
  Body: { email: email, api_key: apiKey }
  
  Response contains person data + organization data.
  Map to ApolloPersonResult.

Rate limiting:
  - Max 2 requests/second (use a simple delay between calls)
  - If 429 response, back off for 60 seconds, retry once
  - If still failing, return { found: false } and log error

Caching:
  Before calling Apollo, check if deal_contacts.apollo_data already has data
  for this email AND was enriched within cache_days (default 90).
  If cached, return cached data without API call.

async function enrichBatchViaApollo(
  contacts: { email: string; dealContactId: string }[],
  apiKey: string,
  cacheDays: number
): Promise<{
  enrichedCount: number;
  cachedCount: number;
  failedCount: number;
}>

Process contacts sequentially (not parallel — respect rate limits).
For each: check cache → call API if needed → update deal_contacts.apollo_data.

2. BUILD SERPER SERVICE

Create server/enrichment/serper.ts

Export:

interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

async function searchCompanySignals(
  companyName: string,
  apiKey: string
): Promise<SerperSearchResult[]>

Serper API:
  POST https://google.serper.dev/search
  Headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }
  Body: { q: `"${companyName}" news`, num: 10 }
  
  Return the organic results array.

Rate limiting:
  - Max 5 requests/second
  - If 429, back off 30 seconds

Caching:
  Before calling Serper, check if account_signals already has a row
  for this account that was enriched within cache_days.
  If cached, return early.

3. BUILD DEEPSEEK SIGNAL CLASSIFIER

Create server/enrichment/classify-signals.ts

This takes raw Serper results and classifies them into structured signals.

Export:

interface ClassifiedSignal {
  type: 'funding' | 'hiring' | 'expansion' | 'leadership_change' | 'partnership' |
        'product_launch' | 'acquisition' | 'layoff' | 'regulatory' | 'award' | 'negative_press';
  signal: string;                    // one-sentence summary
  source_url: string;
  relevance: number;                 // 0.0-1.0
  date: string | null;              // when the event happened
}

async function classifyAccountSignals(
  companyName: string,
  searchResults: SerperSearchResult[]
): Promise<{
  signals: ClassifiedSignal[];
  signal_summary: string;
  signal_score: number;              // -1.0 to 1.0, weighted positive vs negative
}>

DeepSeek prompt:

```
You are classifying company news signals for B2B sales intelligence.

Company: ${companyName}

Search results:
${searchResults.map((r, i) => `${i+1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`).join('\n\n')}

For each relevant result, extract a structured signal.
Skip results that are irrelevant to the company or too generic.

Signal types: funding, hiring, expansion, leadership_change, partnership,
product_launch, acquisition, layoff, regulatory, award, negative_press

Respond with ONLY valid JSON:
{
  "signals": [
    {
      "type": "funding",
      "signal": "Raised $50M Series C led by Accel",
      "source_url": "https://...",
      "relevance": 0.9,
      "date": "2025-12-15"
    }
  ],
  "signal_summary": "One paragraph synthesis of company momentum",
  "signal_score": 0.7
}

signal_score: weighted average where positive signals (funding, hiring,
expansion, partnership, product_launch, award) push toward 1.0 and
negative signals (layoff, negative_press) push toward -1.0.
Neutral signals (leadership_change, acquisition, regulatory) are 0.
```

After classification, upsert into account_signals table.

4. TEST

a. Apollo test:
   - Pick a Frontera contact with a known email
   - Call enrichContactViaApollo() 
   - Log result: did Apollo find them? What seniority/department?
   - Call again — verify cache hit (no API call)

b. Serper test:
   - Pick a Frontera account name (e.g., "Precious Care ABA")
   - Call searchCompanySignals()
   - Log: how many results? Relevant?

c. Signal classification test:
   - Take Serper results from (b)
   - Call classifyAccountSignals()
   - Log: classified signals, summary, score

d. Verify nothing crashes on empty results or API failures
   - Test with a nonsense company name
   - Test with an invalid API key (should fail gracefully)

Log all results with PASS/FAIL.

NOTE: You'll need valid API keys to test. Check if workspace config
already has keys, or use test keys from environment variables.
If no keys available, build everything and mark API tests as SKIPPED
with a note about needing keys.
```

### Prompt 3: Closed Deal Enrichment Pipeline

```
Pull latest from GitHub. Read the Apollo and Serper services you just built
(server/enrichment/apollo.ts, server/enrichment/serper.ts, 
server/enrichment/classify-signals.ts).

Also read:
- server/enrichment/resolve-contact-roles.ts (contact role resolution)
- The deal_contacts and account_signals table schemas
- PANDORA_LEAD_SCORING_SKILL_SPECS.md — the "Closed Deal Enrichment" skill spec

You're building the orchestration pipeline that ties together contact role
resolution, Apollo enrichment, Serper enrichment, and signal classification
into a single flow that runs when deals close.

1. BUILD THE ENRICHMENT PIPELINE

Create server/enrichment/closed-deal-enrichment.ts

Export:

interface EnrichmentResult {
  dealId: string;
  dealName: string;
  outcome: 'won' | 'lost';
  
  contactResolution: {
    contactCount: number;
    rolesResolved: number;
    rolesSummary: Record<string, number>;
  };
  
  apolloEnrichment: {
    enrichedCount: number;
    cachedCount: number;
    failedCount: number;
  };
  
  accountSignals: {
    signalCount: number;
    signalScore: number;
    topSignals: string[];
  };
  
  // LinkedIn is optional/Phase 2
  linkedinEnrichment: {
    enrichedCount: number;
    cachedCount: number;
    failedCount: number;
  } | null;
  
  durationMs: number;
}

async function enrichClosedDeal(
  workspaceId: string,
  dealId: string
): Promise<EnrichmentResult>

Pipeline steps (sequential, each step independent):

Step 1: Load deal context
  SELECT d.*, a.name as account_name, a.id as account_id
  FROM deals d
  LEFT JOIN accounts a ON a.id = d.account_id
  WHERE d.id = $1 AND d.workspace_id = $2
  
  If deal not found or not closed, return early with error.
  Determine outcome: stage_normalized = 'closed_won' → 'won', else 'lost'

Step 2: Resolve buying committee
  Call resolveContactRoles(workspaceId, dealId, source)
  source = check connector_configs for active CRM connector type
  This populates deal_contacts with roles and pending enrichment status

Step 3: Enrich contacts via Apollo
  Load enrichment config (API key, cache settings)
  If no Apollo key, skip (log, continue)
  
  Get all deal_contacts for this deal with enrichment_status = 'pending'
  Call enrichBatchViaApollo(contacts, apiKey, cacheDays)
  Update each deal_contacts row with apollo_data and seniority_verified
  
  Also update role based on Apollo data:
  If Apollo returns seniority = 'c_level' and current role is 'unknown' or 
  from title_match, upgrade to 'decision_maker' with confidence 0.75,
  role_source = 'apollo_seniority'

Step 4: Enrich account via Serper
  If no Serper key, skip
  Call searchCompanySignals(accountName, apiKey)
  If results found, call classifyAccountSignals(accountName, results)
  Upsert into account_signals table

Step 5: LinkedIn enrichment (STUB for now)
  Log: "LinkedIn enrichment not yet implemented"
  Return null
  
  When implemented later:
  - For each contact where apollo_data.linkedin_url exists
  - Call RapidAPI LinkedIn profile endpoint
  - Extract career history, compute tenure + trajectory
  - Update deal_contacts.linkedin_data

Step 6: Compute derived features
  For each deal_contact with Apollo data:
  - tenure_months: compute from Apollo employment start date if available
  - career_trajectory: 'stable' (placeholder — needs LinkedIn for real trajectory)
  - seniority_verified: Apollo seniority > CRM title parse
  - department_verified: Apollo department > CRM department
  
  Update enrichment_status = 'enriched' (or 'partial' if some steps failed)

Step 7: Return EnrichmentResult

2. BUILD BATCH ENRICHMENT FUNCTION

For the first run, enrich deals that already closed (lookback).

async function enrichClosedDealsInBatch(
  workspaceId: string,
  lookbackMonths: number = 6,
  limit: number = 50
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: EnrichmentResult[];
}>

Query:
  SELECT d.id FROM deals d
  LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
  WHERE d.workspace_id = $1
    AND d.stage_normalized IN ('closed_won', 'closed_lost')
    AND d.close_date > NOW() - INTERVAL '${lookbackMonths} months'
    AND dc.id IS NULL              -- not yet enriched
  ORDER BY d.close_date DESC
  LIMIT $2

For each deal, call enrichClosedDeal(). Process sequentially to respect
API rate limits. Log progress after each deal.

3. WIRE EVENT TRIGGER

Find where deal stage changes are detected during sync.
After a deal's stage_normalized changes to 'closed_won' or 'closed_lost':

  // Fire and forget
  enrichClosedDeal(workspaceId, dealId)
    .then(result => {
      console.log(`[Enrichment] ${result.dealName}: ${result.contactResolution.contactCount} contacts, ` +
        `${result.apolloEnrichment.enrichedCount} Apollo, ${result.accountSignals.signalCount} signals (${result.durationMs}ms)`);
    })
    .catch(err => {
      console.error(`[Enrichment] ${dealId} failed:`, err.message);
    });

If deal stage detection during sync isn't granular enough (i.e., you don't
know which deals changed stage), add a simpler approach:

After CRM sync completes, check for newly-closed deals that haven't been enriched:
  SELECT d.id FROM deals d
  LEFT JOIN deal_contacts dc ON dc.deal_id = d.id
  WHERE d.workspace_id = $1
    AND d.stage_normalized IN ('closed_won', 'closed_lost')
    AND dc.id IS NULL
    AND d.updated_at > NOW() - INTERVAL '24 hours'
  LIMIT 10

Process any found deals. This is a safety net for deals that close
between syncs or where the event trigger was missed.

4. ADD API ENDPOINTS

POST /api/workspaces/:id/enrichment/deal/:dealId
  Triggers enrichClosedDeal(workspaceId, dealId)
  Returns EnrichmentResult
  Manual trigger for testing or re-enriching

POST /api/workspaces/:id/enrichment/batch
  Body: { lookback_months?: number, limit?: number }
  Triggers enrichClosedDealsInBatch()
  Returns batch result summary

GET /api/workspaces/:id/enrichment/status
  Returns:
  {
    total_closed_deals: number,
    enriched_deals: number,
    pending_deals: number,
    total_contacts_enriched: number,
    total_signals: number,
    api_usage: {
      apollo_calls_this_month: number,
      serper_calls_this_month: number,
    },
    last_enrichment_at: string | null
  }

GET /api/workspaces/:id/deals/:dealId/buying-committee
  Returns deal_contacts for this deal with roles and enrichment data:
  SELECT dc.*, c.name, c.email, c.title
  FROM deal_contacts dc
  JOIN contacts c ON c.id = dc.contact_id
  WHERE dc.deal_id = $1 AND dc.workspace_id = $2
  ORDER BY dc.role_confidence DESC

5. TEST

a. Single deal enrichment:
   Pick a Frontera closed-won deal with contacts.
   POST /api/workspaces/:id/enrichment/deal/:dealId
   Log: full EnrichmentResult
   Verify: deal_contacts rows created with roles
   Verify: apollo_data populated (if key available)
   Verify: account_signals row created (if key available)

b. Batch enrichment:
   POST /api/workspaces/:id/enrichment/batch { lookback_months: 6, limit: 5 }
   Log: batch summary
   Verify: multiple deals enriched

c. Status endpoint:
   GET /api/workspaces/:id/enrichment/status
   Verify counts make sense

d. Buying committee:
   GET /api/workspaces/:id/deals/:dealId/buying-committee
   Verify: contacts listed with roles and enrichment data

e. Idempotency:
   Run single deal enrichment again for same deal
   Verify: no duplicate deal_contacts rows (UNIQUE constraint)
   Verify: API calls use cache (check counts)

Log all results.
```

### Prompt 4: Integration Test + Enrichment Validation

```
Pull latest from GitHub. Read:
- server/enrichment/ — all the enrichment services
- The deal_contacts, account_signals tables
- server/enrichment/closed-deal-enrichment.ts

Build a comprehensive test script that validates the enrichment pipeline.

1. CREATE scripts/test-enrichment-pipeline.ts

Test Group 1: Schema Validation
  a. Verify deal_contacts table exists with all columns
  b. Verify account_signals table exists
  c. Verify icp_profiles table exists
  d. Verify lead_scores table exists
  e. Check indexes exist

Test Group 2: Contact Role Resolution
  a. Pick 3 Frontera deals (1 closed-won, 1 closed-lost, 1 open)
  b. For each closed deal:
     - Call resolveContactRoles()
     - ASSERT: contactCount > 0
     - ASSERT: at least 1 role resolved
     - LOG: roles found and sources
  c. For the open deal:
     - Should still work (role resolution isn't restricted to closed deals)
     - LOG: roles found

Test Group 3: Apollo Enrichment (SKIP if no API key)
  a. Check if Apollo API key is configured
  b. If yes:
     - Pick a deal_contact with a known email
     - Call enrichContactViaApollo()
     - ASSERT: found = true OR graceful failure
     - LOG: seniority, department, company
  c. Call again for same email
     - ASSERT: cache hit (no API call)

Test Group 4: Serper Enrichment (SKIP if no API key)
  a. Check if Serper API key is configured
  b. If yes:
     - Search for a Frontera account name
     - ASSERT: results returned (or empty array, not error)
     - Classify results via DeepSeek
     - ASSERT: valid JSON response
     - LOG: signals found, score

Test Group 5: End-to-End Pipeline
  a. Pick a closed deal not yet enriched
  b. Call enrichClosedDeal()
  c. ASSERT: result has contactResolution with contactCount > 0
  d. ASSERT: apolloEnrichment present (enriched or skipped if no key)
  e. ASSERT: accountSignals present (signals or skipped)
  f. Verify deal_contacts rows in database
  g. Verify account_signals row in database
  h. LOG: full EnrichmentResult

Test Group 6: Batch Enrichment
  a. Call enrichClosedDealsInBatch(workspaceId, 6, 3)
  b. ASSERT: processed >= 1
  c. LOG: batch summary

Test Group 7: API Endpoints
  a. GET /enrichment/status — verify counts
  b. GET /deals/:id/buying-committee — verify response shape
  c. POST /enrichment/deal/:id — verify returns EnrichmentResult

2. RUN AND REPORT

npx tsx scripts/test-enrichment-pipeline.ts

Print summary:
- Schema: PASS/FAIL
- Role Resolution: X contacts resolved, Y roles assigned
- Apollo: PASS/FAIL/SKIPPED (no key)
- Serper: PASS/FAIL/SKIPPED (no key)
- Pipeline: PASS/FAIL
- Batch: PASS/FAIL
- Endpoints: PASS/FAIL

If API keys are not available, tests for Apollo/Serper/LinkedIn
should SKIP (not FAIL). The pipeline should still work — it just
won't have external enrichment data.
```

---

## Claude Code Phase — After Replit Pipeline is Built

Once the enrichment pipeline is producing data, Claude Code updates 
the skills to consume it. This is a separate session AFTER Replit 
validation passes.

### Claude Code Tasks (estimated ~3-4 hours)

1. **ICP Discovery: Consume enriched data**
   - Step 2 (build feature matrix): add deal_contacts columns
     (buying_committee_size, roles_identified, seniority_distribution)
   - Step 2 additions: add account_signals columns
     (signal_score, has_funding, has_hiring, has_expansion)
   - Step 3 (persona patterns): use Apollo-verified seniority + department
     instead of CRM title parsing
   - Step 4 (company patterns): add signal-based patterns
     (companies with funding → X% win rate, hiring companies → Y%)
   - Conversation intelligence features already wired from previous session

2. **Lead Scoring: Consume ICP-derived weights**
   - When icp_profiles.is_active exists with scoring_weights:
     Use ICP weights instead of DEFAULT_WEIGHTS
   - Add enrichment-based features:
     - buying_committee_complete: all key roles identified
     - signal_score_positive: account has positive signals
     - seniority_match: contact seniority matches ICP persona
   - Score persistence: write to lead_scores table after scoring

3. **Contact Role Resolution: Use Apollo data**
   - When apollo_data exists, prefer Apollo seniority over title-based inference
   - Upgrade role confidence when Apollo confirms

4. **Pipeline Hygiene + Forecast: Reference ICP scores**
   - "X stale deals are A-grade ICP fit — these are your biggest losses"
   - "Commit pipeline is $2M but only $1.2M is A/B-grade ICP fit"
   - These are optional enhancements, not blocking

The Claude Code prompt for this phase will be written AFTER the Replit
enrichment pipeline is validated with real data — we need to know what
the enriched data actually looks like before updating skills to consume it.

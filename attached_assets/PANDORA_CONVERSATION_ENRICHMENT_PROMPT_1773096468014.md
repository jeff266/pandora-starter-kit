# Claude Code Prompt: Conversation Enrichment Infrastructure
## Unified weekly enrichment job + methodology framework library

---

## What this builds and why

Every skill that touches conversations is currently doing the same
work independently: assembling transcript pools, extracting customer
turns, calling DeepSeek, and storing results in skill-specific tables.
Winning Path, Stage Progression, Competition, Deal Hygiene, ICP
Discovery, Lead Scoring, Rep Scorecard, and Monte Carlo all process
the same conversation twice, three, four times per quarterly or weekly
run.

This prompt builds the shared infrastructure layer that eliminates
that duplication:

1. `conversation_enrichments` table — one row per conversation, all
   dimensions classified, written once per week
2. Weekly enrichment job — processes new conversations Sunday night
   before Monday skill runs; also resolves pending stage tags
3. Methodology framework library — 10 frameworks, each with specific
   observable signals, conditionally injected into the DeepSeek prompt
   based on workspace configuration
4. Updated query layer — each skill reads pre-enriched data instead
   of touching `transcript_text` directly

Skills become readers. The enrichment job is the only writer.

---

## Before starting

Read these files:

1. `server/skills/compute/behavioral-milestones.ts` — understand
   `extractCustomerTurns()` — reuse it here, don't duplicate
2. `server/config/workspace-config-loader.ts` — how skills read
   workspace config, specifically `methodology` field if it exists
3. `server/config/inference-engine.ts` — Source 4 (documentation
   mining) already detects methodology. Read how it stores the result.
4. The `conversations` table schema — `transcript_text`, `participants`,
   `summary`, `source_data`, `deal_id`, `is_internal`, `started_at`
5. The `deal_stage_history` table schema
6. An existing skill that calls DeepSeek (pipeline-hygiene or
   behavioral-winning-path) — copy the call pattern exactly
7. The sync scheduler — understand where to register a new weekly job
8. `server/connectors/gong/sync.ts` — Gong's `source_data` has native
   `talk_ratio`, `interactivity`, `question_count` — read these
   directly instead of re-computing from transcript

---

## Part 1: Methodology Framework Library

This is the most important design decision in this build. Every
framework is a named set of observable signals — things a buyer or
rep would SAY on a call that indicate the framework is being worked.

The library is static configuration, not runtime logic. It lives in:
`server/config/methodology-frameworks.ts`

### Framework definitions

Each framework has:
- `id` — canonical identifier stored in workspace config
- `label` — display name
- `description` — one sentence on the framework's core principle
- `dimensions` — the framework's named components
- Each dimension has `signals` — specific, observable language patterns

```typescript
export interface MethodologyDimension {
  id: string;
  label: string;
  description: string;       // what this dimension captures
  qualifying_questions: string[];  // what the REP should be asking
  positive_signals: string[];      // buyer language indicating this is covered
  negative_signals: string[];      // language indicating this is weak/absent
  crmFieldHints: string[];         // CRM field names that indicate this dimension
}

export interface MethodologyFramework {
  id: string;
  label: string;
  description: string;
  vendor?: string;            // e.g. "Force Management", "Miller Heiman Group"
  dimensions: MethodologyDimension[];
  autoDetectPatterns: string[]; // phrases in docs/calls that suggest this framework
}
```

### The 10 frameworks

---

#### 1. MEDDIC / MEDDPICC

```typescript
{
  id: 'meddpicc',
  label: 'MEDDPICC',
  description: 'Qualification framework focused on verifiable criteria for complex B2B sales',
  vendor: 'PTC (origin)',
  autoDetectPatterns: ['meddic', 'meddpicc', 'economic buyer', 'champion', 'decision criteria',
                        'identify pain', 'paper process'],
  dimensions: [
    {
      id: 'metrics',
      label: 'Metrics',
      description: 'Quantified business impact the buyer expects',
      qualifying_questions: [
        'What does success look like in numbers?',
        'How are you measuring the problem today?',
        'What ROI are you expecting?',
      ],
      positive_signals: [
        'buyer states a specific number, percentage, or dollar amount tied to outcome',
        'buyer references current baseline metric ("we spend X hours", "costs us $Y")',
        'buyer calculates or agrees to an ROI estimate on the call',
        'buyer mentions board or exec-level KPIs tied to this problem',
      ],
      negative_signals: [
        'outcome described only in qualitative terms ("better", "faster", "easier")',
        'buyer deflects when asked about impact ("hard to say", "we\'ll figure it out")',
      ],
      crmFieldHints: ['metrics', 'roi', 'business_value', 'impact', 'kpi'],
    },
    {
      id: 'economic_buyer',
      label: 'Economic Buyer',
      description: 'Person with budget authority and final decision power',
      qualifying_questions: [
        'Who owns the budget for this?',
        'Who signs off on purchases of this size?',
        'Have you bought something like this before — who approved it?',
      ],
      positive_signals: [
        'buyer names a specific person with budget authority',
        'economic buyer appears on a call and discusses budget or business case',
        'buyer describes the economic buyer\'s priorities or concerns',
        'reference to executive sponsor, CFO, VP, or board involvement',
      ],
      negative_signals: [
        'buyer cannot name who approves the purchase',
        'buyer says "I\'ll need to check with my boss" without identifying them',
        '"committee decision" with no named decision-maker',
      ],
      crmFieldHints: ['economic_buyer', 'exec_sponsor', 'budget_owner', 'decision_maker'],
    },
    {
      id: 'decision_criteria',
      label: 'Decision Criteria',
      description: 'The formal requirements the solution must meet to win',
      qualifying_questions: [
        'What does the ideal solution look like?',
        'What are your must-haves vs. nice-to-haves?',
        'How will you evaluate vendors?',
      ],
      positive_signals: [
        'buyer lists specific requirements or capabilities they need',
        'buyer mentions an RFP, scorecard, or evaluation rubric',
        'buyer compares vendors against named criteria on the call',
        'buyer states a dealbreaker or non-negotiable requirement',
      ],
      negative_signals: [
        'no explicit criteria discussed beyond "general fit"',
        'buyer says they\'re "just exploring" without named requirements',
      ],
      crmFieldHints: ['decision_criteria', 'requirements', 'evaluation_criteria', 'rfp'],
    },
    {
      id: 'decision_process',
      label: 'Decision Process',
      description: 'The steps and timeline the buying organization will follow',
      qualifying_questions: [
        'Walk me through how you make a decision like this.',
        'What happens after our demo today?',
        'What does your procurement or legal process look like?',
      ],
      positive_signals: [
        'buyer describes specific next steps they will take internally',
        'buyer mentions legal, procurement, or security review',
        'buyer gives a timeline with named milestones',
        'buyer references a previous vendor selection process',
      ],
      negative_signals: [
        'buyer cannot describe next steps beyond "we\'ll get back to you"',
        'timeline is vague ("sometime this quarter", "when the time is right")',
      ],
      crmFieldHints: ['decision_process', 'next_steps', 'procurement', 'legal_review'],
    },
    {
      id: 'identify_pain',
      label: 'Identify Pain',
      description: 'The specific, acknowledged problem driving urgency to act',
      qualifying_questions: [
        'What\'s the cost of not solving this?',
        'What happens if you do nothing?',
        'How long has this been a problem?',
      ],
      positive_signals: [
        'buyer describes a specific negative consequence of the current state',
        'buyer expresses frustration or urgency about the problem',
        'buyer quantifies the cost or impact of the problem',
        'buyer says they\'ve tried other solutions that failed',
      ],
      negative_signals: [
        'problem described as "nice to have" or "when we get to it"',
        'no urgency language — buyer is passively interested',
        'pain is rep-stated but buyer doesn\'t validate it',
      ],
      crmFieldHints: ['pain_points', 'challenges', 'problems', 'current_state'],
    },
    {
      id: 'champion',
      label: 'Champion',
      description: 'Internal advocate who sells on your behalf when you\'re not in the room',
      qualifying_questions: [
        'Who else is excited about solving this problem?',
        'Is there someone internally who would go to bat for this?',
        'Can you help me understand how to position this for your team?',
      ],
      positive_signals: [
        'buyer proactively offers to introduce the rep to others',
        'buyer shares internal context, org politics, or competitor positioning',
        'buyer uses "we" language about solving the problem together',
        'buyer reports back on internal conversations between calls',
        'buyer coaches the rep on how to handle objections internally',
      ],
      negative_signals: [
        'buyer only responds reactively, never volunteers information',
        'buyer has not introduced any other stakeholders after 3+ calls',
        'buyer deflects when asked about internal advocacy',
      ],
      crmFieldHints: ['champion', 'internal_sponsor', 'coach', 'internal_advocate'],
    },
    {
      id: 'paper_process',
      label: 'Paper Process',
      description: 'The contractual, legal, and procurement steps required to close',
      qualifying_questions: [
        'Once you decide to move forward, what does the contract process look like?',
        'Do you have standard vendor agreements or will you use ours?',
        'How long does legal review typically take?',
      ],
      positive_signals: [
        'buyer describes their standard contract or MSA process',
        'buyer mentions procurement, legal, or security requirements',
        'buyer gives a timeline estimate for contract review',
        'buyer mentions DPA, SOC 2, or security questionnaire requirements',
      ],
      negative_signals: [
        'no discussion of contract mechanics after mid-stage',
        'buyer surprised by legal or procurement requirements at close',
      ],
      crmFieldHints: ['paper_process', 'legal', 'procurement', 'contract', 'dpa', 'security_review'],
    },
    {
      id: 'competition',
      label: 'Competition',
      description: 'Who else is being evaluated and on what basis',
      qualifying_questions: [
        'Are you looking at other solutions?',
        'What else have you evaluated?',
        'How do we compare to what you\'ve seen?',
      ],
      positive_signals: [
        'buyer names specific competitors being evaluated',
        'buyer describes how the rep\'s solution differs from alternatives',
        'buyer shares what competitors offered or proposed',
        'buyer asks rep to differentiate against a named competitor',
      ],
      negative_signals: [
        'buyer claims no competitive evaluation (rare in enterprise)',
        'buyer deflects all competitive questions',
      ],
      crmFieldHints: ['competitors', 'competition', 'alternatives', 'competitive'],
    },
  ],
}
```

---

#### 2. BANT

```typescript
{
  id: 'bant',
  label: 'BANT',
  description: 'Classic qualification framework: Budget, Authority, Need, Timeline',
  vendor: 'IBM (origin)',
  autoDetectPatterns: ['bant', 'budget confirmed', 'authority', 'need identified', 'timeline'],
  dimensions: [
    {
      id: 'budget',
      label: 'Budget',
      description: 'Confirmed budget exists and is sufficient for this purchase',
      qualifying_questions: ['Do you have budget allocated for this?', 'What is your budget range?'],
      positive_signals: [
        'buyer confirms a budget exists for this initiative',
        'buyer states a specific budget range or ceiling',
        'buyer references a line item or budget code',
        'buyer says budget is approved or pre-approved',
      ],
      negative_signals: [
        'buyer says "we\'d need to find budget"',
        'budget is contingent on proving ROI first',
        'no budget discussion after qualification stage',
      ],
      crmFieldHints: ['budget', 'budget_confirmed', 'budget_range'],
    },
    {
      id: 'authority',
      label: 'Authority',
      description: 'Decision-maker is identified and engaged',
      qualifying_questions: ['Who makes the final decision?', 'Are you the decision-maker?'],
      positive_signals: [
        'buyer confirms they are the decision-maker',
        'buyer names and describes the decision-maker',
        'decision-maker appears on a call',
      ],
      negative_signals: [
        'buyer cannot name decision-maker',
        'multiple approvers mentioned with no clear owner',
      ],
      crmFieldHints: ['decision_maker', 'authority', 'approver'],
    },
    {
      id: 'need',
      label: 'Need',
      description: 'Clear, acknowledged business need that this solution addresses',
      qualifying_questions: ['What problem are you trying to solve?', 'Why now?'],
      positive_signals: [
        'buyer articulates a specific problem in their own words',
        'buyer connects the problem to business impact',
        'buyer expresses urgency or priority',
      ],
      negative_signals: [
        'vague interest without specific problem statement',
        'buyer exploring without a defined need',
      ],
      crmFieldHints: ['need', 'pain_point', 'use_case', 'problem'],
    },
    {
      id: 'timeline',
      label: 'Timeline',
      description: 'Specific timeline for decision and implementation',
      qualifying_questions: ['When do you need this in place?', 'What\'s driving your timeline?'],
      positive_signals: [
        'buyer names a specific date or quarter for decision',
        'buyer references an event, deadline, or business driver creating urgency',
        'buyer has a go-live or implementation date in mind',
      ],
      negative_signals: [
        'no timeline ("when the time is right")',
        'timeline is a year or more away with no near-term trigger',
      ],
      crmFieldHints: ['timeline', 'close_date', 'go_live', 'decision_date'],
    },
  ],
}
```

---

#### 3. SPICED

```typescript
{
  id: 'spiced',
  label: 'SPICED',
  description: 'Customer-centric framework: Situation, Pain, Impact, Critical Event, Decision',
  vendor: 'Winning by Design',
  autoDetectPatterns: ['spiced', 'critical event', 'impact', 'situation'],
  dimensions: [
    {
      id: 'situation',
      label: 'Situation',
      description: 'Current state of the buyer\'s business and context',
      qualifying_questions: ['Tell me about your current setup.', 'How are you handling this today?'],
      positive_signals: [
        'buyer describes their current process, tools, or team structure',
        'buyer gives context about company size, stage, or growth trajectory',
        'buyer explains the history of the problem',
      ],
      negative_signals: ['rep talks more than buyer about the situation'],
      crmFieldHints: ['situation', 'current_state', 'background'],
    },
    {
      id: 'pain',
      label: 'Pain',
      description: 'Specific problem or friction in the current situation',
      qualifying_questions: ['What\'s not working?', 'What\'s the hardest part of this today?'],
      positive_signals: [
        'buyer describes a specific frustration or broken workflow',
        'buyer uses emotional language about the problem',
        'buyer gives examples of consequences from the current state',
      ],
      negative_signals: ['problem is vague or rep-hypothesized'],
      crmFieldHints: ['pain', 'challenge', 'friction'],
    },
    {
      id: 'impact',
      label: 'Impact',
      description: 'Business consequence of the pain — quantified or qualifiable',
      qualifying_questions: ['What does this cost you?', 'What\'s the downstream effect?'],
      positive_signals: [
        'buyer quantifies impact in time, money, or risk terms',
        'buyer connects pain to a strategic business outcome',
        'buyer describes cascading effects on other teams or processes',
      ],
      negative_signals: ['impact is acknowledged but not specified or quantified'],
      crmFieldHints: ['impact', 'business_value', 'cost_of_inaction'],
    },
    {
      id: 'critical_event',
      label: 'Critical Event',
      description: 'External deadline or event that creates urgency to decide',
      qualifying_questions: ['Is there something driving your timeline?', 'What happens if you wait?'],
      positive_signals: [
        'buyer names a specific event: fiscal year end, product launch, board review',
        'buyer describes a penalty or consequence of missing the deadline',
        'urgency is buyer-generated, not rep-manufactured',
      ],
      negative_signals: [
        'no external driver — decision is purely discretionary',
        'critical event named by rep but not validated by buyer',
      ],
      crmFieldHints: ['critical_event', 'compelling_event', 'deadline', 'trigger'],
    },
    {
      id: 'decision',
      label: 'Decision',
      description: 'How, by whom, and on what criteria the decision will be made',
      qualifying_questions: ['How does your team make decisions like this?', 'What does your process look like?'],
      positive_signals: [
        'buyer describes a clear decision-making process',
        'buyer names the decision-maker and their priorities',
        'buyer explains evaluation criteria',
      ],
      negative_signals: ['decision process is unknown or undefined'],
      crmFieldHints: ['decision_process', 'decision_criteria', 'decision_maker'],
    },
  ],
}
```

---

#### 4. SPIN Selling

```typescript
{
  id: 'spin',
  label: 'SPIN Selling',
  description: 'Question-based framework: Situation, Problem, Implication, Need-Payoff',
  vendor: 'Huthwaite International / Neil Rackham',
  autoDetectPatterns: ['spin selling', 'implication questions', 'need-payoff', 'neil rackham'],
  dimensions: [
    {
      id: 'situation_questions',
      label: 'Situation Questions',
      description: 'Rep asks questions to understand the buyer\'s current context',
      qualifying_questions: ['How many people use this?', 'What tools do you currently use?'],
      positive_signals: [
        'buyer provides factual answers about current state, team, tools',
        'conversation opens with buyer sharing background without being prompted at length',
      ],
      negative_signals: [
        'rep asks too many situation questions (>60% of questions) — SPIN failure mode',
        'buyer grows impatient with background questions',
      ],
      crmFieldHints: ['current_state', 'background'],
    },
    {
      id: 'problem_questions',
      label: 'Problem Questions',
      description: 'Rep probes for difficulties and dissatisfactions in the current state',
      qualifying_questions: ['What\'s the hardest part of this?', 'How satisfied are you with X?'],
      positive_signals: [
        'buyer acknowledges a specific problem or dissatisfaction',
        'buyer uses language like "frustrating", "difficult", "wish we could"',
        'buyer expands on a problem without further prompting',
      ],
      negative_signals: ['buyer has no expressed dissatisfaction — problem questions had no traction'],
      crmFieldHints: ['pain_points', 'challenges'],
    },
    {
      id: 'implication_questions',
      label: 'Implication Questions',
      description: 'Rep helps buyer understand consequences of the problem — creates urgency',
      qualifying_questions: ['What effect does that have on your team?', 'How does that impact your customers?'],
      positive_signals: [
        'buyer describes downstream effects of the problem without rep prompting',
        'buyer connects problem to business metrics, team morale, or customer impact',
        'buyer expresses concern about consequences ("that\'s actually a big deal")',
      ],
      negative_signals: [
        'buyer minimizes consequences ("it\'s annoying but not critical")',
        'rep states implications rather than buyer discovering them',
      ],
      crmFieldHints: ['impact', 'consequences'],
    },
    {
      id: 'need_payoff',
      label: 'Need-Payoff Questions',
      description: 'Rep prompts buyer to articulate the value of solving the problem',
      qualifying_questions: ['How would it help if you could X?', 'What would that be worth to you?'],
      positive_signals: [
        'buyer articulates the value of a solution in their own words',
        'buyer describes what solving the problem would enable',
        'buyer calculates or estimates the benefit of the solution',
        'buyer becomes more positive and engaged as they describe the future state',
      ],
      negative_signals: [
        'rep states the value proposition instead of buyer articulating it',
        'buyer is non-committal about the benefit',
      ],
      crmFieldHints: ['value', 'benefit', 'roi', 'outcome'],
    },
  ],
}
```

---

#### 5. Challenger Sale

```typescript
{
  id: 'challenger',
  label: 'Challenger Sale',
  description: 'Rep teaches a new perspective, tailors to stakeholder, and takes control of the sale',
  vendor: 'Gartner / CEB / Matthew Dixon & Brent Adamson',
  autoDetectPatterns: ['challenger', 'commercial insight', 'reframe', 'teach tailor take control'],
  dimensions: [
    {
      id: 'teach',
      label: 'Teach',
      description: 'Rep introduces a unique insight that reframes how the buyer sees their problem',
      qualifying_questions: [],
      positive_signals: [
        'buyer says "I hadn\'t thought about it that way"',
        'buyer expresses surprise at data or benchmark the rep shared',
        'buyer asks follow-up questions about the insight rather than dismissing it',
        'buyer shares the insight with someone else on the call ("that\'s interesting — did you hear that?")',
      ],
      negative_signals: [
        'buyer is unresponsive to the insight',
        'rep defaults to product demo without teaching a perspective first',
      ],
      crmFieldHints: ['insight', 'reframe', 'point_of_view'],
    },
    {
      id: 'tailor',
      label: 'Tailor',
      description: 'Rep adapts the message to the specific stakeholder\'s priorities and role',
      qualifying_questions: [],
      positive_signals: [
        'buyer responds positively to role-specific framing',
        'buyer confirms the rep correctly understood their priorities',
        'buyer engages more deeply when rep speaks to their specific concerns',
      ],
      negative_signals: [
        'generic pitch delivered without adapting to the stakeholder in the room',
        'buyer corrects the rep\'s assumptions about their priorities',
      ],
      crmFieldHints: ['stakeholder_priorities', 'persona'],
    },
    {
      id: 'take_control',
      label: 'Take Control',
      description: 'Rep drives the process, negotiates access, and maintains momentum',
      qualifying_questions: [],
      positive_signals: [
        'buyer agrees to rep-proposed next steps with specific dates',
        'buyer agrees to introduce rep to economic buyer or other stakeholders',
        'buyer agrees to a mutual action plan or evaluation timeline',
        'when buyer pushes on price, rep redirects to value before conceding',
      ],
      negative_signals: [
        'rep agrees to send information without a scheduled next call',
        'rep gives a discount before buyer demonstrates value alignment',
        'next steps are buyer-vague ("we\'ll be in touch")',
      ],
      crmFieldHints: ['next_steps', 'mutual_action_plan'],
    },
  ],
}
```

---

#### 6. Gap Selling

```typescript
{
  id: 'gap_selling',
  label: 'Gap Selling',
  description: 'Problem-centric framework focused on the gap between current and future state',
  vendor: 'Keenan / A Sales Growth Company',
  autoDetectPatterns: ['gap selling', 'keenan', 'current state', 'future state', 'gap'],
  dimensions: [
    {
      id: 'current_state',
      label: 'Current State',
      description: 'Deep understanding of the buyer\'s current situation, problems, and root causes',
      qualifying_questions: ['What does your current process look like?', 'What\'s causing this problem?'],
      positive_signals: [
        'buyer articulates current state in detail, including root cause',
        'buyer identifies why the problem exists, not just what it is',
        'conversation spends meaningful time on current state before solution',
      ],
      negative_signals: [
        'rep jumps to solution before current state is fully understood',
        'current state is superficial ("things could be better")',
      ],
      crmFieldHints: ['current_state', 'root_cause'],
    },
    {
      id: 'future_state',
      label: 'Future State',
      description: 'Specific vision of what success looks like after the problem is solved',
      qualifying_questions: ['What would ideal look like?', 'If we solved this, what changes?'],
      positive_signals: [
        'buyer describes a specific, concrete future state',
        'buyer expresses emotional investment in achieving the future state',
        'buyer quantifies the future state in measurable terms',
      ],
      negative_signals: [
        'future state is vague ("just better than today")',
        'buyer cannot envision or articulate improvement',
      ],
      crmFieldHints: ['future_state', 'desired_outcome', 'success_criteria'],
    },
    {
      id: 'gap',
      label: 'The Gap',
      description: 'The distance between current state and future state — where value lives',
      qualifying_questions: ['What\'s standing between where you are and where you want to be?'],
      positive_signals: [
        'buyer explicitly connects the problem to the gap from their desired state',
        'buyer articulates what\'s missing or blocking progress',
        'conversation makes the gap feel urgent and concrete',
      ],
      negative_signals: [
        'no explicit discussion of the gap — solution pitched without connecting to desired state',
      ],
      crmFieldHints: ['gap', 'blockers', 'obstacles'],
    },
    {
      id: 'impact',
      label: 'Impact',
      description: 'Business, financial, or emotional cost of not closing the gap',
      qualifying_questions: ['What does staying in the current state cost you?'],
      positive_signals: [
        'buyer quantifies cost of inaction in financial or operational terms',
        'buyer describes organizational risk from not solving the problem',
        'buyer expresses personal stake in solving the problem',
      ],
      negative_signals: ['impact is acknowledged but not felt or quantified'],
      crmFieldHints: ['cost_of_inaction', 'risk', 'impact'],
    },
  ],
}
```

---

#### 7. Miller Heiman Strategic Selling

```typescript
{
  id: 'miller_heiman',
  label: 'Miller Heiman Strategic Selling',
  description: 'Buying influence framework: identify and align all roles in the buying committee',
  vendor: 'Miller Heiman Group / Korn Ferry',
  autoDetectPatterns: ['miller heiman', 'strategic selling', 'blue sheet', 'buying influences',
                        'economic buyer', 'user buyer', 'technical buyer', 'coach'],
  dimensions: [
    {
      id: 'economic_buyer',
      label: 'Economic Buyer',
      description: 'Single person with ultimate financial authority — says yes or no to funds',
      qualifying_questions: ['Who ultimately controls the budget?'],
      positive_signals: [
        'economic buyer identified by name and title',
        'economic buyer engaged in at least one call',
        'economic buyer\'s win result (personal outcome) is understood',
      ],
      negative_signals: ['economic buyer unknown or unengaged after mid-stage'],
      crmFieldHints: ['economic_buyer', 'budget_authority'],
    },
    {
      id: 'user_buyer',
      label: 'User Buyer',
      description: 'People who will use the solution day-to-day and judge its impact on their work',
      qualifying_questions: ['Who will actually use this?', 'What does the end user need?'],
      positive_signals: [
        'end users identified and engaged in the evaluation',
        'user buyer concerns (ease of use, workflow fit) discussed',
        'user buyer\'s win result (makes their job easier) acknowledged',
      ],
      negative_signals: ['evaluation conducted only at executive level — no user input'],
      crmFieldHints: ['end_users', 'user_buyer'],
    },
    {
      id: 'technical_buyer',
      label: 'Technical Buyer',
      description: 'Screens solutions for technical fit — IT, security, legal, procurement',
      qualifying_questions: ['Who evaluates technical requirements?', 'Does IT need to be involved?'],
      positive_signals: [
        'technical evaluator identified (IT, security, legal, procurement)',
        'technical requirements discussed on a call with technical stakeholder',
        'technical objections surfaced and addressed',
      ],
      negative_signals: ['technical evaluation hasn\'t started by evaluation stage'],
      crmFieldHints: ['technical_buyer', 'it_contact', 'security_review'],
    },
    {
      id: 'coach',
      label: 'Coach',
      description: 'Internal guide who provides intel, wants you to win, and coaches your strategy',
      qualifying_questions: [],
      positive_signals: [
        'buyer proactively shares internal information or org dynamics',
        'buyer coaches the rep on how to handle specific stakeholders',
        'buyer provides competitive intelligence from inside the account',
        'buyer uses "we" language about winning together',
      ],
      negative_signals: [
        'no internal contact sharing strategic guidance',
        'all information comes from formal meetings only',
      ],
      crmFieldHints: ['coach', 'champion', 'internal_sponsor'],
    },
    {
      id: 'win_results',
      label: 'Win Results',
      description: 'Each buying influence\'s personal win from this decision',
      qualifying_questions: ['What does success look like for you personally?'],
      positive_signals: [
        'buyer articulates personal benefit beyond company benefit',
        'buyer\'s personal win (career, recognition, relief) is understood',
        'rep has adapted message to each stakeholder\'s personal outcome',
      ],
      negative_signals: ['conversations focus only on company-level ROI, not personal stakeholder outcomes'],
      crmFieldHints: ['personal_win', 'stakeholder_outcome'],
    },
  ],
}
```

---

#### 8. Command of the Message (Force Management)

```typescript
{
  id: 'command_of_message',
  label: 'Command of the Message',
  description: 'Value-based selling framework tied to positive business outcomes and required capabilities',
  vendor: 'Force Management',
  autoDetectPatterns: ['command of the message', 'force management', 'positive business outcomes',
                        'required capabilities', 'pbo', 'metrics of success'],
  dimensions: [
    {
      id: 'positive_business_outcomes',
      label: 'Positive Business Outcomes',
      description: 'Business results the buyer needs to achieve — tied to their strategic priorities',
      qualifying_questions: ['What business outcomes are you trying to drive?'],
      positive_signals: [
        'buyer names strategic business outcomes (revenue growth, cost reduction, risk mitigation)',
        'outcomes are tied to company-level priorities, not just departmental goals',
        'buyer connects the purchase to a measurable business result',
      ],
      negative_signals: ['discussion stays at feature/function level without connecting to business outcomes'],
      crmFieldHints: ['business_outcomes', 'strategic_priority', 'pbo'],
    },
    {
      id: 'required_capabilities',
      label: 'Required Capabilities',
      description: 'What the solution must do to achieve the positive business outcomes',
      qualifying_questions: ['What does the solution need to do for you to achieve X?'],
      positive_signals: [
        'buyer articulates specific capabilities they need',
        'buyer connects required capabilities to their desired outcomes',
        'buyer differentiates must-have capabilities from nice-to-haves',
      ],
      negative_signals: ['requirements are generic ("needs to be easy to use", "needs to scale")'],
      crmFieldHints: ['required_capabilities', 'requirements', 'must_haves'],
    },
    {
      id: 'metrics_of_success',
      label: 'Metrics of Success',
      description: 'How the buyer will measure whether they achieved the positive business outcomes',
      qualifying_questions: ['How will you know this worked?', 'What does success look like in 6 months?'],
      positive_signals: [
        'buyer names specific metrics they will use to measure success',
        'metrics are tied to the positive business outcomes discussed',
        'buyer has a baseline to measure from',
      ],
      negative_signals: ['no discussion of how success will be measured'],
      crmFieldHints: ['success_metrics', 'kpis', 'measurement'],
    },
    {
      id: 'decision_criteria_process',
      label: 'Decision Criteria & Process',
      description: 'How the buying team will evaluate and choose a vendor',
      qualifying_questions: ['How will you decide?', 'What does your evaluation process look like?'],
      positive_signals: [
        'buyer describes explicit evaluation criteria aligned to required capabilities',
        'buyer explains the decision process and timeline',
        'buyer\'s decision criteria map to rep\'s differentiated strengths',
      ],
      negative_signals: ['decision criteria are unknown or based primarily on price'],
      crmFieldHints: ['decision_criteria', 'evaluation_process'],
    },
  ],
}
```

---

#### 9. NEAT Selling

```typescript
{
  id: 'neat',
  label: 'NEAT Selling',
  description: 'Modern qualification: Need, Economic Impact, Access to Authority, Timeline',
  vendor: 'The Harris Consulting Group / Sales Hacker',
  autoDetectPatterns: ['neat selling', 'economic impact', 'access to authority'],
  dimensions: [
    {
      id: 'need',
      label: 'Need',
      description: 'Core need — the root cause of the pain, not the surface symptom',
      qualifying_questions: ['What\'s the underlying problem?', 'Why is this happening?'],
      positive_signals: [
        'buyer identifies root cause, not just symptoms',
        'buyer connects the need to a strategic priority',
      ],
      negative_signals: ['need is superficial or symptom-level only'],
      crmFieldHints: ['need', 'root_cause', 'core_problem'],
    },
    {
      id: 'economic_impact',
      label: 'Economic Impact',
      description: 'Financial impact of the problem and the solution — quantified',
      qualifying_questions: ['What does this cost you?', 'What\'s the financial impact of solving this?'],
      positive_signals: [
        'buyer quantifies the cost of the problem in dollars or percentage',
        'buyer validates a financial impact estimate from the rep',
        'buyer calculates or agrees to an ROI model',
      ],
      negative_signals: ['economic impact discussed qualitatively only'],
      crmFieldHints: ['economic_impact', 'roi', 'financial_impact'],
    },
    {
      id: 'access_to_authority',
      label: 'Access to Authority',
      description: 'Rep has a path to the decision-maker, not just the champion',
      qualifying_questions: ['Can you set up a meeting with your VP?', 'Could we include X in the next call?'],
      positive_signals: [
        'buyer agrees to introduce or include the decision-maker',
        'decision-maker has appeared on at least one call',
        'buyer facilitates access actively rather than blocking it',
      ],
      negative_signals: [
        'rep has only met with champion — no access to economic buyer',
        'buyer is protective of the relationship and blocks rep from decision-maker',
      ],
      crmFieldHints: ['executive_access', 'decision_maker_meeting'],
    },
    {
      id: 'timeline',
      label: 'Timeline',
      description: 'Real, event-driven timeline — not a close date the rep invented',
      qualifying_questions: ['What\'s driving your timeline?', 'Is there a specific event creating urgency?'],
      positive_signals: [
        'timeline is tied to a buyer-stated event or business driver',
        'buyer expresses urgency without being pressured by rep',
        'buyer has a go-live or decision date with a reason behind it',
      ],
      negative_signals: [
        'timeline is vague or rep-manufactured',
        'buyer extends timeline repeatedly without a new driver',
      ],
      crmFieldHints: ['timeline', 'compelling_event', 'decision_date'],
    },
  ],
}
```

---

#### 10. Sandler Selling System

```typescript
{
  id: 'sandler',
  label: 'Sandler Selling System',
  description: 'Buyer-psychology framework: qualify hard upfront, reverse psychology, no pressure',
  vendor: 'Sandler Training',
  autoDetectPatterns: ['sandler', 'pain funnel', 'up-front contract', 'dummy curve', 'nurturing'],
  dimensions: [
    {
      id: 'pain',
      label: 'Pain (Emotional)',
      description: 'Rep uncovers the emotional and personal cost of the problem — not just business impact',
      qualifying_questions: ['How does this affect you personally?', 'How long has this been going on?'],
      positive_signals: [
        'buyer expresses emotional language about the problem',
        'buyer describes personal frustration, stress, or risk',
        'buyer goes beyond business impact to personal impact',
      ],
      negative_signals: ['conversation stays intellectual — no emotional engagement from buyer'],
      crmFieldHints: ['pain', 'emotional_impact'],
    },
    {
      id: 'budget',
      label: 'Budget (Qualified)',
      description: 'Budget is surfaced and qualified early — no budget, no deal',
      qualifying_questions: ['What have you set aside for this?', 'Have you bought something like this before?'],
      positive_signals: [
        'budget discussion happens in early calls, not late',
        'buyer names a budget range or confirms funds exist',
        'buyer has bought similar solutions before and shares that context',
      ],
      negative_signals: [
        'budget not discussed until late stage',
        'budget qualification deferred repeatedly',
      ],
      crmFieldHints: ['budget', 'budget_qualified'],
    },
    {
      id: 'decision',
      label: 'Decision',
      description: 'Decision process, criteria, and all stakeholders identified upfront',
      qualifying_questions: ['Who else is involved?', 'Walk me through how you make a decision like this.'],
      positive_signals: [
        'buyer describes full decision process including all stakeholders',
        'buyer explains what would cause them NOT to move forward',
        'upfront contract established for how the conversation will proceed',
      ],
      negative_signals: [
        'decision process vague or revealed only at close',
        'new stakeholders appearing late in the process',
      ],
      crmFieldHints: ['decision_process', 'stakeholders'],
    },
  ],
}
```

---

## Part 2: Methodology auto-detection

The workspace config inference engine (already built) detects methodology
from CRM fields and documents. Add a lookup table that maps detected
evidence to framework IDs:

```typescript
// server/config/methodology-frameworks.ts

export function detectMethodologyFromEvidence(evidence: {
  crmFields: string[];          // field names from CRM
  docKeywords: string[];        // words found in uploaded docs/Drive
  existingConfig?: string;      // if already set in workspace config
}): { frameworkId: string; confidence: number } | null {

  if (evidence.existingConfig) {
    return { frameworkId: evidence.existingConfig, confidence: 1.0 };
  }

  for (const framework of ALL_FRAMEWORKS) {
    const fieldMatches = framework.dimensions.flatMap(d => d.crmFieldHints)
      .filter(hint => evidence.crmFields.some(f =>
        f.toLowerCase().includes(hint.toLowerCase())
      )).length;

    const docMatches = framework.autoDetectPatterns
      .filter(pattern => evidence.docKeywords.some(k =>
        k.toLowerCase().includes(pattern.toLowerCase())
      )).length;

    const score = (fieldMatches * 0.6) + (docMatches * 0.4);

    if (score >= 2) {
      return {
        frameworkId: framework.id,
        confidence: Math.min(0.95, score / 5),
      };
    }
  }

  return null; // no methodology detected — enrich without methodology section
}
```

Store detected methodology in workspace config:
`workspace_config.methodology = { framework_id, confidence, source }`

---

## Part 3: conversation_enrichments migration

Create the next migration. Column comments explain which skill reads each field.

```sql
CREATE TABLE conversation_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrichment_version INT NOT NULL DEFAULT 1,

  -- ── CALL QUALITY ─── Deal Hygiene, Rep Scorecard, Coaching ────────────
  is_substantive BOOLEAN,
  customer_talk_pct NUMERIC(5,2),
  rep_talk_pct NUMERIC(5,2),
  longest_rep_monologue_seconds INT,
  questions_asked_by_rep INT,
  call_energy TEXT CHECK (call_energy IN ('high','medium','low')),
  next_steps_agreed BOOLEAN,
  action_items_count INT,
  action_items JSONB DEFAULT '[]',

  -- ── BUYER SIGNALS ─── Winning Path, Stage Progression, ICP ───────────
  buyer_signals JSONB DEFAULT '[]',
  buyer_verbalized_use_case BOOLEAN,
  buyer_verbalized_success_metric BOOLEAN,
  decision_criteria_discussed BOOLEAN,
  technical_depth TEXT CHECK (technical_depth IN ('none','surface','deep')),
  executive_present BOOLEAN,
  champion_language BOOLEAN,
  buyer_asked_about_pricing BOOLEAN,
  buyer_referenced_internal_discussions BOOLEAN,

  -- ── COMPETITION ─── Competition skill, Monte Carlo ────────────────────
  competitor_mentions JSONB DEFAULT '[]',
  competitor_count INT DEFAULT 0,
  competitive_intensity TEXT CHECK (
    competitive_intensity IN ('none','light','heavy')),
  pricing_discussed BOOLEAN,
  alternatives_mentioned BOOLEAN,

  -- ── OBJECTIONS ─── Objection Tracker, Deal Hygiene, Coaching ─────────
  objections_raised JSONB DEFAULT '[]',
  objection_count INT DEFAULT 0,
  unresolved_objection_count INT DEFAULT 0,
  blocking_objection_present BOOLEAN,

  -- ── SENTIMENT ─── Lead Scoring, Monte Carlo, Relationship Health ──────
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  sentiment_vs_prior TEXT CHECK (
    sentiment_vs_prior IN ('improving','stable','declining')),
  buyer_engagement_quality TEXT CHECK (
    buyer_engagement_quality IN ('high','medium','low')),

  -- ── RELATIONSHIP ─── Relationship Health, Winning Path ───────────────
  champion_present BOOLEAN,
  champion_email TEXT,
  new_stakeholder_introduced BOOLEAN,
  executive_sponsor_language BOOLEAN,
  stakeholder_count_on_call INT,

  -- ── METHODOLOGY ─── Coaching, Rep Scorecard ───────────────────────────
  -- Only populated if workspace has methodology configured
  methodology_framework TEXT,  -- which framework was scored
  methodology_coverage JSONB DEFAULT '[]',
  -- [{dimension_id, dimension_label, covered: boolean,
  --   confidence: 'high'|'medium'|'low', evidence_phrases: [string]}]
  methodology_score NUMERIC(5,2),  -- 0-100, % of dimensions covered
  methodology_gaps JSONB DEFAULT '[]',
  -- [{dimension_id, dimension_label, gap_description}]

  -- ── STAGE CONTEXT ─── Stage Progression (written by reconciliation) ───
  stage_name TEXT,
  stage_entered_at TIMESTAMPTZ,
  transition_type TEXT CHECK (
    transition_type IN ('progressor','staller','pending')),
  days_into_stage_at_call INT,

  -- ── META ──────────────────────────────────────────────────────────────
  deepseek_model_used TEXT,
  enrichment_duration_ms INT,
  transcript_chars_processed INT,
  confidence_overall TEXT CHECK (
    confidence_overall IN ('high','medium','low')),
  gong_native_metrics JSONB,
  -- {talk_ratio, interactivity, question_count, longest_monologue_seconds}
  -- from source_data when source = 'gong' — no re-computation needed

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(conversation_id, enrichment_version)
);

-- Optimized for per-skill query patterns
CREATE INDEX idx_ce_workspace_deal
  ON conversation_enrichments(workspace_id, deal_id);
CREATE INDEX idx_ce_stage_transition
  ON conversation_enrichments(workspace_id, stage_name, transition_type)
  WHERE transition_type IN ('progressor','staller');
CREATE INDEX idx_ce_competitor
  ON conversation_enrichments(workspace_id, competitor_count)
  WHERE competitor_count > 0;
CREATE INDEX idx_ce_champion
  ON conversation_enrichments(workspace_id, champion_language)
  WHERE champion_language = true;
CREATE INDEX idx_ce_blocking_objection
  ON conversation_enrichments(workspace_id, blocking_objection_present)
  WHERE blocking_objection_present = true;
CREATE INDEX idx_ce_methodology
  ON conversation_enrichments(workspace_id, methodology_framework)
  WHERE methodology_framework IS NOT NULL;
CREATE INDEX idx_ce_enriched_at
  ON conversation_enrichments(workspace_id, enriched_at DESC);
```

---

## Part 4: Unified DeepSeek enrichment prompt

The prompt is assembled dynamically per workspace. The methodology
section is conditionally appended based on workspace config.

```typescript
function buildEnrichmentPrompt(
  excerpt: string,
  participantContext: string,
  durationMinutes: number,
  methodology: MethodologyFramework | null
): string {

  const base = `
Classify this sales call transcript across six dimensions.
Return only valid JSON. No preamble.

Transcript (max 800 chars): ${excerpt}
Participants: ${participantContext}
Duration: ${durationMinutes} minutes

{
  "call_quality": {
    "is_substantive": boolean,
    "customer_talk_pct_estimate": number,
    "rep_talk_pct_estimate": number,
    "longest_rep_monologue": "short|medium|long",
    "questions_asked_by_rep": number,
    "call_energy": "high|medium|low",
    "next_steps_agreed": boolean,
    "action_items": [{"owner": "customer|rep|unclear", "description": string}]
  },
  "buyer_signals": {
    "signals": [{"signal_type": string, "description": string,
                 "confidence": "high|medium|low"}],
    "verbalized_use_case": boolean,
    "verbalized_success_metric": boolean,
    "decision_criteria_discussed": boolean,
    "technical_depth": "none|surface|deep",
    "executive_present": boolean,
    "champion_language": boolean,
    "asked_about_pricing": boolean,
    "referenced_internal_discussions": boolean
  },
  "competition": {
    "mentions": [{"name": string, "context": string,
                  "sentiment": "positive|negative|neutral"}],
    "pricing_discussed": boolean,
    "alternatives_mentioned": boolean
  },
  "objections": {
    "raised": [{"type": string, "description": string, "resolved": boolean}],
    "blocking_objection_present": boolean
  },
  "sentiment": {
    "overall": "positive|neutral|negative",
    "buyer_engagement_quality": "high|medium|low"
  },
  "relationship": {
    "champion_signals_present": boolean,
    "champion_indicator_phrases": [string],
    "new_stakeholder_introduced": boolean,
    "executive_sponsor_language": boolean,
    "stakeholder_count_estimate": number
  }
  ${methodology ? `,"methodology": ${buildMethodologyPromptSection(methodology)}` : ''}
}`;

  return base;
}

function buildMethodologyPromptSection(
  framework: MethodologyFramework
): string {
  // Dynamically builds the methodology scoring section
  // from the framework's dimensions and signals

  const dimensionSchema = framework.dimensions.map(d => `{
    "dimension_id": "${d.id}",
    "dimension_label": "${d.label}",
    "covered": boolean,       // true if positive signals clearly present
    "confidence": "high|medium|low",
    "evidence_phrases": [string],  // 0-2 phrases from transcript
    "gap_description": string | null  // if not covered, what's missing
    // Positive signals to look for: ${d.positive_signals.slice(0,2).join('; ')}
    // Negative signals: ${d.negative_signals.slice(0,1).join('; ')}
  }`).join(',\n  ');

  return `{
  "framework": "${framework.id}",
  "dimensions": [
    ${dimensionSchema}
  ]
}`;
}
```

---

## Part 5: Weekly enrichment job

Create `server/jobs/conversation-enrichment-job.ts`.

Register in the scheduler alongside existing cron jobs. Run Sunday
23:00 UTC — before Monday 8 AM skill runs.

```typescript
export async function runConversationEnrichmentJob(
  workspaceId: string,
  db: DatabaseClient
): Promise<EnrichmentJobResult> {

  // 1. Find conversations needing enrichment
  //    - deal_id IS NOT NULL
  //    - is_internal = false (or NULL)
  //    - NOT already in conversation_enrichments with current version
  //    - started_at within last 8 days (7 days + 1 day buffer for late sync)
  //    - transcript_text IS NOT NULL AND LENGTH > 200
  //    ORDER BY started_at DESC

  // 2. Load workspace methodology config
  //    const framework = await getWorkspaceMethodology(workspaceId, db);
  //    null if not configured

  // 3. For each conversation:
  //    a. Read Gong native metrics from source_data if available
  //       (talk_ratio, interactivity, question_count, longest_monologue)
  //    b. Extract customer turns (reuse extractCustomerTurns() from
  //       behavioral-milestones.ts)
  //    c. Build participant context string from participants JSONB
  //       "VP Sales (customer), AE (internal), Solutions Engineer (internal)"
  //    d. Build enrichment prompt (with or without methodology section)
  //    e. Call DeepSeek
  //    f. Parse response, map to conversation_enrichments columns
  //    g. Upsert into conversation_enrichments
  //    h. If deal has stage history, resolve stage_tagged_conversations
  //       pending tags (reuse stage reconciliation logic)

  // 4. Log results:
  //    "Enrichment job: X conversations processed, Y failed,
  //     Z methodology scores written (framework: meddpicc)"

  // 5. Return summary for monitoring

  // Token budget: max 1500 tokens per conversation (prompt + response)
  // For 40 conversations: 60K tokens total at DeepSeek pricing
  // Rate: process sequentially with 200ms delay between calls
}
```

---

## Part 6: Updated skill query layer

Each skill that previously touched `transcript_text` now reads from
`conversation_enrichments`. Add these query helpers to
`server/analysis/enrichment-queries.ts` (new file):

```typescript
// Winning Path + Stage Progression
export async function getBuyerSignalsForDeals(
  workspaceId: string, dealIds: string[], db: DatabaseClient
): Promise<Map<string, ConversationEnrichment[]>>

// Competition skill
export async function getCompetitorMentionsByDeal(
  workspaceId: string, dealIds: string[], db: DatabaseClient
): Promise<Map<string, CompetitorMention[]>>

// Deal Hygiene
export async function getEngagementQualityByDeal(
  workspaceId: string, dealIds: string[], db: DatabaseClient
): Promise<Map<string, EngagementSummary>>

// Coaching / Rep Scorecard
export async function getMethodologyCoverageByRep(
  workspaceId: string,
  repEmail: string,
  periodStart: Date,
  periodEnd: Date,
  db: DatabaseClient
): Promise<MethodologyCoverageSummary>

// Monte Carlo risk multipliers
export async function getConversationRiskSignals(
  workspaceId: string, dealIds: string[], db: DatabaseClient
): Promise<Map<string, { championPresent: boolean; competitorHeavy: boolean; blockingObjection: boolean }>>

// Lead Scoring
export async function getChampionAndSentimentSignals(
  workspaceId: string, dealIds: string[], db: DatabaseClient
): Promise<Map<string, { championLanguage: boolean; sentimentVsPrior: string; noCallsInStage: boolean }>>
```

---

## Part 7: Coaching skill stub

The methodology coverage data enables a Coaching skill that doesn't
exist yet. Add a stub skill registration so the infrastructure is wired
even before the skill is fully built:

```typescript
// server/skills/library/coaching.ts (stub)
{
  id: 'coaching',
  name: 'Coaching Intelligence',
  category: 'intelligence',
  description: 'Methodology adherence and conversation quality by rep — sourced from conversation_enrichments',
  schedule: { cron: '0 5 1 1,4,7,10 *', trigger: 'on_demand' }, // quarterly
  output: ['slack', 'json'],
  version: '0.1.0',
  status: 'stub', // renders "Coming soon" in the UI, doesn't execute
}
```

The stub means when the Coaching page is built, it can call
`/skills/coaching/latest` and get a graceful "not yet run" empty state
rather than a 404.

---

## Acceptance criteria

- [ ] All 10 methodology frameworks defined in
      `server/config/methodology-frameworks.ts` with dimensions,
      signals, and CRM field hints
- [ ] `detectMethodologyFromEvidence()` correctly identifies MEDDPICC
      for Imubit (Salesforce — likely has meddpicc-named fields),
      returns null for workspaces with no methodology signals
- [ ] Migration runs cleanly — all columns, constraints, and indexes
      created without error
- [ ] Weekly enrichment job processes conversations with `deal_id IS
      NOT NULL` and `is_internal = false` only — no patient/clinical
      calls (Frontera lesson)
- [ ] Gong native metrics (`talk_ratio`, `question_count`) read from
      `source_data` JSONB directly — not recomputed from transcript
- [ ] Methodology section in DeepSeek prompt is conditionally included
      — absent for workspaces with no methodology configured
- [ ] When methodology IS configured, `methodology_coverage` JSONB
      contains one entry per framework dimension with `covered` boolean
      and `evidence_phrases`
- [ ] `enrichment-queries.ts` helper functions return correct data
      shapes for each skill
- [ ] Existing skills (Competition, Deal Hygiene, Lead Scoring) updated
      to read from `conversation_enrichments` instead of joining to
      `conversations.transcript_text` directly
- [ ] Coaching skill stub registered — returns empty state gracefully
- [ ] Weekly job registered in scheduler at Sunday 23:00 UTC
- [ ] Job logs: conversations processed, failed, methodology scores
      written, framework used
- [ ] No TypeScript errors
- [ ] `created_at` used throughout — not `created_date`

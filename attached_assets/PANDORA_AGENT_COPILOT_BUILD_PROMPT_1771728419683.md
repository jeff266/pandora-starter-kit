# Agent Builder Copilot — Build Prompt

## Context

The Agent Builder currently requires users to manually configure fields: name, role, audience, focus questions, skills, schedule, delivery channels, and data window. Most users don't know which skills to pick or how to phrase focus questions — they just know what they care about.

The Copilot is a multi-turn chatbot that guides users through agent creation conversationally. Each step presents quick-select options AND an open text field, so users can pick a preset or describe what they want in their own words. The copilot interprets free-text answers and maps them to valid agent config fields.

The end result is a fully populated agent config that the user reviews and confirms before saving.

---

## Step 0: Reconnaissance

```bash
# 1. Find the Agent Builder page component
grep -rn "AgentBuilder\|agent-builder\|CreateAgent" client/src/ --include="*.tsx" -l

# 2. Check the agent creation form fields
grep -rn "role\|audience\|focus_questions\|skills\|schedule\|delivery" client/src/pages/Agent*.tsx | head -20

# 3. Check the agent creation API payload shape
grep -rn "POST.*agent\|createAgent\|agents" server/routes/ --include="*.ts" | head -10

# 4. Find agent templates (the copilot should know about these)
psql "$DATABASE_URL" -c "SELECT id, name, category, description FROM agent_templates WHERE is_system = true;"

# 5. Find all available skills
psql "$DATABASE_URL" -c "SELECT id, name, description FROM skills WHERE enabled = true ORDER BY name;"

# 6. Check what schedule options exist
grep -rn "schedule\|cron\|frequency\|cadence" client/src/ --include="*.tsx" | grep -i agent | head -10

# 7. Check existing UI component library usage (shadcn, etc.)
grep -rn "from.*@/components/ui\|from.*shadcn" client/src/pages/Agent*.tsx | head -10
```

---

## Architecture

### Conversation Flow

The copilot runs as a chat panel alongside (or replacing) the manual form. It walks through 5-7 steps, collecting one config field per step. Each step has:

1. A **bot message** with context and a question
2. **Quick-select buttons** for common answers
3. An **open text input** for custom answers
4. A **skip** option for optional fields

The copilot uses a lightweight Claude call ONLY when the user types free text (not when they click a preset button). Button clicks map directly to config values with zero LLM cost.

### State Machine

```typescript
type CopilotStep = 
  | 'welcome'          // "What kind of briefing do you want?"
  | 'audience'          // "Who is this for?"
  | 'focus'             // "What questions should it answer?"
  | 'skills'            // "What data should it analyze?" (auto-suggested based on earlier answers)
  | 'schedule'          // "When should it run?"
  | 'delivery'          // "Where should it be delivered?"
  | 'review'            // "Here's your agent — look good?"
  | 'done';             // Agent created

interface CopilotState {
  step: CopilotStep;
  messages: ChatMessage[];
  draft_config: Partial<AgentConfig>;
  workspace_context: {
    available_skills: Skill[];
    templates: AgentTemplate[];
    crm_type: string;
    has_slack: boolean;
    has_conversation_intel: boolean;
  };
}

interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
  options?: QuickOption[];       // Quick-select buttons shown with this message
  selected_option?: string;      // Which option the user picked (if any)
}

interface QuickOption {
  label: string;                 // Display text
  value: string;                 // Machine-readable value
  description?: string;          // Optional subtitle
  icon?: string;                 // Optional emoji
}
```

---

## Step-by-Step Conversation Design

### Step 1: Welcome — "What do you want?"

**Bot message:**
> "I'll help you build an agent. What kind of briefing are you looking for?"

**Quick options:**
- 📊 "Pipeline review" → maps to Monday Pipeline template
- 🎯 "Deal risk alerts" → maps to pipeline-hygiene + single-thread skills
- 📈 "Forecast check" → maps to forecast-rollup template  
- 🔍 "Data quality audit" → maps to data-quality-audit skill
- 🏆 "Lead scoring digest" → maps to lead-scoring skill
- ✏️ *Open text field* — "Describe what you need..."

**If user clicks a preset:**
- Pre-fill `draft_config` from the matching template
- Skip to Step 5 (schedule) since template covers audience/focus/skills
- Bot says: "Got it — I'll use the [Template Name] setup. It covers [brief description]. Let's set the schedule."

**If user types free text:**
- Send to Claude for interpretation (see Part 2 below)
- Extract intent, map to closest template or skill combination
- Continue through remaining steps to fill gaps

---

### Step 2: Audience — "Who is this for?"

**Bot message:**
> "Who will be reading this briefing?"

**Quick options:**
- 👔 "VP/CRO" → `{ role: 'VP Sales', detail_preference: 'executive' }`
- 📋 "Sales Manager" → `{ role: 'Sales Manager', detail_preference: 'manager' }`
- ⚙️ "RevOps/Ops" → `{ role: 'RevOps Manager', detail_preference: 'analyst' }`
- 🏢 "CEO/Founder" → `{ role: 'CEO', detail_preference: 'executive' }`
- ✏️ *Open text field*

**If user types:** "My CRO, she only cares about deals over $100K and forecast accuracy"
- Claude extracts: `{ role: 'CRO', detail_preference: 'executive' }` 
- Adds context to focus questions: deal size filter, forecast emphasis
- Bot confirms: "Got it — executive-level for your CRO, focused on large deals and forecast accuracy."

---

### Step 3: Focus — "What should it answer?"

**Bot message:**
> "What questions should this briefing answer each time it runs? Pick a few or write your own."

**Quick options (multi-select + text):**
- "Which deals are most at risk?"
- "Is pipeline coverage on track?"
- "Are there stalled deals that need attention?"
- "How accurate is the current forecast?"
- "Which reps need coaching?"
- "Any new high-fit accounts?"
- ✏️ *Open text field* — "Add your own question..."

**Allow multiple selections.** Each click adds to a list. Open text appends to the same list.

**If user types:** "I want to know if any deals slipped stage this week and if reps are updating their close dates"
- Parse into two focus questions:
  1. "Which deals regressed in pipeline stage this week?"
  2. "Are reps keeping close dates current?"
- Bot shows both, asks: "I added these two questions. Want to add more or move on?"

---

### Step 4: Skills — "What data should it analyze?"

**Bot message:**
> "Based on what you've told me, here's what I'd include:"

Show auto-suggested skills based on earlier answers, with toggles:

- ✅ Pipeline Hygiene *(suggested because: deal risk + stale deal questions)*
- ✅ Single-Thread Alert *(suggested because: deal risk)*
- ✅ Pipeline Coverage *(suggested because: coverage question)*
- ⬜ Forecast Roll-up *(available — toggle on if needed)*
- ⬜ Lead Scoring *(available — toggle on if needed)*
- ⬜ Conversation Intelligence *(available — requires Gong/Fireflies)*

**The copilot auto-selects skills based on focus questions.** The mapping:

```typescript
const QUESTION_TO_SKILL_MAP: Record<string, string[]> = {
  'risk': ['pipeline-hygiene', 'single-thread-alert'],
  'stale': ['pipeline-hygiene'],
  'coverage': ['pipeline-coverage'],
  'forecast': ['forecast-rollup'],
  'rep': ['pipeline-coverage', 'rep-scorecard'],
  'lead': ['lead-scoring'],
  'icp': ['icp-discovery', 'lead-scoring'],
  'data quality': ['data-quality-audit'],
  'coaching': ['conversation-intelligence', 'rep-scorecard'],
  'slipped': ['pipeline-hygiene', 'deal-stage-history'],
  'close date': ['pipeline-hygiene'],
  'single thread': ['single-thread-alert'],
  'multi-thread': ['single-thread-alert'],
  'conversation': ['conversation-intelligence'],
};

// Match focus question keywords to skills
function suggestSkills(focusQuestions: string[]): string[] {
  const suggested = new Set<string>();
  for (const q of focusQuestions) {
    const lower = q.toLowerCase();
    for (const [keyword, skills] of Object.entries(QUESTION_TO_SKILL_MAP)) {
      if (lower.includes(keyword)) {
        skills.forEach(s => suggested.add(s));
      }
    }
  }
  return [...suggested];
}
```

User can toggle skills on/off. No free text needed here — it's a selection UI.

---

### Step 5: Schedule — "When should it run?"

**Bot message:**
> "When do you want this delivered?"

**Quick options:**
- 🌅 "Every Monday at 8 AM" → `{ frequency: 'weekly', day: 'monday', time: '08:00' }`
- 📅 "Every weekday morning" → `{ frequency: 'daily', days: ['mon','tue','wed','thu','fri'], time: '08:00' }`
- 🕐 "Twice a week (Mon + Thu)" → `{ frequency: 'weekly', days: ['monday','thursday'], time: '08:00' }`
- 🔔 "Only when I trigger it manually" → `{ frequency: 'manual' }`
- ✏️ *Open text field*

**If user types:** "Tuesday and Friday before our 9am standup"
- Parse: `{ frequency: 'weekly', days: ['tuesday', 'friday'], time: '08:30' }` (30 min before standup)
- Bot confirms: "I'll schedule it for Tuesdays and Fridays at 8:30 AM so it's ready before your 9 AM standup."

---

### Step 6: Delivery — "Where should it go?"

**Bot message:**
> "Where do you want to receive the briefing?"

**Quick options:**
- 💬 "Slack channel" → show channel picker or text input for channel name
- 📱 "In Pandora (view in app)" → `output_formats: ['in_app']`
- 📧 "Email" → `output_formats: ['email']`  
- 📋 "Slack + In App" → `output_formats: ['slack', 'in_app']`
- ✏️ *Open text field*

**If user types:** "Post it to #sales-leadership and also keep it in the app"
- Parse: `{ output_formats: ['slack', 'in_app'], slack_channel: '#sales-leadership' }`
- Bot confirms: "Will post to #sales-leadership and keep a copy in Pandora."

---

### Step 7: Review — "Here's your agent"

**Bot message:**
> "Here's what I've built. Review and confirm:"

Display a formatted summary card:

```
┌─────────────────────────────────────────────┐
│  📊 Monday Pipeline Review                  │
│                                             │
│  Audience:  CRO (executive level)           │
│  Focus:     3 questions                     │
│    • Which deals are most at risk?          │
│    • Is pipeline coverage on track?         │
│    • Any deals that slipped stage?          │
│  Skills:    Pipeline Hygiene, Single-Thread, │
│             Pipeline Coverage               │
│  Schedule:  Tue & Fri at 8:30 AM            │
│  Delivery:  #sales-leadership + In App      │
└─────────────────────────────────────────────┘
```

**Options:**
- ✅ "Create Agent" → POST to agent creation API
- ✏️ "Edit something" → bot asks "What would you like to change?" (free text, maps back to relevant step)
- 🔄 "Start over" → reset state

---

## Part 2: LLM Interpretation for Free Text

Only called when the user types free text (not when clicking presets). Keep it cheap.

**File:** `server/copilot/agent-copilot-interpreter.ts`

```typescript
interface InterpretRequest {
  step: CopilotStep;
  user_input: string;
  current_draft: Partial<AgentConfig>;
  workspace_context: {
    available_skills: string[];
    crm_type: string;
    has_conversation_intel: boolean;
  };
}

interface InterpretResponse {
  // Fields to update in draft_config
  updates: Partial<AgentConfig>;
  // Confirmation message to show user
  confirmation: string;
  // If the input covered multiple steps, which steps to skip
  steps_covered: CopilotStep[];
}

async function interpretFreeText(req: InterpretRequest): Promise<InterpretResponse> {
  const prompt = `You are the Pandora agent builder copilot. The user is on step "${req.step}" of creating an agent.

Their input: "${req.user_input}"

Current draft config: ${JSON.stringify(req.current_draft)}

Available skills: ${req.workspace_context.available_skills.join(', ')}
CRM type: ${req.workspace_context.crm_type}
Has conversation intelligence: ${req.workspace_context.has_conversation_intel}

Extract structured config from the user's input. Return JSON only:
{
  "updates": {
    // Only include fields that the user's input addresses
    "name": "string or null",
    "audience": { "role": "string", "detail_preference": "executive|manager|analyst" },
    "focus_questions": ["array of questions"],
    "suggested_skills": ["skill-id-1", "skill-id-2"],
    "schedule": { "frequency": "daily|weekly|manual", "days": [], "time": "HH:MM" },
    "output_formats": ["in_app", "slack", "email"],
    "slack_channel": "#channel-name or null"
  },
  "confirmation": "Brief sentence confirming what you understood",
  "steps_covered": ["audience", "focus"]  // steps the input addressed
}

Rules:
- Only include fields the user actually mentioned
- If the input is ambiguous, make your best guess and note it in confirmation
- Map informal language to formal config (e.g., "my boss" → executive audience)
- If the user describes a complete agent in one sentence, fill everything you can
- Keep confirmation under 30 words`;

  const response = await callLLM({
    model: 'deepseek',    // Cheap model for structured extraction
    prompt,
    max_tokens: 500,
    temperature: 0,
  });

  return JSON.parse(response);
}
```

**Token budget:** ~800 tokens per free-text interpretation. If the user clicks presets for every step, zero LLM cost. Typical conversation: 1-2 free-text inputs = ~1,600 tokens total (~$0.002).

**Use DeepSeek for interpretation** — this is structured extraction, not creative synthesis. Save Claude tokens for the editorial generation itself.

---

## Part 3: Frontend Component

### Layout

The copilot replaces (or sits alongside) the manual form on the Agent Builder page. Two possible layouts:

**Option A: Chat replaces form (recommended for v1)**
- Full-width chat interface on the agent creation page
- Form fields are hidden until review step, then shown as an editable summary
- "Switch to manual mode" link at bottom for power users

**Option B: Side-by-side**
- Chat panel on left (60%), live form preview on right (40%)
- Form updates in real-time as chat progresses
- Either side is editable

Start with Option A — simpler, and the review step gives users the manual editing escape hatch.

### Component Structure

```
AgentCopilot/
├── AgentCopilot.tsx          // Main container, state machine
├── CopilotMessage.tsx        // Single message bubble (bot or user)
├── QuickOptions.tsx          // Clickable option buttons
├── CopilotInput.tsx          // Text input + send button
├── AgentReviewCard.tsx       // Summary card at review step
└── copilot-steps.ts          // Step definitions, options, prompts
```

### Key Component: AgentCopilot.tsx

```tsx
export function AgentCopilot({ workspaceId, onAgentCreated }: Props) {
  const [state, setState] = useState<CopilotState>({
    step: 'welcome',
    messages: [WELCOME_MESSAGE],
    draft_config: {},
    workspace_context: null,
  });
  
  const [inputText, setInputText] = useState('');
  const [isInterpreting, setIsInterpreting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Load workspace context on mount
  useEffect(() => {
    loadWorkspaceContext(workspaceId).then(ctx => {
      setState(prev => ({ ...prev, workspace_context: ctx }));
    });
  }, [workspaceId]);
  
  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);
  
  async function handleOptionClick(option: QuickOption) {
    // Add user message
    addMessage({ role: 'user', content: option.label, selected_option: option.value });
    
    // Apply preset value directly (no LLM needed)
    const updates = getPresetUpdates(state.step, option.value);
    applyUpdates(updates);
    
    // Advance to next step
    advanceStep();
  }
  
  async function handleFreeText() {
    if (!inputText.trim()) return;
    
    addMessage({ role: 'user', content: inputText });
    setInputText('');
    setIsInterpreting(true);
    
    try {
      // Call LLM interpreter
      const result = await fetch(`/api/workspaces/${workspaceId}/copilot/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: state.step,
          user_input: inputText,
          current_draft: state.draft_config,
        }),
      }).then(r => r.json());
      
      // Apply interpreted updates
      applyUpdates(result.updates);
      
      // Show confirmation
      addMessage({ role: 'assistant', content: result.confirmation });
      
      // Skip steps that were covered by free text
      advanceStep(result.steps_covered);
    } catch (err) {
      addMessage({ 
        role: 'assistant', 
        content: "I didn't quite catch that. Could you rephrase, or pick one of the options above?" 
      });
    } finally {
      setIsInterpreting(false);
    }
  }
  
  async function handleCreateAgent() {
    const agentConfig = finalizeConfig(state.draft_config);
    
    const res = await fetch(`/api/workspaces/${workspaceId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentConfig),
    });
    
    if (res.ok) {
      const agent = await res.json();
      addMessage({ role: 'assistant', content: `Agent created! You can find it in your Agents list.` });
      setState(prev => ({ ...prev, step: 'done' }));
      onAgentCreated?.(agent);
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {state.messages.map((msg, i) => (
          <CopilotMessage key={i} message={msg} />
        ))}
        
        {/* Quick options for current step */}
        {state.step !== 'done' && state.step !== 'review' && (
          <QuickOptions 
            options={getStepOptions(state.step)} 
            onSelect={handleOptionClick} 
          />
        )}
        
        {/* Review card */}
        {state.step === 'review' && (
          <AgentReviewCard 
            config={state.draft_config}
            onConfirm={handleCreateAgent}
            onEdit={() => { /* re-enter chat at relevant step */ }}
            onStartOver={() => resetState()}
          />
        )}
        
        {isInterpreting && (
          <div className="text-sm text-muted-foreground animate-pulse">Thinking...</div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input area */}
      {state.step !== 'done' && state.step !== 'review' && (
        <CopilotInput
          value={inputText}
          onChange={setInputText}
          onSubmit={handleFreeText}
          placeholder={getStepPlaceholder(state.step)}
          disabled={isInterpreting}
        />
      )}
    </div>
  );
}
```

### Quick Options Component

```tsx
function QuickOptions({ options, onSelect }: { options: QuickOption[], onSelect: (o: QuickOption) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onSelect(option)}
          className="px-3 py-2 text-sm border rounded-lg hover:bg-muted transition-colors text-left"
        >
          {option.icon && <span className="mr-1">{option.icon}</span>}
          <span className="font-medium">{option.label}</span>
          {option.description && (
            <span className="block text-xs text-muted-foreground">{option.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

---

## Part 4: Server Endpoint

```typescript
// POST /api/workspaces/:workspaceId/copilot/interpret
router.post('/api/workspaces/:workspaceId/copilot/interpret', async (req, res) => {
  const { workspaceId } = req.params;
  const { step, user_input, current_draft } = req.body;
  
  // Load workspace context
  const skills = await db.query('SELECT id, name FROM skills WHERE enabled = true');
  const workspace = await db.query('SELECT crm_type FROM workspaces WHERE id = $1', [workspaceId]);
  const hasConvoIntel = await db.query(
    "SELECT 1 FROM workspace_connectors WHERE workspace_id = $1 AND connector_type IN ('gong', 'fireflies') AND status = 'active' LIMIT 1",
    [workspaceId]
  );
  
  const result = await interpretFreeText({
    step,
    user_input,
    current_draft,
    workspace_context: {
      available_skills: skills.rows.map(s => s.id),
      crm_type: workspace.rows[0]?.crm_type || 'unknown',
      has_conversation_intel: hasConvoIntel.rows.length > 0,
    },
  });
  
  res.json(result);
});
```

---

## Part 5: Entry Point

Add the copilot as the default experience when creating a new agent.

On the Agents list page, the "Create Agent" button opens the copilot view. Add a "Switch to manual mode" link at the top of the copilot for users who prefer the raw form.

```tsx
// In AgentBuilder.tsx or wherever agent creation starts
const [mode, setMode] = useState<'copilot' | 'manual'>('copilot');

return (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h1>Create Agent</h1>
      <button 
        className="text-sm text-muted-foreground underline"
        onClick={() => setMode(mode === 'copilot' ? 'manual' : 'copilot')}
      >
        {mode === 'copilot' ? 'Switch to manual mode' : 'Switch to copilot'}
      </button>
    </div>
    
    {mode === 'copilot' 
      ? <AgentCopilot workspaceId={workspaceId} onAgentCreated={handleCreated} />
      : <ManualAgentForm workspaceId={workspaceId} onCreated={handleCreated} />
    }
  </div>
);
```

---

## Verification

After implementation:

- [ ] Clicking "Create Agent" opens copilot by default
- [ ] Each step shows quick-select options AND a text input
- [ ] Clicking a preset advances immediately with no LLM call
- [ ] Typing free text calls the interpreter and shows a confirmation
- [ ] Typing a complete description ("I want a Monday morning pipeline review for my VP Sales posted to #sales") covers multiple steps at once
- [ ] Review card shows all configured fields accurately
- [ ] "Create Agent" at review step creates the agent via API
- [ ] "Edit something" at review returns to the relevant step
- [ ] "Switch to manual mode" shows the raw form
- [ ] Copilot works with zero LLM calls if user only clicks presets

## DO NOT:
- Call the LLM when the user clicks a preset button — presets map directly to config values
- Use Claude for interpretation — use DeepSeek (cheap structured extraction)
- Make the copilot blocking — if interpretation fails, fall back to "pick an option or rephrase"
- Store conversation history in the database — it's ephemeral, lives in React state only
- Skip the review step — always show what was configured before creating

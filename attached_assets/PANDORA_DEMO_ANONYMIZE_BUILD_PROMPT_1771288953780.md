# Pandora Demo Mode — Anonymize Build Prompt

## For: Replit
## Effort: 3-4 hours
## Depends on: Existing Command Center, Actions, Playbooks, Connector Health pages

---

## Purpose

Jeff uses Pandora to manage real clients. He posts about it on LinkedIn (22K followers) but cannot show real client names, deal names, rep names, or dollar amounts — that violates client contracts. Demo Mode is a frontend toggle that replaces all real data with realistic fakes, making every screenshot shareable.

This is NOT a separate demo environment. It's a real-time filter layer on top of live data. The actual data flows normally — Demo Mode just anonymizes the display.

---

## Task 1: Anonymization Engine

Create `client/src/lib/anonymize.ts` (or equivalent path).

The anonymizer maintains a **deterministic mapping** per session so "Acme Corp" always becomes the same fake name within a session (consistency across pages), but different fake names across sessions (so screenshots don't all show the same fakes).

```typescript
// Pseudocode — adapt to your project patterns

// Seed-based deterministic randomness
class Anonymizer {
  private mappings: Map<string, string> = new Map();
  private seed: number;

  constructor() {
    // New seed each browser session
    this.seed = Date.now();
  }

  // Deterministic pick from array based on input string
  private pick(input: string, options: string[]): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    hash = (hash + this.seed) | 0;
    return options[Math.abs(hash) % options.length];
  }

  anonymizeCompany(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`co:${real}`)) return this.mappings.get(`co:${real}`)!;
    const fake = this.pick(real, FAKE_COMPANIES);
    this.mappings.set(`co:${real}`, fake);
    return fake;
  }

  anonymizePerson(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`pn:${real}`)) return this.mappings.get(`pn:${real}`)!;
    const firstName = this.pick(real + 'f', FAKE_FIRST_NAMES);
    const lastName = this.pick(real + 'l', FAKE_LAST_NAMES);
    const fake = `${firstName} ${lastName}`;
    this.mappings.set(`pn:${real}`, fake);
    return fake;
  }

  anonymizeEmail(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`em:${real}`)) return this.mappings.get(`em:${real}`)!;
    const [, domain] = real.split('@');
    const company = this.anonymizeCompany(domain?.split('.')[0] || 'company');
    const person = this.anonymizePerson(real.split('@')[0]);
    const fake = `${person.split(' ')[0].toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '')}.com`;
    this.mappings.set(`em:${real}`, fake);
    return fake;
  }

  anonymizeDeal(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`dl:${real}`)) return this.mappings.get(`dl:${real}`)!;
    // Extract company name if deal contains one, anonymize it
    // Then append a deal suffix
    const suffix = this.pick(real, DEAL_SUFFIXES);
    // Try to find a company name in the deal name
    const fake = `${this.pick(real, FAKE_COMPANIES)} — ${suffix}`;
    this.mappings.set(`dl:${real}`, fake);
    return fake;
  }

  anonymizeAmount(real: number): number {
    if (!real && real !== 0) return real;
    // Preserve order of magnitude but shift the value
    // So $220K becomes something in the $150K-$350K range
    const factor = 0.6 + (Math.abs(this.pick(String(real), ['0','1','2','3','4','5','6','7','8','9']).charCodeAt(0)) % 10) / 10 * 0.8;
    return Math.round(real * factor / 1000) * 1000;
  }

  anonymizeWorkspace(real: string): string {
    if (!real) return real;
    if (this.mappings.has(`ws:${real}`)) return this.mappings.get(`ws:${real}`)!;
    const fake = this.pick(real, FAKE_COMPANIES);
    this.mappings.set(`ws:${real}`, fake);
    return fake;
  }
}

// --- Fake Data Pools ---

const FAKE_COMPANIES = [
  'Meridian Analytics', 'Vertex Health', 'Lumina Software', 'Forge AI',
  'Catalyst Cloud', 'Beacon Data', 'Prism Robotics', 'Summit Dynamics',
  'Atlas Platform', 'Helix Systems', 'Nova Therapeutics', 'Orbit Labs',
  'Cascade Networks', 'Pinnacle AI', 'Vanguard Tech', 'Stratos IoT',
  'Ember Solutions', 'Zenith Ops', 'Crestline SaaS', 'Ironwood Digital',
  'Thrive Biotech', 'Horizon Fintech', 'Keystone Logic', 'Northstar DevOps',
  'Cobalt Security', 'Evergreen CRM', 'Redwood Analytics', 'Sterling Health',
  'Quantum Bridge', 'Elevate Partners', 'Apex Consulting', 'Silverline Corp'
];

const FAKE_FIRST_NAMES = [
  'Alex', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Taylor',
  'Drew', 'Jamie', 'Quinn', 'Avery', 'Cameron', 'Reese',
  'Sage', 'Parker', 'Blake', 'Hayden', 'Dakota', 'Rowan',
  'Emery', 'Finley', 'Kendall', 'Skyler', 'Marley', 'Peyton'
];

const FAKE_LAST_NAMES = [
  'Chen', 'Patel', 'Williams', 'Torres', 'Kim', 'Okafor',
  'Nakamura', 'Singh', 'Andersen', 'Ruiz', 'Foster', 'Chang',
  'Mitchell', 'Bergman', 'Novak', 'Reeves', 'Morales', 'Sullivan',
  'Kapoor', 'Lindgren', 'Hoffman', 'Vasquez', 'Oduya', 'Ramirez'
];

const DEAL_SUFFIXES = [
  'Enterprise Expansion', 'Platform Migration', 'Annual Renewal',
  'Pilot Program', 'Team Rollout', 'Security Upgrade',
  'Analytics Suite', 'API Integration', 'Data Migration',
  'Compliance Package', 'Premium Tier', 'Multi-Region Deploy'
];

// Export singleton
export const anonymizer = new Anonymizer();
```

---

## Task 2: React Context Provider

Create a context that wraps the app and provides demo mode state + anonymization functions to all components.

```typescript
// client/src/contexts/DemoModeContext.tsx

const DemoModeContext = createContext<{
  isDemoMode: boolean;
  toggleDemoMode: () => void;
  anon: {
    company: (name: string) => string;
    person: (name: string) => string;
    email: (email: string) => string;
    deal: (name: string) => string;
    amount: (value: number) => number;
    workspace: (name: string) => string;
  };
}>(...);

export function DemoModeProvider({ children }) {
  const [isDemoMode, setIsDemoMode] = useState(() => {
    return localStorage.getItem('pandora_demo_mode') === 'true';
  });

  const toggleDemoMode = () => {
    const next = !isDemoMode;
    setIsDemoMode(next);
    localStorage.setItem('pandora_demo_mode', next ? 'true' : 'false');
    // Reset anonymizer mappings so new session = new fake names
    if (next) anonymizer.reset();
  };

  const anon = isDemoMode ? {
    company: (n: string) => anonymizer.anonymizeCompany(n),
    person: (n: string) => anonymizer.anonymizePerson(n),
    email: (e: string) => anonymizer.anonymizeEmail(e),
    deal: (n: string) => anonymizer.anonymizeDeal(n),
    amount: (v: number) => anonymizer.anonymizeAmount(v),
    workspace: (n: string) => anonymizer.anonymizeWorkspace(n),
  } : {
    // Pass-through when demo mode is off
    company: (n: string) => n,
    person: (n: string) => n,
    email: (e: string) => e,
    deal: (n: string) => n,
    amount: (v: number) => v,
    workspace: (n: string) => n,
  };

  return (
    <DemoModeContext.Provider value={{ isDemoMode, toggleDemoMode, anon }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export const useDemoMode = () => useContext(DemoModeContext);
```

Wrap the app in `DemoModeProvider` at the top level (in App.tsx or wherever the root providers are).

---

## Task 3: Demo Mode Toggle in UI

Add a toggle to the sidebar footer, near the user avatar area:

```
┌──────────────────────┐
│ 👤 Jeff Chen  Admin  │
│                      │
│ 🎭 Demo Mode   [●○] │
└──────────────────────┘
```

When toggled ON:
- Show a small persistent banner at the very top of the page (above the top bar):
  ```
  🎭 Demo Mode — All names and values are anonymized
  ```
  Use a subtle background (e.g., `C.purpleSoft` with `C.purple` text) so it's visible but not distracting. This banner reminds Jeff he's in demo mode so he doesn't forget to turn it off when he's working.

When toggled OFF:
- Banner disappears
- All data shows real values

The toggle should persist across page navigations (stored in localStorage).

---

## Task 4: Apply Anonymization to All Pages

This is the bulk of the work. Every page that displays entity data needs to pass it through the `anon` functions. Use the `useDemoMode()` hook.

### Workspace Selector (sidebar)
```typescript
const { anon } = useDemoMode();
// Where workspace name is displayed:
<span>{anon.workspace(workspace.name)}</span>
```

### Command Center Home
- Headline metrics: `anon.amount()` on pipeline value, weighted pipeline, coverage amounts
- Pipeline chart: stage labels stay real (Discovery, Negotiation, etc.), but deal counts and values go through `anon.amount()`
- Findings feed: each finding card →
  - `anon.deal(finding.deal_name)` on deal names
  - `anon.person(finding.owner)` on rep names
  - `anon.amount(finding.impact_amount)` on dollar amounts
  - `anon.company(finding.account_name)` on account names
- Connector strip: connector type names (HubSpot, Salesforce) stay real. Record counts can stay real (not identifying).

### Deal List / Deal Detail
- `anon.deal(deal.name)` on deal names
- `anon.company(deal.account_name)` on account names
- `anon.person(deal.owner)` on owner names
- `anon.amount(deal.amount)` on deal amounts
- `anon.person(contact.name)` on all contact names
- `anon.email(contact.email)` on emails
- Deal stage names stay real (they're process, not PII)
- Conversation titles: `anon.deal()` or `anon.company()` on any names in the title

### Account List / Account Detail
- `anon.company(account.name)` on account names
- All contacts within: `anon.person()` and `anon.email()`
- Associated deals: `anon.deal()` and `anon.amount()`

### Actions Page
- `anon.deal()` on target deal names
- `anon.person()` on owner names
- `anon.company()` on account names
- `anon.amount()` on impact amounts
- Action title and summary may contain real names inline — apply a `anonymizeText()` function that scans for known entity names and replaces them

### Playbooks Page
- Skill names and schedule info stay real
- Any finding previews: same anonymization as findings feed

### Connector Health
- Connector types stay real. Record counts stay real.
- No entity names shown here, so minimal changes needed.

### Insights Feed
- Same as findings feed anonymization

### Scoped Analysis / "Ask Pandora" Responses
- The narrative text from Claude may contain real names inline
- Apply `anonymizeText()` which scans the response for any mapped entity names and replaces them

### `anonymizeText()` Helper

For narrative blocks that may contain names inline:

```typescript
anonymizeText(text: string): string {
  if (!isDemoMode) return text;
  let result = text;
  // Replace all known real names with their fake equivalents
  for (const [key, fake] of anonymizer.mappings.entries()) {
    const real = key.split(':').slice(1).join(':'); // Remove prefix
    if (real && real.length > 2) {
      result = result.replaceAll(real, fake);
    }
  }
  return result;
}
```

This needs to run AFTER the entity-level anonymization has built up the mapping (so the mappings exist to scan for). The flow is:
1. Page loads data
2. Entity fields get anonymized (building up the mapping)
3. Narrative/text blocks get `anonymizeText()` applied using the now-populated mapping

---

## Task 5: Keep It Invisible to the Backend

Demo Mode is 100% frontend. The backend never knows it's on. No API changes. No query parameters. No server-side logic. All anonymization happens in React components at render time.

This means:
- Searches work normally (searching for "Imubit" still works — results get anonymized on display)
- Filters work normally
- Actions work normally (you can still dismiss/execute actions — the real data flows through)
- The only difference is what's painted on screen

---

## Verification

1. Toggle Demo Mode ON in sidebar
2. Banner appears at top: "🎭 Demo Mode — All names and values are anonymized"
3. Workspace name in sidebar changes to a fake company name
4. Command Center: all deal names, rep names, account names, and dollar amounts are anonymized
5. Navigate to a Deal Detail page: deal name, account, owner, contacts all anonymized. Dollar amounts shifted.
6. Navigate to Actions: same anonymization on all cards
7. Navigate back to Command Center: the SAME deal that was "Meridian Analytics" is still "Meridian Analytics" (deterministic within session)
8. Toggle Demo Mode OFF: all real data reappears instantly
9. Toggle back ON: new fake names (fresh seed)
10. Take a screenshot — no real client data visible anywhere
11. Refresh the page — Demo Mode preference persists (localStorage)

---

## What NOT to Build

- Server-side anonymization (this is purely cosmetic, frontend only)
- Per-entity anonymization overrides (all or nothing)
- Export with anonymized data (future — for now, screenshots are the use case)
- Anonymized Slack messages (Slack is Jeff's private channel, doesn't need it)

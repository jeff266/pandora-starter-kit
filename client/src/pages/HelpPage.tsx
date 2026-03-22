import React, { useState, useMemo } from 'react';
import { colors, fonts } from '../styles/theme';

interface AccordionItem {
  id: string;
  question: string;
  answer: string;
}

interface Category {
  id: string;
  label: string;
  items: AccordionItem[];
}

const faqCategories: Category[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    items: [
      {
        id: 'connect-claude',
        question: 'How do I connect Pandora to Claude Desktop?',
        answer: 'Go to Pandora Settings → Integrations → Claude. Copy the configuration block. Open your Claude Desktop config file at ~/Library/Application Support/Claude/claude_desktop_config.json (Mac) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows). Paste the block inside the mcpServers section. Restart Claude Desktop. The connection activates only after a full restart.',
      },
      {
        id: 'api-key',
        question: 'What is an API key and where do I find mine?',
        answer: 'Your Pandora API key authenticates your workspace when connecting external tools like Claude Desktop. Find it at Settings → Claude → API Key. If none exists, Pandora will generate one automatically when you open that tab. Keep this key private — it grants full read/write access to your workspace data.',
      },
      {
        id: 'ui-vs-claude',
        question: 'Do I need to use the Pandora UI or can I just use Claude?',
        answer: 'You can use either or both. The Pandora UI gives you the full experience: Concierge briefs, the Command Center, Reports, Skills scheduling, and Actions. Claude Desktop with MCP gives you conversational access to the same underlying data and intelligence tools. Many teams use Claude as their daily driver and the Pandora UI for reports and configuration.',
      },
      {
        id: 'plan-required',
        question: 'Which plan do I need to use the MCP tools?',
        answer: 'MCP tool access is available on all paid Pandora plans. The number of tool calls included varies by plan — check Settings → Billing for your current limits. Ask Pandora and the Concierge brief are included on all plans.',
      },
    ],
  },
  {
    id: 'claude',
    label: 'Using Claude with Pandora',
    items: [
      {
        id: 'claude-pipeline',
        question: 'What can I ask Claude about my pipeline?',
        answer: 'Anything you\'d ask a RevOps analyst: pipeline coverage, at-risk deals, forecast rollup, rep performance, deal deliberation, WBR generation, competitive intelligence, coaching insights, and more. Claude pulls live data from your CRM through Pandora tools. You can also ask Claude to save findings, create actions, or add content to your WBR.',
      },
      {
        id: 'claude-crm-data',
        question: 'Does Claude have access to my actual CRM data?',
        answer: 'Yes, through Pandora tools. When you ask Claude a pipeline question, Claude calls Pandora tools that query your connected CRM in real time. Claude never has direct database access — it reads tool outputs that Pandora constructs from your data.',
      },
      {
        id: 'claude-auto-save',
        question: 'Will Claude save my conversations to Pandora?',
        answer: 'Claude automatically saves meaningful findings as Claude Insights (visible in the Command Center under the Claude Insights tab), creates Actions for specific tasks it identifies, and saves deliberation results. You can tell Claude "don\'t save" or "just exploring" to skip auto-save for a specific turn.',
      },
      {
        id: 'stop-auto-save',
        question: 'How do I stop Claude from auto-saving?',
        answer: 'Tell Claude "don\'t save this" or "just exploring" before or during your question. Claude will skip the save_claude_insight and create_action calls for that turn. To disable auto-save globally for a session, say "don\'t auto-save anything this session."',
      },
      {
        id: 'claude-wbr',
        question: 'Can Claude generate a WBR for me?',
        answer: 'Yes. In Claude Desktop, say "Generate a WBR for this week" or "Build the weekly business review." Claude will run the relevant skills, assemble the sections, and save the document to your Pandora Reports page. It will return a summary and a link to the full report.',
      },
      {
        id: 'multiple-users',
        question: 'Can multiple people on my team connect to the same workspace?',
        answer: 'Yes. Each team member generates their own API key (Settings → Integrations → API Key) and uses it in their own Claude Desktop config. All connections point to the same workspace data. If your plan has per-seat limits, each connected Claude Desktop instance counts as a seat.',
      },
    ],
  },
  {
    id: 'ask-pandora',
    label: 'Ask Pandora',
    items: [
      {
        id: 'ask-vs-claude',
        question: 'What\'s the difference between Ask Pandora and just asking Claude?',
        answer: 'Ask Pandora is Pandora\'s native conversational interface — it has full access to your workspace data, runs skills automatically, triggers deliberations, and renders rich response blocks with charts and evidence cards. Claude Desktop via MCP gives you similar intelligence but through a conversational interface without the native rich rendering. Ask Pandora is the higher-fidelity experience; Claude Desktop is more flexible for ad-hoc workflows.',
      },
      {
        id: 'deliberation-modes',
        question: 'What are the deliberation modes and when should I use them?',
        answer: 'Bull/Bear: Two analysts argue opposite positions on a deal or pipeline question — best for investment-style decisions. Red Team: One analyst stress-tests your assumptions — best for forecast review and sanity checks. Boardroom: Three senior advisors debate a strategic question — best for GTM strategy and market entry decisions. Socratic: Structured questioning that surfaces assumptions you haven\'t articulated — best for deal qualification and discovery debrief. Prosecutor/Defense: Adversarial format that stress-tests a decision — best for major commits or walk-away decisions.',
      },
      {
        id: 'chart-in-report',
        question: 'How do I add a chart to my report from Ask Pandora?',
        answer: 'When Ask Pandora returns a response with a chart, click the "Insert" button on the chart block. It will prompt you to select which report section to add it to. The chart is saved as a data snapshot and appears in the selected section of your WBR or QBR.',
      },
      {
        id: 'insert-button',
        question: 'What does "Insert" do on a response block?',
        answer: '"Insert" saves a specific block — a chart, a finding, or a narrative paragraph — to a section of your current report. It\'s how you build a WBR piece by piece from Ask Pandora conversations, rather than generating the whole document at once.',
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      {
        id: 'generate-wbr',
        question: 'How do I generate a WBR?',
        answer: 'Three ways: (1) Reports page → WBR card → click Generate → choose the date range and click Run. (2) Ask Pandora: "Generate a WBR for this week." (3) Claude Desktop: same phrase. The WBR takes 1–3 minutes depending on how many skills need to run. You\'ll see a progress indicator and get a link when it\'s ready.',
      },
      {
        id: 'wbr-skills',
        question: 'What skills feed each section of the WBR?',
        answer: 'Pipeline Health Snapshot: pipeline-hygiene, pipeline-coverage. Forecast Review: forecast-rollup. Deal Velocity Metrics: deal-risk-review, pipeline-waterfall. Rep-Level Performance: rep-scorecard, pipeline-coverage. Lead & Demand Signal: pipeline-coverage. Process & Hygiene Flags: pipeline-hygiene. Key Actions & Owners: narrative synthesis only. What to Watch: deal-risk-review.',
      },
      {
        id: 'empty-section',
        question: 'What happens if a skill hasn\'t run recently?',
        answer: 'The section shows a degraded placeholder explaining which skill needs to run. Go to the Skills page, find the skill in the list, and click Run Now. Once it completes, regenerate the WBR — that section will populate with fresh data.',
      },
      {
        id: 'export-gdocs',
        question: 'How do I export my report to Google Docs?',
        answer: 'Open the WBR or QBR in the Reports page. Click the "Export" button in the top-right corner and select "Google Docs." Pandora will convert the report to DOCX format and push it to your connected Google Drive. The doc appears in the folder you configured during Google Drive setup.',
      },
      {
        id: 'gdocs-feedback',
        question: 'Does Pandora learn from edits I make in Google Docs?',
        answer: 'Yes. Edit the exported Google Doc. Every Sunday evening, Pandora reads the doc back, summarizes what changed compared to the generated version, and injects that context into the following Monday\'s WBR generation. This means feedback you write in the doc — corrections, emphasis changes, things to add — carry forward automatically.',
      },
    ],
  },
  {
    id: 'data-privacy',
    label: 'Data and Privacy',
    items: [
      {
        id: 'anthropic-data',
        question: 'Does Anthropic see my CRM data?',
        answer: 'When using the Pandora UI (Ask Pandora, Concierge): no. The LLM calls are made server-side and responses are returned without Anthropic seeing your raw CRM records. When using Claude Desktop via MCP: tool outputs are included in your Claude conversation context and processed by Anthropic\'s API, subject to Anthropic\'s data handling and privacy policies.',
      },
      {
        id: 'data-stored',
        question: 'Where is my data stored?',
        answer: 'Pandora stores your data in a dedicated PostgreSQL database in your selected region. CRM data is synced and stored encrypted at rest. Conversation history, skill outputs, and report documents are stored in the same environment. Pandora does not sell or share your data with third parties.',
      },
      {
        id: 'without-crm',
        question: 'Can I use Pandora without connecting HubSpot or Salesforce?',
        answer: 'You can access the UI and Ask Pandora, but most intelligence features require CRM data. Skills, the Concierge brief, pipeline health, and deal risk analysis all need deal and contact data. Without a CRM connection you\'ll see "insufficient data" messages across most surfaces.',
      },
      {
        id: 'crm-reads',
        question: 'What does Pandora actually read from my CRM?',
        answer: 'From HubSpot/Salesforce: deals (stage, amount, close date, owner, contacts), contacts (name, role, email, account), accounts (name, industry, ARR), activities (calls, emails, meetings), and custom fields you\'ve mapped. Pandora reads only — it does not write back to your CRM unless you explicitly approve an Action that triggers a CRM update.',
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      {
        id: 'mcp-cost',
        question: 'How am I charged for MCP tool calls?',
        answer: 'MCP tool calls that run skills (run_skill, run_pipeline_hygiene, etc.) consume skill run credits from your plan. Read-only calls (get_pipeline_summary, query_deals, etc.) are typically not metered. Write-back calls (save_claude_insight, create_action, save_to_report) are not metered. Check Settings → Billing → Token Usage for your current consumption.',
      },
      {
        id: 'claude-vs-ui-cost',
        question: 'Is there a difference in cost between Claude Desktop and the Pandora UI?',
        answer: 'No. Both paths run the same underlying Pandora skills and tools. The cost is determined by which tools you call and how often, not which interface you use. Claude Desktop may feel cheaper because you have more control over when skills run — the UI runs some skills automatically on schedule.',
      },
      {
        id: 'usage-event',
        question: 'What counts as a usage event?',
        answer: 'Skill runs are the primary usage event — each skill execution (pipeline-hygiene, forecast-rollup, etc.) counts as one event. LLM calls inside Ask Pandora, Concierge brief generation, and report synthesis also consume tokens tracked in Settings → Token Usage. Raw data reads (query_deals, get_pipeline_summary) do not count as billable events.',
      },
    ],
  },
];

const troubleshootingCategories: Category[] = [
  {
    id: 'connection',
    label: 'Connection Issues',
    items: [
      {
        id: 'no-pipeline-data',
        question: 'Claude says it can\'t find my pipeline data',
        answer: 'Check three things in order: (1) Is Claude Desktop restarted after you pasted the config? The connection only activates on restart. (2) Is your API key still valid? Go to Pandora Settings → Integrations → API Key. If it shows "No key generated," click Generate. If it was recently rotated, copy the new key and update your Claude config. (3) Does your CRM have data? If your HubSpot or Salesforce sync hasn\'t run, Pandora has nothing to return. Go to Settings → Data → Sync and trigger a manual sync.',
      },
      {
        id: 'mcp-errors',
        question: 'The MCP tools show up in Claude but return errors',
        answer: 'The most common cause is an expired or rotated API key. Rotate the key in Pandora Settings → Integrations and update your Claude config file with the new key. If errors continue, check the Pandora status page. If a specific tool consistently errors (e.g. run_deliberation but not get_pipeline_summary), the underlying skill or service may be temporarily unavailable — try again in a few minutes.',
      },
      {
        id: 'no-brief',
        question: 'My Concierge brief isn\'t arriving on Monday mornings',
        answer: 'Check three things: (1) Is Slack connected? Go to Settings → Integrations → Slack. If it shows disconnected, reconnect it. (2) Is the brief scheduled? Go to Settings → Concierge and confirm the schedule is set to Monday and the delivery channel is your correct Slack channel. (3) Did the skills run? The brief won\'t send if no skills have run in the last 48 hours. Check the Skills page for recent run timestamps.',
      },
      {
        id: 'insufficient-data',
        question: 'I\'m seeing "insufficient data" messages throughout the platform',
        answer: 'This usually means Pandora just connected to your CRM and the initial sync hasn\'t completed, or your CRM has fewer than the minimum records required for pattern analysis. Initial sync for large HubSpot instances (10,000+ deals) can take 30–60 minutes. Check the sync status in Settings → Data. Once complete, run skills manually to populate the first results.',
      },
    ],
  },
  {
    id: 'data',
    label: 'Data Issues',
    items: [
      {
        id: 'outdated-answers',
        question: 'Claude is giving me answers that seem outdated',
        answer: 'Pandora\'s skill tools cache results for up to 4 hours to avoid re-running expensive analyses on every question. If you know something changed recently — a deal closed, a rep hit quota — tell Claude to run a fresh skill: "Run a fresh pipeline hygiene check" or "Get the latest forecast, don\'t use cached data." You can also trigger a manual skill run from the Pandora Skills page before asking Claude.',
      },
      {
        id: 'wbr-vs-crm',
        question: 'My WBR shows different numbers than my CRM',
        answer: 'Two likely causes. First, sync lag — Pandora syncs your CRM on a schedule (typically every few hours). If deals were updated in the last few hours they may not be reflected yet. Trigger a manual sync from Settings → Data → Sync, wait for it to complete, then regenerate the WBR. Second, skill staleness — the WBR pulls from the most recent skill run, which may be from earlier in the day. Run a fresh pipeline hygiene and forecast rollup, then regenerate.',
      },
      {
        id: 'skill-failing',
        question: 'A skill keeps failing when I try to run it',
        answer: 'Check the skill\'s last run status in the Skills page — it will show an error message if something went wrong. Common causes: (1) CRM sync hasn\'t run so there\'s no data to analyze. (2) The skill requires a configuration that\'s missing — some skills need quota targets or ICP criteria set in workspace config. (3) The skill is hitting a rate limit on the LLM provider. Wait 5 minutes and try again. If failures persist, contact support with the skill ID and the error message shown on the Skills page.',
      },
    ],
  },
  {
    id: 'reports-ts',
    label: 'Reports',
    items: [
      {
        id: 'empty-wbr',
        question: 'My WBR has mostly empty sections',
        answer: 'Sections populate from recent skill runs. If a skill hasn\'t run in the last 7 days, its section shows a degraded placeholder. Go to Pandora Skills page, check which skills show "Never run" or a stale timestamp, and trigger manual runs for the skills listed in each empty section. Then regenerate the WBR. The most common missing skills are forecast-rollup and rep-scorecard — run those first.',
      },
      {
        id: 'no-charts',
        question: 'Ask Pandora isn\'t showing charts — just text',
        answer: 'Charts require the pandora_response block format, which is only sent for new messages. If you\'re looking at an older conversation from before charts were enabled, open a new Ask Pandora thread and ask the same question. If charts still don\'t appear on new messages, check that your browser isn\'t blocking the charting library (some ad blockers interfere). Try in an incognito window.',
      },
      {
        id: 'gdocs-unformatted',
        question: 'I exported to Google Docs but the report looks unformatted',
        answer: 'Google Docs conversion from DOCX preserves heading styles, bold text, and tables, but some formatting depends on the fonts installed in your Google account. If the document looks plain, go to Format → Paragraph Styles in Google Docs and apply the Normal Text style to reset it. For best results, use the Google Docs "Format → Theme" option to apply a clean theme after export.',
      },
      {
        id: 'gdocs-no-effect',
        question: 'The Google Docs feedback loop isn\'t affecting my WBR generation',
        answer: 'The read-back runs Sunday at 8 PM in your workspace timezone. If you edited the Google Doc after Sunday, the edits won\'t affect the current week\'s WBR — they\'ll affect next week\'s. Also confirm your Google Drive is still connected: Settings → Integrations → Google Drive. If the connection expired (Google OAuth tokens expire after extended inactivity), reconnect it and Pandora will pick up the doc on the next Sunday read-back.',
      },
    ],
  },
  {
    id: 'actions',
    label: 'Actions and Insights',
    items: [
      {
        id: 'no-deliberation',
        question: 'The deliberation panel isn\'t appearing even when I ask about deal risk',
        answer: 'The intent classifier needs enough context to trigger deliberation. Vague questions like "what about deals?" won\'t trigger it. More specific questions do: "Will the Unicare ABA deal close this quarter?" or "Should I walk away from the TechVision opportunity?" If you want to force it, click the Bull/Bear character icon above the Ask Pandora input before typing your question.',
      },
      {
        id: 'actions-not-showing',
        question: 'Actions I created via Claude aren\'t showing up in Pandora',
        answer: 'Go to Pandora Actions page and check the filter. By default the page may show "This week" or filter by severity. Look for a "Source" filter — toggle it to show "From Claude" or clear all filters. If the action still doesn\'t appear, it may have been deduplicated against an existing action with the same title and deal. Claude won\'t create a duplicate if the same action already exists.',
      },
      {
        id: 'wrong-workspace',
        question: 'Pandora shows data from the wrong workspace',
        answer: 'If you\'re on multiple workspaces, check the workspace switcher in the bottom-left of the Pandora UI. For MCP connections, each API key is scoped to one workspace — if you have two workspaces you need two API keys and two separate MCP server configurations in Claude Desktop.',
      },
    ],
  },
];

function AccordionItem({ item, isOpen, onToggle, searchQuery }: {
  item: AccordionItem;
  isOpen: boolean;
  onToggle: () => void;
  searchQuery: string;
}) {
  const highlight = (text: string) => {
    if (!searchQuery.trim()) return text;
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} style={{ background: `${colors.accent}40`, color: colors.text, borderRadius: 2 }}>{part}</mark>
        : part
    );
  };

  return (
    <div style={{
      borderBottom: `1px solid ${colors.border}`,
      borderLeft: isOpen ? `3px solid ${colors.accent}` : '3px solid transparent',
      transition: 'border-color 0.15s',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '14px 16px',
          background: isOpen ? `${colors.accent}08` : 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = colors.surfaceHover; }}
        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, lineHeight: 1.4, flex: 1 }}>
          {highlight(item.question)}
        </span>
        <span style={{
          fontSize: 16,
          color: isOpen ? colors.accent : colors.textMuted,
          flexShrink: 0,
          transition: 'transform 0.15s, color 0.15s',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          display: 'inline-block',
          lineHeight: 1,
        }}>+</span>
      </button>
      {isOpen && (
        <div style={{
          padding: '0 16px 16px 16px',
          fontSize: 13,
          color: colors.textSecondary,
          fontFamily: fonts.sans,
          lineHeight: 1.65,
          whiteSpace: 'pre-line',
        }}>
          {highlight(item.answer)}
        </div>
      )}
    </div>
  );
}

function CategorySection({ category, openIds, onToggle, searchQuery }: {
  category: Category;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  searchQuery: string;
}) {
  if (category.items.length === 0) return null;
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 12, color: `${colors.accent}cc`, fontFamily: fonts.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          ✦ {category.label}
        </span>
      </div>
      <div style={{
        background: colors.surface,
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}>
        {category.items.map(item => (
          <AccordionItem
            key={item.id}
            item={item}
            isOpen={openIds.has(item.id)}
            onToggle={() => onToggle(item.id)}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [activeTab, setActiveTab] = useState<'faq' | 'troubleshooting'>('faq');
  const [searchQuery, setSearchQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const toggleItem = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const categories = activeTab === 'faq' ? faqCategories : troubleshootingCategories;

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase();
    return categories
      .map(cat => ({
        ...cat,
        items: cat.items.filter(
          item =>
            item.question.toLowerCase().includes(q) ||
            item.answer.toLowerCase().includes(q)
        ),
      }))
      .filter(cat => cat.items.length > 0);
  }, [categories, searchQuery]);

  const totalResults = filteredCategories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
      <div style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <a
            href="https://pandoragtm.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, letterSpacing: '-0.03em', marginBottom: 24 }}>
              ✦ Pandora
            </div>
          </a>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: colors.text, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            Help Center
          </h1>
          <p style={{ fontSize: 14, color: colors.textMuted, margin: 0 }}>
            Answers to common questions and troubleshooting steps
          </p>
        </div>

        <div style={{ position: 'relative', marginBottom: 28 }}>
          <input
            type="text"
            placeholder="Search questions and answers…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px 12px 40px',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              color: colors.text,
              fontSize: 14,
              fontFamily: fonts.sans,
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = colors.accent; }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border; }}
          />
          <svg
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2,
              }}
            >×</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: colors.surface, borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {(['faq', 'troubleshooting'] as const).map(tab => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSearchQuery(''); }}
                style={{
                  padding: '7px 18px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                  border: 'none',
                  background: isActive ? colors.surfaceRaised : 'transparent',
                  color: isActive ? colors.text : colors.textMuted,
                  transition: 'all 0.15s',
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                {tab === 'faq' ? 'FAQ' : 'Troubleshooting'}
              </button>
            );
          })}
        </div>

        {searchQuery && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
            {totalResults > 0 ? `${totalResults} result${totalResults === 1 ? '' : 's'} for "${searchQuery}"` : ''}
          </div>
        )}

        {filteredCategories.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
            <p style={{ fontSize: 14, color: colors.textMuted, margin: 0 }}>
              No results for <strong style={{ color: colors.text }}>"{searchQuery}"</strong>
            </p>
            <button
              onClick={() => setSearchQuery('')}
              style={{ marginTop: 12, fontSize: 13, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.sans }}
            >
              Clear search
            </button>
          </div>
        ) : (
          filteredCategories.map(cat => (
            <CategorySection
              key={cat.id}
              category={cat}
              openIds={openIds}
              onToggle={toggleItem}
              searchQuery={searchQuery}
            />
          ))
        )}

        <div style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: `1px solid ${colors.border}`,
          textAlign: 'center',
          fontSize: 13,
          color: colors.textMuted,
        }}>
          Still stuck?{' '}
          <a
            href="mailto:support@pandoragtm.com"
            style={{ color: colors.accent, textDecoration: 'none' }}
          >
            Email support@pandoragtm.com
          </a>
        </div>
      </div>
    </div>
  );
}

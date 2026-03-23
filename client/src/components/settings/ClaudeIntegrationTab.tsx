import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import McpActivityPanel from './McpActivityPanel';

interface McpConfig {
  workspace_id: string;
  workspace_name: string;
  api_key: string;
  mcp_server_url: string;
  claude_desktop_config: {
    mcpServers: {
      pandora: {
        url: string;
        headers: { Authorization: string };
      };
    };
  };
  tools_available: number;
  instructions: string[];
}

const TOOL_GROUPS = [
  {
    category: 'Intelligence',
    tools: [
      { name: 'get_pipeline_summary', description: 'Pipeline snapshot by stage' },
      { name: 'get_pipeline_health', description: 'Hygiene findings and stale deals' },
      { name: 'get_forecast_rollup', description: 'Forecast by rep and category' },
      { name: 'get_at_risk_deals', description: 'Deals at risk of slipping' },
      { name: 'get_rep_scorecard', description: 'Rep performance metrics' },
      { name: 'get_concierge_brief', description: 'Latest Monday brief' },
      { name: 'query_deals', description: 'Live CRM query with filters' },
      { name: 'get_skill_status', description: 'Last run time for all skills' },
      { name: 'get_deal_risk_review', description: 'Deal risk scores and factors' },
      { name: 'get_call_themes', description: 'Conversation intelligence themes' },
      { name: 'get_icp_profile', description: 'Ideal customer profile analysis' },
      { name: 'get_competitive_landscape', description: 'Competitor win/loss patterns' },
      { name: 'get_funnel_analysis', description: 'Stage-by-stage conversion rates' },
      { name: 'get_monte_carlo_forecast', description: 'Revenue simulation (P25/P50/P75)' },
      { name: 'get_strategy_insights', description: 'Cross-skill strategic synthesis' },
    ],
  },
  {
    category: 'Analysis',
    tools: [
      { name: 'run_skill', description: 'Run any of 38 Pandora skills on demand' },
      { name: 'run_deliberation', description: 'Bull/Bear, Boardroom, Socratic, Prosecutor/Defense analysis' },
    ],
  },
  {
    category: 'Reports',
    tools: [
      { name: 'generate_report', description: 'Create WBR or QBR' },
      { name: 'get_report', description: 'Fetch existing report' },
      { name: 'list_reports', description: 'Recent reports with metadata' },
      { name: 'export_report_to_google_docs', description: 'Push to Google Docs' },
    ],
  },
  {
    category: 'Save to Pandora',
    tools: [
      { name: 'save_claude_insight', description: 'Save analysis to Command Center' },
      { name: 'create_action', description: 'Create action on Actions page' },
      { name: 'save_to_report', description: 'Add content to a report section' },
      { name: 'save_hypothesis', description: 'Save hypothesis draft for review' },
    ],
  },
];

const SAMPLE_PROMPTS = [
  '"What is my current pipeline coverage?"',
  '"Which deals are most at risk this week?"',
  '"Generate a WBR for this week"',
  '"Run a Bull/Bear analysis on [deal name]"',
];

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: '0 0 4px', fontFamily: fonts.sans }}>
        {title}
      </h2>
      <p style={{ fontSize: 12, color: colors.textMuted, margin: 0, lineHeight: 1.55 }}>
        {description}
      </p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '16px 18px',
    }}>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '16px 18px',
      marginBottom: 32,
    }}>
      {[90, 60, 80, 40].map((w, i) => (
        <div key={i} style={{
          height: 12,
          width: `${w}%`,
          background: colors.surfaceHover,
          borderRadius: 4,
          marginBottom: i < 3 ? 10 : 0,
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

export default function ClaudeIntegrationTab() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [config, setConfig] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [configCopied, setConfigCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const [rotateConfirming, setRotateConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateSuccess, setRotateSuccess] = useState(false);

  const loadConfig = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setLoading(true);
      setError(null);
      const data: McpConfig = await api.get(`/workspaces/${workspaceId}/mcp`);
      setConfig(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load Claude configuration');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const configJson = config
    ? JSON.stringify(config.claude_desktop_config, null, 2)
    : '';

  const maskedKey = config?.api_key
    ? `${config.api_key.slice(0, 12)}${'•'.repeat(20)}`
    : '';

  const handleCopyConfig = async () => {
    await navigator.clipboard.writeText(configJson).catch(() => {});
    setConfigCopied(true);
    setTimeout(() => setConfigCopied(false), 2000);
  };

  const handleCopyKey = async () => {
    if (!config?.api_key) return;
    await navigator.clipboard.writeText(config.api_key).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const handleRotate = async () => {
    if (!workspaceId) return;
    setRotating(true);
    setRotateError(null);
    try {
      await api.post(`/workspaces/${workspaceId}/rotate-key`, {});
      await loadConfig();
      setRotateSuccess(true);
      setRotateConfirming(false);
      setKeyRevealed(false);
      setTimeout(() => setRotateSuccess(false), 4000);
    } catch (e: any) {
      setRotateError(e?.message ?? 'Failed to rotate key');
    } finally {
      setRotating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        <div style={{ height: 32, width: 220, background: colors.surfaceHover, borderRadius: 4, marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 16, width: 380, background: colors.surfaceHover, borderRadius: 4, marginBottom: 36, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
        <div style={{
          background: colors.redSoft,
          border: `1px solid ${colors.red}`,
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <span style={{ fontSize: 13, color: colors.red }}>{error}</span>
          <button
            onClick={loadConfig}
            style={{ fontSize: 12, color: colors.red, background: 'none', border: `1px solid ${colors.red}`, borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontFamily: fonts.sans, whiteSpace: 'nowrap' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      <h1 style={{ fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 6 }}>Claude Integration</h1>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 32, lineHeight: 1.6 }}>
        Connect Pandora to Claude Desktop and access your full pipeline intelligence through conversation.
        Pandora provides {config.tools_available} tools that Claude can call to read and write your workspace data.
      </p>

      {rotateSuccess && (
        <div style={{ background: colors.greenSoft, border: `1px solid ${colors.green}`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: colors.green, marginBottom: 20 }}>
          Key rotated. Update your Claude Desktop config with the new key.
        </div>
      )}

      {/* ─── Section 1: Claude Desktop Config ─── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Claude Desktop"
          description="Use Pandora's intelligence directly in Claude. Paste this configuration into your Claude Desktop config file to connect."
        />
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Configuration
            </span>
            <button
              onClick={handleCopyConfig}
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: `1px solid ${configCopied ? colors.green : colors.accent}`,
                borderRadius: 5,
                color: configCopied ? colors.green : colors.accent,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {configCopied ? '✓ Copied!' : 'Copy config'}
            </button>
          </div>

          <div style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '12px 14px',
            fontFamily: fonts.mono,
            fontSize: 12,
            color: colors.textSecondary,
            lineHeight: 1.6,
            maxHeight: 200,
            overflowY: 'auto',
            whiteSpace: 'pre',
            marginBottom: 14,
          }}>
            {configJson}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
              📋 Config file location:
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.7, fontFamily: fonts.mono }}>
              <span style={{ color: colors.textSecondary }}>macOS:</span>{'   '}~/.config/claude/claude_desktop_config.json<br />
              <span style={{ color: colors.textSecondary }}>Windows:</span>{'  '}%APPDATA%\Claude\claude_desktop_config.json
            </div>
          </div>

          <button
            onClick={() => setInstructionsOpen(o => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: colors.accent,
              fontSize: 12,
              fontFamily: fonts.sans,
              fontWeight: 500,
            }}
          >
            <span style={{
              display: 'inline-block',
              transition: 'transform 0.15s',
              transform: instructionsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              fontSize: 10,
            }}>▶</span>
            Setup instructions
          </button>

          {instructionsOpen && (
            <ol style={{ margin: '10px 0 0 18px', padding: 0, fontSize: 12, color: colors.textSecondary, lineHeight: 1.8 }}>
              {config.instructions.map((step, i) => (
                <li key={i}>{step.replace(/^\d+\.\s*/, '')}</li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* ─── Section 2: API Key ─── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader
          title="API Key"
          description="Your workspace API key authenticates Pandora tools in Claude. Keep it secret — anyone with this key can read your pipeline data."
        />
        <Card>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Workspace API Key
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              flex: 1,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 5,
              padding: '7px 12px',
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {keyRevealed ? config.api_key : maskedKey}
            </div>
            <button
              onClick={() => setKeyRevealed(r => !r)}
              title={keyRevealed ? 'Hide key' : 'Show key'}
              style={{
                padding: '6px 10px',
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 5,
                color: colors.textSecondary,
                fontSize: 13,
                cursor: 'pointer',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {keyRevealed ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
            <button
              onClick={handleCopyKey}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: `1px solid ${keyCopied ? colors.green : colors.accent}`,
                borderRadius: 5,
                color: keyCopied ? colors.green : colors.accent,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                flexShrink: 0,
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {keyCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 16 }}>
            Auto-generated. Used in the configuration block above.
          </div>

          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
            {rotateError && (
              <div style={{ fontSize: 12, color: colors.red, marginBottom: 10 }}>{rotateError}</div>
            )}

            {!rotateConfirming ? (
              <div>
                <button
                  onClick={() => { setRotateConfirming(true); setRotateError(null); }}
                  style={{
                    padding: '6px 14px',
                    background: 'transparent',
                    border: `1px solid ${colors.yellow}`,
                    borderRadius: 5,
                    color: colors.yellow,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: fonts.sans,
                  }}
                >
                  Rotate key
                </button>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                  Rotating invalidates all existing connections immediately.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10, lineHeight: 1.5 }}>
                  This will immediately disconnect any tools using the current key. Are you sure?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setRotateConfirming(false); setRotateError(null); }}
                    disabled={rotating}
                    style={{
                      padding: '6px 14px',
                      background: colors.surfaceRaised,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 5,
                      color: colors.textSecondary,
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: fonts.sans,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRotate}
                    disabled={rotating}
                    style={{
                      padding: '6px 14px',
                      background: colors.yellow,
                      border: `1px solid ${colors.yellow}`,
                      borderRadius: 5,
                      color: '#000',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: rotating ? 'wait' : 'pointer',
                      fontFamily: fonts.sans,
                      opacity: rotating ? 0.7 : 1,
                    }}
                  >
                    {rotating ? 'Rotating…' : 'Rotate key'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Section 3: Available Tools ─── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader
          title={`Available Tools (${config.tools_available})`}
          description="These Pandora tools are available in Claude when connected. Claude can call any of these on your behalf."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {TOOL_GROUPS.map(group => (
            <Card key={group.category}>
              <div style={{ fontSize: 11, fontWeight: 700, color: `${colors.accent}cc`, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                {group.category}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 8,
              }}>
                {group.tools.map(tool => (
                  <div
                    key={tool.name}
                    style={{
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: '9px 12px',
                    }}
                  >
                    <div style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.text, fontWeight: 600, marginBottom: 3 }}>
                      {tool.name}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4 }}>
                      {tool.description}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ─── Section 4: Quick Test ─── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader
          title="Test Your Connection"
          description="After setting up Claude Desktop, verify the connection is working."
        />
        <Card>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 10 }}>
            Try these questions in Claude Desktop:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {SAMPLE_PROMPTS.map((prompt, i) => (
              <div
                key={i}
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 5,
                  padding: '7px 12px',
                  fontSize: 12,
                  color: colors.textSecondary,
                  fontFamily: fonts.mono,
                }}
              >
                {prompt}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
            Pandora will retrieve live data from your connected CRM and return structured findings.
          </div>
          {workspaceId && <McpActivityPanel workspaceId={workspaceId} />}
        </Card>
      </div>
    </div>
  );
}

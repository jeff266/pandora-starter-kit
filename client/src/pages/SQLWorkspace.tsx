import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import { highlightSQL } from '../utils/sql-highlight';
import { Icon } from '../components/icons';

// ─── Schema ───
const SCHEMA = {
  deals: {
    icon: 'chart-growth',
    desc: 'Pipeline deals from CRM',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'Unique deal identifier' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
      { name: 'source', type: 'text', desc: 'CRM source (hubspot, salesforce)' },
      { name: 'source_id', type: 'text', desc: 'Original ID in source system' },
      { name: 'name', type: 'text', desc: 'Deal name from CRM' },
      { name: 'amount', type: 'numeric', desc: 'Deal value in currency' },
      { name: 'stage', type: 'text', desc: 'Raw CRM stage name' },
      { name: 'stage_normalized', type: 'text', desc: 'Pandora stage: discovery, qualification, proposal, negotiation, closed_won, closed_lost' },
      { name: 'close_date', type: 'date', desc: 'Expected close date' },
      { name: 'owner', type: 'text', desc: 'Deal owner email' },
      { name: 'account_id', type: 'UUID', fk: 'accounts', desc: 'Linked account' },
      { name: 'contact_id', type: 'UUID', fk: 'contacts', desc: 'Primary contact' },
      { name: 'probability', type: 'numeric', desc: 'Win probability 0-100' },
      { name: 'forecast_category', type: 'text', desc: 'commit, best_case, pipeline, omitted' },
      { name: 'pipeline', type: 'text', desc: 'Pipeline name (New Business, Renewals)' },
      { name: 'days_in_stage', type: 'integer', desc: 'Days in current stage (computed)' },
      { name: 'last_activity_date', type: 'date', desc: 'Most recent activity timestamp' },
      { name: 'velocity_score', type: 'numeric', desc: 'Deal velocity score 0-100' },
      { name: 'deal_risk', type: 'numeric', desc: 'Risk score 0-100' },
      { name: 'health_score', type: 'numeric', desc: 'Overall deal health 0-100' },
      { name: 'custom_fields', type: 'jsonb', desc: 'CRM custom fields as JSON' },
      { name: 'created_at', type: 'timestamptz', desc: 'Record creation timestamp' },
      { name: 'updated_at', type: 'timestamptz', desc: 'Record last updated' },
    ],
  },
  contacts: {
    icon: 'connections',
    desc: 'People linked to deals and accounts',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'Unique contact identifier' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
      { name: 'source', type: 'text', desc: 'CRM source system' },
      { name: 'source_id', type: 'text', desc: 'Original ID in source' },
      { name: 'email', type: 'text', desc: 'Primary email address' },
      { name: 'first_name', type: 'text', desc: 'First name' },
      { name: 'last_name', type: 'text', desc: 'Last name' },
      { name: 'title', type: 'text', desc: 'Job title' },
      { name: 'seniority', type: 'text', desc: 'c_level, vp, director, manager, individual' },
      { name: 'department', type: 'text', desc: 'Department name' },
      { name: 'account_id', type: 'UUID', fk: 'accounts', desc: 'Linked account' },
      { name: 'lifecycle_stage', type: 'text', desc: 'Lifecycle stage (subscriber, lead, MQL, etc)' },
      { name: 'engagement_score', type: 'numeric', desc: 'Engagement score 0-100' },
      { name: 'phone', type: 'text', desc: 'Phone number' },
      { name: 'last_activity_date', type: 'date', desc: 'Last activity timestamp' },
      { name: 'custom_fields', type: 'jsonb', desc: 'CRM custom fields' },
      { name: 'created_at', type: 'timestamptz', desc: 'Record created' },
      { name: 'updated_at', type: 'timestamptz', desc: 'Record updated' },
    ],
  },
  accounts: {
    icon: 'building',
    desc: 'Companies and organizations',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'Unique account identifier' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
      { name: 'source', type: 'text', desc: 'CRM source system' },
      { name: 'source_id', type: 'text', desc: 'Original ID in source' },
      { name: 'name', type: 'text', desc: 'Company name' },
      { name: 'domain', type: 'text', desc: 'Website domain' },
      { name: 'industry', type: 'text', desc: 'Industry classification' },
      { name: 'employee_count', type: 'integer', desc: 'Employee headcount' },
      { name: 'annual_revenue', type: 'numeric', desc: 'Annual revenue (USD)' },
      { name: 'health_score', type: 'numeric', desc: 'Account health 0-100' },
      { name: 'open_deal_count', type: 'integer', desc: 'Number of active deals' },
      { name: 'owner', type: 'text', desc: 'Account owner email' },
      { name: 'custom_fields', type: 'jsonb', desc: 'CRM custom fields' },
      { name: 'created_at', type: 'timestamptz', desc: 'Record created' },
      { name: 'updated_at', type: 'timestamptz', desc: 'Record updated' },
    ],
  },
  activities: {
    icon: 'flow',
    desc: 'Emails, calls, meetings, notes',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'Activity identifier' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
      { name: 'source', type: 'text', desc: 'Activity source system' },
      { name: 'source_id', type: 'text', desc: 'Original ID in source' },
      { name: 'activity_type', type: 'text', desc: 'meeting, call, email, note, task' },
      { name: 'timestamp', type: 'timestamptz', desc: 'When activity occurred' },
      { name: 'actor', type: 'text', desc: 'Person who performed activity' },
      { name: 'subject', type: 'text', desc: 'Activity subject/title' },
      { name: 'body', type: 'text', desc: 'Activity content/description' },
      { name: 'deal_id', type: 'UUID', fk: 'deals', desc: 'Associated deal' },
      { name: 'contact_id', type: 'UUID', fk: 'contacts', desc: 'Associated contact' },
      { name: 'account_id', type: 'UUID', fk: 'accounts', desc: 'Associated account' },
      { name: 'direction', type: 'text', desc: 'inbound, outbound, internal' },
      { name: 'duration_seconds', type: 'integer', desc: 'Duration in seconds' },
      { name: 'custom_fields', type: 'jsonb', desc: 'CRM custom fields' },
      { name: 'created_at', type: 'timestamptz', desc: 'Record created' },
      { name: 'updated_at', type: 'timestamptz', desc: 'Record updated' },
    ],
  },
  conversations: {
    icon: 'network',
    desc: 'Call transcripts from Gong/Fireflies/Fathom',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'Conversation identifier' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
      { name: 'source', type: 'text', desc: 'Recording source (gong, fireflies, fathom)' },
      { name: 'source_id', type: 'text', desc: 'Original ID in source' },
      { name: 'title', type: 'text', desc: 'Call title/name' },
      { name: 'call_date', type: 'timestamptz', desc: 'When call happened' },
      { name: 'duration_seconds', type: 'integer', desc: 'Call length in seconds' },
      { name: 'participants', type: 'jsonb', desc: 'Array of participant objects' },
      { name: 'deal_id', type: 'UUID', fk: 'deals', desc: 'Linked deal' },
      { name: 'account_id', type: 'UUID', fk: 'accounts', desc: 'Linked account' },
      { name: 'transcript_text', type: 'text', desc: 'Full call transcript' },
      { name: 'summary', type: 'text', desc: 'AI-generated summary' },
      { name: 'action_items', type: 'jsonb', desc: 'Extracted action items' },
      { name: 'objections', type: 'jsonb', desc: 'Detected objections' },
      { name: 'sentiment_score', type: 'numeric', desc: 'Overall sentiment -1 to 1' },
      { name: 'talk_listen_ratio', type: 'jsonb', desc: 'Talk/listen ratio breakdown' },
      { name: 'topics', type: 'jsonb', desc: 'Discussed topics' },
      { name: 'competitor_mentions', type: 'jsonb', desc: 'Competitor references' },
      { name: 'custom_fields', type: 'jsonb', desc: 'Source custom fields' },
      { name: 'created_at', type: 'timestamptz', desc: 'Record created' },
      { name: 'updated_at', type: 'timestamptz', desc: 'Record updated' },
    ],
  },
  deal_stage_history: {
    icon: 'trending',
    desc: 'Stage transition audit trail',
    columns: [
      { name: 'id', type: 'UUID', pk: true, desc: 'History record ID' },
      { name: 'deal_id', type: 'UUID', fk: 'deals', desc: 'Which deal changed' },
      { name: 'from_stage_normalized', type: 'text', desc: 'Previous stage' },
      { name: 'to_stage_normalized', type: 'text', desc: 'New stage' },
      { name: 'changed_at', type: 'timestamptz', desc: 'When it changed' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
    ],
  },
  deal_contacts: {
    icon: 'connections',
    desc: 'Deal-contact associations with roles',
    columns: [
      { name: 'deal_id', type: 'UUID', fk: 'deals', desc: 'Deal ID' },
      { name: 'contact_id', type: 'UUID', fk: 'contacts', desc: 'Contact ID' },
      { name: 'role', type: 'text', desc: 'decision_maker, champion, influencer, blocker, end_user' },
      { name: 'engagement_level', type: 'text', desc: 'high, medium, low' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
    ],
  },
  lead_scores: {
    icon: 'target',
    desc: 'Account-level lead scores',
    columns: [
      { name: 'account_id', type: 'UUID', fk: 'accounts', desc: 'Scored account' },
      { name: 'score', type: 'numeric', desc: 'Score 0-100' },
      { name: 'tier', type: 'text', desc: 'A, B, C, D tier' },
      { name: 'scored_at', type: 'timestamptz', desc: 'When scored' },
      { name: 'workspace_id', type: 'UUID', desc: 'Workspace identifier' },
    ],
  },
};

const ALL_TABLES = Object.keys(SCHEMA);
const ALL_COLUMNS: Record<string, string[]> = {};
ALL_TABLES.forEach((t) => {
  (SCHEMA as any)[t].columns.forEach((c: any) => {
    if (!ALL_COLUMNS[c.name]) ALL_COLUMNS[c.name] = [];
    ALL_COLUMNS[c.name].push(t);
  });
});

const PG_FUNCTIONS = [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ROUND',
  'COALESCE',
  'NULLIF',
  'EXTRACT',
  'DATE_TRUNC',
  'NOW',
  'CURRENT_DATE',
  'CURRENT_TIMESTAMP',
  'LOWER',
  'UPPER',
  'TRIM',
  'LENGTH',
  'CONCAT',
  'SUBSTRING',
  'REPLACE',
  'CAST',
  'CASE',
  'GREATEST',
  'LEAST',
  'ABS',
  'CEIL',
  'FLOOR',
  'ROW_NUMBER',
  'RANK',
  'DENSE_RANK',
  'LAG',
  'LEAD',
  'STRING_AGG',
  'ARRAY_AGG',
  'JSON_AGG',
  'JSONB_EXTRACT_PATH_TEXT',
];

const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'EXECUTE',
  'COPY',
  'VACUUM',
  'REINDEX',
  'SET',
  'RESET',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'LOCK',
  'NOTIFY',
  'LISTEN',
  'EXPLAIN',
  'ANALYZE',
];

// ─── Validation Engine ───

interface ValidationIssue {
  type: string;
  message: string;
  detail: string;
  line?: number;
  severity: 'error' | 'warning';
  suggestion?: string;
}

interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  valid: boolean;
}

function validateSQL(sql: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const trimmed = sql.trim();

  if (!trimmed) return { errors: [], warnings: [], valid: true };

  // Layer 1: Blocked operations
  const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
  if (BLOCKED_KEYWORDS.includes(firstWord)) {
    errors.push({
      type: 'blocked',
      message: `${firstWord} operations are not permitted`,
      detail: 'The SQL Workspace is read-only. Only SELECT queries are allowed.',
      line: 1,
      severity: 'error',
    });
    return { errors, warnings, valid: false };
  }

  // Check for blocked keywords anywhere
  const upperSQL = trimmed.toUpperCase();
  BLOCKED_KEYWORDS.forEach((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    if (regex.test(upperSQL) && kw !== firstWord) {
      const lines = trimmed.split('\n');
      let lineNum = 1;
      lines.forEach((line, i) => {
        if (new RegExp(`\\b${kw}\\b`, 'gi').test(line)) lineNum = i + 1;
      });
      if (['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE'].includes(kw)) {
        errors.push({
          type: 'blocked',
          message: `${kw} is not permitted in any context`,
          detail: 'Read-only workspace. Only SELECT queries allowed.',
          line: lineNum,
          severity: 'error',
        });
      }
    }
  });

  if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
    errors.push({
      type: 'blocked',
      message: 'Query must start with SELECT or WITH',
      detail: 'Only SELECT statements and CTEs (WITH ... AS) are supported.',
      line: 1,
      severity: 'error',
    });
  }

  // Layer 2: Syntax checks
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push({
      type: 'syntax',
      message: `Unmatched parentheses: ${openParens} open, ${closeParens} close`,
      detail:
        openParens > closeParens
          ? `Missing ${openParens - closeParens} closing parenthesis(es)`
          : `Extra ${closeParens - openParens} closing parenthesis(es)`,
      severity: 'error',
    });
  }

  const singleQuotes = (trimmed.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    errors.push({
      type: 'syntax',
      message: 'Unterminated string literal',
      detail: 'You have an odd number of single quotes. Check for unclosed strings.',
      severity: 'error',
    });
  }

  // Check for common typos
  const typoPatterns = [
    {
      pattern: /\bSELECT\s+FROM\b/gi,
      message: 'SELECT requires column names before FROM',
      fix: 'Add column names: SELECT col1, col2 FROM ...',
    },
    { pattern: /\bFROM\s+WHERE\b/gi, message: 'Missing table name between FROM and WHERE', fix: 'Add a table: FROM deals WHERE ...' },
    { pattern: /\bGROUP\s+(?!BY\b)\w/gi, message: 'GROUP must be followed by BY', fix: 'Use GROUP BY column_name' },
    { pattern: /\bORDER\s+(?!BY\b)\w/gi, message: 'ORDER must be followed by BY', fix: 'Use ORDER BY column_name' },
    { pattern: /,,/g, message: 'Double comma detected', fix: 'Remove the extra comma' },
    { pattern: /,\s*(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT)\b/gi, message: 'Trailing comma before clause', fix: 'Remove the comma before $1' },
  ];

  typoPatterns.forEach(({ pattern, message, fix }) => {
    if (pattern.test(trimmed)) {
      errors.push({ type: 'syntax', message, detail: fix, severity: 'error' });
    }
  });

  // Layer 3: Schema validation — check table names
  const fromMatches = upperSQL.match(/\b(?:FROM|JOIN)\s+(\w+)/gi) || [];
  fromMatches.forEach((match) => {
    const tableName = match.split(/\s+/).pop()!.toLowerCase();
    if (!ALL_TABLES.includes(tableName) && tableName !== 'lateral' && tableName !== 'unnest') {
      const suggestion = ALL_TABLES.find((t) => {
        return t.includes(tableName) || tableName.includes(t) || levenshtein(t, tableName) <= 2;
      });
      errors.push({
        type: 'schema',
        message: `Table "${tableName}" does not exist`,
        detail: suggestion ? `Did you mean "${suggestion}"?` : `Available tables: ${ALL_TABLES.join(', ')}`,
        severity: 'error',
        suggestion,
      });
    }
  });

  // Layer 3b: Check for unknown function names
  const funcMatches = trimmed.match(/\b([a-zA-Z_]+)\s*\(/g) || [];
  funcMatches.forEach((match) => {
    const funcName = match.replace(/\s*\($/, '').toUpperCase();
    if (
      !PG_FUNCTIONS.includes(funcName) &&
      !ALL_TABLES.includes(funcName.toLowerCase()) &&
      !['SELECT', 'WHERE', 'HAVING', 'IN', 'NOT', 'AND', 'OR', 'EXISTS', 'ANY', 'ALL', 'WITH', 'FILTER'].includes(funcName)
    ) {
      const suggestion = PG_FUNCTIONS.find((f) => levenshtein(f, funcName) <= 2);
      if (suggestion) {
        warnings.push({
          type: 'function',
          message: `Unknown function "${funcName.toLowerCase()}"`,
          detail: `Did you mean "${suggestion.toLowerCase()}"?`,
          severity: 'warning',
          suggestion,
        });
      }
    }
  });

  // Warnings
  if (upperSQL.includes('SELECT *')) {
    warnings.push({
      type: 'performance',
      message: 'SELECT * returns all columns',
      detail: 'For better performance and clarity, specify only the columns you need.',
      severity: 'warning',
    });
  }

  if (!upperSQL.includes('LIMIT') && !upperSQL.includes('GROUP BY') && !upperSQL.includes('COUNT')) {
    warnings.push({
      type: 'performance',
      message: 'No LIMIT clause',
      detail: 'Large tables may return thousands of rows. Consider adding LIMIT 100.',
      severity: 'warning',
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// ─── Component Types ───
interface RuntimeErrorType {
  message: string;
  hint?: string;
}

interface ErrorPanelProps {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  onApplyFix: (issue: ValidationIssue) => void;
}

interface RuntimeErrorProps {
  error: RuntimeErrorType | null;
}

interface GuideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SchemaPanelProps {
  onInsert: (text: string) => void;
  expandedTable: string | null;
  setExpandedTable: (table: string | null) => void;
  hoveredCol: any;
  setHoveredCol: (col: any) => void;
}

interface ResultsTableProps {
  results: any[];
}

// ─── Error Panel ───
function ErrorPanel({ errors, warnings, onApplyFix }: ErrorPanelProps) {
  if (!errors.length && !warnings.length) return null;

  return (
    <div
      style={{
        borderTop: `1px solid ${colors.border}`,
        maxHeight: 180,
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      {errors.map((e, i) => (
        <div
          key={`e${i}`}
          style={{
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderBottom: `1px solid ${colors.border}`,
            background: colors.surfaceHover,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              flexShrink: 0,
              marginTop: 1,
              background: e.type === 'blocked' ? colors.red : colors.red,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: 'white',
            }}
          >
            {e.type === 'blocked' ? <Icon name="filter" size={10} /> : '✕'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: colors.red, fontWeight: 600, fontFamily: fonts.body }}>{e.message}</div>
            <div style={{ fontSize: 10.5, color: colors.textSecondary, marginTop: 2, fontFamily: fonts.body }}>{e.detail}</div>
          </div>
          {e.suggestion && (
            <button
              onClick={() => onApplyFix(e)}
              style={{
                padding: '3px 8px',
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                fontSize: 10,
                color: colors.accent,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'all 0.12s',
                fontFamily: fonts.body,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = colors.surfaceHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = colors.surface;
              }}
            >
              Apply fix
            </button>
          )}
          {e.line && (
            <span style={{ fontSize: 9, color: colors.textTertiary, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2, fontFamily: fonts.body }}>
              Line {e.line}
            </span>
          )}
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={`w${i}`}
          style={{
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderBottom: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              flexShrink: 0,
              marginTop: 1,
              background: colors.yellow + '30',
              border: `1px solid ${colors.yellow}50`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: colors.yellow,
            }}
          >
            !
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: colors.yellow, fontWeight: 600, fontFamily: fonts.body }}>{w.message}</div>
            <div style={{ fontSize: 10.5, color: colors.textSecondary, marginTop: 2, fontFamily: fonts.body }}>{w.detail}</div>
          </div>
          {w.suggestion && (
            <button
              onClick={() => onApplyFix(w)}
              style={{
                padding: '3px 8px',
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                fontSize: 10,
                color: colors.yellow,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'all 0.12s',
                fontFamily: fonts.body,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = colors.surfaceHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = colors.surface;
              }}
            >
              Apply fix
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Runtime Error (post-execution) ───
function RuntimeError({ error }: RuntimeErrorProps) {
  if (!error) return null;
  return (
    <div
      style={{
        margin: 16,
        padding: 16,
        background: colors.surface,
        border: `1px solid ${colors.red}`,
        borderRadius: 8,
        fontFamily: fonts.body,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>💥</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.red, fontFamily: fonts.body }}>Query Execution Error</span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: colors.bg,
          borderRadius: 4,
          fontSize: 11,
          color: colors.red,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          border: `1px solid ${colors.border}`,
          fontFamily: fonts.mono,
        }}
      >
        {error.message}
      </pre>
      {error.hint && (
        <div style={{ marginTop: 10, padding: 10, background: colors.surfaceHover, borderRadius: 4, border: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 10, color: colors.textSecondary, marginBottom: 4, fontWeight: 600, fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="lightbulb" size={10} style={{ filter: 'brightness(0) saturate(100%) invert(62%) sepia(11%) saturate(566%) hue-rotate(181deg) brightness(94%) contrast(88%)' }} /> SUGGESTION</div>
          <div style={{ fontSize: 11, color: colors.text, lineHeight: 1.5, fontFamily: fonts.body }}>{error.hint}</div>
        </div>
      )}
    </div>
  );
}

// ─── Guide Drawer ───
function GuideDrawer({ isOpen, onClose }: GuideDrawerProps) {
  if (!isOpen) return null;

  const sections = [
    {
      title: 'What You Can Do',
      icon: 'check-flow',
      items: [
        { label: 'SELECT queries', desc: 'Read any data in your workspace' },
        { label: 'JOINs', desc: 'Combine tables (deals + accounts, deals + contacts, etc.)' },
        { label: 'Aggregations', desc: 'COUNT, SUM, AVG, MIN, MAX with GROUP BY' },
        { label: 'Window functions', desc: 'ROW_NUMBER, RANK, LAG, LEAD with OVER' },
        { label: 'CTEs', desc: 'WITH ... AS (...) for complex queries' },
        { label: 'FILTER clause', desc: 'PostgreSQL-specific: COUNT(*) FILTER (WHERE ...)' },
        { label: 'Date math', desc: 'INTERVAL, date_trunc, EXTRACT, NOW()' },
        { label: 'JSON access', desc: "custom_fields->>'field_name' for CRM custom fields" },
      ],
    },
    {
      title: "What's Blocked",
      icon: 'filter',
      items: [
        { label: 'INSERT / UPDATE / DELETE', desc: 'No data modification — workspace is read-only' },
        { label: 'DROP / ALTER / CREATE', desc: 'No schema changes' },
        { label: 'EXECUTE', desc: 'No stored procedure calls' },
        { label: 'Cross-workspace access', desc: 'workspace_id is auto-injected — you only see your data' },
      ],
    },
    {
      title: 'Automatic Guardrails',
      icon: 'building',
      items: [
        { label: 'workspace_id scoping', desc: 'Automatically injected — you never need to filter by it' },
        { label: 'Query timeout', desc: 'Queries abort after 30 seconds' },
        { label: 'Row limit', desc: 'Results capped at 10,000 rows' },
        { label: 'Read-only connection', desc: 'Database user has SELECT-only permissions' },
      ],
    },
    {
      title: 'Common Patterns',
      icon: 'flow',
      content: [
        {
          label: 'Filter by stage',
          sql: "WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')",
        },
        {
          label: 'Join deals to accounts',
          sql: 'FROM deals d\nLEFT JOIN accounts a ON d.account_id = a.id',
        },
        {
          label: 'Count by rep',
          sql: 'SELECT owner, COUNT(*)\nFROM deals\nGROUP BY owner',
        },
        {
          label: 'Access custom fields',
          sql: "SELECT custom_fields->>'lead_source' AS source\nFROM deals",
        },
        {
          label: 'Date filtering',
          sql: "WHERE close_date >= CURRENT_DATE\n  AND close_date < CURRENT_DATE + INTERVAL '90 days'",
        },
        {
          label: 'Conditional counting',
          sql: "COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') AS wins",
        },
      ],
    },
  ];

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: '#00000040', zIndex: 999 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 380,
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
          fontFamily: fonts.body,
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, fontFamily: fonts.body }}>SQL Reference Guide</div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              fontSize: 16,
              padding: '2px 6px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.textSecondary)}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {sections.map((section, si) => (
            <div key={si} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: colors.textSecondary,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: fonts.body,
                }}
              >
                <Icon name={section.icon as any} size={12} style={{ filter: 'brightness(0) saturate(100%) invert(92%) sepia(10%) saturate(301%) hue-rotate(179deg) brightness(100%) contrast(94%)' }} /> {section.title}
              </div>
              {section.items &&
                section.items.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 4,
                      marginBottom: 3,
                      background: colors.bg,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    <span style={{ fontSize: 11, color: colors.text, fontWeight: 600, fontFamily: fonts.body }}>{item.label}</span>
                    <span style={{ fontSize: 10, color: colors.textSecondary, fontFamily: fonts.body }}>{item.desc}</span>
                  </div>
                ))}
              {(section as any).content &&
                (section as any).content.map((item: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 4,
                      marginBottom: 4,
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <span style={{ fontSize: 10, color: colors.textSecondary, fontWeight: 600, fontFamily: fonts.body }}>{item.label}</span>
                    <pre
                      style={{
                        margin: '4px 0 0',
                        padding: 8,
                        background: colors.surface,
                        borderRadius: 4,
                        fontSize: 10.5,
                        lineHeight: 1.5,
                        color: colors.accent,
                        whiteSpace: 'pre-wrap',
                        fontFamily: fonts.mono,
                      }}
                      dangerouslySetInnerHTML={{ __html: highlightSQL(item.sql) }}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Schema Panel ───
function SchemaPanel({ onInsert, expandedTable, setExpandedTable, hoveredCol, setHoveredCol }: SchemaPanelProps) {
  return (
    <div style={{ width: 252, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 14px 8px', borderBottom: `1px solid ${colors.border}` }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: colors.textSecondary,
            fontFamily: fonts.body,
          }}
        >
          Schema
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {Object.entries(SCHEMA).map(([table, { icon, desc, columns }]) => (
          <div key={table}>
            <button
              onClick={() => setExpandedTable(expandedTable === table ? null : table)}
              style={{
                width: '100%',
                padding: '6px 14px',
                background: expandedTable === table ? colors.surfaceHover : 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                color: expandedTable === table ? colors.text : colors.textSecondary,
                fontSize: 11.5,
                textAlign: 'left',
                transition: 'all 0.12s',
                fontFamily: fonts.body,
              }}
              onMouseEnter={(e) => {
                if (expandedTable !== table) e.currentTarget.style.background = colors.surfaceHover + '50';
              }}
              onMouseLeave={(e) => {
                if (expandedTable !== table) e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon name={icon as any} size={12} style={{ filter: expandedTable === table ? 'brightness(0) saturate(100%) invert(92%) sepia(10%) saturate(301%) hue-rotate(179deg) brightness(100%) contrast(94%)' : 'brightness(0) saturate(100%) invert(62%) sepia(11%) saturate(566%) hue-rotate(181deg) brightness(94%) contrast(88%)' }} />
              <div style={{ flex: 1 }}>
                <div>{table}</div>
                {expandedTable === table && (
                  <div style={{ fontSize: 9, color: colors.textSecondary, marginTop: 1, fontFamily: fonts.body }}>{desc}</div>
                )}
              </div>
              <span
                style={{
                  fontSize: 8,
                  color: colors.textTertiary,
                  transform: expandedTable === table ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.12s',
                }}
              >
                ▶
              </span>
            </button>
            {expandedTable === table && (
              <div style={{ padding: '1px 0 4px' }}>
                {columns.map((col: any) => (
                  <button
                    key={col.name}
                    onClick={() => onInsert(`${table}.${col.name}`)}
                    onMouseEnter={() => setHoveredCol({ table, col })}
                    onMouseLeave={() => setHoveredCol(null)}
                    style={{
                      width: '100%',
                      padding: '2px 14px 2px 36px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      color: colors.textSecondary,
                      fontSize: 10.5,
                      textAlign: 'left',
                      transition: 'all 0.08s',
                      fontFamily: fonts.mono,
                    }}
                  >
                    {col.pk && <span style={{ color: colors.yellow, fontSize: 8, fontFamily: fonts.body }}>PK</span>}
                    {col.fk && <span style={{ color: colors.green, fontSize: 8, fontFamily: fonts.body }}>FK</span>}
                    <span>{col.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: colors.textTertiary, fontFamily: fonts.body }}>{col.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Column tooltip */}
      {hoveredCol && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: `1px solid ${colors.border}`,
            background: colors.surface,
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 10, color: colors.accent, fontWeight: 600, fontFamily: fonts.mono }}>
            {hoveredCol.table}.{hoveredCol.col.name}
          </div>
          <div style={{ fontSize: 9.5, color: colors.textSecondary, marginTop: 2, fontFamily: fonts.body }}>{hoveredCol.col.desc}</div>
          <div style={{ fontSize: 9, color: colors.textTertiary, marginTop: 2, fontFamily: fonts.body }}>
            {hoveredCol.col.type}
            {hoveredCol.col.fk ? ` → ${hoveredCol.col.fk}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Results Table ───
function ResultsTable({ results }: ResultsTableProps) {
  if (!results?.length) return null;
  const cols = Object.keys(results[0]);
  const fmt = (v: any, col: string) => {
    if (v === null || v === undefined) return '—';
    if (
      typeof v === 'number' &&
      (col.includes('amount') ||
        col.includes('pipeline') ||
        col.includes('quota') ||
        col.includes('weighted') ||
        col.includes('revenue'))
    )
      return `$${v.toLocaleString()}`;
    if (typeof v === 'number' && col.includes('ratio')) return `${v}x`;
    return String(v);
  };
  return (
    <div style={{ overflowX: 'auto', flex: 1 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: fonts.body }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  color: colors.textSecondary,
                  fontWeight: 600,
                  fontSize: 9.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: `1px solid ${colors.border}`,
                  position: 'sticky',
                  top: 0,
                  background: colors.bg,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => (
            <tr
              key={i}
              style={{ borderBottom: `1px solid ${colors.border}` }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {cols.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: '5px 10px',
                    whiteSpace: 'nowrap',
                    color: typeof row[c] === 'number' ? colors.yellow : colors.text,
                  }}
                >
                  {fmt(row[c], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main App ───
export default function SQLWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [sql, setSQL] = useState(`SELECT d.name, d.amount, d.stage_normalized,
       d.days_in_stage, d.owner, a.name AS account
FROM deals d
JOIN accounts a ON d.account_id = a.id
WHERE d.stage_normalized NOT IN ('closed_won','closed_lost')
  AND d.days_in_stage > 30
  AND d.amount > 50000
ORDER BY d.amount DESC
LIMIT 100`);
  const [expandedTable, setExpandedTable] = useState<string | null>('deals');
  const [hoveredCol, setHoveredCol] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorType | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [validation, setValidation] = useState<ValidationResult>({ errors: [], warnings: [], valid: true });
  const [executing, setExecuting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // Provenance tracking
  const [originalSQL, setOriginalSQL] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceType, setSourceType] = useState<'tool' | 'saved' | 'scratch'>('scratch');
  const [sourceId, setSourceId] = useState('');
  const [savedQueryId, setSavedQueryId] = useState<string | null>(null);

  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Modification tracking
  const isModified = sql !== originalSQL && originalSQL !== '';

  // Read route state on mount
  useEffect(() => {
    const state = location.state as any;
    if (state?.sql) {
      setSQL(state.sql);
      setOriginalSQL(state.sql);
      setSourceName(state.sourceName || '');
      setSourceType(state.sourceType || 'scratch');
      setSourceId(state.sourceId || '');
      setSavedQueryId(state.savedQueryId || null);
    }
  }, [location.state]);

  // Live validation
  useEffect(() => {
    const timer = setTimeout(() => {
      setValidation(validateSQL(sql));
    }, 300);
    return () => clearTimeout(timer);
  }, [sql]);

  const handleRun = async () => {
    setRuntimeError(null);
    setResults([]);
    if (!validation.valid) return;

    setExecuting(true);
    try {
      const response = await api.post('/sql/execute', { sql });
      setResults(response.rows || []);
    } catch (err: any) {
      console.error('[SQLWorkspace] Execution error:', err);
      setRuntimeError({
        message: err.response?.data?.message || err.message || 'Unknown error occurred',
        hint: err.response?.data?.hint,
      });
    } finally {
      setExecuting(false);
    }
  };

  const handleApplyFix = (issue: ValidationIssue) => {
    if (issue.type === 'schema' && issue.suggestion) {
      // Replace bad table name with suggestion
      const regex = new RegExp(`\\b${issue.message.match(/"(\w+)"/)?.[1] || ''}\\b`, 'gi');
      setSQL((prev) => prev.replace(regex, issue.suggestion!));
    } else if (issue.type === 'function' && issue.suggestion) {
      const funcName = issue.message.match(/"(\w+)"/)?.[1] || '';
      const regex = new RegExp(`\\b${funcName}\\b`, 'gi');
      setSQL((prev) => prev.replace(regex, issue.suggestion!.toLowerCase()));
    }
  };

  const handleInsertColumn = (col: string) => {
    if (textareaRef.current) {
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const newVal = sql.substring(0, start) + col + sql.substring(ta.selectionEnd);
      setSQL(newVal);
      setTimeout(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + col.length;
      }, 0);
    }
  };

  const syncScroll = () => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Save As handler - creates a new saved query
  const handleSaveAs = async () => {
    if (!saveName.trim() || !workspaceId) return;

    try {
      const body = {
        name: saveName,
        sql_text: sql,
        source_type: sourceType === 'scratch' ? 'scratch' : sourceType,
        source_id: sourceType !== 'scratch' ? sourceId : undefined,
        source_name: sourceType !== 'scratch' ? sourceName : undefined,
      };

      const saved = await api.post(`/sql/saved`, body);

      // Update state to reflect the new saved query
      setOriginalSQL(sql);
      setSourceName(saved.name);
      setSourceType('saved');
      setSourceId(saved.id);
      setSavedQueryId(saved.id);
      setShowSaveModal(false);
      setSaveName('');
    } catch (err) {
      console.error('Failed to save query:', err);
    }
  };

  // Save Update handler - updates existing saved query
  const handleSaveUpdate = async () => {
    if (!savedQueryId || !workspaceId) return;

    try {
      await api.put(`/sql/saved/${savedQueryId}`, {
        name: sourceName,
        sql_text: sql,
      });
      setOriginalSQL(sql);
    } catch (err) {
      console.error('Failed to update query:', err);
    }
  };

  const statusColor = validation.errors.length > 0 ? colors.red : validation.warnings.length > 0 ? colors.yellow : colors.green;
  const statusText =
    validation.errors.length > 0
      ? `${validation.errors.length} error${validation.errors.length > 1 ? 's' : ''}`
      : validation.warnings.length > 0
        ? `${validation.warnings.length} warning${validation.warnings.length > 1 ? 's' : ''}`
        : 'Valid';

  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 140px)',
        background: colors.bg,
        color: colors.text,
        fontFamily: fonts.body,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Breadcrumb */}
      {(sourceType === 'tool' || sourceType === 'saved') && (
        <div
          style={{
            padding: '8px 18px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: colors.surface,
            fontSize: 12,
            fontFamily: fonts.body,
          }}
        >
          <button
            onClick={() => navigate('/tools')}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.accent,
              fontSize: 12,
              fontFamily: fonts.body,
              cursor: 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
          >
            ← Tools
          </button>
          <span style={{ color: colors.textMuted }}>/</span>
          <span style={{ color: colors.text, fontWeight: 600 }}>{sourceName || 'New Query'}</span>
          {isModified && (
            <span
              style={{
                padding: '2px 6px',
                background: colors.yellow + '20',
                color: colors.yellow,
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Modified
            </span>
          )}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: '10px 18px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: colors.surface,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: fonts.body }}>SQL Workspace</span>
        <div
          style={{
            padding: '2px 8px',
            background: colors.green + '25',
            border: `1px solid ${colors.green}25`,
            borderRadius: 3,
            fontSize: 9,
            color: colors.green,
            fontWeight: 600,
            fontFamily: fonts.body,
          }}
        >
          READ-ONLY
        </div>

        <div style={{ flex: 1 }} />

        {/* Validation status pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            background: colors.surface,
            borderRadius: 4,
            border: `1px solid ${statusColor}25`,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 10, color: statusColor, fontWeight: 600, fontFamily: fonts.body }}>{statusText}</span>
        </div>

        {/* Guide button */}
        <button
          onClick={() => setGuideOpen(true)}
          style={{
            padding: '5px 12px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 5,
            fontSize: 10,
            color: colors.textSecondary,
            cursor: 'pointer',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'all 0.12s',
            fontFamily: fonts.body,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = colors.accent;
            e.currentTarget.style.color = colors.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textSecondary;
          }}
        >
          <span style={{ fontSize: 12 }}>📖</span> Guide
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <SchemaPanel onInsert={handleInsertColumn} expandedTable={expandedTable} setExpandedTable={setExpandedTable} hoveredCol={hoveredCol} setHoveredCol={setHoveredCol} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Editor */}
          <div
            style={{
              position: 'relative',
              height: 200,
              flexShrink: 0,
              borderBottom: `1px solid ${validation.errors.length > 0 ? colors.red : colors.border}`,
            }}
          >
            <pre
              ref={highlightRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                margin: 0,
                padding: '12px 14px',
                fontSize: 12,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                color: colors.text,
                overflow: 'auto',
                pointerEvents: 'none',
                fontFamily: fonts.mono,
              }}
              dangerouslySetInnerHTML={{ __html: highlightSQL(sql) }}
            />
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => {
                setSQL(e.target.value);
                setResults([]);
                setRuntimeError(null);
              }}
              onScroll={syncScroll}
              spellCheck={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                padding: '12px 14px',
                background: 'transparent',
                border: 'none',
                resize: 'none',
                outline: 'none',
                color: 'transparent',
                caretColor: colors.accent,
                fontSize: 12,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                fontFamily: fonts.mono,
              }}
            />
          </div>

          {/* Live error/warning panel */}
          <ErrorPanel errors={validation.errors} warnings={validation.warnings} onApplyFix={handleApplyFix} />

          {/* Action bar */}
          <div
            style={{
              padding: '8px 14px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: colors.surface,
              flexShrink: 0,
            }}
          >
            <button
              onClick={handleRun}
              disabled={!validation.valid || executing}
              style={{
                padding: '6px 16px',
                background: validation.valid && !executing ? colors.accent : colors.border,
                border: 'none',
                borderRadius: 5,
                color: validation.valid && !executing ? 'white' : colors.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: validation.valid && !executing ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'background 0.12s',
                opacity: validation.valid && !executing ? 1 : 0.6,
                fontFamily: fonts.body,
              }}
              onMouseEnter={(e) => {
                if (validation.valid && !executing) e.currentTarget.style.opacity = '0.9';
              }}
              onMouseLeave={(e) => {
                if (validation.valid && !executing) e.currentTarget.style.opacity = '1';
              }}
            >
              {executing ? 'Running...' : '▶ Run'}
              {!validation.valid ? ' (fix errors first)' : ''}
            </button>

            {/* Save button for existing saved queries */}
            {isModified && sourceType === 'saved' && (
              <button
                onClick={handleSaveUpdate}
                style={{
                  padding: '6px 12px',
                  background: colors.green,
                  border: 'none',
                  borderRadius: 5,
                  color: 'white',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: fonts.body,
                  transition: 'opacity 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                💾 Save
              </button>
            )}

            {/* Save As button when modified or scratch with content */}
            {(isModified || (sourceType === 'scratch' && sql.trim())) && (
              <button
                onClick={() => setShowSaveModal(true)}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: `1px solid ${colors.accent}`,
                  borderRadius: 5,
                  color: colors.accent,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: fonts.body,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = colors.accent + '20';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                💾 Save As...
              </button>
            )}
          </div>

          {/* Results area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            {runtimeError && <RuntimeError error={runtimeError} />}
            {results.length > 0 && !runtimeError && <ResultsTable results={results} />}
            {results.length === 0 && !runtimeError && !executing && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: 6,
                  color: colors.textTertiary,
                }}
              >
                <div style={{ fontSize: 28, opacity: 0.3 }}>▶</div>
                <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                  {validation.valid ? 'Run query to see results' : 'Fix errors above to enable execution'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Guide drawer */}
      <GuideDrawer isOpen={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Save Modal */}
      {showSaveModal && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              zIndex: 1000,
            }}
            onClick={() => setShowSaveModal(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 24,
              width: 400,
              maxWidth: '90vw',
              zIndex: 1001,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: colors.text, fontFamily: fonts.body }}>
              Save Query
            </h3>
            {sourceName && sourceType !== 'scratch' && (
              <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body }}>
                Original: {sourceName}
              </p>
            )}
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) {
                  handleSaveAs();
                } else if (e.key === 'Escape') {
                  setShowSaveModal(false);
                }
              }}
              placeholder="e.g. Stalled Enterprise Deals (Q1)"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 13,
                color: colors.text,
                fontFamily: fonts.body,
                marginBottom: 16,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveName('');
                }}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: colors.text,
                  fontFamily: fonts.body,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = colors.surfaceHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAs}
                disabled={!saveName.trim()}
                style={{
                  padding: '8px 16px',
                  background: saveName.trim() ? colors.accent : colors.border,
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: saveName.trim() ? 'white' : colors.textSecondary,
                  fontFamily: fonts.body,
                  cursor: saveName.trim() ? 'pointer' : 'not-allowed',
                  transition: 'opacity 0.12s',
                  opacity: saveName.trim() ? 1 : 0.6,
                }}
                onMouseEnter={(e) => {
                  if (saveName.trim()) e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  if (saveName.trim()) e.currentTarget.style.opacity = '1';
                }}
              >
                Save Filter
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

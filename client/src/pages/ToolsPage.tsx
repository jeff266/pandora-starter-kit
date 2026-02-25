import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { highlightSQL } from '../utils/sql-highlight';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolManifestEntry {
  id: string;
  name: string;
  category: 'query' | 'analysis' | 'metric';
  description: string;
  sql: string;
  source: 'query_tool' | 'skill_compute';
  sourceSkillId?: string;
  status: 'live' | 'disabled';
  schedule?: string;
  lastRunAt?: string;
  lastRunRows?: number;
  lastRunMs?: number;
}

interface SavedQuery {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  sql_text: string;
  source_type: string;
  source_id: string | null;
  source_name: string | null;
  predicates: any[];
  applicable_skills: string[];
  last_run_at: string | null;
  last_run_rows: number | null;
  last_run_ms: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  } catch {
    return '—';
  }
}

function getCategoryBadgeStyle(category: string): React.CSSProperties {
  const styles: Record<string, { bg: string; color: string }> = {
    query: { bg: colors.accent + '20', color: colors.accent },
    analysis: { bg: colors.purple + '20', color: colors.purple },
    metric: { bg: colors.green + '20', color: colors.green },
  };
  const style = styles[category] || styles.query;
  return {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: style.bg,
    color: style.color,
    fontFamily: fonts.sans,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}

// ─── Tool Card Component ──────────────────────────────────────────────────────

interface ToolCardProps {
  tool: ToolManifestEntry;
  expanded: boolean;
  onToggle: () => void;
  onOpenInEditor: () => void;
}

function ToolCard({ tool, expanded, onToggle, onOpenInEditor }: ToolCardProps) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${expanded ? colors.accent : colors.border}`,
        borderRadius: 8,
        marginBottom: 8,
        transition: 'all 0.15s ease',
      }}
    >
      {/* Card Header - Always Visible */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
              {tool.name}
            </span>
            <span style={getCategoryBadgeStyle(tool.category)}>
              {tool.category}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: colors.textSecondary,
              fontFamily: fonts.sans,
              lineHeight: 1.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: expanded ? 'normal' : 'nowrap',
            }}
          >
            {tool.description}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Status Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: tool.status === 'live' ? colors.green : colors.textMuted,
              }}
            />
            <span style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.sans }}>
              {tool.status === 'live' ? 'Live' : 'Disabled'}
            </span>
          </div>

          {/* Last Run Info */}
          {tool.lastRunAt && (
            <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
              {tool.lastRunRows !== undefined && `${tool.lastRunRows} rows · `}
              {tool.lastRunMs !== undefined && `${tool.lastRunMs}ms · `}
              {timeAgo(tool.lastRunAt)}
            </div>
          )}

          {/* Expand Chevron */}
          <div
            style={{
              fontSize: 14,
              color: colors.textSecondary,
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          >
            ▶
          </div>
        </div>
      </div>

      {/* Expanded SQL Display */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${colors.border}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 12,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: colors.textMuted,
                fontFamily: fonts.sans,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Underlying Query
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenInEditor();
              }}
              style={{
                background: colors.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: fonts.sans,
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Open in Editor →
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.6,
              fontFamily: fonts.mono,
              overflow: 'auto',
              maxHeight: 400,
            }}
            dangerouslySetInnerHTML={{ __html: highlightSQL(tool.sql) }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Saved Query Card Component ───────────────────────────────────────────────

interface SavedQueryCardProps {
  query: SavedQuery;
  onEdit: () => void;
  onDelete: () => void;
}

function SavedQueryCard({ query, onEdit, onDelete }: SavedQueryCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await onDelete();
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 16, flexShrink: 0 }}>★</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
          {query.name}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 2 }}>
          {query.source_name && `from ${query.source_name} · `}
          {query.predicates?.length > 0 && `${query.predicates.length} predicates · `}
          {query.applicable_skills?.length > 0 && `${query.applicable_skills.length} applicable skills · `}
          {timeAgo(query.created_at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onEdit}
          style={{
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            color: colors.text,
            fontFamily: fonts.sans,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.surfaceHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          Edit SQL
        </button>
        <button
          onClick={handleDelete}
          style={{
            background: confirmDelete ? colors.red : 'transparent',
            border: `1px solid ${confirmDelete ? colors.red : colors.border}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            color: confirmDelete ? '#fff' : colors.textSecondary,
            fontFamily: fonts.sans,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {confirmDelete ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function ToolsPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [tools, setTools] = useState<ToolManifestEntry[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch tools and saved queries on mount
  useEffect(() => {
    if (!workspaceId) return;

    setLoading(true);
    Promise.all([
      api.get(`/tools/manifest`).catch(() => []),
      api.get(`/sql/saved`).catch(() => []),
    ])
      .then(([toolsData, savedData]) => {
        setTools(Array.isArray(toolsData) ? toolsData : []);
        setSavedQueries(Array.isArray(savedData) ? savedData : []);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const handleDeleteSavedQuery = useCallback(
    async (queryId: string) => {
      try {
        await api.delete(`/sql/saved/${queryId}`);
        setSavedQueries((prev) => prev.filter((q) => q.id !== queryId));
      } catch (err) {
        console.error('Failed to delete saved query:', err);
      }
    },
    []
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: colors.textMuted, fontFamily: fonts.sans }}>
        Loading tools...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: 0, marginBottom: 6 }}>
            Data Tools
          </h1>
          <p style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans, margin: 0 }}>
            Inspect SQL queries used by Pandora to analyze your data. Edit and save custom filters.
          </p>
        </div>
        <button
          onClick={() => navigate('/sql-workspace', { state: { sourceType: 'scratch' } })}
          style={{
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: fonts.sans,
            cursor: 'pointer',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          + New Query
        </button>
      </div>

      {/* Saved Filters Section */}
      {savedQueries.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: colors.textMuted,
              fontFamily: fonts.sans,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            Saved Filters
          </div>
          {savedQueries.map((sq) => (
            <SavedQueryCard
              key={sq.id}
              query={sq}
              onEdit={() =>
                navigate('/sql-workspace', {
                  state: {
                    sql: sq.sql_text,
                    sourceName: sq.name,
                    sourceId: sq.id,
                    sourceType: 'saved',
                    savedQueryId: sq.id,
                  },
                })
              }
              onDelete={() => handleDeleteSavedQuery(sq.id)}
            />
          ))}
        </div>
      )}

      {/* System Tools Section */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: colors.textMuted,
            fontFamily: fonts.sans,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 12,
          }}
        >
          System Tools
        </div>
        {tools.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 48,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              color: colors.textSecondary,
              fontFamily: fonts.sans,
              fontSize: 13,
            }}
          >
            No tools available
          </div>
        )}
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            expanded={expandedTool === tool.id}
            onToggle={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
            onOpenInEditor={() =>
              navigate('/sql-workspace', {
                state: {
                  sql: tool.sql,
                  sourceName: tool.name,
                  sourceId: tool.id,
                  sourceType: 'tool',
                },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

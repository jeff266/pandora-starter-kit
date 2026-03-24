import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import {
  Search,
  Plus,
  Filter as FilterIcon,
  Trash2,
  Check,
  X,
  Database,
  User,
  Settings,
  Activity,
  BarChart2,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Pencil,
} from 'lucide-react';
import { format } from 'date-fns';

function formatSqlDefinition(sql: string | null | undefined): string {
  if (!sql) return '';
  const trimmed = sql.trim();
  if (
    /^1=1(\s+IN\s*\(\))?$/i.test(trimmed) ||
    /^IN\s*\(\)$/i.test(trimmed) ||
    trimmed === '1=1'
  ) return 'All open deals (no filter applied)';
  return sql;
}

interface DictionaryEntry {
  id: string;
  term: string;
  definition: string | null;
  technical_definition: string | null;
  sql_definition: string | null;
  segmentable_by: string[];
  source: 'user' | 'system' | 'filter' | 'metric' | 'stage' | 'scope';
  source_id?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  reference_count: number;
}

const SOURCE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'User', value: 'user', color: colors.accent, icon: User },
  { label: 'System', value: 'system', color: '#94a3b8', icon: Settings },
  { label: 'Filter', value: 'filter', color: '#a855f7', icon: FilterIcon },
  { label: 'Metric', value: 'metric', color: '#3b82f6', icon: BarChart2 },
  { label: 'Stage', value: 'stage', color: '#14b8a6', icon: Activity },
  { label: 'Pipeline', value: 'scope', color: '#f97316', icon: GitBranch },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  color: colors.text,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

export default function DataDictionary() {
  const { currentWorkspace } = useWorkspace();
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedSqlId, setExpandedSqlId] = useState<string | null>(null);

  const [newTerm, setNewTerm] = useState({
    term: '',
    definition: '',
    technical_definition: '',
    sql_definition: '',
  });

  const fetchEntries = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (activeFilter !== 'all') params.append('source', activeFilter);
      const data = await api.get(`/dictionary?${params.toString()}`);
      setEntries(data);
    } catch (err) {
      console.error('Failed to fetch dictionary:', err);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, search, activeFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    try {
      await api.post(`/dictionary`, newTerm);
      setIsAddModalOpen(false);
      setNewTerm({ term: '', definition: '', technical_definition: '', sql_definition: '' });
      fetchEntries();
    } catch (err) {
      console.error('Failed to add term:', err);
    }
  };

  const handleUpdateDefinition = async (id: string) => {
    if (!currentWorkspace) return;
    try {
      await api.put(`/dictionary/${id}`, { definition: editValue });
      setEditingId(null);
      fetchEntries();
    } catch (err) {
      console.error('Failed to update definition:', err);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!currentWorkspace || !window.confirm('Delete this term?')) return;
    try {
      await api.delete(`/dictionary/${id}`);
      fetchEntries();
    } catch (err) {
      console.error('Failed to delete term:', err);
    }
  };

  const getSourceBadge = (source: DictionaryEntry['source']) => {
    const opt = SOURCE_OPTIONS.find(o => o.value === source);
    if (!opt || !opt.color) return null;
    const Icon = opt.icon;
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 6,
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        backgroundColor: `${opt.color}18`, color: opt.color, border: `1px solid ${opt.color}30`,
        whiteSpace: 'nowrap',
      }}>
        {Icon && <Icon size={11} />}
        {opt.label}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', fontFamily: fonts.sans, color: colors.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>Data Dictionary</h1>
          <p style={{ color: colors.textSecondary, fontSize: 14 }}>
            Central repository for all terms, metrics, and technical definitions used across your workspace.
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', backgroundColor: colors.accent, color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14,
            cursor: 'pointer', boxShadow: `0 4px 12px ${colors.accent}30`,
          }}
        >
          <Plus size={18} /> Add Term
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.textMuted }} size={16} />
          <input
            type="text"
            placeholder="Search terms or definitions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 38 }}
            onFocus={e => e.currentTarget.style.borderColor = colors.accent}
            onBlur={e => e.currentTarget.style.borderColor = colors.border}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SOURCE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setActiveFilter(opt.value)}
              style={{
                padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                backgroundColor: activeFilter === opt.value ? colors.surfaceActive : colors.surface,
                color: activeFilter === opt.value ? colors.accent : colors.textSecondary,
                border: `1px solid ${activeFilter === opt.value ? colors.accent : colors.border}`,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.surfaceRaised }}>
              <th style={{ padding: '14px 20px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Term & Definition</th>
              <th style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', width: 110 }}>Source</th>
              <th style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Segments</th>
              <th style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', width: 60 }}>Refs</th>
              <th style={{ padding: '14px 16px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', width: 130 }}>Added</th>
              <th style={{ padding: '14px 16px', width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: colors.textSecondary }}>
                  Loading dictionary entries...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: colors.textSecondary }}>
                  No terms found.
                </td>
              </tr>
            ) : entries.map(entry => (
              <tr key={entry.id} style={{ borderBottom: `1px solid ${colors.border}` }} className="dict-row">
                {/* Term + definition merged cell */}
                <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                  {/* Term name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>{entry.term}</span>
                    {editingId !== entry.id && (
                      <button
                        onClick={() => { setEditingId(entry.id); setEditValue(entry.definition || ''); }}
                        title="Edit definition"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 2, opacity: 0, lineHeight: 1 }}
                        className="dict-edit-btn"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>

                  {/* Definition — editable */}
                  {editingId === entry.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                      <textarea
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        autoFocus
                        rows={3}
                        style={{
                          flex: 1, backgroundColor: colors.bg, border: `1px solid ${colors.accent}`,
                          borderRadius: 6, padding: '8px', color: colors.text, fontSize: 13,
                          resize: 'vertical', outline: 'none', fontFamily: fonts.sans,
                        }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={() => handleUpdateDefinition(entry.id)}
                          style={{ padding: 6, borderRadius: 6, backgroundColor: colors.greenSoft, color: colors.green, border: 'none', cursor: 'pointer' }}>
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingId(null)}
                          style={{ padding: 6, borderRadius: 6, backgroundColor: colors.redSoft, color: colors.red, border: 'none', cursor: 'pointer' }}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditingId(entry.id); setEditValue(entry.definition || ''); }}
                      style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, cursor: 'pointer', marginBottom: 6 }}
                      title="Click to edit"
                    >
                      {entry.definition || (
                        <span style={{ color: colors.textDim, fontStyle: 'italic' }}>Add a definition...</span>
                      )}
                    </div>
                  )}

                  {/* Technical formula + SQL expander */}
                  {entry.technical_definition && (
                    <div
                      onClick={() => entry.sql_definition && setExpandedSqlId(expandedSqlId === entry.id ? null : entry.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, fontFamily: fonts.mono, color: colors.textMuted,
                        cursor: entry.sql_definition ? 'pointer' : 'default',
                        padding: '3px 7px', borderRadius: 4,
                        backgroundColor: colors.surfaceRaised,
                        border: `1px solid ${colors.border}`,
                        marginTop: 2,
                      }}
                    >
                      {entry.technical_definition}
                      {entry.sql_definition && (
                        expandedSqlId === entry.id
                          ? <ChevronUp size={10} style={{ color: colors.accent }} />
                          : <Database size={10} style={{ color: colors.textMuted }} />
                      )}
                    </div>
                  )}

                  {/* SQL block */}
                  {expandedSqlId === entry.id && entry.sql_definition && (
                    <pre style={{
                      marginTop: 8, padding: '10px 14px',
                      backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
                      borderRadius: 6, fontSize: 11, fontFamily: fonts.mono,
                      color: colors.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      overflowX: 'auto',
                    }}>
                      {formatSqlDefinition(entry.sql_definition)}
                    </pre>
                  )}
                </td>

                {/* Source badge */}
                <td style={{ padding: '16px 16px', verticalAlign: 'top' }}>
                  {getSourceBadge(entry.source)}
                </td>

                {/* Segment chips */}
                <td style={{ padding: '16px 16px', verticalAlign: 'top' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {entry.segmentable_by?.length > 0 ? entry.segmentable_by.map(seg => (
                      <span key={seg} style={{
                        padding: '2px 7px', backgroundColor: colors.surfaceRaised,
                        borderRadius: 4, fontSize: 10, fontWeight: 600,
                        color: colors.textMuted, border: `1px solid ${colors.border}`,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {seg}
                      </span>
                    )) : <span style={{ color: colors.textDim, fontSize: 12 }}>—</span>}
                  </div>
                </td>

                {/* Ref count */}
                <td style={{ padding: '16px 16px', verticalAlign: 'top' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 26, height: 26, borderRadius: 13,
                    backgroundColor: (entry.reference_count || 0) > 0 ? `${colors.accent}18` : colors.surfaceRaised,
                    fontSize: 12, fontWeight: 600,
                    color: (entry.reference_count || 0) > 0 ? colors.accent : colors.textSecondary,
                  }}>
                    {entry.reference_count || 0}
                  </div>
                </td>

                {/* Added by / date */}
                <td style={{ padding: '16px 16px', verticalAlign: 'top' }}>
                  <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6 }}>
                    <div>{entry.created_by?.split('@')[0] || 'system'}</div>
                    <div>{format(new Date(entry.created_at), 'MMM d, yyyy')}</div>
                  </div>
                </td>

                {/* Delete */}
                <td style={{ padding: '16px 12px', verticalAlign: 'top' }}>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    style={{ padding: 7, borderRadius: 7, border: 'none', backgroundColor: 'transparent', color: colors.textDim, cursor: 'pointer' }}
                    className="dict-delete-btn"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAddModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: 20,
        }}>
          <div style={{
            backgroundColor: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 16, width: '100%', maxWidth: 520,
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '24px 28px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>Add New Term</h2>
              <button onClick={() => setIsAddModalOpen(false)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>
            <form onSubmit={handleAddTerm} style={{ padding: '28px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Term Name *</label>
                  <input type="text" required placeholder="e.g. Sales Velocity"
                    value={newTerm.term} onChange={e => setNewTerm({ ...newTerm, term: e.target.value })}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Definition *</label>
                  <textarea required rows={4} placeholder="Business-friendly explanation..."
                    value={newTerm.definition} onChange={e => setNewTerm({ ...newTerm, definition: e.target.value })}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: fonts.sans }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Formula / Technical Definition</label>
                  <input type="text" placeholder="e.g. Closed Won / Quota × 100"
                    value={newTerm.technical_definition} onChange={e => setNewTerm({ ...newTerm, technical_definition: e.target.value })}
                    style={{ ...inputStyle, fontFamily: fonts.mono }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SQL Definition</label>
                  <textarea rows={3} placeholder="SELECT ... FROM deals WHERE ..."
                    value={newTerm.sql_definition} onChange={e => setNewTerm({ ...newTerm, sql_definition: e.target.value })}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: fonts.mono }} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button type="button" onClick={() => setIsAddModalOpen(false)}
                    style={{ flex: 1, padding: '11px', backgroundColor: colors.surfaceRaised, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit"
                    style={{ flex: 1, padding: '11px', backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    Add Term
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .dict-row:hover { background-color: ${colors.surfaceHover}; }
        .dict-row:hover .dict-edit-btn { opacity: 1 !important; }
        .dict-delete-btn:hover { background-color: ${colors.redSoft} !important; color: ${colors.red} !important; }
      `}</style>
    </div>
  );
}

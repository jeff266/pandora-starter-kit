import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { 
  Search, 
  Plus, 
  Filter as FilterIcon, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Check, 
  X,
  Database,
  User,
  Settings,
  Activity,
  BarChart2,
  GitBranch,
  Layers
} from 'lucide-react';
import { format } from 'date-fns';

interface DictionaryEntry {
  id: string;
  workspace_id: string;
  term: string;
  definition: string;
  technical_definition: string;
  sql_definition: string | null;
  segmentable_by: string[];
  source: 'user' | 'system' | 'filter' | 'metric' | 'stage' | 'pipeline';
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
  { label: 'Filter', value: 'filter', color: colors.purple, icon: FilterIcon },
  { label: 'Metric', value: 'metric', color: '#3b82f6', icon: BarChart2 },
  { label: 'Stage', value: 'stage', color: '#14b8a6', icon: Activity },
  { label: 'Pipeline', value: 'pipeline', color: colors.orange, icon: GitBranch },
];

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
    segmentable_by: [] as string[]
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

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    try {
      await api.post(`/dictionary`, newTerm);
      setIsAddModalOpen(false);
      setNewTerm({ term: '', definition: '', technical_definition: '', sql_definition: '', segmentable_by: [] });
      fetchEntries();
    } catch (err) {
      console.error('Failed to add term:', err);
    }
  };

  const handleUpdateDefinition = async (id: string) => {
    if (!currentWorkspace) return;
    try {
      await api.put(`/dictionary/${id}`, {
        definition: editValue
      });
      setEditingId(null);
      fetchEntries();
    } catch (err) {
      console.error('Failed to update definition:', err);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!currentWorkspace || !window.confirm('Are you sure you want to delete this term?')) return;
    try {
      await api.delete(`/dictionary/${id}`);
      fetchEntries();
    } catch (err) {
      console.error('Failed to delete term:', err);
    }
  };

  const getSourceBadge = (source: DictionaryEntry['source']) => {
    const option = SOURCE_OPTIONS.find(o => o.value === source);
    if (!option) return null;
    const Icon = option.icon;

    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        backgroundColor: `${option.color}15`,
        color: option.color,
        border: `1px solid ${option.color}30`
      }}>
        {Icon && <Icon size={12} />}
        {option.label}
      </div>
    );
  };

  return (
    <div style={{ 
      maxWidth: 1200, 
      margin: '0 auto', 
      fontFamily: fonts.sans,
      color: colors.text
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-end',
        marginBottom: 32
      }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>Data Dictionary</h1>
          <p style={{ color: colors.textSecondary, fontSize: 14 }}>
            Central repository for all terms, metrics, and technical definitions used across your workspace.
          </p>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            backgroundColor: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: `0 4px 12px ${colors.accent}30`,
            transition: 'transform 0.1s'
          }}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Plus size={18} />
          Add Term
        </button>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: 16, 
        marginBottom: 24,
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 300 }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.textMuted }} size={18} />
          <input 
            type="text"
            placeholder="Search terms or definitions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px 10px 40px',
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              color: colors.text,
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => e.currentTarget.style.borderColor = colors.accent}
            onBlur={e => e.currentTarget.style.borderColor = colors.border}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {SOURCE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setActiveFilter(opt.value)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                backgroundColor: activeFilter === opt.value ? colors.surfaceActive : colors.surface,
                color: activeFilter === opt.value ? colors.accent : colors.textSecondary,
                border: `1px solid ${activeFilter === opt.value ? colors.accent : colors.border}`,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ 
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.surfaceRaised }}>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Term</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Definition</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Source</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Segments</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary, width: 100 }}>Refs</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>Details</th>
              <th style={{ padding: '16px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary, width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                  Loading dictionary entries...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                  No terms found matching your criteria.
                </td>
              </tr>
            ) : (
              entries.map(entry => (
                <tr key={entry.id} style={{ borderBottom: `1px solid ${colors.border}`, transition: 'background-color 0.1s' }} className="table-row-hover">
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontWeight: 600, color: colors.text }}>{entry.term}</div>
                    {entry.technical_definition && (
                      <div 
                        onClick={() => entry.sql_definition && setExpandedSqlId(expandedSqlId === entry.id ? null : entry.id)}
                        style={{ 
                          fontSize: 11, 
                          fontFamily: fonts.mono, 
                          color: colors.textMuted, 
                          marginTop: 4,
                          cursor: entry.sql_definition ? 'pointer' : 'default',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        {entry.technical_definition}
                        {entry.sql_definition && (
                          <Database size={10} style={{ color: expandedSqlId === entry.id ? colors.accent : colors.textMuted }} />
                        )}
                      </div>
                    )}
                    {expandedSqlId === entry.id && entry.sql_definition && (
                      <div style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        backgroundColor: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily: fonts.mono,
                        color: colors.textSecondary,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                      }}>
                        {entry.sql_definition}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '16px 20px', minWidth: 300 }}>
                    {editingId === entry.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <textarea
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          autoFocus
                          style={{
                            flex: 1,
                            backgroundColor: colors.bg,
                            border: `1px solid ${colors.accent}`,
                            borderRadius: 6,
                            padding: '8px',
                            color: colors.text,
                            fontSize: 13,
                            minHeight: 60,
                            resize: 'vertical',
                            outline: 'none'
                          }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button 
                            onClick={() => handleUpdateDefinition(entry.id)}
                            style={{ padding: 6, borderRadius: 6, backgroundColor: colors.greenSoft, color: colors.green, border: 'none', cursor: 'pointer' }}
                          >
                            <Check size={16} />
                          </button>
                          <button 
                            onClick={() => setEditingId(null)}
                            style={{ padding: 6, borderRadius: 6, backgroundColor: colors.redSoft, color: colors.red, border: 'none', cursor: 'pointer' }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div 
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditValue(entry.definition || '');
                        }}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8 }}
                        className="definition-cell"
                      >
                        <span style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.5 }}>
                          {entry.definition || <span style={{ color: colors.textDim, fontStyle: 'italic' }}>No definition provided</span>}
                        </span>
                        <Edit2 size={12} style={{ color: colors.textMuted, marginTop: 4, opacity: 0 }} className="edit-icon" />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    {getSourceBadge(entry.source)}
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {entry.segmentable_by && entry.segmentable_by.length > 0 ? (
                        entry.segmentable_by.map(seg => (
                          <div key={seg} style={{
                            padding: '2px 6px',
                            backgroundColor: colors.surfaceRaised,
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            color: colors.textMuted,
                            border: `1px solid ${colors.border}`
                          }}>
                            {seg}
                          </div>
                        ))
                      ) : (
                        <span style={{ color: colors.textDim }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      minWidth: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: colors.surfaceRaised,
                      fontSize: 12,
                      fontWeight: 600,
                      color: colors.textSecondary
                    }}>
                      {entry.reference_count || 0}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 12, color: colors.textMuted }}>
                      <div>By {entry.created_by?.split('@')[0]}</div>
                      <div>{format(new Date(entry.created_at), 'MMM d, yyyy')}</div>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <button 
                      onClick={() => handleDeleteEntry(entry.id)}
                      style={{ 
                        padding: 8, 
                        borderRadius: 8, 
                        border: 'none', 
                        backgroundColor: 'transparent', 
                        color: colors.textDim, 
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.backgroundColor = colors.redSoft;
                        e.currentTarget.style.color = colors.red;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = colors.textDim;
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isAddModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20
        }}>
          <div style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            width: '100%',
            maxWidth: 500,
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '24px 32px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>Add New Term</h2>
              <button onClick={() => setIsAddModalOpen(false)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddTerm} style={{ padding: '32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>Term Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sales Velocity"
                    value={newTerm.term}
                    onChange={e => setNewTerm({ ...newTerm, term: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      fontSize: 14,
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>Definition</label>
                  <textarea
                    required
                    placeholder="Clear, business-level definition..."
                    value={newTerm.definition}
                    onChange={e => setNewTerm({ ...newTerm, definition: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      fontSize: 14,
                      outline: 'none',
                      minHeight: 100,
                      resize: 'vertical'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>Technical Definition / Formula (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. (closed_won_value / total_pipeline) * 100"
                    value={newTerm.technical_definition}
                    onChange={e => setNewTerm({ ...newTerm, technical_definition: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      fontSize: 14,
                      outline: 'none',
                      fontFamily: fonts.mono
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: colors.surfaceRaised,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: colors.accent,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Add Term
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .table-row-hover:hover {
          background-color: ${colors.surfaceHover};
        }
        .definition-cell:hover .edit-icon {
          opacity: 1 !important;
        }
        .definition-cell:hover span {
          color: ${colors.text} !important;
        }
      `}</style>
    </div>
  );
}

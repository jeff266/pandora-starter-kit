import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export interface IssueTreeNode {
  node_id: string;
  title: string;
  standing_question: string | null;
  mece_category: string;
  primary_skill_ids: string[];
  position: number;
  confirmed_pattern: boolean;
  pattern_summary: string | null;
}

interface IssueTreeEditorProps {
  workspaceId: string;
  agentId: string;
  agentGoal: string;
  onSave?: () => void;
}

const MECE_CATEGORIES = [
  { id: 'generation', label: 'Generation', description: 'Top of funnel, pipeline creation' },
  { id: 'conversion', label: 'Conversion', description: 'Mid funnel, stage progression' },
  { id: 'execution', label: 'Execution', description: 'Late funnel, closing and forecast' },
  { id: 'retention', label: 'Retention', description: 'Post-close, expansion and churn' },
  { id: 'custom', label: 'Custom', description: 'Doesn\'t fit standard categories' },
];

function generateNodeId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40);
}

function MECECoverageIndicator({ nodes }: { nodes: IssueTreeNode[] }) {
  const covered = new Set(nodes.map(n => n.mece_category));
  const standard = MECE_CATEGORIES.filter(c => c.id !== 'custom');
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
      {standard.map(cat => {
        const isCovered = covered.has(cat.id);
        return (
          <div
            key={cat.id}
            title={cat.description}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              background: isCovered ? '#F0FDF9' : '#F8FAFC',
              color: isCovered ? '#0D9488' : '#94A3B8',
              border: '0.5px solid',
              borderColor: isCovered ? '#0D9488' : '#E2E8F0',
            }}
          >
            {isCovered ? '✓' : '○'} {cat.label}
          </div>
        );
      })}
      {nodes.some(n => n.mece_category === 'custom') && (
        <div style={{
          padding: '3px 10px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 500,
          background: '#F0FDF9',
          color: '#0D9488',
          border: '0.5px solid #0D9488',
        }}>
          ✓ Custom
        </div>
      )}
    </div>
  );
}

interface NodeEditFormProps {
  node: IssueTreeNode | null;
  availableSkills: { id: string; name: string }[];
  onSave: (node: IssueTreeNode) => Promise<void>;
  onCancel: () => void;
  nextPosition?: number;
  agentId: string;
}

function NodeEditForm({ node, availableSkills, onSave, onCancel, nextPosition = 1, agentId }: NodeEditFormProps) {
  const [title, setTitle] = useState(node?.title ?? '');
  const [question, setQuestion] = useState(node?.standing_question ?? '');
  const [category, setCategory] = useState(node?.mece_category ?? 'custom');
  const [selectedSkills, setSelectedSkills] = useState<string[]>(node?.primary_skill_ids ?? []);
  const [skillSearch, setSkillSearch] = useState('');
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredSkills = availableSkills.filter(
    s => !selectedSkills.includes(s.id) &&
         (s.name.toLowerCase().includes(skillSearch.toLowerCase()) ||
          s.id.toLowerCase().includes(skillSearch.toLowerCase()))
  );

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const nodeId = node?.node_id ?? generateNodeId(title);
      await onSave({
        node_id: nodeId,
        title: title.trim(),
        standing_question: question.trim() || null,
        mece_category: category,
        primary_skill_ids: selectedSkills,
        position: node?.position ?? nextPosition,
        confirmed_pattern: node?.confirmed_pattern ?? false,
        pattern_summary: node?.pattern_summary ?? null,
      });
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 10px',
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    fontSize: 13,
    color: '#1E293B',
    background: '#FFFFFF',
    outline: 'none',
    fontFamily: 'inherit',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div style={{
      border: '1px solid #0D9488',
      borderRadius: 8,
      padding: 16,
      background: '#FFFFFF',
      marginBottom: 8,
    }}>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Section title</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Deal Execution"
          style={inputStyle}
          autoFocus
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Standing question</label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. Can we hit the quarterly target and which deals can close?"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>MECE category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {MECE_CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Skills for this section</label>
        {selectedSkills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selectedSkills.map(skillId => {
              const skill = availableSkills.find(s => s.id === skillId);
              return (
                <span key={skillId} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 4, fontSize: 12,
                  background: '#F0FDF9', color: '#0D9488', border: '1px solid #0D9488',
                }}>
                  {skill?.name ?? skillId}
                  <button
                    onClick={() => setSelectedSkills(prev => prev.filter(s => s !== skillId))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0D9488', padding: 0, lineHeight: 1, fontSize: 14 }}
                  >×</button>
                </span>
              );
            })}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <input
            value={skillSearch}
            onChange={e => { setSkillSearch(e.target.value); setShowSkillDropdown(true); }}
            onFocus={() => setShowSkillDropdown(true)}
            onBlur={() => setTimeout(() => setShowSkillDropdown(false), 150)}
            placeholder="Search skills..."
            style={inputStyle}
          />
          {showSkillDropdown && filteredSkills.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 200, overflowY: 'auto',
            }}>
              {filteredSkills.slice(0, 20).map(skill => (
                <div
                  key={skill.id}
                  onMouseDown={() => {
                    setSelectedSkills(prev => [...prev, skill.id]);
                    setSkillSearch('');
                    setShowSkillDropdown(false);
                  }}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#374151',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontWeight: 500 }}>{skill.name}</span>
                  <span style={{ color: '#94A3B8', fontSize: 11, marginLeft: 6 }}>{skill.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '7px 16px', fontSize: 13, cursor: 'pointer',
            background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, color: '#64748B',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          style={{
            padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer',
            background: '#0D9488', color: '#FFFFFF', border: 'none', borderRadius: 6,
            opacity: saving || !title.trim() ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save section'}
        </button>
      </div>
    </div>
  );
}

interface NodeReadCardProps {
  node: IssueTreeNode;
  availableSkills: { id: string; name: string }[];
  onEdit: () => void;
  onDelete: () => void;
}

function NodeReadCard({ node, availableSkills, onEdit, onDelete }: NodeReadCardProps) {
  return (
    <div style={{
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      padding: '12px 16px',
      background: '#FFFFFF',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#94A3B8', fontSize: 16, cursor: 'grab', userSelect: 'none' }}>⠿</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {node.title}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
              MECE: {node.mece_category}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={onEdit}
            style={{
              fontSize: 12, color: '#0D9488', cursor: 'pointer',
              background: 'none', border: '1px solid #0D9488', borderRadius: 4,
              padding: '3px 10px', fontWeight: 500,
            }}
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            style={{
              fontSize: 12, color: '#94A3B8', cursor: 'pointer',
              background: 'none', border: 'none', padding: '3px 4px',
            }}
            title="Delete section"
          >
            ×
          </button>
        </div>
      </div>

      {node.standing_question && (
        <div style={{ fontSize: 13, color: '#374151', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
          "{node.standing_question}"
        </div>
      )}

      {node.primary_skill_ids.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
          <span style={{ fontWeight: 500 }}>Skills: </span>
          {node.primary_skill_ids.map(id => {
            const skill = availableSkills.find(s => s.id === id);
            return skill?.name ?? id;
          }).join(', ')}
        </div>
      )}

      {node.confirmed_pattern && node.pattern_summary && (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: '#F0FDF9', borderRadius: 4, fontSize: 12,
          color: '#0D9488', display: 'flex', gap: 6, alignItems: 'flex-start',
        }}>
          <span>✓ Confirmed pattern (6+ weeks)</span>
          <span style={{ color: '#047857' }}>"{node.pattern_summary}"</span>
        </div>
      )}
    </div>
  );
}

export default function IssueTreeEditor({ workspaceId, agentId, agentGoal, onSave }: IssueTreeEditorProps) {
  const [nodes, setNodes] = useState<IssueTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ id: string; name: string }[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [nodesData, skillsData] = await Promise.all([
          api.get(`/agents/${agentId}/issue-tree`),
          api.get('/skills/dashboard').catch(() => ({ skills: [] })),
        ]);
        setNodes(Array.isArray(nodesData) ? nodesData : []);
        setAvailableSkills(Array.isArray(skillsData?.skills) ? skillsData.skills : []);
      } catch (err) {
        console.error('[IssueTreeEditor] load failed:', err);
        setNodes([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [agentId]);

  async function saveNode(updated: IssueTreeNode) {
    const result = await api.patch(`/agents/${agentId}/issue-tree/${updated.node_id}`, {
      title: updated.title,
      standing_question: updated.standing_question,
      mece_category: updated.mece_category,
      primary_skill_ids: updated.primary_skill_ids,
      position: updated.position,
    });
    setNodes(prev => prev.map(n => n.node_id === updated.node_id ? result : n));
    onSave?.();
  }

  async function addNode(newNode: IssueTreeNode) {
    const result = await api.post(`/agents/${agentId}/issue-tree`, {
      node_id: newNode.node_id,
      title: newNode.title,
      standing_question: newNode.standing_question,
      mece_category: newNode.mece_category,
      primary_skill_ids: newNode.primary_skill_ids,
      position: newNode.position,
    });
    setNodes(prev => [...prev, result]);
    onSave?.();
  }

  async function deleteNode(nodeId: string) {
    const node = nodes.find(n => n.node_id === nodeId);
    if (!node) return;
    if (!window.confirm(`Remove this section?\nThe report will no longer cover "${node.title}".`)) return;
    await api.delete(`/agents/${agentId}/issue-tree/${nodeId}`);
    setNodes(prev => prev.filter(n => n.node_id !== nodeId));
    onSave?.();
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'));
    if (sourceIndex === targetIndex) {
      setDragOverIndex(null);
      return;
    }
    const reordered = [...nodes];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const updated = reordered.map((n, i) => ({ ...n, position: i + 1 }));
    setNodes(updated);
    api.patch(`/agents/${agentId}/issue-tree/reorder`, {
      positions: updated.map(n => ({ node_id: n.node_id, position: n.position })),
    }).catch(err => console.error('[IssueTreeEditor] reorder failed:', err));
    setDragOverIndex(null);
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: '#94A3B8', fontSize: 13 }}>
        Loading issue tree...
      </div>
    );
  }

  const sortedNodes = [...nodes].sort((a, b) => a.position - b.position);

  return (
    <div style={{ padding: '0 0 24px' }}>
      {agentGoal && (
        <div style={{
          fontSize: 12, color: '#64748B',
          marginBottom: 20,
          padding: '10px 14px',
          background: '#F8FAFC',
          borderRadius: 6,
          borderLeft: '3px solid #0D9488',
        }}>
          <span style={{ fontWeight: 500, color: '#374151' }}>Agent goal:</span> {agentGoal}
        </div>
      )}

      <MECECoverageIndicator nodes={nodes} />

      {sortedNodes.map((node, index) => (
        <div
          key={node.node_id}
          draggable={editingNodeId !== node.node_id}
          onDragStart={e => handleDragStart(e, index)}
          onDragOver={e => handleDragOver(e, index)}
          onDrop={e => handleDrop(e, index)}
          onDragLeave={() => setDragOverIndex(null)}
          style={{
            borderTop: dragOverIndex === index ? '2px solid #0D9488' : '2px solid transparent',
          }}
        >
          {editingNodeId === node.node_id ? (
            <NodeEditForm
              node={node}
              availableSkills={availableSkills}
              onSave={async (updated) => {
                await saveNode(updated);
                setEditingNodeId(null);
              }}
              onCancel={() => setEditingNodeId(null)}
              agentId={agentId}
            />
          ) : (
            <NodeReadCard
              node={node}
              availableSkills={availableSkills}
              onEdit={() => setEditingNodeId(node.node_id)}
              onDelete={() => deleteNode(node.node_id)}
            />
          )}
        </div>
      ))}

      {showAddForm ? (
        <NodeEditForm
          node={null}
          availableSkills={availableSkills}
          onSave={async (newNode) => {
            await addNode(newNode);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
          nextPosition={nodes.length + 1}
          agentId={agentId}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 13,
            color: '#0D9488',
            background: 'none',
            border: '1px dashed #0D9488',
            borderRadius: 8,
            cursor: 'pointer',
            marginTop: 8,
            fontFamily: 'inherit',
          }}
        >
          + Add section
        </button>
      )}
    </div>
  );
}

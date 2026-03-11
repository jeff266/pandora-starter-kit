import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import Placeholder from '@tiptap/extension-placeholder';
import type { SectionContent, MetricCard, ActionItem } from './types';
import { colors, fonts } from '../../styles/theme';

export interface Annotation {
  block_id: string;
  type: 'strike' | 'override' | 'note';
  original_value: string;
  new_value: string | null;
  annotated_by: string;
  annotated_at: string;
}

interface AnnotationState {
  [blockId: string]: Annotation;
}

interface MetricOverride {
  [blockId: string]: string;
}

interface ReportAnnotationEditorProps {
  generationId: string;
  sectionsContent: SectionContent[];
  existingAnnotations?: Annotation[];
  userId: string;
  onSave: (annotations: Annotation[], mergedSections: SectionContent[]) => Promise<void>;
  onCancel: () => void;
}

export default function ReportAnnotationEditor({
  generationId,
  sectionsContent,
  existingAnnotations = [],
  userId,
  onSave,
  onCancel,
}: ReportAnnotationEditorProps) {
  const [annotations, setAnnotations] = useState<AnnotationState>(() => {
    const state: AnnotationState = {};
    for (const a of existingAnnotations) {
      state[a.block_id] = a;
    }
    return state;
  });
  const [metricOverrides, setMetricOverrides] = useState<MetricOverride>({});
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ [blockId: string]: string }>({});
  const [addingNote, setAddingNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const now = () => new Date().toISOString();

  const toggleStrike = (blockId: string, originalValue: string) => {
    setAnnotations(prev => {
      const existing = prev[blockId];
      if (existing?.type === 'strike') {
        const next = { ...prev };
        delete next[blockId];
        return next;
      }
      return {
        ...prev,
        [blockId]: {
          block_id: blockId,
          type: 'strike',
          original_value: originalValue,
          new_value: null,
          annotated_by: userId,
          annotated_at: now(),
        },
      };
    });
  };

  const saveMetricOverride = (blockId: string, originalValue: string, newValue: string) => {
    if (!newValue.trim()) return;
    setAnnotations(prev => ({
      ...prev,
      [blockId]: {
        block_id: blockId,
        type: 'override',
        original_value: originalValue,
        new_value: newValue.trim(),
        annotated_by: userId,
        annotated_at: now(),
      },
    }));
    setMetricOverrides(prev => ({ ...prev, [blockId]: newValue.trim() }));
    setEditingMetric(null);
  };

  const saveNote = (blockId: string, originalValue: string) => {
    const noteText = notes[blockId];
    if (!noteText?.trim()) { setAddingNote(null); return; }
    setAnnotations(prev => ({
      ...prev,
      [blockId + ':note']: {
        block_id: blockId + ':note',
        type: 'note',
        original_value: originalValue,
        new_value: noteText.trim(),
        annotated_by: userId,
        annotated_at: now(),
      },
    }));
    setAddingNote(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const annotationList = Object.values(annotations);
      const mergedSections = sectionsContent.map(section => {
        const mergedMetrics = (section.metrics || []).map((metric, idx) => {
          const blockId = `${section.section_id}:metric:${idx}`;
          const override = annotations[blockId];
          if (override?.type === 'override' && override.new_value) {
            return { ...metric, value: override.new_value };
          }
          return metric;
        });
        const mergedActions = (section.action_items || []).filter((_, idx) => {
          const blockId = `${section.section_id}:action:${idx}`;
          return annotations[blockId]?.type !== 'strike';
        });
        return { ...section, metrics: mergedMetrics, action_items: mergedActions };
      });
      await onSave(annotationList, mergedSections);
    } finally {
      setSaving(false);
    }
  };

  const isStruck = (blockId: string) => annotations[blockId]?.type === 'strike';
  const getOverride = (blockId: string) => annotations[blockId]?.type === 'override' ? annotations[blockId].new_value : null;

  return (
    <div style={{ fontFamily: fonts.sans }}>
      {sectionsContent.map(section => (
        <div key={section.section_id} style={{
          background: colors.surface,
          border: `1px solid ${colors.accent}44`,
          borderRadius: 10,
          marginBottom: 24,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: colors.text, margin: 0 }}>{section.title}</h2>
            <span style={{ fontSize: 11, color: colors.textMuted }}>Section</span>
          </div>

          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Metrics */}
            {section.metrics && section.metrics.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Metrics</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {section.metrics.map((metric, idx) => {
                    const blockId = `${section.section_id}:metric:${idx}`;
                    const overrideVal = getOverride(blockId);
                    const isEditing = editingMetric === blockId;
                    return (
                      <div key={idx} style={{
                        border: `1px solid ${colors.border}`,
                        background: colors.surfaceRaised,
                        borderLeft: `4px solid ${colors.accent}`,
                        borderRadius: 8,
                        padding: 14,
                        position: 'relative',
                      }}>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted, fontWeight: 600 }}>{metric.label}</div>
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          {overrideVal ? (
                            <>
                              <span style={{ fontSize: 18, fontWeight: 700, color: colors.textMuted, textDecoration: 'line-through', opacity: 0.5 }}>{metric.value}</span>
                              <span style={{ fontSize: 20, fontWeight: 700, color: '#00BFA5' }}>{overrideVal}</span>
                            </>
                          ) : (
                            <span style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{metric.value}</span>
                          )}
                        </div>
                        {isEditing ? (
                          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                            <input
                              autoFocus
                              defaultValue={overrideVal || metric.value}
                              style={{
                                flex: 1, fontSize: 13, padding: '4px 8px',
                                background: colors.bg, border: `1px solid ${colors.accent}`,
                                borderRadius: 5, color: colors.text,
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveMetricOverride(blockId, metric.value, (e.target as HTMLInputElement).value);
                                if (e.key === 'Escape') setEditingMetric(null);
                              }}
                            />
                            <button
                              onClick={e => {
                                const input = (e.currentTarget.previousSibling as HTMLInputElement);
                                saveMetricOverride(blockId, metric.value, input?.value || '');
                              }}
                              style={{ fontSize: 11, padding: '4px 8px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
                            >Save</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingMetric(blockId)}
                            style={{
                              position: 'absolute', top: 8, right: 8,
                              fontSize: 10, padding: '2px 7px',
                              background: colors.accentSoft, color: colors.accent,
                              border: `1px solid ${colors.accent}44`, borderRadius: 4,
                              cursor: 'pointer', fontWeight: 600,
                            }}
                          >Override</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Narrative */}
            {section.narrative && (
              <NarrativeEditor
                sectionId={section.section_id}
                narrative={section.narrative}
                annotations={annotations}
                onAnnotate={(blockId, original, newVal) => {
                  setAnnotations(prev => ({
                    ...prev,
                    [blockId]: { block_id: blockId, type: 'override', original_value: original, new_value: newVal, annotated_by: userId, annotated_at: now() },
                  }));
                }}
              />
            )}

            {/* Action Items */}
            {section.action_items && section.action_items.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Action Items</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {section.action_items.map((action, idx) => {
                    const blockId = `${section.section_id}:action:${idx}`;
                    const struck = isStruck(blockId);
                    const isAddingNote = addingNote === blockId;
                    const urgencyColor = action.urgency === 'today' ? '#dc2626' : action.urgency === 'this_week' ? '#f59e0b' : '#22c55e';
                    const noteKey = blockId + ':note';
                    const noteAnnotation = annotations[noteKey];
                    return (
                      <div key={idx}>
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: 12, background: colors.surfaceRaised, borderRadius: 8,
                          opacity: struck ? 0.45 : 1,
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: urgencyColor }}>{action.urgency?.replace('_', ' ').toUpperCase()}</span>
                              <span style={{
                                fontSize: 14, color: colors.text,
                                textDecoration: struck ? 'line-through' : 'none',
                                textDecorationColor: '#f87171',
                              }}>{action.action}</span>
                            </div>
                            {action.owner && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 3 }}>Owned by: {action.owner}</div>}
                            {struck && <div style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>Removed by annotation</div>}
                            {noteAnnotation && (
                              <div style={{
                                marginTop: 8, padding: '6px 10px',
                                borderLeft: '2px solid #00BFA5',
                                background: 'rgba(0,191,165,0.07)',
                                borderRadius: '0 5px 5px 0',
                                fontSize: 12, color: colors.textSecondary, fontStyle: 'italic',
                              }}>
                                {noteAnnotation.new_value}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button
                              onClick={() => toggleStrike(blockId, action.action)}
                              style={{
                                fontSize: 11, padding: '3px 8px',
                                background: struck ? '#7f1d1d44' : colors.surfaceHover,
                                color: struck ? '#f87171' : colors.textMuted,
                                border: `1px solid ${struck ? '#f8717144' : colors.border}`,
                                borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                              }}
                            >{struck ? 'Restore' : 'Strike'}</button>
                            {!struck && (
                              <button
                                onClick={() => setAddingNote(isAddingNote ? null : blockId)}
                                style={{
                                  fontSize: 11, padding: '3px 8px',
                                  background: colors.surfaceHover, color: colors.textMuted,
                                  border: `1px solid ${colors.border}`,
                                  borderRadius: 4, cursor: 'pointer',
                                }}
                              >+ Note</button>
                            )}
                          </div>
                        </div>
                        {isAddingNote && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                            <input
                              autoFocus
                              placeholder="Add annotation note..."
                              value={notes[blockId] || ''}
                              onChange={e => setNotes(prev => ({ ...prev, [blockId]: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveNote(blockId, action.action);
                                if (e.key === 'Escape') setAddingNote(null);
                              }}
                              style={{
                                flex: 1, fontSize: 13, padding: '6px 10px',
                                background: colors.bg, border: `1px solid ${colors.accent}`,
                                borderRadius: 6, color: colors.text,
                              }}
                            />
                            <button
                              onClick={() => saveNote(blockId, action.action)}
                              style={{ fontSize: 12, padding: '6px 12px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                            >Save</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Save Toolbar */}
      <div style={{
        position: 'sticky', bottom: 0,
        background: colors.surface, borderTop: `1px solid ${colors.accent}55`,
        padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
      }}>
        <span style={{ fontSize: 12, color: colors.textMuted, marginRight: 'auto' }}>
          {Object.keys(annotations).length} annotation{Object.keys(annotations).length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onCancel}
          style={{
            fontSize: 13, padding: '8px 18px', borderRadius: 8,
            background: colors.surfaceHover, color: colors.text,
            border: `1px solid ${colors.border}`, cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(annotations).length === 0}
          style={{
            fontSize: 13, fontWeight: 600, padding: '8px 20px', borderRadius: 8,
            background: Object.keys(annotations).length === 0 ? colors.surfaceHover : colors.accent,
            color: Object.keys(annotations).length === 0 ? colors.textMuted : '#fff',
            border: 'none', cursor: Object.keys(annotations).length === 0 ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving...' : 'Save as V2'}</button>
      </div>
    </div>
  );
}

function NarrativeEditor({
  sectionId,
  narrative,
  annotations,
  onAnnotate,
}: {
  sectionId: string;
  narrative: string;
  annotations: AnnotationState;
  onAnnotate: (blockId: string, original: string, newValue: string) => void;
}) {
  const blockId = `${sectionId}:narrative`;
  const override = annotations[blockId];

  const editor = useEditor({
    extensions: [
      StarterKit,
      Strike,
      Placeholder.configure({ placeholder: 'Edit the narrative here...' }),
    ],
    content: override?.new_value ?? narrative,
    onBlur: ({ editor: e }) => {
      const text = e.getText();
      if (text !== narrative) {
        onAnnotate(blockId, narrative, text);
      }
    },
  });

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Narrative</div>
      {override && (
        <div style={{ fontSize: 11, color: '#00BFA5', marginBottom: 6, fontWeight: 500 }}>✎ Edited</div>
      )}
      <div style={{
        borderLeft: override ? '2px solid #00BFA5' : `2px solid ${colors.border}`,
        paddingLeft: 14,
        color: colors.textSecondary,
        lineHeight: 1.7,
        fontSize: 14,
      }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

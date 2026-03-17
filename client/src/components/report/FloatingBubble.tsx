import React, { useState, useLayoutEffect, useEffect } from 'react';
import type { Annotation } from './AnnotatableSection';

interface FloatingBubbleProps {
  paragraphText: string;
  sectionId: string;
  paragraphIndex: number;
  existingAnnotation?: Annotation;
  anchorRef: React.RefObject<HTMLElement | null>;
  onSave: (
    type: Annotation['annotation_type'],
    content: string
  ) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function FloatingBubble({
  paragraphText,
  sectionId,
  paragraphIndex,
  existingAnnotation,
  anchorRef,
  onSave,
  onDelete,
  onClose,
}: FloatingBubbleProps) {
  const [selectedType, setSelectedType] =
    useState<Annotation['annotation_type']>(
      existingAnnotation?.annotation_type ?? 'note'
    );
  const [content, setContent] =
    useState(existingAnnotation?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [position, setPosition] =
    useState({ top: 0, left: 0 });

  // Position the bubble relative to the paragraph
  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const bubbleHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom;

    setPosition({
      top: spaceBelow >= bubbleHeight
        ? rect.bottom + window.scrollY + 8
        : rect.top + window.scrollY - bubbleHeight - 8,
      left: Math.min(
        rect.left + window.scrollX,
        window.innerWidth - 496  // 480px + 16px margin
      ),
    });
  }, [anchorRef.current]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        handleSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [content, selectedType]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(selectedType, content);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: '480px',
        zIndex: 50,
        background: 'white',
        border: '1px solid #E2E8F0',
        borderRadius: '8px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}
    >
      {/* Type selector tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #E2E8F0',
        padding: '8px 8px 0'
      }}>
        {(['note', 'override', 'flag'] as const).map(type => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: selectedType === type ? 600 : 400,
              color: selectedType === type
                ? '#3B82F6' : '#64748B',
              background: 'none',
              border: 'none',
              borderBottom: selectedType === type
                ? '2px solid #3B82F6' : '2px solid transparent',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {type}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px' }}>
        {/* Override: show original text preview */}
        {selectedType === 'override' && (
          <div style={{
            fontSize: '12px',
            color: '#94A3B8',
            marginBottom: '8px',
            fontStyle: 'italic',
          }}>
            <span style={{ fontWeight: 600 }}>Replacing: </span>
            {paragraphText.slice(0, 120)}
            {paragraphText.length > 120 ? '…' : ''}
          </div>
        )}

        {/* Flag: no textarea */}
        {selectedType === 'flag' ? (
          <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
            Flag this paragraph for client attention.
            It will appear in a callout box in the exported
            document.
          </p>
        ) : (
          <textarea
            autoFocus
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={
              selectedType === 'note'
                ? 'Add a note (internal only, not exported)…'
                : 'Write your replacement text…'
            }
            style={{
              width: '100%',
              minHeight: '80px',
              resize: 'vertical',
              border: '1px solid #E2E8F0',
              borderRadius: '4px',
              padding: '8px',
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
            }}
            onFocus={e => {
              e.target.style.borderColor = '#3B82F6';
            }}
            onBlur={e => {
              e.target.style.borderColor = '#E2E8F0';
            }}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px 12px',
        borderTop: '1px solid #F1F5F9',
      }}>
        <div>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                fontSize: '12px',
                color: '#EF4444',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              Delete
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              fontSize: '13px',
              color: '#64748B',
              background: 'none',
              border: '1px solid #E2E8F0',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving ||
              (selectedType !== 'flag' && !content.trim())}
            style={{
              fontSize: '13px',
              color: 'white',
              background: saving ? '#93C5FD' : '#3B82F6',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

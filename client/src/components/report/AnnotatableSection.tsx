import React, { useState, useRef, useEffect } from 'react';
import FloatingBubble from './FloatingBubble';
import { renderMarkdown } from '../../lib/render-markdown';

export interface Annotation {
  id: string;
  workspace_id: string;
  report_document_id: string;
  section_id: string;
  paragraph_index: number;
  annotation_type: 'note' | 'override' | 'flag';
  content: string;
  original_content?: string;
  created_at: string;
  updated_at: string;
}

interface ReportSection {
  id: string;
  title: string;
  content: string;
  word_count?: number;
  source_skills?: string[];
  severity?: 'critical' | 'warning' | 'info';
  flagged_for_client?: boolean;
}

interface AnnotatableSectionProps {
  section: ReportSection;
  annotations: Annotation[];
  isAnnotating: boolean;
  highlightedParagraphIndex?: number | null;
  onAnnotationSave: (
    data: Pick<Annotation, 'section_id' | 'paragraph_index' |
      'annotation_type' | 'content' | 'original_content'>
  ) => Promise<void>;
  onAnnotationDelete: (annotationId: string) => Promise<void>;
}

export default function AnnotatableSection({
  section,
  annotations,
  isAnnotating,
  highlightedParagraphIndex,
  onAnnotationSave,
  onAnnotationDelete,
}: AnnotatableSectionProps) {
  const [activeParagraph, setActiveParagraph] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const paragraphRefs = useRef<(HTMLElement | null)[]>([]);

  const paragraphs = section.content
    .replace(/<actions>[\s\S]*?<\/actions>/g, '')
    .replace(/<actions>[\s\S]*/g, '')
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0);

  function handleParagraphClick(index: number) {
    setActiveParagraph(index);
  }

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { sectionId: targetSectionId, paragraphIndex: targetIndex } = e.detail as {
        sectionId: string;
        paragraphIndex: number;
      };

      if (targetSectionId !== section.id) return;
      if (targetIndex < 0 || targetIndex >= paragraphs.length) return;

      setActiveParagraph(targetIndex);
    };

    window.addEventListener('open-annotation-bubble', handler as EventListener);
    return () => window.removeEventListener('open-annotation-bubble', handler as EventListener);
  }, [section.id, paragraphs.length]);

  function getParagraphStyle(index: number): React.CSSProperties {
    const annotation = annotations.find(
      a => a.section_id === section.id && a.paragraph_index === index
    );

    const isHighlighted = highlightedParagraphIndex === index;

    const baseStyle: React.CSSProperties = {
      fontSize: '16px',
      lineHeight: 1.6,
      color: '#334155',
      marginBottom: '16px',
      cursor: isAnnotating ? 'pointer' : 'default',
      transition: 'background 0.15s',
      padding: '8px',
      borderRadius: '4px',
      outline: 'none',
      position: 'relative',
      background: isHighlighted ? 'rgba(13, 148, 136, 0.06)' : 'transparent',
    };

    if (isAnnotating && hoveredIndex === index) {
      baseStyle.background = '#F8FAFC';
    }

    if (!annotation) return baseStyle;

    if (annotation.annotation_type === 'override') {
      return {
        ...baseStyle,
        borderLeft: '3px solid #3B82F6',
        paddingLeft: '12px',
        background: isHighlighted ? 'rgba(13, 148, 136, 0.06)' : '#F0F7FF',
        borderRadius: '0 4px 4px 0',
      };
    }

    if (annotation.annotation_type === 'flag') {
      return {
        ...baseStyle,
        background: isHighlighted ? 'rgba(13, 148, 136, 0.06)' : '#EFF6FF',
        border: '1px solid #BFDBFE',
        borderRadius: '6px',
        padding: '12px',
      };
    }

    return baseStyle;
  }

  function getParagraphContent(index: number): string {
    const annotation = annotations.find(
      a => a.section_id === section.id && a.paragraph_index === index
    );

    if (annotation?.annotation_type === 'override') {
      return annotation.content;
    }

    return paragraphs[index];
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLParagraphElement>,
    index: number
  ) => {
    if (!isAnnotating) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleParagraphClick(index);
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const all = document.querySelectorAll('[data-paragraph]');
      const flat = Array.from(all);
      const current = flat.findIndex(el =>
        el.getAttribute('data-section') === section.id &&
        el.getAttribute('data-paragraph') === String(index)
      );
      const next = flat[current + 1] as HTMLElement | undefined;
      if (next) next.focus();
    }
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{
        fontSize: '20px',
        fontWeight: 700,
        color: '#1E293B',
        marginBottom: '16px',
      }}>
        {section.title}
      </h2>

      <div>
        {paragraphs.map((paragraph, index) => {
          const annotation = annotations.find(
            a => a.section_id === section.id && a.paragraph_index === index
          );
          const hasNote = annotation?.annotation_type === 'note';

          return (
            <div
              key={index}
              ref={el => { paragraphRefs.current[index] = el as any; }}
              data-section={section.id}
              data-paragraph={String(index)}
              tabIndex={isAnnotating ? 0 : -1}
              onClick={() => isAnnotating && handleParagraphClick(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onFocus={() => isAnnotating && setHoveredIndex(index)}
              onBlur={() => isAnnotating && setHoveredIndex(null)}
              onMouseEnter={() => isAnnotating && setHoveredIndex(index)}
              onMouseLeave={() => isAnnotating && setHoveredIndex(null)}
              style={getParagraphStyle(index)}
            >
              {renderMarkdown(getParagraphContent(index))}

              {isAnnotating && (
                <span style={{
                  position: 'absolute',
                  right: '8px',
                  top: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  {annotation && (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '3px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      backgroundColor: annotation.annotation_type === 'note'
                        ? '#FEF3C7'
                        : annotation.annotation_type === 'override'
                        ? '#DBEAFE'
                        : '#EFF6FF',
                      color: annotation.annotation_type === 'note'
                        ? '#92400E'
                        : annotation.annotation_type === 'override'
                        ? '#1E40AF'
                        : '#1E3A8A',
                    }}>
                      {annotation.annotation_type}
                    </span>
                  )}

                  <span style={{
                    opacity: hoveredIndex === index ? 1 : 0,
                    transition: 'opacity 150ms',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}>💬</span>
                </span>
              )}

              {!isAnnotating && hasNote && (
                <span style={{
                  color: '#F59E0B',
                  fontSize: '10px',
                  float: 'right',
                  marginTop: '4px',
                }}>●</span>
              )}
            </div>
          );
        })}
      </div>

      {activeParagraph !== null && (
        <FloatingBubble
          paragraphText={paragraphs[activeParagraph]}
          sectionId={section.id}
          paragraphIndex={activeParagraph}
          existingAnnotation={annotations.find(
            a => a.paragraph_index === activeParagraph
          )}
          anchorRef={{
            current: paragraphRefs.current[activeParagraph]
          }}
          onSave={async (type, content) => {
            await onAnnotationSave({
              section_id: section.id,
              paragraph_index: activeParagraph,
              annotation_type: type,
              content,
              original_content:
                type === 'override'
                  ? paragraphs[activeParagraph]
                  : undefined,
            });
            setActiveParagraph(null);
          }}
          onDelete={
            annotations.find(a =>
              a.paragraph_index === activeParagraph
            )
              ? async () => {
                  const ann = annotations.find(
                    a => a.paragraph_index === activeParagraph
                  );
                  if (ann) await onAnnotationDelete(ann.id);
                  setActiveParagraph(null);
                }
              : undefined
          }
          onClose={() => setActiveParagraph(null)}
        />
      )}
    </div>
  );
}

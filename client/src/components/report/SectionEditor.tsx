import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { generateHTML, Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Strike from '@tiptap/extension-strike';
import Image from '@tiptap/extension-image';
import AnnotatableSection, { type Annotation } from './AnnotatableSection';

interface ReportSection {
  id: string;
  title: string;
  content: string;
  word_count?: number;
  source_skills?: string[];
  severity?: 'critical' | 'warning' | 'info';
  flagged_for_client?: boolean;
}

interface SectionEditorProps {
  section: ReportSection;
  tiptapContent?: any;
  annotations: Annotation[];
  isAnnotating: boolean;
  highlightedParagraphIndex?: number | null;
  workspaceId: string;
  documentId: string;
  token: string;
  onAnnotationSave: (data: Pick<Annotation, 'section_id' | 'paragraph_index' | 'annotation_type' | 'content' | 'original_content'>) => Promise<void>;
  onAnnotationDelete: (annotationId: string) => Promise<void>;
  onOpenChartBuilder: (sectionId: string, fromEditor?: boolean) => void;
  onChartInserted?: (sectionId: string, chart: any) => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const BASE_EXTENSIONS = [
  StarterKit,
  Placeholder.configure({
    placeholder: 'Write something, or type / to add a chart, table, or divider…',
  }),
  Strike,
  Image.configure({ inline: false }),
];

function convertPlainTextToDoc(text: string): any {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  if (paragraphs.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: paragraphs.map(p => ({
      type: 'paragraph',
      content: p.trim() ? [{ type: 'text', text: p.trim() }] : undefined,
    })),
  };
}

function TiptapReadView({ content }: { content: any }) {
  let html = '';
  try {
    html = generateHTML(content, BASE_EXTENSIONS);
  } catch {
    html = '<p>Content unavailable</p>';
  }
  return (
    <>
      <style>{`
        .tiptap-read-view p { margin: 0 0 12px; font-size: 16px; line-height: 1.65; color: #334155; }
        .tiptap-read-view hr { border: none; border-top: 1.5px solid #E2E8F0; margin: 20px 0; }
        .tiptap-read-view img { max-width: 100%; border-radius: 6px; margin: 8px 0; display: block; }
        .tiptap-read-view h1, .tiptap-read-view h2, .tiptap-read-view h3 { color: #1E293B; margin: 0 0 10px; }
        .tiptap-read-view ul, .tiptap-read-view ol { padding-left: 20px; margin: 0 0 12px; }
        .tiptap-read-view li { margin-bottom: 4px; font-size: 16px; line-height: 1.65; color: #334155; }
      `}</style>
      <div className="tiptap-read-view" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

const SLASH_MENU_ITEMS = [
  { id: 'chart', label: 'Chart', description: 'Insert a data chart', icon: '▤' },
  { id: 'divider', label: 'Divider', description: 'Insert a horizontal rule', icon: '—' },
  { id: 'table', label: 'Table', description: 'Insert a table (coming soon)', icon: '⊞' },
  { id: 'metric', label: 'Metric Card', description: 'Insert a KPI card (coming soon)', icon: '◈' },
];

function createSlashCommandExtension(onSlash: (pos: { top: number; left: number }) => void, onDismiss: () => void) {
  return Extension.create({
    name: 'slashCommand',
    addKeyboardShortcuts() {
      return {};
    },
    onUpdate() {
      const { state, view } = this.editor;
      const { selection } = state;
      const { $from } = selection;
      const charBefore = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 1),
        $from.parentOffset,
        '',
      );
      if (charBefore === '/') {
        const coords = view.coordsAtPos(selection.from);
        onSlash({ top: coords.bottom, left: coords.left });
      } else {
        onDismiss();
      }
    },
  });
}

export default function SectionEditor({
  section,
  tiptapContent,
  annotations,
  isAnnotating,
  highlightedParagraphIndex,
  workspaceId,
  documentId,
  token,
  onAnnotationSave,
  onAnnotationDelete,
  onOpenChartBuilder,
  onChartInserted,
}: SectionEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [localTiptapContent, setLocalTiptapContent] = useState<any>(tiptapContent ?? null);
  const [sectionHovered, setSectionHovered] = useState(false);
  const [slashMenuActive, setSlashMenuActive] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashMenuAbsPos, setSlashMenuAbsPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fromEditorRef = useRef(false);

  const initialContent = tiptapContent ?? convertPlainTextToDoc(section.content);

  const autoSave = useCallback(async (json: any) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/report-documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ section_id: section.id, tiptap_content: json }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setLocalTiptapContent(json);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  }, [workspaceId, documentId, token, section.id]);

  const slashExtension = useRef(
    createSlashCommandExtension(
      (absPos) => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        setSlashMenuAbsPos({
          top: absPos.top - (containerRect?.top ?? 0) + 4,
          left: absPos.left - (containerRect?.left ?? 0),
        });
        setSlashMenuActive(true);
        setSlashMenuIndex(0);
      },
      () => setSlashMenuActive(false),
    )
  ).current;

  const editor = useEditor({
    extensions: [
      ...BASE_EXTENSIONS,
      slashExtension,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => autoSave(editor.getJSON()), 2000);
    },
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function executeSlashCommand(cmdId: string) {
    if (!editor) return;
    const { selection } = editor.state;
    editor.chain().focus().deleteRange({
      from: selection.$from.pos - 1,
      to: selection.$from.pos,
    }).run();
    setSlashMenuActive(false);

    if (cmdId === 'chart') {
      fromEditorRef.current = true;
      onOpenChartBuilder(section.id, true);
    } else if (cmdId === 'divider') {
      editor.chain().focus().setHorizontalRule().run();
    } else if (cmdId === 'table') {
      editor.chain().focus().insertContent('<p><em>[Table — coming soon]</em></p>').run();
    } else if (cmdId === 'metric') {
      editor.chain().focus().insertContent('<p><em>[Metric card — coming soon]</em></p>').run();
    }
  }

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (!slashMenuActive) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSlashMenuIndex(i => (i + 1) % SLASH_MENU_ITEMS.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSlashMenuIndex(i => (i - 1 + SLASH_MENU_ITEMS.length) % SLASH_MENU_ITEMS.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSlashCommand(SLASH_MENU_ITEMS[slashMenuIndex].id);
    } else if (e.key === 'Escape') {
      setSlashMenuActive(false);
    }
  }

  function handleChartInsertedFromEditor(chart: any) {
    if (fromEditorRef.current && editor && chart.id) {
      const encodedToken = encodeURIComponent(token);
      const src = `/api/workspaces/${workspaceId}/reports/${documentId}/charts/${chart.id}/image?t=${encodedToken}`;
      editor.chain().focus().setImage({ src, alt: chart.title || 'Chart' }).run();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => autoSave(editor.getJSON()), 300);
    }
    fromEditorRef.current = false;
    if (onChartInserted) onChartInserted(section.id, chart);
  }

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: CustomEvent) => {
      const { sectionId, chart } = e.detail as { sectionId: string; chart: any };
      if (sectionId !== section.id) return;
      handleChartInsertedFromEditor(chart);
    };
    window.addEventListener('section-editor-chart-inserted', handler as EventListener);
    return () => window.removeEventListener('section-editor-chart-inserted', handler as EventListener);
  }, [isEditing, section.id, editor]);

  const statusColor = saveStatus === 'saved' ? '#10B981' : saveStatus === 'error' ? '#EF4444' : '#94A3B8';
  const statusText = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error saving' : '';

  if (!isEditing) {
    return (
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setSectionHovered(true)}
        onMouseLeave={() => setSectionHovered(false)}
      >
        <button
          onClick={() => setIsEditing(true)}
          title="Edit this section"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: 'none',
            border: '0.5px solid #E2E8F0',
            borderRadius: 5,
            padding: '3px 8px',
            fontSize: 11,
            color: '#94A3B8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            zIndex: 1,
            transition: 'all 0.15s',
            opacity: sectionHovered ? 1 : 0,
            pointerEvents: sectionHovered ? 'auto' : 'none',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = '#0D9488';
            (e.currentTarget as HTMLElement).style.borderColor = '#0D9488';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = '#94A3B8';
            (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
          }}
        >
          ✎ Edit
        </button>
        {localTiptapContent ? (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', marginBottom: 12 }}>{section.title}</h2>
            <TiptapReadView content={localTiptapContent} />
          </div>
        ) : (
          <AnnotatableSection
            section={section}
            annotations={annotations}
            isAnnotating={isAnnotating}
            highlightedParagraphIndex={highlightedParagraphIndex}
            onAnnotationSave={onAnnotationSave}
            onAnnotationDelete={onAnnotationDelete}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', marginBottom: 32 }}>
      <style>{`
        .section-editor-content .ProseMirror {
          outline: none;
          min-height: 120px;
          font-size: 16px;
          line-height: 1.65;
          color: #334155;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .section-editor-content .ProseMirror p { margin: 0 0 12px; }
        .section-editor-content .ProseMirror hr { border: none; border-top: 1.5px solid #E2E8F0; margin: 20px 0; }
        .section-editor-content .ProseMirror img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
        .section-editor-content .ProseMirror p.is-editor-empty:first-child::before {
          color: #CBD5E1; content: attr(data-placeholder); float: left; height: 0; pointer-events: none;
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: 0 }}>{section.title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {statusText && (
            <span style={{ fontSize: 11, color: statusColor, transition: 'color 0.2s' }}>{statusText}</span>
          )}
          <button
            onClick={() => setIsEditing(false)}
            style={{
              background: 'none', border: '0.5px solid #E2E8F0', borderRadius: 5,
              padding: '4px 10px', fontSize: 11, color: '#64748B', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>

      <div
        className="section-editor-content"
        style={{ border: '1.5px solid #0D9488', borderRadius: 8, padding: '12px 16px', background: '#FAFFFE', position: 'relative' }}
        onKeyDown={handleEditorKeyDown}
      >
        <EditorContent editor={editor} />

        {slashMenuActive && (
          <div
            style={{
              position: 'absolute',
              top: slashMenuAbsPos.top,
              left: Math.max(0, slashMenuAbsPos.left),
              zIndex: 100,
              background: 'white',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              minWidth: 220,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#94A3B8', borderBottom: '0.5px solid #F1F5F9', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Add block
            </div>
            {SLASH_MENU_ITEMS.map((item, i) => (
              <button
                key={item.id}
                onClick={() => executeSlashCommand(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px',
                  background: i === slashMenuIndex ? '#F0FDF9' : 'white', border: 'none', cursor: 'pointer',
                  textAlign: 'left', borderBottom: i < SLASH_MENU_ITEMS.length - 1 ? '0.5px solid #F8FAFC' : 'none',
                }}
                onMouseEnter={() => setSlashMenuIndex(i)}
              >
                <span style={{ fontSize: 16, width: 22, textAlign: 'center', color: '#64748B' }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1E293B' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{item.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 6, fontSize: 10, color: '#CBD5E1' }}>
        Type <kbd style={{ background: '#F1F5F9', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>/</kbd> to insert a chart, divider, or table
      </div>
    </div>
  );
}

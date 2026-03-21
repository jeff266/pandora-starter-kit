import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { generateHTML, Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { ChartNode } from './extensions/ChartNode';
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

const LINK_CONFIG = {
  openOnClick: false,
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: 'tiptap-link' },
};

// Extensions used for read-only HTML generation
const READ_EXTENSIONS = [
  StarterKit.configure({ link: LINK_CONFIG }),
  Image.configure({ inline: false }),
  ChartNode,
];

// Factory so each SectionEditor gets its own fresh extension instances
function makeEditorExtensions() {
  return [
    StarterKit.configure({ link: LINK_CONFIG }),
    Placeholder.configure({
      placeholder: 'Write something, or type / to add a chart, table, or divider…',
    }),
    Image.configure({ inline: false }),
    ChartNode,
  ];
}

// ── Markdown → TipTap conversion ────────────────────────────────────────────

function parseInline(text: string): any[] {
  const nodes: any[] = [];
  const boldRe = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    nodes.push({ type: 'text', marks: [{ type: 'bold' }], text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes.length ? nodes : [{ type: 'text', text }];
}

function parseBlock(raw: string): any {
  const t = raw.trim();
  if (t.startsWith('### ')) return { type: 'heading', attrs: { level: 3 }, content: parseInline(t.slice(4)) };
  if (t.startsWith('## '))  return { type: 'heading', attrs: { level: 2 }, content: parseInline(t.slice(3)) };
  if (t.startsWith('# '))  return { type: 'heading', attrs: { level: 1 }, content: parseInline(t.slice(2)) };
  // Handle multi-line blocks containing headings on interior lines
  if (/\n/.test(t)) {
    return {
      type: 'doc',
      content: t.split('\n').filter(l => l.trim()).map(l => parseBlock(l)),
    } as any;
  }
  return { type: 'paragraph', content: parseInline(t) };
}

function convertMarkdownToDoc(text: string): any {
  const blocks = text.split(/\n\n+/).filter(b => b.trim());
  if (!blocks.length) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const nodes: any[] = [];
  for (const block of blocks) {
    const result = parseBlock(block);
    if (result.type === 'doc') nodes.push(...result.content);
    else nodes.push(result);
  }
  return { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] };
}

// Keep the old name as an alias — editor initialisation still calls it
const convertPlainTextToDoc = convertMarkdownToDoc;

// ── Runtime content sanitizer ────────────────────────────────────────────────
// Walks TipTap JSON and:
//  1. Converts paragraph nodes whose text is raw markdown into proper heading/bold nodes
//  2. Appends ?token=... to chart image URLs so browser <img> requests succeed

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s/.test(text) || /\*\*[^*]+\*\*/.test(text);
}

function sanitizeTiptapContent(node: any, token: string): any {
  if (!node || typeof node !== 'object') return node;

  // Patch image src to include auth token
  if (node.type === 'image' && node.attrs?.src) {
    const src: string = node.attrs.src;
    if (src.startsWith('/api/workspaces/') && !src.includes('?token=') && !src.includes('&token=')) {
      return { ...node, attrs: { ...node.attrs, src: `${src}?token=${encodeURIComponent(token)}` } };
    }
    return node;
  }

  // Convert raw-markdown paragraph text to proper TipTap nodes
  if (
    node.type === 'paragraph' &&
    Array.isArray(node.content) &&
    node.content.length === 1 &&
    node.content[0].type === 'text' &&
    typeof node.content[0].text === 'string' &&
    looksLikeMarkdown(node.content[0].text)
  ) {
    return parseBlock(node.content[0].text);
  }

  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map((child: any) => sanitizeTiptapContent(child, token)) };
  }
  return node;
}

function TiptapReadView({ content }: { content: any }) {
  let html = '';
  try {
    html = generateHTML(content, READ_EXTENSIONS);
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
        .tiptap-read-view a, .tiptap-read-view .tiptap-link { color: #0D9488; text-decoration: underline; }
        .tiptap-read-view a:hover { color: #0F766E; }
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
  const [, setEditorTick] = useState(0);
  const [slashMenuActive, setSlashMenuActive] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashMenuAbsPos, setSlashMenuAbsPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [linkPopover, setLinkPopover] = useState<{ open: boolean; url: string }>({ open: false, url: '' });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
      ...makeEditorExtensions(),
      slashExtension,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => autoSave(editor.getJSON()), 2000);
    },
    onSelectionUpdate: () => setEditorTick(t => t + 1),
    onTransaction: () => setEditorTick(t => t + 1),
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

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      editor.chain().focus().setImage({ src, alt: file.name }).run();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => autoSave(editor.getJSON()), 300);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function applyLink() {
    if (!editor) return;
    const url = linkPopover.url.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = url.startsWith('http') ? url : `https://${url}`;
      editor.chain().focus().setLink({ href }).run();
    }
    setLinkPopover({ open: false, url: '' });
  }

  function openLinkPopover() {
    const existing = editor?.getAttributes('link').href ?? '';
    setLinkPopover({ open: true, url: existing });
  }

  function handleChartInsertedFromEditor(chart: any) {
    if (fromEditorRef.current && editor) {
      const { chart_spec, id, title } = chart;
      if (chart_spec) {
        editor.chain().focus().insertContent({
          type: 'pandoraChart',
          attrs: { spec: chart_spec, chartId: id ?? null },
        }).run();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => autoSave(editor.getJSON()), 300);
      }
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
            <TiptapReadView content={sanitizeTiptapContent(localTiptapContent, token)} />
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

      {/* Formatting toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px',
        background: '#F8FAFC', border: '1.5px solid #0D9488', borderBottom: 'none',
        borderRadius: '8px 8px 0 0', flexWrap: 'wrap', position: 'relative',
      }}>
        {/* Undo / Redo */}
        {[
          { label: '↩', title: 'Undo (⌘Z)', action: () => editor?.chain().focus().undo().run(), disabled: () => !editor?.can().undo() },
          { label: '↪', title: 'Redo (⌘⇧Z)', action: () => editor?.chain().focus().redo().run(), disabled: () => !editor?.can().redo() },
        ].map((btn, i) => (
          <button key={`ur-${i}`} title={btn.title}
            onMouseDown={e => { e.preventDefault(); btn.action(); }}
            style={{ background: 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 14, color: btn.disabled() ? '#CBD5E1' : '#475569', cursor: btn.disabled() ? 'default' : 'pointer', lineHeight: 1, minWidth: 26 }}>
            {btn.label}
          </button>
        ))}

        <div style={{ width: 1, height: 16, background: '#E2E8F0', margin: '0 4px' }} />

        {/* Text formatting */}
        {([
          { label: 'B', title: 'Bold (⌘B)', action: () => editor?.chain().focus().toggleBold().run(), active: () => editor?.isActive('bold'), style: { fontWeight: 700 } },
          { label: 'I', title: 'Italic (⌘I)', action: () => editor?.chain().focus().toggleItalic().run(), active: () => editor?.isActive('italic'), style: { fontStyle: 'italic' } },
          { label: 'S̶', title: 'Strikethrough', action: () => editor?.chain().focus().toggleStrike().run(), active: () => editor?.isActive('strike'), style: {} },
        ] as const).map((btn, i) => {
          const isActive = btn.active?.() ?? false;
          return (
            <button key={`fmt-${i}`} title={btn.title}
              onMouseDown={e => { e.preventDefault(); btn.action?.(); }}
              style={{ background: isActive ? '#CCFBF1' : 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 13, color: isActive ? '#0D9488' : '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center', ...btn.style }}>
              {btn.label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: '#E2E8F0', margin: '0 4px' }} />

        {/* Headings */}
        {([
          { label: 'H2', level: 2 as const },
          { label: 'H3', level: 3 as const },
        ]).map(h => {
          const isActive = editor?.isActive('heading', { level: h.level }) ?? false;
          return (
            <button key={h.label} title={`Heading ${h.level}`}
              onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: h.level }).run(); }}
              style={{ background: isActive ? '#CCFBF1' : 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 10, fontWeight: 700, color: isActive ? '#0D9488' : '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center' }}>
              {h.label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: '#E2E8F0', margin: '0 4px' }} />

        {/* Lists */}
        {([
          { label: '≡', title: 'Bullet list', action: () => editor?.chain().focus().toggleBulletList().run(), active: () => editor?.isActive('bulletList') },
          { label: '1.', title: 'Ordered list', action: () => editor?.chain().focus().toggleOrderedList().run(), active: () => editor?.isActive('orderedList') },
        ] as const).map((btn, i) => {
          const isActive = btn.active?.() ?? false;
          return (
            <button key={`list-${i}`} title={btn.title}
              onMouseDown={e => { e.preventDefault(); btn.action?.(); }}
              style={{ background: isActive ? '#CCFBF1' : 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 13, color: isActive ? '#0D9488' : '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center' }}>
              {btn.label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: '#E2E8F0', margin: '0 4px' }} />

        {/* Link button */}
        <button title="Insert / edit link (⌘K)"
          onMouseDown={e => { e.preventDefault(); openLinkPopover(); }}
          style={{ background: editor?.isActive('link') ? '#CCFBF1' : 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 13, color: editor?.isActive('link') ? '#0D9488' : '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center' }}>
          🔗
        </button>

        {/* Image upload button */}
        <button title="Insert image from file"
          onMouseDown={e => { e.preventDefault(); imageInputRef.current?.click(); }}
          style={{ background: 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 13, color: '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center' }}>
          🖼
        </button>

        {/* Divider rule */}
        <button title="Insert horizontal divider"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().setHorizontalRule().run(); }}
          style={{ background: 'none', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 13, color: '#475569', cursor: 'pointer', lineHeight: 1, minWidth: 26, textAlign: 'center' }}>
          ╌
        </button>

        {/* Hidden file input for image upload */}
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />

        {/* Link popover */}
        {linkPopover.open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 200,
            background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 320, marginTop: 4,
          }}>
            <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>URL</span>
            <input
              autoFocus
              type="url"
              placeholder="https://example.com"
              value={linkPopover.url}
              onChange={e => setLinkPopover(p => ({ ...p, url: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkPopover({ open: false, url: '' }); }}
              style={{ flex: 1, border: '1px solid #E2E8F0', borderRadius: 5, padding: '4px 8px', fontSize: 13, outline: 'none' }}
            />
            <button onMouseDown={e => { e.preventDefault(); applyLink(); }}
              style={{ background: '#0D9488', color: 'white', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              Apply
            </button>
            {editor?.isActive('link') && (
              <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetLink().run(); setLinkPopover({ open: false, url: '' }); }}
                style={{ background: 'none', color: '#EF4444', border: '1px solid #FCA5A5', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className="section-editor-content"
        style={{ border: '1.5px solid #0D9488', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '12px 16px', background: '#FAFFFE', position: 'relative' }}
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

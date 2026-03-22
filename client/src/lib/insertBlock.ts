import { Editor } from '@tiptap/react';
import { getSectionEditor } from './sectionEditorRegistry';

function formatCellValue(value: string | number | null | undefined, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (format === 'currency') {
    const n = Number(value);
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  }
  if (format === 'percent') return `${Number(value).toFixed(1)}%`;
  return String(value);
}

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

export function insertTextIntoEditor(editor: Editor, markdown: string): void {
  const lines = markdown.split('\n');
  const nodes: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(`<h3>${markdownToHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      nodes.push(`<h2>${markdownToHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      nodes.push(`<h1>${markdownToHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(`<li>${markdownToHtml(lines[i].trim().slice(2))}</li>`);
        i++;
      }
      nodes.push(`<ul>${items.join('')}</ul>`);
      continue;
    } else if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        nodes.push(`<li>${markdownToHtml(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      nodes.push(`<ol>${items.join('')}</ol>`);
      continue;
    } else {
      nodes.push(`<p>${markdownToHtml(trimmed)}</p>`);
    }

    i++;
  }

  if (nodes.length === 0) return;
  editor.chain().focus().insertContent(nodes.join('')).run();
}

export function insertChartIntoEditor(editor: Editor, spec: any): void {
  editor.chain().focus().insertContent({
    type: 'pandoraChart',
    attrs: { spec, chartId: null },
  }).run();
}

export function insertTableIntoEditor(
  editor: Editor,
  columns: Array<{ label: string; key: string; format?: string }>,
  rows: Record<string, string | number | null>[],
): void {
  const headers = columns.map(c => `<th>${c.label}</th>`).join('');
  const bodyRows = rows
    .map(row => `<tr>${columns.map(c => `<td>${formatCellValue(row[c.key], c.format)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  editor.chain().focus().insertContent(html).run();
}

export function replaceSelectionInEditor(
  newText: string,
  sectionId: string
): void {
  const sectionEditor = getSectionEditor(sectionId);
  if (!sectionEditor || sectionEditor.isDestroyed) return;

  // Get current selection range
  const { from, to } = sectionEditor.state.selection;

  // Delete the selection and insert new content
  sectionEditor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, `<p>${markdownToHtml(newText)}</p>`)
    .run();
}

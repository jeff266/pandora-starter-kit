import { Editor } from '@tiptap/react';

const registry = new Map<string, Editor>();

export function registerSectionEditor(sectionId: string, editor: Editor): void {
  registry.set(sectionId, editor);
}

export function unregisterSectionEditor(sectionId: string): void {
  registry.delete(sectionId);
}

export function getSectionEditor(sectionId: string): Editor | null {
  return registry.get(sectionId) ?? null;
}

export function getActiveSectionEditor(activeSectionId: string | null): Editor | null {
  if (!activeSectionId) return null;
  return registry.get(activeSectionId) ?? null;
}

export function getAnyActiveEditor(): Editor | null {
  for (const editor of registry.values()) {
    if (editor && !editor.isDestroyed) return editor;
  }
  return null;
}

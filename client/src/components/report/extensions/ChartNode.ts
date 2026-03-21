import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ChartNodeView from './ChartNodeView';

export const ChartNode = Node.create({
  name: 'pandoraChart',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      spec: {
        default: null,
        parseHTML: el => {
          const raw = el.getAttribute('data-spec');
          try { return raw ? JSON.parse(raw) : null; } catch { return null; }
        },
        renderHTML: attrs => ({
          'data-spec': JSON.stringify(attrs.spec),
        }),
      },
      chartId: {
        default: null,
        parseHTML: el => el.getAttribute('data-chart-id'),
        renderHTML: attrs => attrs.chartId
          ? { 'data-chart-id': attrs.chartId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pandora-chart"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes,
      { 'data-type': 'pandora-chart' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartNodeView);
  },
});

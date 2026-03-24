/**
 * Pandora Claim Mark
 *
 * TipTap Mark extension for claim provenance drill-through.
 * Invisible to readers until selected - then shows "Question this" button.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

export interface PandoraClaimAttrs {
  claim_id:     string;
  skill_id:     string;
  skill_run_id: string;
  metric_name:  string;
  severity:     string;
}

export const PandoraClaimMark = Mark.create({
  name: 'pandoraClaim',

  // Marks can span across inline content
  spanning: false,
  // Not inclusive — typing next to a claim does not extend it
  inclusive: false,
  // Not excluded from any other marks
  excludes: '',

  addAttributes() {
    return {
      claim_id: {
        default: null,
        parseHTML: element => element.getAttribute('data-claim-id'),
        renderHTML: attributes => {
          if (!attributes.claim_id) return {};
          return { 'data-claim-id': attributes.claim_id };
        },
      },
      skill_id: {
        default: null,
        parseHTML: element => element.getAttribute('data-skill-id'),
        renderHTML: attributes => {
          if (!attributes.skill_id) return {};
          return { 'data-skill-id': attributes.skill_id };
        },
      },
      skill_run_id: {
        default: null,
        parseHTML: element => element.getAttribute('data-skill-run-id'),
        renderHTML: attributes => {
          if (!attributes.skill_run_id) return {};
          return { 'data-skill-run-id': attributes.skill_run_id };
        },
      },
      metric_name: {
        default: null,
        parseHTML: element => element.getAttribute('data-metric-name'),
        renderHTML: attributes => {
          if (!attributes.metric_name) return {};
          return { 'data-metric-name': attributes.metric_name };
        },
      },
      severity: {
        default: null,
        parseHTML: element => element.getAttribute('data-severity'),
        renderHTML: attributes => {
          if (!attributes.severity) return {};
          return { 'data-severity': attributes.severity };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-claim-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Rendered as a span with data attributes
    // No visual styling — invisible to the reader
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'pandora-claim',
      }),
      0,
    ];
  },
});

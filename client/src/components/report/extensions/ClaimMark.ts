/**
 * Pandora Claim Mark
 *
 * TipTap Mark extension for claim provenance drill-through.
 * Numeric values render as teal underlined hyperlinks.
 * Non-numeric claim text is invisible until selected.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

export interface PandoraClaimAttrs {
  claim_id:     string;
  skill_id:     string;
  skill_run_id: string;
  metric_name:  string;
  severity:     string;
  data_numeric: string;
}

const NUMERIC_PATTERNS = [
  /^\$[\d,.]+[MKB]?$/,
  /^\d[\d,]*\s+deals?$/i,
  /^\d[\d,]*\s+accounts?$/i,
  /^[\d.]+%$/,
  /^[\d.]+x$/,
  /^\d[\d,]*\s+reps?$/i,
  /^\d+\s+days?$/i,
  /^\d[\d,]*$/,
];

export function isNumericText(text: string): boolean {
  const t = text.trim();
  return NUMERIC_PATTERNS.some(p => p.test(t));
}

export const PandoraClaimMark = Mark.create({
  name: 'pandoraClaim',

  spanning: false,
  inclusive: false,
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
      data_numeric: {
        default: 'false',
        parseHTML: element => element.getAttribute('data-numeric') ?? 'false',
        renderHTML: attributes => {
          return { 'data-numeric': attributes.data_numeric ?? 'false' };
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
    const isNumeric = HTMLAttributes['data-numeric'] === 'true';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: isNumeric
          ? 'pandora-claim pandora-claim--hyperlink'
          : 'pandora-claim',
      }),
      0,
    ];
  },
});

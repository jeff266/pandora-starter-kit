import { query } from '../db.js';
import { ReportDocument, ReportSection } from './types.js';

/**
 * Loads annotations for a report and merges them into
 * a deep copy of the ReportDocument before export.
 *
 * Rules:
 *   Override → replace the paragraph text in section.content
 *   Flag     → set section.flagged_for_client = true
 *   Note     → omit entirely (internal only)
 *
 * Returns a NEW ReportDocument — never mutates the original.
 * The original in report_documents stays unchanged.
 */
export async function mergeAnnotationsForExport(
  reportDocument: ReportDocument,
  workspaceId: string
): Promise<ReportDocument> {

  // Load all annotations for this report
  const result = await query(`
    SELECT
      section_id,
      paragraph_index,
      annotation_type,
      content,
      original_content
    FROM report_annotations
    WHERE report_document_id = $1
      AND workspace_id = $2
    ORDER BY section_id, paragraph_index
  `, [reportDocument.id, workspaceId]);

  const annotations = result.rows;

  // If no annotations, return original unchanged
  if (annotations.length === 0) return reportDocument;

  // Deep copy to avoid mutating the cached document
  const merged: ReportDocument = {
    ...reportDocument,
    sections: reportDocument.sections.map(section =>
      ({ ...section })
    ),
  };

  // Group annotations by section_id for efficient lookup
  const bySection = new Map<string, typeof annotations>();
  for (const ann of annotations) {
    if (!bySection.has(ann.section_id)) {
      bySection.set(ann.section_id, []);
    }
    bySection.get(ann.section_id)!.push(ann);
  }

  // Apply annotations to each section
  for (const section of merged.sections) {
    const sectionAnnotations = bySection.get(section.id);
    if (!sectionAnnotations?.length) continue;

    // Split content into paragraphs (same logic as frontend).
    // Guard against sections that store body in `narrative` rather than `content`.
    const rawContent = section.content || (section as any).narrative || '';
    const paragraphs = rawContent
      .split(/\n\n+/)
      .filter(p => p.trim().length > 0);

    let contentModified = false;
    let sectionFlagged = false;

    for (const ann of sectionAnnotations) {
      const idx = ann.paragraph_index;
      if (idx < 0 || idx >= paragraphs.length) continue;

      switch (ann.annotation_type) {
        case 'override':
          if (ann.content?.trim()) {
            paragraphs[idx] = ann.content.trim();
            contentModified = true;
          }
          break;

        case 'flag':
          sectionFlagged = true;
          // Content stays as-is — flag just changes presentation
          break;

        case 'note':
          // Strip entirely — notes are internal only
          // Do not include in export in any form
          break;
      }
    }

    if (contentModified) {
      section.content = paragraphs.join('\n\n');
      // Recompute word count
      section.word_count = section.content
        .split(/\s+/)
        .filter(Boolean).length;
    }

    if (sectionFlagged) {
      section.flagged_for_client = true;
    }
  }

  return merged;
}

/**
 * Claim Tag Post-Processor
 *
 * Parses XML <claim> tags from Claude synthesis output and converts them
 * into TipTap pandoraClaim mark format for provenance drill-through.
 */

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

function isNumericText(text: string): boolean {
  const t = text.trim();
  return NUMERIC_PATTERNS.some(p => p.test(t));
}

export interface ClaimAnnotation {
  claim_id:    string;
  skill_id:    string;
  metric_name: string;
  severity:    string;
  text:        string;  // the annotated text content
  start_pos:   number;  // character position in plain text narrative
  end_pos:     number;
}

export interface ProcessedNarrative {
  plain_text:       string;       // narrative with tags stripped
  annotations:      ClaimAnnotation[];
  tiptap_content:   any;          // TipTap JSON doc with pandoraClaim marks
}

/**
 * Process claim tags in Claude synthesis output
 */
export function processClaimTags(
  rawNarrative: string,
  skillRunId: string
): ProcessedNarrative {
  const annotations: ClaimAnnotation[] = [];

  // Regex to find <claim ...>text</claim> tags
  const CLAIM_REGEX =
    /<claim\s+id="([^"]+)"\s+skill="([^"]+)"\s+metric="([^"]+)"\s+severity="([^"]+)"\s*>([\s\S]*?)<\/claim>/g;

  let plain = rawNarrative;
  let offset = 0;
  let match: RegExpExecArray | null;

  // Reset regex lastIndex
  CLAIM_REGEX.lastIndex = 0;

  const matches: Array<{
    full: string;
    claim_id: string;
    skill_id: string;
    metric_name: string;
    severity: string;
    text: string;
    index: number;
  }> = [];

  // Collect all matches first
  while ((match = CLAIM_REGEX.exec(rawNarrative)) !== null) {
    const [full, claim_id, skill_id, metric_name, severity, text] = match;
    matches.push({
      full,
      claim_id,
      skill_id,
      metric_name,
      severity,
      text,
      index: match.index,
    });
  }

  // Process matches in order
  for (const m of matches) {
    const cleanText = m.text.trim();

    // Find position in the plain text (after prior tag removals)
    const tagStart = m.index - offset;
    offset += m.full.length - cleanText.length;

    annotations.push({
      claim_id: m.claim_id,
      skill_id: m.skill_id,
      metric_name: m.metric_name,
      severity: m.severity,
      text: cleanText,
      start_pos: tagStart,
      end_pos: tagStart + cleanText.length,
    });

    // Strip the tag, keep the text
    plain = plain.replace(m.full, cleanText);
  }

  // Build TipTap document with pandoraClaim marks
  const tiptapContent = buildTipTapWithMarks(plain, annotations, skillRunId);

  return { plain_text: plain, annotations, tiptap_content: tiptapContent };
}

function buildTipTapWithMarks(
  plain: string,
  annotations: ClaimAnnotation[],
  skillRunId: string
): any {
  // Split plain text into paragraphs
  const paragraphs = plain.split('\n\n').filter(p => p.trim());

  if (paragraphs.length === 0) {
    return {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: plain }]
      }]
    };
  }

  return {
    type: 'doc',
    content: paragraphs.map(para => ({
      type: 'paragraph',
      content: buildParagraphContent(para, annotations, skillRunId, plain)
    }))
  };
}

function buildParagraphContent(
  para: string,
  annotations: ClaimAnnotation[],
  skillRunId: string,
  fullText: string
): any[] {
  // Find the paragraph offset in the full text
  const paraStart = fullText.indexOf(para);
  if (paraStart === -1) {
    // Paragraph not found in full text (shouldn't happen)
    return [{ type: 'text', text: para }];
  }
  const paraEnd = paraStart + para.length;

  // Find annotations that fall within this paragraph
  const paraAnnotations = annotations.filter(a =>
    a.start_pos >= paraStart && a.end_pos <= paraEnd
  );

  if (!paraAnnotations.length) {
    // No claims in this paragraph — plain text node
    return [{ type: 'text', text: para }];
  }

  // Sort annotations by start position
  paraAnnotations.sort((a, b) => a.start_pos - b.start_pos);

  // Build content nodes with claim marks on annotated segments
  const nodes: any[] = [];
  let cursor = 0;

  for (const ann of paraAnnotations) {
    const localStart = ann.start_pos - paraStart;
    const localEnd = ann.end_pos - paraStart;

    // Skip if annotation is out of bounds
    if (localStart < 0 || localEnd > para.length) continue;

    // Text before this annotation
    if (cursor < localStart) {
      const beforeText = para.slice(cursor, localStart);
      if (beforeText) {
        nodes.push({ type: 'text', text: beforeText });
      }
    }

    // The annotated text with pandoraClaim mark
    const annotatedText = para.slice(localStart, localEnd);
    if (annotatedText) {
      nodes.push({
        type: 'text',
        text: annotatedText,
        marks: [{
          type: 'pandoraClaim',
          attrs: {
            claim_id:     ann.claim_id,
            skill_id:     ann.skill_id,
            skill_run_id: skillRunId,
            metric_name:  ann.metric_name,
            severity:     ann.severity,
            data_numeric: isNumericText(annotatedText) ? 'true' : 'false',
          }
        }]
      });
    }

    cursor = localEnd;
  }

  // Text after last annotation
  if (cursor < para.length) {
    const afterText = para.slice(cursor);
    if (afterText) {
      nodes.push({ type: 'text', text: afterText });
    }
  }

  // If no nodes were added, return plain text
  if (nodes.length === 0) {
    return [{ type: 'text', text: para }];
  }

  return nodes;
}

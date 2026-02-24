/**
 * Document Synthesizer
 * Generates Word documents and Excel spreadsheets from Ask Pandora data mining results
 */

import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } from 'docx';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { callLLM } from '../utils/llm-router.js';
import { getWorkspaceContext, type WorkspaceContext } from './workspace-context.js';

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
  description: string;
}

export interface ToolResult {
  tool: string;
  result: any;
  error?: string;
}

export interface SynthesisInput {
  userMessage: string;
  miningResult: {
    chatResponse: string;
    toolResults: ToolResult[];
    toolCalls: ToolCall[];
  };
  workspaceContext: WorkspaceContext;
  workspaceId: string;
}

export interface SynthesisOutput {
  docxPath: string;
  xlsxPath: string;
  docxFilename: string;
  xlsxFilename: string;
}

interface ExtractedData {
  deals: Deal[];
  metrics: Record<string, any>;
  signals: Signal[];
  icpProfile: any | null;
  queryParams: Record<string, any>;
}

interface Deal {
  id?: string;
  name: string;
  amount: number;
  stage: string;
  forecast_category?: string;
  close_date?: string;
  probability?: number;
  owner_name?: string;
}

interface Signal {
  entity_name: string;
  message: string;
  severity: string;
}

interface DocumentOutline {
  title: string;
  subtitle: string;
  prepared_for: string | null;
  prepared_date: string;
  context_box: {
    lines: string[];
  };
  sections: DocumentSection[];
  key_items_table: {
    title: string;
    headers: string[];
    rows: string[][];
  } | null;
  bottom_line: string;
  assumptions: string[];
  appendix: {
    data_source: string;
    query_filters: string;
    calculations: {
      label: string;
      formula: string;
      result: string;
    }[];
    raw_deal_count: number;
    raw_pipeline_value: number;
  };
}

interface DocumentSection {
  number: number;
  heading: string;
  content: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  bullets?: string[];
}

const DOCUMENT_SYNTHESIS_SYSTEM_PROMPT = `You are a RevOps strategist producing executive-ready strategic documents.
You have been given:
1. A user's request
2. The raw analysis output from a data-mining session
3. Structured CRM data extracted from that session

Your job is to produce a structured JSON document outline that will be rendered into a Word document and Excel file. Be specific, use real numbers from the data, cite real deal names and amounts.

Respond ONLY with valid JSON matching this exact schema:

{
  "title": "Document title",
  "subtitle": "Subtitle or context line",
  "prepared_for": "Name and role if mentioned, otherwise null",
  "prepared_date": "Today's date",

  "context_box": {
    "lines": ["Key context line 1", "Key context line 2"]
  },

  "sections": [
    {
      "number": 1,
      "heading": "Section heading",
      "content": "Prose content for this section",
      "table": {
        "headers": ["Col 1", "Col 2", "Col 3"],
        "rows": [["val", "val", "val"]]
      },
      "bullets": ["Bullet 1", "Bullet 2"]
    }
  ],

  "key_items_table": {
    "title": "Key Items / Deals to Watch",
    "headers": ["Item", "Value", "Category", "Date", "Note"],
    "rows": [["Deal name", "$XXX", "Commit", "Mar 31", "Note"]]
  },

  "bottom_line": "The single most important takeaway — action-oriented, specific.",

  "assumptions": [
    "Assumption 1 that should be validated",
    "Assumption 2"
  ],

  "appendix": {
    "data_source": "Description of data source and pull date",
    "query_filters": "What filters were applied to get this data",
    "calculations": [
      {
        "label": "Calculation name",
        "formula": "How it was calculated in plain English",
        "result": "The result"
      }
    ],
    "raw_deal_count": 0,
    "raw_pipeline_value": 0
  }
}

Include only sections relevant to the request.
Do not include empty sections or placeholder text.
Use real numbers and deal names from the data provided.
Flag anything that is an assumption vs. calculated from data.`;

/**
 * Extract structured data from tool results
 */
function extractStructuredData(toolResults: ToolResult[]): ExtractedData {
  const extracted: ExtractedData = {
    deals: [],
    metrics: {},
    signals: [],
    icpProfile: null,
    queryParams: {},
  };

  for (const tr of toolResults) {
    try {
      if (tr.tool === 'query_deals' && tr.result?.deals) {
        extracted.deals = tr.result.deals.map((d: any) => ({
          id: d.id,
          name: d.name,
          amount: d.amount || 0,
          stage: d.stage || 'Unknown',
          forecast_category: d.forecast_category,
          close_date: d.close_date,
          probability: d.probability || 0,
          owner_name: d.owner_name,
        }));
        extracted.queryParams = tr.result.filters || {};
      } else if (tr.tool === 'compute_metric') {
        const label = tr.result?.label || 'metric';
        extracted.metrics[label] = tr.result;
      } else if (tr.tool === 'query_conversation_signals' && tr.result?.signals) {
        extracted.signals = tr.result.signals.map((s: any) => ({
          entity_name: s.entity_name || '',
          message: s.message || '',
          severity: s.severity || 'info',
        }));
      } else if (tr.tool === 'get_icp_profile') {
        extracted.icpProfile = tr.result;
      }
    } catch (err) {
      console.error(`[DocumentSynthesizer] Failed to extract from ${tr.tool}:`, err);
    }
  }

  return extracted;
}

/**
 * Generate document outline via Claude
 */
async function generateDocumentOutline(
  input: SynthesisInput,
  extractedData: ExtractedData
): Promise<DocumentOutline> {
  const response = await callLLM(input.workspaceId, 'reason', {
    systemPrompt: DOCUMENT_SYNTHESIS_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        userMessage: input.userMessage,
        chatResponse: input.miningResult.chatResponse,
        extractedData,
        workspaceContext: input.workspaceContext,
      }, null, 2),
    }],
    maxTokens: 6000,
    temperature: 0.2,
    _tracking: {
      workspaceId: input.workspaceId,
      phase: 'document_synthesis',
      stepName: 'generate-outline',
    },
  });

  const text = response.content.trim();
  const outline = parseOutlineJSON(text);

  if (extractedData.deals.length > 0) {
    if (!outline.appendix) {
      outline.appendix = { data_source: '', query_filters: '', calculations: [], raw_deal_count: 0, raw_pipeline_value: 0 };
    }
    outline.appendix.raw_deal_count = extractedData.deals.length;
    outline.appendix.raw_pipeline_value = extractedData.deals.reduce((sum, d) => sum + d.amount, 0);
  }

  return outline;
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, '$1');
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '');
}

function escapeUnescapedNewlinesInStrings(s: string): string {
  const result: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { result.push(ch); esc = false; continue; }
    if (ch === '\\' && inStr) { result.push(ch); esc = true; continue; }
    if (ch === '"') { inStr = !inStr; result.push(ch); continue; }
    if (inStr && ch === '\n') { result.push('\\n'); continue; }
    if (inStr && ch === '\r') { continue; }
    if (inStr && ch === '\t') { result.push('\\t'); continue; }
    result.push(ch);
  }
  return result.join('');
}

function closeOpenJSON(s: string): string {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  let closed = s.replace(/,\s*$/, '');
  while (brackets > 0) { closed += ']'; brackets--; }
  while (braces > 0) { closed += '}'; braces--; }
  return closed;
}

function parseOutlineJSON(text: string): DocumentOutline {
  let cleaned = stripCodeFences(text);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON from document synthesis response');
  }

  let raw = jsonMatch[0];

  try {
    return JSON.parse(raw) as DocumentOutline;
  } catch (e1) {
    console.warn('[DocumentSynthesizer] JSON.parse failed:', (e1 as Error).message?.slice(0, 100));
  }

  try {
    return JSON.parse(stripTrailingCommas(raw)) as DocumentOutline;
  } catch (_e2) {
    console.warn('[DocumentSynthesizer] Strip trailing commas failed, trying string escape');
  }

  try {
    return JSON.parse(escapeUnescapedNewlinesInStrings(stripTrailingCommas(raw))) as DocumentOutline;
  } catch (_e3) {
    console.warn('[DocumentSynthesizer] String escape failed, trying close-open');
  }

  try {
    const repaired = closeOpenJSON(escapeUnescapedNewlinesInStrings(stripTrailingCommas(raw)));
    return JSON.parse(repaired) as DocumentOutline;
  } catch (_e4) {
    console.warn('[DocumentSynthesizer] Close-open failed, trying truncation');
  }

  const lastGoodBrace = raw.lastIndexOf('}');
  if (lastGoodBrace > 0) {
    const truncated = raw.slice(0, lastGoodBrace + 1);
    try {
      const repaired = closeOpenJSON(escapeUnescapedNewlinesInStrings(stripTrailingCommas(truncated)));
      return JSON.parse(repaired) as DocumentOutline;
    } catch (_e5) {
      // fall through
    }
  }

  throw new Error('Failed to parse document outline JSON after all repair attempts');
}

/**
 * Generate Word document from outline
 */
async function generateDocx(
  outline: DocumentOutline,
  extractedData: ExtractedData,
  workspaceId: string
): Promise<string> {
  const sections: any[] = [];

  // Border style for tables
  const border = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: '2a3150',
  };

  // Cover section
  sections.push(
    new Paragraph({
      text: outline.title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      spacing: { after: 200 },
    }),
    new Paragraph({
      text: outline.subtitle,
      spacing: { after: 400 },
      style: 'subtitle',
    })
  );

  if (outline.prepared_for) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Prepared for: ', bold: true }),
          new TextRun(outline.prepared_for),
        ],
        spacing: { after: 100 },
      })
    );
  }

  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true }),
        new TextRun(outline.prepared_date),
      ],
      spacing: { after: 400 },
    })
  );

  // Context box
  if (outline.context_box && outline.context_box.lines.length > 0) {
    sections.push(
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: 'EBF3FB', type: ShadingType.CLEAR },
                borders: { top: border, bottom: border, left: border, right: border },
                margins: { top: 160, bottom: 160, left: 200, right: 200 },
                width: { size: 9360, type: WidthType.DXA },
                children: outline.context_box.lines.map(line =>
                  new Paragraph({
                    children: [new TextRun({ text: line, size: 20 })],
                  })
                ),
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ text: '', spacing: { after: 400 } })
    );
  }

  // Sections
  for (const section of outline.sections) {
    sections.push(
      new Paragraph({
        text: `${section.number}. ${section.heading}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    if (section.content) {
      sections.push(
        new Paragraph({
          text: section.content,
          spacing: { after: 200 },
        })
      );
    }

    if (section.table) {
      const tableRows = [
        new TableRow({
          children: section.table.headers.map(h =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              shading: { fill: 'DEEAF1', type: ShadingType.CLEAR },
            })
          ),
        }),
        ...section.table.rows.map(row =>
          new TableRow({
            children: row.map(cell =>
              new TableCell({
                children: [new Paragraph(cell)],
              })
            ),
          })
        ),
      ];

      sections.push(
        new Table({ rows: tableRows }),
        new Paragraph({ text: '', spacing: { after: 200 } })
      );
    }

    if (section.bullets && section.bullets.length > 0) {
      for (const bullet of section.bullets) {
        sections.push(
          new Paragraph({
            text: bullet,
            bullet: { level: 0 },
            spacing: { after: 100 },
          })
        );
      }
      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }
  }

  // Key items table
  if (outline.key_items_table && outline.key_items_table.rows.length > 0) {
    sections.push(
      new Paragraph({
        text: outline.key_items_table.title,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    const keyItemsRows = [
      new TableRow({
        children: outline.key_items_table.headers.map(h =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            shading: { fill: 'DEEAF1', type: ShadingType.CLEAR },
          })
        ),
      }),
      ...outline.key_items_table.rows.map(row =>
        new TableRow({
          children: row.map(cell =>
            new TableCell({
              children: [new Paragraph(cell)],
            })
          ),
        })
      ),
    ];

    sections.push(
      new Table({ rows: keyItemsRows }),
      new Paragraph({ text: '', spacing: { after: 400 } })
    );
  }

  // Bottom line box
  if (outline.bottom_line) {
    sections.push(
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: 'D5E8F0', type: ShadingType.CLEAR },
                borders: { top: border, bottom: border, left: border, right: border },
                margins: { top: 160, bottom: 160, left: 200, right: 200 },
                width: { size: 9360, type: WidthType.DXA },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: 'Bottom Line: ', bold: true, size: 24 }),
                      new TextRun({ text: outline.bottom_line, size: 22 }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ text: '', spacing: { after: 400 } })
    );
  }

  // Page break before appendix
  sections.push(
    new Paragraph({
      text: '',
      pageBreakBefore: true,
    })
  );

  // Appendix
  sections.push(
    new Paragraph({
      text: 'Appendix: Data & Calculations',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 300 },
    })
  );

  if (outline.appendix.data_source) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Data Source: ', bold: true }),
          new TextRun(outline.appendix.data_source),
        ],
        spacing: { after: 200 },
      })
    );
  }

  if (outline.appendix.query_filters) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Filters Applied: ', bold: true }),
          new TextRun(outline.appendix.query_filters),
        ],
        spacing: { after: 200 },
      })
    );
  }

  // Calculations
  if (outline.appendix.calculations && outline.appendix.calculations.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Calculations:',
        bold: true,
        spacing: { before: 300, after: 200 },
      })
    );

    for (const calc of outline.appendix.calculations) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${calc.label}: `, bold: true }),
            new TextRun(calc.result),
          ],
          spacing: { after: 100 },
        }),
        new Paragraph({
          text: `  Formula: ${calc.formula}`,
          spacing: { after: 200 },
        })
      );
    }
  }

  // Assumptions
  if (outline.assumptions && outline.assumptions.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Assumptions (to be validated):',
        bold: true,
        spacing: { before: 300, after: 200 },
      })
    );

    for (const assumption of outline.assumptions) {
      sections.push(
        new Paragraph({
          text: assumption,
          bullet: { level: 0 },
          spacing: { after: 100 },
        })
      );
    }

    sections.push(new Paragraph({ text: '', spacing: { after: 300 } }));
  }

  // Raw deal list
  if (extractedData.deals.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Raw Deal Data:',
        bold: true,
        spacing: { before: 300, after: 200 },
      })
    );

    const dealHeaders = ['Deal Name', 'Amount', 'Stage', 'Forecast', 'Close Date', 'Probability', 'Owner'];
    const dealRows = [
      new TableRow({
        children: dealHeaders.map(h =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
            shading: { fill: 'DEEAF1', type: ShadingType.CLEAR },
          })
        ),
      }),
      ...extractedData.deals.map(deal =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: deal.name, size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: `$${(deal.amount / 1000).toFixed(0)}K`, size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: deal.stage, size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: deal.forecast_category || '—', size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: deal.close_date?.slice(0, 10) || '—', size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: deal.probability ? `${(deal.probability * 100).toFixed(0)}%` : '—', size: 18 })] }),
            new TableCell({ children: [new Paragraph({ text: deal.owner_name || '—', size: 18 })] }),
          ],
        })
      ),
    ];

    sections.push(new Table({ rows: dealRows }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: 12240, // US Letter width in DXA
            height: 15840, // US Letter height in DXA
          },
          margin: {
            top: 1440,
            right: 1440,
            bottom: 1440,
            left: 1440,
          },
        },
      },
      children: sections,
    }],
  });

  const timestamp = Date.now();
  const slug = outline.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);

  const filename = `${workspaceId}-${new Date().toISOString().slice(0, 10)}-${slug}.docx`;
  const outputDir = '/tmp/pandora-docs';

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, filename);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Generate Excel file from outline and data
 */
async function generateXlsx(
  outline: DocumentOutline,
  extractedData: ExtractedData,
  workspaceId: string
): Promise<string> {
  const slug = outline.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);

  const filename = `${workspaceId}-${new Date().toISOString().slice(0, 10)}-${slug}-data.xlsx`;
  const outputDir = '/tmp/pandora-docs';

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, filename);

  const workbook = new ExcelJS.Workbook();

  const headerFill: ExcelJS.FillPattern = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDEEAF1' },
  };
  const headerFont: Partial<ExcelJS.Font> = { bold: true };

  const ws1 = workbook.addWorksheet('Pipeline Data');
  const pipelineHeaders = ['Deal Name', 'Amount ($)', 'Stage', 'Forecast Category', 'Close Date', 'Probability', 'Weighted Value ($)'];
  const headerRow = ws1.addRow(pipelineHeaders);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
  });

  for (let i = 0; i < extractedData.deals.length; i++) {
    const d = extractedData.deals[i];
    const rowNum = i + 2;
    ws1.addRow([
      d.name || '',
      d.amount || 0,
      d.stage || '',
      d.forecast_category || '',
      d.close_date || '',
      d.probability || 0,
      { formula: `B${rowNum}*F${rowNum}` },
    ]);
  }

  ws1.views = [{ state: 'frozen', ySplit: 1 }];
  if (extractedData.deals.length > 0) {
    ws1.autoFilter = { from: 'A1', to: `G${extractedData.deals.length + 1}` };
  }

  ws1.columns = [
    { width: 30 }, { width: 15 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 18 },
  ];

  const ws2 = workbook.addWorksheet('Calculations');
  const titleRow2 = ws2.addRow(['ASSUMPTIONS (Blue cells are editable)']);
  titleRow2.getCell(1).font = { bold: true, size: 14 };
  ws2.addRow([]);

  const calcHeaderRow = ws2.addRow(['Calculation', 'Formula', 'Result']);
  calcHeaderRow.eachCell((cell) => { cell.font = headerFont; });

  const calculations = outline.appendix?.calculations || [];
  for (const calc of calculations) {
    ws2.addRow([calc.label || '', calc.formula || '', calc.result || '']);
  }

  ws2.columns = [{ width: 30 }, { width: 40 }, { width: 20 }];

  const ws3 = workbook.addWorksheet('Summary');
  const titleRow3 = ws3.addRow(['Document Summary']);
  titleRow3.getCell(1).font = { bold: true, size: 14 };
  ws3.addRow([]);
  ws3.addRow(['Total Deals:', outline.appendix?.raw_deal_count || 0]);
  ws3.addRow(['Total Pipeline Value:', outline.appendix?.raw_pipeline_value || 0]);

  ws3.columns = [{ width: 25 }, { width: 20 }];

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

/**
 * Main synthesis function
 */
export async function synthesizeDocuments(input: SynthesisInput): Promise<SynthesisOutput> {
  console.log('[DocumentSynthesizer] Starting document synthesis for:', input.userMessage);

  // Step 1: Extract structured data
  const extractedData = extractStructuredData(input.miningResult.toolResults);

  // Step 2: Generate outline with Claude
  const outline = await generateDocumentOutline(input, extractedData);

  // Step 3: Generate docx
  const docxPath = await generateDocx(outline, extractedData, input.workspaceId);
  console.log('[DocumentSynthesizer] Generated docx:', docxPath);

  // Step 4: Generate xlsx
  const xlsxPath = await generateXlsx(outline, extractedData, input.workspaceId);
  console.log('[DocumentSynthesizer] Generated xlsx:', xlsxPath);

  return {
    docxPath,
    xlsxPath,
    docxFilename: path.basename(docxPath),
    xlsxFilename: path.basename(xlsxPath),
  };
}

/**
 * Format chat response with download links
 */
export function formatDocumentResponse(
  synthOutput: SynthesisOutput,
  workspaceId: string,
  chatAnswer: string
): string {
  return `${chatAnswer}

📄 **Strategic Framework (Word doc)**
[Download ${synthOutput.docxFilename}](/api/workspaces/${workspaceId}/documents/${synthOutput.docxFilename})

📊 **Pipeline Data & Calculations (Excel)**
[Download ${synthOutput.xlsxFilename}](/api/workspaces/${workspaceId}/documents/${synthOutput.xlsxFilename})

The Excel file includes editable assumptions — you can adjust parameters and see calculations update automatically.`;
}

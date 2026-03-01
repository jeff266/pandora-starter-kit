import fs from 'fs/promises';
import path from 'path';
import { callLLM } from '../utils/llm-router.js';
import type { ExtractedContent } from './types.js';

const MAX_TEXT = 8000;

function truncate(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max) + '\n[Content truncated]';
}

async function extractPDF(filePath: string): Promise<string> {
  const pdfModule = await import('pdf-parse');
  const pdfParse = ((pdfModule as { default?: unknown }).default ?? pdfModule) as (buf: Buffer) => Promise<{ text: string }>;
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer as Buffer);
  return data.text || '';
}

async function extractDOCX(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: buffer as Buffer });
  return result.value || '';
}

async function extractXLSX(filePath: string): Promise<string> {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.readFile(filePath);
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 3)) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    lines.push(`## Sheet: ${sheetName}\n${csv}`);
  }
  return lines.join('\n\n');
}

async function extractImage(filePath: string, _mimeType: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString('base64');
  const mimeType = _mimeType.startsWith('image/') ? _mimeType : 'image/png';

  const imageContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64 },
    },
    {
      type: 'text',
      text: 'Extract all structured data visible in this image. Include tables, lists, numbers, names, and any text. Format as plain text.',
    },
  ];

  const response = await callLLM('system', 'extract', {
    messages: [{ role: 'user', content: imageContent }],
    temperature: 0.1,
    maxTokens: 1000,
  });
  return response.content || '';
}

export async function extractText(filePath: string, mimeType: string): Promise<ExtractedContent> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let text = '';
    let pages: number | undefined;

    if (mimeType === 'application/pdf' || ext === '.pdf') {
      text = await extractPDF(filePath);
      pages = Math.max(1, Math.round(text.length / 2000));
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
      text = await extractDOCX(filePath);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'text/csv' ||
      ext === '.xlsx' || ext === '.csv'
    ) {
      text = await extractXLSX(filePath);
    } else if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      text = await extractImage(filePath, mimeType);
    } else if (mimeType === 'text/plain' || mimeType === 'text/markdown' || ext === '.txt' || ext === '.md') {
      text = await fs.readFile(filePath, 'utf-8');
    } else {
      return { text: '', confidence: 0, mime_type: mimeType };
    }

    const truncated = truncate(text);
    const confidence = text.length > 50 ? 0.85 : 0.3;

    return { text: truncated, pages, confidence, mime_type: mimeType };
  } catch (err) {
    console.error('[document-extractor] Failed to extract:', err);
    return { text: '', confidence: 0, mime_type: mimeType };
  }
}

import PptxGenJS from 'pptxgenjs';
import { ReportGenerationContext, SectionContent, MetricCard, DealCard, ActionItem } from '../reports/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const C = {
  bg: '0F172A',
  cardBg: '1E293B',
  surfaceBg: '334155',
  white: 'FFFFFF',
  offWhite: 'F1F5F9',
  lightGray: '94A3B8',
  midGray: '64748B',
  border: '475569',
  blue: '3B82F6',
  blueLight: '60A5FA',
  green: '22C55E',
  greenBg: '166534',
  amber: 'F59E0B',
  amberBg: '92400E',
  red: 'EF4444',
  redBg: '991B1B',
};

export interface PPTXRenderResult {
  filepath: string;
  size_bytes: number;
  download_url: string;
}

function severityColors(severity?: string): { bg: string; fg: string; accent: string } {
  switch (severity) {
    case 'critical': return { bg: C.redBg, fg: C.red, accent: C.red };
    case 'warning': return { bg: C.amberBg, fg: C.amber, accent: C.amber };
    case 'good': return { bg: C.greenBg, fg: C.green, accent: C.green };
    default: return { bg: C.cardBg, fg: C.offWhite, accent: C.blue };
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/🚨|🔴|🟡|🟢|⚠️|📊|📈|📉|💡|🎯/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export async function renderPPTX(context: ReportGenerationContext): Promise<PPTXRenderResult> {
  const { workspace_id, template, sections_content, branding } = context;

  const pptx = new (PptxGenJS as any)();
  pptx.author = branding?.prepared_by || 'Pandora';
  pptx.company = branding?.company_name || 'Pandora GTM Intelligence';
  pptx.title = template.name;
  pptx.subject = template.description || '';
  pptx.layout = 'LAYOUT_16x9';

  const accent = branding?.primary_color?.replace('#', '') || C.blue;

  // ── TITLE SLIDE ──
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: C.bg };

  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 4.8, w: 10, h: 0.06, fill: { color: accent },
  });

  titleSlide.addText(template.name, {
    x: 0.8, y: 1.8, w: 8.4, h: 1.5,
    fontSize: 40, bold: true, color: C.white, fontFace: 'Calibri',
  });

  if (template.description) {
    titleSlide.addText(template.description, {
      x: 0.8, y: 3.2, w: 8.4, h: 0.6,
      fontSize: 18, color: C.lightGray, fontFace: 'Calibri',
    });
  }

  titleSlide.addText(
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    { x: 0.8, y: 5.2, w: 4, h: 0.4, fontSize: 13, color: C.midGray }
  );

  if (branding?.prepared_by) {
    titleSlide.addText(branding.prepared_by, {
      x: 5.2, y: 5.2, w: 4, h: 0.4, fontSize: 13, color: C.midGray, align: 'right',
    });
  }

  // ── CONTENT SLIDES ──
  for (const section of sections_content) {
    // Section header slide
    const headerSlide = pptx.addSlide();
    headerSlide.background = { color: C.bg };
    headerSlide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.08, fill: { color: accent },
    });

    headerSlide.addText(section.title, {
      x: 0.6, y: 0.3, w: 8.8, h: 0.7,
      fontSize: 28, bold: true, color: C.white, fontFace: 'Calibri',
    });

    // Narrative on the header slide
    if (section.narrative && !section.narrative.startsWith('⚠')) {
      const cleaned = stripMarkdown(section.narrative);
      const firstPara = cleaned.split('\n\n')[0] || cleaned;
      headerSlide.addText(firstPara.slice(0, 500), {
        x: 0.6, y: 1.3, w: 8.8, h: 3.5,
        fontSize: 13, color: C.offWhite, fontFace: 'Calibri',
        valign: 'top', lineSpacingMultiple: 1.3,
      });
    }

    // Freshness
    headerSlide.addText(
      `Data: ${new Date(section.data_freshness).toLocaleDateString('en-US')} · ${Math.round(section.confidence * 100)}% confidence`,
      { x: 0.6, y: 5.1, w: 8.8, h: 0.3, fontSize: 9, color: C.midGray }
    );

    // Metrics slide (card grid)
    if (section.metrics && section.metrics.length > 0) {
      renderMetricsSlide(pptx, section, accent);
    }

    // Deal cards slide
    if (section.deal_cards && section.deal_cards.length > 0) {
      renderDealSlides(pptx, section, accent);
    }

    // Table slide
    if (section.table && section.table.rows.length > 0) {
      renderTableSlide(pptx, section, accent);
    }

    // Action items slide
    if (section.action_items && section.action_items.length > 0) {
      renderActionsSlide(pptx, section, accent);
    }
  }

  const filename = `${template.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.pptx`;
  const outDir = path.join(os.tmpdir(), 'pandora-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);

  await pptx.writeFile({ fileName: filepath });
  const stats = fs.statSync(filepath);

  return {
    filepath,
    size_bytes: stats.size,
    download_url: `/api/workspaces/${workspace_id}/reports/${template.id}/download/pptx?file=${filename}`,
  };
}

function renderMetricsSlide(pptx: any, section: SectionContent, accent: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: accent } });

  slide.addText(`${section.title} — Key Metrics`, {
    x: 0.6, y: 0.3, w: 8.8, h: 0.5,
    fontSize: 22, bold: true, color: C.white, fontFace: 'Calibri',
  });

  const metrics = section.metrics!;
  const cols = Math.min(metrics.length, 3);
  const cardW = (9.0 - (cols - 1) * 0.3) / cols;
  const cardH = 1.3;

  for (let i = 0; i < metrics.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.5 + col * (cardW + 0.3);
    const y = 1.2 + row * (cardH + 0.25);

    const m = metrics[i];
    const { bg, fg, accent: accentC } = severityColors(m.severity);

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: bg },
      rectRadius: 0.08,
      line: { color: C.border, width: 0.5 },
    });

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: 0.06, h: cardH,
      fill: { color: accentC },
    });

    slide.addText(m.label.toUpperCase(), {
      x: x + 0.15, y: y + 0.12, w: cardW - 0.3, h: 0.3,
      fontSize: 9, color: C.lightGray, fontFace: 'Calibri', bold: true,
    });

    const valueText = m.delta
      ? `${m.value}  ${m.delta_direction === 'up' ? '▲' : m.delta_direction === 'down' ? '▼' : '—'} ${m.delta}`
      : m.value;

    slide.addText(valueText, {
      x: x + 0.15, y: y + 0.45, w: cardW - 0.3, h: 0.55,
      fontSize: 22, bold: true, color: fg, fontFace: 'Calibri',
    });
  }
}

function renderDealSlides(pptx: any, section: SectionContent, accent: string): void {
  const deals = section.deal_cards!;
  const perSlide = 4;

  for (let i = 0; i < deals.length; i += perSlide) {
    const slide = pptx.addSlide();
    slide.background = { color: C.bg };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: accent } });

    slide.addText(`${section.title} — Deals (${i + 1}-${Math.min(i + perSlide, deals.length)} of ${deals.length})`, {
      x: 0.6, y: 0.3, w: 8.8, h: 0.5,
      fontSize: 20, bold: true, color: C.white, fontFace: 'Calibri',
    });

    const batch = deals.slice(i, i + perSlide);
    const cardH = 1.05;

    batch.forEach((card, idx) => {
      const y = 1.1 + idx * (cardH + 0.15);
      const { bg, fg, accent: ac } = severityColors(card.signal_severity);

      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y, w: 9, h: cardH,
        fill: { color: C.cardBg },
        rectRadius: 0.06,
        line: { color: C.border, width: 0.5 },
      });

      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y, w: 0.06, h: cardH,
        fill: { color: ac },
      });

      slide.addText(card.name, {
        x: 0.7, y: y + 0.08, w: 5.5, h: 0.3,
        fontSize: 13, bold: true, color: C.white, fontFace: 'Calibri',
      });

      if (card.amount) {
        slide.addText(card.amount, {
          x: 6.5, y: y + 0.08, w: 2.8, h: 0.3,
          fontSize: 14, bold: true, color: fg, fontFace: 'Calibri', align: 'right',
        });
      }

      const severity = card.signal_severity === 'critical' ? 'CRITICAL' : card.signal_severity === 'warning' ? 'WARNING' : 'INFO';
      const meta = [severity, card.owner, card.stage].filter(Boolean).join(' · ');
      slide.addText(meta, {
        x: 0.7, y: y + 0.4, w: 8.6, h: 0.25,
        fontSize: 10, color: C.lightGray, fontFace: 'Calibri',
      });

      if (card.action) {
        slide.addText(`→ ${card.action}`, {
          x: 0.7, y: y + 0.68, w: 8.6, h: 0.3,
          fontSize: 10, color: C.blueLight, fontFace: 'Calibri', italic: true,
        });
      }
    });
  }
}

function renderTableSlide(pptx: any, section: SectionContent, accent: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: accent } });

  slide.addText(`${section.title} — Data`, {
    x: 0.6, y: 0.3, w: 8.8, h: 0.5,
    fontSize: 20, bold: true, color: C.white, fontFace: 'Calibri',
  });

  const table = section.table!;
  const rows: any[][] = [];

  rows.push(table.headers.map(h => ({
    text: h,
    options: { bold: true, fontSize: 10, color: C.white, fill: { color: accent } },
  })));

  for (let r = 0; r < Math.min(table.rows.length, 12); r++) {
    const bgColor = r % 2 === 0 ? C.cardBg : C.surfaceBg;
    rows.push(table.headers.map(h => ({
      text: String(table.rows[r][h] ?? ''),
      options: { fontSize: 10, color: C.offWhite, fill: { color: bgColor } },
    })));
  }

  slide.addTable(rows, {
    x: 0.5, y: 1.1, w: 9, autoPage: false,
    border: { pt: 0.5, color: C.border },
  });
}

function renderActionsSlide(pptx: any, section: SectionContent, accent: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: accent } });

  slide.addText(`${section.title} — Action Items`, {
    x: 0.6, y: 0.3, w: 8.8, h: 0.5,
    fontSize: 20, bold: true, color: C.white, fontFace: 'Calibri',
  });

  const actions = section.action_items!.slice(0, 8);
  const itemH = 0.5;

  actions.forEach((a, idx) => {
    const y = 1.2 + idx * (itemH + 0.1);
    const dotColor = a.urgency === 'today' ? C.red : a.urgency === 'this_week' ? C.amber : C.green;

    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.7, y: y + 0.12, w: 0.18, h: 0.18,
      fill: { color: dotColor },
    });

    const label = a.urgency === 'today' ? 'TODAY' : a.urgency === 'this_week' ? 'THIS WEEK' : 'THIS MONTH';

    slide.addText([
      { text: `${label}  `, options: { fontSize: 9, bold: true, color: dotColor } },
      { text: a.action, options: { fontSize: 12, color: C.white } },
      { text: a.owner ? `  — ${a.owner}` : '', options: { fontSize: 10, color: C.lightGray, italic: true } },
    ], {
      x: 1.0, y, w: 8.3, h: itemH,
      valign: 'middle', fontFace: 'Calibri',
    });
  });
}

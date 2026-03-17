import type { ReportDocument } from './types.js';

export async function renderPdf(doc: ReportDocument): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 56, size: 'LETTER' });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const BRAND = '#4f46e5';
    const MUTED = '#6b7280';

    pdf.rect(0, 0, pdf.page.width, 6).fill(BRAND);

    pdf
      .moveDown(0.6)
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor('#111827')
      .text(doc.week_label || 'Weekly Briefing', { align: 'left' });

    pdf
      .font('Helvetica')
      .fontSize(13)
      .fillColor(MUTED)
      .text(doc.headline, { align: 'left' })
      .moveDown(1.2);

    pdf
      .moveTo(56, pdf.y)
      .lineTo(pdf.page.width - 56, pdf.y)
      .strokeColor('#e5e7eb')
      .lineWidth(1)
      .stroke()
      .moveDown(0.8);

    for (const section of doc.sections) {
      if (pdf.y > pdf.page.height - 120) pdf.addPage();

      pdf
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(BRAND)
        .text(section.title)
        .moveDown(0.3);

      pdf
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#1f2937')
        .text(section.content, { lineGap: 3 })
        .moveDown(1.0);
    }

    if (doc.actions && doc.actions.length > 0) {
      if (pdf.y > pdf.page.height - 150) pdf.addPage();

      pdf
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(BRAND)
        .text('Actions')
        .moveDown(0.3);

      for (const action of doc.actions) {
        pdf
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#1f2937')
          .text(`• [${action.urgency}] ${action.text}`, { lineGap: 2 });
      }
      pdf.moveDown(1.0);
    }

    if (doc.recommended_next_steps) {
      if (pdf.y > pdf.page.height - 120) pdf.addPage();

      pdf
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(BRAND)
        .text('Recommended Next Steps')
        .moveDown(0.3);

      pdf
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#1f2937')
        .text(doc.recommended_next_steps, { lineGap: 3 });
    }

    pdf
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        `Generated ${new Date(doc.generated_at).toLocaleDateString('en-US', { dateStyle: 'long' })}`,
        56,
        pdf.page.height - 36,
        { align: 'left' }
      );

    pdf.end();
  });
}

export async function renderDocx(doc: ReportDocument): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(
    new Paragraph({
      text: doc.week_label || 'Weekly Briefing',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [new TextRun({ text: doc.headline, color: '6b7280', italics: true })],
      spacing: { after: 300 },
    })
  );

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: section.content })],
        spacing: { after: 200 },
      })
    );
  }

  if (doc.actions && doc.actions.length > 0) {
    children.push(
      new Paragraph({ text: 'Actions', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } })
    );
    for (const action of doc.actions) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${action.urgency}] `, bold: true }),
            new TextRun({ text: action.text }),
          ],
          bullet: { level: 0 },
        })
      );
    }
  }

  if (doc.recommended_next_steps) {
    children.push(
      new Paragraph({ text: 'Recommended Next Steps', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }),
      new Paragraph({ children: [new TextRun({ text: doc.recommended_next_steps })] })
    );
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

export async function renderPptx(doc: ReportDocument): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new (pptxgen as any)();

  prs.layout = 'LAYOUT_WIDE';
  prs.defineLayout({ name: 'LAYOUT_WIDE', width: 13.33, height: 7.5 });

  const BRAND = '4f46e5';
  const MUTED = '6b7280';
  const WHITE = 'FFFFFF';

  const titleSlide = prs.addSlide();
  titleSlide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BRAND },
  });
  titleSlide.addText(doc.week_label || 'Weekly Briefing', {
    x: 0.8, y: 2.4, w: 11.73, h: 1.0,
    fontSize: 36, bold: true, color: WHITE, fontFace: 'Helvetica',
  });
  titleSlide.addText(doc.headline, {
    x: 0.8, y: 3.6, w: 11.73, h: 1.4,
    fontSize: 18, color: 'c7d2fe', fontFace: 'Helvetica', wrap: true,
  });

  for (const section of doc.sections) {
    const slide = prs.addSlide();

    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.5, fill: { color: BRAND },
    });

    slide.addText(section.title, {
      x: 0.5, y: 0.7, w: 12.33, h: 0.7,
      fontSize: 24, bold: true, color: '111827', fontFace: 'Helvetica',
    });

    slide.addText(section.content, {
      x: 0.5, y: 1.55, w: 12.33, h: 5.6,
      fontSize: 14, color: '374151', fontFace: 'Helvetica',
      valign: 'top', wrap: true,
    });
  }

  if (doc.actions && doc.actions.length > 0) {
    const actSlide = prs.addSlide();
    actSlide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.5, fill: { color: BRAND },
    });
    actSlide.addText('Actions', {
      x: 0.5, y: 0.7, w: 12.33, h: 0.7,
      fontSize: 24, bold: true, color: '111827',
    });
    const bulletLines = doc.actions.map(a => ({
      text: `[${a.urgency}]  ${a.text}`,
      options: { fontSize: 14, color: '374151', bullet: true },
    }));
    actSlide.addText(bulletLines, { x: 0.5, y: 1.55, w: 12.33, h: 5.6, valign: 'top', wrap: true });
  }

  const buf = await prs.write({ outputType: 'nodebuffer' }) as Buffer;
  return buf;
}

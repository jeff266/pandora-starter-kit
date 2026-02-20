/**
 * Generate beautiful Word document (.docx) for ICP Profile export
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  ShadingType,
  convertInchesToTwip,
} from 'docx';

interface IndustryEntry {
  name: string;
  win_rate?: number;
}

interface PainCluster {
  label: string;
  total?: number;
  won?: number;
  lift?: number;
}

interface BuyingCombo {
  personaNames?: string[];
  roles?: string[];
  winRate?: number;
  win_rate?: number;
  lift?: number;
  wonCount?: number;
  totalCount?: number;
}

interface IcpProfile {
  version: number;
  created_at: string;
  won_deals?: number;
  deals_analyzed?: number;
  company_profile?: {
    industries?: Array<IndustryEntry | string>;
    industryWinRates?: Array<{ industry: string; winRate: number; count: number; avgDeal: number }>;
    sizeWinRates?: Array<{ bucket: string; winRate: number; count: number; avgDeal: number }>;
    disqualifiers?: string[];
    sweetSpots?: Array<{ description: string; winRate: number; lift: number; count: number; avgDeal: number }>;
  };
  conversation_insights?: {
    pain_point_clusters?: PainCluster[];
  };
  buying_committees?: BuyingCombo[];
  scoring_weights?: Record<string, unknown>;
}

const COLORS = {
  primary: '6488EA', // Accent blue
  darkBg: '0F1319', // Surface dark
  text: 'F1F5F9', // Light text
  textMuted: '64748B', // Muted text
  green: '22C55E', // Success green
  red: 'EF4444', // Error red
  border: '1E293B', // Border gray
};

export async function generateWordDocument(profile: IcpProfile): Promise<Buffer> {
  const versionDate = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const wonDeals = profile.won_deals ?? 0;
  const tier = wonDeals >= 200 ? 3 : wonDeals >= 100 ? 2 : 1;

  const iwRates = profile.company_profile?.industryWinRates ?? [];
  const oldIndustries = profile.company_profile?.industries ?? [];
  const industryEntries: IndustryEntry[] =
    iwRates.length > 0
      ? iwRates.map(iw => ({ name: iw.industry, win_rate: iw.winRate }))
      : oldIndustries.map(ind => (typeof ind === 'string' ? { name: ind } : (ind as IndustryEntry)));

  const rates = industryEntries.map(e => e.win_rate ?? 0).filter(r => r > 0);
  const baseline = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  const sizeRates = profile.company_profile?.sizeWinRates ?? [];
  const clusters = profile.conversation_insights?.pain_point_clusters ?? [];
  const committees = profile.buying_committees ?? [];
  const topCombos = [...committees]
    .sort((a, b) => (b.winRate ?? b.win_rate ?? 0) - (a.winRate ?? a.win_rate ?? 0))
    .slice(0, 5);
  const disqualifiers = profile.company_profile?.disqualifiers ?? [];
  const sweetSpots = profile.company_profile?.sweetSpots ?? [];

  // Build document sections
  const sections = [];

  // Title Page
  sections.push(
    new Paragraph({
      text: 'ICP PROFILE EXPORT',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `Version ${profile.version} • ${versionDate} • Data Tier ${tier} of 3`,
          color: COLORS.textMuted,
          size: 20,
        }),
      ],
    }),
    new Paragraph({
      text: '',
      spacing: { after: 200 },
      border: {
        bottom: {
          color: COLORS.border,
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
    })
  );

  // Executive Summary
  sections.push(
    new Paragraph({
      text: 'Executive Summary',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      spacing: { after: 300 },
      children: [
        new TextRun({
          text: `This ICP profile represents data-driven intelligence extracted from ${wonDeals} won deals`,
          size: 22,
        }),
        ...(profile.deals_analyzed
          ? [
              new TextRun({
                text: ` (${profile.deals_analyzed} total analyzed)`,
                size: 22,
                color: COLORS.textMuted,
              }),
            ]
          : []),
        new TextRun({
          text: '. The following insights should guide territory planning, lead scoring, account prioritization, and outbound targeting.',
          size: 22,
        }),
      ],
    })
  );

  // Ideal Company Profile
  if (industryEntries.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Ideal Company Profile',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        text: 'INDUSTRY WIN RATES',
        spacing: { after: 150 },
        children: [
          new TextRun({
            text: 'INDUSTRY WIN RATES',
            size: 18,
            bold: true,
            color: COLORS.textMuted,
          }),
        ],
      })
    );

    // Industry table
    const industryRows = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Industry', bold: true })],
              }),
            ],
            shading: { fill: COLORS.darkBg, type: ShadingType.SOLID },
            width: { size: 40, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: 'Win Rate', bold: true })],
              }),
            ],
            shading: { fill: COLORS.darkBg, type: ShadingType.SOLID },
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: 'Lift', bold: true })],
              }),
            ],
            shading: { fill: COLORS.darkBg, type: ShadingType.SOLID },
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ];

    for (const ind of industryEntries) {
      const wr = ind.win_rate ?? 0;
      const lift = baseline > 0 ? wr / baseline : 0;
      const isHighLift = lift >= 1.5;

      industryRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ text: ind.name })],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  text: wr > 0 ? `${Math.round(wr * 100)}%` : '—',
                  alignment: AlignmentType.RIGHT,
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: lift > 0 ? `${lift.toFixed(1)}×` : '—',
                      color: isHighLift ? COLORS.green : undefined,
                      bold: isHighLift,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: industryRows,
      })
    );
  }

  // Company Size
  if (sizeRates.filter(s => s.count > 0).length > 0) {
    sections.push(
      new Paragraph({
        text: 'COMPANY SIZE PATTERNS',
        spacing: { before: 300, after: 150 },
        children: [
          new TextRun({
            text: 'COMPANY SIZE PATTERNS',
            size: 18,
            bold: true,
            color: COLORS.textMuted,
          }),
        ],
      })
    );

    for (const sz of sizeRates.filter(s => s.count > 0)) {
      sections.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `${sz.bucket} employees: `,
              bold: true,
            }),
            new TextRun({
              text: `${Math.round(sz.winRate * 100)}% win rate (${sz.count} deals)`,
              color: COLORS.textMuted,
            }),
          ],
        })
      );
    }
  }

  // Sweet Spots
  if (sweetSpots.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Sweet Spots',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      })
    );

    for (const spot of sweetSpots) {
      sections.push(
        new Paragraph({
          spacing: { after: 150 },
          children: [
            new TextRun({
              text: '• ',
              size: 22,
              color: COLORS.primary,
              bold: true,
            }),
            new TextRun({
              text: spot.description,
              size: 22,
            }),
            new TextRun({
              text: ` — ${Math.round(spot.winRate * 100)}% win (${spot.lift.toFixed(1)}× lift, ${spot.count} deals)`,
              size: 20,
              color: COLORS.textMuted,
            }),
          ],
        })
      );
    }
  }

  // Buying Triggers
  if (clusters.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Buying Triggers',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        spacing: { after: 150 },
        children: [
          new TextRun({
            text: 'Pain points and themes that correlate with closed-won deals:',
            size: 22,
            color: COLORS.textMuted,
          }),
        ],
      })
    );

    for (const c of clusters) {
      const metrics = [];
      if (c.total != null && c.won != null) metrics.push(`${c.won}/${c.total} calls`);
      if (c.lift != null) metrics.push(`${c.lift.toFixed(1)}× lift`);

      sections.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: '• ',
              size: 22,
              color: COLORS.primary,
              bold: true,
            }),
            new TextRun({
              text: `"${c.label}"`,
              size: 22,
              italics: true,
            }),
            ...(metrics.length > 0
              ? [
                  new TextRun({
                    text: ` — ${metrics.join(', ')}`,
                    size: 20,
                    color: COLORS.green,
                    bold: true,
                  }),
                ]
              : []),
          ],
        })
      );
    }
  }

  // Buying Committee
  if (topCombos.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Winning Buying Committees',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        spacing: { after: 150 },
        children: [
          new TextRun({
            text: 'Multi-persona patterns with highest win rates:',
            size: 22,
            color: COLORS.textMuted,
          }),
        ],
      })
    );

    topCombos.forEach((combo, i) => {
      const names = combo.personaNames ?? combo.roles ?? [];
      const wr = combo.winRate ?? combo.win_rate;
      const lift = combo.lift;
      const metrics = [];
      if (wr != null) metrics.push(`${Math.round(wr * 100)}% win`);
      if (lift != null && lift > 1) metrics.push(`${lift.toFixed(1)}× lift`);
      if (combo.wonCount != null && combo.totalCount != null) metrics.push(`${combo.wonCount}/${combo.totalCount}`);

      sections.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: `${i + 1}. `,
              size: 22,
              bold: true,
              color: COLORS.primary,
            }),
            new TextRun({
              text: names.join(' + '),
              size: 22,
            }),
            ...(metrics.length > 0
              ? [
                  new TextRun({
                    text: ` — ${metrics.join(', ')}`,
                    size: 20,
                    color: COLORS.green,
                    bold: true,
                  }),
                ]
              : []),
          ],
        })
      );
    });
  }

  // Disqualifiers
  if (disqualifiers.length > 0) {
    sections.push(
      new Paragraph({
        text: 'Disqualification Criteria',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        spacing: { after: 150 },
        children: [
          new TextRun({
            text: 'Avoid pursuing deals with these characteristics:',
            size: 22,
            color: COLORS.textMuted,
          }),
        ],
      })
    );

    for (const d of disqualifiers) {
      sections.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: '✕ ',
              size: 22,
              color: COLORS.red,
              bold: true,
            }),
            new TextRun({
              text: d,
              size: 22,
            }),
          ],
        })
      );
    }
  }

  // Recommended Actions
  sections.push(
    new Paragraph({
      text: 'Recommended Actions',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      spacing: { after: 150 },
      children: [
        new TextRun({
          text: 'Based on this profile:',
          size: 22,
          color: COLORS.textMuted,
        }),
      ],
    })
  );

  const actions = [
    'Update lead scoring weights to prioritize high-lift industries',
    'Train reps on winning buying committee patterns',
    'Incorporate buying triggers into discovery call frameworks',
    'Apply disqualification criteria in MQL → SQL handoff',
    'Re-segment territory assignments based on industry fit',
  ];

  actions.forEach((action, i) => {
    sections.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: `${i + 1}. `,
            size: 22,
            bold: true,
            color: COLORS.primary,
          }),
          new TextRun({
            text: action,
            size: 22,
          }),
        ],
      })
    );
  });

  // Footer
  sections.push(
    new Paragraph({
      text: '',
      spacing: { before: 400, after: 200 },
      border: {
        top: {
          color: COLORS.border,
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Generated by Pandora ICP Discovery on ${versionDate}`,
          size: 20,
          color: COLORS.textMuted,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'This export contains proprietary RevOps intelligence. Distribute internally only.',
          size: 18,
          color: COLORS.textMuted,
          italics: true,
        }),
      ],
    })
  );

  // Create document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.75),
              left: convertInchesToTwip(0.75),
            },
          },
        },
        children: sections,
      },
    ],
  });

  // Generate buffer
  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

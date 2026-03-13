export interface ConciergeContext {
  quarter: string;
  attainmentPct: number | null;
  pipelineScope: {
    totalValue: number | null;
    dealCount: number | null;
    coverageRatio: number | null;
  };
  topFindings: Array<{
    severity: string;
    message: string;
  }>;
}

export function formatConciergeContextPreamble(ctx: ConciergeContext): string {
  const parts: string[] = [];
  if (ctx.quarter) parts.push(`Quarter: ${ctx.quarter}`);
  if (ctx.attainmentPct != null) parts.push(`Attainment: ${Math.round(ctx.attainmentPct)}%`);
  if (ctx.pipelineScope.totalValue != null) {
    const fmt = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K` : `$${v}`;
    parts.push(`Pipeline: ${fmt(ctx.pipelineScope.totalValue)} (${ctx.pipelineScope.dealCount ?? '?'} deals)`);
  }
  if (ctx.pipelineScope.coverageRatio != null) parts.push(`Coverage: ${ctx.pipelineScope.coverageRatio.toFixed(1)}×`);
  if (ctx.topFindings.length > 0) {
    parts.push('Key findings:');
    ctx.topFindings.forEach(f => parts.push(`  • [${f.severity}] ${f.message}`));
  }
  return parts.join('\n');
}

/**
 * Chart Renderer - Server-side chart rendering via QuickChart.io HTTP API
 *
 * Replaces chartjs-node-canvas (requires libcairo/libpango/libuuid native libs
 * unavailable in this environment) with a pure HTTPS call to QuickChart.io.
 *
 * The existing RenderChartInput interface and agents.ts call-site are preserved
 * via the renderChartToPNG backward-compat wrapper at the bottom.
 */

import * as https from 'https';
import type { ChartSuggestion, ChartNodeSpec, ChartDataPoint } from './types.js';

const COLORS = {
  primary:   '#0D9488',
  secondary: '#CBD5E1',
  accent:    '#F59E0B',
  danger:    '#EF4444',
  muted:     '#94A3B8',
};

const PALETTE = [
  COLORS.primary,
  COLORS.secondary,
  COLORS.accent,
  COLORS.danger,
  COLORS.muted,
];

// Semantic color map: label keyword → hex color
// Checked against lower-cased, trimmed label strings
const SEMANTIC_COLORS: Record<string, string> = {
  'created':        '#0D9488',  // teal — new/positive
  'advanced':       '#0D9488',  // teal — positive movement
  'won':            '#16A34A',  // green — closed won
  'closed won':     '#16A34A',
  'closed-won':     '#16A34A',
  'regressed':      '#F59E0B',  // amber — caution
  'lost':           '#EF4444',  // red — negative
  'closed lost':    '#EF4444',
  'closed-lost':    '#EF4444',
  'target':         '#CBD5E1',  // muted — benchmark
  'coverage':       '#0D9488',  // teal — actual
  'gap':            '#F59E0B',  // amber — shortfall
  'bear':           '#94A3B8',  // muted
  'base':           '#CBD5E1',  // light gray
  'bull':           '#F59E0B',  // amber — upside
  'open pipeline':  '#CBD5E1',
  'best case':      '#F59E0B',
  'commit':         '#0D9488',
  'committed':      '#0D9488',
  'pipeline':       '#CBD5E1',
};

// Chart Intelligence semantic colors: explicit color hints
const COLOR_HINT_MAP: Record<string, string> = {
  'dead':      '#EF4444',  // red — lost, stale >30d, zero activity
  'at_risk':   '#F59E0B',  // amber — high risk, approaching deadline
  'healthy':   '#0D9488',  // teal — won, on track, strong signals
  'neutral':   '#CBD5E1',  // light gray — time periods, stages
};

function getSemanticColors(labels: string[], defaultPalette: string[]): string[] {
  return labels.map((label, i) => {
    const key = label.toLowerCase().trim();
    return SEMANTIC_COLORS[key] ?? defaultPalette[i % defaultPalette.length];
  });
}

function getSemanticColorsFromHints(
  dataPoints: ChartDataPoint[],
  defaultPalette: string[]
): string[] {
  return dataPoints.map((point, i) => {
    // Explicit color hint from Chart Intelligence
    if (point.color_hint && COLOR_HINT_MAP[point.color_hint]) {
      return COLOR_HINT_MAP[point.color_hint];
    }
    // Fallback to label-based semantic matching
    const key = point.label.toLowerCase().trim();
    return SEMANTIC_COLORS[key] ?? defaultPalette[i % defaultPalette.length];
  });
}

export interface ChartRenderResult {
  section_id: string;
  png_buffer: Buffer;
  width: number;
  height: number;
}

export async function renderChartToPng(
  chart: ChartSuggestion,
  width = 560,
  height = 220
): Promise<ChartRenderResult> {
  const config = buildChartJsConfig(chart);

  const payload = {
    width,
    height,
    backgroundColor: 'white',
    format: 'png',
    chart: config,
  };

  const body = JSON.stringify(payload);
  const png_buffer = await fetchQuickChart(body);

  return { section_id: chart.section_id, png_buffer, width, height };
}

export async function renderAllCharts(
  charts: ChartSuggestion[]
): Promise<Map<string, ChartRenderResult>> {
  const results = new Map<string, ChartRenderResult>();

  await Promise.all(
    charts.map(async (chart) => {
      try {
        const result = await renderChartToPng(chart);
        results.set(chart.section_id, result);
      } catch (err) {
        console.error(`[ChartRenderer] Failed ${chart.section_id}:`, err);
      }
    })
  );

  return results;
}

function fetchQuickChart(body: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'quickchart.io',
      path: '/chart',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(
            new Error(
              `QuickChart error ${res.statusCode}: ` +
              buf.toString().slice(0, 200)
            )
          );
          return;
        }
        resolve(buf);
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('QuickChart timeout after 15s'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Normalize values to K units when max >= 1000.
 * QuickChart serializes ticks.callback functions to JSON where they break,
 * so we pre-normalize the data and annotate the axis title instead.
 * Count charts (all integers, max < 50) are left as-is.
 */
function normalizeValues(values: number[]): {
  normalized: number[];
  suffix: string;
  isCount: boolean;
} {
  const maxVal = Math.max(...values, 0);
  const allIntegers = values.every(v => Number.isInteger(v));

  // Count chart: small integers — don't normalize, force integer axis
  if (maxVal < 50 && allIntegers) {
    return { normalized: values, suffix: '', isCount: true };
  }

  if (maxVal >= 1_000_000) {
    return {
      normalized: values.map(v => Math.round(v / 1_000_000 * 10) / 10),
      suffix: '($M)',
      isCount: false,
    };
  }
  if (maxVal >= 1_000) {
    return {
      normalized: values.map(v => Math.round(v / 1_000)),
      suffix: '($K)',
      isCount: false,
    };
  }
  return { normalized: values, suffix: '', isCount: false };
}

function buildChartJsConfig(chart: ChartSuggestion): object {
  const labels = chart.data_labels;
  const rawValues = chart.data_values;
  const colors = getSemanticColors(labels, PALETTE);
  const { normalized, suffix, isCount } = normalizeValues(rawValues);

  // Y-axis title: prefer explicit suffix, then "Deals" for count charts
  const yAxisTitleText = suffix || (isCount ? 'Deals' : '');
  const yAxisTitle = yAxisTitleText
    ? { display: true, text: yAxisTitleText, color: '#94A3B8', font: { size: 10 } }
    : { display: false };

  // Y-axis ticks: force integers for count charts
  const yTicks = isCount
    ? { color: '#64748B', font: { size: 11 }, precision: 0, stepSize: 1 }
    : { color: '#64748B', font: { size: 11 } };

  const baseOptions = {
    plugins: {
      legend: { display: false },
      title: { display: false },  // Title rendered externally by PDF/docx renderer
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#64748B', font: { size: 11 } },
      },
      y: {
        min: isCount ? 0 : undefined,
        grid: { color: 'rgba(0,0,0,0.06)' },
        border: { display: false },
        title: yAxisTitle,
        ticks: yTicks,
      },
    },
  };

  switch (chart.chart_type) {
    case 'bar':
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: normalized,
            backgroundColor: colors,
            borderRadius: 4,
          }],
        },
        options: baseOptions,
      };

    case 'horizontalBar': {
      const xAxisTitleText = suffix || (isCount ? 'Deals' : '');
      const xAxisTitle = xAxisTitleText
        ? { display: true, text: xAxisTitleText, color: '#94A3B8', font: { size: 10 } }
        : { display: false };
      const xTicks = isCount
        ? { color: '#64748B', font: { size: 11 }, precision: 0, stepSize: 1 }
        : { color: '#64748B', font: { size: 11 } };
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: normalized,
            backgroundColor: colors,
            borderRadius: 4,
          }],
        },
        options: {
          ...baseOptions,
          indexAxis: 'y',
          scales: {
            x: {
              min: isCount ? 0 : undefined,
              grid: { color: 'rgba(0,0,0,0.06)' },
              border: { display: false },
              title: xAxisTitle,
              ticks: xTicks,
            },
            y: {
              grid: { display: false },
              ticks: { color: '#64748B', font: { size: 11 } },
            },
          },
        },
      };
    }

    case 'line':
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: normalized,
            borderColor: COLORS.primary,
            backgroundColor: 'rgba(13,148,136,0.1)',
            borderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3,
          }],
        },
        options: baseOptions,
      };

    case 'doughnut':
    case 'pie':
      return {
        type: chart.chart_type === 'pie' ? 'pie' : 'doughnut',
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: rawValues,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: 'white',
          }],
        },
        options: {
          plugins: {
            legend: {
              display: true,
              position: 'right',
              labels: {
                color: '#374151',
                font: { size: 11 },
                padding: 16,
              },
            },
            title: {
              display: true,
              text: chart.title,
              font: { size: 13, weight: 'bold' },
              color: '#1E293B',
            },
          },
          cutout: chart.chart_type === 'doughnut' ? '65%' : '0%',
        },
      };

    default:
      return buildChartJsConfig({ ...chart, chart_type: 'bar' });
  }
}

// ---------------------------------------------------------------------------
// Backward-compat wrapper used by agents.ts POST /charts endpoint
// ---------------------------------------------------------------------------

export interface RenderChartInput {
  chart_type: 'bar' | 'line' | 'pie' | 'doughnut' | 'horizontalBar';
  title: string;
  data_labels: string[];
  data_values: number[];
  chart_options?: Record<string, any>;
  width?: number;
  height?: number;
}

/**
 * Renders a chart from ChartNodeSpec (Chart Intelligence output).
 * Returns PNG buffer directly.
 */
export async function renderChartFromSpec(
  spec: ChartNodeSpec,
  width = 560,
  height = 220
): Promise<Buffer> {
  const labels = spec.data_points.map(dp => dp.label);
  const rawValues = spec.data_points.map(dp => dp.value);

  const colors = spec.color_scheme === 'semantic'
    ? getSemanticColorsFromHints(spec.data_points, PALETTE)
    : getSemanticColors(labels, PALETTE);

  const { normalized, suffix, isCount } = normalizeValues(rawValues);

  const config = buildChartJsConfigFromSpec(
    spec.chart_type,
    spec.title,
    labels,
    normalized,
    colors,
    suffix,
    isCount
  );

  const payload = {
    width,
    height,
    backgroundColor: 'white',
    format: 'png',
    chart: config,
  };

  const body = JSON.stringify(payload);
  return await fetchQuickChart(body);
}

function buildChartJsConfigFromSpec(
  chartType: 'bar' | 'horizontalBar' | 'line' | 'doughnut',
  title: string,
  labels: string[],
  normalized: number[],
  colors: string[],
  suffix: string,
  isCount: boolean
): object {
  const yAxisTitleText = suffix || (isCount ? 'Deals' : '');
  const yAxisTitle = yAxisTitleText
    ? { display: true, text: yAxisTitleText, color: '#94A3B8', font: { size: 10 } }
    : { display: false };

  const yTicks = isCount
    ? { color: '#64748B', font: { size: 11 }, precision: 0, stepSize: 1 }
    : { color: '#64748B', font: { size: 11 } };

  const baseOptions = {
    plugins: {
      legend: { display: false },
      title: { display: false },  // Title rendered externally by PDF/docx renderer
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#64748B', font: { size: 11 } },
      },
      y: {
        min: isCount ? 0 : undefined,
        grid: { color: 'rgba(0,0,0,0.06)' },
        border: { display: false },
        title: yAxisTitle,
        ticks: yTicks,
      },
    },
  };

  switch (chartType) {
    case 'bar':
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: title,
            data: normalized,
            backgroundColor: colors,
            borderRadius: 4,
          }],
        },
        options: baseOptions,
      };

    case 'horizontalBar': {
      const xAxisTitleText = suffix || (isCount ? 'Deals' : '');
      const xAxisTitle = xAxisTitleText
        ? { display: true, text: xAxisTitleText, color: '#94A3B8', font: { size: 10 } }
        : { display: false };
      const xTicks = isCount
        ? { color: '#64748B', font: { size: 11 }, precision: 0, stepSize: 1 }
        : { color: '#64748B', font: { size: 11 } };
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: title,
            data: normalized,
            backgroundColor: colors,
            borderRadius: 4,
          }],
        },
        options: {
          ...baseOptions,
          indexAxis: 'y',
          scales: {
            x: {
              min: isCount ? 0 : undefined,
              grid: { color: 'rgba(0,0,0,0.06)' },
              border: { display: false },
              title: xAxisTitle,
              ticks: xTicks,
            },
            y: {
              grid: { display: false },
              ticks: { color: '#64748B', font: { size: 11 } },
            },
          },
        },
      };
    }

    case 'line':
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: title,
            data: normalized,
            borderColor: COLORS.primary,
            backgroundColor: 'rgba(13,148,136,0.1)',
            borderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3,
          }],
        },
        options: baseOptions,
      };

    case 'doughnut':
      return {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            label: title,
            data: normalized,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: 'white',
          }],
        },
        options: {
          plugins: {
            legend: {
              display: true,
              position: 'right',
              labels: {
                color: '#374151',
                font: { size: 11 },
                padding: 16,
              },
            },
            title: {
              display: true,
              text: title,
              font: { size: 13, weight: 'bold' },
              color: '#1E293B',
            },
          },
          cutout: '65%',
        },
      };

    default:
      // Fallback to bar
      return buildChartJsConfigFromSpec('bar', title, labels, normalized, colors, suffix, isCount);
  }
}

export async function renderChartToPNG(input: RenderChartInput): Promise<Buffer> {
  const compat: ChartSuggestion = {
    section_id: 'adhoc',
    chart_type: input.chart_type,
    title: input.title,
    data_labels: input.data_labels,
    data_values: input.data_values,
    reasoning: '',
    priority: 'medium',
  };
  const result = await renderChartToPng(compat, input.width, input.height);
  return result.png_buffer;
}

export async function renderChartToDataURL(input: RenderChartInput): Promise<string> {
  const buffer = await renderChartToPNG(input);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

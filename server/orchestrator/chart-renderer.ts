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
  // Movement / stage transitions
  'created':              '#0D9488',  // teal — new/positive
  'advanced':             '#0D9488',  // teal — positive movement
  'regressed':            '#F59E0B',  // amber — caution

  // Win/loss
  'won':                  '#16A34A',  // green — closed won
  'closed won':           '#16A34A',
  'closed-won':           '#16A34A',
  'lost':                 '#EF4444',  // red — negative
  'closed lost':          '#EF4444',
  'closed-lost':          '#EF4444',

  // Comparison states
  'target':               '#CBD5E1',  // muted — benchmark
  'coverage target':      '#CBD5E1',
  'coverage':             '#0D9488',  // teal — actual
  'gap':                  '#F59E0B',  // amber — shortfall
  'actual':               '#0D9488',  // teal — what we have
  'benchmark':            '#CBD5E1',

  // Directional
  'positive':             '#0D9488',
  'negative':             '#EF4444',
  'neutral':              '#94A3B8',

  // Forecast scenarios
  'bear':                 '#94A3B8',  // muted
  'base':                 '#CBD5E1',  // light gray
  'bull':                 '#F59E0B',  // amber — upside

  // Pipeline states
  'open pipeline':        '#CBD5E1',
  'remaining pipeline':   '#CBD5E1',
  'best case':            '#F59E0B',
  'commit':               '#0D9488',
  'committed':            '#0D9488',
  'pipeline':             '#CBD5E1',
};

// Chart Intelligence semantic colors: explicit color_hint values → hex
// Extended to cover comparative color scheme (actual/target/positive)
const COLOR_HINT_MAP: Record<string, string> = {
  // Risk semantics
  'dead':      '#EF4444',  // red — lost, stale >30d, zero activity
  'at_risk':   '#F59E0B',  // amber — high risk, approaching deadline
  'healthy':   '#0D9488',  // teal — won, on track, strong signals
  'neutral':   '#CBD5E1',  // light gray — time periods, stages

  // Comparison / coverage semantics (used by coverage_gap, pipeline_composition)
  'actual':    '#0D9488',  // teal — what we currently have
  'target':    '#CBD5E1',  // muted gray — goal / benchmark
  'positive':  '#0D9488',  // teal — alias for healthy
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

  // Chart.js v2 format (QuickChart default): legend/title at top-level of options,
  // NOT nested under plugins (plugins.* is v3 syntax and is ignored by QuickChart v2)
  const baseOptions = {
    legend: { display: false },   // v2: top-level
    title: { display: false },    // v2: top-level — renderer adds title above the image
    scales: {
      xAxes: [{ gridLines: { display: false }, ticks: { fontColor: '#64748B', fontSize: 11 } }],
      yAxes: [{
        ticks: {
          fontColor: '#64748B',
          fontSize: 11,
          ...(isCount ? { precision: 0, stepSize: 1, beginAtZero: true } : {}),
        },
        gridLines: { color: 'rgba(0,0,0,0.06)', drawBorder: false },
        ...(yAxisTitleText ? { scaleLabel: { display: true, labelString: yAxisTitleText, fontColor: '#94A3B8', fontSize: 10 } } : {}),
      }],
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
          }],
        },
        options: baseOptions,
      };

    case 'horizontalBar': {
      const xAxisTitleText = suffix || (isCount ? 'Deals' : '');
      return {
        type: 'horizontalBar',  // v2: distinct type, not type:'bar'+indexAxis:'y'
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: normalized,
            backgroundColor: colors,
          }],
        },
        options: {
          legend: { display: false },
          title: { display: false },
          scales: {
            xAxes: [{
              ticks: {
                fontColor: '#64748B',
                fontSize: 11,
                ...(isCount ? { precision: 0, stepSize: 1, beginAtZero: true } : { beginAtZero: true }),
              },
              gridLines: { color: 'rgba(0,0,0,0.06)', drawBorder: false },
              ...(xAxisTitleText ? { scaleLabel: { display: true, labelString: xAxisTitleText, fontColor: '#94A3B8', fontSize: 10 } } : {}),
            }],
            yAxes: [{ gridLines: { display: false }, ticks: { fontColor: '#64748B', fontSize: 11 } }],
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
            lineTension: 0.3,  // v2: lineTension (not tension which is v3)
          }],
        },
        options: baseOptions,
      };

    case 'doughnut':
    case 'pie': {
      // Build a formatter function string that QuickChart evaluates server-side.
      // Must be a string (not a real function) so JSON.stringify preserves it.
      const pieFormatter = isCount
        ? 'function(v){return String(Math.round(v));}'
        : suffix === '($M)'
          ? 'function(v){return "$"+v.toFixed(1)+"M";}'
          : suffix === '($K)'
            ? 'function(v){return "$"+Math.round(v)+"K";}'
            : 'function(v){return String(v);}';
      return {
        type: chart.chart_type === 'pie' ? 'pie' : 'doughnut',
        data: {
          labels,
          datasets: [{
            label: chart.title,
            data: normalized,  // pre-normalized so labels aren't raw millions/thousands
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: 'white',
          }],
        },
        options: {
          // v2 format: legend/title at top-level, not under plugins
          legend: {
            display: true,
            position: 'right',
            labels: { fontColor: '#374151', fontSize: 11, padding: 16 },
          },
          title: { display: false },  // renderer adds title above image
          cutoutPercentage: chart.chart_type === 'doughnut' ? 65 : 0,  // v2 uses percentage int
          plugins: {
            datalabels: {
              formatter: pieFormatter,
              color: 'white',
              font: { weight: 'bold', size: 11 },
            },
          },
        },
      };
    }

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
const MAX_CHART_SIZE_BYTES = 150_000; // 150KB

export async function renderChartFromSpec(
  spec: ChartNodeSpec,
  width = 560,
  height = 220
): Promise<Buffer> {
  const labels = spec.data_points.map(dp => dp.label);
  const rawValues = spec.data_points.map(dp => dp.value);

  // Color resolution by scheme:
  // 'semantic'|'comparative' → explicit color_hint values from Chart Intelligence
  // 'uniform'                → all bars teal (single metric, no comparison needed)
  // 'categorical'|'gradient' → label-keyword based semantic lookup
  const colors =
    spec.color_scheme === 'semantic' || spec.color_scheme === 'comparative'
      ? getSemanticColorsFromHints(spec.data_points, PALETTE)
      : spec.color_scheme === 'uniform'
        ? spec.data_points.map(() => COLORS.primary)
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

  let pngBuffer = await fetchQuickChart(JSON.stringify(payload));

  console.log(`[ChartRenderer] ${spec.title}: ${Math.round(pngBuffer.length / 1000)}KB (${width}×${height})`);

  if (pngBuffer.length > MAX_CHART_SIZE_BYTES) {
    console.warn(
      `[ChartRenderer] Chart PNG size ${Math.round(pngBuffer.length / 1000)}KB ` +
      `exceeds ${MAX_CHART_SIZE_BYTES / 1000}KB cap. Re-rendering at lower resolution.`
    );
    const smallPayload = { ...payload, width: 400, height: 160, chart: config };
    pngBuffer = await fetchQuickChart(JSON.stringify(smallPayload));
    console.log(`[ChartRenderer] Re-rendered: ${Math.round(pngBuffer.length / 1000)}KB (400×160)`);
  }

  return pngBuffer;
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

  // Chart.js v2 format (QuickChart default): legend/title at top-level of options,
  // NOT nested under plugins (plugins.* is v3 syntax, silently ignored by QuickChart v2)
  const baseOptions = {
    legend: { display: false },   // v2: top-level
    title: { display: false },    // v2: top-level — renderer adds title above the image
    scales: {
      xAxes: [{ gridLines: { display: false }, ticks: { fontColor: '#64748B', fontSize: 11 } }],
      yAxes: [{
        ticks: {
          fontColor: '#64748B',
          fontSize: 11,
          ...(isCount ? { precision: 0, stepSize: 1, beginAtZero: true } : {}),
        },
        gridLines: { color: 'rgba(0,0,0,0.06)', drawBorder: false },
        ...(yAxisTitle.display ? { scaleLabel: { display: true, labelString: (yAxisTitle as any).text, fontColor: '#94A3B8', fontSize: 10 } } : {}),
      }],
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
          }],
        },
        options: baseOptions,
      };

    case 'horizontalBar': {
      const xAxisTitleText = suffix || (isCount ? 'Deals' : '');
      return {
        type: 'horizontalBar',  // v2: distinct type (not type:'bar'+indexAxis:'y' which is v3)
        data: {
          labels,
          datasets: [{
            label: title,
            data: normalized,
            backgroundColor: colors,
          }],
        },
        options: {
          legend: { display: false },
          title: { display: false },
          scales: {
            xAxes: [{
              ticks: {
                fontColor: '#64748B',
                fontSize: 11,
                beginAtZero: true,
                ...(isCount ? { precision: 0, stepSize: 1 } : {}),
              },
              gridLines: { color: 'rgba(0,0,0,0.06)', drawBorder: false },
              ...(xAxisTitleText ? { scaleLabel: { display: true, labelString: xAxisTitleText, fontColor: '#94A3B8', fontSize: 10 } } : {}),
            }],
            yAxes: [{ gridLines: { display: false }, ticks: { fontColor: '#64748B', fontSize: 11 } }],
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
            lineTension: 0.3,  // v2: lineTension (not tension which is v3)
          }],
        },
        options: baseOptions,
      };

    case 'doughnut': {
      const doughnutFormatter = isCount
        ? 'function(v){return String(Math.round(v));}'
        : suffix === '($M)'
          ? 'function(v){return "$"+v.toFixed(1)+"M";}'
          : suffix === '($K)'
            ? 'function(v){return "$"+Math.round(v)+"K";}'
            : 'function(v){return String(v);}';
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
          // Doughnut keeps legend visible — segment names are the key data
          legend: {
            display: true,
            position: 'right',
            labels: { fontColor: '#374151', fontSize: 11, padding: 16 },
          },
          title: { display: false },        // renderer adds title above image
          cutoutPercentage: 65,            // v2: integer percentage (not cutout:'65%' which is v3)
          plugins: {
            datalabels: {
              formatter: doughnutFormatter,
              color: 'white',
              font: { weight: 'bold', size: 11 },
            },
          },
        },
      };
    }

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

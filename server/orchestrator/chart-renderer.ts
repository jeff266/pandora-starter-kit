/**
 * Chart Renderer - Server-side chart rendering using chartjs-node-canvas
 *
 * Renders Chart.js charts to PNG buffers for embedding in DOCX/PDF exports
 */

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;

// Color palette for charts - matching Pandora brand
const COLORS = {
  teal: '#0D9488',
  blue: '#3B82F6',
  amber: '#D97706',
  red: '#DC2626',
  green: '#16A34A',
  purple: '#7C3AED',
  pink: '#EC4899',
  slate: '#64748B',
};

const CHART_COLORS = [
  COLORS.teal,
  COLORS.blue,
  COLORS.amber,
  COLORS.green,
  COLORS.purple,
  COLORS.pink,
  COLORS.red,
  COLORS.slate,
];

export interface RenderChartInput {
  chart_type: 'bar' | 'line' | 'pie' | 'doughnut' | 'horizontalBar';
  title: string;
  data_labels: string[];
  data_values: number[];
  chart_options?: Record<string, any>;
  width?: number;
  height?: number;
}

export async function renderChartToPNG(
  input: RenderChartInput
): Promise<Buffer> {
  const width = input.width || DEFAULT_WIDTH;
  const height = input.height || DEFAULT_HEIGHT;

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: '#FFFFFF',
  });

  // Map horizontalBar to indexAxis: 'y' for bar chart (Chart.js v3+)
  let chartType = input.chart_type;
  let indexAxis: 'x' | 'y' = 'x';
  if (input.chart_type === 'horizontalBar') {
    chartType = 'bar';
    indexAxis = 'y';
  }

  // Build Chart.js configuration
  const configuration: ChartConfiguration = {
    type: chartType as any,
    data: {
      labels: input.data_labels,
      datasets: [
        {
          label: input.title,
          data: input.data_values,
          backgroundColor: chartType === 'pie' || chartType === 'doughnut'
            ? CHART_COLORS.slice(0, input.data_values.length)
            : COLORS.teal,
          borderColor: chartType === 'line' ? COLORS.teal : undefined,
          borderWidth: chartType === 'line' ? 2 : 1,
          fill: chartType === 'line' ? false : undefined,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: input.title,
          font: {
            size: 16,
            weight: 'bold',
          },
          color: '#1E293B',
        },
        legend: {
          display: chartType === 'pie' || chartType === 'doughnut',
          position: 'right',
        },
      },
      scales: chartType !== 'pie' && chartType !== 'doughnut' ? {
        x: {
          ticks: { color: '#64748B' },
          grid: { color: '#E2E8F0' },
        },
        y: {
          ticks: { color: '#64748B' },
          grid: { color: '#E2E8F0' },
          beginAtZero: true,
        },
      } : undefined,
      indexAxis,
      ...input.chart_options,
    } as any,
  };

  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  return buffer;
}

export async function renderChartToDataURL(
  input: RenderChartInput
): Promise<string> {
  const buffer = await renderChartToPNG(input);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

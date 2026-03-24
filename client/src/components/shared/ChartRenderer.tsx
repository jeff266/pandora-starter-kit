import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, PieChart, Pie, Cell, Legend,
  ComposedChart, ScatterChart, Scatter, LabelList,
} from 'recharts';
import { colors } from '../../styles/theme';
import type { ChartSpec, ChartDataPoint } from '../../types/chart-types';

// Multi-series data format from Live Query endpoint
interface MultiSeriesData {
  type: 'multi';
  x_values: any[];
  series: Array<{ name: any; values: number[] }>;
}

interface ChartRendererProps {
  spec: ChartSpec;
  compact?: boolean;
}

function sortData(data: ChartSpec['data'], sort?: ChartSpec['sort']): ChartSpec['data'] {
  if (sort === 'value_desc') return [...data].sort((a, b) => b.value - a.value);
  if (sort === 'value_asc') return [...data].sort((a, b) => a.value - b.value);
  return data;
}

function formatCurrency(val: number, decimalPlaces?: number): string {
  const dp = decimalPlaces ?? 1;
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(dp)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(dp)}K`;
  return `$${val.toFixed(dp)}`;
}

function formatValue(
  val: number,
  fmt?: 'currency' | 'number' | 'percent' | 'raw' | 'km',
  decimalPlaces?: number
): string {
  const dp = decimalPlaces ?? (fmt === 'currency' ? 1 : fmt === 'percent' ? 1 : 0);

  if (fmt === 'currency') return formatCurrency(val, dp);
  if (fmt === 'percent') return `${val.toFixed(dp)}%`;
  if (fmt === 'km') {
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(dp)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(dp)}K`;
    return val.toFixed(dp);
  }
  if (fmt === 'raw') return val.toFixed(dp);
  return val.toLocaleString();
}

function getSegmentColor(segment: string | undefined, colorMap?: Record<string, string>): string {
  if (segment && colorMap && colorMap[segment]) return colorMap[segment];
  if (segment === 'positive' || segment === 'good' || segment === 'won') return 'var(--color-accent)';
  if (segment === 'negative' || segment === 'risk' || segment === 'lost') return 'var(--color-coral)';
  return 'var(--color-accent)';
}

const CHART_COLORS = [
  'var(--color-accent)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-yellow)',
  'var(--color-coral)',
  'var(--color-orange)',
];

function getSeriesColor(
  seriesName: string,
  index: number,
  colorMode?: 'semantic' | 'uniform' | 'categorical',
  colorMap?: Record<string, string>
): string {
  // Check explicit colorMap first
  if (colorMap && colorMap[seriesName]) return colorMap[seriesName];

  // Semantic mode: interpret series names as semantic categories
  if (colorMode === 'semantic') {
    if (seriesName === 'positive' || seriesName === 'good' || seriesName === 'won') return 'var(--color-accent)';
    if (seriesName === 'negative' || seriesName === 'risk' || seriesName === 'lost') return 'var(--color-coral)';
  }

  // Uniform mode: use primary color for all series
  if (colorMode === 'uniform') return 'var(--color-accent)';

  // Categorical mode (default): cycle through palette
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Transform multi-series format to Recharts stacked format
 * Input: { x_values: ['Q1', 'Q2'], series: [{ name: 'Enterprise', values: [100, 200] }, ...] }
 * Output: [{ label: 'Q1', Enterprise: 100, SMB: 50 }, { label: 'Q2', Enterprise: 200, SMB: 75 }]
 */
function toStackedFormat(multiData: MultiSeriesData): Array<Record<string, any>> {
  return multiData.x_values.map((xVal, xIdx) => {
    const row: Record<string, any> = { label: xVal };
    multiData.series.forEach(s => {
      row[String(s.name)] = s.values[xIdx] ?? 0;
    });
    return row;
  });
}

/**
 * Compute outlier status for bar chart data.
 * Outliers are bars that exceed threshold_multiple × median value.
 * Outlier bars are capped at 1.3× the tallest non-outlier bar.
 */
function computeOutlierBars(
  data: Array<{ label: string; value: number; [key: string]: any }>,
  spec: ChartSpec
): Array<{ label: string; value: number; isOutlier: boolean; cappedValue: number; trueValue: number; [key: string]: any }> {
  if (!spec.outlier_mode?.enabled) {
    return data.map(d => ({
      ...d,
      isOutlier: false,
      cappedValue: d.value,
      trueValue: d.value,
    }));
  }

  const threshold = spec.outlier_mode.threshold_multiple ?? 3;
  const values = data.map(d => d.value).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const outlierCutoff = median * threshold;

  // Find the max non-outlier value for scale
  const maxNormal = Math.max(
    ...data
      .filter(d => d.value <= outlierCutoff)
      .map(d => d.value),
    median // Fallback to median if all values are outliers
  );

  return data.map(d => ({
    ...d,
    isOutlier: d.value > outlierCutoff,
    // Cap outlier bars at 1.3× the tallest normal bar
    cappedValue: d.value > outlierCutoff ? maxNormal * 1.3 : d.value,
    trueValue: d.value,
  }));
}

/**
 * Custom bar shape component for rendering outlier bars with broken axis indicator.
 * When isOutlier is true, renders a wavy line near the top of the bar to indicate truncation,
 * and displays the true value above the bar.
 */
function OutlierBar(props: any) {
  const {
    x, y, width, height, fill,
    isOutlier, trueValue, formattedValue
  } = props;

  if (!isOutlier) {
    // Normal bar — standard rect with rounded top
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fill}
          rx={3}
          ry={3}
        />
      </g>
    );
  }

  // Outlier bar — capped with wavy break indicator
  const waveY = y + 20; // Position of wavy line from top of bar
  const waveAmplitude = 4;
  const waveFreq = width / 3;

  // SVG path for wavy line across bar width
  const wavePath =
    `M ${x},${waveY} ` +
    `Q ${x + waveFreq * 0.5},${waveY - waveAmplitude} ${x + waveFreq},${waveY} ` +
    `Q ${x + waveFreq * 1.5},${waveY + waveAmplitude} ${x + waveFreq * 2},${waveY} ` +
    `Q ${x + waveFreq * 2.5},${waveY - waveAmplitude} ${x + width},${waveY}`;

  return (
    <g>
      {/* Bar body */}
      <rect x={x} y={y} width={width} height={height} fill={fill} />

      {/* White mask over wavy line area */}
      <rect
        x={x}
        y={waveY - 6}
        width={width}
        height={14}
        fill="white"
        opacity={0.9}
      />

      {/* Wavy break line */}
      <path
        d={wavePath}
        stroke={fill}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />

      {/* True value label above the bar */}
      <text
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
        fill={fill}
      >
        {formattedValue}
      </text>
    </g>
  );
}

function BarTooltip({ active, payload, label, yFormat, decimalPlaces }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-surfaceRaised)',
      border: '1px solid var(--color-border)',
      borderRadius: 6, padding: '8px 12px',
      fontSize: 12, color: 'var(--color-text)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }}>
          {p.name && <span style={{ marginRight: 4 }}>{p.name}:</span>}
          {formatValue(p.value, yFormat, decimalPlaces)}
        </div>
      ))}
    </div>
  );
}

function BarChartRenderer({ spec, height, compact }: { spec: ChartSpec; height: number; compact: boolean }) {
  const yFmt = spec.axis_format?.number_format || spec.yAxis?.format || 'currency';
  const decimalPlaces = spec.axis_format?.decimal_places;
  const dataLabelsEnabled = spec.data_labels?.enabled ?? false;
  const dataLabelsPosition = spec.data_labels?.position || 'outside_end';
  const dataLabelsFmt = spec.data_labels?.number_format || yFmt;
  const dataLabelsDP = spec.data_labels?.decimal_places ?? decimalPlaces;

  // Process data for outlier detection and capping
  const processedData = computeOutlierBars(spec.data, spec);
  const outlierModeEnabled = spec.outlier_mode?.enabled ?? false;

  // Custom bar shape with access to processedData via closure
  const CustomBar = (props: any) => {
    const dataPoint = processedData[props.index];
    if (!dataPoint) return null;

    return (
      <OutlierBar
        {...props}
        isOutlier={dataPoint.isOutlier}
        trueValue={dataPoint.trueValue}
        formattedValue={formatValue(dataPoint.trueValue, yFmt, decimalPlaces)}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={processedData} margin={{ top: outlierModeEnabled ? 40 : 20, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatValue(v, yFmt, decimalPlaces)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
          domain={spec.axis_format?.y_min != null || spec.axis_format?.y_max != null
            ? [spec.axis_format?.y_min ?? 'auto', spec.axis_format?.y_max ?? 'auto']
            : undefined}
          label={spec.axis_format?.axis_title ? { value: spec.axis_format.axis_title, angle: -90, position: 'insideLeft' } : undefined}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} decimalPlaces={decimalPlaces} />} />
        <Bar
          dataKey={outlierModeEnabled ? "cappedValue" : "value"}
          radius={outlierModeEnabled ? [0, 0, 0, 0] : [3, 3, 0, 0]}
          shape={outlierModeEnabled ? CustomBar : undefined}
        >
          {processedData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={getSegmentColor(entry.segment, spec.colorMap)}
            />
          ))}
          {dataLabelsEnabled && !outlierModeEnabled && (
            <LabelList
              dataKey="value"
              position={dataLabelsPosition as any}
              formatter={(v: number) => formatValue(v, dataLabelsFmt, dataLabelsDP)}
              style={{ fontSize: 10, fill: 'var(--color-text)' }}
            />
          )}
        </Bar>
        {spec.referenceValue != null && (
          <ReferenceLine y={spec.referenceValue} stroke="var(--color-yellow)" strokeDasharray="4 4" />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function HorizontalBarChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.axis_format?.number_format || spec.yAxis?.format || 'currency';
  const decimalPlaces = spec.axis_format?.decimal_places;
  const dataLabelsEnabled = spec.data_labels?.enabled ?? false;
  const dataLabelsPosition = spec.data_labels?.position || 'outside_end';
  const dataLabelsFmt = spec.data_labels?.number_format || yFmt;
  const dataLabelsDP = spec.data_labels?.decimal_places ?? decimalPlaces;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={spec.data} margin={{ top: 4, right: 60, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => formatValue(v, yFmt, decimalPlaces)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          domain={spec.axis_format?.y_min != null || spec.axis_format?.y_max != null
            ? [spec.axis_format?.y_min ?? 'auto', spec.axis_format?.y_max ?? 'auto']
            : undefined}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} decimalPlaces={decimalPlaces} />} />
        {spec.referenceValue != null && (
          <ReferenceLine x={spec.referenceValue} stroke="var(--color-yellow)" strokeDasharray="4 4" />
        )}
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {spec.data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.annotation ? 'var(--color-coral)' : getSegmentColor(entry.segment, spec.colorMap)}
            />
          ))}
          {dataLabelsEnabled && (
            <LabelList
              dataKey="value"
              position={dataLabelsPosition as any}
              formatter={(v: number) => formatValue(v, dataLabelsFmt, dataLabelsDP)}
              style={{ fontSize: 10, fill: 'var(--color-text)' }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.axis_format?.number_format || spec.yAxis?.format || 'currency';
  const decimalPlaces = spec.axis_format?.decimal_places;
  const dataLabelsEnabled = spec.data_labels?.enabled ?? false;
  const dataLabelsPosition = spec.data_labels?.position || 'outside_end';
  const dataLabelsFmt = spec.data_labels?.number_format || yFmt;
  const dataLabelsDP = spec.data_labels?.decimal_places ?? decimalPlaces;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatValue(v, yFmt, decimalPlaces)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
          domain={spec.axis_format?.y_min != null || spec.axis_format?.y_max != null
            ? [spec.axis_format?.y_min ?? 'auto', spec.axis_format?.y_max ?? 'auto']
            : undefined}
          label={spec.axis_format?.axis_title ? { value: spec.axis_format.axis_title, angle: -90, position: 'insideLeft' } : undefined}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} decimalPlaces={decimalPlaces} />} />
        {spec.referenceValue != null && (
          <ReferenceLine y={spec.referenceValue} stroke="var(--color-yellow)" strokeDasharray="4 4" label={{ value: 'Target', fill: 'var(--color-yellow)', fontSize: 10 }} />
        )}
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-accent)"
          strokeWidth={2}
          dot={{ fill: 'var(--color-accent)', r: 3 }}
          activeDot={{ r: 5 }}
        >
          {dataLabelsEnabled && (
            <LabelList
              dataKey="value"
              position={dataLabelsPosition as any}
              formatter={(v: number) => formatValue(v, dataLabelsFmt, dataLabelsDP)}
              style={{ fontSize: 10, fill: 'var(--color-text)' }}
            />
          )}
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

function StackedBarChartRenderer({ spec, height, multiData }: { spec: ChartSpec; height: number; multiData?: MultiSeriesData }) {
  const yFmt = spec.axis_format?.number_format || spec.yAxis?.format || 'currency';
  const decimalPlaces = spec.axis_format?.decimal_places;
  const dataLabelsEnabled = spec.data_labels?.enabled ?? false;
  const dataLabelsPosition = spec.data_labels?.position || 'outside_end';
  const dataLabelsFmt = spec.data_labels?.number_format || yFmt;
  const dataLabelsDP = spec.data_labels?.decimal_places ?? decimalPlaces;

  // Multi-series format (from Live Query with series_field)
  if (multiData) {
    const chartData = toStackedFormat(multiData);
    const seriesNames = multiData.series.map(s => String(s.name));

    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatValue(v, yFmt, decimalPlaces)}
            tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
            axisLine={false}
            tickLine={false}
            width={55}
            domain={spec.axis_format?.y_min != null || spec.axis_format?.y_max != null
              ? [spec.axis_format?.y_min ?? 'auto', spec.axis_format?.y_max ?? 'auto']
              : undefined}
            label={spec.axis_format?.axis_title ? { value: spec.axis_format.axis_title, angle: -90, position: 'insideLeft' } : undefined}
          />
          <Tooltip content={<BarTooltip yFormat={yFmt} decimalPlaces={decimalPlaces} />} />
          {spec.legend?.enabled !== false && (
            <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign={spec.legend?.position === 'top' ? 'top' : spec.legend?.position === 'bottom' ? 'bottom' : undefined} />
          )}
          {seriesNames.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              stackId="a"
              fill={getSeriesColor(name, i, spec.color_mode, spec.colorMap)}
              radius={i === seriesNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            >
              {dataLabelsEnabled && (
                <LabelList
                  dataKey={name}
                  position={dataLabelsPosition as any}
                  formatter={(v: number) => formatValue(v, dataLabelsFmt, dataLabelsDP)}
                  style={{ fontSize: 10, fill: 'var(--color-text)' }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Legacy segment-based format (backward compatible)
  const segments = Array.from(new Set(spec.data.map(d => d.segment).filter(Boolean))) as string[];
  const groupedByLabel = spec.data.reduce((acc, d) => {
    if (!acc[d.label]) acc[d.label] = { label: d.label };
    if (d.segment) acc[d.label][d.segment] = d.value;
    return acc;
  }, {} as Record<string, any>);
  const groupedData = Object.values(groupedByLabel);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={groupedData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatValue(v, yFmt, decimalPlaces)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} decimalPlaces={decimalPlaces} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {segments.length > 0 ? segments.map((seg, i) => (
          <Bar key={seg} dataKey={seg} stackId="a" fill={spec.colorMap?.[seg] || CHART_COLORS[i % CHART_COLORS.length]} radius={i === segments.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        )) : (
          <Bar dataKey="value" stackId="a" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function WaterfallChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'currency';
  let running = 0;
  const waterfallData = spec.data.map((d) => {
    const base = running;
    const val = d.value;
    running += val;
    return {
      label: d.label,
      base: val >= 0 ? base : base + val,
      value: Math.abs(val),
      isNegative: val < 0,
      rawValue: val,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={waterfallData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip
          content={({ active, payload, label }: any) => {
            if (!active || !payload?.length) return null;
            const d = waterfallData.find(x => x.label === label);
            return (
              <div style={{ background: 'var(--color-surfaceRaised)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--color-text)' }}>
                <div style={{ fontWeight: 600 }}>{label}</div>
                <div style={{ color: d?.isNegative ? 'var(--color-coral)' : 'var(--color-accent)' }}>
                  {d && d.rawValue >= 0 ? '+' : ''}{formatValue(d?.rawValue ?? 0, yFmt)}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="base" fill="transparent" stackId="waterfall" />
        <Bar dataKey="value" stackId="waterfall" radius={[3, 3, 0, 0]}>
          {waterfallData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.isNegative ? 'var(--color-coral)' : 'var(--color-accent)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DonutChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'number';
  const innerR = Math.round(height * 0.28);
  const outerR = Math.round(height * 0.42);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={spec.data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={innerR}
          outerRadius={outerR}
        >
          {spec.data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                spec.colorMap?.[entry.label] ||
                spec.colorMap?.[entry.segment ?? ''] ||
                (entry.segment === 'positive' || entry.segment === 'good' || entry.segment === 'won'
                  ? 'var(--color-accent)'
                  : entry.segment === 'negative' || entry.segment === 'risk' || entry.segment === 'lost'
                  ? 'var(--color-coral)'
                  : CHART_COLORS[index % CHART_COLORS.length])
              }
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [formatValue(value, yFmt), name]}
          contentStyle={{ background: 'var(--color-surfaceRaised)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function FunnelChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'number';
  const sorted = spec.data; // Natural order preserved

  // Calculate conversion rates
  const withConversion = sorted.map((d, i) => ({
    ...d,
    conversionPct: i < sorted.length - 1 ? (sorted[i + 1].value / d.value) * 100 : 100,
  }));

  return (
    <div style={{ width: '100%', height }}>
      {withConversion.map((entry, index) => {
        const barWidth = `${(entry.conversionPct / 100) * 90 + 10}%`; // 10-100% width
        const bgColor = index === 0 ? '#14B8A6' : `rgba(20, 184, 166, ${0.9 - index * 0.15})`;
        return (
          <div key={index} style={{ marginBottom: 6 }}>
            <div
              style={{
                width: barWidth,
                background: bgColor,
                padding: '8px 12px',
                borderRadius: 4,
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                justifyContent: 'space-between',
                margin: '0 auto',
              }}
            >
              <span>{entry.label}</span>
              <span>
                {formatValue(entry.value, yFmt)}
                {index < sorted.length - 1 && ` (${entry.conversionPct.toFixed(0)}%)`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BulletChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'number';
  const target = spec.targetValue || spec.referenceValue || 0;

  return (
    <div style={{ width: '100%', height, padding: '8px 0' }}>
      {spec.data.map((entry, index) => {
        const barColor = entry.value >= target ? '#14B8A6' : '#F97316';
        const maxVal = Math.max(target, entry.value, ...(spec.bands?.map(b => b.to) || []));

        return (
          <div key={index} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>
              {entry.label}
            </div>
            <div style={{ position: 'relative', height: 28, background: '#F1F5F9', borderRadius: 4 }}>
              {/* Bands */}
              {spec.bands?.map((band, bi) => (
                <div
                  key={bi}
                  style={{
                    position: 'absolute',
                    left: `${(band.from / maxVal) * 100}%`,
                    width: `${((band.to - band.from) / maxVal) * 100}%`,
                    height: '100%',
                    background: band.color,
                    borderRadius: bi === 0 ? '4px 0 0 4px' : bi === (spec.bands?.length || 0) - 1 ? '0 4px 4px 0' : 0,
                  }}
                />
              ))}
              {/* Actual bar */}
              <div
                style={{
                  position: 'absolute',
                  width: `${(entry.value / maxVal) * 100}%`,
                  height: '60%',
                  top: '20%',
                  background: barColor,
                  borderRadius: '0 3px 3px 0',
                }}
              />
              {/* Target marker */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(target / maxVal) * 100}%`,
                  height: '100%',
                  width: 2,
                  background: '#374151',
                }}
              />
              {/* Value label */}
              <div
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                {formatValue(entry.value, yFmt)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HeatmapRenderer({ spec, height, compact }: { spec: ChartSpec; height: number; compact: boolean }) {
  const rows = Array.from(new Set(spec.data.map(d => d.row).filter(Boolean))) as string[];
  const cols = Array.from(new Set(spec.data.map(d => d.col).filter(Boolean))) as string[];

  const values = spec.data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const getColor = (value: number) => {
    const ratio = (value - minVal) / (maxVal - minVal || 1);
    // 5-stop teal gradient: #e6f7f5 (lightest) → #0d6b61 (darkest)
    const colors = ['#e6f7f5', '#99d9d0', '#4db8a8', '#14B8A6', '#0d6b61'];
    const idx = Math.min(Math.floor(ratio * colors.length), colors.length - 1);
    return colors[idx];
  };

  const cellSize = Math.min(60, (height - 40) / rows.length);

  return (
    <div style={{ width: '100%', height, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ fontSize: 10, color: 'var(--color-textMuted)', padding: 4 }}></th>
            {cols.map(col => (
              <th key={col} style={{ fontSize: 10, color: 'var(--color-textMuted)', padding: 4, textAlign: 'center' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row}>
              <td style={{ fontSize: 10, color: 'var(--color-textMuted)', padding: 4, fontWeight: 600 }}>
                {row}
              </td>
              {cols.map(col => {
                const point = spec.data.find(d => d.row === row && d.col === col);
                const value = point?.value || 0;
                return (
                  <td
                    key={col}
                    style={{
                      background: point ? getColor(value) : '#F1F5F9',
                      textAlign: 'center',
                      padding: 8,
                      fontSize: compact ? 9 : 11,
                      fontWeight: 600,
                      color: point && value > (maxVal - minVal) * 0.5 + minVal ? 'white' : '#374151',
                      minWidth: cellSize,
                      height: cellSize,
                    }}
                  >
                    {point && !compact ? formatValue(value, spec.yAxis?.format || 'number') : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComboChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'currency';
  const hasSecondary = spec.data.some(d => d.secondaryValue != null);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={spec.data} margin={{ top: 8, right: hasSecondary ? 40 : 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        {hasSecondary && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(v) => formatValue(v, yFmt)}
            tick={{ fontSize: 11, fill: '#F97316' }}
            axisLine={false}
            tickLine={false}
            width={55}
            label={{ value: spec.comboSeriesLabel || 'Secondary', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#F97316' } }}
          />
        )}
        <Tooltip content={<BarTooltip yFormat={yFmt} />} />
        <Bar yAxisId="left" dataKey="value" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
        {hasSecondary && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="secondaryValue"
            stroke="#F97316"
            strokeWidth={2}
            dot={{ fill: '#F97316', r: 3 }}
            activeDot={{ r: 5 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ScatterChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'number';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          type="number"
          dataKey="x"
          name="x"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="value"
          name="y"
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <div style={{ background: 'var(--color-surfaceRaised)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.label}</div>
                <div>x: {p.x}</div>
                <div>y: {formatValue(p.value, yFmt)}</div>
              </div>
            );
          }}
        />
        <Scatter
          name="Points"
          data={spec.data}
          fill="var(--color-accent)"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

interface ChartRendererPropsExtended extends ChartRendererProps {
  chartData?: MultiSeriesData;  // Multi-series format from Live Query
}

export default function ChartRenderer({ spec, compact = false, chartData }: ChartRendererPropsExtended) {
  const fullHeight = 220;
  const height = compact ? Math.round(fullHeight * 0.7) : fullHeight;
  const sortedSpec = { ...spec, data: sortData(spec.data, spec.sort) };

  // Outlier mode implemented in BarChartRenderer.
  // When spec.outlier_mode?.enabled === true, bars exceeding threshold_multiple × median
  // are capped and rendered with a wavy break indicator and true value label.

  const renderChart = () => {
    switch (spec.chartType) {
      case 'bar':
        return <BarChartRenderer spec={sortedSpec} height={height} compact={compact} />;
      case 'horizontal_bar':
        return <HorizontalBarChartRenderer spec={sortedSpec} height={Math.max(height, sortedSpec.data.length * 32 + 20)} />;
      case 'line':
        return <LineChartRenderer spec={sortedSpec} height={height} />;
      case 'stacked_bar':
        return <StackedBarChartRenderer spec={sortedSpec} height={height} multiData={chartData} />;
      case 'waterfall':
        return <WaterfallChartRenderer spec={sortedSpec} height={height} />;
      case 'donut':
        return <DonutChartRenderer spec={sortedSpec} height={height} />;
      case 'funnel':
        return <FunnelChartRenderer spec={sortedSpec} height={height} />;
      case 'bullet':
        return <BulletChartRenderer spec={sortedSpec} height={Math.max(height, sortedSpec.data.length * 52 + 20)} />;
      case 'heatmap':
        return <HeatmapRenderer spec={sortedSpec} height={height} compact={compact} />;
      case 'combo':
        return <ComboChartRenderer spec={sortedSpec} height={height} />;
      case 'scatter':
        return <ScatterChartRenderer spec={sortedSpec} height={height} />;
      default:
        console.warn(`[ChartRenderer] Unknown chart type: ${spec.chartType}`);
        return null;
    }
  };

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{spec.title}</div>
        {!compact && spec.subtitle && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{spec.subtitle}</div>
        )}
      </div>
      {renderChart()}
      {spec.annotation && (
        <div style={{
          fontSize: 13,
          color: colors.textSecondary,
          fontStyle: 'italic',
          marginTop: 8,
          lineHeight: 1.5,
        }}>
          {spec.annotation}
        </div>
      )}
    </div>
  );
}

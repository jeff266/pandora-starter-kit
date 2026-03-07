import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { colors } from '../../styles/theme';
import type { ChartSpec, ChartDataPoint } from '../../types/chart-types';

interface ChartRendererProps {
  spec: ChartSpec;
  compact?: boolean;
}

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}

function formatValue(val: number, fmt?: 'currency' | 'number' | 'percent'): string {
  if (fmt === 'currency') return formatCurrency(val);
  if (fmt === 'percent') return `${val.toFixed(1)}%`;
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

function BarTooltip({ active, payload, label, yFormat }: any) {
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
          {formatValue(p.value, yFormat)}
        </div>
      ))}
    </div>
  );
}

function BarChartRenderer({ spec, height, compact }: { spec: ChartSpec; height: number; compact: boolean }) {
  const yFmt = spec.yAxis?.format || 'currency';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
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
        <Tooltip content={<BarTooltip yFormat={yFmt} />} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {spec.data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={getSegmentColor(entry.segment, spec.colorMap)}
            />
          ))}
        </Bar>
        {spec.referenceValue != null && (
          <ReferenceLine y={spec.referenceValue} stroke="var(--color-yellow)" strokeDasharray="4 4" />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function HorizontalBarChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'currency';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={spec.data} margin={{ top: 4, right: 60, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} />} />
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
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'currency';
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
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} />} />
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
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function StackedBarChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const yFmt = spec.yAxis?.format || 'currency';
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
          tickFormatter={(v) => formatValue(v, yFmt)}
          tick={{ fontSize: 11, fill: 'var(--color-textMuted)' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip content={<BarTooltip yFormat={yFmt} />} />
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
              fill={getSegmentColor(entry.segment, spec.colorMap) || CHART_COLORS[index % CHART_COLORS.length]}
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

export default function ChartRenderer({ spec, compact = false }: ChartRendererProps) {
  const fullHeight = 220;
  const height = compact ? Math.round(fullHeight * 0.7) : fullHeight;

  const renderChart = () => {
    switch (spec.chartType) {
      case 'bar':
        return <BarChartRenderer spec={spec} height={height} compact={compact} />;
      case 'horizontal_bar':
        return <HorizontalBarChartRenderer spec={spec} height={Math.max(height, spec.data.length * 32 + 20)} />;
      case 'line':
        return <LineChartRenderer spec={spec} height={height} />;
      case 'stacked_bar':
        return <StackedBarChartRenderer spec={spec} height={height} />;
      case 'waterfall':
        return <WaterfallChartRenderer spec={spec} height={height} />;
      case 'donut':
        return <DonutChartRenderer spec={spec} height={height} />;
      default:
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

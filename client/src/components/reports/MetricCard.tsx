import React from 'react';
import type { MetricCard as MetricCardType } from './types';

interface MetricCardProps {
  metric: MetricCardType;
}

export default function MetricCard({ metric }: MetricCardProps) {
  const severityColors = {
    critical: 'border-red-200 bg-red-50',
    warning: 'border-amber-200 bg-amber-50',
    good: 'border-green-200 bg-green-50',
  };

  const severityAccents = {
    critical: 'border-l-red-500',
    warning: 'border-l-amber-500',
    good: 'border-l-green-500',
  };

  const bgClass = metric.severity ? severityColors[metric.severity] : 'border-slate-200 bg-slate-50';
  const accentClass = metric.severity ? severityAccents[metric.severity] : 'border-l-slate-400';

  return (
    <div className={`border ${bgClass} ${accentClass} border-l-4 rounded-lg p-4`}>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{metric.label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{metric.value}</span>
        {metric.delta && (
          <span className="text-sm text-slate-600">
            {metric.delta_direction === 'up' ? '▲' : metric.delta_direction === 'down' ? '▼' : '—'} {metric.delta}
          </span>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import type { DealCard as DealCardType } from './types';

interface DealCardProps {
  deal: DealCardType;
  anonymizeMode?: boolean;
}

export default function DealCard({ deal, anonymizeMode = false }: DealCardProps) {
  const severityColors = {
    critical: 'border-red-500 bg-red-50',
    warning: 'border-amber-500 bg-amber-50',
    info: 'border-blue-500 bg-blue-50',
  };

  const displayName = anonymizeMode ? `Company ${deal.name.charAt(0)}` : deal.name;
  const displayOwner = anonymizeMode ? `Rep ${deal.owner.charAt(0)}` : deal.owner;

  return (
    <div className={`border-l-4 ${severityColors[deal.signal_severity]} bg-white rounded-lg p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold text-slate-900">{displayName}</h4>
          <div className="text-sm text-slate-600 mt-1">
            {displayOwner} • {deal.stage} • {deal.signal}
          </div>
        </div>
        <div className="text-lg font-bold text-slate-900">{deal.amount}</div>
      </div>
      {deal.action && (
        <div className="mt-3 text-sm text-blue-700 font-medium">→ {deal.action}</div>
      )}
    </div>
  );
}

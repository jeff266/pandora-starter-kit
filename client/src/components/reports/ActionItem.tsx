import React from 'react';
import type { ActionItem as ActionItemType } from './types';

interface ActionItemProps {
  action: ActionItemType;
  index?: number;
}

export default function ActionItem({ action }: ActionItemProps) {
  const urgencyColors = {
    today: 'text-red-600',
    this_week: 'text-amber-600',
    this_month: 'text-green-600',
  };

  const urgencyLabels = {
    today: 'TODAY',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
      <input type="checkbox" className="mt-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${urgencyColors[action.urgency]}`}>
            {urgencyLabels[action.urgency]}
          </span>
          <span className="text-sm text-slate-900">{action.action}</span>
        </div>
        {action.owner && (
          <div className="text-xs text-slate-500 mt-1">Owned by: {action.owner}</div>
        )}
      </div>
    </div>
  );
}

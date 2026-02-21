import React from 'react';

interface DegradedSectionProps {
  sectionId: string;
  sourceSkills: string[];
  showActions?: boolean;
  onRemove?: () => void;
}

export default function DegradedSection({
  sectionId,
  sourceSkills,
  showActions = false,
  onRemove,
}: DegradedSectionProps) {
  // Map missing skills to connector recommendations
  const connectorHints: Record<string, { name: string; icon: string }> = {
    'conversation-intelligence': { name: 'Gong or Fireflies', icon: '🎙️' },
    'monte-carlo-forecast': { name: 'more deal history', icon: '📊' },
    'stage-velocity-benchmarks': { name: 'deal stage history', icon: '⏱️' },
  };

  const missingConnector = sourceSkills
    .map((s) => connectorHints[s])
    .filter(Boolean)[0];

  return (
    <div className="border border-slate-200 rounded-lg p-8 text-center bg-slate-50">
      <div className="text-4xl mb-4">ℹ️</div>
      <p className="text-slate-700 mb-2">
        {missingConnector
          ? `Connect ${missingConnector.name} to enable this section`
          : `No data available yet. Run the required skills first.`}
      </p>
      <p className="text-sm text-slate-500 mb-4">
        Requires: {sourceSkills.join(', ')}
      </p>
      {showActions && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={onRemove}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium"
          >
            Remove Section
          </button>
          <button className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm font-medium">
            Keep Anyway
          </button>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import type { SectionContent } from './types';
import MetricCard from './MetricCard';
import DealCard from './DealCard';
import ActionItem from './ActionItem';
import DataTable from './DataTable';
import DegradedSection from './DegradedSection';

interface ReportContentProps {
  sections: SectionContent[];
  showSourceSkills?: boolean;
  showDegradedActions?: boolean;
  anonymizeMode?: boolean;
  onRemoveSection?: (sectionId: string) => void;
}

export default function ReportContent({
  sections,
  showSourceSkills = false,
  showDegradedActions = false,
  anonymizeMode = false,
  onRemoveSection,
}: ReportContentProps) {
  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const hasContent =
          (section.metrics && section.metrics.length > 0) ||
          (section.deal_cards && section.deal_cards.length > 0) ||
          (section.table && section.table.rows.length > 0) ||
          (section.action_items && section.action_items.length > 0) ||
          section.narrative;

        return (
          <div key={section.section_id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            {/* Section Header */}
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">{section.title}</h2>
            </div>

            {/* Section Content */}
            <div className="px-6 py-6 space-y-6">
              {!hasContent ? (
                <DegradedSection
                  sectionId={section.section_id}
                  sourceSkills={section.source_skills}
                  showActions={showDegradedActions}
                  onRemove={() => onRemoveSection?.(section.section_id)}
                />
              ) : (
                <>
                  {/* Metrics */}
                  {section.metrics && section.metrics.length > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {section.metrics.map((metric, idx) => (
                        <MetricCard key={idx} metric={metric} />
                      ))}
                    </div>
                  )}

                  {/* Narrative */}
                  {section.narrative && (
                    <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed">
                      {section.narrative.split('\n\n').map((para, idx) => (
                        <p key={idx}>{para}</p>
                      ))}
                    </div>
                  )}

                  {/* Deal Cards */}
                  {section.deal_cards && section.deal_cards.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Deals</h3>
                      {section.deal_cards.map((deal, idx) => (
                        <DealCard key={idx} deal={deal} anonymizeMode={anonymizeMode} />
                      ))}
                    </div>
                  )}

                  {/* Table */}
                  {section.table && section.table.rows.length > 0 && (
                    <DataTable headers={section.table.headers} rows={section.table.rows} />
                  )}

                  {/* Action Items */}
                  {section.action_items && section.action_items.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Action Items</h3>
                      {section.action_items.map((action, idx) => (
                        <ActionItem key={idx} action={action} index={idx} />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Source Skills Footer */}
              {showSourceSkills && hasContent && (
                <div className="text-xs text-slate-500 pt-4 border-t border-slate-100">
                  Source: {section.source_skills.join(', ')} • Data as of{' '}
                  {new Date(section.data_freshness).toLocaleString('en-US')} • Confidence:{' '}
                  {Math.round(section.confidence * 100)}%
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

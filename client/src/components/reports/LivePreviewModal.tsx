import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import ReportContent from './ReportContent';
import type { SectionContent } from './types';

interface GenerationResponse {
  id: string;
  sections_content: SectionContent[];
  formats_generated: Record<string, { download_url: string; size_bytes: number }>;
  generation_duration_ms: number;
  skills_used?: number;
  total_tokens?: number;
  cost_estimate?: {
    tokens_per_generation: number;
    cost_per_generation: number;
    monthly_cost_at_cadence: number;
    cadence_label: string;
  };
}

interface LivePreviewModalProps {
  reportId: string;
  workspaceId: string;
  reportName: string;
  onClose: () => void;
  onRemoveSection: (sectionId: string) => void;
  onActivate: () => void;
}

export default function LivePreviewModal({
  reportId,
  workspaceId,
  reportName,
  onClose,
  onRemoveSection,
  onActivate,
}: LivePreviewModalProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [previewData, setPreviewData] = useState<GenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    generatePreview();
  }, []);

  async function generatePreview() {
    setState('loading');
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/reports/${reportId}/generate?preview=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreviewData(data);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  async function downloadFormat(format: string) {
    if (!previewData) return;
    const fileInfo = previewData.formats_generated[format];
    if (fileInfo?.download_url) {
      window.location.href = fileInfo.download_url;
    }
  }

  // Count sections with actual data vs degraded
  const sectionsWithData =
    previewData?.sections_content?.filter(
      (s) => s.narrative || s.metrics?.length || s.deal_cards?.length || s.table || s.action_items?.length
    ).length || 0;
  const totalSections = previewData?.sections_content?.length || 0;
  const degradedSections = totalSections - sectionsWithData;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full h-full max-w-7xl max-h-screen bg-white flex flex-col m-4 rounded-lg shadow-2xl">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Preview: {reportName}</h2>
              <span className="text-sm text-slate-500">
                Using live data from workspace
                {state === 'ready' && ` · Generated just now · ${previewData?.generation_duration_ms}ms`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {state === 'ready' &&
                previewData &&
                Object.keys(previewData.formats_generated).map((format) => (
                  <button
                    key={format}
                    onClick={() => downloadFormat(format)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {format.toUpperCase()}
                  </button>
                ))}
              <button
                onClick={onClose}
                className="px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg flex items-center gap-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div className="max-w-5xl mx-auto">
            {state === 'loading' && <PreviewLoadingState />}
            {state === 'error' && <PreviewErrorState error={error} onRetry={generatePreview} />}
            {state === 'ready' && previewData && (
              <ReportContent
                sections={previewData.sections_content}
                showSourceSkills={true}
                showDegradedActions={true}
                onRemoveSection={onRemoveSection}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        {state === 'ready' && (
          <div className="bg-white border-t border-slate-200 px-6 py-4 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 text-sm text-slate-600">
                <span>
                  {totalSections} sections · {sectionsWithData} with data
                  {degradedSections > 0 && ` · ${degradedSections} degraded`}
                </span>
                {previewData?.cost_estimate && (
                  <span>
                    Est. cost per generation: ~${previewData.cost_estimate.cost_per_generation.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium"
                >
                  Back to Editor
                </button>
                <button
                  onClick={onActivate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                >
                  Save & Activate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewLoadingState() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const steps = [0, 1, 2];
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % steps.length;
      setCurrentStep(steps[index]);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const steps = [
    { label: 'Loading skill evidence', delay: 0 },
    { label: 'Building sections', delay: 500 },
    { label: 'Rendering report', delay: 1000 },
  ];

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating preview...</h3>
        <p className="text-sm text-slate-600 mb-6">Pulling latest data from your connected sources</p>

        <div className="space-y-2">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className={`text-sm ${
                idx <= currentStep ? 'text-blue-600 font-medium' : 'text-slate-400'
              }`}
            >
              {idx <= currentStep ? '✓' : '○'} {step.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">⚠️</div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Preview generation failed</h3>
        <p className="text-sm text-slate-600 mb-6">{error || 'Unknown error occurred'}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

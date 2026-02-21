import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import ReportContent from './ReportContent';
import { colors, fonts } from '../../styles/theme';
import type { SectionContent } from './types';
import { api } from '../../lib/api';

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
      const data = await api.post(`/reports/${reportId}/generate?preview=true`);
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
    if (!fileInfo?.download_url) return;

    try {
      // Use authenticated fetch to download the file
      const token = localStorage.getItem('pandora_token');
      const response = await fetch(fileInfo.download_url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      // Convert response to blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportName}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
      alert(`Failed to download ${format.toUpperCase()} file`);
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
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.7)'
    }}>
      <div style={{
        width: '100%',
        height: '100%',
        maxWidth: 1280,
        maxHeight: '100vh',
        background: colors.surface,
        display: 'flex',
        flexDirection: 'column',
        margin: 16,
        borderRadius: 8,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        {/* Header */}
        <div style={{
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
          padding: '16px 24px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: 0, fontFamily: fonts.sans }}>Preview: {reportName}</h2>
              <span style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
                Using live data from workspace
                {state === 'ready' && ` · Generated just now · ${previewData?.generation_duration_ms}ms`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {state === 'ready' &&
                previewData &&
                Object.keys(previewData.formats_generated).map((format) => (
                  <button
                    key={format}
                    onClick={() => downloadFormat(format)}
                    style={{
                      padding: '8px 12px',
                      background: colors.surfaceRaised,
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 500,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontFamily: fonts.sans,
                    }}
                  >
                    <Download style={{ width: 16, height: 16 }} />
                    {format.toUpperCase()}
                  </button>
                ))}
              <button
                onClick={onClose}
                style={{
                  padding: '8px 12px',
                  color: colors.text,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <X style={{ width: 20, height: 20 }} />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: colors.bg }}>
          <div style={{ maxWidth: 1024, margin: '0 auto' }}>
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
          <div style={{
            background: colors.surface,
            borderTop: `1px solid ${colors.border}`,
            padding: '16px 24px',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 14, color: colors.textSecondary, fontFamily: fonts.sans }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: '8px 16px',
                    background: colors.surfaceRaised,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    cursor: 'pointer',
                  }}
                >
                  Back to Editor
                </button>
                <button
                  onClick={onActivate}
                  style={{
                    padding: '8px 16px',
                    background: colors.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    cursor: 'pointer',
                  }}
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 64,
          height: 64,
          border: `4px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>Generating preview...</h3>
        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, fontFamily: fonts.sans }}>Pulling latest data from your connected sources</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((step, idx) => (
            <div
              key={idx}
              style={{
                fontSize: 14,
                color: idx <= currentStep ? colors.accent : colors.textMuted,
                fontWeight: idx <= currentStep ? 500 : 400,
                fontFamily: fonts.sans,
              }}
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <div style={{ textAlign: 'center', maxWidth: 448 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8, fontFamily: fonts.sans }}>Preview generation failed</h3>
        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, fontFamily: fonts.sans }}>{error || 'Unknown error occurred'}</p>
        <button
          onClick={onRetry}
          style={{
            padding: '8px 16px',
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 500,
            fontFamily: fonts.sans,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

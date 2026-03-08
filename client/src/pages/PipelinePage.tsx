import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import SankeyChart from '../components/reports/SankeyChart';
import WinningPathsChart from '../components/pipeline/WinningPathsChart';
import type { SankeyChartData, WinningPathsData } from '../components/reports/types';

export default function PipelinePage() {
  const [sankeyData, setSankeyData] = useState<SankeyChartData | null>(null);
  const [sankeyLoading, setSankeyLoading] = useState(true);
  const [sankeyError, setSankeyError] = useState<string | null>(null);

  const [pathsData, setPathsData] = useState<WinningPathsData | null>(null);
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathsError, setPathsError] = useState<string | null>(null);

  useEffect(() => {
    setSankeyLoading(true);
    api.get('/analysis/sankey')
      .then((data: SankeyChartData) => {
        setSankeyData(data);
        setSankeyError(null);
      })
      .catch((err: Error) => {
        setSankeyError(err.message || 'Failed to load funnel data');
      })
      .finally(() => setSankeyLoading(false));

    setPathsLoading(true);
    api.get('/analysis/winning-paths')
      .then((data: WinningPathsData) => {
        setPathsData(data);
        setPathsError(null);
      })
      .catch((err: Error) => {
        setPathsError(err.message || 'Failed to load winning paths');
      })
      .finally(() => setPathsLoading(false));
  }, []);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          color: colors.text,
          fontFamily: fonts.sans,
          margin: 0,
          lineHeight: 1.2,
        }}>
          Pipeline
        </h1>
        <p style={{
          fontSize: 13,
          color: colors.textMuted,
          margin: '4px 0 0',
          fontFamily: fonts.sans,
        }}>
          Funnel health and winning patterns
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionErrorBoundary fallbackMessage="Unable to load pipeline funnel.">
          <div>
            <h2 style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.textMuted,
              fontFamily: fonts.sans,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 10px',
            }}>
              Pipeline Funnel
            </h2>
            {sankeyError ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                {sankeyError}
              </div>
            ) : sankeyLoading && !sankeyData ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                Loading funnel data…
              </div>
            ) : sankeyData ? (
              <SankeyChart chartData={sankeyData} />
            ) : null}
          </div>
        </SectionErrorBoundary>

        <SectionErrorBoundary fallbackMessage="Unable to load winning paths.">
          <div>
            <h2 style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.textMuted,
              fontFamily: fonts.sans,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 10px',
            }}>
              Winning Paths
            </h2>
            {pathsError ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                {pathsError}
              </div>
            ) : pathsLoading && !pathsData ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                Loading winning paths…
              </div>
            ) : (
              <WinningPathsChart
                data={pathsData}
                onDataChange={setPathsData}
              />
            )}
          </div>
        </SectionErrorBoundary>
      </div>
    </div>
  );
}

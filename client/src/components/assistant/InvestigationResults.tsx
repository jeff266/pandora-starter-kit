import React from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';

interface InvestigationResultsProps {
  skillId: string;
  runId: string;
  onClose: () => void;
}

export default function InvestigationResults({
  skillId,
  runId,
  onClose,
}: InvestigationResultsProps) {
  const { workspace } = useWorkspace();
  const [results, setResults] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function fetchResults() {
      try {
        const response = await fetch(
          `/api/workspaces/${workspace?.id}/investigation/results/${runId}`
        );
        const data = await response.json();
        setResults(data);
      } catch (err) {
        console.error('Failed to fetch results:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, [runId, workspace?.id]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}>
        <div style={{
          background: colors.surface,
          padding: 40,
          borderRadius: 12,
          fontSize: 16,
          color: colors.text,
        }}>
          Loading investigation results...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          maxWidth: 800,
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <h2 style={{
            fontFamily: fonts.sans,
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.3,
            margin: 0,
            color: colors.text,
          }}>
            Investigation Results
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: colors.textMuted,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Summary */}
        <div style={{
          padding: 16,
          background: colors.surfaceRaised,
          borderRadius: 8,
          marginBottom: 20,
        }}>
          <p style={{
            fontFamily: fonts.sans,
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.5,
            margin: 0,
            color: colors.text,
          }}>
            {results?.summary || 'Investigation completed'}
          </p>
        </div>

        {/* Narrative */}
        {results?.narrative && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.4,
              margin: '0 0 12px 0',
              color: colors.text,
            }}>
              Analysis
            </h3>
            <p style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              fontWeight: 400,
              lineHeight: 1.6,
              margin: 0,
              color: colors.textSecondary,
              whiteSpace: 'pre-wrap',
            }}>
              {results.narrative}
            </p>
          </div>
        )}

        {/* Evidence/Findings */}
        {results?.findings && results.findings.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.4,
              margin: '0 0 12px 0',
              color: colors.text,
            }}>
              Key Findings ({results.findings.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.findings.slice(0, 10).map((finding: any, index: number) => (
                <div
                  key={index}
                  style={{
                    padding: 12,
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                  }}
                >
                  <div style={{
                    fontFamily: fonts.sans,
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.5,
                    color: colors.text,
                  }}>
                    {finding.entity_name || finding.message}
                  </div>
                  {finding.severity && (
                    <span style={{
                      fontSize: 11,
                      color: finding.severity === 'critical' ? colors.red : colors.yellow,
                      marginTop: 4,
                      display: 'block',
                    }}>
                      {finding.severity.toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div style={{
          paddingTop: 16,
          borderTop: `1px solid ${colors.border}`,
          fontSize: 12,
          color: colors.textMuted,
        }}>
          Completed in {Math.round((results?.durationMs || 0) / 1000)}s
          {results?.tokenUsage?.total && ` · ${results.tokenUsage.total.toLocaleString()} tokens used`}
        </div>
      </div>
    </div>
  );
}

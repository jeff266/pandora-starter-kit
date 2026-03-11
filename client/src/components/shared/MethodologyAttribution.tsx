/**
 * Methodology Attribution Component
 *
 * Displays methodology configuration info for skill runs with audit trail.
 * Shows which methodology framework and version was used when a skill ran.
 */

import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';

interface MethodologyAttributionProps {
  methodologyConfigId: string | null;
  contextSnapshot: {
    base_methodology: string;
    scope: string;
    version: number;
    display_name?: string;
    config_hash?: string;
  } | null;
  runAt: string; // ISO timestamp of the skill run
}

export default function MethodologyAttribution({
  methodologyConfigId,
  contextSnapshot,
  runAt
}: MethodologyAttributionProps) {
  const navigate = useNavigate();

  // Pre-deployment runs (no methodology config stamped)
  if (!methodologyConfigId || !contextSnapshot) {
    return (
      <div style={{
        fontSize: 11,
        color: colors.textMuted,
        fontFamily: fonts.sans,
        marginTop: 8
      }}>
        <span style={{ fontWeight: 600 }}>Methodology:</span>{' '}
        <span>System default (pre-config)</span>
      </div>
    );
  }

  const {
    base_methodology,
    scope,
    version,
    display_name
  } = contextSnapshot;

  const handleViewSnapshot = () => {
    navigate(`/settings/methodology?config=${methodologyConfigId}&version=${version}`);
  };

  const formatScopeLabel = (scopeType: string) => {
    switch (scopeType) {
      case 'workspace':
        return 'Workspace default';
      case 'segment':
        return 'Segment-specific';
      case 'product':
        return 'Product-specific';
      case 'segment_product':
        return 'Segment + Product';
      default:
        return scopeType;
    }
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div style={{
      fontSize: 11,
      color: colors.textMuted,
      fontFamily: fonts.sans,
      marginTop: 12,
      paddingTop: 12,
      borderTop: `1px solid ${colors.border}`
    }}>
      {/* Methodology */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: colors.textSecondary }}>Methodology</span>
        <span style={{ marginLeft: 8 }}>
          {base_methodology.toUpperCase()}
          {display_name && ` — "${display_name}"`}
          {' '}v{version}
        </span>
      </div>

      {/* Scope */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: colors.textSecondary }}>Scope</span>
        <span style={{ marginLeft: 8 }}>{formatScopeLabel(scope)}</span>
      </div>

      {/* Config at run */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: colors.textSecondary }}>Config at run</span>
        <span style={{ marginLeft: 8 }}>{formatTimestamp(runAt)}</span>
      </div>

      {/* View config snapshot link */}
      <div style={{ marginTop: 6 }}>
        <button
          onClick={handleViewSnapshot}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 8px',
            background: 'none',
            color: colors.accent,
            border: `1px solid ${colors.accentGlow}`,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: fonts.sans
          }}
        >
          View config snapshot ↗
        </button>
      </div>
    </div>
  );
}

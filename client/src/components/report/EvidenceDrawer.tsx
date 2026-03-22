import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface EvidenceRecord {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  owner_name: string;
  severity: string;
  fields: {
    deal_name?: string;
    owner?: string;
    stage?: string;
    amount?: number;
    close_date?: string;
    days_since_activity?: number;
  };
  flags: {
    stale_flag?: string;
    close_date_flag?: string;
    suggested_action?: string;
    root_cause?: string;
    severity?: string;
  };
}

interface EvidenceClaim {
  claim_id: string;
  claim_text: string;
  severity: string;
  metric_name?: string;
  threshold_applied?: string;
  entity_count: number;
}

interface EvidenceResponse {
  claim: EvidenceClaim;
  records: EvidenceRecord[];
  total: number;
  truncated: boolean;
}

interface EvidenceDrawerProps {
  workspaceId: string;
  documentId: string;
  sectionId: string;
  claimId: string;
  claimText: string;
  onClose: () => void;
}

function formatAmount(amount?: number): string {
  if (!amount) return '—';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

const SEVERITY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  critical: { border: '#dc2626', bg: '#450a0a', text: '#fca5a5' },
  warning: { border: '#f59e0b', bg: '#422006', text: '#fcd34d' },
  info: { border: '#3b82f6', bg: '#0c1a3a', text: '#93c5fd' },
};

function DealRecordCard({ record, workspaceId }: { record: EvidenceRecord; workspaceId: string }) {
  const navigate = useNavigate();
  const scheme = SEVERITY_COLORS[record.severity] ?? { border: colors.border, bg: (colors as any).surfaceRaised ?? '#1e1e2e', text: colors.text };
  const name = record.entity_name || record.fields.deal_name || 'Unknown Deal';
  const owner = record.owner_name || record.fields.owner || '—';
  const stage = record.fields.stage || '—';
  const amount = formatAmount(record.fields.amount);
  const days = record.fields.days_since_activity;
  const action = record.flags.suggested_action;

  return (
    <div
      style={{
        borderLeft: `4px solid ${scheme.border}`,
        background: scheme.bg,
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#ffffff', fontFamily: fonts.sans, lineHeight: 1.3, flex: 1 }}>
          {name}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#ffffff', fontFamily: fonts.mono ?? fonts.sans, whiteSpace: 'nowrap' }}>
          {amount}
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: fonts.sans, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>{owner}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span
          style={{
            background: 'rgba(255,255,255,0.08)',
            padding: '1px 7px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {stage}
        </span>
        {days !== undefined && days !== null && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ color: scheme.text, fontWeight: 600 }}>{days}d dark</span>
          </>
        )}
      </div>

      {action && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: fonts.sans }}>
          → {action}
        </div>
      )}

      <button
        onClick={() => navigate(`/${workspaceId}/deals/${record.entity_id}`)}
        style={{
          alignSelf: 'flex-start',
          marginTop: 4,
          background: 'none',
          border: `1px solid ${scheme.border}`,
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 600,
          color: scheme.text,
          fontFamily: fonts.sans,
          cursor: 'pointer',
        }}
      >
        View deal →
      </button>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      style={{
        borderLeft: `4px solid ${colors.border}`,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ height: 14, width: '70%', background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
      <div style={{ height: 12, width: '50%', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
      <div style={{ height: 12, width: '30%', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
    </div>
  );
}

export default function EvidenceDrawer({
  workspaceId,
  documentId,
  sectionId,
  claimId,
  claimText,
  onClose,
}: EvidenceDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    api
      .get(`/reports/documents/${documentId}/evidence?section_id=${encodeURIComponent(sectionId)}&claim_id=${encodeURIComponent(claimId)}`)
      .then((res: any) => {
        if (!cancelled) {
          setData(res as EvidenceResponse);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          const msg = err?.message || 'Failed to load evidence';
          setError(msg.includes('404') || msg.includes('not found') ? 'Evidence not available for this section.' : msg);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [documentId, sectionId, claimId]);

  const truncatedClaimText = claimText.length > 60 ? claimText.slice(0, 60) + '…' : claimText;
  const threshold = data?.claim.threshold_applied;
  const total = data?.total ?? 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: (colors as any).surface ?? '#111827',
        borderLeft: `1px solid ${colors.border}`,
        zIndex: 201,
        display: 'flex',
        flexDirection: 'column',
        transform: 'translateX(0)',
        transition: 'transform 200ms ease',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '18px 20px 16px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, lineHeight: 1.35, flex: 1 }}>
            {truncatedClaimText}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              padding: 4,
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Close evidence drawer"
          >
            ✕
          </button>
        </div>
        {!loading && data && (
          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>
            {total} deal{total !== 1 ? 's' : ''}
            {threshold ? ` · ${threshold}` : ''}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && error && (
          <div style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, padding: '24px 0', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {!loading && !error && data && data.records.length === 0 && (
          <div style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, padding: '24px 0', textAlign: 'center', lineHeight: 1.6 }}>
            This metric covers the full pipeline — no individual deals to drill into.
          </div>
        )}

        {!loading && !error && data && data.records.map((rec) => (
          <DealRecordCard key={rec.entity_id} record={rec} workspaceId={workspaceId} />
        ))}

        {!loading && !error && data?.truncated && (
          <div
            style={{
              fontSize: 12,
              color: colors.textSecondary,
              fontFamily: fonts.sans,
              textAlign: 'center',
              padding: '8px 0',
              borderTop: `1px solid ${colors.border}`,
              marginTop: 4,
            }}
          >
            Showing 50 of {data.total} deals
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';

export interface TraceClaimResult {
  claim_id:          string;
  claim_text:        string;
  metric_name:       string;
  metric_values:     any[];
  threshold:         string | null;
  severity:          string;
  skill_id:          string;
  skill_run_id:      string;
  ran_at:            string;
  calibrated:        boolean;
  dimension_key:     string | null;
  dimension_label:   string | null;
  dimension_summary: string | null;
  total_entity_count: number;
  records: Array<{
    id:                  string;
    name:                string;
    amount:              number;
    stage:               string;
    owner_email:         string;
    close_date:          string;
    days_since_activity: number;
  }>;
}

export interface ClaimAttrs {
  claim_id:     string;
  skill_id:     string;
  skill_run_id: string;
  metric_name:  string;
  severity:     string;
}

interface ClaimEvidenceDrawerProps {
  open:          boolean;
  loading:       boolean;
  error:         string | null;
  data:          TraceClaimResult | null;
  onClose:       () => void;
  onChallenge:   (data: TraceClaimResult) => void;
  onRecalibrate: (data: TraceClaimResult) => void;
  workspaceId:   string;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: '#EF4444',
  warning:  '#F59E0B',
  info:     '#14B8A6',
  positive: '#22C55E',
};

function severityDotColor(severity: string): string {
  return SEVERITY_DOT[severity] ?? SEVERITY_DOT.info;
}

function activityDotColor(days: number): string {
  if (days > 45) return '#EF4444';
  if (days > 14) return '#F59E0B';
  return '#14B8A6';
}

function formatAmount(amount: number): string {
  if (!amount) return '—';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

function formatSkillName(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function SkeletonLine({ width, height = 12 }: { width: string; height?: number }) {
  return (
    <div
      style={{
        height,
        width,
        background: 'rgba(255,255,255,0.07)',
        borderRadius: 4,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

function SkeletonSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SkeletonLine width="40%" height={10} />
      <SkeletonLine width="80%" />
      <SkeletonLine width="60%" />
      <SkeletonLine width="70%" />
    </div>
  );
}

export default function ClaimEvidenceDrawer({
  open,
  loading,
  error,
  data,
  onClose,
  onChallenge,
  onRecalibrate,
  workspaceId: _workspaceId,
}: ClaimEvidenceDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const totalValue = data
    ? data.records.reduce((sum, r) => sum + (r.amount ?? 0), 0)
    : 0;

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .pandora-claim { cursor: text; }
        .pandora-claim--hyperlink {
          color: #14B8A6;
          border-bottom: 1px solid rgba(20,184,166,0.4);
          cursor: pointer;
          transition: all 150ms ease;
          border-radius: 2px;
        }
        .pandora-claim--hyperlink:hover {
          color: #0D9488;
          border-bottom-color: #14B8A6;
          background: rgba(20,184,166,0.08);
          padding: 0 2px;
        }
      `}</style>

      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 300,
          }}
        />
      )}

      <div
        ref={drawerRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          background: (colors as any).surface ?? '#111827',
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 301,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              fontFamily: fonts.sans,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ❓ Claim Provenance
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
            aria-label="Close claim drawer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 20px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {error ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignItems: 'center',
                paddingTop: 40,
                textAlign: 'center',
              }}
            >
              <div
                style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}
              >
                Could not load evidence for this claim.
                <br />
                The skill run may have been cleared.
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 13,
                  color: colors.text,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                Close
              </button>
            </div>
          ) : loading ? (
            <>
              <SkeletonSection />
              <SkeletonSection />
              <SkeletonSection />
            </>
          ) : data ? (
            <>
              {/* SOURCE */}
              <section>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: colors.textMuted,
                    fontFamily: fonts.sans,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  Source
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: colors.text,
                    fontFamily: fonts.sans,
                    marginBottom: 6,
                  }}
                >
                  {formatSkillName(data.skill_id)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: colors.textSecondary,
                      fontFamily: fonts.sans,
                    }}
                  >
                    Run: {timeAgo(data.ran_at)}
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: 11 }}>•</span>
                  {data.calibrated ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(20,184,166,0.12)',
                        color: '#14B8A6',
                        border: '1px solid rgba(20,184,166,0.3)',
                        borderRadius: 20,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: fonts.sans,
                      }}
                    >
                      ✓ {data.dimension_label ?? 'Calibrated'}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(245,158,11,0.12)',
                        color: '#F59E0B',
                        border: '1px solid rgba(245,158,11,0.3)',
                        borderRadius: 20,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: fonts.sans,
                      }}
                    >
                      ⚠ Default definition
                    </span>
                  )}
                </div>
              </section>

              {/* CLAIM */}
              <section>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: colors.textMuted,
                    fontFamily: fonts.sans,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  Claim
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: severityDotColor(data.severity),
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 13,
                      color: colors.text,
                      fontFamily: fonts.sans,
                      lineHeight: 1.55,
                    }}
                  >
                    "{data.claim_text}"
                  </div>
                </div>
              </section>

              {/* HOW IT WAS CALCULATED */}
              <section>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: colors.textMuted,
                    fontFamily: fonts.sans,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  How it was calculated
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {[
                    {
                      label: 'Filter',
                      value: data.calibrated
                        ? (data.dimension_summary ?? 'Default pipeline definition')
                        : 'Default pipeline definition',
                    },
                    {
                      label: 'Threshold',
                      value: data.threshold ?? '—',
                    },
                    {
                      label: 'Matched',
                      value: `${data.total_entity_count.toLocaleString()} records`,
                    },
                    {
                      label: 'Value',
                      value: formatAmount(totalValue),
                    },
                  ].map(row => (
                    <div
                      key={row.label}
                      style={{
                        display: 'flex',
                        gap: 8,
                        fontSize: 13,
                        fontFamily: fonts.sans,
                      }}
                    >
                      <span
                        style={{
                          width: 72,
                          flexShrink: 0,
                          color: colors.textSecondary,
                        }}
                      >
                        {row.label}:
                      </span>
                      <span style={{ color: colors.text }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* SAMPLE DEALS */}
              {data.records.length > 0 && (
                <section style={{ paddingBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: colors.textMuted,
                      fontFamily: fonts.sans,
                      textTransform: 'uppercase',
                      marginBottom: 10,
                    }}
                  >
                    Sample Deals ({data.total_entity_count.toLocaleString()} total)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.records.slice(0, 10).map(record => {
                      const dot = activityDotColor(record.days_since_activity ?? 0);
                      const truncName =
                        record.name.length > 24
                          ? record.name.slice(0, 24) + '…'
                          : record.name;
                      return (
                        <div
                          key={record.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            fontFamily: fonts.sans,
                          }}
                        >
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: dot,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{ flex: 1, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {truncName}
                          </span>
                          <span style={{ color: colors.textSecondary, flexShrink: 0 }}>
                            {formatAmount(record.amount)}
                          </span>
                          {record.days_since_activity != null && (
                            <span
                              style={{
                                color: dot,
                                flexShrink: 0,
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {record.days_since_activity}d dark
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {data.total_entity_count > 10 && (
                    <div style={{ marginTop: 10 }}>
                      <a
                        href={`/${_workspaceId}/gtm?filter_claim=${encodeURIComponent(data.claim_id)}`}
                        style={{
                          fontSize: 12,
                          color: '#14B8A6',
                          textDecoration: 'none',
                          fontFamily: fonts.sans,
                        }}
                      >
                        View all {data.total_entity_count} deals →
                      </a>
                    </div>
                  )}
                </section>
              )}
            </>
          ) : null}
        </div>

        {/* Footer — resolution actions */}
        {!error && !loading && data && (
          <div
            style={{
              padding: '16px 20px 20px',
              borderTop: `1px solid ${colors.border}`,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: colors.textSecondary,
                fontFamily: fonts.sans,
              }}
            >
              Something wrong with this number?
            </div>
            <button
              onClick={() => onChallenge(data)}
              style={{
                width: '100%',
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.4)',
                color: '#F59E0B',
                borderRadius: 6,
                padding: '8px 0',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Challenge this →
            </button>
            <button
              onClick={() => onRecalibrate(data)}
              style={{
                background: 'none',
                border: 'none',
                color: '#14B8A6',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                padding: 0,
                textAlign: 'left',
              }}
            >
              Recalibrate filter →
            </button>
          </div>
        )}
      </div>
    </>
  );
}

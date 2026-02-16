import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

interface QuotaStatus {
  hasQuotas: boolean;
  isStale: boolean;
  pendingGoals: boolean;
  pendingCount: number;
  currentPeriod: string | null;
}

export default function QuotaBanner() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [periodsRes, pendingRes] = await Promise.all([
          api.get('/quotas/periods').catch(() => ({ periods: [] })),
          api.get('/quotas/pending-goals').catch(() => ({ pending: false })),
        ]);

        if (cancelled) return;

        const periods = periodsRes.periods || [];
        const now = new Date();
        const currentPeriod = periods.find((p: any) => {
          const start = new Date(p.start_date);
          const end = new Date(p.end_date);
          return now >= start && now <= end;
        });

        let hasQuotas = false;
        if (currentPeriod) {
          const quotaRes = await api.get(`/quotas?period_start=${currentPeriod.start_date}&period_end=${currentPeriod.end_date}`).catch(() => ({ quotas: [] }));
          hasQuotas = (quotaRes.quotas || []).length > 0;
        }

        const isStale = !currentPeriod && periods.length > 0;

        setStatus({
          hasQuotas,
          isStale,
          pendingGoals: pendingRes.pending || false,
          pendingCount: pendingRes.preview?.goals?.length || 0,
          currentPeriod: currentPeriod?.name || null,
        });
      } catch {
        // silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!status || dismissed) return null;
  if (status.hasQuotas && !status.pendingGoals) return null;

  const goSettings = () => navigate('/settings');

  if (status.pendingGoals) {
    return (
      <div style={{
        background: colors.yellowSoft,
        border: `1px solid rgba(234,179,8,0.25)`,
        borderRadius: 8,
        padding: '10px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: fonts.sans,
        fontSize: 13,
      }}>
        <span style={{ color: colors.yellow, fontWeight: 600 }}>New HubSpot Goals</span>
        <span style={{ color: colors.textSecondary }}>
          {status.pendingCount > 0 ? `${status.pendingCount} goals detected` : 'Goals detected'} — import as rep quotas for attainment tracking.
        </span>
        <button
          onClick={goSettings}
          style={{
            marginLeft: 'auto',
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            cursor: 'pointer',
          }}
        >
          Review in Settings
        </button>
        <button
          onClick={() => {
            setDismissed(true);
            api.post('/quotas/dismiss-pending-goals').catch(() => {});
          }}
          style={{
            background: 'transparent',
            color: colors.textMuted,
            border: 'none',
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 6px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  if (!status.hasQuotas) {
    return (
      <div style={{
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '10px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: fonts.sans,
        fontSize: 13,
      }}>
        <span style={{ color: colors.textSecondary }}>
          {status.isStale
            ? 'Quota data is outdated — no quotas found for the current period.'
            : 'No quotas configured yet.'}
          {' '}Set up quotas to unlock attainment tracking and gap analysis.
        </span>
        <button
          onClick={goSettings}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            color: colors.accent,
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            cursor: 'pointer',
          }}
        >
          Set Up Quotas
        </button>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'transparent',
            color: colors.textMuted,
            border: 'none',
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 6px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}

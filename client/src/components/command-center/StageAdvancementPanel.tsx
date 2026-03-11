import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency } from '../../lib/format';
import Skeleton from '../Skeleton';

interface DivergentDeal {
  id: string;
  name: string;
  stage: string;
  inferred_phase: string;
  phase_confidence: number;
  amount: number;
  owner_name: string;
  days_in_stage: number;
}

export default function StageAdvancementPanel() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<DivergentDeal[]>([]);
  const [investigating, setInvestigating] = useState(false);

  useEffect(() => {
    fetchDivergentDeals();
  }, []);

  const fetchDivergentDeals = async () => {
    setLoading(true);
    try {
      const result = await api.get('/deals?phase_divergence=true&limit=20');
      setDeals(result.deals || result.data || []);
    } catch (err) {
      console.error('[StageAdvancementPanel]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvestigateAll = async () => {
    setInvestigating(true);
    try {
      await api.post('/skills/stage-mismatch-detector/run');
      // Use toast notification (same pattern as Report Review Mode save success)
      const event = new CustomEvent('toast', {
        detail: {
          message: 'Stage mismatch detection running. Check findings feed for results.',
          type: 'success',
        },
      });
      window.dispatchEvent(event);
    } catch (err) {
      const event = new CustomEvent('toast', {
        detail: {
          message: `Failed to run investigation: ${(err as Error).message}`,
          type: 'error',
        },
      });
      window.dispatchEvent(event);
    } finally {
      setInvestigating(false);
    }
  };

  if (loading) return <Skeleton height={200} />;

  if (deals.length === 0) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 13, color: colors.textMuted }}>
          No deals with stage mismatches detected
        </p>
      </div>
    );
  }

  const totalValue = deals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, margin: 0 }}>
            Stage Advancement Opportunities
          </h3>
          <p style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 0' }}>
            {deals.length} deal{deals.length > 1 ? 's' : ''} with outdated stages · {formatCurrency(totalValue)} pipeline
          </p>
        </div>
        <button
          onClick={handleInvestigateAll}
          disabled={investigating}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 6,
            background: investigating ? colors.surfaceRaised : colors.accentSoft,
            color: investigating ? colors.textMuted : colors.accent,
            border: `1px solid ${investigating ? colors.border : colors.accentGlow}`,
            cursor: investigating ? 'not-allowed' : 'pointer',
          }}
        >
          {investigating ? 'Running...' : 'Investigate All'}
        </button>
      </div>

      {/* Deal List */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {deals.map((deal) => (
          <div
            key={deal.id}
            onClick={() => navigate(`/deals/${deal.id}`)}
            style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${colors.border}`,
              cursor: 'pointer',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.accent }}>
                  {deal.name}
                </div>
                <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                  {deal.stage} → {deal.inferred_phase} ({deal.phase_confidence}% confidence)
                </div>
              </div>
              <div style={{ textAlign: 'right', marginLeft: 12 }}>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                  {formatCurrency(deal.amount)}
                </div>
                <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                  {deal.days_in_stage} days in stage
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { 
  Database, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCcw, 
  ChevronRight, 
  Zap,
  TrendingUp,
  History,
  ShieldCheck,
  BarChart3
} from 'lucide-react';

interface Readiness {
  totalPairs: number;
  goodPairs: number;
  readyToTrain: boolean;
  byWorkspace: Array<{ workspace_id: string; count: number }>;
}

interface FineTuningReadiness {
  document_synthesis: Readiness;
  classification: Readiness;
}

interface Job {
  id: string;
  model_purpose: string;
  status: string;
  quality_improvement_pct?: number;
  baseline_val_loss?: number;
  val_loss?: number;
  deployed_at?: string;
  created_at: string;
}

export default function FineTuning() {
  const [readiness, setReadiness] = useState<FineTuningReadiness | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [rRes, jRes, sRes] = await Promise.all([
        api.get('/admin/fine-tuning/readiness'),
        api.get('/admin/fine-tuning/jobs'),
        api.get('/admin/fine-tuning/stats')
      ]);
      setReadiness(rRes as FineTuningReadiness);
      setJobs(jRes as Job[]);
      setStats(sRes);
    } catch (err) {
      console.error('Failed to fetch fine-tuning data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      const activeJobs = jobs.some(j => ['pending', 'submitted', 'training'].includes(j.status));
      if (activeJobs) fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData, jobs]);

  const handleSubmitJob = async (purpose: string) => {
    if (!window.confirm(`Submit new ${purpose} training job?`)) return;
    setSubmitting(true);
    try {
      await api.post('/admin/fine-tuning/submit-job', { purpose });
      fetchData();
    } catch (err) {
      alert('Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (jobId: string, action: string) => {
    try {
      await api.post(`/admin/fine-tuning/jobs/${jobId}/${action}`, {});
      fetchData();
    } catch (err) {
      alert(`Failed to ${action} job`);
    }
  };

  if (loading && !readiness) {
    return <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading fine-tuning dashboard...</div>;
  }

  const savings = stats?.savings;
  const estimatedSavings = savings ? ((savings.total_input / 1000) * 0.003 + (savings.total_output / 1000) * 0.015) : 0;

  return (
    <div style={{ fontFamily: fonts.sans, color: colors.text, padding: '24px 32px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>Fine-Tuning Pipeline</h1>
        <p style={{ fontSize: 14, color: colors.textMuted, margin: 0 }}>Progressive model specialization via Fireworks AI.</p>
      </div>

      {/* Training Readiness */}
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Database size={20} color={colors.accent} /> Training Readiness
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 40 }}>
        {['document_synthesis', 'classification'].map(type => {
          const r = readiness?.[type as keyof FineTuningReadiness];
          const threshold = type === 'document_synthesis' ? 500 : 200;
          const progress = r ? (r.goodPairs / threshold) * 100 : 0;
          return (
            <div key={type} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, textTransform: 'capitalize' }}>
                    {type.replace('_', ' ')}
                  </h3>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                    Base: Llama 3.1 8B Instruct
                  </div>
                </div>
                {r?.readyToTrain ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: colors.green }}>
                    <CheckCircle2 size={14} /> READY
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {r?.goodPairs || 0} / {threshold} pairs
                  </span>
                )}
              </div>

              <div style={{ width: '100%', height: 8, background: colors.surfaceRaised, borderRadius: 4, marginBottom: 24, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: r?.readyToTrain ? colors.green : colors.accent, transition: 'width 0.5s ease' }} />
              </div>

              <button
                disabled={!r?.readyToTrain || submitting}
                onClick={() => handleSubmitJob(type)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: r?.readyToTrain ? colors.accent : colors.surfaceRaised,
                  color: r?.readyToTrain ? '#fff' : colors.textMuted,
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: r?.readyToTrain ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                <Play size={16} /> New Training Job
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Recent Jobs */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={20} color={colors.accent} /> Training Jobs
          </h2>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: colors.surfaceRaised }}>
                  <th style={{ padding: '12px 16px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Model Purpose</th>
                  <th style={{ padding: '12px 16px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Status</th>
                  <th style={{ padding: '12px 16px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Improvement</th>
                  <th style={{ padding: '12px 16px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{job.model_purpose.replace('_', ' ')}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>{new Date(job.created_at).toLocaleDateString()}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ 
                        fontSize: 11, 
                        fontWeight: 600, 
                        padding: '2px 8px', 
                        borderRadius: 4,
                        background: job.status === 'deployed' ? colors.greenSoft : job.status === 'failed' ? colors.redSoft : colors.accentSoft,
                        color: job.status === 'deployed' ? colors.green : job.status === 'failed' ? colors.red : colors.accent,
                        textTransform: 'uppercase'
                      }}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {job.quality_improvement_pct ? (
                        <div style={{ color: job.quality_improvement_pct >= 5 ? colors.green : colors.text, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {job.quality_improvement_pct >= 0 ? '+' : ''}{job.quality_improvement_pct.toFixed(1)}%
                          {job.quality_improvement_pct >= 5 && <TrendingUp size={14} />}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {job.status === 'completed' && (
                          <button onClick={() => handleAction(job.id, 'evaluate')} style={{ color: colors.accent, background: 'none', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Evaluate</button>
                        )}
                        {job.status === 'completed' && job.quality_improvement_pct && job.quality_improvement_pct >= 5 && (
                          <button onClick={() => handleAction(job.id, 'deploy')} style={{ color: colors.green, background: 'none', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Deploy</button>
                        )}
                        {job.status === 'deployed' && (
                          <button onClick={() => handleAction(job.id, 'rollback')} style={{ color: colors.red, background: 'none', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Rollback</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Router Status & Impact */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={20} color={colors.accent} /> Router Status
            </h2>
            <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
              {['reason', 'classify', 'intent_classify'].map(cap => {
                const fb = stats?.fallbacks?.find((f: any) => f.capability === cap);
                const fbRate = fb ? (fb.fallback_calls / fb.total_calls) * 100 : 0;
                return (
                  <div key={cap} style={{ padding: '12px 0', borderBottom: cap !== 'intent_classify' ? `1px solid ${colors.border}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>{cap.replace('_', ' ')}</span>
                      <span style={{ fontSize: 12, color: colors.textMuted }}>{fbRate.toFixed(1)}% Fallback</span>
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {fb?.total_calls || 0} calls in 7d • avg {((fb?.avg_confidence || 0) * 100).toFixed(0)}% conf
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} color={colors.accent} /> Cost Impact
            </h2>
            <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>Claude Avoided (30d)</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: colors.accent }}>{savings?.total_calls?.toLocaleString() || 0} calls</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>Estimated Savings</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: colors.green }}>${estimatedSavings.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>Based on token rates</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Download, 
  Settings, 
  CheckCircle2, 
  AlertCircle,
  BarChart3
} from 'lucide-react';
import CalibrationSession from '../../components/documents/CalibrationSession';

interface QualityData {
  overallScore: number;
  trend: 'up' | 'down' | 'stable';
  metrics: {
    editRate: number;
    trainingPairCount: number;
    goodPairRatio: number;
  };
  byTemplate: Record<string, { reactions: number; replies: number }>;
  mostEditedSections: {
    template: string;
    section: string;
    avgEditDistance: number;
    editCount: number;
  }[];
  calibrationStatus: {
    completedAt?: string;
    nextScheduledAt?: string;
    completedSessions: number;
  };
}

export default function DocumentQuality() {
  const { currentWorkspace } = useWorkspace();
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCalibration, setShowCalibration] = useState(false);

  useEffect(() => {
    if (currentWorkspace?.id) {
      fetchData();
    }
  }, [currentWorkspace?.id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/workspaces/${currentWorkspace?.id}/document-quality`);
      setData(res);
    } catch (err) {
      console.error('Failed to fetch quality data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!currentWorkspace) return;
    window.open(`/api/workspaces/${currentWorkspace.id}/training-pairs/export?format=jsonl`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: colors.textMuted }}>
        Loading quality metrics...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, color: colors.red }}>
        Failed to load data.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: fonts.sans, color: colors.text, padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>Document Quality Dashboard</h1>
          <p style={{ fontSize: 14, color: colors.textMuted, margin: 0 }}>Monitor and improve AI document output quality.</p>
        </div>
        <button
          onClick={handleExport}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            color: colors.text,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          <Download size={18} /> Export Training Pairs
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 32 }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Quality</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{Math.round(data.overallScore * 100)}%</div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 4, 
              fontSize: 12, 
              fontWeight: 600,
              color: data.trend === 'up' ? colors.green : data.trend === 'down' ? colors.red : colors.textMuted 
            }}>
              {data.trend === 'up' && <TrendingUp size={14} />}
              {data.trend === 'down' && <TrendingDown size={14} />}
              {data.trend === 'stable' && <Minus size={14} />}
              {data.trend.toUpperCase()}
            </div>
          </div>
        </div>

        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Edit Distance</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{data.metrics.editRate.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Lower is better</div>
        </div>

        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Training Pairs</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{data.metrics.trainingPairCount}</div>
          <div style={{ width: '100%', height: 6, background: colors.surfaceRaised, borderRadius: 3, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (data.metrics.trainingPairCount / 500) * 100)}%`, height: '100%', background: colors.accent }} />
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>{data.metrics.trainingPairCount} / 500 for fine-tuning</div>
        </div>

        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>"Good" Label Rate</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{Math.round(data.metrics.goodPairRatio * 100)}%</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>From automated labeling</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Most Edited Sections</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: colors.surfaceRaised }}>
                <th style={{ padding: '12px 20px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Section</th>
                <th style={{ padding: '12px 20px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Edits</th>
                <th style={{ padding: '12px 20px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Avg. Distance</th>
                <th style={{ padding: '12px 20px', color: colors.textMuted, fontWeight: 500, fontSize: 12 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.mostEditedSections.map((row, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ fontWeight: 500 }}>{row.section}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted }}>{row.template}</div>
                  </td>
                  <td style={{ padding: '14px 20px' }}>{row.editCount}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ 
                        display: 'inline-block', 
                        width: 8, 
                        height: 8, 
                        borderRadius: '50%', 
                        background: row.avgEditDistance > 0.4 ? colors.red : row.avgEditDistance > 0.2 ? colors.yellow : colors.green 
                      }} />
                      {row.avgEditDistance.toFixed(2)}
                    </div>
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    {row.avgEditDistance > 0.3 && (
                      <button 
                        onClick={() => setShowCalibration(true)}
                        style={{ color: colors.accent, background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Calibrate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.mostEditedSections.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '40px 20px', textAlign: 'center', color: colors.textMuted }}>
                    No edit history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={18} /> Calibration Status
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: colors.textMuted }}>Sessions Completed</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{data.calibrationStatus.completedSessions}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: colors.textMuted }}>Last Session</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {data.calibrationStatus.completedAt ? new Date(data.calibrationStatus.completedAt).toLocaleDateString() : 'Never'}
                </span>
              </div>
              
              <div style={{ marginTop: 24 }}>
                <button
                  onClick={() => setShowCalibration(true)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: colors.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  Run Calibration Now <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>

          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={18} /> Slack Engagement
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(data.byTemplate).map(([template, stats]) => (
                <div key={template} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <span style={{ fontSize: 13 }}>{template}</span>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>{stats.reactions} 👍</span>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>{stats.replies} 💬</span>
                  </div>
                </div>
              ))}
              {Object.keys(data.byTemplate).length === 0 && (
                <div style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: '12px 0' }}>
                  No engagement data yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCalibration && currentWorkspace && (
        <CalibrationSession
          workspaceId={currentWorkspace.id}
          onClose={() => setShowCalibration(false)}
          onComplete={() => {
            setShowCalibration(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

const ArrowRight = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14m-7-7 7 7-7 7" />
  </svg>
);

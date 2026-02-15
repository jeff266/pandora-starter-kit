import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';

export default function SkillsPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    api.get('/skills')
      .then(data => setSkills(Array.isArray(data) ? data : data.skills || []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const runSkill = async (skillId: string) => {
    setRunningSkill(skillId);
    try {
      await api.post(`/skills/${skillId}/run`);
      setToast({ message: `${skillId} started successfully`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: `Failed to run ${skillId}: ${err.message}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setRunningSkill(null);
    }
  };

  const categoryColors: Record<string, string> = {
    pipeline: colors.accent,
    deals: colors.orange,
    reporting: colors.purple,
    operations: colors.yellow,
    forecasting: colors.green,
    enrichment: '#a78bfa',
    scoring: '#f472b6',
    intelligence: '#06b6d4',
    config: colors.textMuted,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={56} />)}
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          fontSize: 11,
          fontWeight: 600,
          color: colors.textDim,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <span>Skill</span>
          <span>Category</span>
          <span>Schedule</span>
          <span>Last Run</span>
          <span></span>
        </div>

        {skills.map((skill, i) => (
          <div
            key={skill.id || i}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
              padding: '12px 16px',
              borderBottom: `1px solid ${colors.border}`,
              alignItems: 'center',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => navigate(`/skills/${skill.id}/runs`)}
          >
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {skill.name || skill.id}
              </span>
              {skill.description && (
                <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {skill.description}
                </p>
              )}
            </div>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              background: `${categoryColors[skill.category] || colors.textMuted}15`,
              color: categoryColors[skill.category] || colors.textMuted,
              justifySelf: 'start',
              textTransform: 'capitalize',
            }}>
              {skill.category || '--'}
            </span>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {skill.schedule || 'Manual'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {skill.lastRunAt && (
                <>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: skill.lastRunStatus === 'failed' ? colors.red : colors.green,
                  }} />
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {formatTimeAgo(skill.lastRunAt)}
                  </span>
                </>
              )}
              {!skill.lastRunAt && <span style={{ fontSize: 12, color: colors.textDim }}>Never</span>}
            </div>
            <button
              onClick={e => { e.stopPropagation(); runSkill(skill.id); }}
              disabled={runningSkill === skill.id}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 6,
                background: runningSkill === skill.id ? colors.surfaceHover : colors.accent,
                color: '#fff',
                opacity: runningSkill === skill.id ? 0.6 : 1,
                justifySelf: 'end',
              }}
            >
              {runningSkill === skill.id ? 'Running...' : 'Run Now'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

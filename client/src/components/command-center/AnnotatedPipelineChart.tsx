import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency } from '../../lib/format';
import Skeleton from '../Skeleton';

interface PipelineStage {
  stage: string;
  stage_normalized: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  probability?: number;
  findings?: { act: number; watch: number; notable: number; info: number };
}

interface Finding {
  id: string;
  severity: string;
  message: string;
  skill_id: string;
  skill_name?: string;
  deal_id?: string;
  deal_name?: string;
  stage?: string;
  stage_normalized?: string;
}

interface StageDeal {
  id: string;
  name: string;
  amount?: number;
  owner_name?: string;
  days_in_stage?: number;
}

interface AnnotatedPipelineChartProps {
  stages: PipelineStage[];
  findings: Finding[];
  loading?: boolean;
  totalPipeline: number;
  onStageClick: (stageNorm: string, stageName: string) => void;
  expandedStage: string | null;
  expandedStageDeals: StageDeal[];
  expandedStageLoading: boolean;
  onExpandStage: (stageName: string) => void;
  onViewAll: (stageName: string) => void;
  anon: any;
}

interface StageAnnotation {
  label: string;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  amount?: number;
}

function getSeverityColor(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return colors.red;
  if (severity === 'warning') return colors.yellow;
  return colors.accent;
}

function mapFindingSeverity(s: string): 'critical' | 'warning' | 'info' {
  if (s === 'act' || s === 'critical') return 'critical';
  if (s === 'watch' || s === 'warning') return 'warning';
  return 'info';
}

function getBarColor(annotations: StageAnnotation[]): string {
  if (annotations.some(a => a.severity === 'critical')) return colors.red;
  if (annotations.some(a => a.severity === 'warning')) return colors.yellow;
  return colors.accent;
}

function buildAnnotations(
  stage: PipelineStage,
  findings: Finding[]
): StageAnnotation[] {
  const ann: StageAnnotation[] = [];

  const stageFindings = findings.filter(f => {
    if (f.stage_normalized && stage.stage_normalized) {
      return f.stage_normalized === stage.stage_normalized;
    }
    if (f.stage) {
      return f.stage === stage.stage || f.stage === stage.stage_normalized;
    }
    const msg = (f.message || '').toLowerCase();
    const stageLow = stage.stage.toLowerCase();
    return msg.includes(stageLow);
  });

  if (stageFindings.length > 0) {
    const critCount = stageFindings.filter(f => mapFindingSeverity(f.severity) === 'critical').length;
    const warnCount = stageFindings.filter(f => mapFindingSeverity(f.severity) === 'warning').length;
    if (critCount > 0) ann.push({ label: `${critCount} critical finding${critCount > 1 ? 's' : ''}`, severity: 'critical', count: critCount });
    if (warnCount > 0) ann.push({ label: `${warnCount} warning${warnCount > 1 ? 's' : ''}`, severity: 'warning', count: warnCount });
  }

  if (ann.length === 0 && stage.findings) {
    if (stage.findings.act > 0) ann.push({ label: `${stage.findings.act} action needed`, severity: 'critical', count: stage.findings.act });
    if (stage.findings.watch > 0) ann.push({ label: `${stage.findings.watch} watch`, severity: 'warning', count: stage.findings.watch });
  }

  return ann.slice(0, 2);
}

function FlagPill({ annotation }: { annotation: StageAnnotation }) {
  const c = getSeverityColor(annotation.severity);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 7px',
      borderRadius: 4,
      background: `${c}22`,
      border: `1px solid ${c}44`,
      fontSize: 9,
      fontWeight: 600,
      color: c,
      whiteSpace: 'nowrap',
      lineHeight: 1.5,
      flexShrink: 0,
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: c, flexShrink: 0 }} />
      {annotation.label}
    </span>
  );
}

export default function AnnotatedPipelineChart({
  stages,
  findings,
  loading,
  totalPipeline,
  onStageClick,
  expandedStage,
  expandedStageDeals,
  expandedStageLoading,
  onExpandStage,
  onViewAll,
  anon,
}: AnnotatedPipelineChartProps) {
  const navigate = useNavigate();
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);

  const maxValue = stages.reduce((max, s) => Math.max(max, s.total_value), 1);

  const handleRowClick = useCallback((stage: PipelineStage) => {
    onStageClick(stage.stage_normalized || stage.stage, stage.stage);
  }, [onStageClick]);

  const handleFlagClick = useCallback((e: React.MouseEvent, stageName: string) => {
    e.stopPropagation();
    onExpandStage(stageName);
  }, [onExpandStage]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} />)}
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
        No pipeline data available
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {stages.map((stage) => {
        const annotations = buildAnnotations(stage, findings);
        const barColor = getBarColor(annotations);
        const barPct = maxValue > 0 ? Math.max(4, (stage.total_value / maxValue) * 100) : 4;
        const isHovered = hoveredStage === stage.stage;
        const isExpanded = expandedStage === (stage.stage_normalized || stage.stage);
        const hasAnnotations = annotations.length > 0;

        return (
          <div key={stage.stage}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '5px 4px',
                borderRadius: 5,
                cursor: 'pointer',
                background: isHovered ? colors.surfaceHover : 'transparent',
                transition: 'background 0.1s',
              }}
              onClick={() => handleRowClick(stage)}
              onMouseEnter={() => setHoveredStage(stage.stage)}
              onMouseLeave={() => setHoveredStage(null)}
            >
              <div style={{
                width: 130,
                flexShrink: 0,
                fontSize: 12,
                color: colors.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: fonts.sans,
              }}>
                {stage.stage}
              </div>

              <div style={{ flex: 1, position: 'relative', height: 28 }}>
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 4,
                  width: `${barPct}%`,
                  height: 20,
                  borderRadius: '0 4px 4px 0',
                  background: `linear-gradient(90deg, ${barColor}cc, ${barColor}66)`,
                  transition: 'width 0.3s ease',
                }} />
                <div style={{
                  position: 'absolute',
                  left: `${barPct}%`,
                  top: 8,
                  paddingLeft: 8,
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  color: colors.textSecondary,
                  whiteSpace: 'nowrap',
                }}>
                  {formatCurrency(anon.amount(stage.total_value))} · {stage.deal_count}d
                </div>
              </div>

              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                {hasAnnotations ? (
                  annotations.map((ann, i) => (
                    <div key={i} onClick={(e) => handleFlagClick(e, stage.stage_normalized || stage.stage)}>
                      <FlagPill annotation={ann} />
                    </div>
                  ))
                ) : (
                  <div style={{ width: 80 }} />
                )}
              </div>
            </div>

            {isExpanded && (
              <div style={{
                margin: '4px 0 8px 130px',
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '10px 12px',
                animation: 'fadeSlideIn 0.15s ease',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
                  Deals in {stage.stage}
                </div>
                {expandedStageLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[1, 2, 3].map(i => <Skeleton key={i} height={24} />)}
                  </div>
                ) : expandedStageDeals.length === 0 ? (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>No deal details found.</div>
                ) : (
                  <>
                    {expandedStageDeals.map(deal => (
                      <div
                        key={deal.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '5px 0',
                          borderBottom: `1px solid ${colors.border}`,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(`/deals/${deal.id}`)}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        <span style={{ fontSize: 12, color: colors.accent, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {anon.deal(deal.name)}
                        </span>
                        {deal.owner_name && (
                          <span style={{ fontSize: 11, color: colors.textSecondary, flexShrink: 0 }}>
                            {anon.person(deal.owner_name)}
                          </span>
                        )}
                        {deal.amount != null && (
                          <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.text, flexShrink: 0 }}>
                            {formatCurrency(anon.amount(deal.amount))}
                          </span>
                        )}
                        {deal.days_in_stage != null && (
                          <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono, flexShrink: 0 }}>
                            {deal.days_in_stage}d
                          </span>
                        )}
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                      <button
                        onClick={() => onViewAll(stage.stage_normalized || stage.stage)}
                        style={{ fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                      >
                        View all →
                      </button>
                      <button
                        onClick={() => onExpandStage(stage.stage_normalized || stage.stage)}
                        style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Close ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

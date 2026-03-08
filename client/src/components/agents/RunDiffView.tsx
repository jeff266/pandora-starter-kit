import React, { useMemo } from 'react';
import { diffWords } from 'diff';
import { X } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

export interface AgentRunSummary {
  id: string;
  status: string;
  synthesis_mode: 'findings_dump' | 'goal_aware' | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  findings_count: number | null;
  skills_run: string[];
  total_tokens: number | null;
  synthesis_output: string | null;
  error_message: string | null;
  trend: 'improving' | 'worsening' | 'stable' | null;
}

interface SynthesisSection {
  header: string;
  content: string;
}

function parseSynthesisOutput(text: string): SynthesisSection[] {
  if (!text?.trim()) return [{ header: 'Full Output', content: '' }];
  try {
    const parts = text.split(/^##\s+/m).filter(Boolean);
    if (parts.length < 2) {
      return [{ header: 'Full Output', content: text }];
    }
    return parts.map(part => {
      const newlineIdx = part.indexOf('\n');
      if (newlineIdx === -1) return { header: part.trim(), content: '' };
      return {
        header: part.slice(0, newlineIdx).trim(),
        content: part.slice(newlineIdx + 1).trim(),
      };
    });
  } catch {
    return [{ header: 'Full Output', content: text }];
  }
}

function formatRunDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

interface DiffWordsProps {
  oldText: string;
  newText: string;
}

function DiffWords({ oldText, newText }: DiffWordsProps) {
  const changes = useMemo(() => diffWords(oldText, newText), [oldText, newText]);
  const isIdentical = changes.every(c => !c.added && !c.removed);

  if (isIdentical && !oldText && !newText) {
    return <span style={{ color: colors.textMuted, fontStyle: 'italic' }}>Empty</span>;
  }

  const oldParts = changes.filter(c => !c.added);
  const newParts = changes.filter(c => !c.removed);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div style={{ padding: '10px 12px', borderRight: `1px solid ${colors.border}`, fontSize: 13, fontFamily: fonts.mono || fonts.sans, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {oldParts.map((c, i) =>
          c.removed ? (
            <span key={i} style={{ background: 'rgba(220,38,38,0.18)', color: '#f87171', textDecoration: 'line-through', borderRadius: 2, padding: '0 1px' }}>{c.value}</span>
          ) : (
            <span key={i} style={{ color: colors.text }}>{c.value}</span>
          )
        )}
      </div>
      <div style={{ padding: '10px 12px', fontSize: 13, fontFamily: fonts.mono || fonts.sans, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {newParts.map((c, i) =>
          c.added ? (
            <span key={i} style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', borderRadius: 2, padding: '0 1px' }}>{c.value}</span>
          ) : (
            <span key={i} style={{ color: colors.text }}>{c.value}</span>
          )
        )}
      </div>
    </div>
  );
}

interface RunDiffViewProps {
  current: AgentRunSummary;
  previous: AgentRunSummary;
  onClose: () => void;
}

export default function RunDiffView({ current, previous, onClose }: RunDiffViewProps) {
  const prevSections = useMemo(() => parseSynthesisOutput(previous.synthesis_output || ''), [previous.synthesis_output]);
  const curSections = useMemo(() => parseSynthesisOutput(current.synthesis_output || ''), [current.synthesis_output]);

  const allHeaders = useMemo(() => {
    const seen = new Set<string>();
    [...prevSections, ...curSections].forEach(s => seen.add(s.header));
    return Array.from(seen);
  }, [prevSections, curSections]);

  const isIdentical = useMemo(() => {
    if ((previous.synthesis_output || '') === (current.synthesis_output || '')) return true;
    return allHeaders.every(h => {
      const p = prevSections.find(s => s.header === h)?.content || '';
      const c = curSections.find(s => s.header === h)?.content || '';
      return p === c;
    });
  }, [previous.synthesis_output, current.synthesis_output, allHeaders, prevSections, curSections]);

  const findingsDelta = (() => {
    if (previous.findings_count == null || current.findings_count == null) return null;
    const delta = current.findings_count - previous.findings_count;
    const trendColor = delta < 0 ? '#4ade80' : delta > 0 ? '#f87171' : colors.textMuted;
    const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '—';
    const label = delta < 0 ? 'improving' : delta > 0 ? 'worsening' : 'stable';
    return { delta, trendColor, arrow, label };
  })();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: '12px 12px 0 0',
        width: '100%', maxWidth: 900,
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ font: `500 15px ${fonts.sans}`, color: colors.text }}>
              Comparing runs
            </div>
            <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted, marginTop: 3 }}>
              {formatRunDate(previous.started_at)} → {formatRunDate(current.started_at)}
              {findingsDelta && (
                <span style={{ marginLeft: 10, color: findingsDelta.trendColor }}>
                  {previous.findings_count} findings → {current.findings_count} findings&nbsp;
                  {findingsDelta.arrow} {findingsDelta.label}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', font: `500 12px ${fonts.sans}`, color: colors.textMuted, borderRight: `1px solid ${colors.border}` }}>
            {formatRunDate(previous.started_at)} (previous)
          </div>
          <div style={{ padding: '8px 12px', font: `500 12px ${fonts.sans}`, color: colors.textMuted }}>
            {formatRunDate(current.started_at)} (current)
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {isIdentical ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, font: `400 14px ${fonts.sans}`, color: colors.textMuted }}>
              No changes between these runs.
            </div>
          ) : (
            allHeaders.map(header => {
              const prevContent = prevSections.find(s => s.header === header)?.content;
              const curContent = curSections.find(s => s.header === header)?.content;

              return (
                <div key={header} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <div style={{
                    padding: '8px 12px',
                    background: colors.surfaceRaised,
                    font: `600 11px ${fonts.sans}`,
                    color: colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                    {header}
                  </div>
                  {prevContent == null || curContent == null ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                      <div style={{ padding: '10px 12px', borderRight: `1px solid ${colors.border}`, fontSize: 13, fontFamily: fonts.sans, color: prevContent != null ? colors.text : colors.textMuted, fontStyle: prevContent == null ? 'italic' : 'normal' }}>
                        {prevContent ?? `Not present in ${formatRunDate(previous.started_at)}`}
                      </div>
                      <div style={{ padding: '10px 12px', fontSize: 13, fontFamily: fonts.sans, color: curContent != null ? colors.text : colors.textMuted, fontStyle: curContent == null ? 'italic' : 'normal' }}>
                        {curContent ?? `Not present in ${formatRunDate(current.started_at)}`}
                      </div>
                    </div>
                  ) : (
                    <DiffWords oldText={prevContent} newText={curContent} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

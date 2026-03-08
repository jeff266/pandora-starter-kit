import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface DocumentContribution {
  id: string;
  title: string;
  type: string;
}

interface DocumentSection {
  id: string;
  title: string;
  content: DocumentContribution[];
}

interface AccumulatedDocument {
  templateType: string;
  sections: DocumentSection[];
}

interface ChatDocBarProps {
  threadId: string | null;
}

export default function ChatDocBar({ threadId }: ChatDocBarProps) {
  const [doc, setDoc] = useState<AccumulatedDocument | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [synthesis, setSynthesis] = useState<any>(null);
  const [rendering, setRendering] = useState(false);
  const [showDistrib, setShowDistrib] = useState(false);
  const [distributing, setDistributing] = useState<string | null>(null);
  const [distributed, setDistributed] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const fetchDoc = async () => {
      try {
        const res = await api.get(`/sessions/${threadId}/document`);
        setDoc(res);
      } catch {}
    };
    fetchDoc();
    const interval = setInterval(fetchDoc, 10000);
    return () => clearInterval(interval);
  }, [threadId]);

  if (!threadId || !doc) return null;

  const totalContributions = doc.sections.reduce(
    (sum: number, s: DocumentSection) => sum + s.content.length,
    0
  );

  if (totalContributions === 0) return null;

  const toggleSection = (id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRender = async () => {
    setRendering(true);
    try {
      const res = await api.post(`/sessions/${threadId}/document/synthesize`, { metrics: {} });
      setSynthesis(res);
    } catch {}
    setRendering(false);
    setShowDistrib(true);
    setExpanded(false);
  };

  const handleDistribute = async (channel: string) => {
    setDistributing(channel);
    try {
      await api.post(`/sessions/${threadId}/document/distribute`, {
        channel,
        subject: synthesis?.documentThroughline || 'Pandora Analysis',
        body: synthesis?.executiveSummary || '',
      });
      setDistributed(channel);
      setTimeout(() => setDistributed(null), 3000);
    } catch {}
    setDistributing(null);
  };

  const distribChannels = [
    { id: 'slack', label: 'Slack', icon: '#', color: '#e879f9' },
    { id: 'email', label: 'Email', icon: '✉', color: '#6488ea' },
    { id: 'drive', label: 'Drive', icon: '⬡', color: '#34d399' },
    { id: 'download', label: 'Download', icon: '↓', color: '#94a3b8' },
  ];

  return (
    <div style={{ borderTop: '1px solid #1e2230', background: '#0a0d18' }}>
      {/* Expanded section outline */}
      {expanded && !showDistrib && (
        <div style={{
          maxHeight: 220,
          overflowY: 'auto',
          padding: '8px 14px 0',
          borderBottom: '1px solid #1a1f2e',
        }}>
          {doc.sections.filter(s => s.content.length > 0).map(section => (
            <div key={section.id} style={{ marginBottom: 4 }}>
              <button
                onClick={() => toggleSection(section.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '5px 0',
                  color: '#94a3b8',
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.06em',
                  textAlign: 'left' as const,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: expandedSections[section.id] ? '#6488ea' : '#475569', fontSize: 9 }}>
                    {expandedSections[section.id] ? '▼' : '▶'}
                  </span>
                  {section.title}
                </span>
                <span style={{
                  background: '#1e2a3a',
                  color: '#6488ea',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 10,
                }}>
                  {section.content.length}
                </span>
              </button>
              {expandedSections[section.id] && (
                <div style={{ paddingLeft: 18, paddingBottom: 4 }}>
                  {section.content.map(item => (
                    <div key={item.id} style={{
                      fontSize: 11,
                      color: '#64748b',
                      padding: '3px 0',
                      borderLeft: '2px solid #1e2230',
                      paddingLeft: 8,
                      marginBottom: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    }}>
                      {item.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Distribution grid */}
      {showDistrib && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1f2e' }}>
          <div style={{
            fontSize: 11,
            color: '#64748b',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}>
            Distribute
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {distribChannels.map(ch => (
              <button
                key={ch.id}
                onClick={() => handleDistribute(ch.id)}
                disabled={distributing === ch.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  background: distributed === ch.id ? 'rgba(52,211,153,0.1)' : '#0e1120',
                  border: `1px solid ${distributed === ch.id ? '#34d399' : '#1e2230'}`,
                  borderRadius: 7,
                  cursor: distributing === ch.id ? 'default' : 'pointer',
                  opacity: distributing && distributing !== ch.id ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 14, color: ch.color, minWidth: 16, textAlign: 'center' as const }}>
                  {distributed === ch.id ? '✓' : ch.icon}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: distributed === ch.id ? '#34d399' : '#cbd5e1',
                }}>
                  {distributing === ch.id ? 'Sending…' : distributed === ch.id ? 'Sent!' : ch.label}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowDistrib(false)}
            style={{
              marginTop: 8,
              fontSize: 11,
              color: '#475569',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Close
          </button>
        </div>
      )}

      {/* Collapsed bar — always visible */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        cursor: 'pointer',
        userSelect: 'none' as const,
      }}
        onClick={() => { if (!showDistrib) setExpanded(e => !e); }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13 }}>📄</span>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
            {doc.templateType}
          </span>
          <span style={{
            background: '#1e2a3a',
            color: '#6488ea',
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 10,
          }}>
            {totalContributions}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={e => { e.stopPropagation(); handleRender(); }}
            disabled={rendering}
            style={{
              padding: '4px 12px',
              background: rendering ? '#1e2a3a' : '#6488ea',
              border: 'none',
              borderRadius: 6,
              color: rendering ? '#475569' : '#fff',
              fontSize: 11,
              fontWeight: 700,
              cursor: rendering ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'background 0.15s',
            }}
          >
            {rendering ? 'Rendering…' : showDistrib ? 'Distribute →' : 'Render →'}
          </button>
          {!showDistrib && (
            <span style={{ color: '#475569', fontSize: 10 }}>
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

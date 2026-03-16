import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Fuse from 'fuse.js';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { openAskPandora } from '../lib/askPandora';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatCurrency } from '../lib/format';
import { colors } from '../styles/theme';

interface DealEntry {
  id: string; name: string; amount: number; stage: string;
  ownerName: string; daysSinceActivity: number; closeDate: string | null;
}
interface RepEntry { email: string; name: string; role: string; }
interface HypothesisEntry { id: string; hypothesis: string; metric: string; status: string; }
interface SkillEntry { id: string; name: string; category: string; }
interface SearchIndex { deals: DealEntry[]; reps: RepEntry[]; hypotheses: HypothesisEntry[]; skills: SkillEntry[]; }

interface SearchResult {
  type: 'deal' | 'rep' | 'page' | 'skill' | 'hypothesis' | 'ask';
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  action: () => void;
}

const PAGES = [
  { id: 'concierge',   title: 'Concierge',      subtitle: 'Weekly briefing and deal cards',      route: '/concierge' },
  { id: 'gtm',         title: 'GTM',             subtitle: 'Pipeline and forecast overview',      route: '/gtm' },
  { id: 'actions',     title: 'Actions',         subtitle: 'Sprint view and hypothesis tracker',  route: '/actions' },
  { id: 'hypotheses',  title: 'Hypotheses',      subtitle: 'Standing hypothesis monitor',         route: '/actions?tab=hypotheses' },
  { id: 'backlog',     title: 'Action Backlog',  subtitle: 'Full action queue',                   route: '/actions?tab=backlog' },
  { id: 'agents',      title: 'Agents',          subtitle: 'Operator configuration',              route: '/agents' },
  { id: 'targets',     title: 'Targets',         subtitle: 'Quota and goal tracking',             route: '/targets' },
  { id: 'data',        title: 'Data',            subtitle: 'Connectors and sync status',          route: '/data' },
  { id: 'settings',    title: 'Settings',        subtitle: 'Workspace configuration',             route: '/settings' },
];

let searchIndexCache: SearchIndex | null = null;
let searchIndexCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(searchIndexCache);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadIndex = useCallback(async () => {
    if (!currentWorkspace?.id) return;
    if (searchIndexCache && Date.now() - searchIndexCacheTime < CACHE_TTL) {
      setSearchIndex(searchIndexCache);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get('/search-index');
      searchIndexCache = data as SearchIndex;
      searchIndexCacheTime = Date.now();
      setSearchIndex(searchIndexCache);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace?.id]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      loadIndex();
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen, loadIndex]);

  const dealFuse = useMemo(() => searchIndex
    ? new Fuse(searchIndex.deals, { keys: ['name', 'ownerName'], threshold: 0.3, includeScore: true })
    : null, [searchIndex]);

  const repFuse = useMemo(() => searchIndex
    ? new Fuse(searchIndex.reps, { keys: ['name', 'email'], threshold: 0.3 })
    : null, [searchIndex]);

  const hypothesisFuse = useMemo(() => searchIndex
    ? new Fuse(searchIndex.hypotheses, { keys: ['hypothesis', 'metric'], threshold: 0.4 })
    : null, [searchIndex]);

  const close = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const openDeal = useCallback((deal: DealEntry) => {
    openAskPandora({
      source: 'deal_finding',
      label: deal.name,
      value: `${deal.stage} · ${formatCurrency(deal.amount)}`,
      dealId: deal.id,
      dealName: deal.name,
    }, navigate, '.');
    close();
  }, [navigate, close]);

  const triggerSkillRun = useCallback((skillId: string) => {
    if (!currentWorkspace?.id) return;
    api.post(`/skills/${skillId}/run`, { workspace_id: currentWorkspace.id }).catch(() => {});
    close();
  }, [currentWorkspace?.id, close]);

  const getDefaultResults = useCallback((): SearchResult[] => {
    if (!searchIndex) return [];
    const stalest = [...searchIndex.deals]
      .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity)
      .slice(0, 3);
    return [
      ...stalest.map(deal => ({
        type: 'deal' as const,
        id: deal.id,
        title: deal.name,
        subtitle: `${deal.daysSinceActivity}d silent · ${formatCurrency(deal.amount)} · ${deal.ownerName}`,
        icon: '📋',
        action: () => openDeal(deal),
      })),
      { type: 'page' as const, id: 'actions', title: 'Actions', subtitle: 'Sprint view and hypothesis tracker', icon: '→',
        action: () => { navigate('/actions'); close(); } },
      { type: 'page' as const, id: 'concierge', title: 'Concierge', subtitle: 'Weekly briefing', icon: '→',
        action: () => { navigate('/concierge'); close(); } },
      { type: 'ask' as const, id: 'ask', title: 'Ask Pandora anything...', subtitle: 'Open Ask Pandora', icon: '✦',
        action: () => { navigate('.', { state: { openChatWithMessage: 'Hello Pandora, what should I focus on today?' } }); close(); } },
    ];
  }, [searchIndex, openDeal, navigate, close]);

  const [results, setResults] = useState<SearchResult[]>([]);

  const buildResults = useCallback((q: string): SearchResult[] => {
    if (!searchIndex) return [];
    if (!q.trim()) return getDefaultResults();

    const out: SearchResult[] = [];
    const qLower = q.toLowerCase();

    dealFuse?.search(q).slice(0, 4).forEach(({ item }) => {
      out.push({
        type: 'deal', id: item.id, icon: '📋',
        title: item.name,
        subtitle: `${item.stage} · ${formatCurrency(item.amount)} · ${item.ownerName} · ${item.daysSinceActivity}d silent`,
        action: () => openDeal(item),
      });
    });

    repFuse?.search(q).slice(0, 2).forEach(({ item }) => {
      out.push({
        type: 'rep', id: item.email, icon: '👤',
        title: item.name,
        subtitle: `Rep · ${item.email}`,
        action: () => { navigate(`/reps/${encodeURIComponent(item.email)}`); close(); },
      });
    });

    PAGES.filter(p =>
      p.title.toLowerCase().includes(qLower) || p.subtitle.toLowerCase().includes(qLower)
    ).slice(0, 3).forEach(page => {
      out.push({
        type: 'page', id: page.id, icon: '→',
        title: page.title, subtitle: page.subtitle,
        action: () => { navigate(page.route); close(); },
      });
    });

    hypothesisFuse?.search(q).slice(0, 2).forEach(({ item }) => {
      const title = item.hypothesis.length > 60
        ? item.hypothesis.slice(0, 60) + '...'
        : item.hypothesis;
      out.push({
        type: 'hypothesis', id: item.id, icon: '📊',
        title, subtitle: `Hypothesis · ${item.metric} · ${item.status}`,
        action: () => { navigate(`/actions?tab=hypotheses&highlight=${item.id}`); close(); },
      });
    });

    searchIndex.skills
      .filter(s => s.name.toLowerCase().includes(qLower))
      .slice(0, 2)
      .forEach(skill => {
        out.push({
          type: 'skill', id: skill.id, icon: '⚡',
          title: `Run: ${skill.name}`, subtitle: `Skill · ${skill.category}`,
          action: () => triggerSkillRun(skill.id),
        });
      });

    if (q.length > 10) {
      const truncated = q.length > 40 ? q.slice(0, 40) + '...' : q;
      out.push({
        type: 'ask', id: 'ask-pandora', icon: '✦',
        title: `Ask Pandora: "${truncated}"`,
        subtitle: 'Open in Ask Pandora',
        action: () => { navigate('.', { state: { openChatWithMessage: q } }); close(); },
      });
    }

    return out;
  }, [searchIndex, dealFuse, repFuse, hypothesisFuse, getDefaultResults, openDeal, navigate, close, triggerSkillRun]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const r = buildResults(query);
      setResults(r);
      setSelectedIndex(0);
    }, 80);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, buildResults]);

  useEffect(() => {
    if (!isOpen) return;
    const initial = getDefaultResults();
    setResults(initial);
  }, [isOpen, searchIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) results[selectedIndex].action();
        break;
      case 'Escape':
        close();
        break;
    }
  }, [results, selectedIndex, close]);

  if (!isOpen) return null;

  const typeLabel: Record<string, string> = {
    deal: 'deal', rep: 'rep', skill: 'skill', ask: 'ask pandora',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '15vh',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={{
          width: 600, maxWidth: 'calc(100vw - 32px)',
          background: '#0f1219',
          border: '1px solid #1a1f2b',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid #1a1f2b',
        }}>
          <span style={{ fontSize: 16, color: '#3a4252', flexShrink: 0 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search deals, reps, pages... or ask a question"
            style={{
              flex: 1, background: 'transparent',
              border: 'none', outline: 'none',
              color: '#e8ecf4', fontSize: 14,
              fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
            }}
          />
          {loading && (
            <span style={{ fontSize: 11, color: '#3a4252', flexShrink: 0 }}>loading…</span>
          )}
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', color: '#3a4252', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: 400, overflowY: 'auto', padding: '6px 0' }}
        >
          {results.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#3a4252', fontSize: 13 }}>
              {query ? `No results for "${query}"` : 'Loading…'}
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.id + index}
                onClick={result.action}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 16px',
                  cursor: 'pointer',
                  background: index === selectedIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{result.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500, color: '#e8ecf4',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {result.title}
                  </div>
                  <div style={{
                    fontSize: 11, color: '#5a6578', marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {result.subtitle}
                  </div>
                </div>
                {typeLabel[result.type] && (
                  <span style={{ fontSize: 10, color: '#2a3040', flexShrink: 0, fontWeight: 500 }}>
                    {typeLabel[result.type]}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: 16, alignItems: 'center',
          padding: '8px 16px',
          borderTop: '1px solid #1a1f2b',
          color: '#2a3040', fontSize: 11,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

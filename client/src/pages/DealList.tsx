import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildDealCrmUrl, useCrmInfo } from '../lib/deeplinks';
import { useLens } from '../contexts/LensContext';

const PAGE_SIZE = 50;

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e', B: '#38bdf8', C: '#eab308', D: '#f97316', F: '#ef4444',
};

function gradeFromScore(score: number | null): string {
  if (score == null) return '—';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

interface DealRow {
  id: string;
  name: string;
  amount: number;
  stage: string;
  stage_normalized: string;
  owner: string;
  close_date: string | null;
  days_in_stage: number | null;
  score: number;
  grade: string;
  signal_counts: { act: number; watch: number; notable: number; info: number };
  is_closed: boolean;
  status: string;
  pipeline: string;
  scope_id: string;
  source_id: string | null;
  source: string | null;
  mechanical_score: number | null;
  mechanical_grade: string | null;
  active_source: 'skill' | 'health' | undefined;
  days_since_last_call?: number | null;
  divergence_flag?: boolean;
  action_count?: number;
  critical_action_count?: number;
}

type SortField = 'name' | 'amount' | 'stage' | 'owner' | 'close_date' | 'health' | 'days_in_stage' | 'last_call' | 'signals';
type SortDir = 'asc' | 'desc';

const DEFAULT_SORT: Record<SortField, SortDir> = {
  name: 'asc', amount: 'desc', stage: 'asc', owner: 'asc',
  close_date: 'asc', health: 'asc', days_in_stage: 'desc', last_call: 'desc', signals: 'desc',
};

function getStageAwareDaysColor(days: number | null, stageNormalized: string): string {
  if (days == null) return colors.textMuted;

  const stage = stageNormalized.toLowerCase();
  let redThreshold = 30;
  let yellowThreshold = 14;

  if (stage.includes('pilot')) {
    redThreshold = 45;
    yellowThreshold = 21;
  } else if (stage.includes('negotiation') || stage.includes('closing')) {
    redThreshold = 14;
    yellowThreshold = 7;
  } else if (stage.includes('evaluation') || stage.includes('proposal')) {
    redThreshold = 21;
    yellowThreshold = 10;
  }

  if (days > redThreshold) return colors.red;
  if (days > yellowThreshold) return '#eab308';
  return colors.textMuted;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

export default function DealList() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const { currentWorkspace } = useWorkspace();
  const isMobile = useIsMobile();
  const { activeLens } = useLens();
  const wsId = currentWorkspace?.id || '';
  const [searchParams] = useSearchParams();
  const [allDeals, setAllDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || 'all');
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get('owner') || 'all');
  const [healthFilter, setHealthFilter] = useState(searchParams.get('health') || 'all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [pipelineFilter, setPipelineFilter] = useState(() => localStorage.getItem(`pandora_deals_pipeline_${wsId}`) || 'default');
  const [scopes, setScopes] = useState<Array<{ scope_id: string; name: string; deal_count: number }>>([]);

  const [sortField, setSortField] = useState<SortField>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const { crmInfo } = useCrmInfo();

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const [riskData, dealsData, actionSummary] = await Promise.all([
        api.get('/pipeline/risk-summary').catch(() => null),
        api.get('/deals?limit=1000'),
        api.get('/actions/summary-by-deal').catch(() => ({ data: { deals: [] } })),
      ]);

      // Build action count maps from flat object keyed by deal_id
      const actionCounts = new Map<string, number>();
      const criticalCounts = new Map<string, number>();
      const summaryData = actionSummary?.data || {};
      for (const [dealId, s] of Object.entries(summaryData) as [string, any][]) {
        const total = (s.critical || 0) + (s.warning || 0) + (s.info || 0);
        if (total > 0) actionCounts.set(dealId, total);
        if (s.critical > 0) criticalCounts.set(dealId, s.critical);
      }

      const riskDeals: DealRow[] = (riskData?.data?.deals || riskData?.deals || []).map((d: any) => ({
        id: d.deal_id,
        name: d.deal_name || '',
        amount: Number(d.amount) || 0,
        stage: d.stage || '',
        stage_normalized: d.stage_normalized || d.stage || '',
        owner: d.owner || '',
        close_date: d.close_date,
        days_in_stage: d.days_in_stage,
        score: d.score ?? 100,
        grade: d.grade || 'A',
        signal_counts: d.signal_counts || { act: 0, watch: 0, notable: 0, info: 0 },
        is_closed: false,
        status: 'open',
        pipeline: d.pipeline || '',
        scope_id: d.scope_id || 'default',
        source_id: d.source_id ?? null,
        source: d.source ?? null,
        mechanical_score: d.mechanical_score ?? null,
        mechanical_grade: d.mechanical_grade ?? null,
        active_source: d.active_source ?? undefined,
        days_since_last_call: d.days_since_last_call ?? null,
        divergence_flag: d.divergence_flag ?? false,
        action_count: actionCounts.get(d.deal_id) || 0,
        critical_action_count: criticalCounts.get(d.deal_id) || 0,
      }));

      const riskDealIds = new Set(riskDeals.map(d => d.id));

      const rawDeals = Array.isArray(dealsData) ? dealsData : dealsData.data || dealsData.deals || [];
      const closedDeals: DealRow[] = rawDeals
        .filter((d: any) => !riskDealIds.has(d.id))
        .map((d: any) => {
          const effectiveScore = d.composite_score != null ? Number(d.composite_score) : (d.health_score != null ? Number(d.health_score) : 100);
          return {
            id: d.id,
            name: d.name || '',
            amount: Number(d.amount) || 0,
            stage: d.stage || d.stage_normalized || '',
            stage_normalized: d.stage_normalized || d.stage || '',
            owner: d.owner_name || d.owner_email || d.owner || '',
            close_date: d.close_date,
            days_in_stage: d.days_in_stage ?? null,
            score: effectiveScore,
            grade: gradeFromScore(effectiveScore),
            signal_counts: { act: 0, watch: 0, notable: 0, info: 0 },
            is_closed: ['closed_won', 'closed_lost'].includes(d.stage_normalized),
            status: d.stage_normalized === 'closed_won' ? 'won' : d.stage_normalized === 'closed_lost' ? 'lost' : 'open',
            pipeline: d.pipeline || d.source_data?.pipeline || '',
            scope_id: d.scope_id || 'default',
            source_id: d.source_id ?? null,
            source: d.source ?? null,
            mechanical_score: null,
            mechanical_grade: null,
            active_source: undefined,
            action_count: actionCounts.get(d.id) || 0,
            critical_action_count: criticalCounts.get(d.id) || 0,
          };
        });

      setAllDeals([...riskDeals, ...closedDeals]);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeals();
    api.get('/admin/scopes').then((data: any) => {
      const confirmedScopes = (data.scopes || []).filter((s: any) => s.confirmed);
      setScopes(confirmedScopes.map((s: any) => ({
        scope_id: s.scope_id,
        name: s.name,
        deal_count: s.deal_count,
      })));
    }).catch(() => {});
  }, [fetchDeals, activeLens]);

  const uniqueStages = useMemo(() => {
    const stageMap = new Map<string, string>();
    for (const d of allDeals) {
      const norm = d.stage_normalized;
      if (!norm) continue;
      const isNumeric = /^\d+$/.test(d.stage || '');
      if (!stageMap.has(norm)) {
        stageMap.set(norm, isNumeric ? norm : (d.stage || norm));
      } else if (!isNumeric && d.stage) {
        stageMap.set(norm, d.stage);
      }
    }
    return Array.from(stageMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }));
  }, [allDeals]);

  const uniqueOwners = useMemo(() =>
    Array.from(new Set(allDeals.map(d => d.owner).filter(Boolean))).sort(),
  [allDeals]);

  const uniquePipelines = useMemo(() =>
    Array.from(new Set(allDeals.map(d => d.pipeline).filter(Boolean))).sort(),
  [allDeals]);

  const filtered = useMemo(() => {
    let result = allDeals;

    if (statusFilter === 'open') result = result.filter(d => !d.is_closed);
    else if (statusFilter === 'won') result = result.filter(d => d.status === 'won');
    else if (statusFilter === 'lost') result = result.filter(d => d.status === 'lost');

    if (stageFilter !== 'all') {
      result = result.filter(d =>
        d.stage.toLowerCase().replace(/_/g, ' ') === stageFilter.toLowerCase().replace(/_/g, ' ')
        || d.stage_normalized.toLowerCase() === stageFilter.toLowerCase()
        || d.stage.toLowerCase() === stageFilter.toLowerCase()
      );
    }
    if (ownerFilter !== 'all') {
      result = result.filter(d => d.owner === ownerFilter);
    }
    if (healthFilter !== 'all') {
      result = result.filter(d => d.grade === healthFilter);
    }
    if (pipelineFilter !== 'default') {
      result = result.filter(d => d.scope_id === pipelineFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(d => d.name.toLowerCase().includes(q));
    }
    return result;
  }, [allDeals, statusFilter, stageFilter, ownerFilter, healthFilter, pipelineFilter, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'amount': cmp = a.amount - b.amount; break;
        case 'stage': cmp = a.stage.localeCompare(b.stage); break;
        case 'owner': cmp = a.owner.localeCompare(b.owner); break;
        case 'close_date': {
          const da = a.close_date ? new Date(a.close_date).getTime() : 0;
          const db = b.close_date ? new Date(b.close_date).getTime() : 0;
          cmp = da - db;
          break;
        }
        case 'health': cmp = a.score - b.score; break;
        case 'days_in_stage': cmp = (a.days_in_stage || 0) - (b.days_in_stage || 0); break;
        case 'last_call': cmp = (a.days_since_last_call ?? 999) - (b.days_since_last_call ?? 999); break;
        case 'signals': {
          const fa = a.signal_counts.act + a.signal_counts.watch + a.signal_counts.notable + a.signal_counts.info;
          const fb = b.signal_counts.act + b.signal_counts.watch + b.signal_counts.notable + b.signal_counts.info;
          cmp = fa - fb;
          break;
        }
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageDeals = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, stageFilter, ownerFilter, healthFilter, statusFilter, pipelineFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(DEFAULT_SORT[field]);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStageFilter('all');
    setOwnerFilter('all');
    setHealthFilter('all');
    setStatusFilter('open');
    setPipelineFilter('default');
    localStorage.removeItem(`pandora_deals_pipeline_${wsId}`);
  };

  const hasFilters = search || stageFilter !== 'all' || ownerFilter !== 'all' || healthFilter !== 'all' || statusFilter !== 'open' || pipelineFilter !== 'default';

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={56} />
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <Skeleton height={40} />
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={48} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.red }}>{error}</p>
        <button onClick={fetchDeals} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  if (allDeals.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>No deals found</p>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>Connect your CRM from the Connectors page.</p>
        <button onClick={() => navigate('/connectors')} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
          Go to Connectors
        </button>
      </div>
    );
  }

  const totalPipeline = filtered.reduce((s, d) => s + d.amount, 0);
  const isCloseDatePast = (d: string | null, isClosed: boolean) => {
    if (!d || isClosed) return false;
    return new Date(d) < new Date();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>Deals</h2>
          <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
            Showing {filtered.length} of {allDeals.length} deals
            {filtered.length > 0 && ` · ${formatCurrency(anon.amount(totalPipeline))} pipeline`}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 16px',
      }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search deals..."
          style={{
            fontSize: 12, padding: '6px 12px', width: isMobile ? '100%' : 180, minWidth: 0,
            background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
            borderRadius: 6, color: colors.text, outline: 'none',
          }}
        />
        <FilterSelect label="Pipeline" value={pipelineFilter} onChange={(v) => { setPipelineFilter(v); localStorage.setItem(`pandora_deals_pipeline_${wsId}`, v); }}
          options={[
            { value: 'default', label: 'All Deals' },
            ...scopes.filter(s => s.scope_id !== 'default').map(s => ({
              value: s.scope_id,
              label: `${s.name} (${s.deal_count})`,
            }))
          ]} />
        <FilterSelect label="Stage" value={stageFilter} onChange={setStageFilter}
          options={[{ value: 'all', label: 'All' }, ...uniqueStages.map(s => ({ value: s.value, label: s.label.replace(/_/g, ' ') }))]} />
        <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter}
          options={[{ value: 'all', label: 'All' }, ...uniqueOwners.map(o => ({ value: o, label: anon.person(shortName(o)) }))]} />
        <FilterSelect label="Health" value={healthFilter} onChange={setHealthFilter}
          options={[{ value: 'all', label: 'All' }, ...['A','B','C','D','F'].map(g => ({ value: g, label: g }))]} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}
          options={[{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'all', label: 'All' }]} />
        {hasFilters && (
          <button onClick={clearFilters} style={{
            fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4,
          }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Header row — hidden on mobile */}
        {!isMobile && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '23% 11% 12% 12% 10% 8% 8% 8% 8%',
            padding: '10px 20px',
            background: colors.surfaceRaised,
            borderBottom: `1px solid ${colors.border}`,
          }}>
            {([
              ['name', 'Deal Name'],
              ['amount', 'Amount'],
              ['stage', 'Stage'],
              ['owner', 'Owner'],
              ['close_date', 'Close Date'],
              ['health', 'Health'],
              ['days_in_stage', 'Days'],
              ['last_call', 'Last Call'],
              ['signals', 'Signals'],
            ] as [SortField, string][]).map(([field, label]) => (
              <div
                key={field}
                onClick={() => handleSort(field)}
                style={{
                  fontSize: 10, fontWeight: 600, color: sortField === field ? colors.accent : colors.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  cursor: 'pointer', userSelect: 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {label}
                {sortField === field && (
                  <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Data rows */}
        {pageDeals.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: colors.textMuted }}>No deals match your filters.</p>
            <button onClick={clearFilters} style={{
              fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
            }}>
              Clear filters
            </button>
          </div>
        ) : (
          pageDeals.map(deal => {
            const totalFindings = deal.signal_counts.act + deal.signal_counts.watch + deal.signal_counts.notable + deal.signal_counts.info;
            const pastDue = isCloseDatePast(deal.close_date, deal.is_closed);
            const daysColor = getStageAwareDaysColor(deal.days_in_stage, deal.stage_normalized);
            const lastCallColor = getStageAwareDaysColor(deal.days_since_last_call ?? null, deal.stage_normalized);

            if (isMobile) {
              const dealUrl = buildDealCrmUrl(
                crmInfo.crm,
                crmInfo.portalId || null,
                crmInfo.instanceUrl || null,
                deal.source_id,
                deal.source
              );

              return (
                <div
                  key={deal.id}
                  onClick={() => navigate(`/deals/${deal.id}`)}
                  style={{
                    padding: '12px 14px',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {anon.deal(deal.name || 'Unnamed')}
                      </span>
                      {dealUrl && (
                        <a
                          href={dealUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce'}
                          onClick={e => e.stopPropagation()}
                          style={{ display: 'inline-flex', flexShrink: 0, color: `${colors.accent}99`, transition: 'color 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = colors.accent; }}
                          onMouseLeave={e => { e.currentTarget.style.color = `${colors.accent}99`; }}
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    {deal.grade && deal.grade !== '—' && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, fontFamily: fonts.mono,
                        padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                        background: `${GRADE_COLORS[deal.grade] || colors.textMuted}20`,
                        color: GRADE_COLORS[deal.grade] || colors.textMuted,
                      }}>
                        {deal.grade}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: colors.textSecondary }}>
                    <span style={{ fontFamily: fonts.mono, color: colors.text }}>{deal.amount ? formatCurrency(anon.amount(deal.amount)) : '—'}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize' }}>{deal.stage?.replace(/_/g, ' ') || '—'}</span>
                    <span>{deal.owner && !/^\d+$/.test(deal.owner) ? anon.person(shortName(deal.owner)) || '—' : '—'}</span>
                    <span style={{ color: pastDue ? colors.red : colors.textMuted }}>{deal.close_date ? formatDate(deal.close_date) : ''}</span>
                    {(totalFindings > 0 || (deal.action_count && deal.action_count > 0)) && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {deal.signal_counts.act > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('act'), display: 'inline-block' }} />}
                        {deal.signal_counts.watch > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('watch'), display: 'inline-block' }} />}
                        {deal.action_count && deal.action_count > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: deal.critical_action_count ? colors.red : colors.orange, display: 'inline-block' }} title={`${deal.action_count} pending action${deal.action_count > 1 ? 's' : ''}`} />}
                      </span>
                    )}
                    {!!deal.divergence_flag && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          api.post(`/deals/${deal.id}/actions/sync`, {
                            steps: [{
                              title: 'Review stage currency — AI score exceeds CRM health',
                              priority: 'P2',
                              source: 'score_divergence',
                              category: 'stage',
                              suggested_crm_action: 'task_create',
                            }],
                          }).catch(() => {});
                          navigate(`/deals/${deal.id}`);
                        }}
                        title={`AI score (${deal.grade}) exceeds CRM health (${deal.mechanical_grade || '—'}) — stage may lag recent activity`}
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: '#14b8a620',
                          color: '#14b8a6',
                          border: '1px solid #14b8a640',
                          cursor: 'pointer',
                        }}
                      >
                        Score gap ↑
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={deal.id}
                onClick={() => navigate(`/deals/${deal.id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '23% 11% 12% 12% 10% 8% 8% 8% 8%',
                  padding: '12px 20px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', paddingRight: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {anon.deal(deal.name || 'Unnamed')}
                  </span>
                  {(() => {
                    const dealUrl = buildDealCrmUrl(
                      crmInfo.crm,
                      crmInfo.portalId || null,
                      crmInfo.instanceUrl || null,
                      deal.source_id,
                      deal.source
                    );
                    if (!dealUrl) return null;
                    return (
                      <a
                        href={dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce'}
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'inline-flex', flexShrink: 0, color: `${colors.accent}99`, transition: 'color 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = colors.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.color = `${colors.accent}99`; }}
                      >
                        <ExternalLink size={12} />
                      </a>
                    );
                  })()}
                </div>
                <div style={{ fontSize: 13, fontFamily: fonts.mono, color: colors.text }}>
                  {deal.amount ? formatCurrency(anon.amount(deal.amount)) : '—'}
                </div>
                <div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: colors.accentSoft, color: colors.accent,
                    display: 'inline-block', maxWidth: '100%', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={deal.stage || '—'}>
                    {deal.stage ? toTitleCase(deal.stage.replace(/_/g, ' ').replace(/\//g, '/')).slice(0, 20) + (deal.stage.length > 20 ? '...' : '') : '—'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deal.owner && !/^\d+$/.test(deal.owner) ? anon.person(shortName(deal.owner)) || '—' : '—'}
                </div>
                <div style={{ fontSize: 12, color: pastDue ? colors.red : colors.textMuted, fontWeight: pastDue ? 600 : 400 }}>
                  {deal.close_date ? formatDate(deal.close_date) : '—'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {deal.grade && deal.grade !== '—' ? (
                    <>
                      <span style={{
                        fontSize: 11, fontWeight: 700, fontFamily: fonts.mono,
                        padding: '2px 8px', borderRadius: 4,
                        background: `${GRADE_COLORS[deal.grade] || colors.textMuted}20`,
                        color: GRADE_COLORS[deal.grade] || colors.textMuted,
                      }}>
                        {deal.grade}
                      </span>
                      {!!deal.divergence_flag && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            api.post(`/deals/${deal.id}/actions/sync`, {
                              steps: [{
                                title: 'Review stage currency — AI score exceeds CRM health',
                                priority: 'P2',
                                source: 'score_divergence',
                                category: 'stage',
                                suggested_crm_action: 'task_create',
                              }],
                            }).catch(() => {});
                            navigate(`/deals/${deal.id}`);
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: '#14b8a620',
                            color: '#14b8a6',
                            border: '1px solid #14b8a640',
                            cursor: 'pointer',
                            fontFamily: fonts.sans,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title={`AI score (${deal.grade}) exceeds CRM health (${deal.mechanical_grade || '—'}) — stage may lag recent activity`}
                        >
                          Score gap ↑
                        </button>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: colors.textDim }}>—</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: daysColor }}>
                  {deal.days_in_stage != null ? `${Math.round(deal.days_in_stage)}` : '—'}
                </div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: lastCallColor }}>
                  {deal.days_since_last_call != null ? `${Math.round(deal.days_since_last_call)}d` : (
                    <span style={{ fontSize: 11, color: colors.textMuted }}>No calls</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {(() => {
                    // Show highest severity finding from signal_counts
                    if (deal.signal_counts.act > 0) {
                      return (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          background: '#fef2f2', color: severityColor('act'), fontFamily: fonts.sans,
                        }}>
                          ACT
                        </span>
                      );
                    }
                    if (deal.signal_counts.watch > 0) {
                      return (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          background: '#fefce8', color: severityColor('watch'), fontFamily: fonts.sans,
                        }}>
                          WATCH
                        </span>
                      );
                    }
                    if (deal.signal_counts.notable > 0) {
                      return (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          background: colors.surfaceRaised, color: colors.textMuted, fontFamily: fonts.sans,
                        }}>
                          NOTABLE
                        </span>
                      );
                    }

                    return null;
                  })()}
                  {deal.action_count && deal.action_count > 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: deal.critical_action_count ? `${colors.red}22` : `${colors.orange}22`,
                        color: deal.critical_action_count ? colors.red : colors.orange,
                        fontFamily: fonts.sans,
                        cursor: 'pointer',
                        letterSpacing: '0.04em',
                      }}
                      title={`${deal.action_count} pending action${deal.action_count > 1 ? 's' : ''}`}
                    >
                      {deal.critical_action_count ? '⚠ ' : ''}{deal.action_count} ACTION{deal.action_count > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 16px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        }}>
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 4,
                background: page === 0 ? colors.surfaceRaised : colors.accentSoft,
                color: page === 0 ? colors.textDim : colors.accent,
                border: 'none', cursor: page === 0 ? 'default' : 'pointer',
              }}
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 4,
                background: page >= totalPages - 1 ? colors.surfaceRaised : colors.accentSoft,
                color: page >= totalPages - 1 ? colors.textDim : colors.accent,
                border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: colors.textMuted }}>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: 11, padding: '5px 8px', borderRadius: 4,
          background: colors.surfaceRaised, color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function shortName(name: string): string {
  if (!name) return '';
  if (name.includes('@')) return name.split('@')[0];
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  return parts[0];
}

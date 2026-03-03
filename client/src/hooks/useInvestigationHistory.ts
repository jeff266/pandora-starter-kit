import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface InvestigationRun {
  runId: string;
  skillId: string;
  status: string;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  error: string | null;
  summary: {
    totalRecords: number;
    atRiskCount: number;
    criticalCount: number;
    warningCount: number;
  };
}

export interface HistoryPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface HistoryFilters {
  skillId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}

export function useInvestigationHistory(filters: HistoryFilters = {}, limit = 20) {
  const [runs, setRuns] = useState<InvestigationRun[]>([]);
  const [pagination, setPagination] = useState<HistoryPagination>({ total: 0, limit, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (filters.skillId) params.set('skill_id', filters.skillId);
      if (filters.status) params.set('status', filters.status);
      if (filters.fromDate) params.set('from_date', filters.fromDate);
      if (filters.toDate) params.set('to_date', filters.toDate);

      const data = await api.get(`/investigation/history?${params}`);
      setRuns(data.runs ?? []);
      setPagination(data.pagination ?? { total: 0, limit, offset });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filters.skillId, filters.status, filters.fromDate, filters.toDate, limit, offset]);

  useEffect(() => { fetch(); }, [fetch]);

  const setPage = useCallback((newOffset: number) => setOffset(newOffset), []);

  return { runs, pagination, loading, error, refetch: fetch, setPage, offset };
}

export interface TimelinePoint {
  timestamp: string;
  runId: string;
  totalRecords: number;
  atRiskCount: number;
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
  deltaFromPrevious: { newAtRisk: number; improved: number };
}

export interface TimelineSummary {
  totalRuns: number;
  averageAtRisk: number;
  trendDirection: 'improving' | 'worsening' | 'stable';
}

export function useInvestigationTimeline(skillId: string | undefined, days = 30) {
  const [points, setPoints] = useState<TimelinePoint[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skillId) { setPoints([]); setSummary(null); return; }
    setLoading(true);
    setError(null);
    api.get(`/investigation/timeline?skill_id=${skillId}&days=${days}`)
      .then((data: any) => {
        setPoints(data.points ?? []);
        setSummary(data.summary ?? null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [skillId, days]);

  return { points, summary, loading, error };
}

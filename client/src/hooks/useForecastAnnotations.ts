import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';

export interface ForecastAnnotation {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'positive' | 'info';
  actionability: 'immediate' | 'strategic' | 'monitor';
  title: string;
  body: string;
  impact: string | null;
  recommendation: string | null;
  anchor: AnnotationAnchor;
  evidence: {
    deal_ids: string[];
    deal_names: string[];
    metric_values: Record<string, number>;
    comparison_basis: string | null;
  };
  snapshot_date: string;
  dismissed_at: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export type AnnotationAnchor =
  | { type: 'chart'; week: number }
  | { type: 'metric'; metric: string }
  | { type: 'deal'; deal_id: string; deal_name: string }
  | { type: 'rep'; rep_email: string; rep_name: string }
  | { type: 'coverage'; period: string }
  | { type: 'global' };

interface AnnotationsResponse {
  annotations: ForecastAnnotation[];
  total_generated: number;
  total_active: number;
  snapshot_date: string | null;
}

export function useForecastAnnotations(workspaceId: string, period?: string) {
  const [annotations, setAnnotations] = useState<ForecastAnnotation[]>([]);
  const [metadata, setMetadata] = useState<{
    total_generated: number;
    total_active: number;
    snapshot_date: string | null;
  }>({
    total_generated: 0,
    total_active: 0,
    snapshot_date: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnnotations = async () => {
      try {
        setLoading(true);
        setError(null);

        const params = period ? `?period=${period}` : '';
        const data: AnnotationsResponse = await api.get(
          `/forecast/annotations${params}`
        );

        setAnnotations(data.annotations || []);
        setMetadata({
          total_generated: data.total_generated,
          total_active: data.total_active,
          snapshot_date: data.snapshot_date,
        });
      } catch (err) {
        console.error('Failed to load annotations:', err);
        setError(err instanceof Error ? err.message : 'Failed to load annotations');
        setAnnotations([]);
      } finally {
        setLoading(false);
      }
    };

    if (workspaceId) {
      fetchAnnotations();
    }
  }, [workspaceId, period]);

  const dismiss = async (annotationId: string) => {
    try {
      await api.patch(`/forecast/annotations/${annotationId}`, {
        action: 'dismiss',
      });

      // Optimistic update
      setAnnotations(prev => prev.filter(a => a.id !== annotationId));
      setMetadata(prev => ({ ...prev, total_active: prev.total_active - 1 }));
    } catch (err) {
      console.error('Failed to dismiss annotation:', err);
      throw err;
    }
  };

  const snooze = async (annotationId: string, weeks: 1 | 2) => {
    try {
      await api.patch(`/forecast/annotations/${annotationId}`, {
        action: `snooze_${weeks}w`,
      });

      // Optimistic update
      setAnnotations(prev => prev.filter(a => a.id !== annotationId));
      setMetadata(prev => ({ ...prev, total_active: prev.total_active - 1 }));
    } catch (err) {
      console.error('Failed to snooze annotation:', err);
      throw err;
    }
  };

  const reactivate = async (annotationId: string) => {
    try {
      await api.patch(`/forecast/annotations/${annotationId}`, {
        action: 'reactivate',
      });

      // Note: We don't add it back optimistically because we'd need to fetch
      // the full annotation data. User will see it on next refresh or skill run.
    } catch (err) {
      console.error('Failed to reactivate annotation:', err);
      throw err;
    }
  };

  // Group annotations by anchor type for easier rendering
  const grouped = useMemo(
    () => ({
      chart: annotations.filter(a => a.anchor.type === 'chart'),
      deals: annotations.filter(a => a.anchor.type === 'deal'),
      reps: annotations.filter(a => a.anchor.type === 'rep'),
      coverage: annotations.filter(a => a.anchor.type === 'coverage'),
      metrics: annotations.filter(a => a.anchor.type === 'metric'),
      global: annotations.filter(a => a.anchor.type === 'global'),
    }),
    [annotations]
  );

  // Group by severity for priority display
  const bySeverity = useMemo(
    () => ({
      critical: annotations.filter(a => a.severity === 'critical'),
      warning: annotations.filter(a => a.severity === 'warning'),
      positive: annotations.filter(a => a.severity === 'positive'),
      info: annotations.filter(a => a.severity === 'info'),
    }),
    [annotations]
  );

  return {
    annotations,
    grouped,
    bySeverity,
    metadata,
    loading,
    error,
    dismiss,
    snooze,
    reactivate,
  };
}

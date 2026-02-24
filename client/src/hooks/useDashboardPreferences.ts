import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface SectionConfig {
  visible: boolean;
  collapsed: boolean;
}

export interface DashboardPreferences {
  sections_config: {
    metrics: SectionConfig;
    pipeline: SectionConfig;
    actions_signals: SectionConfig;
    findings: SectionConfig;
  };
  metric_cards: {
    total_pipeline: boolean;
    weighted_pipeline: boolean;
    coverage_ratio: boolean;
    win_rate: boolean;
    open_deals: boolean;
    monte_carlo_p50: boolean;
  };
  pipeline_viz_mode: 'horizontal_bars' | 'funnel' | 'kanban' | 'table';
  monte_carlo_overlay: boolean;
  default_time_range: 'today' | 'this_week' | 'this_month' | 'this_quarter';
  updated_at?: string;
}

const DEFAULT_PREFERENCES: DashboardPreferences = {
  sections_config: {
    metrics: { visible: true, collapsed: false },
    pipeline: { visible: true, collapsed: false },
    actions_signals: { visible: true, collapsed: false },
    findings: { visible: true, collapsed: false },
  },
  metric_cards: {
    total_pipeline: true,
    weighted_pipeline: true,
    coverage_ratio: true,
    win_rate: true,
    open_deals: true,
    monte_carlo_p50: false,
  },
  pipeline_viz_mode: 'horizontal_bars',
  monte_carlo_overlay: false,
  default_time_range: 'this_week',
};

export function useDashboardPreferences() {
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await api.get('/dashboard/preferences');
      setPreferences(data);
    } catch (err: any) {
      console.error('Failed to fetch dashboard preferences:', err);
      setError(err.message || 'Failed to fetch preferences');
      // Use defaults on error
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const updatePreferences = useCallback(async (updates: Partial<DashboardPreferences>) => {
    try {
      setUpdating(true);
      setError(null);

      const updatedPrefs = await api.put('/dashboard/preferences', updates);

      // Merge the updates into current preferences
      setPreferences(prev => ({
        ...prev,
        ...updatedPrefs,
      }));
    } catch (err: any) {
      console.error('Failed to update dashboard preferences:', err);
      setError(err.message || 'Failed to update preferences');
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  const updateSection = useCallback((sectionId: keyof DashboardPreferences['sections_config'], updates: Partial<SectionConfig>) => {
    const newConfig = {
      ...preferences.sections_config[sectionId],
      ...updates,
    };
    return updatePreferences({
      sections_config: {
        ...preferences.sections_config,
        [sectionId]: newConfig,
      },
    });
  }, [preferences.sections_config, updatePreferences]);

  const toggleMetricCard = useCallback((cardId: keyof DashboardPreferences['metric_cards'], visible: boolean) => {
    return updatePreferences({
      metric_cards: {
        ...preferences.metric_cards,
        [cardId]: visible,
      },
    });
  }, [preferences.metric_cards, updatePreferences]);

  const setVizMode = useCallback((mode: DashboardPreferences['pipeline_viz_mode']) => {
    return updatePreferences({ pipeline_viz_mode: mode });
  }, [updatePreferences]);

  const setTimeRange = useCallback((range: DashboardPreferences['default_time_range']) => {
    return updatePreferences({ default_time_range: range });
  }, [updatePreferences]);

  return {
    preferences,
    loading,
    updating,
    error,
    refetch: fetchPreferences,
    updatePreferences,
    updateSection,
    toggleMetricCard,
    setVizMode,
    setTimeRange,
  };
}

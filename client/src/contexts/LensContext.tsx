import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, setActiveLens, getWorkspaceId } from '../lib/api';

interface NamedFilter {
  id: string;
  label: string;
  description?: string;
  entity_type: string;
  object?: string;
  source?: string;
}

interface LensContextValue {
  activeLens: string | null;
  setLens: (lensId: string | null) => void;
  filters: NamedFilter[];
  loading: boolean;
  refreshFilters: () => void;
}

const LensContext = createContext<LensContextValue>({
  activeLens: null,
  setLens: () => {},
  filters: [],
  loading: false,
  refreshFilters: () => {},
});

export function useLens() {
  return useContext(LensContext);
}

export function LensProvider({ children }: { children: ReactNode }) {
  const [activeLensId, setActiveLensId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('pandora_lens') || null;
    } catch {
      return null;
    }
  });
  const [filters, setFilters] = useState<NamedFilter[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFilters = useCallback(async () => {
    if (!getWorkspaceId()) return;
    setLoading(true);
    try {
      const res = await api.get('/filters');
      const raw = res.filters || res.data || res || [];
      const list = Array.isArray(raw) ? raw : [];
      setFilters(list.map((f: any) => ({
        ...f,
        entity_type: f.entity_type || f.object || 'deals',
      })));
    } catch {
      setFilters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFilters();
    const retryTimeout = setTimeout(() => {
      if (getWorkspaceId()) fetchFilters();
    }, 3000);
    return () => clearTimeout(retryTimeout);
  }, [fetchFilters]);

  const setLens = useCallback((lensId: string | null) => {
    setActiveLensId(lensId);
    setActiveLens(lensId);
    try {
      if (lensId) {
        sessionStorage.setItem('pandora_lens', lensId);
      } else {
        sessionStorage.removeItem('pandora_lens');
      }
    } catch {}
  }, []);

  useEffect(() => {
    setActiveLens(activeLensId);
  }, [activeLensId]);

  return (
    <LensContext.Provider value={{ activeLens: activeLensId, setLens, filters, loading, refreshFilters: fetchFilters }}>
      {children}
    </LensContext.Provider>
  );
}

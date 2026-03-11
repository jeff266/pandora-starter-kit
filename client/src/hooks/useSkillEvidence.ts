import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import type { EvidenceRow } from '../lib/askPandora';

export function useSkillEvidence(skillRunId?: string): {
  evidenceRows: EvidenceRow[];
  loading: boolean;
} {
  const { currentWorkspace } = useWorkspace();
  const [evidenceRows, setEvidenceRows] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!skillRunId || !currentWorkspace?.id) return;

    let cancelled = false;
    setLoading(true);

    api
      .get(`/skill-runs/${skillRunId}/evidence`)
      .then((data: { rows: EvidenceRow[] }) => {
        if (!cancelled) setEvidenceRows(data.rows || []);
      })
      .catch(() => {
        if (!cancelled) setEvidenceRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [skillRunId, currentWorkspace?.id]);

  return { evidenceRows, loading };
}

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from './WorkspaceContext';

export type PandoraRole = 'cro' | 'manager' | 'ae' | 'revops' | 'admin' | null;

interface PandoraRoleContextType {
  pandoraRole: PandoraRole;
  setPandoraRole: (r: PandoraRole) => void;
}

const PandoraRoleContext = createContext<PandoraRoleContextType>({
  pandoraRole: null,
  setPandoraRole: () => {},
});

export function usePandoraRole() {
  return useContext(PandoraRoleContext);
}

export function PandoraRoleProvider({ children }: { children: React.ReactNode }) {
  const { currentWorkspace, isAuthenticated } = useWorkspace();
  const [pandoraRole, setPandoraRole] = useState<PandoraRole>(() => {
    try {
      return (localStorage.getItem('pandora_role') as PandoraRole) || null;
    } catch { return null; }
  });

  const fetchRole = useCallback(async () => {
    if (!currentWorkspace?.id || !isAuthenticated) return;
    try {
      const data = await api.get('/briefing/concierge');
      const role = (data?.user?.pandoraRole ?? null) as PandoraRole;
      setPandoraRole(role);
      try { if (role) localStorage.setItem('pandora_role', role); } catch {}
    } catch {}
  }, [currentWorkspace?.id, isAuthenticated]);

  useEffect(() => {
    fetchRole();
  }, [fetchRole]);

  return (
    <PandoraRoleContext.Provider value={{ pandoraRole, setPandoraRole }}>
      {children}
    </PandoraRoleContext.Provider>
  );
}

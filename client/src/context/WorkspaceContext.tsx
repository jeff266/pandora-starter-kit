import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { verifyWorkspace, setApiCredentials } from '../lib/api';

interface WorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  apiKey: string;
}

interface WorkspaceContextType {
  workspace: WorkspaceInfo | null;
  setWorkspace: (info: WorkspaceInfo) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  setWorkspace: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(() => {
    const stored = localStorage.getItem('pandora_workspace');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.workspaceId && parsed?.apiKey) {
          setApiCredentials(parsed.workspaceId, parsed.apiKey);
          return parsed;
        }
      } catch { /* ignore */ }
    }
    return null;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wsId = params.get('workspace');
    const key = params.get('key');
    if (wsId && key) {
      window.history.replaceState({}, '', window.location.pathname);
      verifyWorkspace(wsId, key).then(({ name }) => {
        setApiCredentials(wsId, key);
        setWorkspace({ workspaceId: wsId, workspaceName: name, apiKey: key });
      }).catch(() => {
        console.warn('[WorkspaceContext] Auto-login failed — invalid workspace or key');
      });
    }
  }, []);

  const setWorkspace = useCallback((info: WorkspaceInfo) => {
    setWorkspaceState(info);
    localStorage.setItem('pandora_workspace', JSON.stringify(info));
  }, []);

  const logout = useCallback(() => {
    setWorkspaceState(null);
    localStorage.removeItem('pandora_workspace');
  }, []);

  return (
    <WorkspaceContext.Provider value={{
      workspace,
      setWorkspace,
      logout,
      isAuthenticated: workspace !== null,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

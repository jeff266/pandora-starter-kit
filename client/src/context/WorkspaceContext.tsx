import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member' | 'viewer';
  connector_count: number;
  deal_count: number;
  last_sync: string | null;
}

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface WorkspaceContextType extends AuthState {
  login: (email: string, name?: string) => Promise<{ status: string; message: string }>;
  handleCallback: (sessionToken: string) => Promise<void>;
  logout: () => Promise<void>;
  selectWorkspace: (workspace: WorkspaceInfo) => void;
  joinWorkspace: (apiKey: string) => Promise<WorkspaceInfo>;
  refreshAuth: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  user: null,
  token: null,
  workspaces: [],
  currentWorkspace: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ status: '', message: '' }),
  handleCallback: async () => {},
  logout: async () => {},
  selectWorkspace: () => {},
  joinWorkspace: async () => ({} as WorkspaceInfo),
  refreshAuth: async () => {},
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

async function fetchMe(token: string) {
  const res = await fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Session invalid');
  return res.json();
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    workspaces: [],
    currentWorkspace: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const loadSession = useCallback(async (sessionToken: string) => {
    try {
      const data = await fetchMe(sessionToken);
      const lastWsId = localStorage.getItem('pandora_last_workspace');
      let selected: WorkspaceInfo | null = null;

      if (data.workspaces.length === 1) {
        selected = data.workspaces[0];
      } else if (lastWsId) {
        selected = data.workspaces.find((w: WorkspaceInfo) => w.id === lastWsId) || null;
      }

      setState({
        user: data.user,
        token: sessionToken,
        workspaces: data.workspaces,
        currentWorkspace: selected,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      localStorage.removeItem('pandora_session');
      localStorage.removeItem('pandora_last_workspace');
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const devSession = params.get('dev_session');
    const devWorkspace = params.get('dev_workspace');
    if (devSession) {
      localStorage.setItem('pandora_session', devSession);
      if (devWorkspace) localStorage.setItem('pandora_last_workspace', devWorkspace);
      window.history.replaceState({}, '', window.location.pathname);
      loadSession(devSession);
      return;
    }
    const stored = localStorage.getItem('pandora_session');
    if (stored) {
      loadSession(stored);
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [loadSession]);

  const login = useCallback(async (email: string, name?: string) => {
    const body: Record<string, string> = { email };
    if (name) body.name = name;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Login failed');
    return res.json();
  }, []);

  const handleCallback = useCallback(async (sessionToken: string) => {
    localStorage.setItem('pandora_session', sessionToken);
    await loadSession(sessionToken);
  }, [loadSession]);

  const logout = useCallback(async () => {
    const token = state.token;
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch {}
    }
    localStorage.removeItem('pandora_session');
    localStorage.removeItem('pandora_last_workspace');
    setState({
      user: null, token: null, workspaces: [], currentWorkspace: null,
      isAuthenticated: false, isLoading: false,
    });
  }, [state.token]);

  const selectWorkspace = useCallback((workspace: WorkspaceInfo) => {
    localStorage.setItem('pandora_last_workspace', workspace.id);
    setState(prev => ({ ...prev, currentWorkspace: workspace }));
  }, []);

  const joinWorkspace = useCallback(async (apiKey: string): Promise<WorkspaceInfo> => {
    const res = await fetch('/api/auth/workspaces/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to join workspace');
    }
    const ws = await res.json();
    const newWs: WorkspaceInfo = {
      id: ws.id, name: ws.name, slug: ws.slug, role: ws.role,
      connector_count: 0, deal_count: 0, last_sync: null,
    };
    setState(prev => ({
      ...prev,
      workspaces: [...prev.workspaces, newWs],
      currentWorkspace: newWs,
    }));
    localStorage.setItem('pandora_last_workspace', newWs.id);
    return newWs;
  }, [state.token]);

  const refreshAuth = useCallback(async () => {
    if (state.token) {
      await loadSession(state.token);
    }
  }, [state.token, loadSession]);

  return (
    <WorkspaceContext.Provider value={{
      ...state,
      login,
      handleCallback,
      logout,
      selectWorkspace,
      joinWorkspace,
      refreshAuth,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

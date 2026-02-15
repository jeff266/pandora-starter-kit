import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, setSessionToken, setCurrentWorkspace } from '../lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
  connector_count: number;
  deal_count: number;
  last_sync: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
  switchWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  workspaces: [],
  currentWorkspace: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
  switchWorkspace: () => {},
  refreshWorkspaces: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspaceState] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const selectWorkspace = useCallback((ws: Workspace) => {
    setCurrentWorkspaceState(ws);
    setCurrentWorkspace(ws.id);
    localStorage.setItem('pandora_last_workspace', ws.id);
  }, []);

  const autoSelectWorkspace = useCallback((wsList: Workspace[]) => {
    if (wsList.length === 1) {
      selectWorkspace(wsList[0]);
    } else if (wsList.length > 1) {
      const lastId = localStorage.getItem('pandora_last_workspace');
      if (lastId) {
        const found = wsList.find(w => w.id === lastId);
        if (found) {
          selectWorkspace(found);
        }
      }
    }
  }, [selectWorkspace]);

  const fetchMe = useCallback(async (sessionToken: string) => {
    setSessionToken(sessionToken);
    try {
      const data = await authApi.me();
      setUser(data.user);
      setWorkspaces(data.workspaces || []);
      setToken(sessionToken);
      autoSelectWorkspace(data.workspaces || []);
    } catch {
      localStorage.removeItem('pandora_session');
      setSessionToken('');
      setToken(null);
      setUser(null);
      setWorkspaces([]);
    }
  }, [autoSelectWorkspace]);

  useEffect(() => {
    const stored = localStorage.getItem('pandora_session');
    if (stored) {
      fetchMe(stored).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((newToken: string) => {
    localStorage.setItem('pandora_session', newToken);
    setSessionToken(newToken);
    setToken(newToken);
    fetchMe(newToken);
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {}
    localStorage.removeItem('pandora_session');
    localStorage.removeItem('pandora_last_workspace');
    setSessionToken('');
    setCurrentWorkspace('');
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspaceState(null);
  }, []);

  const switchWorkspace = useCallback((workspaceId: string) => {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (ws) {
      selectWorkspace(ws);
      navigate('/');
    }
  }, [workspaces, selectWorkspace, navigate]);

  const refreshWorkspaces = useCallback(async () => {
    if (!token) return;
    try {
      const data = await authApi.me();
      setWorkspaces(data.workspaces || []);
      if (data.workspaces?.length === 1 && !currentWorkspace) {
        selectWorkspace(data.workspaces[0]);
      }
    } catch {}
  }, [token, currentWorkspace, selectWorkspace]);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      workspaces,
      currentWorkspace,
      isAuthenticated: user !== null && token !== null,
      isLoading,
      login,
      logout,
      switchWorkspace,
      refreshWorkspaces,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

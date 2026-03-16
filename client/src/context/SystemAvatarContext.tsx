import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getWorkspaceId } from '../lib/api';

const PANDORA_DEFAULT = '/avatars/char-14.png';
const BULL_DEFAULT    = '/avatars/char-15.png';
const BEAR_DEFAULT    = '/avatars/char-08.png';

interface SystemAvatarContextType {
  pandoraSrc: string;
  bullSrc: string;
  bearSrc: string;
  updateAvatar: (role: 'pandora' | 'bull' | 'bear', src: string) => Promise<void>;
}

const SystemAvatarContext = createContext<SystemAvatarContextType>({
  pandoraSrc: PANDORA_DEFAULT,
  bullSrc: BULL_DEFAULT,
  bearSrc: BEAR_DEFAULT,
  updateAvatar: async () => {},
});

export function useSystemAvatars() {
  return useContext(SystemAvatarContext);
}

export function SystemAvatarProvider({ children }: { children: React.ReactNode }) {
  const [pandoraSrc, setPandoraSrc] = useState(PANDORA_DEFAULT);
  const [bullSrc, setBullSrc]       = useState(BULL_DEFAULT);
  const [bearSrc, setBearSrc]       = useState(BEAR_DEFAULT);

  useEffect(() => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;
    api.get(`/workspaces/${workspaceId}/workspace-config`)
      .then((res: any) => {
        const sa = res?.config?.system_avatars;
        if (!sa) return;
        if (sa.pandora) setPandoraSrc(sa.pandora);
        if (sa.bull)    setBullSrc(sa.bull);
        if (sa.bear)    setBearSrc(sa.bear);
      })
      .catch(() => {});
  }, []);

  const updateAvatar = useCallback(async (role: 'pandora' | 'bull' | 'bear', src: string) => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;
    if (role === 'pandora') setPandoraSrc(src);
    if (role === 'bull')    setBullSrc(src);
    if (role === 'bear')    setBearSrc(src);
    await api.patch(`/workspaces/${workspaceId}/workspace-config/system_avatars`, { [role]: src });
  }, []);

  return (
    <SystemAvatarContext.Provider value={{ pandoraSrc, bullSrc, bearSrc, updateAvatar }}>
      {children}
    </SystemAvatarContext.Provider>
  );
}

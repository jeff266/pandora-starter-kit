import React, { createContext, useContext, useState, useMemo } from 'react';
import { anonymizer } from '../lib/anonymize';

interface DemoModeContextType {
  isDemoMode: boolean;
  toggleDemoMode: () => void;
  anon: {
    company: (name: string) => string;
    person: (name: string) => string;
    email: (email: string) => string;
    deal: (name: string) => string;
    amount: (value: number) => number;
    workspace: (name: string) => string;
    text: (text: string) => string;
  };
}

const passthrough = {
  company: (n: string) => n,
  person: (n: string) => n,
  email: (e: string) => e,
  deal: (n: string) => n,
  amount: (v: number) => v,
  workspace: (n: string) => n,
  text: (t: string) => t,
};

const DemoModeContext = createContext<DemoModeContextType>({
  isDemoMode: false,
  toggleDemoMode: () => {},
  anon: passthrough,
});

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(() => {
    return localStorage.getItem('pandora_demo_mode') === 'true';
  });

  const toggleDemoMode = () => {
    const next = !isDemoMode;
    setIsDemoMode(next);
    localStorage.setItem('pandora_demo_mode', next ? 'true' : 'false');
    if (next) anonymizer.reset();
  };

  const anon = useMemo(() => {
    if (!isDemoMode) return passthrough;
    return {
      company: (n: string) => anonymizer.anonymizeCompany(n),
      person: (n: string) => anonymizer.anonymizePerson(n),
      email: (e: string) => anonymizer.anonymizeEmail(e),
      deal: (n: string) => anonymizer.anonymizeDeal(n),
      amount: (v: number) => anonymizer.anonymizeAmount(v),
      workspace: (n: string) => anonymizer.anonymizeWorkspace(n),
      text: (t: string) => anonymizer.anonymizeText(t),
    };
  }, [isDemoMode]);

  return (
    <DemoModeContext.Provider value={{ isDemoMode, toggleDemoMode, anon }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}

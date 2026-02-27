import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { anonymizer } from '../lib/anonymize';
import { api } from '../lib/api';

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
    pipeline: (name: string) => string;
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
  pipeline: (n: string) => n,
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

  const seedAnonymizer = async () => {
    try {
      const data = await api.get('/demo/entity-names');
      // Pre-seed mappings by calling anonymize methods
      data.companies?.forEach((name: string) => anonymizer.anonymizeCompany(name));
      data.deals?.forEach((name: string) => anonymizer.anonymizeDeal(name));
      data.persons?.forEach((name: string) => anonymizer.anonymizePerson(name));
    } catch (err) {
      console.error('[DemoMode] Failed to seed anonymizer:', err);
    }
  };

  const toggleDemoMode = () => {
    const next = !isDemoMode;
    setIsDemoMode(next);
    localStorage.setItem('pandora_demo_mode', next ? 'true' : 'false');
    if (next) {
      anonymizer.reset();
      seedAnonymizer();
    }
  };

  // Pre-seed on mount if demo mode is already on
  useEffect(() => {
    if (isDemoMode) {
      seedAnonymizer();
    }
  }, []);

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
      pipeline: (n: string) => anonymizer.anonymizeCompany(n),
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

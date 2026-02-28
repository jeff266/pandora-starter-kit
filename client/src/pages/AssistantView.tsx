import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import { colors } from '../styles/theme';
import Greeting from '../components/assistant/Greeting';
import QuickActionPills from '../components/assistant/QuickActionPills';
import MorningBrief from '../components/assistant/MorningBrief';
import OperatorStrip from '../components/assistant/OperatorStrip';
import StickyInput from '../components/assistant/StickyInput';
import ConversationView from '../components/assistant/ConversationView';

type ViewMode = 'home' | 'conversation';

export default function AssistantView() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id || '';

  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);

  const [greeting, setGreeting] = useState<any>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);

  const [brief, setBrief] = useState<any[] | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);

  const [operators, setOperators] = useState<any[] | null>(null);
  const [operatorsLoading, setOperatorsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!wsId) return;
    setGreetingLoading(true);
    setBriefLoading(true);
    setOperatorsLoading(true);

    const [greetRes, briefRes, opsRes] = await Promise.allSettled([
      api.get(`/briefing/greeting?localHour=${new Date().getHours()}`),
      api.get('/briefing/brief'),
      api.get('/briefing/operators'),
    ]);

    if (greetRes.status === 'fulfilled') setGreeting(greetRes.value);
    setGreetingLoading(false);

    if (briefRes.status === 'fulfilled') setBrief(Array.isArray(briefRes.value) ? briefRes.value : []);
    setBriefLoading(false);

    if (opsRes.status === 'fulfilled') setOperators(Array.isArray(opsRes.value) ? opsRes.value : []);
    setOperatorsLoading(false);
  }, [wsId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const onFocus = () => fetchAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchAll]);

  const handleSend = useCallback((text: string) => {
    setInitialMessage(text);
    setViewMode('conversation');
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('home');
    setInitialMessage(undefined);
  }, []);

  if (viewMode === 'conversation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <ConversationView initialMessage={initialMessage} onBack={handleBack} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <Greeting data={greeting} loading={greetingLoading} />
        <QuickActionPills onSend={handleSend} />
        <MorningBrief
          items={brief ?? undefined}
          loading={briefLoading}
          onItemClick={(item) => handleSend(item.headline)}
        />
        <OperatorStrip
          operators={operators ?? undefined}
          loading={operatorsLoading}
          onOperatorClick={(operatorName) => handleSend(`Give me the latest ${operatorName}`)}
        />
      </div>
      <StickyInput onSend={handleSend} />
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useWorkspace } from './context/WorkspaceContext';
import { setApiCredentials, api } from './lib/api';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Placeholder from './components/Placeholder';
import ChatPanel from './components/ChatPanel';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import WorkspacePicker from './pages/WorkspacePicker';
import JoinWorkspace from './pages/JoinWorkspace';
import MembersPage from './pages/MembersPage';
import CommandCenter from './pages/CommandCenter';
import DealDetail from './pages/DealDetail';
import AccountDetail from './pages/AccountDetail';
import DealList from './pages/DealList';
import AccountList from './pages/AccountList';
import SkillsPage from './pages/SkillsPage';
import SkillRunsPage from './pages/SkillRunsPage';
import ConnectorsPage from './pages/ConnectorsPage';
import InsightsPage from './pages/InsightsPage';
import Actions from './pages/Actions';
import Playbooks from './pages/Playbooks';
import SettingsPage from './pages/SettingsPage';
import ConnectorHealth from './pages/ConnectorHealth';
import { colors, fonts } from './styles/theme';

const pageTitles: Record<string, string> = {
  '/': 'Command Center',
  '/deals': 'Open Deals',
  '/accounts': 'Accounts',
  '/agents': 'Agents',
  '/agent-builder': 'Agent Builder',
  '/skills': 'Skills',
  '/tools': 'Tools',
  '/playbooks': 'Playbooks',
  '/insights': 'Insights Feed',
  '/actions': 'Actions',
  '/connectors': 'Connectors',
  '/connectors/health': 'Connector Health',
  '/data-dictionary': 'Data Dictionary',
  '/members': 'Members',
  '/marketplace': 'Marketplace',
  '/settings': 'Settings',
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/deals/')) return 'Deal Detail';
  if (pathname.startsWith('/accounts/')) return 'Account Detail';
  if (pathname.match(/^\/skills\/[^/]+\/runs/)) return 'Skill Run History';
  return pageTitles[pathname] || 'Pandora';
}

export default function App() {
  const { token, isAuthenticated, isLoading, workspaces, currentWorkspace } = useWorkspace();
  const location = useLocation();
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<{ type: string; entity_id?: string; entity_name?: string; rep_email?: string } | undefined>(undefined);

  useEffect(() => {
    if (token && currentWorkspace) {
      setApiCredentials(currentWorkspace.id, token);
    }
  }, [token, currentWorkspace]);

  const fetchBadges = useCallback(async () => {
    if (!currentWorkspace) return;
    try {
      const [skillsRes, findingsRes, actionsRes] = await Promise.allSettled([
        api.get('/skills'),
        api.get('/findings/summary'),
        api.get('/action-items/summary'),
      ]);
      const newBadges: Record<string, number> = {};
      if (skillsRes.status === 'fulfilled') {
        const skills = Array.isArray(skillsRes.value) ? skillsRes.value : skillsRes.value?.skills || [];
        newBadges['skills'] = skills.length;
      }
      if (findingsRes.status === 'fulfilled') {
        const summary = findingsRes.value;
        newBadges['insights feed'] = summary?.total_active || 0;
      }
      if (actionsRes.status === 'fulfilled') {
        const actionSummary = actionsRes.value;
        newBadges['actions'] = Number(actionSummary?.open_total) || 0;
      }
      setBadges(newBadges);
      setLastRefreshed(new Date());
    } catch {}
  }, [currentWorkspace]);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, [fetchBadges]);

  if (location.pathname === '/auth/callback') {
    return <AuthCallback />;
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${colors.border}`, borderTopColor: colors.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ fontSize: 14, color: colors.textSecondary }}>Loading...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (workspaces.length === 0) {
    return (
      <Routes>
        <Route path="*" element={<JoinWorkspace />} />
      </Routes>
    );
  }

  if (currentWorkspace === null && workspaces.length > 1) {
    return (
      <Routes>
        <Route path="/join" element={<JoinWorkspace />} />
        <Route path="*" element={<WorkspacePicker />} />
      </Routes>
    );
  }

  const title = getPageTitle(location.pathname);

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      <Sidebar badges={badges} />
      <main style={{ marginLeft: 220, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} lastRefreshed={lastRefreshed} onRefresh={fetchBadges} />
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/deals" element={<DealList />} />
            <Route path="/deals/:dealId" element={<DealDetail />} />
            <Route path="/accounts" element={<AccountList />} />
            <Route path="/accounts/:accountId" element={<AccountDetail />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/skills/:skillId/runs" element={<SkillRunsPage />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/join" element={<JoinWorkspace />} />
            <Route path="/agents" element={<Placeholder title="Agents" />} />
            <Route path="/agent-builder" element={<Placeholder title="Agent Builder" />} />
            <Route path="/tools" element={<Placeholder title="Tools" />} />
            <Route path="/playbooks" element={<Playbooks />} />
            <Route path="/actions" element={<Actions />} />
            <Route path="/connectors/health" element={<ConnectorHealth />} />
            <Route path="/data-dictionary" element={<Placeholder title="Data Dictionary" />} />
            <Route path="/marketplace" element={<Placeholder title="Marketplace" />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
      {!chatOpen && (
        <button
          onClick={() => { setChatScope(undefined); setChatOpen(true); }}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: '#6488ea',
            color: '#fff',
            border: 'none',
            fontSize: 22,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(100,136,234,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            transition: 'transform 0.15s',
          }}
          title="Ask Pandora"
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          💬
        </button>
      )}
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        scope={chatScope}
      />
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

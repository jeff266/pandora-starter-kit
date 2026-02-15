import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useWorkspace } from './context/WorkspaceContext';
import { setApiCredentials, api } from './lib/api';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Placeholder from './components/Placeholder';
import LoginPage from './pages/LoginPage';
import CommandCenter from './pages/CommandCenter';
import DealDetail from './pages/DealDetail';
import AccountDetail from './pages/AccountDetail';
import SkillsPage from './pages/SkillsPage';
import SkillRunsPage from './pages/SkillRunsPage';
import ConnectorsPage from './pages/ConnectorsPage';
import InsightsPage from './pages/InsightsPage';
import { colors } from './styles/theme';

const pageTitles: Record<string, string> = {
  '/': 'Command Center',
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
  '/users': 'Users & Teams',
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
  const { workspace, isAuthenticated } = useWorkspace();
  const location = useLocation();
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    if (workspace) {
      setApiCredentials(workspace.workspaceId, workspace.apiKey);
    }
  }, [workspace]);

  const fetchBadges = useCallback(async () => {
    if (!workspace) return;
    try {
      const [skillsRes, findingsRes] = await Promise.allSettled([
        api.get('/skills'),
        api.get('/findings/summary'),
      ]);
      const newBadges: Record<string, number> = {};
      if (skillsRes.status === 'fulfilled') {
        const skills = Array.isArray(skillsRes.value) ? skillsRes.value : skillsRes.value?.skills || [];
        newBadges['skills'] = skills.length;
      }
      if (findingsRes.status === 'fulfilled') {
        const summary = findingsRes.value;
        newBadges['actions'] = summary?.by_severity?.act || 0;
      }
      setBadges(newBadges);
      setLastRefreshed(new Date());
    } catch {}
  }, [workspace]);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, [fetchBadges]);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const title = getPageTitle(location.pathname);

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      <Sidebar badges={badges} />
      <main style={{
        marginLeft: 220,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <TopBar
          title={title}
          lastRefreshed={lastRefreshed}
        />
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 28px',
        }}>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/deals/:dealId" element={<DealDetail />} />
            <Route path="/accounts/:accountId" element={<AccountDetail />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/skills/:skillId/runs" element={<SkillRunsPage />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/agents" element={<Placeholder title="Agents" />} />
            <Route path="/agent-builder" element={<Placeholder title="Agent Builder" />} />
            <Route path="/tools" element={<Placeholder title="Tools" />} />
            <Route path="/playbooks" element={<Placeholder title="Playbooks" />} />
            <Route path="/actions" element={<Placeholder title="Actions" />} />
            <Route path="/connectors/health" element={<Placeholder title="Connector Health" />} />
            <Route path="/data-dictionary" element={<Placeholder title="Data Dictionary" />} />
            <Route path="/users" element={<Placeholder title="Users & Teams" />} />
            <Route path="/marketplace" element={<Placeholder title="Marketplace" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Routes>
        </div>
      </main>
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

import React, { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useWorkspace } from './context/WorkspaceContext';
import { useDemoMode } from './contexts/DemoModeContext';
import { setApiCredentials, api } from './lib/api';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Placeholder from './components/Placeholder';
import ChatPanel from './components/ChatPanel';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import PandoraHomepage from './pages/PandoraHomepage';
import WorkspacePicker from './pages/WorkspacePicker';
import JoinWorkspace from './pages/JoinWorkspace';
import MembersPage from './pages/MembersPage';
import CommandCenter from './pages/CommandCenter';
import DealDetail from './pages/DealDetail';
import AccountDetail from './pages/AccountDetail';
import DealList from './pages/DealList';
import AccountList from './pages/AccountList';
import ConversationsPage from './pages/ConversationsPage';
import ConversationDetail from './pages/ConversationDetail';
import SkillsPage from './pages/SkillsPage';
import SkillRunsPage from './pages/SkillRunsPage';
import ConnectorsPage from './pages/ConnectorsPage';
import EnrichmentConnectorsPage from './pages/EnrichmentConnectorsPage';
import MarketplacePage from './pages/MarketplacePage';
import InsightsPage from './pages/InsightsPage';
import Actions from './pages/Actions';
import Playbooks from './pages/Playbooks';
import SettingsPage from './pages/SettingsPage';
import ConnectorHealth from './pages/ConnectorHealth';
import ToolsPage from './pages/ToolsPage';
import PushPage from './pages/PushPage';
import ConsultantDashboard from './pages/ConsultantDashboard';
import IcpProfilePage from './pages/IcpProfilePage';
import AdminScopesPage from './pages/AdminScopesPage';
import TokenUsagePage from './pages/admin/TokenUsagePage';
import Targets from './pages/Targets';
import ReportViewer from './pages/ReportViewer';
import ReportsPage from './pages/ReportsPage';
import ReportBuilder from './pages/ReportBuilder';
import AgentBuilder from './pages/AgentBuilder';
import FiltersPage from './pages/FiltersPage';
import SQLWorkspace from './pages/SQLWorkspace';
import ForecastPage from './pages/ForecastPage';
import { colors, fonts } from './styles/theme';
import { useIsMobile } from './hooks/useIsMobile';

const pageTitles: Record<string, string> = {
  '/': 'Command Center',
  '/portfolio': 'All Clients',
  '/deals': 'Open Deals',
  '/accounts': 'Accounts',
  '/conversations': 'Conversations',
  '/targets': 'Targets',
  '/agents': 'Agents',
  '/agent-builder': 'Agent Builder',
  '/skills': 'Skills',
  '/tools': 'Tools',
  '/playbooks': 'Playbooks',
  '/push': 'Push',
  '/insights': 'Insights Feed',
  '/actions': 'Actions',
  '/reports': 'Reports',
  '/connectors': 'Connectors',
  '/connectors/health': 'Connector Health',
  '/enrichment': 'Enrichment Connectors',
  '/filters': 'Named Filters',
  '/data-dictionary': 'Data Dictionary',
  '/sql-workspace': 'SQL Workspace',
  '/members': 'Members',
  '/marketplace': 'Marketplace',
  '/settings': 'Settings',
  '/icp-profile': 'ICP Profile',
  '/admin/scopes': 'Workspace Scopes',
  '/admin/token-usage': 'Token Usage',
  '/forecast': 'Forecast',
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/deals/')) return 'Deal Detail';
  if (pathname.startsWith('/accounts/')) return 'Account Detail';
  if (pathname.match(/^\/skills\/[^/]+\/runs/)) return 'Skill Run History';
  if (pathname.match(/^\/workspace\/[^/]+\/reports\//)) return 'Report';
  if (pathname === '/reports/new') return 'New Report';
  if (pathname.match(/^\/reports\/[^/]+\/edit/)) return 'Edit Report';
  return pageTitles[pathname] || 'Pandora';
}

function DemoModeBanner() {
  const { isDemoMode } = useDemoMode();
  if (!isDemoMode) return null;
  return (
    <div style={{
      background: colors.purpleSoft,
      color: colors.purple,
      textAlign: 'center',
      padding: '6px 16px',
      fontSize: 12,
      fontWeight: 500,
      fontFamily: fonts.sans,
      flexShrink: 0,
    }}>
      {'\uD83C\uDFAD'} Demo Mode — All names and values are anonymized
    </div>
  );
}

export default function App() {
  const { token, isAuthenticated, isLoading, workspaces, currentWorkspace } = useWorkspace();
  const location = useLocation();
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<{ type: string; entity_id?: string; entity_name?: string; rep_email?: string } | undefined>(undefined);
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  const pageContext = useMemo(() => {
    const path = location.pathname;
    const dealMatch = path.match(/\/deals\/([a-f0-9-]+)$/i);
    if (dealMatch) return { type: 'deal', entity_id: dealMatch[1] } as const;
    const accountMatch = path.match(/\/accounts\/([a-f0-9-]+)$/i);
    if (accountMatch) return { type: 'account', entity_id: accountMatch[1] } as const;
    return null;
  }, [location.pathname]);

  useEffect(() => {
    if (token && currentWorkspace) {
      setApiCredentials(currentWorkspace.id, token);
    }
  }, [token, currentWorkspace]);

  const fetchBadges = useCallback(async () => {
    if (!currentWorkspace) return;
    try {
      const [skillsRes, findingsRes, actionsRes, gapRes, conversationsRes] = await Promise.allSettled([
        api.get('/skills'),
        api.get('/findings/summary'),
        api.get('/action-items/summary'),
        api.get('/targets/gap'),
        api.get('/conversations/next-action-gaps'),
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
      if (gapRes.status === 'fulfilled' && gapRes.value?.gap_status) {
        // Encode target status as number: 1=on_track(green), 2=at_risk(amber), 3=critical(red), 4=achieved(green)
        const statusMap: Record<string, number> = { 'on_track': 1, 'at_risk': 2, 'critical': 3, 'achieved': 4 };
        newBadges['targets'] = statusMap[gapRes.value.gap_status] || 0;
      }
      if (conversationsRes.status === 'fulfilled') {
        const gaps = conversationsRes.value?.summary;
        newBadges['conversations'] = gaps?.critical_count || 0;
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
    if (location.pathname === '/login') {
      return <LoginPage />;
    }
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<PandoraHomepage />} />
      </Routes>
    );
  }

  if (location.pathname === '/login') {
    return <Navigate to="/" replace />;
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
  const hasMultipleWorkspaces = workspaces.length > 1;

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg }}>
      <Sidebar badges={badges} showAllClients={hasMultipleWorkspaces} collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
      <main style={{ marginLeft: isMobile ? 0 : (sidebarCollapsed ? 56 : 220), flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'margin-left 0.2s ease' }}>
        <DemoModeBanner />
        <TopBar title={title} lastRefreshed={lastRefreshed} onRefresh={fetchBadges} onMenuToggle={isMobile ? () => setMobileMenuOpen(true) : undefined} />
        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px 12px' : '24px 28px' }}>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/portfolio" element={<ConsultantDashboard />} />
            <Route path="/deals" element={<DealList />} />
            <Route path="/deals/:dealId" element={<DealDetail />} />
            <Route path="/conversations/:conversationId" element={<ConversationDetail />} />
            <Route path="/accounts" element={<AccountList />} />
            <Route path="/accounts/:accountId" element={<AccountDetail />} />
            <Route path="/conversations" element={<ConversationsPage />} />
            <Route path="/targets" element={<Targets />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/skills/:skillId/runs" element={<SkillRunsPage />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/enrichment" element={<EnrichmentConnectorsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/join" element={<JoinWorkspace />} />
            <Route path="/agents" element={<AgentBuilder />} />
            <Route path="/agent-builder" element={<AgentBuilder />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/playbooks" element={<Playbooks />} />
            <Route path="/push" element={<PushPage />} />
            <Route path="/actions" element={<Actions />} />
            <Route path="/connectors/health" element={<ConnectorHealth />} />
            <Route path="/filters" element={<FiltersPage />} />
            <Route path="/data-dictionary" element={<Placeholder title="Data Dictionary" />} />
            <Route path="/sql-workspace" element={<SQLWorkspace />} />
            <Route path="/forecast" element={<ForecastPage />} />
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:tab" element={<SettingsPage />} />
            <Route path="/icp-profile" element={<IcpProfilePage />} />
            <Route path="/admin/scopes" element={<AdminScopesPage />} />
            <Route path="/admin/token-usage" element={<TokenUsagePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/new" element={<ReportBuilder />} />
            <Route path="/reports/:reportId/edit" element={<ReportBuilder />} />
            <Route path="/workspace/:workspaceId/reports/:reportId" element={<ReportViewer />} />
            <Route path="/workspace/:workspaceId/reports/:reportId/generations/:generationId" element={<ReportViewer />} />
            <Route path="/workspace/:workspaceId/briefing/:generationId" element={<ReportViewer />} />
          </Routes>
        </div>
      </main>
      {!chatOpen && (
        <button
          onClick={() => {
            if (pageContext) {
              setChatScope({ type: pageContext.type, entity_id: pageContext.entity_id });
            } else {
              setChatScope(undefined);
            }
            setChatOpen(true);
          }}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            height: pageContext ? 'auto' : 52,
            width: pageContext ? 'auto' : 52,
            minWidth: 52,
            borderRadius: pageContext ? 26 : '50%',
            backgroundColor: '#6488ea',
            color: '#fff',
            border: 'none',
            fontSize: pageContext ? 13 : 22,
            fontWeight: pageContext ? 500 : undefined,
            padding: pageContext ? '0 16px 0 14px' : 0,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(100,136,234,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            zIndex: 999,
            transition: 'transform 0.15s',
          }}
          title={pageContext ? `Ask about this ${pageContext.type}` : 'Ask Pandora'}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>{'\uD83D\uDCAC'}</span>
          {pageContext && (
            <span>Ask about this {pageContext.type}</span>
          )}
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

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors } from '../styles/theme';
import Toast from '../components/Toast';
import { useWorkspace } from '../context/WorkspaceContext';
import ConnectorLogo from '../components/ConnectorLogo';

type ConnectorStatus = 'available' | 'coming_soon';

interface ConnectorDef {
  id: string;
  name: string;
  category: 'crm' | 'conversation' | 'productivity' | 'operations';
  description: string;
  status: ConnectorStatus;
  logo: string;
  authRoute?: string;
  authType?: 'oauth' | 'api_key';
}

const CONNECTOR_CATALOG: ConnectorDef[] = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    description: 'Sync deals, contacts, and companies. Powers pipeline analysis, forecasting, and data quality skills.',
    status: 'available',
    logo: 'https://cdn.simpleicons.org/hubspot/FF7A59',
    authRoute: '/api/auth/hubspot',
    authType: 'oauth',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    description: 'Sync opportunities, contacts, and accounts from any Salesforce org. Supports custom fields and stage history.',
    status: 'available',
    logo: 'https://cdn.simpleicons.org/salesforce/00A1E0',
    authRoute: '/api/auth/salesforce',
    authType: 'oauth',
  },
  {
    id: 'gong',
    name: 'Gong',
    category: 'conversation',
    description: 'Pull call transcripts, deal signals, and engagement data. Enables conversation intelligence skills.',
    status: 'available',
    logo: 'https://cdn.simpleicons.org/gong/EE5F3D',
    authRoute: '/api/connectors/gong/connect',
    authType: 'api_key',
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    category: 'conversation',
    description: 'Import meeting transcripts, action items, and summaries. Works with any video call platform.',
    status: 'available',
    logo: 'https://fireflies.ai/wp-content/uploads/2022/01/fireflies-logo.svg',
    authRoute: '/api/connectors/fireflies/connect',
    authType: 'api_key',
  },
  {
    id: 'fathom',
    name: 'Fathom',
    category: 'conversation',
    description: 'AI meeting notes and highlights synced directly to your pipeline.',
    status: 'coming_soon',
    logo: 'https://assets-global.website-files.com/625fa68eb86d83e7c234bdd0/625fa68eb86d83c0dd34be4b_Fathom%20Logo%20Icon%20Dark.svg',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    category: 'productivity',
    description: 'Connect documents, playbooks, and battle cards for context-aware AI analysis.',
    status: 'coming_soon',
    logo: 'https://cdn.simpleicons.org/googledrive/4285F4',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    description: "Pull wikis, runbooks, and templates into Pandora's knowledge layer.",
    status: 'coming_soon',
    logo: 'https://cdn.simpleicons.org/notion/000000',
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'operations',
    description: 'Push findings and action items directly to Asana tasks. Close the loop on RevOps recommendations.',
    status: 'coming_soon',
    logo: 'https://cdn.simpleicons.org/asana/F06A6A',
  },
  {
    id: 'monday',
    name: 'Monday.com',
    category: 'operations',
    description: 'Sync RevOps tasks and project tracking with Monday boards.',
    status: 'coming_soon',
    logo: 'https://cdn.simpleicons.org/monday/FF3D57',
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'crm', label: 'CRM' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'operations', label: 'Operations' },
];

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ApiKeyModalProps {
  connector: ConnectorDef;
  onClose: () => void;
  onSuccess: (connectorId: string) => void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function ApiKeyModal({ connector, onClose, onSuccess, onToast }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const isGong = connector.id === 'gong';

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setConnecting(true);
    setError('');
    try {
      await api.post(`/connectors/${connector.id}/connect`, { apiKey: apiKey.trim() });
      onSuccess(connector.id);
      onToast(`${connector.name} connected successfully`, 'success');
      onClose();
    } catch (err: any) {
      const msg = err?.message || err?.error || 'Connection failed — check your API key and try again';
      setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 28,
          width: 440,
          maxWidth: '90vw',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            background: colors.surfaceRaised,
            flexShrink: 0,
          }}>
            <img
              src={connector.logo}
              alt={`${connector.name} logo`}
              style={{
                width: 28,
                height: 28,
                objectFit: 'contain',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>
              Connect {connector.name}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>API Key Authentication</div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
          {isGong
            ? 'Enter your Gong API key. You can find this in Gong → Company Settings → API.'
            : 'Enter your Fireflies API key. You can find this in Fireflies → Settings → Integrations.'}
        </p>

        <label style={{ fontSize: 12, fontWeight: 500, color: colors.textSecondary, marginBottom: 6, display: 'block' }}>
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={`Enter your ${connector.name} API key`}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.text,
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => { e.target.style.borderColor = colors.borderFocus; }}
          onBlur={e => { e.target.style.borderColor = colors.border; }}
          onKeyDown={e => { if (e.key === 'Enter' && apiKey.trim()) handleSubmit(); }}
        />

        {error && (
          <div style={{ fontSize: 12, color: colors.red, marginTop: 8 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px',
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textSecondary,
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={connecting || !apiKey.trim()}
            style={{
              padding: '9px 20px',
              border: 'none',
              background: colors.accent,
              color: '#fff',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: connecting || !apiKey.trim() ? 'not-allowed' : 'pointer',
              opacity: connecting || !apiKey.trim() ? 0.6 : 1,
            }}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConnectorCardProps {
  connector: ConnectorDef;
  isConnected: boolean;
  onConnect: (connector: ConnectorDef) => void;
  onDisconnect: (connectorId: string) => void;
}

function ConnectorCard({ connector, isConnected, onConnect, onDisconnect }: ConnectorCardProps) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${isConnected ? 'rgba(34,197,94,0.3)' : colors.border}`,
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        opacity: connector.status === 'coming_soon' ? 0.6 : 1,
      }}
    >
      {/* Logo + Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ConnectorLogo type={connector.id} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>
            {connector.name}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {connector.category}
          </div>
        </div>

        {isConnected && (
          <span style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color: '#22C55E',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.35)',
            borderRadius: 20,
            padding: '2px 8px',
          }}>
            ✓ Connected
          </span>
        )}
        {!isConnected && connector.status === 'coming_soon' && (
          <span style={{
            flexShrink: 0,
            fontSize: 11,
            color: colors.textMuted,
            background: colors.surfaceRaised,
            borderRadius: 20,
            padding: '2px 8px',
          }}>
            Coming soon
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, margin: 0, flex: 1 }}>
        {connector.description}
      </p>

      {/* Action button */}
      {connector.status === 'available' && (
        <div>
          {isConnected ? (
            <button
              onClick={() => onDisconnect(connector.id)}
              style={{
                width: '100%',
                padding: '8px 0',
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                color: colors.textMuted,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => onConnect(connector)}
              style={{
                width: '100%',
                padding: '8px 0',
                background: colors.accent,
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Connect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MarketplacePage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [activeCategory, setActiveCategory] = useState('all');
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [apiKeyModal, setApiKeyModal] = useState<ConnectorDef | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = React.useRef(0);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const fetchConnectorStatus = async () => {
    try {
      const data = await api.get('/connectors/status');
      const connected = new Set<string>(
        (data.connectors || [])
          .filter((c: any) => c.status === 'connected' || c.status === 'synced' || c.status === 'healthy')
          .map((c: any) => c.type as string)
      );
      setConnectedIds(connected);
    } catch {
      // silently fail — cards default to "Connect"
    }
  };

  useEffect(() => {
    fetchConnectorStatus();

    // Handle post-OAuth bounce-back: ?connected=hubspot
    const params = new URLSearchParams(window.location.search);
    const justConnected = params.get('connected');
    if (justConnected) {
      window.history.replaceState({}, '', window.location.pathname);
      addToast(`${justConnected} connected successfully`, 'success');
      // Re-fetch to pick up new connector
      setTimeout(fetchConnectorStatus, 500);
    }
  }, []);

  const handleConnect = (connector: ConnectorDef) => {
    if (!connector.authRoute) return;

    if (connector.authType === 'api_key') {
      setApiKeyModal(connector);
      return;
    }

    // OAuth: redirect with workspaceId
    window.location.href = `${connector.authRoute}?workspaceId=${workspaceId}`;
  };

  const handleDisconnect = async (connectorId: string) => {
    try {
      await api.post(`/connectors/${connectorId}/disconnect`, {});
      setConnectedIds(prev => {
        const next = new Set(prev);
        next.delete(connectorId);
        return next;
      });
      addToast(`${connectorId} disconnected`, 'info');
    } catch {
      addToast('Failed to disconnect', 'error');
    }
  };

  const handleApiKeySuccess = (connectorId: string) => {
    setConnectedIds(prev => new Set([...prev, connectorId]));
  };

  const filtered = CONNECTOR_CATALOG
    .filter(c => activeCategory === 'all' || c.category === activeCategory)
    .sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === 'available' ? -1 : 1;
    });

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: '0 0 8px' }}>
          Marketplace
        </h1>
        <p style={{ fontSize: 14, color: colors.textMuted, maxWidth: 520, margin: 0, lineHeight: 1.6 }}>
          Connect your tools to unlock Pandora's full capabilities.
          Each connector enables additional skills and enriches your pipeline intelligence.
        </p>
      </div>

      {/* Category filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                padding: '6px 16px',
                borderRadius: 20,
                border: `1px solid ${isActive ? colors.accent : colors.border}`,
                background: isActive ? colors.accentSoft : 'transparent',
                color: isActive ? colors.accent : colors.textMuted,
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Connector grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {filtered.map(connector => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            isConnected={connectedIds.has(connector.id)}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {/* API key modal */}
      {apiKeyModal && (
        <ApiKeyModal
          connector={apiKeyModal}
          onClose={() => setApiKeyModal(null)}
          onSuccess={handleApiKeySuccess}
          onToast={addToast}
        />
      )}

      {/* Toasts */}
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

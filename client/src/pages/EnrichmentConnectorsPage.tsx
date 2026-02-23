import { useState } from 'react';
import { colors, fonts } from '../styles/theme';
import Toast from '../components/Toast';
import ApolloConnector from '../components/connectors/ApolloConnector';
import WebhookConnector from '../components/connectors/WebhookConnector';
import CSVConnector from '../components/connectors/CSVConnector';

export default function EnrichmentConnectorsPage() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  return (
    <div style={{ padding: '32px 48px', fontFamily: fonts.sans, maxWidth: 1400, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Enrichment Connectors
        </h1>
        <p style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.5 }}>
          Connect data providers to enrich your closed-won accounts with firmographic signals.
          All connectors normalize data into a common schema for ICP Discovery.
        </p>
      </div>

      {/* Connector Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: 24,
        }}
      >
        <ApolloConnector onToast={setToast} />
        <WebhookConnector onToast={setToast} />
        <CSVConnector onToast={setToast} />
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

/**
 * Deep Link Utilities
 *
 * Builds URLs to open records in external systems:
 * - CRM: HubSpot deals/companies, Salesforce opportunities/accounts
 * - Conversations: Gong calls, Fireflies transcripts
 */

import { useState, useEffect } from 'react';
import { api } from './api';

// ============================================================================
// Types
// ============================================================================

export interface CrmInfo {
  crm: 'hubspot' | 'salesforce' | null;
  portalId?: number | null;
  instanceUrl?: string | null;
}

// ============================================================================
// CRM Deep Links
// ============================================================================

/**
 * Build deep link URL for a deal/opportunity in CRM
 */
export function buildDealCrmUrl(
  crm: string | null,
  portalId: number | null,
  instanceUrl: string | null,
  sourceId: string | null,
  dealSource: string | null
): string | null {
  if (!crm || !sourceId) return null;

  if (crm === 'hubspot' && dealSource === 'hubspot' && portalId) {
    return `https://app.hubspot.com/contacts/${portalId}/deal/${sourceId}`;
  }

  if (crm === 'salesforce' && dealSource === 'salesforce' && instanceUrl) {
    const host = instanceUrl.replace(/^https?:\/\//, '');
    return `https://${host}/lightning/r/Opportunity/${sourceId}/view`;
  }

  return null;
}

/**
 * Build deep link URL for an account/company in CRM
 */
export function buildAccountCrmUrl(
  crm: string | null,
  portalId: number | null,
  instanceUrl: string | null,
  sourceId: string | null,
  accountSource: string | null
): string | null {
  if (!crm || !sourceId) return null;

  if (crm === 'hubspot' && accountSource === 'hubspot' && portalId) {
    return `https://app.hubspot.com/contacts/${portalId}/company/${sourceId}`;
  }

  if (crm === 'salesforce' && accountSource === 'salesforce' && instanceUrl) {
    const host = instanceUrl.replace(/^https?:\/\//, '');
    return `https://${host}/lightning/r/Account/${sourceId}/view`;
  }

  return null;
}

// ============================================================================
// Conversation Deep Links
// ============================================================================

/**
 * Build deep link URL for a conversation (Gong call or Fireflies transcript)
 */
export function buildConversationUrl(
  source: string | null,
  sourceId: string | null,
  sourceData?: Record<string, any>,
  customFields?: Record<string, any>
): string | null {
  if (!source || !sourceId) return null;

  if (source === 'gong') {
    // Prefer the URL from source_data or custom_fields if available
    if (sourceData?.url) return sourceData.url;
    if (customFields?.url) return customFields.url;
    // Fallback to constructed URL
    return `https://app.gong.io/call?id=${sourceId}`;
  }

  if (source === 'fireflies') {
    // Check custom_fields first (where it's typically stored)
    if (customFields?.transcript_url) return customFields.transcript_url;
    // Check source_data
    if (sourceData?.transcript_url) return sourceData.transcript_url;
    // Fallback to constructed URL
    return `https://app.fireflies.ai/view/${sourceId}`;
  }

  return null;
}

// ============================================================================
// Source Labels & Colors
// ============================================================================

export const SOURCE_LABELS: Record<string, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  gong: 'Gong',
  fireflies: 'Fireflies',
};

export const SOURCE_COLORS: Record<string, string> = {
  hubspot: '#FF7A59',
  salesforce: '#00A1E0',
  gong: '#1E3A8A',
  fireflies: '#F97316',
};

// ============================================================================
// React Hook
// ============================================================================

/**
 * Hook to fetch CRM info (portal ID or instance URL) for building deep links
 */
export function useCrmInfo(): {
  crmInfo: CrmInfo;
  loading: boolean;
  error: string | null;
} {
  const [crmInfo, setCrmInfo] = useState<CrmInfo>({ crm: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get('/crm/link-info')
      .then((data: CrmInfo) => setCrmInfo(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  return { crmInfo, loading, error };
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

interface Deal {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  owner: string;
}

interface Conversation {
  id: string;
  title: string;
  account_name: string | null;
  call_date: string | null;
}

interface LinkDealModalProps {
  workspaceId: string;
  conversation: Conversation;
  onClose: () => void;
  onLink: (conversationId: string, dealId: string) => void;
  onDismiss: (conversationId: string) => void;
}

export default function LinkDealModal({
  workspaceId,
  conversation,
  onClose,
  onLink,
  onDismiss,
}: LinkDealModalProps) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDeals = useCallback(async (search?: string) => {
    try {
      search ? setIsSearching(true) : setLoading(true);
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      const response = await api.get(`/deals?${params}`);
      setDeals(response.data || []);
    } catch (err) {
      console.error('Failed to load deals:', err);
      setDeals([]);
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchDeals(q.trim() || undefined);
    }, 250);
  }

  function handleLink() {
    if (!selectedDealId) return;
    onLink(conversation.id, selectedDealId);
  }

  function handleDismiss() {
    onDismiss(conversation.id);
  }

  const showInitialHint = !searchQuery && !loading;
  const busy = loading || isSearching;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: fonts.sans,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surfaceRaised,
          borderRadius: 12,
          width: '90%',
          maxWidth: 600,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: colors.text, margin: 0, marginBottom: 4 }}>
              Link Conversation to Deal
            </h2>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {conversation.title}
              {conversation.account_name && ` • ${conversation.account_name}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            type="text"
            placeholder="Search deals by name or owner…"
            value={searchQuery}
            onChange={handleSearchChange}
            autoFocus
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              background: colors.surface,
              color: colors.text,
              fontFamily: fonts.sans,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {showInitialHint && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.textMuted }}>
              Showing recent deals · type to search all
            </div>
          )}
        </div>

        {/* Deal List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 24px',
          }}
        >
          {busy ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
              {loading ? 'Loading deals…' : 'Searching…'}
            </div>
          ) : deals.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
              {searchQuery ? `No deals found for "${searchQuery}"` : 'No deals found'}
            </div>
          ) : (
            deals.map(deal => (
              <div
                key={deal.id}
                onClick={() => setSelectedDealId(deal.id)}
                style={{
                  padding: '12px 16px',
                  marginBottom: 8,
                  borderRadius: 6,
                  border: `1px solid ${selectedDealId === deal.id ? colors.accent : colors.border}`,
                  background: selectedDealId === deal.id ? colors.accentSoft : colors.surface,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (selectedDealId !== deal.id) {
                    e.currentTarget.style.background = colors.surfaceRaised;
                  }
                }}
                onMouseLeave={e => {
                  if (selectedDealId !== deal.id) {
                    e.currentTarget.style.background = colors.surface;
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
                      {deal.name}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {[deal.owner && !/^\d+$/.test(deal.owner) ? deal.owner : null, deal.stage].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {deal.amount != null && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: colors.accent }}>
                      ${(deal.amount / 1000).toFixed(0)}k
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: `1px solid ${colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: fonts.sans,
            }}
          >
            Dismiss
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                color: colors.textSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={!selectedDealId}
              style={{
                background: selectedDealId ? colors.accent : colors.border,
                color: selectedDealId ? '#fff' : colors.textMuted,
                border: 'none',
                borderRadius: 6,
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 600,
                cursor: selectedDealId ? 'pointer' : 'not-allowed',
                fontFamily: fonts.sans,
              }}
            >
              Link Deal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

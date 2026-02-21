/**
 * Conversation Gaps Component
 *
 * Displays conversations without deals in the Command Center
 */

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';

interface ConversationWithoutDeal {
  conversation_id: string;
  conversation_title: string;
  call_date: string;
  duration_seconds: number;
  rep_name: string | null;
  account_name: string;
  severity: 'high' | 'medium' | 'low';
  participant_count: number;
}

export function ConversationGaps() {
  const { workspaceId } = useWorkspace();
  const [conversations, setConversations] = useState<ConversationWithoutDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDeal, setShowCreateDeal] = useState<string | null>(null);

  useEffect(() => {
    loadConversations();
  }, [workspaceId]);

  const loadConversations = async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/conversations/without-deals?severity=high&limit=3`
      );
      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('Failed to load CWD:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async (conversationId: string) => {
    if (!confirm('Dismiss this conversation?')) return;

    try {
      await fetch(
        `/api/workspaces/${workspaceId}/conversations/without-deals/${conversationId}/dismiss`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      loadConversations();
    } catch (err) {
      console.error('Failed to dismiss:', err);
    }
  };

  if (loading || conversations.length === 0) {
    return null; // Hide section if no pending items
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Conversation Gaps</h3>
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm font-medium">
            {conversations.length} untracked
          </span>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Pandora detected {conversations.length} conversations with no associated deal.
      </p>

      <div className="space-y-3">
        {conversations.map((conv) => (
          <div
            key={conv.conversation_id}
            className="border border-gray-200 rounded-lg p-4 hover:border-gray-300"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      conv.severity === 'high'
                        ? 'bg-red-500'
                        : conv.severity === 'medium'
                        ? 'bg-yellow-500'
                        : 'bg-gray-400'
                    }`}
                  ></div>
                  <h4 className="font-medium">{conv.conversation_title}</h4>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  {conv.account_name} · {new Date(conv.call_date).toLocaleDateString()} ·{' '}
                  {Math.round(conv.duration_seconds / 60)} min · {conv.rep_name}
                </div>
                <div className="text-sm text-gray-700">
                  No deal exists at this account.
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => handleDismiss(conv.conversation_id)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setShowCreateDeal(conv.conversation_id)}
                  className="px-4 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Create Deal →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showCreateDeal && (
        <CreateDealModal
          conversationId={showCreateDeal}
          workspaceId={workspaceId}
          onClose={() => setShowCreateDeal(null)}
          onSuccess={() => {
            setShowCreateDeal(null);
            loadConversations();
          }}
        />
      )}
    </div>
  );
}

function CreateDealModal({ conversationId, workspaceId, onClose, onSuccess }: any) {
  const [loading, setLoading] = useState(false);
  const [dealName, setDealName] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  // Pre-fill close date to 30 days from now
  useEffect(() => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    setCloseDate(future.toISOString().split('T')[0]);
  }, []);

  const handleSubmit = async () => {
    if (!dealName || !stage || !closeDate || !ownerEmail) {
      alert('Please fill in required fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/conversations/without-deals/${conversationId}/create-deal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deal_name: dealName,
            amount: amount ? parseFloat(amount) : undefined,
            stage,
            close_date: closeDate,
            owner_email: ownerEmail,
            contacts_to_associate: [],
            contacts_to_create: [],
            notes: `Deal created from conversation via Pandora`,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to create deal');
      }

      const data = await response.json();
      alert('Deal created successfully!');
      window.open(data.deal_url, '_blank');
      onSuccess();
    } catch (err) {
      alert('Failed to create deal');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Create Deal</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Deal Name *</label>
            <input
              type="text"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Acme Corp - Demo Follow-up"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="50000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Stage *</label>
            <input
              type="text"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Discovery"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Close Date *</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Owner Email *</label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="rep@company.com"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create in CRM →'}
          </button>
        </div>
      </div>
    </div>
  );
}

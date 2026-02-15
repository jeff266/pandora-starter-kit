import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Zap, AlertCircle, Users, CheckCircle, ChevronDown, X, ArrowRight, Loader } from 'lucide-react';
import { api } from '../lib/api';

interface ActionsSummary {
  open_total: number;
  open_critical: number;
  open_warning: number;
  open_info: number;
  in_progress: number;
  executed_7d: number;
  total_impact_at_risk: number;
  reps_with_actions: number;
  by_type: Array<{ action_type: string; count: number }>;
  by_rep: Array<{ owner_email: string; action_count: number; critical_count: number }>;
}

interface Action {
  id: string;
  action_type: string;
  severity: string;
  title: string;
  summary?: string;
  recommended_steps?: string[];
  target_deal_name?: string;
  target_deal_id?: string;
  owner_email?: string;
  impact_amount?: number;
  urgency_label?: string;
  execution_status: string;
  created_at: string;
  source_skill: string;
}

interface Operation {
  type: string;
  field?: string;
  current_value?: any;
  proposed_value?: any;
  description?: string;
}

const severityColors = {
  critical: '#ff6b6b',
  warning: '#feca57',
  notable: '#6c5ce7',
  info: '#54a0ff',
};

const statusColors = {
  open: '#6b7280',
  in_progress: '#54a0ff',
  executed: '#00d2d3',
  dismissed: '#4b5563',
};

export default function Actions() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ActionsSummary | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [filteredActions, setFilteredActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string[]>(['critical', 'warning', 'notable', 'info']);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [repFilter, setRepFilter] = useState<string>('all');
  const [skillFilter, setSkillFilter] = useState<string>('all');

  // Sorting
  const [sortBy, setSortBy] = useState<'severity' | 'impact' | 'age'>('severity');

  useEffect(() => {
    fetchData();
  }, [workspaceId]);

  useEffect(() => {
    applyFilters();
  }, [actions, severityFilter, statusFilter, actionTypeFilter, repFilter, skillFilter, sortBy]);

  async function fetchData() {
    try {
      setLoading(true);
      const [summaryData, actionsData] = await Promise.all([
        api.get(`/workspaces/${workspaceId}/action-items/summary`),
        api.get(`/workspaces/${workspaceId}/action-items?limit=100`),
      ]);
      setSummary(summaryData);
      setActions(actionsData.actions || []);
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    let filtered = [...actions];

    // Severity filter
    filtered = filtered.filter(a => severityFilter.includes(a.severity));

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(a => a.execution_status === statusFilter);
    }

    // Action type filter
    if (actionTypeFilter !== 'all') {
      filtered = filtered.filter(a => a.action_type === actionTypeFilter);
    }

    // Rep filter
    if (repFilter !== 'all') {
      filtered = filtered.filter(a => a.owner_email === repFilter);
    }

    // Skill filter
    if (skillFilter !== 'all') {
      filtered = filtered.filter(a => a.source_skill === skillFilter);
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'severity') {
        const severityOrder = { critical: 0, warning: 1, notable: 2, info: 3 };
        const diff = severityOrder[a.severity as keyof typeof severityOrder] - severityOrder[b.severity as keyof typeof severityOrder];
        if (diff !== 0) return diff;
        return (b.impact_amount || 0) - (a.impact_amount || 0);
      } else if (sortBy === 'impact') {
        return (b.impact_amount || 0) - (a.impact_amount || 0);
      } else {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    setFilteredActions(filtered);
  }

  async function loadActionDetails(action: Action) {
    setSelectedAction(action);
    try {
      const opsData = await api.get(`/workspaces/${workspaceId}/action-items/${action.id}/operations`);
      setOperations(opsData.operations || []);
    } catch (err) {
      console.error('Failed to load operations:', err);
      setOperations([]);
    }
  }

  async function handleExecute() {
    if (!selectedAction) return;
    setExecuting(true);
    setExecuteError(null);

    try {
      await api.post(`/workspaces/${workspaceId}/action-items/${selectedAction.id}/execute`, {
        actor: 'user@company.com', // TODO: get from auth context
      });
      setShowExecuteModal(false);
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      setExecuteError(err.message || 'Execution failed');
    } finally {
      setExecuting(false);
    }
  }

  async function handleMarkInProgress() {
    if (!selectedAction) return;
    try {
      await api.put(`/workspaces/${workspaceId}/action-items/${selectedAction.id}/status`, {
        status: 'in_progress',
        actor: 'user@company.com',
      });
      setSelectedAction(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleDismiss() {
    if (!selectedAction) return;
    if (!confirm('Dismiss this action?')) return;
    try {
      await api.put(`/workspaces/${workspaceId}/action-items/${selectedAction.id}/status`, {
        status: 'dismissed',
        actor: 'user@company.com',
        reason: 'user_dismissed',
      });
      setSelectedAction(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to dismiss:', err);
    }
  }

  function formatCurrency(amount?: number) {
    if (!amount) return '—';
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
    return `$${Math.round(amount)}`;
  }

  function formatAge(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w`;
    return `${Math.floor(weeks / 4)}mo`;
  }

  const actionTypes = ['all', ...Array.from(new Set(actions.map(a => a.action_type)))];
  const reps = ['all', ...Array.from(new Set(actions.map(a => a.owner_email).filter(Boolean)))];
  const skills = ['all', ...Array.from(new Set(actions.map(a => a.source_skill)))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="p-8 min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Zap className="w-8 h-8 text-purple-500" />
          <h1 className="text-3xl font-bold">Actions</h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-6">
            <div className="text-sm text-gray-400 mb-2">Open Actions</div>
            <div className="text-3xl font-bold mb-2">{summary?.open_total || 0}</div>
            <div className="flex items-center gap-3 text-sm">
              <span style={{ color: severityColors.critical }}>● {summary?.open_critical || 0} act</span>
              <span style={{ color: severityColors.warning }}>● {summary?.open_warning || 0} watch</span>
              <span style={{ color: severityColors.notable }}>● {summary?.open_info || 0} notable</span>
            </div>
          </div>

          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-6">
            <div className="text-sm text-gray-400 mb-2">Total Impact at Risk</div>
            <div className="text-3xl font-bold mb-2">{formatCurrency(summary?.total_impact_at_risk)}</div>
            <div className="text-sm text-gray-400">across {filteredActions.filter(a => a.target_deal_id).length} deals</div>
          </div>

          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-6">
            <div className="text-sm text-gray-400 mb-2">Reps with Actions</div>
            <div className="text-3xl font-bold mb-2">{summary?.reps_with_actions || 0}</div>
            <div className="text-sm text-gray-400">
              {summary?.by_rep?.filter(r => r.critical_count > 0).length || 0} with critical
            </div>
          </div>

          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-6">
            <div className="text-sm text-gray-400 mb-2">Executed This Week</div>
            <div className="text-3xl font-bold mb-2">{summary?.executed_7d || 0}</div>
            <div className="text-sm text-gray-400">impact resolved</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-4 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Severity Toggle */}
            <div className="flex items-center gap-2">
              {(['critical', 'warning', 'notable', 'info'] as const).map(sev => (
                <button
                  key={sev}
                  onClick={() => {
                    if (severityFilter.includes(sev)) {
                      setSeverityFilter(severityFilter.filter(s => s !== sev));
                    } else {
                      setSeverityFilter([...severityFilter, sev]);
                    }
                  }}
                  className="px-3 py-1 rounded-md text-sm transition-colors"
                  style={{
                    backgroundColor: severityFilter.includes(sev) ? severityColors[sev] : '#1e1e2e',
                    color: severityFilter.includes(sev) ? '#fff' : '#9ca3af',
                  }}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2d2d3d] rounded-md px-3 py-1.5 text-sm"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="executed">Executed</option>
              <option value="dismissed">Dismissed</option>
            </select>

            {/* Action Type Filter */}
            <select
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2d2d3d] rounded-md px-3 py-1.5 text-sm"
            >
              {actionTypes.map(type => (
                <option key={type} value={type}>{type === 'all' ? 'All Types' : type.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {/* Rep Filter */}
            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2d2d3d] rounded-md px-3 py-1.5 text-sm max-w-[200px]"
            >
              <option value="all">All Reps</option>
              {reps.slice(1).map(rep => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </select>

            {/* Skill Filter */}
            <select
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2d2d3d] rounded-md px-3 py-1.5 text-sm"
            >
              <option value="all">All Skills</option>
              {skills.slice(1).map(skill => (
                <option key={skill} value={skill}>{skill.replace(/-/g, ' ')}</option>
              ))}
            </select>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-gray-400">Sort:</span>
              <button
                onClick={() => setSortBy('severity')}
                className={`px-3 py-1 rounded-md text-sm ${sortBy === 'severity' ? 'bg-purple-500' : 'bg-[#1e1e2e]'}`}
              >
                Severity
              </button>
              <button
                onClick={() => setSortBy('impact')}
                className={`px-3 py-1 rounded-md text-sm ${sortBy === 'impact' ? 'bg-purple-500' : 'bg-[#1e1e2e]'}`}
              >
                Impact
              </button>
              <button
                onClick={() => setSortBy('age')}
                className={`px-3 py-1 rounded-md text-sm ${sortBy === 'age' ? 'bg-purple-500' : 'bg-[#1e1e2e]'}`}
              >
                Age
              </button>
            </div>
          </div>
        </div>

        {/* Actions Table */}
        {filteredActions.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] p-12 text-center">
            <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <div className="text-xl text-gray-400">No actions match your filters</div>
            <div className="text-sm text-gray-500 mt-2">Try adjusting your filter criteria</div>
          </div>
        ) : (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-12"></th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400">Title</th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-48">Deal</th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-32">Owner</th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400 w-24">Impact</th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-32">Urgency</th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-20">Age</th>
                  <th className="text-left p-4 text-sm font-medium text-gray-400 w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredActions.map(action => (
                  <tr
                    key={action.id}
                    onClick={() => loadActionDetails(action)}
                    className="border-l-4 hover:bg-[#1a1a2e] cursor-pointer transition-colors"
                    style={{
                      borderLeftColor: severityColors[action.severity as keyof typeof severityColors] || '#374151',
                    }}
                  >
                    <td className="p-4">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: severityColors[action.severity as keyof typeof severityColors] }}
                      />
                    </td>
                    <td className="p-4 text-sm">{action.title}</td>
                    <td className="p-4 text-sm">
                      {action.target_deal_name ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/workspaces/${workspaceId}/deals/${action.target_deal_id}`);
                          }}
                          className="text-purple-400 hover:underline"
                        >
                          {action.target_deal_name}
                        </button>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-400">{action.owner_email?.split('@')[0] || '—'}</td>
                    <td className="p-4 text-sm text-right font-mono">{formatCurrency(action.impact_amount)}</td>
                    <td className="p-4 text-sm text-gray-400">{action.urgency_label || '—'}</td>
                    <td className="p-4 text-sm text-gray-400">{formatAge(action.created_at)}</td>
                    <td className="p-4">
                      <span
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          backgroundColor: statusColors[action.execution_status as keyof typeof statusColors] + '20',
                          color: statusColors[action.execution_status as keyof typeof statusColors],
                        }}
                      >
                        {action.execution_status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Action Detail Panel (slide-out) */}
        {selectedAction && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50">
            <div className="bg-[#12121a] w-[500px] h-full overflow-y-auto p-8 border-l border-[#1e1e2e]">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: severityColors[selectedAction.severity as keyof typeof severityColors] }}
                  />
                  <div>
                    <div className="text-xl font-bold">{selectedAction.title}</div>
                    <div className="text-sm text-gray-400 mt-1">{selectedAction.action_type.replace(/_/g, ' ')}</div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAction(null)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Status Badge */}
              <div className="mb-6">
                <span
                  className="px-3 py-1 rounded-md text-sm"
                  style={{
                    backgroundColor: statusColors[selectedAction.execution_status as keyof typeof statusColors] + '20',
                    color: statusColors[selectedAction.execution_status as keyof typeof statusColors],
                  }}
                >
                  {selectedAction.execution_status.replace('_', ' ')}
                </span>
              </div>

              {/* Summary */}
              {selectedAction.summary && (
                <div className="mb-6">
                  <div className="text-sm font-medium text-gray-400 mb-2">Summary</div>
                  <div className="text-sm text-gray-300">{selectedAction.summary}</div>
                </div>
              )}

              {/* Impact & Urgency */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Impact</div>
                  <div className="text-lg font-mono">{formatCurrency(selectedAction.impact_amount)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400 mb-1">Urgency</div>
                  <div className="text-sm">{selectedAction.urgency_label || '—'}</div>
                </div>
              </div>

              {/* Recommended Steps */}
              {selectedAction.recommended_steps && selectedAction.recommended_steps.length > 0 && (
                <div className="mb-6">
                  <div className="text-sm font-medium text-gray-400 mb-3">Recommended Steps</div>
                  <ol className="space-y-2">
                    {selectedAction.recommended_steps.map((step, idx) => (
                      <li key={idx} className="flex gap-3 text-sm">
                        <span className="text-purple-400 font-medium">{idx + 1}.</span>
                        <span className="text-gray-300">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Proposed CRM Changes */}
              <div className="mb-6">
                <div className="text-sm font-medium text-gray-400 mb-3">Proposed CRM Changes</div>
                {operations.length === 0 ? (
                  <div className="text-sm text-gray-500 italic">No automated CRM changes</div>
                ) : (
                  <div className="space-y-2">
                    {operations.map((op, idx) => (
                      <div key={idx} className="bg-[#1a1a2e] rounded-md p-3">
                        {op.type === 'field_update' ? (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-400">{op.field}:</span>
                            <span className="text-gray-500">{op.current_value || '(empty)'}</span>
                            <ArrowRight className="w-4 h-4 text-purple-400" />
                            <span className="text-green-400">{op.proposed_value}</span>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-400">{op.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                {(selectedAction.execution_status === 'open' || selectedAction.execution_status === 'in_progress') && (
                  <button
                    onClick={() => setShowExecuteModal(true)}
                    className="w-full bg-purple-500 hover:bg-purple-600 text-white py-3 px-4 rounded-md font-medium transition-colors"
                  >
                    Execute Action
                  </button>
                )}

                {selectedAction.execution_status === 'open' && (
                  <button
                    onClick={handleMarkInProgress}
                    className="w-full bg-[#1e1e2e] hover:bg-[#2d2d3d] text-white py-3 px-4 rounded-md font-medium transition-colors"
                  >
                    Mark In Progress
                  </button>
                )}

                <button
                  onClick={handleDismiss}
                  className="w-full text-gray-400 hover:text-white py-2 text-sm transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Execute Confirmation Modal */}
        {showExecuteModal && selectedAction && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-[10px] max-w-lg w-full p-6">
              <h2 className="text-xl font-bold mb-4">Execute Action: {selectedAction.title}</h2>

              {executeError && (
                <div className="bg-red-500/20 border border-red-500 rounded-md p-3 mb-4">
                  <div className="text-red-400 text-sm">{executeError}</div>
                </div>
              )}

              <div className="mb-6">
                <div className="text-sm text-gray-300 mb-4">
                  This will make the following changes to the CRM:
                </div>
                <div className="space-y-2">
                  {operations.map((op, idx) => (
                    <div key={idx} className="text-sm flex items-start gap-2">
                      <span className="text-purple-400">•</span>
                      {op.type === 'field_update' ? (
                        <span className="text-gray-300">
                          {op.field}: {op.current_value || '(empty)'} → {op.proposed_value}
                        </span>
                      ) : (
                        <span className="text-gray-300">{op.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowExecuteModal(false);
                    setExecuteError(null);
                  }}
                  disabled={executing}
                  className="flex-1 bg-[#1e1e2e] hover:bg-[#2d2d3d] text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  disabled={executing}
                  className="flex-1 bg-purple-500 hover:bg-purple-600 text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {executing ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Executing...
                    </>
                  ) : (
                    'Confirm & Execute'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

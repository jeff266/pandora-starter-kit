/**
 * Methodology Settings Component
 *
 * Allows workspace admins to configure and customize sales methodology frameworks
 * with versioning, diff, and preview capabilities.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import Skeleton from '../Skeleton';

interface MethodologyConfig {
  id: string;
  workspace_id: string;
  scope_type: 'workspace' | 'segment' | 'product' | 'segment_product';
  scope_segment: string | null;
  scope_product: string | null;
  base_methodology: string;
  display_name: string | null;
  config: any;
  version: number;
  is_current: boolean;
  created_at: string;
  created_by: string | null;
}

interface SystemFramework {
  id: string;
  label: string;
  description: string;
  vendor: string;
  dimension_count: number;
  dimensions: {
    id: string;
    label: string;
    description: string;
  }[];
}

interface VersionHistoryItem {
  id: string;
  version: number;
  is_current: boolean;
  created_at: string;
  created_by: string | null;
  config: any;
}

export default function MethodologySettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<MethodologyConfig[]>([]);
  const [frameworks, setFrameworks] = useState<SystemFramework[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MethodologyConfig | null>(null);
  const [versionHistory, setVersionHistory] = useState<VersionHistoryItem[]>([]);
  const [previewData, setPreviewData] = useState<{ preview: string; token_count: number; warning: string | null } | null>(null);
  const [highlightedVersionId, setHighlightedVersionId] = useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [baseMethodology, setBaseMethodology] = useState('');
  const [scopeType, setScopeType] = useState<'workspace' | 'segment' | 'product' | 'segment_product'>('workspace');
  const [scopeSegment, setScopeSegment] = useState('');
  const [scopeProduct, setScopeProduct] = useState('');
  const [problemDefinition, setProblemDefinition] = useState('');
  const [championSignals, setChampionSignals] = useState('');
  const [economicBuyerSignals, setEconomicBuyerSignals] = useState('');
  const [disqualifyingSignals, setDisqualifyingSignals] = useState('');
  const [qualifyingQuestions, setQualifyingQuestions] = useState('');
  const [stageCriteria, setStageCriteria] = useState<Record<string, string>>({});
  const [frameworkFields, setFrameworkFields] = useState<Record<string, any>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadConfigs();
    loadFrameworks();
  }, []);

  // Handle deep-linking from methodology attribution
  useEffect(() => {
    const configId = searchParams.get('config');
    const versionNum = searchParams.get('version');

    if (configId) {
      // Load version history for the specified config
      loadVersionHistory(configId).then(() => {
        setShowVersionHistory(true);

        // Highlight the specific version if provided
        if (versionNum && versionHistory.length > 0) {
          const targetVersion = versionHistory.find(v => v.version === parseInt(versionNum));
          if (targetVersion) {
            setHighlightedVersionId(targetVersion.id);
            // Clear highlight after 3 seconds
            setTimeout(() => setHighlightedVersionId(null), 3000);
          }
        }
      });

      // Clear query params after processing
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const result = await api.get('/methodology-configs');
      setConfigs(result.configs || []);
    } catch (err) {
      console.error('[MethodologySettings]', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFrameworks = async () => {
    try {
      const result = await api.get('/methodology-configs/system-defaults');
      setFrameworks(result.frameworks || []);
    } catch (err) {
      console.error('[MethodologySettings]', err);
    }
  };

  const loadVersionHistory = async (configId: string) => {
    try {
      const result = await api.get(`/methodology-configs/${configId}/versions`);
      setVersionHistory(result.versions || []);
    } catch (err) {
      console.error('[MethodologySettings]', err);
    }
  };

  const loadPreview = async (configId: string) => {
    try {
      const result = await api.post(`/methodology-configs/${configId}/preview`);
      setPreviewData(result);
      setShowPreview(true);
    } catch (err) {
      console.error('[MethodologySettings]', err);
    }
  };

  const handleNewConfig = () => {
    setEditingConfig(null);
    resetForm();
    setShowEditor(true);
  };

  const handleEditConfig = (config: MethodologyConfig) => {
    setEditingConfig(config);
    setDisplayName(config.display_name || '');
    setBaseMethodology(config.base_methodology);
    setScopeType(config.scope_type);
    setScopeSegment(config.scope_segment || '');
    setScopeProduct(config.scope_product || '');
    setProblemDefinition(config.config?.problem_definition || '');
    setChampionSignals(config.config?.champion_signals || '');
    setEconomicBuyerSignals(config.config?.economic_buyer_signals || '');
    setDisqualifyingSignals(config.config?.disqualifying_signals || '');
    setQualifyingQuestions(config.config?.qualifying_questions?.join('\n') || '');
    setStageCriteria(config.config?.stage_criteria || {});
    setFrameworkFields(config.config?.framework_fields || {});
    setShowEditor(true);
  };

  const handleSaveConfig = async () => {
    const configPayload = {
      problem_definition: problemDefinition,
      champion_signals: championSignals,
      economic_buyer_signals: economicBuyerSignals,
      disqualifying_signals: disqualifyingSignals,
      qualifying_questions: qualifyingQuestions.split('\n').filter(q => q.trim()),
      stage_criteria: stageCriteria,
      framework_fields: frameworkFields
    };

    try {
      if (editingConfig) {
        // Update existing config (creates new version)
        await api.patch(`/methodology-configs/${editingConfig.id}`, {
          display_name: displayName,
          config: configPayload
        });
      } else {
        // Create new config
        await api.post('/methodology-configs', {
          scope_type: scopeType,
          scope_segment: scopeType === 'segment' || scopeType === 'segment_product' ? scopeSegment : null,
          scope_product: scopeType === 'product' || scopeType === 'segment_product' ? scopeProduct : null,
          base_methodology: baseMethodology,
          display_name: displayName,
          config: configPayload
        });
      }

      setShowEditor(false);
      loadConfigs();
    } catch (err: any) {
      alert(`Failed to save config: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!confirm('Deactivate this methodology config?')) return;

    try {
      await api.delete(`/methodology-configs/${configId}`);
      loadConfigs();
    } catch (err: any) {
      alert(`Failed to delete config: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRestoreVersion = async (configId: string, versionId: string) => {
    if (!confirm('Restore this version as a new current version?')) return;

    try {
      await api.post(`/methodology-configs/${versionId}/restore`);
      loadConfigs();
      setShowVersionHistory(false);
    } catch (err: any) {
      alert(`Failed to restore version: ${err.response?.data?.error || err.message}`);
    }
  };

  const resetForm = () => {
    setDisplayName('');
    setBaseMethodology('');
    setScopeType('workspace');
    setScopeSegment('');
    setScopeProduct('');
    setProblemDefinition('');
    setChampionSignals('');
    setEconomicBuyerSignals('');
    setDisqualifyingSignals('');
    setQualifyingQuestions('');
    setStageCriteria({});
    setFrameworkFields({});
    setExpandedSections(new Set());
  };

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const getScopeChip = (config: MethodologyConfig) => {
    const chips = [];

    if (config.scope_type === 'workspace') {
      chips.push({ label: 'Workspace Default', color: '#94a3b8' });
    } else if (config.scope_type === 'segment') {
      chips.push({ label: `Segment: ${config.scope_segment}`, color: '#14b8a6' });
    } else if (config.scope_type === 'product') {
      chips.push({ label: `Product: ${config.scope_product}`, color: '#f97316' });
    } else if (config.scope_type === 'segment_product') {
      chips.push({ label: `Segment: ${config.scope_segment}`, color: '#14b8a6' });
      chips.push({ label: `Product: ${config.scope_product}`, color: '#f97316' });
    }

    return chips;
  };

  if (loading) return <Skeleton height={400} />;

  const activeConfigs = configs.filter(c => c.is_current);
  const workspaceConfigs = activeConfigs.filter(c => c.scope_type === 'workspace');
  const segmentConfigs = activeConfigs.filter(c => c.scope_type === 'segment');
  const productConfigs = activeConfigs.filter(c => c.scope_type === 'product');
  const segmentProductConfigs = activeConfigs.filter(c => c.scope_type === 'segment_product');

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.text, margin: 0 }}>
            Methodology
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 0' }}>
            Configure sales methodology frameworks for your workspace
          </p>
        </div>
        <button
          onClick={handleNewConfig}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: colors.accent,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          + New Config
        </button>
      </div>

      {/* Active Configs */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
          Active Configs
        </h3>

        {activeConfigs.length === 0 && (
          <div style={{
            padding: 24,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
              No methodology configs created yet. Click "+ New Config" to get started.
            </p>
          </div>
        )}

        {workspaceConfigs.map(config => (
          <ConfigCard
            key={config.id}
            config={config}
            chips={getScopeChip(config)}
            onEdit={() => handleEditConfig(config)}
            onDelete={() => handleDeleteConfig(config.id)}
            onViewHistory={() => {
              loadVersionHistory(config.id);
              setShowVersionHistory(true);
            }}
            onPreview={() => loadPreview(config.id)}
          />
        ))}

        {(segmentConfigs.length > 0 || productConfigs.length > 0 || segmentProductConfigs.length > 0) && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => {
                const scopedConfigs = [...segmentConfigs, ...productConfigs, ...segmentProductConfigs];
                if (scopedConfigs.length > 0) {
                  toggleSection('scoped-configs');
                }
              }}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              {expandedSections.has('scoped-configs') ? '▼' : '▶'} Segment & Product Configs ({segmentConfigs.length + productConfigs.length + segmentProductConfigs.length})
            </button>

            {expandedSections.has('scoped-configs') && (
              <div style={{ marginTop: 8 }}>
                {[...segmentConfigs, ...productConfigs, ...segmentProductConfigs].map(config => (
                  <ConfigCard
                    key={config.id}
                    config={config}
                    chips={getScopeChip(config)}
                    onEdit={() => handleEditConfig(config)}
                    onDelete={() => handleDeleteConfig(config.id)}
                    onViewHistory={() => {
                      loadVersionHistory(config.id);
                      setShowVersionHistory(true);
                    }}
                    onPreview={() => loadPreview(config.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Config Editor Modal */}
      {showEditor && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          overflowY: 'auto'
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: 8,
            maxWidth: 800,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 24
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
              {editingConfig ? 'Edit Config' : 'New Methodology Config'}
            </h3>

            {/* Config Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Config Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Frontera Enterprise Qualification"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text
                }}
              />
            </div>

            {/* Base Framework */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Base Framework
              </label>
              <select
                value={baseMethodology}
                onChange={(e) => setBaseMethodology(e.target.value)}
                disabled={!!editingConfig}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text
                }}
              >
                <option value="">Select framework...</option>
                {frameworks.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Scope */}
            {!editingConfig && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                  Scope
                </label>
                <select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 13,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    background: colors.surfaceRaised,
                    color: colors.text,
                    marginBottom: 8
                  }}
                >
                  <option value="workspace">Workspace</option>
                  <option value="segment">Segment</option>
                  <option value="product">Product</option>
                  <option value="segment_product">Segment + Product</option>
                </select>

                {(scopeType === 'segment' || scopeType === 'segment_product') && (
                  <input
                    type="text"
                    value={scopeSegment}
                    onChange={(e) => setScopeSegment(e.target.value)}
                    placeholder="Segment name (e.g., Enterprise)"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      background: colors.surfaceRaised,
                      color: colors.text,
                      marginBottom: 8
                    }}
                  />
                )}

                {(scopeType === 'product' || scopeType === 'segment_product') && (
                  <input
                    type="text"
                    value={scopeProduct}
                    onChange={(e) => setScopeProduct(e.target.value)}
                    placeholder="Product name (e.g., Platform)"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      background: colors.surfaceRaised,
                      color: colors.text
                    }}
                  />
                )}
              </div>
            )}

            {/* Problem Definition */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Problem Definition
              </label>
              <textarea
                value={problemDefinition}
                onChange={(e) => setProblemDefinition(e.target.value)}
                placeholder="Describe the problem your product solves..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Champion Signals */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Champion Signals
              </label>
              <textarea
                value={championSignals}
                onChange={(e) => setChampionSignals(e.target.value)}
                placeholder="Signs that indicate a champion..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Economic Buyer Signals */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Economic Buyer Signals
              </label>
              <textarea
                value={economicBuyerSignals}
                onChange={(e) => setEconomicBuyerSignals(e.target.value)}
                placeholder="Signs that indicate an economic buyer..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Disqualifying Signals */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Disqualifying Signals
              </label>
              <textarea
                value={disqualifyingSignals}
                onChange={(e) => setDisqualifyingSignals(e.target.value)}
                placeholder="Red flags that indicate disqualification..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Qualifying Questions */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
                Qualifying Questions <span style={{ fontWeight: 400, color: colors.textMuted }}>(one per line)</span>
              </label>
              <textarea
                value={qualifyingQuestions}
                onChange={(e) => setQualifyingQuestions(e.target.value)}
                placeholder="What problem are you trying to solve?&#10;Who else is involved in this decision?&#10;What is your timeline?"
                rows={6}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 24,
              paddingTop: 16,
              borderTop: `1px solid ${colors.border}`
            }}>
              <div>
                {editingConfig && (
                  <button
                    onClick={() => loadPreview(editingConfig.id)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '6px 12px',
                      background: 'none',
                      color: colors.accent,
                      border: `1px solid ${colors.accent}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      marginRight: 8
                    }}
                  >
                    Preview Prompt ↗
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setShowEditor(false)}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 16px',
                    background: 'none',
                    color: colors.textSecondary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={!displayName || !baseMethodology}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 16px',
                    background: displayName && baseMethodology ? colors.accent : colors.surfaceRaised,
                    color: displayName && baseMethodology ? 'white' : colors.textMuted,
                    border: 'none',
                    borderRadius: 6,
                    cursor: displayName && baseMethodology ? 'pointer' : 'not-allowed'
                  }}
                >
                  {editingConfig ? 'Publish' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionHistory && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: 8,
            maxWidth: 600,
            width: '100%',
            maxHeight: '80vh',
            overflowY: 'auto',
            padding: 24
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
              Version History
            </h3>

            {versionHistory.map(version => {
              const isHighlighted = highlightedVersionId === version.id;
              return (
              <div key={version.id} style={{
                padding: 12,
                background: isHighlighted ? `${colors.accent}15` : colors.surfaceRaised,
                border: `1px solid ${isHighlighted ? colors.accent : colors.border}`,
                borderRadius: 6,
                marginBottom: 8,
                transition: 'background 0.3s, border-color 0.3s'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                      v{version.version}
                    </span>
                    {version.is_current && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 6px',
                        background: colors.accent,
                        color: 'white',
                        borderRadius: 4,
                        marginLeft: 8
                      }}>
                        Current
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {new Date(version.created_at).toLocaleDateString()} · {version.created_by || 'System'}
                    </div>
                  </div>
                  <div>
                    {!version.is_current && (
                      <button
                        onClick={() => handleRestoreVersion(version.id, version.id)}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 8px',
                          background: 'none',
                          color: colors.accent,
                          border: `1px solid ${colors.accent}`,
                          borderRadius: 4,
                          cursor: 'pointer'
                        }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}))}

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                onClick={() => setShowVersionHistory(false)}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 16px',
                  background: 'none',
                  color: colors.textSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: 8,
            maxWidth: 800,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 24
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
                Prompt Preview
              </h3>
              <div style={{ fontSize: 12, color: colors.textSecondary }}>
                {previewData.token_count} tokens
                {previewData.warning && (
                  <span style={{ color: '#f97316', marginLeft: 8 }}>⚠ {previewData.warning}</span>
                )}
              </div>
            </div>

            {previewData.warning && (
              <div style={{
                padding: 12,
                background: '#f9731620',
                border: '1px solid #f97316',
                borderRadius: 6,
                marginBottom: 16
              }}>
                <p style={{ fontSize: 12, color: '#f97316', margin: 0 }}>
                  {previewData.warning}
                </p>
              </div>
            )}

            <pre style={{
              padding: 16,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              fontFamily: fonts.mono,
              color: colors.text,
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
              maxHeight: '60vh',
              overflowY: 'auto'
            }}>
              {previewData.preview}
            </pre>

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 16px',
                  background: 'none',
                  color: colors.textSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Config Card Component
function ConfigCard({
  config,
  chips,
  onEdit,
  onDelete,
  onViewHistory,
  onPreview
}: {
  config: MethodologyConfig;
  chips: { label: string; color: string }[];
  onEdit: () => void;
  onDelete: () => void;
  onViewHistory: () => void;
  onPreview: () => void;
}) {
  return (
    <div style={{
      padding: 16,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      marginBottom: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
              {config.base_methodology.toUpperCase()}
            </span>
            <span style={{ fontSize: 14, color: colors.textMuted }}>→</span>
            <span style={{ fontSize: 14, color: colors.accent }}>
              "{config.display_name || 'Untitled'}"
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            {chips.map((chip, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  background: `${chip.color}20`,
                  color: chip.color,
                  border: `1px solid ${chip.color}40`,
                  borderRadius: 4
                }}
              >
                {chip.label}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 11, color: colors.textMuted }}>
            Version {config.version} · Last edited {new Date(config.created_at).toLocaleDateString()}
            {config.created_by && ` by ${config.created_by}`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onEdit}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              background: 'none',
              color: colors.accent,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Edit
          </button>
          <button
            onClick={onViewHistory}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              background: 'none',
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Version History
          </button>
          <button
            onClick={onPreview}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              background: 'none',
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Preview Prompt
          </button>
        </div>
      </div>
    </div>
  );
}

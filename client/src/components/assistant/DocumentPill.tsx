import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  ChevronUp, 
  ChevronDown, 
  X, 
  ArrowRight,
  ChevronRight,
  Move,
  AlertTriangle,
  Check,
  Send,
  Mail,
  Slack,
  Download,
  Database
} from 'lucide-react';
import { 
  AccumulatedDocument, 
  DocumentSection, 
  DocumentContribution 
} from '../../types/document-types';
import { api } from '../../lib/api';
import CalibrationSession from '../documents/CalibrationSession';

interface DocumentPillProps {
  workspaceId: string;
  threadId: string;
}

export default function DocumentPill({ workspaceId, threadId }: DocumentPillProps) {
  const [doc, setDoc] = useState<AccumulatedDocument | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [synthesis, setSynthesis] = useState<any>(null);
  const [showReview, setShowReview] = useState(false);
  const [confirmedFlags, setConfirmedFlags] = useState<Record<string, boolean>>({});
  const [showDistribution, setShowDistribution] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editedSectionsCount, setEditedSectionsCount] = useState(0);
  const [showCalibrationNudge, setShowCalibrationNudge] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState<any>(null);

  useEffect(() => {
    const fetchCalibrationStatus = async () => {
      try {
        const res = await api.get(`/workspaces/${workspaceId}/calibration/status`);
        setCalibrationStatus(res);
      } catch (err) {
        console.error('Failed to fetch calibration status:', err);
      }
    };
    fetchCalibrationStatus();
  }, [workspaceId]);

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        const res = await api.get(`/sessions/${threadId}/document`);
        setDoc(res);
      } catch (err) {
        console.error('Failed to fetch document accumulator:', err);
      }
    };

    fetchDoc();
    const interval = setInterval(fetchDoc, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [workspaceId, threadId]);

  if (!doc) return null;

  const totalContributions = doc.sections.reduce((sum: number, s: DocumentSection) => sum + s.content.length, 0);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handleMove = async (contributionId: string, targetSectionId: string) => {
    try {
      const res = await api.post(`/sessions/${threadId}/document/contribution/${contributionId}/move`, {
        targetSectionId
      });
      setDoc(res);
    } catch (err) {
      console.error('Failed to move contribution:', err);
    }
  };

  const handleRender = async () => {
    try {
      const res = await api.post(`/sessions/${threadId}/document/synthesize`, {
        metrics: {} 
      });
      setSynthesis(res);
      if (res.lowConfidenceFlags && res.lowConfidenceFlags.length > 0) {
        setShowReview(true);
      } else {
        setShowDistribution(true);
      }
    } catch (err) {
      console.error('Failed to synthesize:', err);
      setShowDistribution(true);
    }
  };

  const handleConfirmFlag = (flagId: string) => {
    setConfirmedFlags(prev => ({ ...prev, [flagId]: true }));
  };

  const handleRemoveFlag = async (contributionId: string, flagId: string) => {
    try {
      const res = await api.post(`/sessions/${threadId}/document/contribution/${contributionId}/remove`);
      setDoc(res);
      setConfirmedFlags(prev => ({ ...prev, [flagId]: true }));
    } catch (err) {
      console.error('Failed to remove contribution:', err);
    }
  };

  const handleDistribute = async (channel: string) => {
    setDistributing(true);
    try {
      const result = await api.post(`/sessions/${threadId}/document/distribute`, {
        channel,
        recipient: channel === 'email' ? 'jeff@revopsimpact.us' : undefined,
        subject: synthesis?.documentThroughline || 'Pandora Analysis',
        body: synthesis?.executiveSummary || 'New document generated.'
      });
      if (result.success) {
        window.alert(`Successfully distributed via ${channel}`);
        setShowDistribution(false);
      } else {
        window.alert(`Failed to distribute: ${result.error}`);
      }
    } catch (err) {
      console.error('Distribution failed:', err);
      window.alert('Distribution failed.');
    } finally {
      setDistributing(false);
    }
  };

  const handleEditSection = (sectionId: string, currentText: string) => {
    setEditingSection(sectionId);
    setEditValue(currentText);
  };

  const handleSaveEdit = async (sectionId: string, rawText: string) => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      await api.post(`/documents/${doc.sessionId}/edit`, {
        threadId,
        sectionId,
        rawText,
        editedText: editValue
      });
      
      // Update local state if we had synthesis
      if (synthesis) {
        setSynthesis({
          ...synthesis,
          [sectionId]: editValue
        });
      }
      
      setEditingSection(null);
      setEditedSectionsCount(prev => {
        const newCount = prev + 1;
        if (newCount >= 2) {
          setShowCalibrationNudge(true);
        }
        return newCount;
      });
      
      // Temporary "Saved" feedback could be handled by a toast or state
    } catch (err) {
      console.error('Failed to save edit:', err);
      window.alert('Failed to save edit.');
    } finally {
      setSavingEdit(false);
    }
  };

  const allConfirmed = synthesis?.lowConfidenceFlags?.every((f: any) => confirmedFlags[f.contributionId]);

  return (
    <>
      {showCalibration && (
        <CalibrationSession 
          workspaceId={workspaceId} 
          onClose={() => setShowCalibration(false)} 
          onComplete={() => {
            setShowCalibration(false);
            // Refresh status if needed
          }}
        />
      )}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
        <div className={`bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ${expanded ? 'max-h-[80vh]' : 'max-h-12'}`}>
        {/* Header/Pill */}
        <div 
          className="h-12 flex items-center justify-between px-4 cursor-pointer hover:bg-slate-800 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <div className="bg-blue-500/20 p-1.5 rounded-lg">
              <FileText size={16} className="text-blue-400" />
            </div>
            <span className="text-sm font-medium text-slate-200">
              {doc.templateType} in progress
            </span>
            <span className="bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {totalContributions}
            </span>
            {calibrationStatus?.completedSessions === 0 && (
              <button 
                onClick={(e) => { e.stopPropagation(); setShowCalibration(true); }}
                className="ml-2 text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
              >
                <ArrowRight size={10} /> Calibrate
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={(e) => { e.stopPropagation(); handleRender(); }}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold px-3 py-1 rounded-lg flex items-center gap-1 transition-colors"
            >
              Render <ArrowRight size={12} />
            </button>
            {expanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronUp size={18} className="text-slate-400" />}
          </div>
        </div>

        {/* Review Panel */}
        {showReview && (
          <div className="p-4 bg-slate-950 border-t border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-amber-500" size={18} />
              <h3 className="text-sm font-bold text-slate-100">Review Required</h3>
            </div>
            <div className="space-y-3 mb-6 max-h-48 overflow-y-auto pr-2">
              {synthesis?.lowConfidenceFlags?.map((flag: any) => (
                <div key={flag.contributionId} className="bg-slate-900 rounded-lg p-3 border border-slate-800">
                  <div className="text-[11px] text-slate-400 mb-1">
                    {doc.sections.flatMap(s => s.content).find(c => c.id === flag.contributionId)?.title || 'Unknown Item'}
                  </div>
                  <div className="text-xs text-slate-200 mb-3">{flag.reason}</div>
                  {!confirmedFlags[flag.contributionId] ? (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleConfirmFlag(flag.contributionId)}
                        className="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white text-[10px] px-2 py-1 rounded transition-all flex items-center gap-1"
                      >
                        <Check size={10} /> Confirm
                      </button>
                      <button 
                        onClick={() => handleRemoveFlag(flag.contributionId, flag.contributionId)}
                        className="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white text-[10px] px-2 py-1 rounded transition-all flex items-center gap-1"
                      >
                        <X size={10} /> Remove
                      </button>
                    </div>
                  ) : (
                    <div className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                      <Check size={10} /> Handled
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center">
              <button onClick={() => setShowReview(false)} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
              <button 
                disabled={!allConfirmed}
                onClick={() => { setShowReview(false); setShowDistribution(true); }}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all"
              >
                Continue to distribution →
              </button>
            </div>
          </div>
        )}

        {/* Distribution Panel */}
        {showDistribution && (
          <div className="p-4 bg-slate-950 border-t border-slate-800">
            {showCalibrationNudge && (
              <div className="mb-4 bg-blue-600/10 border border-blue-600/20 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600/20 p-1 rounded-full">
                    <Check size={12} className="text-blue-400" />
                  </div>
                  <p className="text-[11px] text-slate-200">
                    You've made several edits. Want to calibrate for better future output?
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowCalibrationNudge(false)}
                    className="text-[10px] text-slate-400 hover:text-slate-200"
                  >
                    Not now
                  </button>
                  <button 
                    onClick={() => {
                      setShowCalibration(true);
                      setShowCalibrationNudge(false);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded transition-colors"
                  >
                    Calibrate →
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <Send className="text-blue-400" size={18} />
              <h3 className="text-sm font-bold text-slate-100">Distribute Document</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button 
                onClick={() => handleDistribute('slack')}
                disabled={distributing}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 p-3 rounded-xl transition-all"
              >
                <Slack className="text-pink-500" size={20} />
                <div className="text-left">
                  <div className="text-[11px] font-bold text-slate-200">Slack</div>
                  <div className="text-[10px] text-slate-500">Post summary</div>
                </div>
              </button>
              <button 
                onClick={() => handleDistribute('email')}
                disabled={distributing}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 p-3 rounded-xl transition-all"
              >
                <Mail className="text-blue-400" size={20} />
                <div className="text-left">
                  <div className="text-[11px] font-bold text-slate-200">Email</div>
                  <div className="text-[10px] text-slate-500">Send PDF</div>
                </div>
              </button>
              <button 
                onClick={() => handleDistribute('drive')}
                disabled={distributing}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 p-3 rounded-xl transition-all"
              >
                <Database className="text-emerald-500" size={20} />
                <div className="text-left">
                  <div className="text-[11px] font-bold text-slate-200">Google Drive</div>
                  <div className="text-[10px] text-slate-500">Save to cloud</div>
                </div>
              </button>
              <button 
                onClick={() => handleDistribute('download')}
                disabled={distributing}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 p-3 rounded-xl transition-all"
              >
                <Download className="text-slate-400" size={20} />
                <div className="text-left">
                  <div className="text-[11px] font-bold text-slate-200">Download</div>
                  <div className="text-[10px] text-slate-500">PPTX/DOCX/PDF</div>
                </div>
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setShowDistribution(false)} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
            </div>
          </div>
        )}

        {/* Expanded Content */}
        {expanded && (
          <div className="overflow-y-auto max-h-[calc(80vh-3rem)] p-4 space-y-3 bg-slate-900/50 backdrop-blur-sm">
            {synthesis && (
              <div className="mb-6 space-y-6">
                {Object.entries(synthesis).map(([key, value]) => {
                  if (typeof value !== 'string' || key === 'documentThroughline' || key === 'id') return null;
                  
                  const sectionTitle = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                  const isEditing = editingSection === key;

                  return (
                    <div key={key} className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 shadow-inner">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{sectionTitle}</h4>
                        {!isEditing && (
                          <button 
                            onClick={() => handleEditSection(key, value)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      
                      {isEditing ? (
                        <div className="space-y-3">
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full bg-slate-900 border border-blue-500/50 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[150px] font-sans leading-relaxed"
                          />
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => setEditingSection(null)}
                              className="text-xs text-slate-500 hover:text-slate-300 px-3 py-1.5"
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={() => handleSaveEdit(key, value)}
                              disabled={savingEdit}
                              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20"
                            >
                              {savingEdit ? 'Saving...' : 'Save Changes'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{value}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Source Contributions</div>
            {doc.sections.map((section: DocumentSection) => (
              <div key={section.id} className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/30">
                <div 
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() => toggleSection(section.id)}
                >
                  <div className="flex items-center gap-2">
                    {expandedSections[section.id] ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{section.title}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono bg-slate-900 px-1.5 py-0.5 rounded">
                    {section.content.length}
                  </span>
                </div>

                {expandedSections[section.id] && (
                  <div className="px-3 pb-3 space-y-2">
                    {section.content.length === 0 ? (
                      <div className="text-[11px] text-slate-600 italic py-2 px-6">No items yet</div>
                    ) : (
                      section.content.map((item: DocumentContribution) => (
                        <div key={item.id} className="bg-slate-900/80 border border-slate-800 rounded p-2 flex items-start justify-between group">
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium text-slate-300 truncate">{item.title}</div>
                            <div className="text-[10px] text-slate-500 truncate opacity-70">{item.type}</div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="relative group/menu">
                              <button className="p-1 hover:bg-slate-700 rounded text-slate-400">
                                <Move size={12} />
                              </button>
                              <div className="absolute right-0 bottom-full mb-1 hidden group-hover/menu:block bg-slate-800 border border-slate-700 rounded shadow-xl z-10 w-48">
                                <div className="p-1 text-[10px] text-slate-500 uppercase tracking-tighter font-bold border-b border-slate-700 px-2 py-1">Move to:</div>
                                {doc.sections.filter((s: DocumentSection) => s.id !== section.id).map((s: DocumentSection) => (
                                  <button 
                                    key={s.id}
                                    onClick={() => handleMove(item.id, s.id)}
                                    className="w-full text-left px-2 py-1.5 text-[11px] text-slate-300 hover:bg-blue-600 transition-colors"
                                  >
                                    {s.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

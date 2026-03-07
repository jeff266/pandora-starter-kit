import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  ChevronUp, 
  ChevronDown, 
  X, 
  ArrowRight,
  ChevronRight,
  Move
} from 'lucide-react';
import { 
  AccumulatedDocument, 
  DocumentSection, 
  DocumentContribution 
} from '../../types/document-types';
import { api } from '../../lib/api';

interface DocumentPillProps {
  workspaceId: string;
  threadId: string;
}

export default function DocumentPill({ workspaceId, threadId }: DocumentPillProps) {
  const [doc, setDoc] = useState<AccumulatedDocument | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

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
      // T012: Trigger synthesis
      const synthesis = await api.post(`/sessions/${threadId}/document/synthesize`, {
        metrics: {} // Future: Pass actual workspace metrics from context
      });
      
      console.log('Synthesis complete:', synthesis);
      // In a real app, we'd pass this to the PDF/PPTX renderer.
      // For now, show the throughline as confirmation.
      window.alert(`Rendered with throughline: ${synthesis.documentThroughline}\n\nCheck console for full synthesis payload.`);
    } catch (err) {
      console.error('Failed to synthesize/render:', err);
      window.alert('Synthesis failed. Proceeding with raw rendering.');
    }
  };

  return (
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

        {/* Expanded Content */}
        {expanded && (
          <div className="overflow-y-auto max-h-[calc(80vh-3rem)] p-4 space-y-3 bg-slate-900/50 backdrop-blur-sm">
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
  );
}

import React, { useState, useEffect } from 'react';
import { Check, X, ArrowRight, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api';

interface CalibrationQuestion {
  id: string;
  question: string;
  answerType: 'choice' | 'text' | 'example_preference';
  options?: { label: string; value: any }[];
  examples?: { label: string; text: string; value: any }[];
}

interface CalibrationStatus {
  shouldTrigger: boolean;
  reason?: string;
  completedAt?: string;
  nextScheduledAt?: string;
  completedSessions: number;
  questions: CalibrationQuestion[];
  openingMessage: string;
}

interface CalibrationSessionProps {
  workspaceId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function CalibrationSession({ workspaceId, onClose, onComplete }: CalibrationSessionProps) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [currentStep, setCurrentStep] = useState<'opening' | 'questions' | 'closing'>('opening');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get(`/workspaces/${workspaceId}/calibration/status`);
        setStatus(res);
      } catch (err) {
        console.error('Failed to fetch calibration status:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [workspaceId]);

  if (loading || !status) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const handleStart = () => {
    setCurrentStep('questions');
  };

  const handleAnswer = async (value: any) => {
    if (saving) return;
    setSaving(true);
    
    const question = status.questions[currentQuestionIndex];
    try {
      await api.post(`/workspaces/${workspaceId}/calibration/answer`, {
        questionId: question.id,
        answer: value
      });
      
      const newAnswers = { ...answers, [question.id]: value };
      setAnswers(newAnswers);
      
      if (currentQuestionIndex < status.questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        await handleComplete(newAnswers);
      }
    } catch (err) {
      console.error('Failed to save answer:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (finalAnswers: Record<string, any>) => {
    try {
      await api.post(`/workspaces/${workspaceId}/calibration/complete`, {
        answers: finalAnswers
      });
      setCurrentStep('closing');
    } catch (err) {
      console.error('Failed to complete calibration:', err);
    }
  };

  const currentQuestion = status.questions[currentQuestionIndex];

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl relative overflow-hidden">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors z-10"
        >
          <X size={20} />
        </button>

        <div className="p-6">
          {currentStep === 'opening' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 text-blue-400">
                <MessageSquare size={24} />
                <h2 className="text-lg font-bold">Calibration Session</h2>
              </div>
              <p className="text-slate-300 leading-relaxed italic border-l-2 border-blue-500/30 pl-4 py-1 bg-blue-500/5 rounded-r-lg">
                "{status.openingMessage}"
              </p>
              <div className="flex justify-end gap-3 pt-4">
                <button 
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Maybe later
                </button>
                <button 
                  onClick={handleStart}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20"
                >
                  Start Calibration <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {currentStep === 'questions' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">
                  Question {currentQuestionIndex + 1} of {status.questions.length}
                </span>
                <div className="flex gap-1">
                  {status.questions.map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1 rounded-full transition-all duration-300 ${i === currentQuestionIndex ? 'w-6 bg-blue-500' : 'w-2 bg-slate-700'}`} 
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-100">{currentQuestion.question}</h3>
                
                {currentQuestion.answerType === 'choice' && (
                  <div className="grid grid-cols-1 gap-3">
                    {currentQuestion.options?.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleAnswer(opt.value)}
                        disabled={saving}
                        className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 p-4 rounded-xl transition-all group flex items-center justify-between"
                      >
                        <span className="text-slate-200 font-medium">{opt.label}</span>
                        <div className="w-5 h-5 rounded-full border-2 border-slate-600 group-hover:border-blue-500 flex items-center justify-center transition-colors">
                          <div className="w-2 h-2 rounded-full bg-blue-500 scale-0 group-hover:scale-100 transition-transform" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {currentQuestion.answerType === 'example_preference' && (
                  <div className="grid grid-cols-1 gap-4">
                    {currentQuestion.examples?.map((ex) => (
                      <button
                        key={ex.value}
                        onClick={() => handleAnswer(ex.value)}
                        disabled={saving}
                        className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 p-4 rounded-xl transition-all group"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{ex.label}</span>
                          <Check size={14} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-sm text-slate-300 italic leading-relaxed">"{ex.text}"</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 'closing' && (
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="text-emerald-500" size={32} />
              </div>
              <h2 className="text-2xl font-bold text-slate-100">Calibration Complete!</h2>
              <p className="text-slate-400 leading-relaxed max-w-sm mx-auto">
                Perfect, I've updated your workspace profile. I'll apply these preferences to all future documents.
              </p>
              <div className="pt-6">
                <button 
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all shadow-lg shadow-blue-600/20"
                >
                  Back to workspace
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

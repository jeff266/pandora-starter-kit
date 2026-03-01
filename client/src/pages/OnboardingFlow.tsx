import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { HypothesisCard } from '../components/onboarding/HypothesisCard';
import { ArtifactPreview } from '../components/onboarding/ArtifactPreview';
import { QuestionInput } from '../components/onboarding/QuestionInput';
import { TierProgress } from '../components/onboarding/TierProgress';
import { PreInterviewLoader } from '../components/onboarding/PreInterviewLoader';

interface Hypothesis {
  summary: string;
  table?: Array<Record<string, string | number | null>>;
  columns?: string[];
  confidence: number;
  evidence: string;
  suggested_value?: unknown;
  options?: Array<{ id: string; label: string; description: string }>;
}

interface OnboardingQuestion {
  id: string;
  tier: number;
  title: string;
  prompt_intro: string;
  input_hint: string;
  can_skip: boolean;
  skip_message: string;
  show_artifact: boolean;
}

interface QuestionState {
  status: 'pending' | 'answered' | 'skipped' | 'active';
  answered_at?: string;
  config_patches_applied: string[];
  hypothesis_confidence: number;
  user_changed_hypothesis: boolean;
}

interface ConfigArtifact {
  type: 'named_filter' | 'stage_update' | 'goal_set' | 'rep_classified' | 'config_saved';
  label: string;
  detail: string;
  items?: string[];
}

interface ThreadItem {
  type: 'question' | 'user' | 'artifact' | 'upload_hypothesis';
  question?: OnboardingQuestion;
  hypothesis?: Hypothesis;
  user_text?: string;
  artifacts?: ConfigArtifact[];
  extraction_hypothesis?: Hypothesis;
  confirmed?: boolean;
}

interface Progress {
  tier: number;
  answered: number;
  total: number;
  pct: number;
  tier0_complete: boolean;
  tier1_complete: boolean;
}

type FlowState = 'welcome' | 'loading' | 'active' | 'upload_review' | 'tier0_complete' | 'done';

const TIER0_IDS = ['Q1_motions', 'Q2_calendar', 'Q3_stages', 'Q4_team', 'Q10_delivery'];
const TIER0_TITLES: Record<string, string> = {
  Q1_motions: 'Motions',
  Q2_calendar: 'Calendar',
  Q3_stages: 'Stages',
  Q4_team: 'Team',
  Q10_delivery: 'Delivery',
};

function apiUrl(workspaceId: string, path: string) {
  return `/api/workspaces/${workspaceId}/onboarding${path}`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('pandora_session');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export default function OnboardingFlow() {
  const { currentWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const [flowState, setFlowState] = useState<FlowState>('welcome');
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<OnboardingQuestion | null>(null);
  const [currentHypothesis, setCurrentHypothesis] = useState<Hypothesis | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [questionStates, setQuestionStates] = useState<Record<string, QuestionState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadHypothesis, setUploadHypothesis] = useState<Hypothesis | null>(null);
  const [role, setRole] = useState<string>('admin');
  const bottomRef = useRef<HTMLDivElement>(null);

  const wsId = currentWorkspace?.id;

  useEffect(() => {
    if (!wsId) return;
    checkExistingState();
  }, [wsId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, flowState]);

  async function checkExistingState() {
    if (!wsId) return;
    try {
      const res = await fetch(apiUrl(wsId, '/state'), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.not_started) return;
      if (data.state?.tier0_complete) {
        navigate('/');
        return;
      }
      if (data.current_question && data.hypothesis) {
        setCurrentQuestion(data.current_question);
        setCurrentHypothesis(data.hypothesis);
        setProgress(data.progress);
        if (data.state?.questions) setQuestionStates(data.state.questions);
        setThread([{ type: 'question', question: data.current_question, hypothesis: data.hypothesis }]);
        setFlowState('active');
      }
    } catch { /* ignore */ }
  }

  async function handleStart(force = false) {
    if (!wsId) return;
    setFlowState('loading');
    try {
      const res = await fetch(apiUrl(wsId, '/start'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ role, force }),
      });
      if (!res.ok) throw new Error('Failed to start onboarding');
      const data = await res.json();
      setCurrentQuestion(data.current_question);
      setCurrentHypothesis(data.hypothesis);
      setProgress(data.progress);
      if (data.state?.questions) setQuestionStates(data.state.questions);
      setThread([{ type: 'question', question: data.current_question, hypothesis: data.hypothesis }]);
      setFlowState('active');
    } catch (err) {
      console.error('[OnboardingFlow] start failed:', err);
      setFlowState('welcome');
    }
  }

  async function handleRestart() {
    if (!wsId) return;
    if (!window.confirm('Re-run the CRM scan and restart setup from the beginning?')) return;
    setThread([]);
    setCurrentQuestion(null);
    setCurrentHypothesis(null);
    setProgress(null);
    setQuestionStates({});
    await handleStart(true);
  }

  async function handleSubmit(text: string) {
    if (!wsId || !currentQuestion) return;
    setSubmitting(true);

    setThread(prev => [...prev, { type: 'user', user_text: text }]);

    try {
      const res = await fetch(apiUrl(wsId, '/answer'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question_id: currentQuestion.id, response: text }),
      });
      const data = await res.json();

      if (data.needs_clarification) {
        setThread(prev => [...prev, {
          type: 'question',
          question: { ...currentQuestion, prompt_intro: data.clarification_message ?? 'Could you clarify?' },
          hypothesis: currentHypothesis!,
        }]);
        return;
      }

      if (data.artifacts?.length > 0) {
        setThread(prev => [...prev, { type: 'artifact', artifacts: data.artifacts }]);
      }

      setProgress(data.progress);

      if (data.progress?.tier0_complete && !data.next_question) {
        setFlowState('tier0_complete');
        return;
      }

      if (data.next_question && data.next_hypothesis) {
        setCurrentQuestion(data.next_question);
        setCurrentHypothesis(data.next_hypothesis);
        setThread(prev => [...prev, { type: 'question', question: data.next_question, hypothesis: data.next_hypothesis }]);
        setFlowState('active');
      }
    } catch (err) {
      console.error('[OnboardingFlow] answer failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!wsId || !currentQuestion) return;
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl(wsId, '/skip'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question_id: currentQuestion.id }),
      });
      const data = await res.json();
      setProgress(data.progress);

      if (data.progress?.tier0_complete && !data.next_question) {
        setFlowState('tier0_complete');
        return;
      }

      if (data.next_question && data.next_hypothesis) {
        setCurrentQuestion(data.next_question);
        setCurrentHypothesis(data.next_hypothesis);
        setThread(prev => [...prev, {
          type: 'user',
          user_text: currentQuestion.skip_message || 'Skipped — using defaults.',
        }, {
          type: 'question',
          question: data.next_question,
          hypothesis: data.next_hypothesis,
        }]);
      }
    } catch (err) {
      console.error('[OnboardingFlow] skip failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(file: File) {
    if (!wsId || !currentQuestion) return;
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('question_id', currentQuestion.id);

    const token = localStorage.getItem('pandora_session');
    try {
      const res = await fetch(apiUrl(wsId, '/upload'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (data.extraction_hypothesis) {
        setUploadHypothesis(data.extraction_hypothesis);
        setFlowState('upload_review');
        setThread(prev => [...prev, { type: 'upload_hypothesis', extraction_hypothesis: data.extraction_hypothesis }]);
      }
    } catch (err) {
      console.error('[OnboardingFlow] upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  function handleConfirmUpload() {
    if (!uploadHypothesis) return;
    const summaryText = uploadHypothesis.summary;
    setUploadHypothesis(null);
    setFlowState('active');
    handleSubmit(summaryText + ' [From uploaded document]');
  }

  function handleDiscardUpload() {
    setUploadHypothesis(null);
    setFlowState('active');
  }

  async function handleFinishTier0() {
    navigate('/');
  }

  async function handleContinueTier1() {
    if (!wsId) return;
    try {
      const res = await fetch(apiUrl(wsId, '/state'), { headers: authHeaders() });
      const data = await res.json();
      if (data.current_question && data.hypothesis) {
        setCurrentQuestion(data.current_question);
        setCurrentHypothesis(data.next_hypothesis ?? data.hypothesis);
        setThread(prev => [...prev, { type: 'question', question: data.current_question, hypothesis: data.hypothesis }]);
        setFlowState('active');
      }
    } catch { /* ignore */ }
  }

  const tier0Progress = TIER0_IDS.map(id => ({
    id,
    title: TIER0_TITLES[id] || id,
    status: (
      id === currentQuestion?.id ? 'active' :
      questionStates[id]?.status === 'answered' ? 'answered' :
      questionStates[id]?.status === 'skipped' ? 'skipped' :
      'pending'
    ) as 'pending' | 'answered' | 'skipped' | 'active',
  }));

  if (!wsId) {
    return <div style={{ padding: 32, color: 'var(--color-textMuted)' }}>No workspace selected.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <div style={{
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-text)' }}>Pandora Setup</span>
          <span style={{ fontSize: 12, color: 'var(--color-textMuted)', marginLeft: 10 }}>10-minute workspace configuration</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {progress && (
            <span style={{ fontSize: 12, color: 'var(--color-textMuted)' }}>
              {progress.answered}/{progress.total} questions complete
            </span>
          )}
          {(flowState === 'active' || flowState === 'upload_review' || flowState === 'tier0_complete') && (
            <button
              onClick={handleRestart}
              style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-textMuted)', borderRadius: 6, padding: '4px 11px', fontSize: 12, cursor: 'pointer' }}
            >
              Restart Setup
            </button>
          )}
        </div>
      </div>

      {flowState !== 'welcome' && flowState !== 'loading' && (
        <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', flexShrink: 0 }}>
          <TierProgress questions={tier0Progress} tier={0} />
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {flowState === 'welcome' && (
          <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', width: '100%' }}>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-text)', margin: '0 0 10px 0' }}>
                Welcome to Pandora
              </h1>
              <p style={{ fontSize: 15, color: 'var(--color-textMuted)', margin: 0, lineHeight: 1.6 }}>
                Before your first brief, I'll interview you for about 10 minutes. I'll scan your CRM and show you my best guesses — just confirm or correct them.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
              {[
                { icon: '🔍', title: 'Hypothesis-first', desc: 'Every question shows my best guess with evidence from your CRM. No blank forms.' },
                { icon: '⚡', title: 'Graceful defaults', desc: 'Every question has a smart default. Skip anything and Pandora still works.' },
                { icon: '📋', title: 'Shows its work', desc: 'Tables of real deal counts and amounts — not made-up numbers.' },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)', marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--color-textMuted)', lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
              <label style={{ fontSize: 13, color: 'var(--color-textMuted)', whiteSpace: 'nowrap' }}>Your role:</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                style={{ fontSize: 13, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}
              >
                <option value="admin">Admin / RevOps</option>
                <option value="cro">CRO / VP Sales</option>
                <option value="manager">Sales Manager</option>
                <option value="consultant">Consultant</option>
              </select>
            </div>

            <button
              onClick={handleStart}
              style={{
                background: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 9,
                padding: '12px 28px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Begin Setup →
            </button>

            <button
              onClick={() => navigate('/')}
              style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--color-textMuted)', fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'center' }}
            >
              Skip setup — I'll do this later
            </button>
          </div>
        )}

        {flowState === 'loading' && (
          <PreInterviewLoader companyName={currentWorkspace?.name} />
        )}

        {(flowState === 'active' || flowState === 'upload_review') && (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 24px 0 24px', width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {thread.map((item, i) => (
              <div key={i}>
                {item.type === 'question' && item.question && item.hypothesis && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
                      {item.question.title}
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--color-textMuted)', marginBottom: 10, lineHeight: 1.5 }}>
                      {item.question.prompt_intro}
                    </p>
                    <HypothesisCard hypothesis={item.hypothesis} />
                    {i === thread.length - 1 && flowState === 'active' && (
                      <QuestionInput
                        placeholder={item.question.input_hint}
                        onSubmit={handleSubmit}
                        onSkip={handleSkip}
                        onUpload={handleUpload}
                        submitting={submitting}
                        uploading={uploading}
                        skipMessage={item.question.skip_message}
                      />
                    )}
                  </div>
                )}
                {item.type === 'user' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{
                      maxWidth: '80%',
                      background: 'var(--color-accent)',
                      color: '#fff',
                      borderRadius: '10px 10px 2px 10px',
                      padding: '8px 14px',
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}>
                      {item.user_text}
                    </div>
                  </div>
                )}
                {item.type === 'artifact' && item.artifacts?.map((artifact, j) => (
                  <ArtifactPreview key={j} artifact={artifact} />
                ))}
                {item.type === 'upload_hypothesis' && item.extraction_hypothesis && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-textMuted)', marginBottom: 6, fontStyle: 'italic' }}>
                      From your uploaded document:
                    </div>
                    <HypothesisCard hypothesis={item.extraction_hypothesis} />
                    {i === thread.length - 1 && flowState === 'upload_review' && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                        <button
                          onClick={handleConfirmUpload}
                          style={{ background: 'var(--color-green)', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Confirm this
                        </button>
                        <button
                          onClick={handleDiscardUpload}
                          style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-textMuted)', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
                        >
                          Discard — I'll type my answer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} style={{ height: 24 }} />
          </div>
        )}

        {flowState === 'tier0_complete' && (
          <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', width: '100%' }}>
            <div style={{ marginBottom: 24 }}>
              <span style={{ fontSize: 36 }}>✓</span>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', margin: '8px 0 8px 0' }}>
                Setup Complete
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-textMuted)', lineHeight: 1.6, margin: 0 }}>
                Pandora is now configured for your workspace. Your first brief will be generated shortly.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {thread.filter(t => t.type === 'artifact').flatMap(t => t.artifacts ?? []).map((a, i) => (
                <ArtifactPreview key={i} artifact={a} />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={handleFinishTier0}
                style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                Go to my brief →
              </button>
              <button
                onClick={handleContinueTier1}
                style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-textMuted)', borderRadius: 9, padding: '10px 28px', fontSize: 13, cursor: 'pointer' }}
              >
                Keep going — refine a few more settings (5 min)
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

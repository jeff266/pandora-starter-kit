import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import CopilotMessage from './CopilotMessage';
import QuickOptions from './QuickOptions';
import CopilotInput from './CopilotInput';
import AgentReviewCard from './AgentReviewCard';
import {
  type CopilotStep,
  type CopilotState,
  type ChatMessage,
  type QuickOption,
  type DraftConfig,
  type WorkspaceContext,
  WELCOME_MESSAGE,
  getStepOptions,
  getStepMessage,
  getStepPlaceholder,
  getPresetUpdates,
  getNextStep,
  suggestSkills,
  getFocusQuestionText,
} from './copilot-steps';
import { Loader2 } from 'lucide-react';

interface Props {
  workspaceId: string;
  onAgentCreated?: (agent: any) => void;
  onSwitchToManual?: () => void;
}

export default function AgentCopilot({ workspaceId, onAgentCreated, onSwitchToManual }: Props) {
  const [state, setState] = useState<CopilotState>({
    step: 'welcome',
    messages: [WELCOME_MESSAGE],
    draft_config: {},
    workspace_context: null,
  });

  const [inputText, setInputText] = useState('');
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedFocusQuestions, setSelectedFocusQuestions] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsConfirmed, setSkillsConfirmed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadWorkspaceContext();
  }, [workspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages, state.step]);

  async function loadWorkspaceContext() {
    try {
      const ctx = await api.get('/agents-v2/copilot/context');
      setState(prev => ({ ...prev, workspace_context: ctx }));
    } catch (err) {
      console.error('Failed to load copilot context:', err);
    }
  }

  function addMessage(msg: ChatMessage) {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, msg],
    }));
  }

  function applyUpdates(updates: Partial<DraftConfig>) {
    setState(prev => ({
      ...prev,
      draft_config: { ...prev.draft_config, ...updates },
    }));
  }

  function advanceStep(skip: CopilotStep[] = []) {
    const next = getNextStep(state.step, skip);
    const botMsg = getStepMessage(next, state.draft_config);

    setState(prev => {
      const newState = { ...prev, step: next };
      if (botMsg) {
        newState.messages = [...prev.messages, { role: 'assistant' as const, content: botMsg }];
      }
      return newState;
    });

    if (next === 'skills') {
      const suggested = suggestSkills(state.draft_config.focus_questions || []);
      setSelectedSkills(suggested);
      setSkillsConfirmed(false);
    }
  }

  function handleWelcomePreset(option: QuickOption) {
    const updates = getPresetUpdates('welcome', option.value);
    const templateName = updates.name || option.label;
    const skillCount = updates.skills?.length || 0;

    setState(prev => ({
      ...prev,
      step: 'schedule',
      draft_config: { ...prev.draft_config, ...updates },
      messages: [
        ...prev.messages,
        { role: 'user' as const, content: option.label, selected_option: option.value },
        {
          role: 'assistant' as const,
          content: `Got it \u2014 I'll set up a "${templateName}" agent with ${skillCount} skills. Let's configure when it should run.\n\nWhen do you want this delivered?`,
        },
      ],
    }));
  }

  function handleAudiencePreset(option: QuickOption) {
    const updates = getPresetUpdates('audience', option.value);
    setState(prev => {
      const newDraft = { ...prev.draft_config, ...updates };
      return {
        ...prev,
        step: 'focus',
        draft_config: newDraft,
        messages: [
          ...prev.messages,
          { role: 'user' as const, content: option.label, selected_option: option.value },
          { role: 'assistant' as const, content: getStepMessage('focus', newDraft) },
        ],
      };
    });
  }

  function handleFocusPreset(option: QuickOption) {
    const question = getFocusQuestionText(option.value);
    setSelectedFocusQuestions(prev => {
      if (prev.includes(question)) return prev.filter(q => q !== question);
      return [...prev, question];
    });
  }

  function confirmFocusQuestions() {
    if (selectedFocusQuestions.length === 0) return;
    const updates: Partial<DraftConfig> = { focus_questions: selectedFocusQuestions };
    const summary = selectedFocusQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    const suggested = suggestSkills(selectedFocusQuestions);
    setSelectedSkills(suggested);
    setSkillsConfirmed(false);

    setState(prev => {
      const newDraft = { ...prev.draft_config, ...updates };
      return {
        ...prev,
        step: 'skills',
        draft_config: newDraft,
        messages: [
          ...prev.messages,
          { role: 'user' as const, content: `Selected questions:\n${summary}` },
          { role: 'assistant' as const, content: getStepMessage('skills', newDraft) },
        ],
      };
    });
  }

  function handleSchedulePreset(option: QuickOption) {
    const updates = getPresetUpdates('schedule', option.value);
    setState(prev => {
      const newDraft = { ...prev.draft_config, ...updates };
      return {
        ...prev,
        step: 'delivery',
        draft_config: newDraft,
        messages: [
          ...prev.messages,
          { role: 'user' as const, content: option.label, selected_option: option.value },
          { role: 'assistant' as const, content: getStepMessage('delivery', newDraft) },
        ],
      };
    });
  }

  function handleDeliveryPreset(option: QuickOption) {
    const updates = getPresetUpdates('delivery', option.value);
    setState(prev => ({
      ...prev,
      step: 'review',
      draft_config: { ...prev.draft_config, ...updates },
      messages: [
        ...prev.messages,
        { role: 'user' as const, content: option.label, selected_option: option.value },
        { role: 'assistant' as const, content: "Here's what I've built. Review and confirm:" },
      ],
    }));
  }

  function handleOptionClick(option: QuickOption) {
    switch (state.step) {
      case 'welcome':
        handleWelcomePreset(option);
        break;
      case 'audience':
        handleAudiencePreset(option);
        break;
      case 'focus':
        handleFocusPreset(option);
        break;
      case 'schedule':
        handleSchedulePreset(option);
        break;
      case 'delivery':
        handleDeliveryPreset(option);
        break;
    }
  }

  function confirmSkills() {
    const updates: Partial<DraftConfig> = { skills: selectedSkills };
    setSkillsConfirmed(true);
    setState(prev => ({
      ...prev,
      step: 'schedule',
      draft_config: { ...prev.draft_config, ...updates },
      messages: [
        ...prev.messages,
        { role: 'user' as const, content: `Selected ${selectedSkills.length} skills: ${selectedSkills.join(', ')}` },
        { role: 'assistant' as const, content: getStepMessage('schedule', prev.draft_config) },
      ],
    }));
  }

  async function handleFreeText() {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');

    if (state.step === 'focus') {
      setSelectedFocusQuestions(prev => [...prev, text]);
      addMessage({ role: 'user', content: text });
      addMessage({ role: 'assistant', content: `Added: "${text}". Pick more or click "Continue" when ready.` });
      return;
    }

    addMessage({ role: 'user', content: text });
    setIsInterpreting(true);

    try {
      const result = await api.post('/agents-v2/copilot/interpret', {
        step: state.step,
        user_input: text,
        current_draft: state.draft_config,
      });

      if (result.updates && Object.keys(result.updates).length > 0) {
        applyUpdates(result.updates);
      }

      addMessage({ role: 'assistant', content: result.confirmation });

      const stepsCovered = result.steps_covered || [];
      setTimeout(() => advanceStep(stepsCovered), 300);
    } catch (err) {
      addMessage({
        role: 'assistant',
        content: "I didn't quite catch that. Could you rephrase, or pick one of the options above?",
      });
    } finally {
      setIsInterpreting(false);
    }
  }

  async function handleCreateAgent() {
    const config = state.draft_config;
    const missing: string[] = [];
    if (!config.skills?.length) missing.push('skills');
    if (!config.schedule) missing.push('schedule');
    if (!config.output_formats?.length) missing.push('delivery channel');

    if (missing.length > 0) {
      addMessage({
        role: 'assistant',
        content: `Missing required config: ${missing.join(', ')}. Let me take you back to fill those in.`,
      });
      const firstMissing = missing[0] === 'delivery channel' ? 'delivery' : missing[0] as CopilotStep;
      setState(prev => ({ ...prev, step: firstMissing }));
      return;
    }

    setIsCreating(true);
    try {
      const payload = {
        name: config.name || 'New Agent',
        description: config.focus_questions?.slice(0, 2).join('; ') || '',
        icon: config.icon || '/avatars/char-01.png',
        skill_ids: config.skills?.length ? config.skills : ['pipeline-hygiene'],
        trigger_config: {
          type: config.schedule?.type || 'manual',
          schedule: config.schedule?.cron || null,
        },
        filter_config: { severities: ['critical', 'warning'], max_findings: 20 },
        audience: config.audience || { role: 'Sales Manager', detail_preference: 'manager' },
        focus_questions: config.focus_questions || [],
        data_window: config.data_window || { primary: 'current_week', comparison: 'previous_period' },
        output_formats: config.output_formats || ['in_app'],
      };

      const agent = await api.post('/agents-v2', payload);

      setState(prev => ({
        ...prev,
        step: 'done',
        messages: [
          ...prev.messages,
          { role: 'assistant' as const, content: `Agent "${config.name || 'New Agent'}" created successfully! You can find it in your Agents list.` },
        ],
      }));

      onAgentCreated?.(agent);
    } catch (err: any) {
      addMessage({
        role: 'assistant',
        content: `Failed to create agent: ${err.message || 'Unknown error'}. Please try again.`,
      });
    } finally {
      setIsCreating(false);
    }
  }

  function handleEdit() {
    setState(prev => ({
      ...prev,
      step: 'welcome',
      messages: [
        ...prev.messages,
        { role: 'assistant' as const, content: "What would you like to change? You can pick a different option or describe what you want." },
      ],
    }));
  }

  function handleStartOver() {
    setSelectedFocusQuestions([]);
    setSelectedSkills([]);
    setSkillsConfirmed(false);
    setState({
      step: 'welcome',
      messages: [WELCOME_MESSAGE],
      draft_config: {},
      workspace_context: state.workspace_context,
    });
  }

  const showInput = state.step !== 'done' && state.step !== 'review' && state.step !== 'skills';
  const showOptions = state.step !== 'done' && state.step !== 'review' && state.step !== 'skills';
  const allSkills = state.workspace_context?.skills || [];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 180px)',
      maxWidth: 700,
      margin: '0 auto',
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      background: colors.bg,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ font: `600 15px ${fonts.sans}`, color: colors.text }}>
          Agent Copilot
        </span>
        {onSwitchToManual && (
          <button
            onClick={onSwitchToManual}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              font: `400 12px ${fonts.sans}`,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Switch to manual mode
          </button>
        )}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 20px',
      }}>
        {state.messages.map((msg, i) => (
          <CopilotMessage key={i} message={msg} />
        ))}

        {showOptions && (
          <QuickOptions
            options={getStepOptions(state.step)}
            onSelect={handleOptionClick}
            multiSelect={state.step === 'focus'}
            selected={state.step === 'focus' ? selectedFocusQuestions.map(q => {
              const opts = getStepOptions('focus');
              const match = opts.find(o => getFocusQuestionText(o.value) === q);
              return match?.value || '';
            }).filter(Boolean) : []}
          />
        )}

        {state.step === 'focus' && selectedFocusQuestions.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <div style={{
              font: `400 12px ${fonts.sans}`,
              color: colors.textMuted,
              marginBottom: 6,
            }}>
              Selected ({selectedFocusQuestions.length}):
            </div>
            {selectedFocusQuestions.map((q, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                font: `400 13px ${fonts.sans}`,
                color: colors.text,
              }}>
                <span style={{ color: colors.accent }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{q}</span>
                <button
                  onClick={() => setSelectedFocusQuestions(prev => prev.filter((_, idx) => idx !== i))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: colors.textMuted,
                    cursor: 'pointer',
                    font: `400 16px ${fonts.sans}`,
                    padding: '0 4px',
                  }}
                >
                  x
                </button>
              </div>
            ))}
            <button
              onClick={confirmFocusQuestions}
              style={{
                marginTop: 8,
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: colors.accent,
                color: '#fff',
                font: `500 13px ${fonts.sans}`,
                cursor: 'pointer',
              }}
            >
              Continue with {selectedFocusQuestions.length} question{selectedFocusQuestions.length > 1 ? 's' : ''}
            </button>
          </div>
        )}

        {state.step === 'skills' && (
          <div style={{ marginBottom: 12 }}>
            {allSkills.map(skill => {
              const isSelected = selectedSkills.includes(skill.id);
              const isSuggested = suggestSkills(state.draft_config.focus_questions || []).includes(skill.id);
              return (
                <div
                  key={skill.id}
                  onClick={() => {
                    setSelectedSkills(prev =>
                      prev.includes(skill.id) ? prev.filter(s => s !== skill.id) : [...prev, skill.id]
                    );
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                    background: isSelected ? colors.accentSoft : colors.surface,
                    marginBottom: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `2px solid ${isSelected ? colors.accent : colors.textMuted}`,
                    background: isSelected ? colors.accent : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: '#fff',
                    flexShrink: 0,
                  }}>
                    {isSelected ? '\u2713' : ''}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ font: `500 13px ${fonts.sans}`, color: colors.text }}>{skill.name}</span>
                    {isSuggested && (
                      <span style={{
                        marginLeft: 8,
                        font: `400 11px ${fonts.sans}`,
                        color: colors.accent,
                      }}>
                        suggested
                      </span>
                    )}
                  </span>
                  <span style={{
                    font: `400 11px ${fonts.sans}`,
                    color: colors.textMuted,
                    padding: '2px 6px',
                    background: colors.surfaceHover,
                    borderRadius: 4,
                  }}>
                    {skill.category}
                  </span>
                </div>
              );
            })}
            <button
              onClick={confirmSkills}
              disabled={selectedSkills.length === 0}
              style={{
                marginTop: 8,
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: selectedSkills.length > 0 ? colors.accent : colors.surfaceHover,
                color: selectedSkills.length > 0 ? '#fff' : colors.textMuted,
                font: `500 13px ${fonts.sans}`,
                cursor: selectedSkills.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              Continue with {selectedSkills.length} skill{selectedSkills.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {state.step === 'review' && (
          <AgentReviewCard
            config={state.draft_config}
            onConfirm={handleCreateAgent}
            onEdit={handleEdit}
            onStartOver={handleStartOver}
            isCreating={isCreating}
          />
        )}

        {state.step === 'done' && (
          <div style={{
            textAlign: 'center',
            padding: '20px 0',
          }}>
            <button
              onClick={handleStartOver}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                color: colors.text,
                font: `400 14px ${fonts.sans}`,
                cursor: 'pointer',
              }}
            >
              Create Another Agent
            </button>
          </div>
        )}

        {isInterpreting && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            font: `400 13px ${fonts.sans}`,
            color: colors.textMuted,
          }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showInput && (
        <CopilotInput
          value={inputText}
          onChange={setInputText}
          onSubmit={handleFreeText}
          placeholder={getStepPlaceholder(state.step)}
          disabled={isInterpreting}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

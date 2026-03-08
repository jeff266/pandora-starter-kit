import { useMemo } from 'react';

interface ChatMessageSignal {
  role: string;
  content: string;
  tool_call_count?: number;
  evidence?: {
    skill_evidence_used?: Array<{ skill_id: string }>;
    tool_calls?: Array<any>;
  };
}

interface TriggerState {
  shouldShow: boolean;
  reason: 'too_short' | 'no_skills' | 'already_saved' | 'dismissed' | 'eligible';
}

/**
 * Determines whether the "Save as Agent" CTA banner should be shown.
 *
 * Conditions to show (ALL must be true):
 *   1. 5 or more user turns in the conversation
 *   2. At least 1 skill was invoked (via tool_call_count or skill_evidence_used)
 *   3. Not already saved
 *   4. User has not dismissed the banner
 */
export function useSaveAsAgentTrigger(
  messages: ChatMessageSignal[],
  dismissed: boolean,
  alreadySaved: boolean,
): TriggerState {
  return useMemo(() => {
    if (dismissed)    return { shouldShow: false, reason: 'dismissed' };
    if (alreadySaved) return { shouldShow: false, reason: 'already_saved' };

    const userTurns = messages.filter(m => m.role === 'user').length;
    if (userTurns < 5) return { shouldShow: false, reason: 'too_short' };

    const hasSkill = messages.some(m => {
      if ((m.tool_call_count ?? 0) > 0) return true;
      if (m.role === 'tool') return true;
      const ev = m.evidence ?? {};
      if (Array.isArray(ev.skill_evidence_used) && ev.skill_evidence_used.length > 0) return true;
      if (Array.isArray(ev.tool_calls) && ev.tool_calls.length > 0) return true;
      return false;
    });

    if (!hasSkill) return { shouldShow: false, reason: 'no_skills' };

    return { shouldShow: true, reason: 'eligible' };
  }, [messages, dismissed, alreadySaved]);
}

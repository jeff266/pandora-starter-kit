import { tier0Questions } from './tier-0.js';
import { tier1Questions } from './tier-1.js';
import { tier23Questions } from './tier-2-3.js';
import type { OnboardingQuestion } from '../types.js';

const ALL_QUESTIONS: OnboardingQuestion[] = [...tier0Questions, ...tier1Questions, ...tier23Questions];

export function getAllQuestions(): OnboardingQuestion[] {
  return ALL_QUESTIONS;
}

export function getQuestion(id: string): OnboardingQuestion | undefined {
  return ALL_QUESTIONS.find(q => q.id === id);
}

export function getTier0Questions(): OnboardingQuestion[] {
  return tier0Questions;
}

export function getTier1Questions(): OnboardingQuestion[] {
  return tier1Questions;
}

export function getNextQuestion(currentId: string, answeredIds: Set<string>): OnboardingQuestion | null {
  const order = ALL_QUESTIONS.filter(q => q.tier === 0 || q.tier === 1);
  const currentIdx = order.findIndex(q => q.id === currentId);
  for (let i = currentIdx + 1; i < order.length; i++) {
    const q = order[i];
    if (!answeredIds.has(q.id)) {
      const prereqsMet = q.requires_questions.every(r => answeredIds.has(r));
      if (prereqsMet) return q;
    }
  }
  return null;
}

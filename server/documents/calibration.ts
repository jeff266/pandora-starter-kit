import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { WorkspaceDocumentProfile, CalibrationAnswers } from '../types/document-profile.js';

export interface CalibrationQuestion {
  id: keyof CalibrationAnswers;
  question: string;
  answerType: 'choice' | 'text' | 'example_preference';
  options?: { label: string; value: any }[];
  examples?: { label: string; text: string; value: any }[];
}

export const CALIBRATION_QUESTIONS: CalibrationQuestion[] = [
  {
    id: 'execSummaryLeadsWith',
    question: 'How should the Executive Summary start?',
    answerType: 'choice',
    options: [
      { label: 'Deal Count', value: 'deal_count' },
      { label: 'Revenue Gap', value: 'revenue_gap' },
      { label: 'Pacing Status', value: 'pacing_status' },
      { label: 'Risk Narrative', value: 'risk_narrative' },
    ]
  },
  {
    id: 'repNamingInRisks',
    question: 'How should reps be identified in risk sections?',
    answerType: 'choice',
    options: [
      { label: 'Full Name', value: 'full_name' },
      { label: 'Last Name', value: 'last_name' },
      { label: 'Role Only', value: 'rep_role' },
      { label: 'Anonymous', value: 'anonymous' },
    ]
  },
  {
    id: 'comparisonBlock',
    question: 'What is your preferred comparison baseline?',
    answerType: 'choice',
    options: [
      { label: 'Pacing to Quota', value: 'pacing_to_quota' },
      { label: 'Week over Week', value: 'week_over_week' },
      { label: 'Quarter over Quarter', value: 'quarter_over_quarter' },
    ]
  },
  {
    id: 'recommendationStyle',
    question: 'What is the desired tone for recommendations?',
    answerType: 'example_preference',
    examples: [
      { label: 'Prescriptive', text: 'You must focus on the ABC deal immediately to hit the number.', value: 'prescriptive' },
      { label: 'Suggestive', text: 'I suggest reviewing the ABC deal as it shows signs of slippage.', value: 'suggestive' },
      { label: 'Coaching', text: 'What would happen if we accelerated the ABC deal by 2 weeks?', value: 'coaching_questions' },
    ]
  },
  {
    id: 'primaryAudience',
    question: 'Who is the primary audience for these documents?',
    answerType: 'choice',
    options: [
      { label: 'CRO', value: 'cro' },
      { label: 'VP Sales', value: 'vpsales' },
      { label: 'Front Line Manager', value: 'front_line_manager' },
      { label: 'Sales Ops', value: 'ops' },
    ]
  },
  {
    id: 'execSummaryMaxParagraphs',
    question: 'Max paragraphs for Executive Summary?',
    answerType: 'choice',
    options: [
      { label: '1 Paragraph', value: 1 },
      { label: '2 Paragraphs', value: 2 },
      { label: '3 Paragraphs', value: 3 },
    ]
  }
];

/**
 * Checks if a calibration session should be triggered for a workspace
 */
export async function shouldTriggerCalibration(workspaceId: string): Promise<{ shouldTrigger: boolean; reason?: string }> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  
  // 1. Never calibrated and 3+ docs generated
  if (profile.calibration.completedSessions === 0) {
    const docCount = await countDocumentsGenerated(workspaceId);
    if (docCount >= 3) {
      return { shouldTrigger: true, reason: 'First-time calibration' };
    }
  }

  // 2. Last 2 docs averaged > 0.4 edit distance
  // This would require querying document_edits and calculating average.
  // For now, we'll check the profile's average edit distance if available.
  if (profile.distributionPatterns.averageEditDistance > 0.4) {
      return { shouldTrigger: true, reason: 'High edit rate detected' };
  }

  // 3. Quarterly refresh due
  if (profile.calibration.nextScheduledAt) {
    const nextDate = new Date(profile.calibration.nextScheduledAt);
    if (new Date() >= nextDate) {
      return { shouldTrigger: true, reason: 'Quarterly calibration refresh' };
    }
  }

  return { shouldTrigger: false };
}

/**
 * Counts documents generated (weekly briefs) for a workspace
 */
async function countDocumentsGenerated(workspaceId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int as count FROM weekly_briefs WHERE workspace_id = $1`,
    [workspaceId]
  );
  return result.rows[0]?.count || 0;
}

/**
 * Builds the opening message for a calibration session
 */
export async function buildCalibrationOpeningMessage(workspaceId: string): Promise<string> {
  const voice = await configLoader.getVoiceProfile(workspaceId);
  const persona = voice.persona || 'teammate';
  
  const greetings: Record<string, string> = {
    teammate: "Hey! I've noticed we've been generating a few documents lately. I'd love to spend 3 minutes calibrating my output to match your preferences perfectly. Ready to start?",
    executive: "I've analyzed our recent reporting throughput. To ensure maximum alignment with your strategic objectives, I recommend a brief calibration session. Shall we proceed?",
    analyst: "Data indicates several manual edits to recent outputs. Calibrating our preference parameters will improve baseline accuracy. Can we run through a few questions?"
  };

  return greetings[persona] || greetings.teammate;
}

/**
 * Builds the closing message for a calibration session
 */
export function buildCalibrationClosingMessage(answers: CalibrationAnswers): string {
  return "Perfect, I've updated your workspace profile with these preferences. I'll apply these to all future documents. You can always re-calibrate from your settings.";
}

/**
 * Saves a single calibration answer incrementally
 */
export async function saveCalibrationAnswer(workspaceId: string, questionId: keyof CalibrationAnswers, answer: any): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  const updatedAnswers = {
    ...profile.calibration.answers,
    [questionId]: answer
  };

  await configLoader.updateDocumentProfile(workspaceId, {
    calibration: {
      ...profile.calibration,
      answers: updatedAnswers
    }
  });
}

/**
 * Completes a calibration session
 */
export async function completeCalibration(workspaceId: string, answers: CalibrationAnswers): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  
  const nextScheduledAt = new Date();
  nextScheduledAt.setDate(nextScheduledAt.getDate() + 90); // 90 days

  await configLoader.updateDocumentProfile(workspaceId, {
    calibration: {
      completedAt: new Date().toISOString(),
      completedSessions: (profile.calibration.completedSessions || 0) + 1,
      nextScheduledAt: nextScheduledAt.toISOString(),
      answers: {
        ...profile.calibration.answers,
        ...answers
      }
    }
  });
}

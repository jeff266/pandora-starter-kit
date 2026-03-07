import { diffWords } from 'diff';
import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { 
  DocumentEdit, 
  TrainingPair, 
  SectionPreferences,
  WorkspaceDocumentProfile
} from '../types/document-profile.js';
import { v4 as uuidv4 } from 'uuid';

export interface CaptureEditInput {
  workspaceId: string;
  documentId: string;
  templateType: string;
  sectionId: string;
  rawText: string;
  editedText: string;
  editedBy: string;
  systemPrompt?: string;
  voiceProfileSnapshot?: any;
  quarterPhaseAtTime?: string;
  attainmentPctAtTime?: number;
}

/**
 * Captures a document edit, calculates diffs, extracts signals,
 * and updates both the audit tables and the workspace profile.
 */
export async function captureDocumentEdit(input: CaptureEditInput): Promise<DocumentEdit> {
  const {
    workspaceId,
    documentId,
    templateType,
    sectionId,
    rawText,
    editedText,
    editedBy,
    systemPrompt = '',
    voiceProfileSnapshot = {},
    quarterPhaseAtTime = 'unknown',
    attainmentPctAtTime = 0
  } = input;

  const editDistance = calculateNormalizedEditDistance(rawText, editedText);
  const signals = extractStyleSignals(rawText, editedText);

  const editId = uuidv4();
  const edit: DocumentEdit = {
    id: editId,
    workspace_id: workspaceId,
    document_id: documentId,
    template_type: templateType,
    section_id: sectionId,
    raw_text: rawText,
    edited_text: editedText,
    edit_distance: editDistance,
    derived_signals: signals,
    voice_profile_snapshot: voiceProfileSnapshot,
    quarter_phase_at_time: quarterPhaseAtTime,
    attainment_pct_at_time: attainmentPctAtTime,
    edited_by: editedBy,
    edited_at: new Date().toISOString()
  };

  // Insert into document_edits
  await query(
    `INSERT INTO document_edits (
      id, workspace_id, document_id, template_type, section_id, 
      raw_text, edited_text, edit_distance, derived_signals, 
      voice_profile_snapshot, quarter_phase_at_time, attainment_pct_at_time, 
      edited_by, edited_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      edit.id, edit.workspace_id, edit.document_id, edit.template_type, edit.section_id,
      edit.raw_text, edit.edited_text, edit.edit_distance, edit.derived_signals,
      JSON.stringify(edit.voice_profile_snapshot), edit.quarter_phase_at_time, 
      edit.attainment_pct_at_time, edit.edited_by, edit.edited_at
    ]
  );

  // Create training pair
  const qualityLabel = deriveQualityLabel(editDistance, false, 0);
  const trainingPairId = uuidv4();
  await query(
    `INSERT INTO document_training_pairs (
      id, workspace_id, template_type, section_id, system_prompt_at_time, 
      raw_output, corrected_output, edit_distance, derived_style_signals, 
      quality_label, voice_profile_snapshot, quarter_phase, attainment_pct, 
      pair_type, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      trainingPairId, workspaceId, templateType, sectionId, systemPrompt,
      rawText, editedText, editDistance, signals,
      qualityLabel, JSON.stringify(voiceProfileSnapshot), 
      quarterPhaseAtTime, attainmentPctAtTime, 'document_synthesis', new Date().toISOString()
    ]
  );

  // Update profile
  await updateSectionPreferencesFromEdit(workspaceId, templateType, sectionId, editDistance, signals);

  return edit;
}

/**
 * Derives a quality label based on edit distance and engagement signals.
 */
export function deriveQualityLabel(
  editDistance: number, 
  wasDistributed: boolean, 
  recommendationsActioned: number
): 'good' | 'needs_improvement' | 'poor' {
  if (editDistance < 0.1 && (wasDistributed || recommendationsActioned > 0)) {
    return 'good';
  }
  if (editDistance < 0.4) {
    return 'needs_improvement';
  }
  return 'poor';
}

/**
 * Calculates normalized edit distance (0 to 1) using word-level diff.
 */
export function calculateNormalizedEditDistance(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a || !b) return 1;

  const diffs = diffWords(a, b);
  let changes = 0;
  let totalWords = 0;

  for (const part of diffs) {
    const wordCount = part.value.trim().split(/\s+/).filter(Boolean).length;
    if (part.added || part.removed) {
      changes += wordCount;
    }
    totalWords += wordCount;
  }

  return totalWords === 0 ? 0 : Math.min(changes / totalWords, 1);
}

/**
 * Extracts style signals from an edit.
 */
export function extractStyleSignals(rawText: string, editedText: string): string[] {
  const signals: string[] = [];
  
  const rawWords = rawText.trim().split(/\s+/).filter(Boolean);
  const editedWords = editedText.trim().split(/\s+/).filter(Boolean);

  // 1. Length preference
  if (editedWords.length < rawWords.length * 0.8) {
    signals.push('prefers_brevity');
  } else if (editedWords.length > rawWords.length * 1.2) {
    signals.push('prefers_detail');
  }

  // 2. Hedge removal (weak words)
  const hedges = ['maybe', 'probably', 'likely', 'seems', 'appears', 'think', 'believe', 'possibly'];
  const rawHedges = rawWords.filter(w => hedges.includes(w.toLowerCase())).length;
  const editedHedges = editedWords.filter(w => hedges.includes(w.toLowerCase())).length;
  if (rawHedges > editedHedges + 1) {
    signals.push('removes_hedging');
  }

  // 3. Pronoun changes (we vs I)
  const weWords = ['we', 'our', 'us'];
  const iWords = ['i', 'my', 'me'];
  const rawWe = rawWords.filter(w => weWords.includes(w.toLowerCase())).length;
  const editedWe = editedWords.filter(w => weWords.includes(w.toLowerCase())).length;
  if (editedWe > rawWe) signals.push('prefers_collective_pronouns');
  
  const rawI = rawWords.filter(w => iWords.includes(w.toLowerCase())).length;
  const editedI = editedWords.filter(w => iWords.includes(w.toLowerCase())).length;
  if (editedI > rawI) signals.push('prefers_personal_pronouns');

  // 4. Entity naming (looking for capitalized words not at start of sentence)
  // Simplified: just check if more capitalized words are added
  const isCapitalized = (w: string) => /^[A-Z][a-z]/.test(w);
  const rawCaps = rawWords.filter(isCapitalized).length;
  const editedCaps = editedWords.filter(isCapitalized).length;
  if (editedCaps > rawCaps + 2) {
    signals.push('adds_entity_naming');
  }

  // 5. Opening framing (check first 5 words)
  const rawOpening = rawWords.slice(0, 5).join(' ').toLowerCase();
  const editedOpening = editedWords.slice(0, 5).join(' ').toLowerCase();
  if (rawOpening !== editedOpening) {
    if (editedOpening.includes('summary') || editedOpening.includes('overall')) {
      signals.push('prefers_direct_opening');
    }
  }

  // 6. Numbers added/removed
  const hasNumber = (w: string) => /\d/.test(w);
  const rawNums = rawWords.filter(hasNumber).length;
  const editedNums = editedWords.filter(hasNumber).length;
  if (editedNums > rawNums) {
    signals.push('prefers_data_points');
  } else if (rawNums > editedNums) {
    signals.push('removes_data_points');
  }

  return [...new Set(signals)];
}

/**
 * Updates section preferences and overall profile metrics.
 */
export async function updateSectionPreferencesFromEdit(
  workspaceId: string,
  templateType: string,
  sectionId: string,
  editDistance: number,
  signals: string[]
): Promise<void> {
  const profile = await configLoader.getDocumentProfile(workspaceId);
  const key = `${templateType}:${sectionId}`;
  
  const currentPrefs = profile.sectionPreferences[key] || {
    templateType,
    sectionId,
    averageEditDistance: 0,
    editCount: 0,
    styleSignals: []
  };

  // Accumulate signals, deduplicate, keep top 5 (most frequent)
  // Since we don't have frequency tracking in SectionPreferences, we'll just append and dedupe for now
  // or just append and unique.
  const updatedSignals = [...new Set([...currentPrefs.styleSignals, ...signals])].slice(0, 5);

  const updatedPrefs: SectionPreferences = {
    ...currentPrefs,
    averageEditDistance: (currentPrefs.averageEditDistance * currentPrefs.editCount + editDistance) / (currentPrefs.editCount + 1),
    editCount: currentPrefs.editCount + 1,
    styleSignals: updatedSignals,
    lastEditedAt: new Date().toISOString()
  };

  const updatedProfile: Partial<WorkspaceDocumentProfile> = {
    sectionPreferences: {
      ...profile.sectionPreferences,
      [key]: updatedPrefs
    },
    distributionPatterns: {
      ...profile.distributionPatterns,
      averageEditDistance: (profile.distributionPatterns.averageEditDistance * profile.distributionPatterns.trainingPairsCount + editDistance) / (profile.distributionPatterns.trainingPairsCount + 1),
      trainingPairsCount: profile.distributionPatterns.trainingPairsCount + 1
    }
  };

  await configLoader.updateDocumentProfile(workspaceId, updatedProfile);
}

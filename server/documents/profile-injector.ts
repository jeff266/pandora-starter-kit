import { WorkspaceDocumentProfile, SectionPreferences } from '../types/document-profile.js';

/**
 * Builds a profile-aware system prompt segment based on calibration and edit history.
 * 
 * Applies calibration-derived instructions and edit-history-derived instructions.
 */
export function buildProfileAwareSystemPrompt(
  profile: WorkspaceDocumentProfile,
  templateType: string,
  sectionId: string,
  basePrompt: string
): string {
  const instructions: string[] = [];

  // 1. Apply Calibration-derived instructions
  const { answers } = profile.calibration;
  
  if (answers) {
    // execSummaryLeadsWith
    if (sectionId === 'executive_summary' && answers.execSummaryLeadsWith) {
      const mapping: Record<string, string> = {
        deal_count: "Lead the executive summary with a focus on total deal count and volume changes.",
        revenue_gap: "Lead the executive summary by highlighting the current revenue gap vs target.",
        pacing_status: "Lead the executive summary with a clear assessment of pacing status (ahead/on-track/behind).",
        risk_narrative: "Lead the executive summary with the most critical risk narrative first."
      };
      if (mapping[answers.execSummaryLeadsWith]) {
        instructions.push(mapping[answers.execSummaryLeadsWith]);
      }
    }

    // repNamingInRisks
    if (sectionId === 'risks' && answers.repNamingInRisks) {
      const mapping: Record<string, string> = {
        full_name: "When mentioning risks associated with specific reps, use their full names.",
        last_name: "When mentioning risks associated with specific reps, use only their last names.",
        rep_role: "Refer to reps by their specific roles (e.g., 'the account executive') rather than by name.",
        anonymous: "Keep rep identities anonymous when discussing risks."
      };
      if (mapping[answers.repNamingInRisks]) {
        instructions.push(mapping[answers.repNamingInRisks]);
      }
    }

    // recommendationStyle
    if (answers.recommendationStyle) {
      const mapping: Record<string, string> = {
        prescriptive: "Write recommendations in a prescriptive, authoritative 'do this' style.",
        suggestive: "Write recommendations in a suggestive, 'consider this' style.",
        coaching_questions: "Frame recommendations as coaching questions for the team to reflect on."
      };
      if (mapping[answers.recommendationStyle]) {
        instructions.push(mapping[answers.recommendationStyle]);
      }
    }

    // audienceExpectation (primaryAudience)
    if (answers.primaryAudience) {
      const mapping: Record<string, string> = {
        cro: "Tailor the tone and level of detail for a CRO who needs high-level strategic impact.",
        vpsales: "Tailor the tone for a VP of Sales focused on quarterly targets and resource allocation.",
        front_line_manager: "Tailor the tone for a Front Line Manager focused on specific deal execution and coaching.",
        ops: "Tailor the tone for Sales Ops focused on data integrity and process compliance."
      };
      if (mapping[answers.primaryAudience]) {
        instructions.push(mapping[answers.primaryAudience]);
      }
    }

    // execSummaryMaxParagraphs
    if (sectionId === 'executive_summary' && answers.execSummaryMaxParagraphs) {
      instructions.push(`Limit the executive summary to no more than ${answers.execSummaryMaxParagraphs} paragraphs.`);
    }
  }

  // 2. Apply Edit-history-derived instructions
  const key = `${templateType}:${sectionId}`;
  const sectionPrefs = profile.sectionPreferences[key];

  if (sectionPrefs && sectionPrefs.styleSignals) {
    const signals = sectionPrefs.styleSignals;
    
    // Mapping 8 signals to instructions
    if (signals.includes('prefers_shorter_sentences')) {
      instructions.push("Use shorter, punchier sentences for clarity.");
    }
    if (signals.includes('removes_hedging')) {
      instructions.push("Avoid hedging language (e.g., 'seems to', 'appears that'). Be direct.");
    }
    if (signals.includes('prefers_we_pronouns')) {
      instructions.push("Use 'we' and 'us' to emphasize collective team ownership.");
    }
    if (signals.includes('prefers_anonymous_reps')) {
      instructions.push("Do not name specific sales representatives; refer to roles or the team generally.");
    }
    if (signals.includes('prefers_direct_naming')) {
      instructions.push("Always name specific accounts and individuals directly.");
    }
    if (signals.includes('removes_opening_framing')) {
      instructions.push("Skip introductory framing or pleasantries; dive straight into the data.");
    }
    if (signals.includes('adds_data_points')) {
      instructions.push("Incorporate specific numerical data points and metrics wherever possible.");
    }
    if (signals.includes('removes_complex_jargon')) {
      instructions.push("Avoid complex sales jargon; use plain, business-ready English.");
    }
  }

  if (instructions.length === 0) {
    return basePrompt;
  }

  const profileContext = `
[USER PREFERENCES & STYLE GUIDES]
${instructions.map(i => `- ${i}`).join('\n')}
`;

  return `${basePrompt}\n${profileContext}`;
}

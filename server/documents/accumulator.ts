import { 
  AccumulatedDocument, 
  DocumentTemplateType, 
  DocumentContribution, 
  TEMPLATE_CONFIGS 
} from './types.js';

export function createAccumulatedDocument(
  sessionId: string, 
  workspaceId: string, 
  templateType: DocumentTemplateType = 'WBR'
): AccumulatedDocument {
  const config = TEMPLATE_CONFIGS[templateType];
  return {
    sessionId,
    workspaceId,
    templateType,
    sections: config.sections.map(s => ({
      id: s.id,
      title: s.title,
      content: []
    })),
    lastUpdated: new Date().toISOString()
  };
}

export function autoSlotContribution(
  contribution: DocumentContribution, 
  templateType: DocumentTemplateType
): string {
  // Simple heuristic-based slotting
  const title = (contribution.title || '').toLowerCase();
  const body = (contribution.body || '').toLowerCase();
  const type = contribution.type;

  if (templateType === 'WBR') {
    if (contribution.severity === 'critical' || title.includes('risk') || title.includes('blocker')) return 'key_risks';
    if (title.includes('forecast') || title.includes('attainment') || title.includes('quota')) return 'forecast_status';
    if (title.includes('pipeline') || title.includes('coverage') || title.includes('conversion')) return 'pipeline_dynamics';
    if (type === 'recommendation' || title.includes('action') || title.includes('next step')) return 'next_steps';
    return 'executive_summary';
  }

  if (templateType === 'DEAL_REVIEW') {
    if (title.includes('stakeholder') || title.includes('champion') || title.includes('economic buyer')) return 'stakeholder_map';
    if (title.includes('competitor') || title.includes('vs')) return 'competitive_situation';
    if (contribution.severity === 'critical' || title.includes('risk')) return 'risk_mitigation';
    if (type === 'recommendation') return 'win_plan';
    return 'deal_overview';
  }

  // Fallback to first section
  return TEMPLATE_CONFIGS[templateType].sections[0].id;
}

export function addContribution(
  doc: AccumulatedDocument, 
  contribution: DocumentContribution
): void {
  const targetSectionId = contribution.user_overridden_section || autoSlotContribution(contribution, doc.templateType);
  
  const section = doc.sections.find(s => s.id === targetSectionId);
  if (section) {
    // Prevent duplicates
    if (!section.content.some(c => c.id === contribution.id)) {
      section.content.push(contribution);
      doc.lastUpdated = new Date().toISOString();
    }
  }
}

export function overrideSection(
  doc: AccumulatedDocument, 
  contributionId: string, 
  targetSectionId: string
): void {
  let foundContribution: DocumentContribution | null = null;
  
  // Remove from existing section
  for (const section of doc.sections) {
    const index = section.content.findIndex(c => c.id === contributionId);
    if (index !== -1) {
      foundContribution = section.content.splice(index, 1)[0];
      break;
    }
  }

  // Add to new section
  if (foundContribution) {
    const targetSection = doc.sections.find(s => s.id === targetSectionId);
    if (targetSection) {
      foundContribution.user_overridden_section = targetSectionId;
      targetSection.content.push(foundContribution);
      doc.lastUpdated = new Date().toISOString();
    }
  }
}

export function removeContribution(
  doc: AccumulatedDocument, 
  contributionId: string
): void {
  for (const section of doc.sections) {
    const index = section.content.findIndex(c => c.id === contributionId);
    if (index !== -1) {
      section.content.splice(index, 1);
      doc.lastUpdated = new Date().toISOString();
      break;
    }
  }
}

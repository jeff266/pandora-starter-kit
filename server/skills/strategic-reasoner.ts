import { callLLM } from '../utils/llm-router.js';
import { buildMemoryContextBlock } from '../memory/workspace-memory.js';

export interface StrategicReasoningOutput {
  question: string;
  hypothesis: string;
  supportingEvidence: Array<{ label: string; value: string }>;
  contradictingEvidence: Array<{ label: string; value: string }>;
  recommendation: string;
  tradeoffs: string[];
  watchFor: string[];
  confidence: number;
  confidenceReason: string;
  memoryContext?: string;
}

const STRATEGIC_PATTERNS = [
  /\bwhy\s+do\s+we\s+keep\b/i,
  /\bwhy\s+does\s+this\s+always\b/i,
  /\bshould\s+we\b/i,
  /\bwhat\s+should\s+we\s+change\b/i,
  /\bwhat's\s+the\s+root\s+cause\s+of\b/i,
  /\bnext\s+quarter\b/i,
  /\bis\s+our\s+.*\s+right\b/i,
  /\bstrategic\b/i,
  /\broot\s+cause\b/i,
  /\blong-term\b/i
];

export function classifyStrategicQuestion(message: string): boolean {
  return STRATEGIC_PATTERNS.some(pattern => pattern.test(message));
}

export async function runStrategicReasoning(
  workspaceId: string,
  question: string,
  sessionContext: any,
  workspaceMemories: any[]
): Promise<StrategicReasoningOutput> {
  const memoryBlock = await buildMemoryContextBlock(workspaceId);
  
  const systemPrompt = `You are a strategic advisor and teammate, not a consultant. Use "we" and "our" when referring to the company and its goals.
Your task is to perform deep strategic reasoning on the provided question.

Structure your response using the following sections:
HYPOTHESIS: A bold, clear statement of what you believe is happening.
SUPPORTING EVIDENCE: Bullet points of data or observations that support the hypothesis.
CONTRADICTING EVIDENCE: Bullet points of data or observations that don't fit the hypothesis or suggest a different path.
RECOMMENDATION: Clear, actionable advice on what we should do next.
TRADEOFFS: What are we giving up or risking by following this recommendation?
WATCH FOR: Specific signals or metrics that would prove this hypothesis wrong in the coming weeks.
CONFIDENCE: A number between 0 and 100.
CONFIDENCE REASON: Why did you pick this confidence level?

Context:
${memoryBlock}

Session Context:
${JSON.stringify(sessionContext.computedThisSession)}

Recurring Findings:
${workspaceMemories.filter(m => m.occurrence_count >= 3).map(m => `- ${m.summary} (Seen ${m.occurrence_count} times)`).join('\n')}
`;

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt,
    messages: [{ role: 'user', content: question }],
    temperature: 0.2
  });

  return parseStrategicOutput(response.content, question, memoryBlock);
}

function parseStrategicOutput(content: string, question: string, memoryContext: string): StrategicReasoningOutput {
  const sections: Record<string, string> = {};
  const currentSection = "";
  
  const lines = content.split('\n');
  let activeSection = "";

  for (const line of lines) {
    const match = line.match(/^(HYPOTHESIS|SUPPORTING EVIDENCE|CONTRADICTING EVIDENCE|RECOMMENDATION|TRADEOFFS|WATCH FOR|CONFIDENCE|CONFIDENCE REASON):/i);
    if (match) {
      activeSection = match[1].toUpperCase();
      sections[activeSection] = line.substring(match[0].length).trim();
    } else if (activeSection) {
      sections[activeSection] += '\n' + line;
    }
  }

  const parseBullets = (text: string) => {
    if (!text) return [];
    return text.split('\n')
      .map(l => l.trim().replace(/^[-*•]\s*/, ''))
      .filter(l => l.length > 0);
  };

  const parseEvidence = (text: string) => {
    return parseBullets(text).map(b => {
      const parts = b.split(':');
      if (parts.length > 1) {
        return { label: parts[0].trim(), value: parts.slice(1).join(':').trim() };
      }
      return { label: 'Observation', value: b };
    });
  };

  return {
    question,
    hypothesis: sections['HYPOTHESIS'] || '',
    supportingEvidence: parseEvidence(sections['SUPPORTING EVIDENCE'] || ''),
    contradictingEvidence: parseEvidence(sections['CONTRADICTING EVIDENCE'] || ''),
    recommendation: sections['RECOMMENDATION'] || '',
    tradeoffs: parseBullets(sections['TRADEOFFS'] || ''),
    watchFor: parseBullets(sections['WATCH FOR'] || ''),
    confidence: parseInt(sections['CONFIDENCE']) || 0,
    confidenceReason: sections['CONFIDENCE REASON'] || '',
    memoryContext
  };
}

/**
 * Conversation Summarizer
 *
 * Generates concise summaries from conversation transcripts using DeepSeek.
 * Summaries are 150-200 words, factual prose format.
 */

import { callLLM } from '../utils/llm-router.js';

export interface ConversationInput {
  id: string;
  title: string | null;
  transcript_text: string;
  duration_seconds: number | null;
  participants: any[];
}

/**
 * Generate a summary from a conversation transcript
 * Uses DeepSeek (extract capability) for cost efficiency - 10x cheaper than Claude
 * Truncates transcript to 6,000 characters for cost control
 */
export async function generateConversationSummary(
  workspaceId: string,
  conversation: ConversationInput
): Promise<string> {
  // Truncate transcript for cost control (full transcripts can be enormous)
  const truncatedTranscript = conversation.transcript_text.substring(0, 6000);

  // Format participants as display names or emails
  const participantList = formatParticipants(conversation.participants);

  const prompt = `Summarize this sales conversation in 150-200 words.

Title: ${conversation.title ?? 'Untitled call'}
Duration: ${Math.round((conversation.duration_seconds ?? 0) / 60)} minutes
Participants: ${participantList}

Transcript excerpt:
${truncatedTranscript}

Focus on:
- Key topics discussed
- Customer questions, objections, or concerns raised
- Next steps or commitments made by either party
- Overall tone and momentum

Write a concise factual summary. No bullet points — prose only.`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      temperature: 0.1,
      _tracking: {
        feature: 'conversation_summary',
        subFeature: 'generate',
      } as any,
    });

    return response.content.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Summarizer] Failed to generate summary for conversation ${conversation.id}:`, msg);
    throw new Error(`Failed to generate summary: ${msg}`);
  }
}

/**
 * Format participants array as comma-separated list of names or emails
 */
function formatParticipants(participants: any[]): string {
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return 'Unknown';
  }

  const names = participants
    .map((p: any) => {
      if (typeof p === 'string') return p;
      if (p.name) return p.name;
      if (p.email) return p.email;
      return null;
    })
    .filter(Boolean);

  return names.length > 0 ? names.join(', ') : 'Unknown';
}

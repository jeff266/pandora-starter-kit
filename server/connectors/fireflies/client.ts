import type { FirefliesTranscript, FirefliesSentence } from './types.js';
import { paginatedFetchWithRetry } from '../../utils/retry.js';

const GRAPHQL_ENDPOINT = 'https://api.fireflies.ai/graphql';
const PAGE_SIZE = 50;

const LIGHTWEIGHT_TRANSCRIPTS_QUERY = `
query Transcripts($limit: Int, $skip: Int) {
  transcripts(limit: $limit, skip: $skip) {
    id
    title
    date
    duration
    transcript_url
    audio_url
    summary {
      overview
      action_items
      keywords
    }
    participants
    meeting_attendees {
      name
      email
      displayName
      phoneNumber
    }
    host_email
    organizer_email
  }
}`;

const FULL_TRANSCRIPT_QUERY = `
query Transcript($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id
    title
    date
    duration
    transcript_url
    audio_url
    summary {
      overview
      action_items
      keywords
    }
    participants
    meeting_attendees {
      name
      email
      displayName
      phoneNumber
    }
    host_email
    organizer_email
    sentences {
      speaker_name
      speaker_id
      text
      start_time
      end_time
    }
  }
}`;

const USER_QUERY = `
query {
  user {
    email
    name
  }
}`;

export function parseFirefliesDate(transcript: FirefliesTranscript): Date | null {
  if (!transcript.date) return null;
  const ms = Number(transcript.date);
  if (isNaN(ms)) return null;
  return new Date(ms);
}

export function formatSentencesToTranscript(sentences: FirefliesSentence[]): string {
  if (!sentences || sentences.length === 0) return '';

  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentTexts: string[] = [];

  for (const sentence of sentences) {
    const speaker = sentence.speaker_name || sentence.speaker_id || 'Unknown';

    if (speaker !== currentSpeaker) {
      if (currentSpeaker !== null && currentTexts.length > 0) {
        lines.push(`${currentSpeaker}: ${currentTexts.join(' ')}`);
      }
      currentSpeaker = speaker;
      currentTexts = [sentence.text];
    } else {
      currentTexts.push(sentence.text);
    }
  }

  if (currentSpeaker !== null && currentTexts.length > 0) {
    lines.push(`${currentSpeaker}: ${currentTexts.join(' ')}`);
  }

  return lines.join('\n');
}

export class FirefliesClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async graphql<T>(queryStr: string, variables: Record<string, any> = {}): Promise<T> {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: queryStr, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fireflies API error: ${response.status} - ${errorText}`);
    }

    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors && json.errors.length > 0) {
      throw new Error(`Fireflies GraphQL error: ${json.errors.map(e => e.message).join(', ')}`);
    }

    return json.data as T;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    try {
      const data = await this.graphql<{ user: { email: string; name: string } }>(USER_QUERY);
      return {
        success: true,
        accountInfo: {
          email: data.user.email,
          name: data.user.name,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getTranscriptsPage(options?: {
    limit?: number;
    skip?: number;
    afterDate?: Date;
  }): Promise<FirefliesTranscript[]> {
    const limit = options?.limit ?? PAGE_SIZE;
    const skip = options?.skip ?? 0;

    const data = await this.graphql<{ transcripts: FirefliesTranscript[] }>(
      LIGHTWEIGHT_TRANSCRIPTS_QUERY,
      { limit, skip }
    );

    let transcripts = data.transcripts || [];

    if (options?.afterDate) {
      const afterMs = options.afterDate.getTime();
      transcripts = transcripts.filter(t => {
        const date = parseFirefliesDate(t);
        return date !== null && date.getTime() >= afterMs;
      });
    }

    return transcripts;
  }

  async getAllTranscripts(options?: {
    afterDate?: Date;
    maxPages?: number;
    onProgress?: (totalFetched: number, pageNumber: number) => void;
  }): Promise<FirefliesTranscript[]> {
    const afterDate = options?.afterDate;

    const allTranscripts = await paginatedFetchWithRetry<FirefliesTranscript>(
      async (pageNumber: number) => {
        const skip = pageNumber * PAGE_SIZE;
        const data = await this.graphql<{ transcripts: FirefliesTranscript[] }>(
          LIGHTWEIGHT_TRANSCRIPTS_QUERY,
          { limit: PAGE_SIZE, skip }
        );

        const transcripts = data.transcripts || [];

        if (transcripts.length === 0) return [];

        if (afterDate) {
          const afterMs = afterDate.getTime();
          const filtered = transcripts.filter(t => {
            const date = parseFirefliesDate(t);
            return date !== null && date.getTime() >= afterMs;
          });

          if (filtered.length === 0 && transcripts.length > 0) {
            const oldestDate = transcripts.reduce((oldest, t) => {
              const d = parseFirefliesDate(t);
              if (!d) return oldest;
              return oldest === null || d.getTime() < oldest.getTime() ? d : oldest;
            }, null as Date | null);

            if (oldestDate && oldestDate.getTime() < afterMs) {
              return [];
            }
          }

          return filtered;
        }

        return transcripts;
      },
      {
        maxPages: options?.maxPages ?? 20,
        onProgress: options?.onProgress,
      }
    );

    return allTranscripts;
  }

  async getTranscript(transcriptId: string): Promise<FirefliesTranscript> {
    const data = await this.graphql<{ transcript: FirefliesTranscript }>(
      FULL_TRANSCRIPT_QUERY,
      { transcriptId }
    );

    if (!data.transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    return data.transcript;
  }
}

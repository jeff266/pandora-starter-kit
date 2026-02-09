// Fireflies API Client for Pandora
// Extracted from RevOps Copilot - includes sophisticated pagination with retry logic

import type { FirefliesTranscript } from './types';
import { paginatedFetchWithRetry } from '../../utils/retry';

export class FirefliesClient {
  private apiKey: string;
  private baseUrl = "https://api.fireflies.ai/graphql";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const query = `
        query {
          user {
            email
            name
          }
        }
      `;

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        return { success: false, error: `API returned ${response.status}` };
      }

      const data = await response.json();

      if (data.errors) {
        return { success: false, error: data.errors[0]?.message || "Unknown error" };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed"
      };
    }
  }

  async getTranscriptsPage(options?: {
    limit?: number;
    skip?: number;
    afterDate?: Date;
  }): Promise<FirefliesTranscript[]> {
    const limit = Math.min(options?.limit || 50, 50); // API max is 50
    const skip = options?.skip || 0;

    const query = `
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
          sentences {
            speaker_name
            speaker_id
            text
            start_time
            end_time
          }
        }
      }
    `;

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        variables: { limit, skip }
      }),
    });

    if (!response.ok) {
      let errorDetails = "";
      try {
        const errorBody = await response.text();
        errorDetails = errorBody ? `: ${errorBody.substring(0, 200)}` : "";
      } catch {}
      throw new Error(`Fireflies API error: ${response.status}${errorDetails}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error("Fireflies GraphQL errors:", JSON.stringify(data.errors, null, 2));
      throw new Error(data.errors[0]?.message || "GraphQL error");
    }

    let transcripts = data.data?.transcripts || [];

    // Filter by date if specified
    // EDGE CASE: API doesn't support afterDate natively, so filter client-side
    if (options?.afterDate) {
      const afterMs = options.afterDate.getTime();
      transcripts = transcripts.filter((t: FirefliesTranscript) => {
        const transcriptMs = typeof t.date === 'string' ? parseFloat(t.date) : t.date;
        return transcriptMs >= afterMs;
      });
    }

    return transcripts;
  }

  /**
   * Fetch ALL transcripts using pagination with retry logic
   * Uses the exponential backoff pattern from utils/retry.ts
   */
  async getAllTranscripts(options?: {
    afterDate?: Date;
    maxPages?: number;
    onProgress?: (fetched: number) => void;
  }): Promise<FirefliesTranscript[]> {
    const PAGE_SIZE = 50; // Fireflies API max

    // Use the paginated fetch utility with retry
    const allTranscripts = await paginatedFetchWithRetry(
      async (pageNum) => {
        const skip = pageNum * PAGE_SIZE;
        return this.getTranscriptsPage({
          limit: PAGE_SIZE,
          skip,
          afterDate: options?.afterDate,
        });
      },
      {
        maxPages: options?.maxPages || 20, // Default 1000 transcripts max
        pageDelay: 200, // 200ms between requests (be nice to API)
        consecutiveErrorLimit: 3, // Stop if 3 consecutive errors
        onProgress: options?.onProgress,
        retryConfig: {
          maxRetries: 3,
          baseDelay: 1000, // 1s, 2s, 4s exponential backoff
          backoffFactor: 2,
        },
      }
    );

    return allTranscripts;
  }

  async getTranscript(transcriptId: string): Promise<FirefliesTranscript | null> {
    const query = `
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
      }
    `;

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        variables: { transcriptId }
      }),
    });

    if (!response.ok) {
      let errorDetails = "";
      try {
        const errorBody = await response.text();
        errorDetails = errorBody ? `: ${errorBody.substring(0, 200)}` : "";
      } catch {}
      throw new Error(`Fireflies API error: ${response.status}${errorDetails}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error("Fireflies GraphQL errors:", JSON.stringify(data.errors, null, 2));
      throw new Error(data.errors[0]?.message || "GraphQL error");
    }

    return data.data?.transcript || null;
  }
}

// Helper: Parse Fireflies date (milliseconds from EPOCH)
export function parseFirefliesDate(transcript: FirefliesTranscript): Date {
  const ms = typeof transcript.date === 'string' ? parseFloat(transcript.date) : transcript.date;
  return new Date(ms);
}

// Helper: Format sentences to readable transcript with speaker consolidation
// EDGE CASE: Groups consecutive sentences by same speaker for readability
export function formatSentencesToTranscript(sentences: FirefliesTranscript['sentences']): string | null {
  if (!sentences || sentences.length === 0) {
    return null;
  }

  const lines: string[] = [];
  let currentSpeaker = "";
  let currentText: string[] = [];

  for (const sentence of sentences) {
    const speaker = sentence.speaker_name || "Unknown";

    // When speaker changes, flush the current buffer
    if (speaker !== currentSpeaker && currentText.length > 0) {
      lines.push(`${currentSpeaker}: ${currentText.join(" ")}`);
      currentText = [];
    }

    currentSpeaker = speaker;
    if (sentence.text?.trim()) {
      currentText.push(sentence.text.trim());
    }
  }

  // Flush final speaker's text
  if (currentText.length > 0) {
    lines.push(`${currentSpeaker}: ${currentText.join(" ")}`);
  }

  return lines.length > 0 ? lines.join("\n\n") : null;
}

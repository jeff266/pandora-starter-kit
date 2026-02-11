import type { GongCall, GongParty, GongTranscript, GongUser } from './types.js';
import { RateLimiter } from '../../utils/retry.js';

interface GongListCallsResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  calls: GongCall[];
}

interface GongTranscriptsResponse {
  requestId: string;
  callTranscripts: GongTranscript[];
}

interface GongUsersResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  users: GongUser[];
}

export class GongClient {
  private baseUrl = "https://api.gong.io/v2";
  private accessKey: string;
  private accessKeySecret: string;
  private rateLimiter = new RateLimiter(100, 60_000);

  constructor(apiKey: string) {
    const [key, secret] = apiKey.split(":");
    this.accessKey = key;
    this.accessKeySecret = secret;
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.accessKey}:${this.accessKeySecret}`).toString("base64");
    return `Basic ${credentials}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.rateLimiter.execute(async () => {
      return this.requestWithRetry<T>(endpoint, options);
    });
  }

  private async requestWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
    attempt = 1,
    maxAttempts = 3
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": this.getAuthHeader(),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Handle 429 rate limit with exponential backoff
    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s

      console.warn(`[Gong Client] Rate limited (429), retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return this.requestWithRetry<T>(endpoint, options, attempt + 1, maxAttempts);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gong API error: ${response.status} - ${errorText}`);
    }

    return response.json() as T;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    try {
      const response = await this.request<GongUsersResponse>("/users?cursor=");
      return {
        success: true,
        accountInfo: {
          totalUsers: response.records.totalRecords,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getCalls(fromDate?: string, toDate?: string, cursor?: string): Promise<GongListCallsResponse> {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDateTime", fromDate);
    if (toDate) params.set("toDateTime", toDate);
    if (cursor) params.set("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/calls${queryString ? `?${queryString}` : ""}`;
    return this.request<GongListCallsResponse>(endpoint);
  }

  async getAllCalls(fromDate?: string, toDate?: string): Promise<GongCall[]> {
    const allCalls: GongCall[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getCalls(fromDate, toDate, cursor);
      if (response.calls && response.calls.length > 0) {
        allCalls.push(...response.calls);
      }
      cursor = response.records.cursor;
      console.log(`[Gong Client] Fetched ${allCalls.length} calls so far`);
    } while (cursor);

    return allCalls;
  }

  async getTranscripts(callIds: string[]): Promise<GongTranscript[]> {
    const response = await this.request<GongTranscriptsResponse>("/calls/transcript", {
      method: "POST",
      body: JSON.stringify({ filter: { callIds } }),
    });
    return response.callTranscripts || [];
  }

  async getCallWithTranscript(callId: string): Promise<{ call: GongCall; transcript: GongTranscript | null }> {
    const params = new URLSearchParams();
    params.set("callIds", callId);
    const callsResponse = await this.request<GongListCallsResponse>(`/calls?${params.toString()}`);
    const call = callsResponse.calls?.[0];
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }

    const transcripts = await this.getTranscripts([callId]);
    const transcript = transcripts.length > 0 ? transcripts[0] : null;

    return { call, transcript };
  }

  async getUsers(cursor?: string): Promise<GongUsersResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);

    const queryString = params.toString();
    const endpoint = `/users${queryString ? `?${queryString}` : ""}`;
    return this.request<GongUsersResponse>(endpoint);
  }

  async getAllUsers(): Promise<GongUser[]> {
    const allUsers: GongUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getUsers(cursor);
      if (response.users && response.users.length > 0) {
        allUsers.push(...response.users);
      }
      cursor = response.records.cursor;
      console.log(`[Gong Client] Fetched ${allUsers.length} users so far`);
    } while (cursor);

    return allUsers;
  }

  formatTranscriptAsText(transcript: GongTranscript, parties: GongParty[]): string {
    const speakerMap = new Map<string, string>();
    for (const party of parties) {
      if (party.speakerId) {
        speakerMap.set(party.speakerId, party.name || party.emailAddress || `Speaker ${party.speakerId}`);
      }
    }

    const lines: string[] = [];
    for (const segment of transcript.transcript) {
      const speakerName = speakerMap.get(segment.speakerId) || `Speaker ${segment.speakerId}`;
      if (segment.topic) {
        lines.push(`\n[${segment.topic}]`);
      }
      for (const sentence of segment.sentences) {
        lines.push(`${speakerName}: ${sentence.text}`);
      }
    }

    return lines.join("\n").trim();
  }
}

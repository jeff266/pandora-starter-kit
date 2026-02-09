// Gong API Client for Pandora
// Extracted from RevOps Copilot

import type { GongCall, GongParty, GongTranscript, GongUser } from './types';

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

  constructor(apiKey: string) {
    // Gong API key format: "accessKey:accessKeySecret" or "accessKey:jwt"
    const [key, secret] = apiKey.split(":");
    this.accessKey = key;
    this.accessKeySecret = secret;
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.accessKey}:${this.accessKeySecret}`).toString("base64");
    return `Basic ${credentials}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": this.getAuthHeader(),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gong API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request<GongUsersResponse>("/users?cursor=");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getCalls(fromDate?: Date, toDate?: Date, cursor?: string): Promise<GongListCallsResponse> {
    // Build query parameters - Gong v2 /calls uses GET with query params
    const params = new URLSearchParams();

    if (fromDate) {
      params.append("fromDateTime", fromDate.toISOString());
    }
    if (toDate) {
      params.append("toDateTime", toDate.toISOString());
    }
    if (cursor) {
      params.append("cursor", cursor);
    }

    const queryString = params.toString();
    const endpoint = queryString ? `/calls?${queryString}` : "/calls";

    return this.request<GongListCallsResponse>(endpoint, {
      method: "GET",
    });
  }

  async getAllCalls(fromDate?: Date, toDate?: Date): Promise<GongCall[]> {
    const allCalls: GongCall[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getCalls(fromDate, toDate, cursor);
      allCalls.push(...response.calls);
      cursor = response.records.cursor;
    } while (cursor);

    return allCalls;
  }

  async getTranscripts(callIds: string[]): Promise<GongTranscript[]> {
    if (callIds.length === 0) return [];

    const response = await this.request<GongTranscriptsResponse>("/calls/transcript", {
      method: "POST",
      body: JSON.stringify({
        filter: {
          callIds: callIds,
        },
      }),
    });

    return response.callTranscripts;
  }

  async getCallWithTranscript(callId: string): Promise<{ call: GongCall; transcript: GongTranscript | null }> {
    // Use GET with callIds query parameter
    const callsResponse = await this.request<GongListCallsResponse>(`/calls?callIds=${callId}`, {
      method: "GET",
    });

    const call = callsResponse.calls[0];
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }

    const transcripts = await this.getTranscripts([callId]);
    const transcript = transcripts.find(t => t.callId === callId) || null;

    return { call, transcript };
  }

  async getUsers(cursor?: string): Promise<GongUsersResponse> {
    let endpoint = "/users";
    if (cursor) {
      endpoint += `?cursor=${cursor}`;
    }
    return this.request<GongUsersResponse>(endpoint);
  }

  async getAllUsers(): Promise<GongUser[]> {
    const allUsers: GongUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getUsers(cursor);
      allUsers.push(...response.users);
      cursor = response.records.cursor;
    } while (cursor);

    return allUsers;
  }

  formatTranscriptAsText(transcript: GongTranscript, parties: GongParty[]): string {
    const speakerMap = new Map<string, string>();
    for (const party of parties) {
      if (party.speakerId) {
        speakerMap.set(party.speakerId, party.name || party.emailAddress || "Unknown");
      }
    }

    const lines: string[] = [];
    for (const segment of transcript.transcript) {
      const speakerName = speakerMap.get(segment.speakerId) || `Speaker ${segment.speakerId}`;
      const text = segment.sentences.map(s => s.text).join(" ");
      lines.push(`${speakerName}: ${text}`);
    }

    return lines.join("\n\n");
  }
}

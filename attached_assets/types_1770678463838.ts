// Gong API Type Definitions

export interface GongCall {
  id: string;
  title: string;
  scheduled: string;
  started: string;
  duration: number;
  primaryUserId: string;
  direction: "Inbound" | "Outbound" | "Conference";
  scope: "Internal" | "External";
  media: "Video" | "Audio";
  language: string;
  url: string;
  parties: GongParty[];
}

export interface GongParty {
  id: string;
  emailAddress?: string;
  name?: string;
  title?: string;
  userId?: string;
  speakerId?: string;
  affiliation: "Internal" | "External" | "Unknown";
}

export interface GongTranscript {
  callId: string;
  transcript: GongTranscriptSegment[];
}

export interface GongTranscriptSegment {
  speakerId: string;
  topic?: string;
  sentences: GongSentence[];
}

export interface GongSentence {
  start: number;
  end: number;
  text: string;
}

export interface GongUser {
  id: string;
  emailAddress: string;
  firstName: string;
  lastName: string;
  title?: string;
  managerId?: string;
  active: boolean;
}

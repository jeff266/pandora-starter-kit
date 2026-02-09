// Fireflies API Type Definitions

export interface FirefliesMeetingAttendee {
  name?: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
}

export interface FirefliesSentence {
  speaker_name?: string;
  speaker_id?: string;
  text: string;
  start_time?: number;
  end_time?: number;
}

export interface FirefliesTranscript {
  id: string;
  title: string;
  date: string; // milliseconds from EPOCH
  duration: number;
  transcript_url?: string;
  audio_url?: string;
  summary?: {
    overview?: string;
    action_items?: string[];
    keywords?: string[];
  };
  participants?: string[];
  meeting_attendees?: FirefliesMeetingAttendee[];
  host_email?: string;
  organizer_email?: string;
  sentences?: FirefliesSentence[];
}

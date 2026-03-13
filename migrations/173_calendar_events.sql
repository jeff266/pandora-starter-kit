-- Migration 173: Calendar Events
-- Adds Google Calendar integration with event storage and deal resolution

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Google Calendar fields
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',

  -- Event details
  title TEXT,
  description TEXT,
  location TEXT,

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT false,
  timezone TEXT,

  -- Attendees (raw from Google)
  attendees JSONB DEFAULT '[]',
  -- Schema: [{ email, displayName, responseStatus, self, organizer }]

  organizer_email TEXT,
  creator_email TEXT,

  -- Meeting metadata
  status TEXT DEFAULT 'confirmed',  -- confirmed, tentative, cancelled
  visibility TEXT DEFAULT 'default',
  html_link TEXT,
  meet_link TEXT,  -- Google Meet URL if present

  -- Deal resolution (populated by resolver job)
  resolved_deal_ids UUID[] DEFAULT '{}',
  -- Array of deal IDs matched from attendee emails

  -- Sync metadata
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, google_event_id)
);

-- Indexes for common queries
CREATE INDEX idx_calendar_events_workspace_date
  ON calendar_events(workspace_id, start_time);


CREATE INDEX idx_calendar_events_deal
  ON calendar_events USING gin(resolved_deal_ids);

-- Update trigger
CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_calendar_events_updated_at();

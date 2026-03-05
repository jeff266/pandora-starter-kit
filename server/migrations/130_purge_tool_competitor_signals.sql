-- Migration 130: Purge competitor_mention signals for names that match
-- a workspace's connected conversation adapters (Gong, Fireflies, Chorus).
-- These tools were incorrectly flagged as competitors because they are
-- mentioned in call transcripts as recording tools, not competing products.
-- Resets conversation_signal_runs for affected conversations so they are
-- re-extracted cleanly on the next signal extraction run.

DELETE FROM conversation_signals cs
WHERE cs.signal_type = 'competitor_mention'
  AND EXISTS (
    SELECT 1 FROM connections c
    WHERE c.workspace_id = cs.workspace_id
      AND c.connector_name IN ('gong', 'fireflies', 'chorus')
      AND lower(cs.signal_value) = c.connector_name
  );

DELETE FROM conversation_signal_runs csr
WHERE NOT EXISTS (
  SELECT 1 FROM conversation_signals cs
  WHERE cs.conversation_id = csr.conversation_id
);

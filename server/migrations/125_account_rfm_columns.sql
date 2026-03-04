ALTER TABLE account_scores
  ADD COLUMN IF NOT EXISTS rfm_segment            VARCHAR(64),
  ADD COLUMN IF NOT EXISTS rfm_r                  VARCHAR(4),
  ADD COLUMN IF NOT EXISTS rfm_f                  VARCHAR(4),
  ADD COLUMN IF NOT EXISTS rfm_m                  VARCHAR(4),
  ADD COLUMN IF NOT EXISTS rfm_recency_days        INTEGER,
  ADD COLUMN IF NOT EXISTS rfm_unique_contacts     INTEGER,
  ADD COLUMN IF NOT EXISTS rfm_open_deal_value     NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS rfm_computed_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_account_scores_rfm_segment
  ON account_scores(workspace_id, rfm_segment);

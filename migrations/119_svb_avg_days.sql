ALTER TABLE stage_velocity_benchmarks
  ADD COLUMN IF NOT EXISTS avg_days NUMERIC;

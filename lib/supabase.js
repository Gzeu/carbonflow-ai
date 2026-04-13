// Supabase client singleton + schema helpers
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

// SQL DDL to run once in Supabase SQL editor:
// CREATE TABLE IF NOT EXISTS carbon_scores (
//   id              BIGSERIAL PRIMARY KEY,
//   repo_full_name  TEXT        NOT NULL,
//   sha             TEXT,
//   event_type      TEXT        NOT NULL,  -- push | pull_request | workflow_run
//   label           TEXT        NOT NULL,  -- green | yellow | red
//   energy_kwh      NUMERIC(12,6) NOT NULL,
//   carbon_kg       NUMERIC(12,6),
//   additions       INT,
//   deletions       INT,
//   ci_duration_min NUMERIC(8,2),
//   recommendations JSONB,
//   created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );
// CREATE INDEX idx_carbon_scores_repo ON carbon_scores(repo_full_name);
// CREATE INDEX idx_carbon_scores_label ON carbon_scores(label);
// CREATE INDEX idx_carbon_scores_ts ON carbon_scores(created_at DESC);

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS carbon_scores (
  id              BIGSERIAL PRIMARY KEY,
  repo_full_name  TEXT          NOT NULL,
  sha             TEXT,
  event_type      TEXT          NOT NULL,
  label           TEXT          NOT NULL,
  energy_kwh      NUMERIC(12,6) NOT NULL,
  carbon_kg       NUMERIC(12,6),
  additions       INT,
  deletions       INT,
  ci_duration_min NUMERIC(8,2),
  recommendations JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carbon_scores_repo  ON carbon_scores(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_carbon_scores_label ON carbon_scores(label);
CREATE INDEX IF NOT EXISTS idx_carbon_scores_ts    ON carbon_scores(created_at DESC);
`;

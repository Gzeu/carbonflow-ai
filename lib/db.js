/**
 * lib/db.js — Supabase client singleton
 * Folosit de api/webhooks.js, api/dashboard.js, api/scores.js, api/repos.js
 * Graceful fallback: dacă SUPABASE_URL lipsește, returnează null și logging warning.
 */
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

let _client = null;
let _initAttempted = false;

export async function getDb() {
  if (_initAttempted) return _client;
  _initAttempted = true;

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    logger.warn('Supabase not configured — DB persistence disabled', { hint: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY' });
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    _client = createClient(url, key, {
      auth: { persistSession: false },
    });
    logger.info('Supabase client initialized', { url });
    return _client;
  } catch (err) {
    logger.error('Failed to initialize Supabase client', { error: err.message });
    return null;
  }
}

/**
 * Persists a carbon analysis event to the `carbon_events` table.
 * Non-throwing — logs errors but never crashes the caller.
 *
 * @param {object} params
 * @param {string} params.repo         full_name e.g. "Gzeu/carbonflow-ai"
 * @param {string} params.event_type   "push" | "pull_request" | "workflow_run"
 * @param {number} params.additions
 * @param {number} params.deletions
 * @param {number} params.energy_kwh
 * @param {number} params.carbon_kg
 * @param {string} params.tier         "green" | "yellow" | "red"
 * @param {number|null} params.pr_number
 * @param {string|null} params.commit_sha
 * @param {string|null} params.actor
 * @param {number|null} params.ci_duration_minutes
 * @param {object|null} params.meta    any extra JSON metadata
 */
export async function persistEvent(params) {
  const db = await getDb();
  if (!db) return null;

  const row = {
    repo:                  params.repo,
    event_type:            params.event_type,
    additions:             params.additions ?? 0,
    deletions:             params.deletions ?? 0,
    energy_kwh:            params.energy_kwh,
    carbon_kg:             params.carbon_kg,
    tier:                  params.tier,
    pr_number:             params.pr_number ?? null,
    commit_sha:            params.commit_sha ?? null,
    actor:                 params.actor ?? null,
    ci_duration_minutes:   params.ci_duration_minutes ?? null,
    meta:                  params.meta ?? null,
    created_at:            new Date().toISOString(),
  };

  const { error } = await db.from('carbon_events').insert(row);
  if (error) {
    logger.error('Failed to persist carbon event', { error: error.message, repo: params.repo });
    return null;
  }
  logger.info('Carbon event persisted', { repo: params.repo, tier: params.tier, event_type: params.event_type });
  return row;
}

/**
 * Queries recent events with optional filters.
 * Returns [] on error or missing DB.
 */
export async function queryEvents({ repo, tier, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  let q = db
    .from('carbon_events')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (repo) q = q.eq('repo', repo);
  if (tier) q = q.eq('tier', tier);

  const { data, error } = await q;
  if (error) {
    logger.error('Failed to query carbon events', { error: error.message });
    return [];
  }
  return data ?? [];
}

/**
 * Returns aggregated stats per repo.
 */
export async function queryRepoStats() {
  const db = await getDb();
  if (!db) return [];

  const { data, error } = await db
    .from('carbon_events')
    .select('repo, tier, energy_kwh, carbon_kg')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    logger.error('Failed to query repo stats', { error: error.message });
    return [];
  }

  const map = {};
  for (const row of data ?? []) {
    if (!map[row.repo]) map[row.repo] = { repo: row.repo, green: 0, yellow: 0, red: 0, total_kwh: 0, total_co2_kg: 0, count: 0 };
    map[row.repo][row.tier]++;
    map[row.repo].total_kwh   += row.energy_kwh;
    map[row.repo].total_co2_kg += row.carbon_kg;
    map[row.repo].count++;
  }

  return Object.values(map).map(r => ({
    ...r,
    total_kwh:    parseFloat(r.total_kwh.toFixed(6)),
    total_co2_kg: parseFloat(r.total_co2_kg.toFixed(6)),
    avg_kwh:      parseFloat((r.total_kwh / r.count).toFixed(6)),
  })).sort((a, b) => b.total_kwh - a.total_kwh);
}

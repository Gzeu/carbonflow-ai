/**
 * lib/db.js
 * Supabase persistence layer for CarbonFlow AI.
 *
 * Exports:
 *   persistEvent(data)  — insert a carbon event row
 *   queryEvents(opts)   — paginated query with optional repo/tier filters
 *   queryRepoStats()    — per-repo aggregate stats
 *   getLastEvent(repo, eventType) — most recent event for a repo+type
 *   getGreenStreak(repo, eventType) — Wave 6: consecutive green events count
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/**
 * Persist a single carbon event to the carbon_events table.
 */
export async function persistEvent(data) {
  const { error } = await supabase.from('carbon_events').insert([{
    repo:                data.repo,
    event_type:          data.event_type,
    additions:           data.additions ?? 0,
    deletions:           data.deletions ?? 0,
    energy_kwh:          data.energy_kwh,
    carbon_kg:           data.carbon_kg,
    tier:                data.tier,
    pr_number:           data.pr_number ?? null,
    commit_sha:          data.commit_sha ?? null,
    actor:               data.actor ?? null,
    ci_duration_minutes: data.ci_duration_minutes ?? null,
    meta:                data.meta ?? {},
  }]);
  if (error) throw new Error(`persistEvent failed: ${error.message}`);
}

/**
 * Paginated query with optional filters.
 */
export async function queryEvents({ repo, tier, limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('carbon_events')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (repo) q = q.eq('repo', repo);
  if (tier) q = q.eq('tier', tier);

  const { data, error } = await q;
  if (error) throw new Error(`queryEvents failed: ${error.message}`);
  return data || [];
}

/**
 * Per-repo aggregate stats (used by dashboard).
 */
export async function queryRepoStats() {
  const { data, error } = await supabase
    .from('carbon_events')
    .select('repo, tier, energy_kwh, carbon_kg')
    .order('repo');

  if (error) throw new Error(`queryRepoStats failed: ${error.message}`);

  const map = {};
  for (const e of (data || [])) {
    if (!map[e.repo]) {
      map[e.repo] = { repo: e.repo, green: 0, yellow: 0, red: 0, total_kwh: 0, total_co2_kg: 0, count: 0 };
    }
    map[e.repo][e.tier]++;
    map[e.repo].total_kwh    += parseFloat(e.energy_kwh);
    map[e.repo].total_co2_kg += parseFloat(e.carbon_kg);
    map[e.repo].count++;
  }

  return Object.values(map).map(r => ({
    ...r,
    total_kwh:    parseFloat(r.total_kwh.toFixed(6)),
    total_co2_kg: parseFloat(r.total_co2_kg.toFixed(6)),
    avg_kwh:      parseFloat((r.total_kwh / r.count).toFixed(6)),
  })).sort((a, b) => b.total_kwh - a.total_kwh);
}

/**
 * Returns the most recent carbon event for a given repo and event_type.
 * Used for trend comparison in PR comments.
 */
export async function getLastEvent(repo, eventType) {
  const { data, error } = await supabase
    .from('carbon_events')
    .select('energy_kwh, carbon_kg, tier, created_at, meta')
    .eq('repo', repo)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows found — not a real error
    if (error.code === 'PGRST116') return null;
    throw new Error(`getLastEvent failed: ${error.message}`);
  }

  return data
    ? {
        energy_kwh:    parseFloat(data.energy_kwh),
        carbon_kg:     parseFloat(data.carbon_kg),
        tier:          data.tier,
        numeric_score: data.meta?.numeric_score ?? null,
        created_at:    data.created_at,
      }
    : null;
}

/**
 * Wave 6: Returns count of consecutive green events for a repo+eventType,
 * starting from the most recent and counting backward.
 *
 * Example: [green, green, green, yellow, green] → returns 3
 *
 * We fetch the last 50 events (enough for a streak display up to 50).
 * This avoids a full table scan and is sufficient for UI purposes.
 */
export async function getGreenStreak(repo, eventType) {
  const { data, error } = await supabase
    .from('carbon_events')
    .select('tier, created_at')
    .eq('repo', repo)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    if (error.code === 'PGRST116') return 0;
    throw new Error(`getGreenStreak failed: ${error.message}`);
  }

  let streak = 0;
  for (const row of (data || [])) {
    if (row.tier === 'green') streak++;
    else break;
  }
  return streak;
}

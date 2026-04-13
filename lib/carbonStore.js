// Persist + query carbon score events to Supabase
import { getSupabase } from './supabase.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

/**
 * @param {object} event
 * @param {string} event.repo_full_name
 * @param {string} [event.sha]
 * @param {'push'|'pull_request'|'workflow_run'} event.event_type
 * @param {'green'|'yellow'|'red'} event.label
 * @param {number} event.energy_kwh
 * @param {number} [event.carbon_kg]
 * @param {number} [event.additions]
 * @param {number} [event.deletions]
 * @param {number} [event.ci_duration_min]
 * @param {string[]} [event.recommendations]
 */
export async function persistScore(event) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logger.warn('carbonStore.skip', { reason: 'Supabase not configured' });
    return null;
  }
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('carbon_scores').insert({
      repo_full_name:  event.repo_full_name,
      sha:             event.sha ?? null,
      event_type:      event.event_type,
      label:           event.label,
      energy_kwh:      event.energy_kwh,
      carbon_kg:       event.carbon_kg ?? null,
      additions:       event.additions ?? null,
      deletions:       event.deletions ?? null,
      ci_duration_min: event.ci_duration_min ?? null,
      recommendations: event.recommendations ? JSON.stringify(event.recommendations) : null,
    }).select('id').single();

    if (error) throw error;
    logger.info('carbonStore.persisted', { id: data?.id, repo: event.repo_full_name, label: event.label });
    return data?.id ?? null;
  } catch (err) {
    logger.error('carbonStore.error', { message: err.message, repo: event.repo_full_name });
    return null; // Non-fatal — webhook should still succeed
  }
}

/**
 * Query last N scores for a repo
 */
export async function getRepoHistory(repoFullName, limit = 50) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('carbon_scores')
    .select('id, sha, event_type, label, energy_kwh, carbon_kg, created_at')
    .eq('repo_full_name', repoFullName)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Daily aggregation for one repo
 */
export async function getDailyStats(repoFullName, days = 30) {
  const sb = getSupabase();
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const { data, error } = await sb
    .from('carbon_scores')
    .select('label, energy_kwh, created_at')
    .eq('repo_full_name', repoFullName)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const map = {};
  for (const row of data) {
    const day = row.created_at.slice(0, 10);
    if (!map[day]) map[day] = { day, green: 0, yellow: 0, red: 0, energy: 0 };
    map[day][row.label] = (map[day][row.label] || 0) + 1;
    map[day].energy += row.energy_kwh || 0;
  }
  return Object.values(map).sort((a, b) => a.day.localeCompare(b.day));
}

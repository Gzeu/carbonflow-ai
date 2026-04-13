/**
 * GET /api/scores
 * Returnează istoricul paginat al analizelor carbon.
 *
 * Query params:
 *   repo    — filtrare după repo full_name (ex: Gzeu/carbonflow-ai)
 *   tier    — green | yellow | red
 *   limit   — default 50, max 200
 *   offset  — default 0
 *   summary — "1" | "true" — dacă e setat, include per-repo aggregates
 *
 * Răspuns:
 *   { data, count, offset, limit, has_more, repo_summary? }
 *
 * Wave 5 additions:
 *   - numeric_score inclus în fiecare row (calculat din meta.numeric_score)
 *   - repo_summary: aggregate + best/worst event + green streak
 *   - ?summary=1 pentru a obține repo_summary fără overhead în listing normal
 */
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { queryEvents } from '../lib/db.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const YELLOW = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
const RED    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');

const QuerySchema = z.object({
  repo:    z.string().max(200).optional(),
  tier:    z.enum(['green', 'yellow', 'red']).optional(),
  limit:   z.coerce.number().int().min(1).max(200).default(50),
  offset:  z.coerce.number().int().min(0).default(0),
  summary: z.string().optional(), // "1" or "true" to include repo_summary
});

/**
 * Re-derives numeric score from energy_kwh if meta.numeric_score is missing.
 * Mirrors logic in api/carbon.js and api/webhooks.js.
 */
function deriveNumericScore(kwh) {
  if (kwh <= 0) return 100;
  if (kwh >= RED) return Math.max(0, Math.round(10 - (kwh - RED) * 10));
  if (kwh >= YELLOW) {
    const ratio = (kwh - YELLOW) / (RED - YELLOW);
    return Math.round(70 - ratio * 20);
  }
  const ratio = kwh / YELLOW;
  return Math.round(100 - ratio * 30);
}

/**
 * Builds a per-repo summary with:
 *  - aggregate stats (total events, kwh, co2)
 *  - tier breakdown
 *  - best event (lowest kwh), worst event (highest kwh)
 *  - current green streak (consecutive green events from most recent)
 *  - avg_numeric_score
 */
function buildRepoSummary(events) {
  if (!events.length) return null;

  const total    = events.length;
  const totalKwh = events.reduce((a, e) => a + parseFloat(e.energy_kwh), 0);
  const totalCo2 = events.reduce((a, e) => a + parseFloat(e.carbon_kg), 0);
  const green    = events.filter(e => e.tier === 'green').length;
  const yellow   = events.filter(e => e.tier === 'yellow').length;
  const red      = events.filter(e => e.tier === 'red').length;

  // Best = lowest kwh, worst = highest kwh
  const sorted   = [...events].sort((a, b) => parseFloat(a.energy_kwh) - parseFloat(b.energy_kwh));
  const bestEvt  = sorted[0];
  const worstEvt = sorted[sorted.length - 1];

  // Green streak: count consecutive greens from the most recent event backward
  const byDate   = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  let streak = 0;
  for (const e of byDate) {
    if (e.tier === 'green') streak++;
    else break;
  }

  // Average numeric score across events
  const scores     = events.map(e => e.meta?.numeric_score ?? deriveNumericScore(parseFloat(e.energy_kwh)));
  const avgScore   = Math.round(scores.reduce((a, s) => a + s, 0) / scores.length);

  // Health score: green=100pts, yellow=40pts, red=0pts
  const healthScore = Math.round((green * 1.0 + yellow * 0.4) / total * 100);

  const toSummaryEvent = e => ({
    id:         e.id ?? null,
    event_type: e.event_type,
    energy_kwh: parseFloat(parseFloat(e.energy_kwh).toFixed(6)),
    tier:       e.tier,
    pr_number:  e.pr_number ?? null,
    commit_sha: e.commit_sha ? String(e.commit_sha).slice(0, 7) : null,
    created_at: e.created_at,
  });

  return {
    total_events:     total,
    total_kwh:        parseFloat(totalKwh.toFixed(6)),
    total_co2_kg:     parseFloat(totalCo2.toFixed(6)),
    avg_kwh:          parseFloat((totalKwh / total).toFixed(6)),
    avg_numeric_score: avgScore,
    health_score:     healthScore,
    tier_breakdown:   { green, yellow, red },
    green_streak:     streak,
    best_event:       toSummaryEvent(bestEvt),
    worst_event:      toSummaryEvent(worstEvt),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['GET'] });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
  }

  const { repo, tier, limit, offset, summary } = parsed.data;
  const includeSummary = summary === '1' || summary === 'true';

  logger.info('Scores query', { repo, tier, limit, offset, includeSummary });

  try {
    // For summary, fetch up to 500 events (no pagination overhead)
    const fetchLimit = includeSummary ? 500 : limit + 1;
    const data = await queryEvents({ repo, tier, limit: fetchLimit, offset: includeSummary ? 0 : offset });

    // Build repo summary before slicing
    const repoSummary = includeSummary ? buildRepoSummary(data) : undefined;

    const paginated = includeSummary ? data.slice(offset, offset + limit + 1) : data;
    const hasMore   = paginated.length > limit;
    const results   = hasMore ? paginated.slice(0, limit) : paginated;

    return res.status(200).json({
      data: results.map(r => ({
        id:                  r.id,
        repo:                r.repo,
        event_type:          r.event_type,
        additions:           r.additions,
        deletions:           r.deletions,
        energy_kwh:          parseFloat(r.energy_kwh),
        carbon_kg:           parseFloat(r.carbon_kg),
        tier:                r.tier,
        // Wave 5: numeric_score in every row
        numeric_score:       r.meta?.numeric_score ?? deriveNumericScore(parseFloat(r.energy_kwh)),
        pr_number:           r.pr_number ?? null,
        commit_sha:          r.commit_sha ? String(r.commit_sha).slice(0, 7) : null,
        actor:               r.actor ?? null,
        ci_duration_minutes: r.ci_duration_minutes ?? null,
        created_at:          r.created_at,
      })),
      count:        results.length,
      offset,
      limit,
      has_more:     hasMore,
      // Wave 5: only present when ?summary=1
      ...(repoSummary !== undefined ? { repo_summary: repoSummary } : {}),
      meta: { generated_at: new Date().toISOString(), version: '2.0' },
    });
  } catch (err) {
    logger.error('Scores query error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

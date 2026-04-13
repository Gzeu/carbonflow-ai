/**
 * GET /api/scores
 * Returnează istoricul paginat al analizelor carbon.
 *
 * Query params:
 *   repo    — filtrează după repo full_name (ex: Gzeu/carbonflow-ai)
 *   tier    — green | yellow | red
 *   limit   — default 50, max 200
 *   offset  — default 0
 *
 * Răspuns:
 *   { data: [...], count: number, offset: number, limit: number, has_more: boolean }
 */
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { queryEvents } from '../lib/db.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const QuerySchema = z.object({
  repo:   z.string().max(200).optional(),
  tier:   z.enum(['green', 'yellow', 'red']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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

  const { repo, tier, limit, offset } = parsed.data;

  logger.info('Scores query', { repo, tier, limit, offset });

  try {
    const data = await queryEvents({ repo, tier, limit: limit + 1, offset });
    const hasMore = data.length > limit;
    const results = hasMore ? data.slice(0, limit) : data;

    return res.status(200).json({
      data: results.map(r => ({
        id:                    r.id,
        repo:                  r.repo,
        event_type:            r.event_type,
        additions:             r.additions,
        deletions:             r.deletions,
        energy_kwh:            r.energy_kwh,
        carbon_kg:             r.carbon_kg,
        tier:                  r.tier,
        pr_number:             r.pr_number,
        commit_sha:            r.commit_sha,
        actor:                 r.actor,
        ci_duration_minutes:   r.ci_duration_minutes,
        created_at:            r.created_at,
      })),
      count:    results.length,
      offset,
      limit,
      has_more: hasMore,
      meta: { generated_at: new Date().toISOString(), version: '1.0' },
    });
  } catch (err) {
    logger.error('Scores query error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

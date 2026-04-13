/**
 * api/ratelimit.js
 * GET  /api/ratelimit?repo=owner/repo    — inspect current state
 * DELETE /api/ratelimit?repo=owner/repo  — reset (admin only, requires CARBONFLOW_API_KEY)
 * GET  /api/ratelimit                    — list all tracked repos
 */

import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { getRateLimitInfo, resetRateLimit, listRateLimits } from '../lib/rateLimiter.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const RepoQuerySchema = z.object({
  repo: z.string().min(3).optional(),
});

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const parsed = RepoQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { repo } = parsed.data;
    if (repo) {
      return res.status(200).json(getRateLimitInfo(repo));
    }
    // No repo param → list all
    return res.status(200).json({ limits: listRateLimits(), timestamp: new Date().toISOString() });
  }

  if (req.method === 'DELETE') {
    // Admin-only: require API key
    const apiKey = process.env.CARBONFLOW_API_KEY;
    if (apiKey) {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const parsed = RepoQuerySchema.safeParse(req.query);
    if (!parsed.success || !parsed.data.repo) {
      return res.status(400).json({ error: 'Missing ?repo= param' });
    }
    const result = resetRateLimit(parsed.data.repo);
    logger.info('Rate limit reset', { repo: parsed.data.repo });
    return res.status(200).json({ ok: true, ...result });
  }

  return res.status(405).json({ error: 'Method not allowed', allowed: ['GET', 'DELETE'] });
}

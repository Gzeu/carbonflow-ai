/**
 * GET /api/repos
 * Returnează top repos cu statistici agregate carbon.
 * Date reale din Supabase; fallback la seed dacă DB nu e configurată.
 */
import { createLogger, format, transports } from 'winston';
import { queryRepoStats } from '../lib/db.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const FALLBACK_REPOS = [
  { repo: 'carbonflow-ai', green: 2, yellow: 1, red: 0, total_kwh: 0.000420, total_co2_kg: 0.000098, avg_kwh: 0.000140, count: 3 },
  { repo: 'openclaw-hub',  green: 0, yellow: 1, red: 1, total_kwh: 0.001230, total_co2_kg: 0.000287, avg_kwh: 0.000615, count: 2 },
  { repo: 'vaultkey',      green: 1, yellow: 0, red: 0, total_kwh: 0.000082, total_co2_kg: 0.000019, avg_kwh: 0.000082, count: 1 },
  { repo: 'agentbazaar',   green: 0, yellow: 1, red: 0, total_kwh: 0.000368, total_co2_kg: 0.000086, avg_kwh: 0.000368, count: 1 },
];

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

  try {
    const stats = await queryRepoStats();
    const isLive = stats.length > 0;

    const repos = isLive ? stats : FALLBACK_REPOS;

    logger.info('Repos query', { source: isLive ? 'supabase' : 'fallback', count: repos.length });

    return res.status(200).json({
      repos,
      source: isLive ? 'live' : 'fallback',
      meta: { generated_at: new Date().toISOString(), version: '1.0' },
    });
  } catch (err) {
    logger.error('Repos query error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

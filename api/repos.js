// GET /api/repos — top repositories by carbon activity
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  label: z.enum(['green', 'yellow', 'red']).optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
  }
  const { limit, label, days } = parsed.data;

  const sb = supabaseClient();
  if (!sb) {
    return res.status(200).json({
      repos: [
        { repo: 'demo/frontend-app', total: 42, green: 35, yellow: 5, red: 2, avg_energy: 0.24, score_trend: 'improving' },
        { repo: 'demo/api-service',  total: 28, green: 18, yellow: 7, red: 3, avg_energy: 0.51, score_trend: 'stable'    },
        { repo: 'demo/ml-pipeline',  total: 14, green: 6,  yellow: 5, red: 3, avg_energy: 0.89, score_trend: 'degrading' },
      ],
      _demo: true,
    });
  }

  try {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    let query = sb
      .from('carbon_scores')
      .select('repo_full_name, label, energy_kwh, created_at')
      .gte('created_at', since);
    if (label) query = query.eq('label', label);

    const { data, error } = await query;
    if (error) throw error;

    const repoMap = {};
    for (const row of data) {
      if (!repoMap[row.repo_full_name]) {
        repoMap[row.repo_full_name] = { repo: row.repo_full_name, total: 0, green: 0, yellow: 0, red: 0, _sum: 0, _series: [] };
      }
      repoMap[row.repo_full_name].total += 1;
      repoMap[row.repo_full_name][row.label] = (repoMap[row.repo_full_name][row.label] || 0) + 1;
      repoMap[row.repo_full_name]._sum += row.energy_kwh || 0;
      repoMap[row.repo_full_name]._series.push({ t: row.created_at, e: row.energy_kwh || 0 });
    }

    const repos = Object.values(repoMap)
      .map(r => {
        const avg = r.total ? r._sum / r.total : 0;
        const series = r._series.sort((a, b) => a.t.localeCompare(b.t));
        const half = Math.floor(series.length / 2);
        const firstHalf = half > 0 ? series.slice(0, half).reduce((s, x) => s + x.e, 0) / half : avg;
        const secondHalf = half > 0 ? series.slice(half).reduce((s, x) => s + x.e, 0) / (series.length - half) : avg;
        const trend = secondHalf < firstHalf * 0.95 ? 'improving' : secondHalf > firstHalf * 1.05 ? 'degrading' : 'stable';
        return { repo: r.repo, total: r.total, green: r.green, yellow: r.yellow, red: r.red, avg_energy: +avg.toFixed(6), score_trend: trend };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    logger.info('repos.query', { limit, label, days, count: repos.length });
    return res.status(200).json({ repos });
  } catch (err) {
    logger.error('repos.error', { message: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

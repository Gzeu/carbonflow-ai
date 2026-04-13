// GET /api/dashboard — aggregated analytics
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  repo: z.string().optional(),
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
  const { days, repo } = parsed.data;

  const sb = supabaseClient();
  if (!sb) {
    // Return demo data when Supabase is not configured
    return res.status(200).json(demoPayload(days));
  }

  try {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    let query = sb
      .from('carbon_scores')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    if (repo) query = query.eq('repo_full_name', repo);

    const { data, error } = await query;
    if (error) throw error;

    const totals = { green: 0, yellow: 0, red: 0, total: data.length };
    const dailyMap = {};
    let energySum = 0;

    for (const row of data) {
      totals[row.label] = (totals[row.label] || 0) + 1;
      energySum += row.energy_kwh || 0;
      const day = row.created_at.slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { day, green: 0, yellow: 0, red: 0, energy: 0, count: 0 };
      dailyMap[day][row.label] = (dailyMap[day][row.label] || 0) + 1;
      dailyMap[day].energy += row.energy_kwh || 0;
      dailyMap[day].count += 1;
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day));

    // Top repos
    const repoMap = {};
    for (const row of data) {
      if (!repoMap[row.repo_full_name]) repoMap[row.repo_full_name] = { repo: row.repo_full_name, total: 0, green: 0, yellow: 0, red: 0, avg_energy: 0, _sum: 0 };
      repoMap[row.repo_full_name].total += 1;
      repoMap[row.repo_full_name][row.label] = (repoMap[row.repo_full_name][row.label] || 0) + 1;
      repoMap[row.repo_full_name]._sum += row.energy_kwh || 0;
    }
    const topRepos = Object.values(repoMap)
      .map(r => ({ ...r, avg_energy: r.total ? r._sum / r.total : 0, _sum: undefined }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    logger.info('dashboard.query', { days, repo, rows: data.length });
    return res.status(200).json({
      period_days: days,
      totals,
      avg_energy_kwh: totals.total ? energySum / totals.total : 0,
      daily,
      top_repos: topRepos,
    });
  } catch (err) {
    logger.error('dashboard.error', { message: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function demoPayload(days) {
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000);
    const day = d.toISOString().slice(0, 10);
    const green = Math.floor(Math.random() * 6) + 2;
    const yellow = Math.floor(Math.random() * 3);
    const red = Math.random() > 0.8 ? 1 : 0;
    daily.push({ day, green, yellow, red, energy: +(green * 0.2 + yellow * 0.7 + red * 1.3).toFixed(4), count: green + yellow + red });
  }
  const totals = daily.reduce((a, d) => ({ green: a.green + d.green, yellow: a.yellow + d.yellow, red: a.red + d.red, total: a.total + d.count }), { green: 0, yellow: 0, red: 0, total: 0 });
  return {
    period_days: days,
    totals,
    avg_energy_kwh: 0.31,
    daily,
    top_repos: [
      { repo: 'demo/frontend-app', total: 42, green: 35, yellow: 5, red: 2, avg_energy: 0.24 },
      { repo: 'demo/api-service', total: 28, green: 18, yellow: 7, red: 3, avg_energy: 0.51 },
      { repo: 'demo/ml-pipeline', total: 14, green: 6, yellow: 5, red: 3, avg_energy: 0.89 },
    ],
    _demo: true,
  };
}

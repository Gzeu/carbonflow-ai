/**
 * GET /api/dashboard
 * Returns aggregated analytics for the dashboard UI.
 * In production this would query a database; here it returns
 * a computed snapshot with demo seed data + real threshold config.
 */
import { createRequire } from 'module';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const yellowThreshold = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
  const redThreshold    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');

  // Seed data representing realistic recent webhook events
  // In production: replace with DB queries (Supabase/PostgreSQL)
  const seedEvents = [
    { repo: 'carbonflow-ai',    event: 'push',         additions: 142, deletions: 38,  ci_min: 2.1,  ts: Date.now() - 3600000 * 1 },
    { repo: 'carbonflow-ai',    event: 'pull_request', additions: 89,  deletions: 12,  ci_min: 1.8,  ts: Date.now() - 3600000 * 3 },
    { repo: 'openclaw-hub',     event: 'push',         additions: 520, deletions: 210, ci_min: 6.5,  ts: Date.now() - 3600000 * 5 },
    { repo: 'vaultkey',         event: 'push',         additions: 67,  deletions: 5,   ci_min: 1.2,  ts: Date.now() - 3600000 * 8 },
    { repo: 'openclaw-hub',     event: 'pull_request', additions: 1240,deletions: 300, ci_min: 12.0, ts: Date.now() - 3600000 * 12 },
    { repo: 'carbonflow-ai',    event: 'push',         additions: 33,  deletions: 91,  ci_min: 0.9,  ts: Date.now() - 3600000 * 16 },
    { repo: 'agentbazaar',      event: 'push',         additions: 280, deletions: 44,  ci_min: 4.4,  ts: Date.now() - 3600000 * 20 },
    { repo: 'pixelmolt',        event: 'push',         additions: 95,  deletions: 20,  ci_min: 2.0,  ts: Date.now() - 3600000 * 26 },
  ];

  const KWH_LINE_ADD  = 0.0000012;
  const KWH_LINE_DEL  = 0.00000008;
  const KWH_CI_MIN    = 0.000075;
  const KG_PER_KWH    = 0.233;

  const events = seedEvents.map(e => {
    const kwh = (e.additions * KWH_LINE_ADD) + (e.deletions * KWH_LINE_DEL) + (e.ci_min * KWH_CI_MIN);
    const tier = kwh < yellowThreshold ? 'green' : kwh < redThreshold ? 'yellow' : 'red';
    return { ...e, energy_kwh: parseFloat(kwh.toFixed(6)), carbon_kg: parseFloat((kwh * KG_PER_KWH).toFixed(6)), tier };
  });

  const total     = events.length;
  const greenCnt  = events.filter(e => e.tier === 'green').length;
  const yellowCnt = events.filter(e => e.tier === 'yellow').length;
  const redCnt    = events.filter(e => e.tier === 'red').length;
  const totalKwh  = events.reduce((a, b) => a + b.energy_kwh, 0);
  const avgKwh    = total > 0 ? totalKwh / total : 0;

  const repoMap = {};
  for (const e of events) {
    if (!repoMap[e.repo]) repoMap[e.repo] = { green: 0, yellow: 0, red: 0, total_kwh: 0, count: 0 };
    repoMap[e.repo][e.tier]++;
    repoMap[e.repo].total_kwh += e.energy_kwh;
    repoMap[e.repo].count++;
  }

  const repos = Object.entries(repoMap).map(([name, stats]) => ({
    name,
    ...stats,
    total_kwh: parseFloat(stats.total_kwh.toFixed(6)),
    avg_kwh:   parseFloat((stats.total_kwh / stats.count).toFixed(6)),
  }));

  return res.status(200).json({
    summary: {
      total_analyses: total,
      green:  greenCnt,
      yellow: yellowCnt,
      red:    redCnt,
      total_kwh:  parseFloat(totalKwh.toFixed(6)),
      avg_kwh:    parseFloat(avgKwh.toFixed(6)),
      total_co2_kg: parseFloat((totalKwh * KG_PER_KWH).toFixed(6)),
    },
    thresholds: { yellow: yellowThreshold, red: redThreshold },
    repos,
    recent_events: events.slice(0, 10).map(e => ({
      repo:        e.repo,
      event:       e.event,
      tier:        e.tier,
      energy_kwh:  e.energy_kwh,
      carbon_kg:   e.carbon_kg,
      timestamp:   new Date(e.ts).toISOString(),
    })),
    meta: { generated_at: new Date().toISOString(), version: '1.0' },
  });
}

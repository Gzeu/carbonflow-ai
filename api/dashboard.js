/**
 * GET /api/dashboard
 * Returnează analytics agregate pentru dashboard UI.
 * Date reale din Supabase; fallback automat la seed data dacă DB nu e configurată.
 */
import { createLogger, format, transports } from 'winston';
import { queryEvents, queryRepoStats } from '../lib/db.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const YELLOW = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
const RED    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');

// Seed fallback — folosit DOAR când Supabase nu e configurat
const SEED_EVENTS = [
  { repo: 'carbonflow-ai',    event_type: 'push',         additions: 142, deletions: 38,  ci_duration_minutes: 2.1,  created_at: new Date(Date.now() - 3600000 * 1).toISOString() },
  { repo: 'carbonflow-ai',    event_type: 'pull_request', additions: 89,  deletions: 12,  ci_duration_minutes: 1.8,  created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
  { repo: 'openclaw-hub',     event_type: 'push',         additions: 520, deletions: 210, ci_duration_minutes: 6.5,  created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { repo: 'vaultkey',         event_type: 'push',         additions: 67,  deletions: 5,   ci_duration_minutes: 1.2,  created_at: new Date(Date.now() - 3600000 * 8).toISOString() },
  { repo: 'openclaw-hub',     event_type: 'pull_request', additions: 1240,deletions: 300, ci_duration_minutes: 12.0, created_at: new Date(Date.now() - 3600000 * 12).toISOString() },
  { repo: 'carbonflow-ai',    event_type: 'push',         additions: 33,  deletions: 91,  ci_duration_minutes: 0.9,  created_at: new Date(Date.now() - 3600000 * 16).toISOString() },
  { repo: 'agentbazaar',      event_type: 'push',         additions: 280, deletions: 44,  ci_duration_minutes: 4.4,  created_at: new Date(Date.now() - 3600000 * 20).toISOString() },
  { repo: 'pixelmolt',        event_type: 'push',         additions: 95,  deletions: 20,  ci_duration_minutes: 2.0,  created_at: new Date(Date.now() - 3600000 * 26).toISOString() },
];

const KWH_LINE_ADD = 0.001;
const KWH_LINE_DEL = 0.0005;
const KG_PER_KWH   = 0.4;

function computeSeedEvent(e) {
  const kwh = e.additions * KWH_LINE_ADD + e.deletions * KWH_LINE_DEL;
  const tier = kwh >= RED ? 'red' : kwh >= YELLOW ? 'yellow' : 'green';
  return {
    ...e,
    energy_kwh: parseFloat(kwh.toFixed(6)),
    carbon_kg:  parseFloat((kwh * KG_PER_KWH).toFixed(6)),
    tier,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Încearcă să ia date reale din Supabase
    const [liveEvents, liveRepos] = await Promise.all([
      queryEvents({ limit: 100 }),
      queryRepoStats(),
    ]);

    const isLive = liveEvents.length > 0;
    const events = isLive ? liveEvents : SEED_EVENTS.map(computeSeedEvent);
    const repos  = isLive ? liveRepos  : buildSeedRepos(events);

    logger.info('Dashboard query', { source: isLive ? 'supabase' : 'seed', events: events.length });

    const total     = events.length;
    const greenCnt  = events.filter(e => e.tier === 'green').length;
    const yellowCnt = events.filter(e => e.tier === 'yellow').length;
    const redCnt    = events.filter(e => e.tier === 'red').length;
    const totalKwh  = events.reduce((a, e) => a + parseFloat(e.energy_kwh), 0);
    const totalCo2  = events.reduce((a, e) => a + parseFloat(e.carbon_kg), 0);

    // Trend: raggruppa per giorno (ultimi 30gg)
    const trend = buildTrend(events);

    return res.status(200).json({
      summary: {
        total_analyses:  total,
        green:           greenCnt,
        yellow:          yellowCnt,
        red:             redCnt,
        total_kwh:       parseFloat(totalKwh.toFixed(6)),
        avg_kwh:         total > 0 ? parseFloat((totalKwh / total).toFixed(6)) : 0,
        total_co2_kg:    parseFloat(totalCo2.toFixed(6)),
      },
      thresholds: { yellow: YELLOW, red: RED },
      repos: repos.slice(0, 20),
      trend,
      recent_events: events.slice(0, 20).map(e => ({
        id:          e.id ?? null,
        repo:        e.repo,
        event_type:  e.event_type,
        tier:        e.tier,
        energy_kwh:  parseFloat(e.energy_kwh),
        carbon_kg:   parseFloat(e.carbon_kg),
        actor:       e.actor ?? null,
        pr_number:   e.pr_number ?? null,
        commit_sha:  e.commit_sha ? e.commit_sha.slice(0, 7) : null,
        created_at:  e.created_at,
      })),
      source: isLive ? 'live' : 'seed',
      meta: { generated_at: new Date().toISOString(), version: '2.0' },
    });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildSeedRepos(events) {
  const map = {};
  for (const e of events) {
    if (!map[e.repo]) map[e.repo] = { repo: e.repo, green: 0, yellow: 0, red: 0, total_kwh: 0, total_co2_kg: 0, count: 0 };
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

function buildTrend(events) {
  const days = {};
  const now = Date.now();
  // Inițializează ultimele 14 zile
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - 86400000 * i);
    const key = d.toISOString().slice(0, 10);
    days[key] = { date: key, green: 0, yellow: 0, red: 0, total_kwh: 0 };
  }
  for (const e of events) {
    const key = (e.created_at || '').slice(0, 10);
    if (days[key]) {
      days[key][e.tier]++;
      days[key].total_kwh += parseFloat(e.energy_kwh);
    }
  }
  return Object.values(days).map(d => ({
    ...d,
    total_kwh: parseFloat(d.total_kwh.toFixed(6)),
  }));
}

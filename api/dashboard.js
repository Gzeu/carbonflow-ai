/**
 * GET /api/dashboard
 * Returnează analytics agregate pentru dashboard UI.
 * Date reale din Supabase; fallback automat la seed data dacă DB nu e configurată.
 *
 * Wave 4 additions:
 *  - weeklyTrend: week-over-week kWh comparison (this week vs last week)
 *  - movingAvg7: 7-day rolling average kWh per day
 *  - eventDistribution: breakdown by event_type with % share
 *  - repoHealthScores: per-repo health score 0–100 based on tier ratio
 *  - summary.week_over_week_pct: % change in total kWh this week vs last
 *
 * Fix Wave 6:
 *  - health_score null → 0 guard (nu mai blochează UI-ul când repo nu are events)
 *  - Promise.all cu timeout 8s → fallback la seed dacă Supabase e lent
 *  - CORS OPTIONS preflight handler
 *  - version bump → 4.0
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

// ─── Timeout helper ─────────────────────────────────────────────────────────
// Dacă Supabase nu răspunde în 8s → aruncă eroare → handler prinde și servește seed
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Supabase timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Seed fallback — folosit DOAR când Supabase nu e configurat sau e timeout
const SEED_EVENTS = [
  { repo: 'carbonflow-ai',    event_type: 'push',         additions: 142, deletions: 38,  ci_duration_minutes: 2.1,  created_at: new Date(Date.now() - 86400000 * 0.5).toISOString() },
  { repo: 'carbonflow-ai',    event_type: 'pull_request', additions: 89,  deletions: 12,  ci_duration_minutes: 1.8,  created_at: new Date(Date.now() - 86400000 * 1).toISOString() },
  { repo: 'openclaw-hub',     event_type: 'push',         additions: 520, deletions: 210, ci_duration_minutes: 6.5,  created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
  { repo: 'vaultkey',         event_type: 'push',         additions: 67,  deletions: 5,   ci_duration_minutes: 1.2,  created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
  { repo: 'openclaw-hub',     event_type: 'pull_request', additions: 1240,deletions: 300, ci_duration_minutes: 12.0, created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
  { repo: 'carbonflow-ai',    event_type: 'push',         additions: 33,  deletions: 91,  ci_duration_minutes: 0.9,  created_at: new Date(Date.now() - 86400000 * 7).toISOString() },
  { repo: 'agentbazaar',      event_type: 'push',         additions: 280, deletions: 44,  ci_duration_minutes: 4.4,  created_at: new Date(Date.now() - 86400000 * 9).toISOString() },
  { repo: 'pixelmolt',        event_type: 'push',         additions: 95,  deletions: 20,  ci_duration_minutes: 2.0,  created_at: new Date(Date.now() - 86400000 * 11).toISOString() },
  { repo: 'agentbazaar',      event_type: 'workflow_run', additions: 0,   deletions: 0,   ci_duration_minutes: 3.5,  created_at: new Date(Date.now() - 86400000 * 13).toISOString() },
  { repo: 'vaultkey',         event_type: 'pull_request', additions: 200, deletions: 60,  ci_duration_minutes: 2.8,  created_at: new Date(Date.now() - 86400000 * 10).toISOString() },
];

const KWH_LINE_ADD = 0.001;
const KWH_LINE_DEL = 0.0005;
const KG_PER_KWH   = 0.4;

function computeSeedEvent(e) {
  let kwh;
  if (e.event_type === 'workflow_run') {
    kwh = (e.ci_duration_minutes || 0) * 0.01;
  } else {
    kwh = e.additions * KWH_LINE_ADD + e.deletions * KWH_LINE_DEL;
  }
  const tier = kwh >= RED ? 'red' : kwh >= YELLOW ? 'yellow' : 'green';
  return {
    ...e,
    energy_kwh: parseFloat(kwh.toFixed(6)),
    carbon_kg:  parseFloat((kwh * KG_PER_KWH).toFixed(6)),
    tier,
  };
}

// ─── Wave 4: Weekly trend (this week vs last week) ───────────────────────────
function buildWeeklyTrend(events) {
  const now  = Date.now();
  const oneDay = 86400000;
  const thisWeekStart = now - oneDay * 7;
  const lastWeekStart = now - oneDay * 14;

  const thisWeek = events.filter(e => {
    const t = new Date(e.created_at).getTime();
    return t >= thisWeekStart && t <= now;
  });
  const lastWeek = events.filter(e => {
    const t = new Date(e.created_at).getTime();
    return t >= lastWeekStart && t < thisWeekStart;
  });

  const thisKwh = thisWeek.reduce((a, e) => a + parseFloat(e.energy_kwh || 0), 0);
  const lastKwh = lastWeek.reduce((a, e) => a + parseFloat(e.energy_kwh || 0), 0);
  const thisCo2 = thisWeek.reduce((a, e) => a + parseFloat(e.carbon_kg  || 0), 0);
  const lastCo2 = lastWeek.reduce((a, e) => a + parseFloat(e.carbon_kg  || 0), 0);

  const pct = lastKwh > 0
    ? Math.round(((thisKwh - lastKwh) / lastKwh) * 100)
    : null;

  const direction = pct === null ? 'no_data'
    : Math.abs(pct) < 2 ? 'stable'
    : pct > 0 ? 'up' : 'down';

  return {
    this_week: {
      events:       thisWeek.length,
      total_kwh:    parseFloat(thisKwh.toFixed(6)),
      total_co2_kg: parseFloat(thisCo2.toFixed(6)),
      green:  thisWeek.filter(e => e.tier === 'green').length,
      yellow: thisWeek.filter(e => e.tier === 'yellow').length,
      red:    thisWeek.filter(e => e.tier === 'red').length,
    },
    last_week: {
      events:       lastWeek.length,
      total_kwh:    parseFloat(lastKwh.toFixed(6)),
      total_co2_kg: parseFloat(lastCo2.toFixed(6)),
      green:  lastWeek.filter(e => e.tier === 'green').length,
      yellow: lastWeek.filter(e => e.tier === 'yellow').length,
      red:    lastWeek.filter(e => e.tier === 'red').length,
    },
    week_over_week_pct: pct,
    direction,
  };
}

// ─── Wave 4: 7-day moving average kWh per day ────────────────────────────────
function buildMovingAvg7(dailyTrend) {
  return dailyTrend.map((day, idx) => {
    const window = dailyTrend.slice(Math.max(0, idx - 6), idx + 1);
    const avg = window.reduce((a, d) => a + (d.total_kwh || 0), 0) / window.length;
    return {
      date:       day.date,
      kwh_avg_7d: parseFloat(avg.toFixed(6)),
    };
  });
}

// ─── Wave 4: Event type distribution ─────────────────────────────────────────
function buildEventDistribution(events) {
  const types = ['push', 'pull_request', 'workflow_run'];
  const total = events.length || 1;
  return types.map(type => {
    const group = events.filter(e => e.event_type === type);
    const kwh   = group.reduce((a, e) => a + parseFloat(e.energy_kwh || 0), 0);
    return {
      event_type: type,
      count:      group.length,
      pct_count:  Math.round((group.length / total) * 100),
      total_kwh:  parseFloat(kwh.toFixed(6)),
      green:      group.filter(e => e.tier === 'green').length,
      yellow:     group.filter(e => e.tier === 'yellow').length,
      red:        group.filter(e => e.tier === 'red').length,
    };
  });
}

// ─── Wave 4: Per-repo health score 0–100 ─────────────────────────────────────
// FIX Wave 6: returnează 0 în loc de null când repo nu are events
// null blocca rendering-ul în UI — 0 e un număr valid și afișabil
function calcRepoHealthScore(green, yellow, red) {
  const total = (green || 0) + (yellow || 0) + (red || 0);
  if (total === 0) return 0;
  const raw = ((green || 0) * 1.0 + (yellow || 0) * 0.4) / total;
  return Math.round(raw * 100);
}

function enrichReposWithHealth(repos) {
  return repos.map(r => ({
    ...r,
    health_score: calcRepoHealthScore(r.green, r.yellow, r.red),
  }));
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // FIX Wave 6: CORS OPTIONS preflight — fetch din browser trimite OPTIONS înainte de GET
  // Fără asta, browser-ul blochează request-ul și UI-ul rămâne în loading pentru totdeauna
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  // FIX Wave 6: timeout 8s pe Supabase — dacă DB e lentă, UI-ul nu mai
  // rămâne blocat la loading; servim seed data automat cu source: 'seed'
  let liveEvents = [];
  let liveRepos  = [];
  let supabaseOk = false;

  try {
    [liveEvents, liveRepos] = await withTimeout(
      Promise.all([
        queryEvents({ limit: 100 }),
        queryRepoStats(),
      ]),
      8000
    );
    supabaseOk = true;
  } catch (dbErr) {
    logger.warn('Supabase unavailable or timeout — falling back to seed data', {
      error: dbErr.message,
    });
  }

  try {
    const isLive = supabaseOk && liveEvents.length > 0;
    const events = isLive ? liveEvents : SEED_EVENTS.map(computeSeedEvent);
    const repos  = isLive ? liveRepos  : buildSeedRepos(events);

    logger.info('Dashboard query', { source: isLive ? 'supabase' : 'seed', events: events.length });

    const total     = events.length;
    const greenCnt  = events.filter(e => e.tier === 'green').length;
    const yellowCnt = events.filter(e => e.tier === 'yellow').length;
    const redCnt    = events.filter(e => e.tier === 'red').length;
    const totalKwh  = events.reduce((a, e) => a + parseFloat(e.energy_kwh || 0), 0);
    const totalCo2  = events.reduce((a, e) => a + parseFloat(e.carbon_kg  || 0), 0);

    const trend = buildTrend(events);

    const weeklyTrend       = buildWeeklyTrend(events);
    const movingAvg7        = buildMovingAvg7(trend);
    const eventDistribution = buildEventDistribution(events);
    const reposWithHealth   = enrichReposWithHealth(repos.slice(0, 20));

    return res.status(200).json({
      summary: {
        total_analyses:     total,
        green:              greenCnt,
        yellow:             yellowCnt,
        red:                redCnt,
        total_kwh:          parseFloat(totalKwh.toFixed(6)),
        avg_kwh:            total > 0 ? parseFloat((totalKwh / total).toFixed(6)) : 0,
        total_co2_kg:       parseFloat(totalCo2.toFixed(6)),
        week_over_week_pct: weeklyTrend.week_over_week_pct,
        week_direction:     weeklyTrend.direction,
      },
      thresholds: { yellow: YELLOW, red: RED },
      repos: reposWithHealth,
      trend,
      weekly_trend:       weeklyTrend,
      moving_avg_7d:      movingAvg7,
      event_distribution: eventDistribution,
      recent_events: events.slice(0, 20).map(e => ({
        id:         e.id         ?? null,
        repo:       e.repo,
        event_type: e.event_type,
        tier:       e.tier,
        energy_kwh: parseFloat(e.energy_kwh || 0),
        carbon_kg:  parseFloat(e.carbon_kg  || 0),
        actor:      e.actor      ?? null,
        pr_number:  e.pr_number  ?? null,
        commit_sha: e.commit_sha ? e.commit_sha.slice(0, 7) : null,
        created_at: e.created_at,
      })),
      source: isLive ? 'live' : 'seed',
      meta: {
        generated_at:   new Date().toISOString(),
        version:        '4.0',
        supabase_ok:    supabaseOk,
      },
    });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message, stack: err.stack });
    return res.status(500).json({
      error:   'Internal server error',
      message: err.message,
      source:  'error',
    });
  }
}

function buildSeedRepos(events) {
  const map = {};
  for (const e of events) {
    if (!map[e.repo]) map[e.repo] = { repo: e.repo, green: 0, yellow: 0, red: 0, total_kwh: 0, total_co2_kg: 0, count: 0 };
    map[e.repo][e.tier]++;
    map[e.repo].total_kwh    += parseFloat(e.energy_kwh || 0);
    map[e.repo].total_co2_kg += parseFloat(e.carbon_kg  || 0);
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
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - 86400000 * i);
    const key = d.toISOString().slice(0, 10);
    days[key] = { date: key, green: 0, yellow: 0, red: 0, total_kwh: 0 };
  }
  for (const e of events) {
    const key = (e.created_at || '').slice(0, 10);
    if (days[key]) {
      days[key][e.tier]++;
      days[key].total_kwh += parseFloat(e.energy_kwh || 0);
    }
  }
  return Object.values(days).map(d => ({
    ...d,
    total_kwh: parseFloat(d.total_kwh.toFixed(6)),
  }));
}

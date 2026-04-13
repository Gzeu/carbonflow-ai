/**
 * POST /api/carbon
 * Standalone carbon scorer — accepts code diff metrics and returns
 * energy estimate, carbon tier, breakdown, and recommendations.
 *
 * Body (JSON):
 *   additions                  {number}  lines added
 *   deletions                  {number}  lines deleted
 *   workflow_duration_minutes  {number?} CI/CD runtime
 *   files_changed              {number?} number of files modified
 *   region                     {string?} EU | US | CN | global (default: global)
 */
import { z } from 'zod';

const KWH_PER_LINE_ADD  = 0.0000012;
const KWH_PER_LINE_DEL  = 0.00000008;
const KWH_PER_CI_MINUTE = 0.000075;

// Grid intensity kg CO2 per kWh per region (2023 data)
const GRID_INTENSITY = {
  EU:     0.276,  // Eurostat 2023 average
  US:     0.386,  // EPA eGRID 2023
  CN:     0.581,  // IEA China 2023
  global: 0.233,  // IEA global average
};

const BodySchema = z.object({
  additions:                 z.number().int().nonnegative().default(0),
  deletions:                 z.number().int().nonnegative().default(0),
  workflow_duration_minutes: z.number().nonneg().optional(),
  files_changed:             z.number().int().nonneg().optional(),
  region:                    z.enum(['EU', 'US', 'CN', 'global']).default('global'),
});

function getTier(kwh, yellow, red) {
  if (kwh < yellow) return 'green';
  if (kwh < red)    return 'yellow';
  return 'red';
}

/**
 * Calculates a numeric carbon score from 0 to 100.
 * 100 = perfectly clean, 0 = extremely high impact.
 */
function calcNumericScore(kwh, yellowThreshold, redThreshold) {
  if (kwh <= 0) return 100;
  if (kwh >= redThreshold) {
    return Math.max(0, Math.round(10 - (kwh - redThreshold) * 10));
  }
  if (kwh >= yellowThreshold) {
    const ratio = (kwh - yellowThreshold) / (redThreshold - yellowThreshold);
    return Math.round(70 - ratio * 20);
  }
  // Green zone: 70–100
  const ratio = kwh / yellowThreshold;
  return Math.round(100 - ratio * 30);
}

function buildRecommendations(tier, breakdown, filesChanged) {
  const recs = [];

  if (breakdown.code_kwh > 0.3)
    recs.push('Split this change into smaller, focused commits to reduce per-commit energy impact.');
  if (breakdown.code_kwh > 0.6)
    recs.push('Consider extracting large refactors into separate PRs — smaller diffs = greener CI.');
  if ((breakdown.ci_kwh || 0) > 0.2)
    recs.push('Optimize CI pipelines: cache dependencies, parallelize jobs, and skip redundant steps.');
  if ((breakdown.ci_kwh || 0) > 0.5)
    recs.push('Long CI runs detected. Use path-based trigger filters so only affected tests run.');
  if (filesChanged && filesChanged > 20)
    recs.push('Many files changed — consider breaking this PR into smaller, reviewable chunks.');
  if (tier === 'green')
    recs.push('Great work! This change is within the green threshold. Keep commits small and focused.');
  if (tier === 'red')
    recs.push('Consider enabling CarbonFlow auto-blocking to prevent red commits from merging without review.');

  return recs.length ? recs : ['No specific recommendations — this change looks efficient.'];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      hint: 'Send POST with JSON body: { additions, deletions, workflow_duration_minutes?, files_changed?, region? }'
    });
  }

  let raw;
  try {
    if (req.body === undefined || req.body === null) {
      raw = {};
    } else {
      raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return res.status(422).json({
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const { additions, deletions, workflow_duration_minutes, files_changed, region } = parsed.data;

  const yellowThreshold = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
  const redThreshold    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');

  const KG_CO2_PER_KWH = GRID_INTENSITY[region];

  const code_kwh  = (additions * KWH_PER_LINE_ADD) + (deletions * KWH_PER_LINE_DEL);
  const ci_kwh    = workflow_duration_minutes ? workflow_duration_minutes * KWH_PER_CI_MINUTE : 0;
  const total_kwh = code_kwh + ci_kwh;
  const carbon_kg = total_kwh * KG_CO2_PER_KWH;

  const tier         = getTier(total_kwh, yellowThreshold, redThreshold);
  const score_numeric = calcNumericScore(total_kwh, yellowThreshold, redThreshold);

  const breakdown = {
    code_kwh:      parseFloat(code_kwh.toFixed(6)),
    ci_kwh:        parseFloat(ci_kwh.toFixed(6)),
    lines_net:     additions - deletions,
    files_changed: files_changed || null,
  };

  return res.status(200).json({
    energy_kwh:       parseFloat(total_kwh.toFixed(6)),
    carbon_kg:        parseFloat(carbon_kg.toFixed(6)),
    carbon_score:     tier,
    carbon_score_numeric: score_numeric,
    breakdown,
    recommendations:  buildRecommendations(tier, breakdown, files_changed),
    thresholds:       { yellow: yellowThreshold, red: redThreshold },
    meta: {
      model_version:             '2.0',
      region,
      grid_intensity_kg_per_kwh: KG_CO2_PER_KWH,
      timestamp:                 new Date().toISOString(),
    },
  });
}

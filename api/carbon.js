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
 *
 * Wave 5: model_version 3.0, region-aware recommendations, carbon budget hints
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

// Human-readable region labels
const REGION_LABELS = {
  EU:     'European Union',
  US:     'United States',
  CN:     'China',
  global: 'Global average',
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
  const ratio = kwh / yellowThreshold;
  return Math.round(100 - ratio * 30);
}

/**
 * Carbon budget hint: how many more lines of this size can be added
 * before hitting the yellow/red threshold.
 */
function calcBudgetHint(currentKwh, additions, yellowThreshold, redThreshold) {
  const linesPerKwh = additions > 0 ? additions / (additions * KWH_PER_LINE_ADD) : 1 / KWH_PER_LINE_ADD;
  const remainToYellow = Math.max(0, yellowThreshold - currentKwh);
  const remainToRed    = Math.max(0, redThreshold - currentKwh);
  return {
    kwh_to_yellow: parseFloat(remainToYellow.toFixed(6)),
    kwh_to_red:    parseFloat(remainToRed.toFixed(6)),
    lines_to_yellow: remainToYellow > 0 ? Math.floor(remainToYellow / KWH_PER_LINE_ADD) : 0,
    lines_to_red:    remainToRed > 0    ? Math.floor(remainToRed    / KWH_PER_LINE_ADD) : 0,
  };
}

/**
 * Wave 5: recommendations are now region-aware.
 * High-carbon-grid regions (US, CN) get stronger suggestions.
 */
function buildRecommendations(tier, breakdown, filesChanged, region) {
  const recs = [];
  const highGridRegion = region === 'US' || region === 'CN';

  // Region-specific context
  if (highGridRegion && tier !== 'green') {
    const intensity = GRID_INTENSITY[region];
    recs.push(
      `Grid intensity in ${REGION_LABELS[region]} is ${intensity} kg CO₂/kWh — ${region === 'CN' ? '2.5×' : '1.7×'} higher than global avg. Reducing CI runtime has outsized impact here.`
    );
  }

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

  if (tier === 'green') {
    if (region === 'EU')
      recs.push('Great work! EU grid is cleaner than average — this change is well within green threshold.');
    else
      recs.push('Great work! This change is within the green threshold. Keep commits small and focused.');
  }
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

  const tier          = getTier(total_kwh, yellowThreshold, redThreshold);
  const score_numeric = calcNumericScore(total_kwh, yellowThreshold, redThreshold);

  const breakdown = {
    code_kwh:      parseFloat(code_kwh.toFixed(6)),
    ci_kwh:        parseFloat(ci_kwh.toFixed(6)),
    lines_net:     additions - deletions,
    files_changed: files_changed || null,
  };

  // Wave 5: carbon budget hint
  const budget = calcBudgetHint(total_kwh, additions, yellowThreshold, redThreshold);

  return res.status(200).json({
    energy_kwh:           parseFloat(total_kwh.toFixed(6)),
    carbon_kg:            parseFloat(carbon_kg.toFixed(6)),
    carbon_score:         tier,
    carbon_score_numeric: score_numeric,
    breakdown,
    // Wave 5: how much budget remains before threshold
    carbon_budget:        budget,
    recommendations:      buildRecommendations(tier, breakdown, files_changed, region),
    thresholds:           { yellow: yellowThreshold, red: redThreshold },
    meta: {
      model_version:             '3.0',
      region,
      region_label:              REGION_LABELS[region],
      grid_intensity_kg_per_kwh: KG_CO2_PER_KWH,
      timestamp:                 new Date().toISOString(),
    },
  });
}

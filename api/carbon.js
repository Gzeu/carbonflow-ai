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
 *
 * Response:
 *   energy_kwh     {number}  estimated energy consumption
 *   carbon_kg      {number}  estimated CO₂ equivalent (kg)
 *   carbon_score   {string}  'green' | 'yellow' | 'red'
 *   breakdown      {object}  per-source breakdown
 *   recommendations {string[]} actionable suggestions
 */
import { z } from 'zod';

// ---------- constants ----------
const KWH_PER_LINE_ADD  = 0.0000012;   // energy cost per added line
const KWH_PER_LINE_DEL  = 0.00000008;  // deletions cost less
const KWH_PER_CI_MINUTE = 0.000075;    // average CI server energy/min
const KG_CO2_PER_KWH    = 0.233;       // EU average grid intensity (kg/kWh)

// ---------- Zod schema ----------
const BodySchema = z.object({
  additions:                 z.number().int().nonnegative().default(0),
  deletions:                 z.number().int().nonnegative().default(0),
  workflow_duration_minutes: z.number().nonneg().optional(),
  files_changed:             z.number().int().nonneg().optional(),
});

// ---------- helpers ----------
function getTier(kwh, yellow, red) {
  if (kwh < yellow) return 'green';
  if (kwh < red)    return 'yellow';
  return 'red';
}

function buildRecommendations(tier, breakdown) {
  const recs = [];
  if (breakdown.code_kwh > 0.3)
    recs.push('Split this change into smaller, focused commits to reduce per-commit energy impact.');
  if (breakdown.code_kwh > 0.6)
    recs.push('Consider extracting large refactors into separate PRs — smaller diffs = greener CI.');
  if ((breakdown.ci_kwh || 0) > 0.2)
    recs.push('Optimize CI pipelines: cache dependencies, parallelize jobs, and skip redundant steps.');
  if ((breakdown.ci_kwh || 0) > 0.5)
    recs.push('Long CI runs detected. Use path-based trigger filters so only affected tests run.');
  if (tier === 'green')
    recs.push('Great work! This change is within the green threshold. Keep commits small and focused.');
  if (tier === 'red')
    recs.push('Consider enabling CarbonFlow auto-blocking to prevent red commits from merging without review.');
  return recs.length ? recs : ['No specific recommendations — this change looks efficient.'];
}

// ---------- handler ----------
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // parse body
  let raw;
  try {
    raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // validate
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return res.status(422).json({
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const { additions, deletions, workflow_duration_minutes, files_changed } = parsed.data;

  const yellowThreshold = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
  const redThreshold    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');

  // calculate
  const code_kwh = (additions * KWH_PER_LINE_ADD) + (deletions * KWH_PER_LINE_DEL);
  const ci_kwh   = workflow_duration_minutes ? workflow_duration_minutes * KWH_PER_CI_MINUTE : 0;
  const total_kwh = code_kwh + ci_kwh;
  const carbon_kg = total_kwh * KG_CO2_PER_KWH;

  const tier = getTier(total_kwh, yellowThreshold, redThreshold);
  const breakdown = {
    code_kwh:   parseFloat(code_kwh.toFixed(6)),
    ci_kwh:     parseFloat(ci_kwh.toFixed(6)),
    lines_net:  additions - deletions,
    files_changed: files_changed || null,
  };

  return res.status(200).json({
    energy_kwh:      parseFloat(total_kwh.toFixed(6)),
    carbon_kg:       parseFloat(carbon_kg.toFixed(6)),
    carbon_score:    tier,
    breakdown,
    recommendations: buildRecommendations(tier, breakdown),
    thresholds: { yellow: yellowThreshold, red: redThreshold },
    meta: {
      model_version: '1.0',
      grid_intensity_kg_per_kwh: KG_CO2_PER_KWH,
      timestamp: new Date().toISOString(),
    },
  });
}

import { z } from 'zod';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [new transports.Console()],
});

const thresholdYellow = parseFloat(process.env.CARBON_THRESHOLD_YELLOW ?? '0.5');
const thresholdRed = parseFloat(process.env.CARBON_THRESHOLD_RED ?? '1.0');

const CarbonRequestSchema = z.object({
  additions: z.number().int().nonnegative().max(100_000),
  deletions: z.number().int().nonnegative().max(100_000),
  workflow_duration_minutes: z.number().nonnegative().max(480).optional(),
  repository: z.string().max(200).optional(),
  ref: z.string().max(200).optional(),
});

/**
 * POST /api/carbon
 * Standalone carbon scoring — accepts { additions, deletions, workflow_duration_minutes? }
 * Returns { score, energy_kwh, carbon_kg, breakdown, recommendations }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['POST'] });
  }

  const parsed = CarbonRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { additions, deletions, workflow_duration_minutes, repository, ref } = parsed.data;

  const codeEnergy = additions * 0.001 + deletions * 0.0005;
  const ciEnergy = workflow_duration_minutes != null ? workflow_duration_minutes * 0.01 : 0;
  const energy = parseFloat((codeEnergy + ciEnergy).toFixed(6));
  const carbonKg = parseFloat((energy * 0.4).toFixed(6));

  let score;
  if (energy >= thresholdRed) score = 'red';
  else if (energy >= thresholdYellow) score = 'yellow';
  else score = 'green';

  const recommendationMap = {
    green: [
      'Excellent! Keep following sustainable coding practices ♻️',
      'Consider green CI runners for even lower impact 🌿',
    ],
    yellow: [
      'Review loops for N+1 query patterns 📊',
      'Implement result caching (Redis / HTTP headers) 🔄',
      'Split large PRs into smaller atomic changes',
    ],
    red: [
      'Refactor hot paths — look for O(n²) algorithms 🔴',
      'Add caching layers to reduce compute load ⚡',
      'Audit database queries and add indexes',
      'Enable lazy loading and code splitting',
    ],
  };

  logger.info('Carbon score computed', { repository, ref, additions, deletions, energy, score });

  return res.status(200).json({
    score,
    energy_kwh: energy,
    carbon_kg: carbonKg,
    breakdown: {
      code_changes_kwh: parseFloat(codeEnergy.toFixed(6)),
      ci_cd_kwh: parseFloat(ciEnergy.toFixed(6)),
    },
    thresholds: { yellow: thresholdYellow, red: thresholdRed },
    recommendations: recommendationMap[score],
    meta: {
      service: 'CarbonFlow AI',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    },
  });
}

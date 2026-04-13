/**
 * GET /api/health
 * Readiness probe — checks all required env vars are configured.
 * Returns 200 OK with status map, or 503 if any critical var is missing.
 */
import { createRequire } from 'module';

const REQUIRED_VARS = [
  'WEBHOOK_SECRET',
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
];

const OPTIONAL_VARS = [
  'CARBON_THRESHOLD_YELLOW',
  'CARBON_THRESHOLD_RED',
  'MULTIVERSX_NETWORK',
  'BLOCKCHAIN_ENABLED',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const checks = {};
  let allOk = true;

  for (const v of REQUIRED_VARS) {
    const present = Boolean(process.env[v] && process.env[v].trim().length > 0);
    checks[v] = present ? 'ok' : 'missing';
    if (!present) allOk = false;
  }

  for (const v of OPTIONAL_VARS) {
    const present = Boolean(process.env[v] && process.env[v].trim().length > 0);
    checks[v] = present ? 'ok' : 'not_set';
  }

  const status = allOk ? 200 : 503;

  return res.status(status).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    node: process.version,
    uptime: Math.round(process.uptime()),
    env: checks,
    thresholds: {
      yellow_kwh: parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5'),
      red_kwh:    parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0'),
    },
  });
}

import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

/**
 * GET /api/health — liveness + readiness probe
 * Checks that all required environment variables are set.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checks = {
    webhook_secret: !!process.env.WEBHOOK_SECRET,
    github_app_id: !!process.env.GITHUB_APP_ID,
    private_key: !!(process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_PRIVATE_KEY.length > 100),
  };

  const allPassed = Object.values(checks).every(Boolean);
  const status = allPassed ? 'healthy' : 'degraded';

  logger.info('Health check', { status, checks });

  return res.status(allPassed ? 200 : 503).json({
    status,
    service: 'CarbonFlow AI',
    version: '2.0.0',
    checks,
    thresholds: {
      yellow_kwh: parseFloat(process.env.CARBON_THRESHOLD_YELLOW ?? '0.5'),
      red_kwh: parseFloat(process.env.CARBON_THRESHOLD_RED ?? '1.0'),
    },
    timestamp: new Date().toISOString(),
  });
}

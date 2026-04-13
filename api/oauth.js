// GET /api/oauth/callback — GitHub App OAuth installation callback
// After a user installs the GitHub App, GitHub redirects here with ?installation_id=X&setup_action=install
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const CallbackSchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  setup_action:    z.enum(['install', 'update', 'request']).default('install'),
  code:            z.string().optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = CallbackSchema.safeParse(req.query);
  if (!parsed.success) {
    logger.warn('oauth.invalid_callback', { query: req.query });
    return res.redirect(302, '/?error=invalid_callback');
  }

  const { installation_id, setup_action } = parsed.data;
  logger.info('oauth.callback', { installation_id, setup_action });

  // Verify installation exists via GitHub API
  let installationData = null;
  try {
    installationData = await verifyInstallation(installation_id);
  } catch (err) {
    logger.error('oauth.verify_failed', { installation_id, message: err.message });
    // Non-fatal — redirect to success anyway (app was installed)
  }

  // Persist to Supabase if configured
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
      await sb.from('installations').upsert({
        installation_id,
        account_login:  installationData?.account?.login ?? null,
        account_type:   installationData?.account?.type  ?? null,
        setup_action,
        installed_at:   new Date().toISOString(),
      }, { onConflict: 'installation_id' });
    } catch (err) {
      logger.warn('oauth.persist_failed', { message: err.message });
    }
  }

  // Redirect to dashboard with success message
  const redirectBase = process.env.APP_URL || 'https://carbonflow-ai.vercel.app';
  const params = new URLSearchParams({
    installed: '1',
    installation_id: String(installation_id),
    ...(installationData?.account?.login ? { account: installationData.account.login } : {}),
  });
  return res.redirect(302, `${redirectBase}/?${params.toString()}`);
}

async function verifyInstallation(installationId) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!appId || !privateKey) throw new Error('GitHub App credentials not configured');

  const { default: jwt } = await import('jsonwebtoken');
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ iat: now - 60, exp: now + 540, iss: appId }, privateKey, { algorithm: 'RS256' });

  const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'CarbonFlow-AI/2.0',
    },
  });

  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
}

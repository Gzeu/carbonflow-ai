/**
 * GET /api/repos?installation_id=<id>
 * Lists repositories accessible to a GitHub App installation.
 * Returns repo name, full_name, private, pushed_at.
 */
import { createLogger, format, transports } from 'winston';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const QuerySchema = z.object({
  installation_id: z.string().regex(/^\d+$/, 'Must be numeric').transform(Number),
});

function createAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!appId || !privateKey) throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat: now - 60, exp: now + 540, iss: appId }, privateKey, { algorithm: 'RS256' });
}

async function getInstallationToken(installationId) {
  const appJwt = createAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.token;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { installation_id } = parsed.data;

  try {
    const token = await getInstallationToken(installation_id);

    const ghRes = await fetch(
      'https://api.github.com/installation/repositories?per_page=100',
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!ghRes.ok) {
      const body = await ghRes.text();
      logger.error('GitHub API error fetching repos', { status: ghRes.status, body });
      return res.status(502).json({ error: 'GitHub API error', status: ghRes.status });
    }

    const { repositories, total_count } = await ghRes.json();

    const repos = repositories.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      pushed_at: r.pushed_at,
      html_url: r.html_url,
      default_branch: r.default_branch,
    }));

    logger.info('Repos listed', { installation_id, count: repos.length });
    return res.status(200).json({ total_count, repositories: repos });
  } catch (err) {
    logger.error('repos handler error', { message: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

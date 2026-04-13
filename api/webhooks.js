import crypto from 'crypto';
import { createLogger, format, transports } from 'winston';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { sendCarbonEmail } from '../lib/emailNotifier.js';
import { persistEvent } from '../lib/db.js';

// ─── Logger ───────────────────────────────────────────────────────────────────
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [new transports.Console()],
});

// ─── Environment config ───────────────────────────────────────────────────────
const CONFIG = {
  webhookSecret: process.env.WEBHOOK_SECRET,
  githubAppId: process.env.GITHUB_APP_ID,
  privateKey: (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  thresholdYellow: parseFloat(process.env.CARBON_THRESHOLD_YELLOW ?? '0.5'),
  thresholdRed: parseFloat(process.env.CARBON_THRESHOLD_RED ?? '1.0'),
};

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const CommitSchema = z.object({
  id: z.string(),
  message: z.string(),
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  modified: z.array(z.string()).default([]),
  stats: z.object({
    additions: z.number().default(0),
    deletions: z.number().default(0),
  }).optional(),
});

const PushPayloadSchema = z.object({
  commits: z.array(CommitSchema).default([]),
  repository: z.object({
    id: z.number(),
    full_name: z.string(),
    private: z.boolean().default(false),
    default_branch: z.string().default('main'),
  }),
  pusher: z.object({ name: z.string(), email: z.string().optional() }),
  installation: z.object({ id: z.number() }).optional(),
  ref: z.string().default('refs/heads/main'),
  after: z.string().optional(),
  compare: z.string().optional(),
});

const PullRequestPayloadSchema = z.object({
  action: z.enum(['opened', 'synchronize', 'closed', 'reopened', 'edited']),
  number: z.number(),
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    head: z.object({ sha: z.string(), ref: z.string() }),
    base: z.object({ ref: z.string() }),
    additions: z.number().default(0),
    deletions: z.number().default(0),
    changed_files: z.number().default(0),
    draft: z.boolean().default(false),
    merged: z.boolean().default(false),
    html_url: z.string().optional(),
  }),
  repository: z.object({
    id: z.number(),
    full_name: z.string(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  installation: z.object({ id: z.number() }).optional(),
});

const WorkflowRunPayloadSchema = z.object({
  action: z.enum(['requested', 'in_progress', 'completed']),
  workflow_run: z.object({
    id: z.number(),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  repository: z.object({ full_name: z.string() }),
  installation: z.object({ id: z.number() }).optional(),
});

// ─── HMAC signature verification ─────────────────────────────────────────────
function verifySignature(signature, secret, rawBody) {
  if (!signature || !secret) {
    logger.warn('Missing webhook signature or secret');
    return false;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (err) {
    logger.error('Signature verification failed', { error: err.message });
    return false;
  }
}

// ─── GitHub App JWT + Installation Token ─────────────────────────────────────
function createAppJwt() {
  if (!CONFIG.privateKey || !CONFIG.githubAppId) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY');
  }
  return jwt.sign(
    { iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 540, iss: CONFIG.githubAppId },
    CONFIG.privateKey,
    { algorithm: 'RS256' }
  );
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
    const text = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.token;
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────
async function githubPost(token, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn('GitHub API error', { status: res.status, path, body: text });
  }
  return res;
}

async function ensureLabel(token, owner, repo, name, color) {
  const check = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (check.status === 404) {
    await githubPost(token, `/repos/${owner}/${repo}/labels`, {
      name,
      color,
      description: `CarbonFlow AI — ${name}`,
    });
  }
}

async function addLabels(token, owner, repo, issueNumber, labels) {
  const labelColors = {
    'carbon-green': '2da44e',
    'carbon-yellow': 'f0e68c',
    'carbon-red': 'cf222e',
    'sustainability-check': '0e8a16',
  };
  for (const label of labels) {
    await ensureLabel(token, owner, repo, label, labelColors[label] || 'ededed').catch(() => {});
  }
  await githubPost(token, `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels });
}

async function postComment(token, owner, repo, issueNumber, body) {
  await githubPost(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
}

// ─── Carbon scoring engine ────────────────────────────────────────────────────
function scoreEnergy(energyKwh) {
  if (energyKwh >= CONFIG.thresholdRed) return 'red';
  if (energyKwh >= CONFIG.thresholdYellow) return 'yellow';
  return 'green';
}

function estimateEnergyFromLines(additions, deletions) {
  return additions * 0.001 + deletions * 0.0005;
}

function buildCarbonComment(score, additions, deletions, energyKwh) {
  const carbonKg = (energyKwh * 0.4).toFixed(4);
  const badge = score === 'green' ? '🟢' : score === 'yellow' ? '🟡' : '🔴';
  const label =
    score === 'green' ? 'Low Carbon Impact' :
    score === 'yellow' ? 'Moderate Carbon Impact' : 'High Carbon Impact';

  const recs = {
    green: [
      'Keep following sustainable coding practices ♻️',
      'Consider green hosting providers 🌿',
    ],
    yellow: [
      'Review loops and database queries for N+1 problems 📊',
      'Implement caching where applicable 🔄',
      'Consider splitting large PRs into smaller atomic changes',
    ],
    red: [
      'Refactor heavy algorithms — look for O(n²) patterns 🔴',
      'Add caching layers (Redis/CDN) to reduce compute load ⚡',
      'Review database queries and add proper indexes',
      'Consider lazy loading and code splitting',
    ],
  };

  return [
    `## ${badge} CarbonFlow AI — Carbon Impact Report`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Status** | ${badge} **${label}** |`,
    `| **Lines Added** | +${additions} |`,
    `| **Lines Removed** | -${deletions} |`,
    `| **Estimated Energy** | \`${energyKwh.toFixed(4)} kWh\` |`,
    `| **Estimated CO₂** | \`${carbonKg} kg\` |`,
    '',
    '### 💡 Recommendations',
    ...recs[score].map(r => `- ${r}`),
    '',
    '---',
    `*Automated analysis by [CarbonFlow AI Tracker](https://carbonflow-ai.vercel.app) · Thresholds: 🟡 >${CONFIG.thresholdYellow} kWh · 🔴 >${CONFIG.thresholdRed} kWh*`,
  ].join('\n');
}

// ─── Event handlers ───────────────────────────────────────────────────────────
async function handlePush(payload, token) {
  const parsed = PushPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('Invalid push payload', { errors: parsed.error.flatten() });
    return { action: 'ignored', reason: 'schema_validation_failed' };
  }

  const { commits, repository, pusher, after, compare } = parsed.data;

  const rl = checkRateLimit(repository.full_name);
  if (!rl.allowed) {
    logger.warn('Rate limit exceeded for push', { repo: repository.full_name, resetAt: rl.resetAt });
    return { action: 'rate_limited', repo: repository.full_name, resetAt: rl.resetAt };
  }

  logger.info('Processing push event', { repo: repository.full_name, commits: commits.length });

  let totalAdditions = 0;
  let totalDeletions = 0;
  commits.forEach(c => {
    totalAdditions += c.stats?.additions ?? c.added.length * 10;
    totalDeletions += c.stats?.deletions ?? c.removed.length * 10;
  });

  const energy = estimateEnergyFromLines(totalAdditions, totalDeletions);
  const score = scoreEnergy(energy);
  const carbonKg = parseFloat((energy * 0.4).toFixed(4));

  logger.info('Push carbon analysis', { repo: repository.full_name, energy, score });

  // Persistă în Supabase (non-blocking)
  persistEvent({
    repo:       repository.full_name,
    event_type: 'push',
    additions:  totalAdditions,
    deletions:  totalDeletions,
    energy_kwh: parseFloat(energy.toFixed(6)),
    carbon_kg:  carbonKg,
    tier:       score,
    commit_sha: after ?? null,
    actor:      pusher?.name ?? null,
    meta:       { commits: commits.length, compare: compare ?? null },
  }).catch(err => logger.error('DB persist failed (push)', { error: err.message }));

  // Email notification (non-fatal)
  sendCarbonEmail({
    repo: repository.full_name,
    label: score,
    energy_kwh: energy,
    carbon_kg: carbonKg,
    commit_url: compare ?? '',
    actor: pusher?.name,
  }).catch(err => logger.error('Email notification failed (push)', { error: err.message }));

  if (score === 'red' && token) {
    const [owner, repo] = repository.full_name.split('/');
    const commentBody = buildCarbonComment(score, totalAdditions, totalDeletions, energy);
    await githubPost(token, `/repos/${owner}/${repo}/issues`, {
      title: `🔴 High Carbon Footprint — Push on ${repository.default_branch}`,
      body: commentBody,
      labels: ['carbon-red', 'sustainability-check'],
    }).catch(err => logger.error('Failed to create issue', { error: err.message }));
  }

  return {
    action: 'analyzed',
    score,
    energy: parseFloat(energy.toFixed(4)),
    carbon_kg: carbonKg,
    commits: commits.length,
    rateLimitRemaining: rl.remaining,
  };
}

async function handlePullRequest(payload, token) {
  const parsed = PullRequestPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('Invalid PR payload', { errors: parsed.error.flatten() });
    return { action: 'ignored', reason: 'schema_validation_failed' };
  }

  const { action, pull_request: pr, repository } = parsed.data;

  if (!['opened', 'synchronize'].includes(action)) {
    return { action: 'ignored', reason: `event_action_${action}` };
  }
  if (pr.draft) {
    logger.info('Skipping draft PR', { pr: pr.number });
    return { action: 'ignored', reason: 'draft_pr' };
  }

  const rl = checkRateLimit(repository.full_name);
  if (!rl.allowed) {
    logger.warn('Rate limit exceeded for PR', { repo: repository.full_name, pr: pr.number, resetAt: rl.resetAt });
    return { action: 'rate_limited', repo: repository.full_name, pr: pr.number, resetAt: rl.resetAt };
  }

  const { additions, deletions, number: prNumber, html_url, head } = pr;
  const energy = estimateEnergyFromLines(additions, deletions);
  const score = scoreEnergy(energy);
  const carbonKg = parseFloat((energy * 0.4).toFixed(4));
  const [owner, repo] = repository.full_name.split('/');

  logger.info('PR carbon analysis', { repo: repository.full_name, pr: prNumber, score, energy });

  // Persistă în Supabase (non-blocking)
  persistEvent({
    repo:       repository.full_name,
    event_type: 'pull_request',
    additions,
    deletions,
    energy_kwh: parseFloat(energy.toFixed(6)),
    carbon_kg:  carbonKg,
    tier:       score,
    pr_number:  prNumber,
    commit_sha: head?.sha ?? null,
    actor:      null,
    meta:       { pr_url: html_url ?? null, action },
  }).catch(err => logger.error('DB persist failed (PR)', { error: err.message }));

  // Email notification (non-fatal)
  sendCarbonEmail({
    repo: repository.full_name,
    label: score,
    energy_kwh: energy,
    carbon_kg: carbonKg,
    commit_url: html_url ?? '',
    prNumber,
  }).catch(err => logger.error('Email notification failed (PR)', { error: err.message }));

  if (token) {
    const carbonLabel = `carbon-${score}`;
    const staleLabels = ['carbon-green', 'carbon-yellow', 'carbon-red'].filter(l => l !== carbonLabel);

    await Promise.allSettled(
      staleLabels.map(stale =>
        fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/labels/${encodeURIComponent(stale)}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          }
        )
      )
    );

    await addLabels(token, owner, repo, prNumber, [carbonLabel, 'sustainability-check'])
      .catch(err => logger.error('Failed to add labels', { error: err.message }));

    const comment = buildCarbonComment(score, additions, deletions, energy);
    await postComment(token, owner, repo, prNumber, comment)
      .catch(err => logger.error('Failed to post comment', { error: err.message }));
  }

  return {
    action: 'commented_and_labeled',
    pr: prNumber,
    score,
    energy: parseFloat(energy.toFixed(4)),
    carbon_kg: carbonKg,
    rateLimitRemaining: rl.remaining,
  };
}

async function handleWorkflowRun(payload) {
  const parsed = WorkflowRunPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('Invalid workflow_run payload', { errors: parsed.error.flatten() });
    return { action: 'ignored', reason: 'schema_validation_failed' };
  }

  const { action, workflow_run, repository } = parsed.data;
  if (action !== 'completed') return { action: 'ignored', reason: 'not_completed' };

  const durationMs  = new Date(workflow_run.updated_at) - new Date(workflow_run.created_at);
  const durationMin = durationMs / 60000;
  const energy      = parseFloat((durationMin * 0.01).toFixed(6));
  const carbonKg    = parseFloat((energy * 0.4).toFixed(6));
  const score       = scoreEnergy(energy);

  logger.info('Workflow carbon analysis', {
    repo: repository.full_name,
    workflow: workflow_run.name,
    durationMin: durationMin.toFixed(1),
    energy, carbonKg, score,
    conclusion: workflow_run.conclusion,
  });

  // Persistă în Supabase (non-blocking)
  persistEvent({
    repo:                 repository.full_name,
    event_type:           'workflow_run',
    additions:            0,
    deletions:            0,
    energy_kwh:           energy,
    carbon_kg:            carbonKg,
    tier:                 score,
    ci_duration_minutes:  parseFloat(durationMin.toFixed(2)),
    meta: {
      workflow_name: workflow_run.name,
      workflow_id:   workflow_run.id,
      conclusion:    workflow_run.conclusion ?? null,
    },
  }).catch(err => logger.error('DB persist failed (workflow_run)', { error: err.message }));

  return {
    action: 'logged',
    workflow: workflow_run.name,
    durationMin: parseFloat(durationMin.toFixed(1)),
    energy,
    carbonKg,
    score,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'healthy',
      service: 'CarbonFlow AI Webhook',
      version: '3.1.0',
      thresholds: { yellow: CONFIG.thresholdYellow, red: CONFIG.thresholdRed },
      features: ['rate-limiting', 'email-notifications', 'supabase-persistence', 'slack-alerts'],
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['GET', 'POST'] });
  }

  const signature  = req.headers['x-hub-signature-256'];
  const event      = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'];

  if (!event) {
    return res.status(400).json({ error: 'Missing x-github-event header' });
  }

  const rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');

  if (CONFIG.webhookSecret && !verifySignature(signature, CONFIG.webhookSecret, rawBody)) {
    logger.warn('Invalid webhook signature', { deliveryId, event });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  logger.info('Webhook received', { event, deliveryId });

  let result = { action: 'ignored' };

  try {
    const installationId = req.body?.installation?.id;
    let token = null;
    if (installationId && CONFIG.privateKey && CONFIG.githubAppId) {
      token = await getInstallationToken(installationId).catch(err => {
        logger.error('Failed to get installation token', { error: err.message, installationId });
        return null;
      });
    }

    switch (event) {
      case 'ping':
        logger.info('Ping received', { zen: req.body?.zen });
        result = { action: 'pong', zen: req.body?.zen ?? '' };
        break;
      case 'push':
        result = await handlePush(req.body, token);
        break;
      case 'pull_request':
        result = await handlePullRequest(req.body, token);
        break;
      case 'workflow_run':
        result = await handleWorkflowRun(req.body);
        break;
      default:
        logger.info('Unhandled event type', { event });
    }
  } catch (err) {
    logger.error('Unhandled webhook error', { event, deliveryId, error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(200).json({
    ok: true,
    event,
    deliveryId,
    result,
    meta: {
      service: 'CarbonFlow AI Tracker',
      version: '3.1.0',
      timestamp: new Date().toISOString(),
    },
  });
}

import crypto from 'crypto';
import { createLogger, format, transports } from 'winston';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { sendCarbonEmail } from '../lib/emailNotifier.js';
import { persistEvent, getLastEvent, getGreenStreak } from '../lib/db.js';

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

async function ensureLabel(token, owner, repo, name, color, description) {
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
      description: description || `CarbonFlow AI — ${name}`,
    });
  }
}

async function addLabels(token, owner, repo, issueNumber, labels, labelMeta = {}) {
  const defaultColors = {
    'carbon-green':          '2da44e',
    'carbon-yellow':         'e3b341',
    'carbon-red':            'cf222e',
    'sustainability-check':  '0e8a16',
  };
  for (const label of labels) {
    const color = labelMeta[label]?.color || defaultColors[label] || 'ededed';
    const desc  = labelMeta[label]?.description || undefined;
    await ensureLabel(token, owner, repo, label, color, desc).catch(() => {});
  }
  await githubPost(token, `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels });
}

async function cleanStaleScoreLabels(token, owner, repo, issueNumber) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!res.ok) return;
    const existing = await res.json();
    const stale = (existing || []).filter(l => /^carbon-score:\s*\d+$/.test(l.name));
    await Promise.allSettled(
      stale.map(l =>
        fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(l.name)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
      )
    );
  } catch (err) {
    logger.warn('cleanStaleScoreLabels failed', { error: err.message });
  }
}

async function postComment(token, owner, repo, issueNumber, body) {
  await githubPost(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
}

// ─── Carbon scoring engine ────────────────────────────────────────────────────
function scoreEnergy(energyKwh) {
  if (energyKwh >= CONFIG.thresholdRed)    return 'red';
  if (energyKwh >= CONFIG.thresholdYellow) return 'yellow';
  return 'green';
}

function estimateEnergyFromLines(additions, deletions) {
  return additions * 0.001 + deletions * 0.0005;
}

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

function detectChangeType(additions, deletions) {
  const net = additions - deletions;
  if (deletions > additions * 1.5) return 'cleanup / refactor';
  if (net > 300) return 'large feature';
  if (net > 80)  return 'medium feature';
  if (net < 0)   return 'code removal';
  return 'small change';
}

function calcTrend(currentKwh, lastKwh) {
  if (lastKwh == null || lastKwh === 0) return null;
  const pct = Math.round(((currentKwh - lastKwh) / lastKwh) * 100);
  if (Math.abs(pct) < 2) return { pct: 0, direction: 'same', label: '➡️ Roughly the same as last PR' };
  if (pct > 0) return { pct, direction: 'up',   label: `↑ **+${pct}%** higher impact than last PR` };
  return      { pct, direction: 'down', label: `↓ **${pct}%** lower impact than last PR 🎉` };
}

/**
 * Wave 6: Carbon budget — how many lines remain before hitting yellow/red.
 * Uses 0.001 kWh/line (same constant as estimateEnergyFromLines).
 */
function calcBudgetRows(energyKwh) {
  const KWH_PER_LINE = 0.001;
  const remainYellow = Math.max(0, CONFIG.thresholdYellow - energyKwh);
  const remainRed    = Math.max(0, CONFIG.thresholdRed    - energyKwh);
  const linesToYellow = remainYellow > 0 ? Math.floor(remainYellow / KWH_PER_LINE) : 0;
  const linesToRed    = remainRed    > 0 ? Math.floor(remainRed    / KWH_PER_LINE) : 0;

  // Only show budget rows when there's still room (not already past threshold)
  if (energyKwh >= CONFIG.thresholdRed) return [];

  if (energyKwh >= CONFIG.thresholdYellow) {
    // Yellow zone — show only distance to red
    return [
      `| 🚦 | **Budget to 🔴 red** | ~${linesToRed.toLocaleString()} lines remaining |`,
    ];
  }

  // Green zone — show both
  return [
    `| 🟡 | **Budget to yellow** | ~${linesToYellow.toLocaleString()} lines remaining |`,
    `| 🔴 | **Budget to red** | ~${linesToRed.toLocaleString()} lines remaining |`,
  ];
}

/**
 * Wave 6: Format green streak row.
 * streak = 0  → omit (don't show it).
 * streak = 1  → "1 green PR" (this one just started it).
 * streak >= 2 → fire emoji milestone.
 */
function buildStreakRow(streak) {
  if (!streak || streak < 1) return [];
  const fire   = streak >= 10 ? '🔥🔥' : streak >= 5 ? '🔥' : '🌱';
  const suffix = streak === 1
    ? 'First green in a row — keep it up!'
    : `**${streak} green PR${streak > 1 ? 's' : ''} in a row!**`;
  return [`| ${fire} | **Green streak** | ${suffix} |`];
}

/**
 * Builds the Markdown PR comment.
 * Wave 6 additions: green_streak row + carbon_budget rows.
 */
function buildCarbonComment(score, additions, deletions, energyKwh, numericScore, lastEvent = null, greenStreak = 0) {
  const carbonGrams = (energyKwh * 0.4 * 1000).toFixed(1);
  const energyWh    = (energyKwh * 1000).toFixed(2);

  const badge = score === 'green' ? '🌿' : score === 'yellow' ? '⚠️' : '🔥';
  const statusText =
    score === 'green'  ? '✅ Below threshold — low impact' :
    score === 'yellow' ? '⚠️ Moderate threshold reached'  : '🚨 High threshold exceeded';

  const maxKwh = CONFIG.thresholdRed * 1.5;
  const filled = Math.min(10, Math.round((energyKwh / maxKwh) * 10));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  const scoreEmoji = numericScore >= 80 ? '🟢' : numericScore >= 50 ? '🟡' : '🔴';
  const changeType = detectChangeType(additions, deletions);

  const trend = calcTrend(energyKwh, lastEvent?.energy_kwh ?? null);
  const trendRows = trend ? [`| 📈 | **Trend vs last PR** | ${trend.label} |`] : [];
  const prevScoreRows = (lastEvent?.numeric_score != null) ? [
    `| 🔁 | **Prev PR score** | ${lastEvent.numeric_score} / 100 · tier: \`${lastEvent.tier}\` |`,
  ] : [];

  // Wave 6 additions
  const streakRows = buildStreakRow(greenStreak);
  const budgetRows = calcBudgetRows(energyKwh);

  const recs = {
    green: [
      '✅ Efficient commit — keep PRs small and focused.',
      '♻️ Consider caching static data to further reduce compute cost.',
    ],
    yellow: [
      '📦 PR is moderately large — consider splitting into 2–3 focused PRs.',
      '🔄 Check for N+1 database query patterns in the new code.',
      '🗜️ Enable dependency caching in your CI pipeline to reduce workflow energy.',
    ],
    red: [
      '🚨 High impact detected — review algorithms for O(n²) patterns.',
      '⚡ Add caching layers (in-memory or CDN) for repeated expensive operations.',
      '🔀 Separate large refactors from feature additions into distinct PRs.',
      '📊 Consider enabling CarbonFlow auto-block to require review on red PRs.',
    ],
  };

  if (trend?.direction === 'up' && trend.pct > 20) {
    recs[score].unshift(`⚠️ Carbon impact increased **+${trend.pct}%** vs last PR — worth investigating what changed.`);
  }

  return [
    `## ${badge} CarbonFlow AI — Carbon Impact Report`,
    '',
    `> **${changeType.charAt(0).toUpperCase() + changeType.slice(1)}** · \`+${additions}\` additions · \`-${deletions}\` deletions`,
    '',
    '| | Metric | Value |',
    '|---|---|---|',
    `| ${scoreEmoji} | **Carbon Score** | **${numericScore} / 100** |`,
    `| 🔋 | **Energy bar** | \`${bar}\` ${energyWh} Wh |`,
    `| 💨 | **CO₂ estimated** | **${carbonGrams} g** CO₂ |`,
    `| 📊 | **Status** | ${statusText} |`,
    `| ➕ | **Lines added** | +${additions} |`,
    `| ➖ | **Lines removed** | -${deletions} |`,
    ...trendRows,
    ...prevScoreRows,
    // Wave 6: streak + budget rows injected here
    ...streakRows,
    ...budgetRows,
    '',
    '### 💡 Recommendations',
    ...recs[score].map(r => `- ${r}`),
    '',
    '---',
    `<sub>🌱 Automated analysis by [CarbonFlow AI](https://carbonflow-ai.vercel.app) · Thresholds: 🟡 >${CONFIG.thresholdYellow} kWh · 🔴 >${CONFIG.thresholdRed} kWh · v4.0.0</sub>`,
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

  const energy      = estimateEnergyFromLines(totalAdditions, totalDeletions);
  const score       = scoreEnergy(energy);
  const carbonKg    = parseFloat((energy * 0.4).toFixed(4));
  const numericScore = calcNumericScore(energy, CONFIG.thresholdYellow, CONFIG.thresholdRed);

  logger.info('Push carbon analysis', { repo: repository.full_name, energy, score, numericScore });

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
    meta:       { commits: commits.length, compare: compare ?? null, numeric_score: numericScore },
  }).catch(err => logger.error('DB persist failed (push)', { error: err.message }));

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
    const commentBody = buildCarbonComment(score, totalAdditions, totalDeletions, energy, numericScore, null, 0);
    await githubPost(token, `/repos/${owner}/${repo}/issues`, {
      title: `🔥 High Carbon Footprint — Push on ${repository.default_branch} (score: ${numericScore}/100)`,
      body: commentBody,
      labels: ['carbon-red', 'sustainability-check'],
    }).catch(err => logger.error('Failed to create issue', { error: err.message }));
  }

  return {
    action: 'analyzed',
    score,
    numeric_score: numericScore,
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
  const energy       = estimateEnergyFromLines(additions, deletions);
  const score        = scoreEnergy(energy);
  const carbonKg     = parseFloat((energy * 0.4).toFixed(4));
  const numericScore = calcNumericScore(energy, CONFIG.thresholdYellow, CONFIG.thresholdRed);
  const [owner, repo] = repository.full_name.split('/');

  // Wave 3: last event for trend; Wave 6: green streak in parallel
  const [lastEvent, greenStreak] = await Promise.all([
    getLastEvent(repository.full_name, 'pull_request').catch(err => {
      logger.warn('getLastEvent failed', { error: err.message });
      return null;
    }),
    // getGreenStreak returns number of consecutive green pull_request events
    // from the most recent backward. Falls back to 0 on error.
    getGreenStreak(repository.full_name, 'pull_request').catch(err => {
      logger.warn('getGreenStreak failed', { error: err.message });
      return 0;
    }),
  ]);

  // If the current PR is green, the real streak is lastStreak + 1 (this PR).
  // If it's not green, streak resets to 0 for the comment.
  const displayStreak = score === 'green' ? greenStreak + 1 : 0;

  const trend = calcTrend(energy, lastEvent?.energy_kwh ?? null);
  if (trend) {
    logger.info('PR carbon trend', { repo: repository.full_name, pr: prNumber, trendPct: trend.pct, direction: trend.direction });
  }

  logger.info('PR carbon analysis', {
    repo: repository.full_name, pr: prNumber, score, energy, numericScore, greenStreak: displayStreak,
  });

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
    meta:       { pr_url: html_url ?? null, action, numeric_score: numericScore },
  }).catch(err => logger.error('DB persist failed (PR)', { error: err.message }));

  sendCarbonEmail({
    repo: repository.full_name,
    label: score,
    energy_kwh: energy,
    carbon_kg: carbonKg,
    commit_url: html_url ?? '',
    prNumber,
  }).catch(err => logger.error('Email notification failed (PR)', { error: err.message }));

  if (token) {
    const carbonLabel  = `carbon-${score}`;
    const scoreLabel   = `carbon-score: ${numericScore}`;
    const scoreLabelColor =
      score === 'green' ? '2da44e' : score === 'yellow' ? 'e3b341' : 'cf222e';

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

    await cleanStaleScoreLabels(token, owner, repo, prNumber);

    const labelsToAdd = [carbonLabel, 'sustainability-check', scoreLabel];
    const labelMetaExtra = {};
    if (trend?.direction === 'down' && Math.abs(trend.pct) >= 10) {
      labelsToAdd.push('carbon-improved');
      labelMetaExtra['carbon-improved'] = {
        color: '0075ca',
        description: 'CarbonFlow AI — carbon impact improved vs last PR',
      };
    }
    // Wave 6: add streak milestone label when streak ≥ 5
    if (displayStreak >= 5) {
      labelsToAdd.push('carbon-streak');
      labelMetaExtra['carbon-streak'] = {
        color: '238636',
        description: `CarbonFlow AI — ${displayStreak} consecutive green PRs 🔥`,
      };
    }

    await addLabels(
      token, owner, repo, prNumber,
      labelsToAdd,
      {
        [scoreLabel]: {
          color: scoreLabelColor,
          description: `CarbonFlow AI — numeric score ${numericScore}/100`,
        },
        ...labelMetaExtra,
      }
    ).catch(err => logger.error('Failed to add labels', { error: err.message }));

    // Wave 6: pass displayStreak and budget will be auto-calculated inside builder
    const comment = buildCarbonComment(score, additions, deletions, energy, numericScore, lastEvent, displayStreak);
    await postComment(token, owner, repo, prNumber, comment)
      .catch(err => logger.error('Failed to post comment', { error: err.message }));
  }

  return {
    action: 'commented_and_labeled',
    pr: prNumber,
    score,
    numeric_score: numericScore,
    green_streak: displayStreak,
    energy: parseFloat(energy.toFixed(4)),
    carbon_kg: carbonKg,
    trend: trend ? { pct: trend.pct, direction: trend.direction } : null,
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
  const numericScore = calcNumericScore(energy, CONFIG.thresholdYellow, CONFIG.thresholdRed);

  logger.info('Workflow carbon analysis', {
    repo: repository.full_name,
    workflow: workflow_run.name,
    durationMin: durationMin.toFixed(1),
    energy, carbonKg, score, numericScore,
    conclusion: workflow_run.conclusion,
  });

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
      workflow_name:  workflow_run.name,
      workflow_id:    workflow_run.id,
      conclusion:     workflow_run.conclusion ?? null,
      numeric_score:  numericScore,
    },
  }).catch(err => logger.error('DB persist failed (workflow_run)', { error: err.message }));

  return {
    action: 'logged',
    workflow: workflow_run.name,
    durationMin: parseFloat(durationMin.toFixed(2)),
    energy,
    carbonKg,
    score,
    numeric_score: numericScore,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'healthy',
      service: 'CarbonFlow AI Webhook',
      version: '4.0.0',
      thresholds: { yellow: CONFIG.thresholdYellow, red: CONFIG.thresholdRed },
      features: [
        'rate-limiting',
        'email-notifications',
        'supabase-persistence',
        'numeric-score',
        'enhanced-pr-comments',
        'pr-trend-comparison',
        'green-streak',          // Wave 6
        'carbon-budget-hint',    // Wave 6
        'streak-milestone-label',// Wave 6
      ],
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
      version: '4.0.0',
      timestamp: new Date().toISOString(),
    },
  });
}

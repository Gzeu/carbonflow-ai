// POST /api/notify — send Slack / email notification for carbon threshold breach
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const NotifySchema = z.object({
  repo:       z.string().min(1),
  label:      z.enum(['green', 'yellow', 'red']),
  energy_kwh: z.number().positive(),
  carbon_kg:  z.number().positive(),
  commit_sha: z.string().optional(),
  commit_url: z.string().url().optional(),
  pr_number:  z.number().int().positive().optional(),
  actor:      z.string().optional(),
  channel:    z.enum(['slack', 'all']).default('all'),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = NotifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const results = {};

  // Only notify on yellow or red by default (green notifications are noisy)
  if (data.label === 'green' && !process.env.NOTIFY_ON_GREEN) {
    return res.status(200).json({ skipped: true, reason: 'Green commits do not trigger notifications unless NOTIFY_ON_GREEN=1' });
  }

  // ── Slack ──────────────────────────────────────────────────────────────────
  if ((data.channel === 'slack' || data.channel === 'all') && process.env.SLACK_WEBHOOK_URL) {
    try {
      results.slack = await sendSlack(data);
    } catch (err) {
      logger.error('notify.slack.error', { message: err.message });
      results.slack = { ok: false, error: err.message };
    }
  }

  logger.info('notify.sent', { repo: data.repo, label: data.label, channels: Object.keys(results) });
  return res.status(200).json({ ok: true, results });
}

// ── Slack Block Kit message ────────────────────────────────────────────────────
async function sendSlack(data) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL not configured');

  const emoji = { green: ':large_green_circle:', yellow: ':large_yellow_circle:', red: ':red_circle:' }[data.label];
  const threshold = { green: '< 0.5 kWh', yellow: '0.5–1.0 kWh', red: '> 1.0 kWh' }[data.label];
  const urgency  = data.label === 'red' ? ' <!channel>' : '';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} CarbonFlow Alert — ${data.label.toUpperCase()} Commit${urgency}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Repository*\n\`${data.repo}\`` },
        { type: 'mrkdwn', text: `*Score*\n${emoji} ${data.label.toUpperCase()} (${threshold})` },
        { type: 'mrkdwn', text: `*Energy*\n${data.energy_kwh.toFixed(6)} kWh` },
        { type: 'mrkdwn', text: `*Carbon*\n${data.carbon_kg.toFixed(6)} kg CO₂` },
        ...(data.actor    ? [{ type: 'mrkdwn', text: `*Actor*\n${data.actor}` }] : []),
        ...(data.commit_sha ? [{ type: 'mrkdwn', text: `*Commit*\n\`${data.commit_sha.slice(0, 8)}\`` }] : []),
      ],
    },
    ...(data.commit_url ? [{
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'View Commit', emoji: true },
        url: data.commit_url,
        style: data.label === 'red' ? 'danger' : 'primary',
      }],
    }] : []),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Sent by <https://carbonflow-ai.vercel.app|CarbonFlow AI> · ${new Date().toUTCString()}` }],
    },
  ];

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) throw new Error(`Slack returned ${response.status}: ${await response.text()}`);
  return { ok: true };
}

// Reusable notification helpers — used internally by api/webhooks.js
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

/**
 * Send Slack notification if SLACK_WEBHOOK_URL is configured.
 * Non-fatal — webhook will still succeed if this fails.
 */
export async function sendSlackAlert({ repo, label, energy_kwh, carbon_kg, commit_sha, commit_url, actor, pr_number }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return null;

  // Only alert on yellow/red unless NOTIFY_ON_GREEN=1
  if (label === 'green' && !process.env.NOTIFY_ON_GREEN) return null;

  const emoji     = { green: ':large_green_circle:', yellow: ':large_yellow_circle:', red: ':red_circle:' }[label];
  const threshold = { green: '< 0.5 kWh', yellow: '0.5–1.0 kWh', red: '> 1.0 kWh' }[label];
  const urgency   = label === 'red' ? ' <!channel>' : '';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} CarbonFlow — ${label.toUpperCase()} Alert${urgency}`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Repo*\n\`${repo}\`` },
        { type: 'mrkdwn', text: `*Score*\n${emoji} ${label.toUpperCase()} (${threshold})` },
        { type: 'mrkdwn', text: `*Energy*\n${energy_kwh.toFixed(6)} kWh` },
        { type: 'mrkdwn', text: `*Carbon*\n${carbon_kg.toFixed(6)} kg CO₂` },
        ...(actor       ? [{ type: 'mrkdwn', text: `*Actor*\n${actor}` }]                      : []),
        ...(pr_number   ? [{ type: 'mrkdwn', text: `*PR*\n#${pr_number}` }]                   : []),
        ...(commit_sha  ? [{ type: 'mrkdwn', text: `*Commit*\n\`${commit_sha.slice(0,8)}\`` }] : []),
      ],
    },
    ...(commit_url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View on GitHub', emoji: true }, url: commit_url, style: label === 'red' ? 'danger' : 'primary' }] }] : []),
    { type: 'context', elements: [{ type: 'mrkdwn', text: `<https://carbonflow-ai.vercel.app|CarbonFlow AI> · ${new Date().toUTCString()}` }] },
  ];

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!resp.ok) throw new Error(`Slack ${resp.status}`);
    logger.info('notifier.slack.sent', { repo, label });
    return { ok: true };
  } catch (err) {
    logger.error('notifier.slack.error', { message: err.message, repo });
    return { ok: false, error: err.message };
  }
}

export function formatCarbonMessage({ repo, label, energy_kwh, carbon_kg, recommendations }) {
  const icon = label === 'green' ? '🟢' : label === 'yellow' ? '🟡' : '🔴';
  const lines = [
    `${icon} **CarbonFlow Report** — \`${repo}\``,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Score  | ${label.toUpperCase()} |`,
    `| Energy | ${energy_kwh.toFixed(6)} kWh |`,
    `| Carbon | ${carbon_kg.toFixed(6)} kg CO₂ |`,
  ];
  if (recommendations?.length) {
    lines.push('', '**Recommendations:**');
    for (const r of recommendations) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

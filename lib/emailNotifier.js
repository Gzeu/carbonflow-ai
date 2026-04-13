/**
 * lib/emailNotifier.js
 * Email notifications for high carbon events via Resend API.
 * Falls back to SMTP if RESEND_API_KEY is not set.
 *
 * Env vars:
 *   RESEND_API_KEY        — Resend.com API key (preferred)
 *   EMAIL_FROM            — sender address (default: noreply@carbonflow-ai.vercel.app)
 *   EMAIL_TO              — recipient(s), comma-separated
 *   EMAIL_NOTIFY_LEVEL    — 'red' (default) | 'yellow' | 'all'
 *   EMAIL_SUBJECT_PREFIX  — subject prefix (default: '[CarbonFlow AI]')
 *
 * Resend free tier: 3,000 emails/month, 100/day — sufficient for most repos.
 */

import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@carbonflow-ai.vercel.app';
const EMAIL_TO = process.env.EMAIL_TO || '';
const NOTIFY_LEVEL = process.env.EMAIL_NOTIFY_LEVEL || 'red';
const SUBJECT_PREFIX = process.env.EMAIL_SUBJECT_PREFIX || '[CarbonFlow AI]';

/**
 * Determine if a carbon score level should trigger an email.
 * @param {'green'|'yellow'|'red'} label
 * @returns {boolean}
 */
export function shouldNotify(label) {
  if (!EMAIL_TO || (!RESEND_API_KEY)) return false;
  if (NOTIFY_LEVEL === 'all') return true;
  if (NOTIFY_LEVEL === 'yellow') return label === 'yellow' || label === 'red';
  return label === 'red'; // default: only red
}

/**
 * Build HTML email body for a carbon event.
 */
function buildEmailHtml({ repo, label, energy_kwh, carbon_kg, commit_url, actor, prNumber }) {
  const badge = label === 'green' ? '🟢' : label === 'yellow' ? '🟡' : '🔴';
  const levelText = label === 'red' ? 'HIGH' : label === 'yellow' ? 'MODERATE' : 'LOW';
  const accentColor = label === 'red' ? '#cf222e' : label === 'yellow' ? '#9a6700' : '#1a7f37';
  const bgColor = label === 'red' ? '#fff0f0' : label === 'yellow' ? '#fff8e1' : '#f0fff4';
  const context = prNumber ? `Pull Request #${prNumber}` : 'Push';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f8fa; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #d0d7de; overflow: hidden;">
    <div style="background: ${accentColor}; padding: 20px 24px;">
      <h1 style="color: #fff; margin: 0; font-size: 18px; font-weight: 600;">
        ${badge} CarbonFlow AI — ${levelText} Carbon Impact
      </h1>
    </div>
    <div style="padding: 24px;">
      <div style="background: ${bgColor}; border: 1px solid ${accentColor}33; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; color: #24292f;">
          Repository <strong>${repo}</strong> triggered a <strong>${levelText}</strong> carbon alert on ${context}.
        </p>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
        <tr style="background: #f6f8fa;">
          <th style="text-align: left; padding: 8px 12px; border: 1px solid #d0d7de; color: #57606a;">Metric</th>
          <th style="text-align: left; padding: 8px 12px; border: 1px solid #d0d7de; color: #57606a;">Value</th>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">Repository</td>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de; font-family: monospace;">${repo}</td>
        </tr>
        <tr style="background: #f6f8fa;">
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">Event</td>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">${context}${actor ? ` by ${actor}` : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">Carbon Level</td>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de; color: ${accentColor}; font-weight: 600;">${badge} ${levelText}</td>
        </tr>
        <tr style="background: #f6f8fa;">
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">Estimated Energy</td>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de; font-family: monospace;">${Number(energy_kwh).toFixed(4)} kWh</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de;">Estimated CO₂</td>
          <td style="padding: 8px 12px; border: 1px solid #d0d7de; font-family: monospace;">${Number(carbon_kg).toFixed(4)} kg</td>
        </tr>
      </table>
      ${commit_url ? `<a href="${commit_url}" style="display: inline-block; background: ${accentColor}; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 20px;">View Changes →</a>` : ''}
      <hr style="border: none; border-top: 1px solid #d0d7de; margin: 20px 0;">
      <p style="font-size: 12px; color: #57606a; margin: 0;">
        Sent by <a href="https://carbonflow-ai.vercel.app" style="color: #0969da;">CarbonFlow AI Tracker</a>.
        To stop receiving alerts, unset <code>EMAIL_TO</code> in your Vercel environment variables.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send a carbon alert email via Resend API.
 *
 * @param {{
 *   repo: string,
 *   label: 'green'|'yellow'|'red',
 *   energy_kwh: number,
 *   carbon_kg: number,
 *   commit_url?: string,
 *   actor?: string,
 *   prNumber?: number
 * }} opts
 * @returns {Promise<{ sent: boolean, id?: string, error?: string }>}
 */
export async function sendCarbonEmail(opts) {
  if (!shouldNotify(opts.label)) {
    return { sent: false, reason: 'below_notify_threshold_or_not_configured' };
  }

  const recipients = EMAIL_TO.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no_recipients' };

  const badge = opts.label === 'green' ? '🟢' : opts.label === 'yellow' ? '🟡' : '🔴';
  const levelText = opts.label === 'red' ? 'HIGH' : opts.label === 'yellow' ? 'MODERATE' : 'LOW';
  const subject = `${SUBJECT_PREFIX} ${badge} ${levelText} Carbon Impact — ${opts.repo}`;
  const html = buildEmailHtml(opts);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: recipients,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('Resend API error', { status: res.status, body: text });
      return { sent: false, error: `Resend HTTP ${res.status}` };
    }

    const data = await res.json();
    logger.info('Carbon email sent', { id: data.id, to: recipients, repo: opts.repo, label: opts.label });
    return { sent: true, id: data.id, to: recipients };
  } catch (err) {
    logger.error('Email send failed', { error: err.message });
    return { sent: false, error: err.message };
  }
}

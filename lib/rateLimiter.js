/**
 * lib/rateLimiter.js
 * In-memory sliding window rate limiter — per repository.
 *
 * Env vars:
 *   RATE_LIMIT_WINDOW_MS   = sliding window in ms   (default: 3600000 = 1 hour)
 *   RATE_LIMIT_MAX_EVENTS  = max events per window  (default: 100)
 *
 * Usage:
 *   import { checkRateLimit, getRateLimitInfo } from '../lib/rateLimiter.js';
 *   const { allowed, remaining, resetAt } = checkRateLimit('owner/repo');
 *   if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded', resetAt });
 *
 * NOTE: State is in-process memory — resets on cold start.
 * For persistent rate limiting across serverless instances, replace
 * the Map with a Redis/Upstash INCR + EXPIRE pattern.
 */

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '3600000', 10);
const MAX_EVENTS = parseInt(process.env.RATE_LIMIT_MAX_EVENTS || '100', 10);

/** @type {Map<string, number[]>} repoKey → sorted array of timestamps */
const store = new Map();

/**
 * Evict timestamps outside the sliding window
 * @param {number[]} timestamps
 * @param {number} now
 * @returns {number[]}
 */
function evict(timestamps, now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i++;
  return timestamps.slice(i);
}

/**
 * Check and record a rate-limit hit for a repository.
 * @param {string} repoKey  e.g. 'owner/repo'
 * @returns {{ allowed: boolean, remaining: number, total: number, resetAt: string, windowMs: number }}
 */
export function checkRateLimit(repoKey) {
  const now = Date.now();
  const existing = evict(store.get(repoKey) ?? [], now);

  if (existing.length >= MAX_EVENTS) {
    const oldestTs = existing[0];
    const resetAt = new Date(oldestTs + WINDOW_MS).toISOString();
    return {
      allowed: false,
      remaining: 0,
      total: existing.length,
      resetAt,
      windowMs: WINDOW_MS,
      maxEvents: MAX_EVENTS,
    };
  }

  existing.push(now);
  store.set(repoKey, existing);

  const resetAt = new Date(existing[0] + WINDOW_MS).toISOString();
  return {
    allowed: true,
    remaining: MAX_EVENTS - existing.length,
    total: existing.length,
    resetAt,
    windowMs: WINDOW_MS,
    maxEvents: MAX_EVENTS,
  };
}

/**
 * Read-only snapshot of rate limit state (no hit recorded).
 * @param {string} repoKey
 */
export function getRateLimitInfo(repoKey) {
  const now = Date.now();
  const existing = evict(store.get(repoKey) ?? [], now);
  store.set(repoKey, existing);
  const resetAt = existing.length > 0
    ? new Date(existing[0] + WINDOW_MS).toISOString()
    : new Date(now + WINDOW_MS).toISOString();
  return {
    repo: repoKey,
    used: existing.length,
    remaining: Math.max(0, MAX_EVENTS - existing.length),
    maxEvents: MAX_EVENTS,
    windowMs: WINDOW_MS,
    resetAt,
  };
}

/**
 * Reset rate limit for a repository (admin use).
 * @param {string} repoKey
 */
export function resetRateLimit(repoKey) {
  store.delete(repoKey);
  return { reset: true, repo: repoKey };
}

/**
 * List all tracked repos and their current state.
 */
export function listRateLimits() {
  const now = Date.now();
  const result = [];
  for (const [key, ts] of store.entries()) {
    const cleaned = evict(ts, now);
    store.set(key, cleaned);
    result.push({
      repo: key,
      used: cleaned.length,
      remaining: Math.max(0, MAX_EVENTS - cleaned.length),
      maxEvents: MAX_EVENTS,
      windowMs: WINDOW_MS,
      resetAt: cleaned.length > 0
        ? new Date(cleaned[0] + WINDOW_MS).toISOString()
        : null,
    });
  }
  return result;
}

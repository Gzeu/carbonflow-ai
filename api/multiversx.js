/**
 * api/multiversx.js — POST /api/multiversx
 * Mint CCR (Carbon Credit) ESDT tokens on MultiversX devnet
 * for verified green commits.
 *
 * Body: { receiver: string, signedTx: object, commitSha?: string, repo?: string }
 * Response: { ok: true, txHash, explorerUrl } | { error: string }
 */

import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { mintCarbonCredit, getCarbonCreditBalance } from '../lib/multiversx.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const MintSchema = z.object({
  receiver: z.string().min(10, 'Invalid MultiversX address'),
  signedTx: z.record(z.unknown()),
  commitSha: z.string().optional(),
  repo: z.string().optional(),
});

const BalanceSchema = z.object({
  address: z.string().min(10),
});

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // GET /api/multiversx?address=erd1... — balance check
  if (req.method === 'GET') {
    const parsed = BalanceSchema.safeParse({ address: req.query.address });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Missing or invalid ?address= param', details: parsed.error.flatten() });
    }
    try {
      const balance = await getCarbonCreditBalance(parsed.data.address);
      return res.status(200).json({ ok: true, ...balance });
    } catch (err) {
      logger.error('MultiversX balance check failed', { error: err.message });
      return res.status(502).json({ error: 'Failed to fetch balance', detail: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['GET', 'POST'] });
  }

  // Validate API key (simple bearer token from env)
  const apiKey = process.env.CARBONFLOW_API_KEY;
  if (apiKey) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized — invalid API key' });
    }
  }

  const parsed = MintSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const { receiver, signedTx, commitSha, repo } = parsed.data;

  if (!process.env.MULTIVERSX_TOKEN_ID) {
    return res.status(503).json({
      error: 'MultiversX integration not configured',
      hint: 'Set MULTIVERSX_TOKEN_ID, MULTIVERSX_API_URL env vars',
    });
  }

  try {
    const result = await mintCarbonCredit({ receiver, signedTx });
    logger.info('CCR minted', { receiver, txHash: result.txHash, commitSha, repo });
    return res.status(200).json({
      ok: true,
      ...result,
      commitSha: commitSha ?? null,
      repo: repo ?? null,
      mintedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('CCR mint failed', { error: err.message, receiver });
    return res.status(502).json({ error: 'Mint failed', detail: err.message });
  }
}

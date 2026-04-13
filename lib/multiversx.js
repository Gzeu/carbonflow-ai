/**
 * lib/multiversx.js
 * MultiversX devnet integration — mint ESDT CCR (Carbon Credit) tokens
 * for green commits. Uses the MultiversX REST API (no SDK to keep bundle small).
 *
 * Env vars required:
 *   MULTIVERSX_API_URL     = https://devnet-api.multiversx.com  (default)
 *   MULTIVERSX_SIGNER_PEM  = PEM wallet content (base64-encoded in env)
 *   MULTIVERSX_TOKEN_ID    = e.g. CCR-a1b2c3
 *   MULTIVERSX_MINT_AMOUNT = amount in smallest denomination (default: 1000000000000000000 = 1 CCR)
 */

import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const MX_API = process.env.MULTIVERSX_API_URL || 'https://devnet-api.multiversx.com';
const TOKEN_ID = process.env.MULTIVERSX_TOKEN_ID || '';
const MINT_AMOUNT = process.env.MULTIVERSX_MINT_AMOUNT || '1000000000000000000';

/** Decode PEM-encoded wallet address from env */
function getSignerAddress() {
  const raw = process.env.MULTIVERSX_SIGNER_ADDRESS || '';
  return raw.trim();
}

/**
 * Fetch current nonce for an address
 * @param {string} address erd1...
 * @returns {Promise<number>}
 */
export async function getNonce(address) {
  const res = await fetch(`${MX_API}/accounts/${address}`);
  if (!res.ok) throw new Error(`getNonce HTTP ${res.status}`);
  const data = await res.json();
  return data.nonce ?? 0;
}

/**
 * Build a base64-encoded ESDTLocalMint transaction data field
 * ESDTLocalMint@<tokenId hex>@<amount hex>
 */
function buildMintData(tokenId, amount) {
  const tokenHex = Buffer.from(tokenId).toString('hex');
  const amountHex = BigInt(amount).toString(16).padStart(2, '0');
  return Buffer.from(`ESDTLocalMint@${tokenHex}@${amountHex}`).toString('base64');
}

/**
 * Broadcast a pre-signed transaction object to the MultiversX API.
 * NOTE: Real signing requires @multiversx/sdk-core + UserSigner.
 * This function handles the broadcast step; signing must happen
 * server-side with the PEM key via sdk-core (not included here to
 * keep Vercel bundle under 50 MB).
 *
 * @param {object} signedTx  - fully signed transaction object
 * @returns {Promise<{txHash: string}>}
 */
export async function broadcastTransaction(signedTx) {
  const res = await fetch(`${MX_API}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedTx),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`broadcastTransaction HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  return { txHash: data.txHash };
}

/**
 * High-level helper: construct and broadcast an ESDTLocalMint tx.
 * Requires MULTIVERSX_SIGNER_ADDRESS + a pre-built signed tx payload.
 *
 * For use from api/multiversx.js which receives a pre-signed tx body
 * from the client (e.g. a dApp wallet or a backend signer service).
 *
 * @param {{ receiver: string, signedTx: object }} opts
 */
export async function mintCarbonCredit({ receiver, signedTx }) {
  if (!TOKEN_ID) throw new Error('MULTIVERSX_TOKEN_ID env var not set');

  logger.info('MultiversX: minting CCR token', { receiver, tokenId: TOKEN_ID, amount: MINT_AMOUNT });

  const { txHash } = await broadcastTransaction(signedTx);

  logger.info('MultiversX: CCR mint broadcasted', { txHash, receiver });

  return {
    txHash,
    tokenId: TOKEN_ID,
    amount: MINT_AMOUNT,
    receiver,
    explorerUrl: `https://devnet-explorer.multiversx.com/transactions/${txHash}`,
  };
}

/**
 * Fetch CCR balance for an address
 * @param {string} address erd1...
 * @returns {Promise<{ balance: string, tokenId: string }>}
 */
export async function getCarbonCreditBalance(address) {
  if (!TOKEN_ID) return { balance: '0', tokenId: '' };
  const res = await fetch(`${MX_API}/accounts/${address}/tokens/${TOKEN_ID}`);
  if (res.status === 404) return { balance: '0', tokenId: TOKEN_ID };
  if (!res.ok) throw new Error(`getCarbonCreditBalance HTTP ${res.status}`);
  const data = await res.json();
  return {
    balance: data.balance ?? '0',
    tokenId: TOKEN_ID,
    decimals: data.decimals ?? 18,
    name: data.name ?? 'Carbon Credit',
    explorerUrl: `https://devnet-explorer.multiversx.com/accounts/${address}/tokens`,
  };
}

/**
 * Get recent CCR transactions for an address
 * @param {string} address erd1...
 * @param {number} size
 */
export async function getCarbonCreditTransactions(address, size = 10) {
  if (!TOKEN_ID) return [];
  const res = await fetch(
    `${MX_API}/accounts/${address}/transfers?token=${TOKEN_ID}&size=${size}`
  );
  if (!res.ok) return [];
  return res.json();
}

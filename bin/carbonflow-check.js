#!/usr/bin/env node
// npx carbonflow-check — local carbon audit for a Git repo
// Usage:
//   npx carbonflow-check                     # audit current directory (last commit)
//   npx carbonflow-check --repo ./my-project # specify path
//   npx carbonflow-check --sha abc123        # audit specific commit
//   npx carbonflow-check --json              # machine-readable output

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { parseArgs } from 'util';

// ── ANSI colours ─────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};
const paint = (color, text) => `${color}${text}${c.reset}`;

// ── Args ──────────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    repo:   { type: 'string',  short: 'r', default: '.' },
    sha:    { type: 'string',  short: 's', default: '' },
    json:   { type: 'boolean', short: 'j', default: false },
    remote: { type: 'string',  default: '' },  // e.g. https://carbonflow-ai.vercel.app
    help:   { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help) {
  console.log(`
${paint(c.bold + c.cyan, 'carbonflow-check')} — Local carbon audit tool

${paint(c.bold, 'Usage:')}
  npx carbonflow-check [options]

${paint(c.bold, 'Options:')}
  -r, --repo <path>    Path to git repo (default: current directory)
  -s, --sha  <sha>     Commit SHA to audit (default: HEAD)
  -j, --json           Output JSON (machine-readable)
  --remote <url>       Use remote /api/carbon instead of local scoring
  -h, --help           Show this help

${paint(c.bold, 'Examples:')}
  npx carbonflow-check
  npx carbonflow-check --repo ./my-app --json
  npx carbonflow-check --sha a1b2c3d
  npx carbonflow-check --remote https://carbonflow-ai.vercel.app
`);
  process.exit(0);
}

// ── Git helpers ───────────────────────────────────────────────────────────────
function git(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getDiff(repoPath, sha) {
  const ref = sha || 'HEAD';
  const diffStat = git(`git diff ${ref}~1 ${ref} --numstat`, repoPath);
  let additions = 0, deletions = 0, files = 0;
  for (const line of diffStat.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      additions += parseInt(parts[0]) || 0;
      deletions += parseInt(parts[1]) || 0;
      files++;
    }
  }
  const subject = git(`git log -1 --pretty=format:"%s" ${ref}`, repoPath);
  const author  = git(`git log -1 --pretty=format:"%an" ${ref}`, repoPath);
  const commitSha = git(`git rev-parse --short ${ref}`, repoPath);
  return { additions, deletions, files, subject, author, commitSha };
}

function getCiDuration(repoPath) {
  // Heuristic: estimate CI from workflow files
  const workflowDir = join(repoPath, '.github', 'workflows');
  if (!existsSync(workflowDir)) return 0;
  try {
    const files = execSync(`ls ${workflowDir}`, { encoding: 'utf8' }).trim().split('\n');
    return files.length * 2.5; // rough estimate: 2.5min per workflow
  } catch { return 0; }
}

// ── Carbon scoring (mirrors api/carbon.js logic) ───────────────────────────────
const CARBON_INTENSITY_KG_PER_KWH = 0.233;

function calculateScore({ additions, deletions, files, ci_duration_min }) {
  const netLines     = additions + deletions * 0.5;
  const codeEnergy   = netLines * 0.000015;        // kWh per line-change
  const fileEnergy   = files    * 0.000050;        // kWh per file
  const ciEnergy     = (ci_duration_min || 0) * 0.0025; // kWh per CI minute
  const energy_kwh   = +(codeEnergy + fileEnergy + ciEnergy).toFixed(6);
  const carbon_kg    = +(energy_kwh * CARBON_INTENSITY_KG_PER_KWH).toFixed(6);

  const yellow = parseFloat(process.env.CARBON_THRESHOLD_YELLOW || '0.5');
  const red    = parseFloat(process.env.CARBON_THRESHOLD_RED    || '1.0');
  const label  = energy_kwh < yellow ? 'green' : energy_kwh < red ? 'yellow' : 'red';

  const recommendations = [];
  if (additions > 500) recommendations.push('Large diff detected — consider splitting into smaller commits');
  if (ci_duration_min > 10) recommendations.push('Long CI detected — use job caching or parallelization');
  if (files > 30) recommendations.push('Many files changed — review if all changes are necessary');
  if (label === 'green') recommendations.push('✅ Green commit — eligible for on-chain carbon credit (CCR)');
  if (label === 'red') recommendations.push('⚠️  Consider refactoring to reduce energy footprint');

  return { energy_kwh, carbon_kg, label, recommendations,
           breakdown: { code: +codeEnergy.toFixed(6), files: +fileEnergy.toFixed(6), ci: +ciEnergy.toFixed(6) } };
}

async function scoreRemote(url, payload) {
  const res = await fetch(`${url}/api/carbon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Remote API returned ${res.status}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const repoPath = resolve(args.repo);

  // Verify it's a git repo
  const gitDir = git('git rev-parse --git-dir', repoPath);
  if (!gitDir) {
    console.error(paint(c.red, `✗ Not a git repository: ${repoPath}`));
    process.exit(1);
  }

  const diff = getDiff(repoPath, args.sha);
  const ci   = getCiDuration(repoPath);
  const payload = { additions: diff.additions, deletions: diff.deletions, files_changed: diff.files, workflow_duration_minutes: ci };

  let result;
  if (args.remote) {
    try {
      result = await scoreRemote(args.remote, payload);
    } catch (err) {
      if (!args.json) console.warn(paint(c.yellow, `⚠ Remote scoring failed (${err.message}), using local scorer`));
      result = calculateScore({ ...payload, ci_duration_min: ci });
    }
  } else {
    result = calculateScore({ additions: diff.additions, deletions: diff.deletions, files: diff.files, ci_duration_min: ci });
  }

  if (args.json) {
    console.log(JSON.stringify({ commit: diff, payload, result }, null, 2));
    process.exit(result.label === 'red' ? 1 : 0);
  }

  // ── Pretty output ──────────────────────────────────────────────────────────
  const labelColor = result.label === 'green' ? c.green : result.label === 'yellow' ? c.yellow : c.red;
  const labelIcon  = result.label === 'green' ? '●' : result.label === 'yellow' ? '◐' : '●';

  console.log('');
  console.log(paint(c.bold + c.cyan, '  ⬡ CarbonFlow Carbon Audit'));
  console.log(paint(c.gray, '  ────────────────────────────────────────'));
  console.log(`  ${paint(c.dim, 'Repo')}     ${paint(c.white, repoPath)}`);
  console.log(`  ${paint(c.dim, 'Commit')}   ${paint(c.white, diff.commitSha)}  ${paint(c.gray, diff.subject.slice(0, 55))}`);
  console.log(`  ${paint(c.dim, 'Author')}   ${paint(c.white, diff.author)}`);
  console.log(paint(c.gray, '  ────────────────────────────────────────'));
  console.log(`  ${paint(c.dim, 'Diff')}     ${paint(c.green, '+' + diff.additions)} ${paint(c.red, '-' + diff.deletions)}  ${paint(c.gray, diff.files + ' files')}`);
  console.log(`  ${paint(c.dim, 'CI Est')}   ${paint(c.white, ci.toFixed(1) + ' min')}`);
  console.log(paint(c.gray, '  ────────────────────────────────────────'));
  console.log(`  ${paint(c.dim, 'Energy')}   ${paint(c.bold, result.energy_kwh.toFixed(6) + ' kWh')}`);
  console.log(`  ${paint(c.dim, 'Carbon')}   ${paint(c.bold, result.carbon_kg.toFixed(6) + ' kg CO₂')}`);
  console.log(`  ${paint(c.dim, 'Score')}    ${paint(c.bold + labelColor, labelIcon + ' ' + result.label.toUpperCase())}`);
  console.log('');

  if (result.recommendations?.length) {
    console.log(paint(c.bold, '  Recommendations:'));
    for (const rec of result.recommendations) {
      console.log(`  ${paint(c.gray, '→')} ${rec}`);
    }
    console.log('');
  }

  if (result.breakdown) {
    console.log(paint(c.dim, '  Breakdown:'));
    console.log(paint(c.gray, `    Code changes : ${result.breakdown.code.toFixed(6)} kWh`));
    console.log(paint(c.gray, `    File overhead: ${result.breakdown.files?.toFixed(6)} kWh`));
    console.log(paint(c.gray, `    CI/CD        : ${result.breakdown.ci.toFixed(6)} kWh`));
    console.log('');
  }

  console.log(paint(c.gray, `  Powered by CarbonFlow AI · https://carbonflow-ai.vercel.app`));
  console.log('');

  // Exit code: 1 if red (useful for CI pre-commit hooks)
  process.exit(result.label === 'red' ? 1 : 0);
}

main().catch(err => {
  console.error(paint(c.red, `✗ ${err.message}`));
  process.exit(1);
});

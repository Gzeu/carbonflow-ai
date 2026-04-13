# 🌱 CarbonFlow AI — Carbon Intelligence Platform

> Real-time carbon footprint scoring for GitHub repositories. Track, analyze, and reduce the environmental impact of your code — powered by AI, persisted in Supabase, deployed on Vercel.

[![Live Demo](https://img.shields.io/badge/Live-carbonflow--ai.vercel.app-brightgreen)](https://carbonflow-ai.vercel.app)
[![GitHub App](https://img.shields.io/badge/GitHub_App-Install-blue)](https://github.com/apps/carbonflow-ai-tracker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black)](https://vercel.com)

---

## 🚀 What's New (April 2026)

- ✅ **Live dashboard** at [carbonflow-ai.vercel.app](https://carbonflow-ai.vercel.app) — 4 tabs, Chart.js graphs, real-time KPIs
- ✅ **Supabase persistence** — all carbon events stored in PostgreSQL (Frankfurt region)
- ✅ **CLI tool** — `npx carbonflow-check` for local audits with exit code 1 on RED
- ✅ **Slack notifications** — Block Kit alerts on yellow/red thresholds
- ✅ **Email notifications** — via Resend API (free tier: 3000/month)
- ✅ **Rate limiting** — sliding window per repository (configurable)
- ✅ **OAuth onboarding** — `/api/install` + `/api/oauth/callback`
- ✅ **MultiversX ESDT** — CCR carbon credit token on devnet
- ✅ **Solidity contracts** — `CarbonCredit.sol` (ERC-20) + `CarbonRegistry.sol`

---

## ✨ Features

### 🔗 GitHub App Webhook Handler
- Processes `push`, `pull_request`, `issues`, `workflow_run`, `release` events
- HMAC SHA-256 signature verification on every request
- GitHub App JWT auth (RS256) with per-installation token
- Auto-comments carbon analysis on Pull Requests
- Auto-labels: `carbon-green` / `carbon-yellow` / `carbon-red` + `sustainability-check`
- Stale label cleanup on PR synchronize
- Draft PR skip

### 📊 Carbon Scoring Engine
| Tier | Threshold | Label |
|------|-----------|-------|
| 🟢 Green | < 0.5 kWh | `carbon-green` |
| 🟡 Yellow | 0.5 – 1.0 kWh | `carbon-yellow` |
| 🔴 Red | > 1.0 kWh | `carbon-red` |

Scoring formula:
- **Code energy**: `additions × 1.2µkWh + deletions × 0.08µkWh`
- **CI energy**: `workflow_duration_min × 0.075 Wh`
- **CO₂**: `energy_kWh × 0.233 kg/kWh`

### 🖥️ Analytics Dashboard
- **6 KPI cards**: Total Analyses, Green/Yellow/Red commits, Avg Energy, Total CO₂
- **Carbon Score History** — Chart.js line chart, color per tier
- **Score Distribution** — Doughnut chart
- **Repository Leaderboard** — sorted by total kWh
- **Recent Webhook Events** — live feed
- **System Health panel** — env var status per key
- Dark/light mode toggle, responsive 375px+

### 🗄️ REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Readiness probe — 200/503 |
| `POST` | `/api/carbon` | Standalone carbon scorer |
| `GET` | `/api/dashboard` | Aggregated stats + events + repos |
| `GET` | `/api/scores` | Paginated event history |
| `GET` | `/api/repos` | Repository leaderboard |
| `POST` | `/api/webhooks` | GitHub App webhook entry point |
| `GET` | `/api/install` | Redirect to GitHub App install |
| `GET` | `/api/oauth/callback` | OAuth callback after install |
| `GET\|POST` | `/api/multiversx` | MultiversX ESDT CCR token |
| `GET\|DELETE` | `/api/ratelimit` | Rate limit status per repo |
| `POST` | `/api/notify` | Manual Slack notification trigger |

---

## 🛠️ Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ · ESModules (`"type": "module"`) |
| Deploy | Vercel Serverless Functions |
| Database | Supabase PostgreSQL (Frankfurt `fra1`) |
| Auth | GitHub App JWT RS256 |
| Validation | Zod |
| Logging | Winston (JSON, no console.log in prod) |
| Security | HMAC webhook verification · Helmet · Rate limiting |
| Blockchain | ethers v6 · web3 v4 · MultiversX devnet |
| ML | TensorFlow.js Node (`ai-engine/`) |
| Notifications | Slack Block Kit · Resend Email |
| CLI | `npx carbonflow-check` |

---

## ⚡ Quick Start

### Install GitHub App

1. Visit [github.com/apps/carbonflow-ai-tracker](https://github.com/apps/carbonflow-ai-tracker)
2. Click **Install** on your repositories
3. Grant permissions — webhooks fire automatically on every push & PR

### Use the CLI locally

```bash
# One-shot audit of current commit
npx carbonflow-check

# Audit specific commit
npx carbonflow-check --sha a1b2c3d

# JSON output (for CI pipelines)
npx carbonflow-check --json

# Use as pre-commit hook (.git/hooks/pre-commit)
#!/bin/sh
npx carbonflow-check --json | jq -e '.result.label != "red"'
```

### Test the API

```bash
# Health check
curl https://carbonflow-ai.vercel.app/api/health

# Carbon score a diff
curl -X POST https://carbonflow-ai.vercel.app/api/carbon \
  -H "Content-Type: application/json" \
  -d '{"additions": 300, "deletions": 50, "workflow_duration_minutes": 5}'

# Dashboard stats
curl https://carbonflow-ai.vercel.app/api/dashboard?days=30

# Rate limit status
curl https://carbonflow-ai.vercel.app/api/ratelimit?repo=owner/my-repo
```

### Self-host / develop locally

```bash
git clone https://github.com/Gzeu/carbonflow-ai.git
cd carbonflow-ai
npm install
cp .env.example .env   # fill in your secrets
npx vercel dev --listen 3000
```

---

## 🔧 Environment Variables

```env
# GitHub App (required)
GITHUB_APP_ID=1989339
WEBHOOK_SECRET=your_webhook_secret
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# Carbon thresholds (optional, defaults shown)
CARBON_THRESHOLD_YELLOW=0.5
CARBON_THRESHOLD_RED=1.0

# Supabase (auto-injected by Vercel Native Integration)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Notifications (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
RESEND_API_KEY=re_...
EMAIL_TO=you@domain.com
EMAIL_NOTIFY_LEVEL=red   # red | yellow | all

# MultiversX devnet (optional)
MULTIVERSX_TOKEN_ID=CCR-a1b2c3
MULTIVERSX_SIGNER_ADDRESS=erd1...

# Rate limiting (optional)
RATE_LIMIT_MAX_EVENTS=100
RATE_LIMIT_WINDOW_MS=3600000
```

---

## 🗃️ Database Schema (Supabase)

```sql
-- Auto-provisioned via Vercel Native Integration
CREATE TABLE carbon_events (
  id               BIGSERIAL PRIMARY KEY,
  repo_full_name   TEXT        NOT NULL,
  sha              TEXT,
  event_type       TEXT        NOT NULL DEFAULT 'push',
  label            TEXT        NOT NULL CHECK (label IN ('green','yellow','red')),
  energy_kwh       NUMERIC(12,6),
  carbon_kg        NUMERIC(12,6),
  additions        INTEGER,
  deletions        INTEGER,
  ci_duration_min  NUMERIC(8,2),
  recommendations  TEXT[],
  actor            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE installations (
  installation_id  BIGINT PRIMARY KEY,
  account_login    TEXT,
  account_type     TEXT,
  installed_at     TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 📦 Project Structure

```
carbonflow-ai/
├── api/                    # Vercel Serverless Functions
│   ├── webhooks.js         # GitHub App entry point (maxDuration: 30s)
│   ├── health.js           # Readiness probe
│   ├── carbon.js           # Standalone carbon scorer
│   ├── dashboard.js        # Aggregated analytics
│   ├── scores.js           # Paginated event history
│   ├── repos.js            # Repo leaderboard
│   ├── install.js          # GitHub App install redirect
│   ├── oauth.js            # OAuth callback
│   ├── notify.js           # Slack notification trigger
│   ├── multiversx.js       # ESDT CCR token endpoint
│   └── ratelimit.js        # Rate limit management
├── lib/                    # Shared modules
│   ├── db.js               # Supabase client + queries
│   ├── db-schema.sql       # PostgreSQL migration
│   ├── carbonStore.js      # persistEvent / getRepoHistory
│   ├── notifier.js         # Slack Block Kit helper
│   ├── emailNotifier.js    # Resend email helper
│   ├── multiversx.js       # MultiversX devnet client
│   └── rateLimiter.js      # Sliding window per repo
├── bin/
│   └── carbonflow-check.js # CLI tool (npx carbonflow-check)
├── contracts/
│   ├── CarbonCredit.sol    # ERC-20 CCR token (Solidity)
│   └── CarbonRegistry.sol  # On-chain score registry
├── ai-engine/              # ML models (local/Docker only)
├── index.html              # Dashboard UI
├── vercel.json             # Serverless config + routes
└── docker-compose.yml      # Local development
```

---

## 🌐 Supported Webhook Events

| Event | Action | What happens |
|-------|--------|--------------|
| `push` | any | Score commits, post comment, label repo |
| `pull_request` | opened/synchronize/reopened | Score diff, post PR comment, add label |
| `pull_request` | draft | Skipped |
| `issues` | opened | Logged |
| `workflow_run` | completed | Score CI duration energy |
| `release` | published | Logged |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Follow the rules: ES Modules only, Zod validation, Winston logging, no `console.log`
4. Commit: `git commit -m 'feat: add my feature'`
5. Push: `git push origin feature/my-feature`
6. Open a Pull Request — CarbonFlow AI will auto-score your diff

---

## 🔗 Resources

- [Live Dashboard](https://carbonflow-ai.vercel.app)
- [GitHub App — Install](https://github.com/apps/carbonflow-ai-tracker)
- [API Reference](./API_REFERENCE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Green Software Foundation](https://www.green-software.foundation/)
- [Sustainable Software Principles](https://principles.green/)

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

**George Pricop** · [@Gzeu](https://github.com/Gzeu) · Blockchain Developer & AI Automation Specialist

⭐ **Star this repo to support sustainable software development!**

**Made with 🌱 for a greener future**

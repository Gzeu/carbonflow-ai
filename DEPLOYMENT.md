# 🚀 CarbonFlow AI - Complete Deployment Guide

## 📋 Prerequisites

### 🛠️ Required Tools
- **Node.js** 18+ with npm
- **Git** for version control
- **Vercel CLI** for deployment
- **GitHub account** with developer access

### 🔧 Environment Setup
```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Clone the repository
git clone https://github.com/Gzeu/carbonflow-ai.git
cd carbonflow-ai

# Install dependencies
npm install
```

## 🚀 GitHub App Configuration

### 1. Create GitHub App
1. Go to **GitHub Settings** → **Developer settings** → **GitHub Apps**
2. Click **"New GitHub App"**
3. Fill in the details:
   - **App Name**: `CarbonFlow AI Tracker`
   - **Homepage URL**: `https://your-domain.vercel.app`
   - **Webhook URL**: `https://your-domain.vercel.app/api/webhooks`
   - **Webhook Secret**: Generate a secure secret (save it)

### 2. Set Permissions
```
Repository permissions:
- Contents: Read
- Issues: Write
- Pull requests: Write
- Metadata: Read

Subscribe to events:
- Push
- Pull request
- Issues
- Workflow run
```

### 3. Install App
1. After creating, install the app on your repositories
2. Note down the **App ID** from the settings
3. Generate and download the **Private Key** (.pem file)

## ⚙️ Environment Variables Setup

### Vercel Environment Variables
In your Vercel dashboard, add these environment variables:

```bash
# GitHub App Configuration
GITHUB_APP_ID=1989339
WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
Your complete private key content here...
-----END RSA PRIVATE KEY-----"

# Optional: Custom thresholds
CARBON_THRESHOLD_YELLOW=0.5
CARBON_THRESHOLD_RED=1.0
```

## 🚀 Deployment Steps

### 1. Deploy to Vercel
```bash
# First deployment
vercel --prod

# Or using npm script
npm run deploy

# Set environment variables
vercel env add GITHUB_APP_ID
vercel env add WEBHOOK_SECRET
vercel env add GITHUB_PRIVATE_KEY
```

### 2. Update GitHub App Webhook URL
1. Go to your GitHub App settings
2. Update **Webhook URL** to your Vercel deployment URL:
   ```
   https://your-app-name.vercel.app/api/webhooks
   ```
3. Save the settings

### 3. Test the Integration
```bash
# Test webhook endpoint
curl https://your-app-name.vercel.app/health

# Should return:
{
  "status": "healthy",
  "service": "CarbonFlow AI Webhook",
  "timestamp": "2025-09-23T..."
}
```

## 🧪 Testing & Validation

### 1. Webhook Testing
1. Make a commit to a repository where the app is installed
2. Check Vercel function logs for webhook activity
3. Verify that carbon analysis runs successfully

### 2. Pull Request Testing
1. Create a pull request
2. Check for automated comments with carbon impact analysis
3. Verify labels are applied correctly

## 📊 Monitoring & Analytics

### Vercel Function Logs
- Check **Vercel Dashboard** → **Functions** for execution logs
- Monitor response times and error rates
- Review webhook payload processing

### GitHub App Analytics
- Monitor installation count
- Track webhook delivery success rate
- Review API rate limit usage

## 🛡️ Security Best Practices

1. **Environment Variables**: Never commit secrets to git
2. **Webhook Signature**: Always verify GitHub signatures
3. **Rate Limiting**: Implement proper rate limiting
4. **Input Validation**: Validate all webhook payloads
5. **HTTPS Only**: Ensure all communication is encrypted

---

**🎆 Your CarbonFlow AI GitHub App is now ready for production! 🌱**
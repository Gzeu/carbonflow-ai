# 🌱 CarbonFlow AI - IBM Cloud Functions Deployment

## 🚀 Quick Start Deployment

```bash
cd deployment/ibm-cloud
chmod +x deploy.sh
./deploy.sh
```

## 📋 Prerequisites

### 1. IBM Cloud CLI Installation
```bash
# macOS
brew install ibmcloud-cli

# Linux/Windows
curl -fsSL https://clis.cloud.ibm.com/install/linux | sh
```

### 2. IBM Cloud Account Setup
1. Create free IBM Cloud account: https://cloud.ibm.com/registration
2. Login to CLI: `ibmcloud login`
3. Target resource group: `ibmcloud target -g default`

### 3. Watson NLU Service Setup
1. Create Watson NLU Lite service (FREE)
2. Get API credentials from service dashboard
3. Export environment variables:

```bash
export WATSON_NLU_APIKEY="your-watson-nlu-api-key"
export WATSON_NLU_URL="your-watson-nlu-service-url"
```

## 🛠 Manual Deployment Steps

If you prefer manual deployment:

### Step 1: Setup Cloud Functions
```bash
# Install Cloud Functions plugin
ibmcloud plugin install cloud-functions

# Create namespace
ibmcloud fn namespace create carbonflow-ns
ibmcloud fn property set --namespace carbonflow-ns
```

### Step 2: Deploy Function
```bash
# Create deployment package
zip -r carbonflow-ai.zip handler.py requirements.txt

# Deploy function
ibmcloud fn action create carbonflow-ai carbonflow-ai.zip \
    --kind python:3.9 \
    --memory 512 \
    --timeout 60000 \
    --param WATSON_NLU_APIKEY "$WATSON_NLU_APIKEY" \
    --param WATSON_NLU_URL "$WATSON_NLU_URL" \
    --web true
```

### Step 3: Setup API Gateway
```bash
# Create API endpoints
ibmcloud fn api create /carbonflow /health get carbonflow-ai --response-type json
ibmcloud fn api create /carbonflow /analyze post carbonflow-ai --response-type json
```

## 🧪 Testing Your Deployment

### Health Check
```bash
curl https://your-api-url/carbonflow/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-27T13:25:00Z",
  "service": "carbonflow-ai",
  "version": "1.0.0"
}
```

### Carbon Analysis
```bash
curl -X POST https://your-api-url/carbonflow/analyze \
  -H "Content-Type: application/json" \
  -d '{"text":"Solar energy reduces carbon emissions significantly"}'
```

Expected response:
```json
{
  "timestamp": "2025-09-27T13:25:00Z",
  "carbon_score": 87.5,
  "grade": "A",
  "sentiment": {
    "document": {
      "score": 0.75,
      "label": "positive"
    }
  },
  "keywords": [
    {"text": "solar energy", "relevance": 0.95},
    {"text": "carbon emissions", "relevance": 0.89}
  ],
  "recommendations": [
    "Consider renewable energy credits",
    "Explore carbon offset programs"
  ]
}
```

## 📊 Service Limits (Lite Plan)

| Service | Monthly Limit | Notes |
| --- | --- | --- |
| **Cloud Functions** | 5M invocations | 512MB memory, 60s timeout |
| **Watson NLU** | 30K characters | Text analysis limit |
| **API Gateway** | Unlimited | Free tier included |

## 🔧 Configuration Options

### Environment Variables
- `WATSON_NLU_APIKEY`: Watson NLU API key
- `WATSON_NLU_URL`: Watson NLU service URL
- `CLOUDANT_URL`: (Optional) Database connection

### Function Parameters
- **Memory**: 512MB (optimized for Lite plan)
- **Timeout**: 60 seconds
- **Runtime**: Python 3.9

## 📈 Monitoring & Logs

### View Function Logs
```bash
# Latest logs
ibmcloud fn activation logs --last

# Specific activation
ibmcloud fn activation logs ACTIVATION_ID

# Real-time monitoring
ibmcloud fn activation poll
```

### Function Metrics
```bash
# List recent activations
ibmcloud fn activation list

# Function details
ibmcloud fn action get carbonflow-ai
```

## 🔄 Updates & Maintenance

### Update Function Code
```bash
# After code changes
zip -r carbonflow-ai.zip handler.py requirements.txt
ibmcloud fn action update carbonflow-ai carbonflow-ai.zip
```

### Update Environment Variables
```bash
ibmcloud fn action update carbonflow-ai \
    --param WATSON_NLU_APIKEY "new-api-key"
```

## 🚨 Troubleshooting

### Common Issues

1. **Authentication Error**
   ```bash
   # Re-login to IBM Cloud
   ibmcloud login --sso
   ```

2. **Watson NLU Quota Exceeded**
   - Check usage: https://cloud.ibm.com/resources
   - Implement response caching

3. **Function Timeout**
   - Increase timeout: `--timeout 120000`
   - Optimize code performance

4. **Memory Limit Exceeded**
   - Increase memory: `--memory 1024`
   - Optimize dependencies

### Debug Mode
```bash
# Enable debug logging
export IBMCLOUD_TRACE=true
./deploy.sh
```

## 🎯 Production Checklist

- [ ] Watson NLU service configured
- [ ] Environment variables set
- [ ] Function deployed successfully
- [ ] API endpoints responding
- [ ] Health check passing
- [ ] Error handling tested
- [ ] Monitoring configured
- [ ] Usage limits monitored

## 🔗 Related Resources

- [IBM Cloud Functions Documentation](https://cloud.ibm.com/docs/openwhisk)
- [Watson NLU API Reference](https://cloud.ibm.com/apidocs/natural-language-understanding)
- [GitHub Repository](https://github.com/Gzeu/carbonflow-ai)
- [Linear Issue GPZ-74](https://linear.app/gpz/issue/GPZ-74)

---

**Status**: ✅ Production Ready  
**Last Updated**: September 27, 2025  
**Maintainer**: [@Gzeu](https://github.com/Gzeu)
# 📚 CarbonFlow AI - API Reference

## 🔗 Base URL
```
https://your-app.vercel.app
```

## 🔎 Endpoints

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "CarbonFlow AI Webhook",
  "timestamp": "2025-09-23T20:36:00.000Z"
}
```

### Webhook Handler
```http
POST /api/webhooks
Content-Type: application/json
X-GitHub-Event: push|pull_request|workflow_run
X-Hub-Signature-256: sha256=...
X-GitHub-Delivery: 12345678-1234-1234-1234-123456789012
```

## 📄 Webhook Events

### Push Event Analysis
```json
{
  "event": "push",
  "analysis": {
    "energyConsumption": 0.0234,
    "carbonEmission": 0.0094,
    "carbonScore": "green",
    "totalLines": 156,
    "recommendations": [
      "🟢 Low carbon impact - Great work!",
      "♻️ Keep following sustainable coding practices"
    ]
  }
}
```

### Pull Request Analysis
```json
{
  "event": "pull_request",
  "action": "comment_and_label",
  "comment": "🟢 Low Carbon Impact - Sustainable code changes!",
  "labels": ["carbon-green", "sustainability-check"],
  "analysis": {
    "changes": "+45/-12 lines",
    "estimatedEnergy": "0.057 kWh"
  }
}
```

### Workflow Run Monitoring
```json
{
  "event": "workflow_run",
  "action": "log_workflow",
  "workflow": "CI/CD Pipeline",
  "duration": 12,
  "energy": 0.12,
  "carbon": 0.048
}
```

## 📏 Response Codes

| Code | Status | Description |
|------|--------|--------------|
| 200 | OK | Webhook processed successfully |
| 401 | Unauthorized | Invalid signature |
| 405 | Method Not Allowed | Non-POST request |
| 500 | Internal Server Error | Processing error |

## 🔍 Carbon Impact Levels

| Level | Threshold | Color | Action |
|-------|-----------|-------|--------|
| Green | < 0.5 kWh | 🟢 | Positive feedback |
| Yellow | 0.5-1.0 kWh | 🟡 | Monitoring advice |
| Red | > 1.0 kWh | 🔴 | Create issue, optimization needed |

## 🔧 Configuration

### Environment Variables
```bash
GITHUB_APP_ID=1989339
WEBHOOK_SECRET=your_secure_secret
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
CARBON_THRESHOLD_YELLOW=0.5
CARBON_THRESHOLD_RED=1.0
```

### Custom Thresholds
```javascript
// Modify in api/webhooks.js
const THRESHOLDS = {
  YELLOW: parseFloat(process.env.CARBON_THRESHOLD_YELLOW) || 0.5,
  RED: parseFloat(process.env.CARBON_THRESHOLD_RED) || 1.0
};
```

## 🔒 Security

### Webhook Signature Verification
```javascript
// Automatic verification using crypto.timingSafeEqual
function verifySignature(signature, secret, body) {
  const expectedSignature = 'sha256=' + 
    crypto.createHmac('sha256', secret)
          .update(body)
          .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}
```

## 🔍 Rate Limits

- **GitHub API**: 5,000 requests/hour
- **Webhook Delivery**: No limit from GitHub
- **Vercel Functions**: 100GB-hours/month (Hobby plan)

## 🎯 Error Handling

### Common Errors
```json
{
  "error": "Invalid signature",
  "message": "Webhook signature verification failed"
}
```

```json
{
  "error": "Internal server error",
  "message": "Failed to process webhook payload"
}
```

---

**📚 Complete API documentation for CarbonFlow AI webhook integration! 🌱**
const crypto = require('crypto');

/**
 * Verify GitHub webhook signature
 * @param {string} signature - GitHub signature header
 * @param {string} secret - Webhook secret
 * @param {Buffer} body - Raw request body
 * @returns {boolean} Whether signature is valid
 */
function verifySignature(signature, secret, body) {
  if (!signature || !secret) {
    console.warn('⚠️  Missing signature or secret');
    return false;
  }
  
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch (error) {
    console.error('Signature verification error:', error.message);
    return false;
  }
}

/**
 * Calculate carbon footprint for code changes
 * @param {Object} commits - Array of commits
 * @returns {Object} Carbon footprint analysis
 */
function calculateCarbonFootprint(commits) {
  let totalLines = 0;
  let energyConsumption = 0;
  let carbonScore = 'green';
  
  commits.forEach(commit => {
    // Estimate based on commit message and changes
    const additions = commit.stats?.additions || 0;
    const deletions = commit.stats?.deletions || 0;
    totalLines += additions + deletions;
    
    // Simple carbon calculation (can be enhanced with AI)
    energyConsumption += (additions * 0.001) + (deletions * 0.0005); // kWh estimate
  });
  
  // Determine carbon impact level
  if (energyConsumption > 1.0) carbonScore = 'red';
  else if (energyConsumption > 0.5) carbonScore = 'yellow';
  
  const carbonEmission = energyConsumption * 0.4; // kg CO2 (average grid)
  
  return {
    totalLines,
    energyConsumption: parseFloat(energyConsumption.toFixed(4)),
    carbonEmission: parseFloat(carbonEmission.toFixed(4)),
    carbonScore,
    recommendations: generateRecommendations(carbonScore, energyConsumption)
  };
}

/**
 * Generate green coding recommendations
 * @param {string} score - Carbon score (green/yellow/red)
 * @param {number} energy - Energy consumption
 * @returns {Array} Array of recommendations
 */
function generateRecommendations(score, energy) {
  const recommendations = [];
  
  if (score === 'red') {
    recommendations.push('🔴 High carbon impact detected!');
    recommendations.push('💡 Consider optimizing algorithms for better efficiency');
    recommendations.push('⚡ Review database queries and API calls');
    recommendations.push('🔄 Implement caching to reduce computational overhead');
  } else if (score === 'yellow') {
    recommendations.push('🟡 Moderate carbon impact');
    recommendations.push('📊 Monitor performance metrics');
    recommendations.push('🌱 Consider green hosting providers');
  } else {
    recommendations.push('🟢 Low carbon impact - Great work!');
    recommendations.push('♻️ Keep following sustainable coding practices');
  }
  
  return recommendations;
}

/**
 * Handle push events for carbon tracking
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Processing result
 */
async function handlePush(payload) {
  const { commits, repository, pusher } = payload;
  
  console.log(`🌱 CarbonFlow: Analyzing ${commits.length} commits in ${repository.full_name}`);
  
  const analysis = calculateCarbonFootprint(commits);
  
  // Create issue if high carbon impact
  if (analysis.carbonScore === 'red') {
    return {
      action: 'create_issue',
      title: '🔴 High Carbon Footprint Detected',
      body: `## 🌍 Carbon Impact Analysis\n\n` +
            `**Energy Consumption:** ${analysis.energyConsumption} kWh\n` +
            `**Carbon Emission:** ${analysis.carbonEmission} kg CO2\n` +
            `**Lines Changed:** ${analysis.totalLines}\n\n` +
            `### 💡 Recommendations:\n${analysis.recommendations.map(r => `- ${r}`).join('\n')}\n\n` +
            `*Automated analysis by CarbonFlow AI*`,
      labels: ['carbon-footprint', 'high-impact', 'sustainability']
    };
  }
  
  return {
    action: 'log',
    analysis
  };
}

/**
 * Handle pull request events
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Processing result
 */
async function handlePullRequest(payload) {
  const { action, pull_request, repository } = payload;
  
  if (action === 'opened' || action === 'synchronize') {
    console.log(`🔍 CarbonFlow: Analyzing PR #${pull_request.number}`);
    
    // Simulate analysis (in real implementation, analyze diff)
    const additions = pull_request.additions || 0;
    const deletions = pull_request.deletions || 0;
    const totalChanges = additions + deletions;
    
    let carbonLabel = 'carbon-green';
    let carbonComment = '🟢 **Low Carbon Impact** - Sustainable code changes!';
    
    if (totalChanges > 500) {
      carbonLabel = 'carbon-red';
      carbonComment = '🔴 **High Carbon Impact** - Consider optimizing for efficiency';
    } else if (totalChanges > 100) {
      carbonLabel = 'carbon-yellow';
      carbonComment = '🟡 **Moderate Carbon Impact** - Monitor performance';
    }
    
    return {
      action: 'comment_and_label',
      comment: `${carbonComment}\n\n` +
               `**Changes:** +${additions}/-${deletions} lines\n` +
               `**Estimated Energy:** ${(totalChanges * 0.001).toFixed(3)} kWh\n\n` +
               `*Analysis by CarbonFlow AI Tracker*`,
      labels: [carbonLabel, 'sustainability-check']
    };
  }
  
  return { action: 'ignore' };
}

/**
 * Handle workflow run events for CI/CD carbon tracking
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Processing result
 */
async function handleWorkflowRun(payload) {
  const { action, workflow_run, repository } = payload;
  
  if (action === 'completed') {
    const duration = new Date(workflow_run.updated_at) - new Date(workflow_run.created_at);
    const durationMinutes = Math.round(duration / (1000 * 60));
    
    // Estimate CI/CD carbon footprint
    const estimatedEnergy = durationMinutes * 0.01; // kWh estimate
    const carbonEmission = estimatedEnergy * 0.4; // kg CO2
    
    console.log(`⚡ Workflow '${workflow_run.name}' completed in ${durationMinutes}min`);
    console.log(`🌍 Estimated carbon: ${carbonEmission.toFixed(3)} kg CO2`);
    
    return {
      action: 'log_workflow',
      workflow: workflow_run.name,
      duration: durationMinutes,
      energy: estimatedEnergy,
      carbon: carbonEmission
    };
  }
  
  return { action: 'ignore' };
}

/**
 * Main webhook handler
 */
module.exports = async (req, res) => {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'healthy',
      service: 'CarbonFlow AI Webhook',
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Get headers and body
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];
    
    // Get raw body for signature verification
    const body = JSON.stringify(req.body);
    const rawBody = Buffer.from(body, 'utf8');
    
    // Verify signature
    const secret = process.env.WEBHOOK_SECRET || 'carbon_secret_2025';
    if (!verifySignature(signature, secret, rawBody)) {
      console.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    console.log(`\n🌱 CarbonFlow Webhook: ${event} (${deliveryId})`);
    
    const payload = req.body;
    let result = { action: 'ignore' };
    
    // Handle different events
    switch (event) {
      case 'ping':
        console.log('🏓 Ping received - CarbonFlow AI is ready!');
        result = { action: 'pong', zen: payload.zen };
        break;
        
      case 'push':
        result = await handlePush(payload);
        break;
        
      case 'pull_request':
        result = await handlePullRequest(payload);
        break;
        
      case 'workflow_run':
        result = await handleWorkflowRun(payload);
        break;
        
      default:
        console.log(`ℹ️  Event '${event}' not handled`);
    }
    
    console.log('📊 Analysis result:', result);
    
    // Return success response
    return res.status(200).json({
      success: true,
      event,
      result,
      carbonflow: {
        version: '1.0.0',
        service: 'CarbonFlow AI Tracker',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
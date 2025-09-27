#!/bin/bash
# IBM Cloud Functions Deployment Script for CarbonFlow AI

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🌱 CarbonFlow AI - IBM Cloud Functions Deployment${NC}"
echo "======================================================="

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
if ! command -v ibmcloud &> /dev/null; then
    echo -e "${RED}❌ IBM Cloud CLI not found${NC}"
    echo "Install from: https://cloud.ibm.com/docs/cli"
    exit 1
fi

# Check if logged in
if ! ibmcloud account show &> /dev/null; then
    echo -e "${RED}❌ Not logged into IBM Cloud${NC}"
    echo "Run: ibmcloud login"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites OK${NC}"

# Configuration
APP_NAME="carbonflow-ai"
RUNTIME="python:3.9"
MEMORY="512"
TIMEOUT="60"
REGION="us-south"
RESOURCE_GROUP="default"

# Environment variables (you'll need to set these)
if [ -z "$WATSON_NLU_APIKEY" ] || [ -z "$WATSON_NLU_URL" ]; then
    echo -e "${RED}❌ Watson NLU environment variables not set${NC}"
    echo "Set WATSON_NLU_APIKEY and WATSON_NLU_URL"
    exit 1
fi

# Target resource group and region
echo -e "${YELLOW}Setting up IBM Cloud environment...${NC}"
ibmcloud target -g $RESOURCE_GROUP -r $REGION

# Install Functions plugin if not already installed
if ! ibmcloud plugin show cloud-functions &> /dev/null; then
    echo -e "${YELLOW}Installing Cloud Functions plugin...${NC}"
    ibmcloud plugin install cloud-functions
fi

# Create namespace if it doesn't exist
echo -e "${YELLOW}Setting up Cloud Functions namespace...${NC}"
NAMESPACE="carbonflow-ns"
if ! ibmcloud fn namespace list | grep -q "$NAMESPACE"; then
    echo "Creating namespace: $NAMESPACE"
    ibmcloud fn namespace create $NAMESPACE
fi

# Target the namespace
ibmcloud fn property set --namespace $NAMESPACE

# Create requirements.txt for dependencies
echo -e "${YELLOW}Creating requirements.txt...${NC}"
cat > requirements.txt << EOF
ibm-watson>=7.0.0
ibmcloudant>=0.7.0
requests>=2.25.1
EOF

# Create action zip file
echo -e "${YELLOW}Creating deployment package...${NC}"
zip -r ${APP_NAME}.zip handler.py requirements.txt

# Deploy the function
echo -e "${YELLOW}Deploying Cloud Function...${NC}"
ibmcloud fn action create $APP_NAME ${APP_NAME}.zip \
    --kind $RUNTIME \
    --memory $MEMORY \
    --timeout ${TIMEOUT}000 \
    --param WATSON_NLU_APIKEY "$WATSON_NLU_APIKEY" \
    --param WATSON_NLU_URL "$WATSON_NLU_URL" \
    --web true

# Create API endpoints
echo -e "${YELLOW}Setting up API Gateway...${NC}"

# Health check endpoint
ibmcloud fn api create /carbonflow /health get $APP_NAME --response-type json

# Analysis endpoint
ibmcloud fn api create /carbonflow /analyze post $APP_NAME --response-type json

# Get function URL
FUNCTION_URL=$(ibmcloud fn action get $APP_NAME --url | grep -o 'https://[^[:space:]]*')
API_BASE=$(ibmcloud fn api list | grep /carbonflow | awk '{print $4}' | head -1)

echo ""
echo -e "${GREEN}🚀 Deployment Complete!${NC}"
echo "======================================================="
echo -e "Function URL: ${BLUE}$FUNCTION_URL${NC}"
echo -e "API Base URL: ${BLUE}$API_BASE${NC}"
echo ""
echo "Endpoints:"
echo -e "  Health: ${BLUE}$API_BASE/health${NC}"
echo -e "  Analyze: ${BLUE}$API_BASE/analyze${NC}"
echo ""
echo "Test commands:"
echo "curl $API_BASE/health"
echo 'curl -X POST '$API_BASE'/analyze -H "Content-Type: application/json" -d '"'"'{"text":"Solar energy reduces emissions"}'""
echo ""

# Test the deployment
echo -e "${YELLOW}Testing deployment...${NC}"
if curl -s "$API_BASE/health" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
fi

# Cleanup
rm -f ${APP_NAME}.zip requirements.txt

echo -e "${GREEN}✅ CarbonFlow AI deployed successfully to IBM Cloud Functions!${NC}"
echo "Monitor logs with: ibmcloud fn activation logs --last"
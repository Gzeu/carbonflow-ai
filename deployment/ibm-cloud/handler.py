# CarbonFlow AI - IBM Cloud Functions Handler
import json
import os
from datetime import datetime
from ibm_watson import NaturalLanguageUnderstandingV1
from ibm_watson.natural_language_understanding_v1 import Features, SentimentOptions, KeywordsOptions
from ibmcloudant.cloudant_v1 import CloudantV1
from ibm_cloud_sdk_core.authenticators import IAMAuthenticator

def main(event):
    """Main Cloud Functions entry point"""
    try:
        body = json.loads(event.get('__ow_body', '{}')) if isinstance(event.get('__ow_body'), str) else event
        action = event.get('__ow_path', '').split('/')[-1] or 'analyze'
        
        if action == 'health':
            return health_check()
        elif action == 'analyze':
            return analyze_carbon_data(body)
        else:
            return error_response('Invalid action', 400)
            
    except Exception as e:
        return error_response(str(e), 500)

def analyze_carbon_data(data):
    """Analyze carbon credit data using Watson NLU"""
    try:
        text_input = data.get('text', '')
        if not text_input:
            return error_response('Missing text data', 400)
            
        # Watson NLU analysis
        nlu = NaturalLanguageUnderstandingV1(
            version='2022-04-07',
            authenticator=IAMAuthenticator(os.environ['WATSON_NLU_APIKEY'])
        )
        nlu.set_service_url(os.environ['WATSON_NLU_URL'])
        
        analysis = nlu.analyze(
            text=text_input,
            features=Features(
                sentiment=SentimentOptions(),
                keywords=KeywordsOptions(limit=5)
            )
        ).get_result()
        
        # Calculate carbon score
        carbon_score = calculate_carbon_score(analysis)
        
        result = {
            'timestamp': datetime.utcnow().isoformat(),
            'carbon_score': carbon_score,
            'grade': get_carbon_grade(carbon_score),
            'sentiment': analysis.get('sentiment', {}),
            'keywords': analysis.get('keywords', []),
            'recommendations': generate_recommendations(analysis)
        }
        
        return success_response(result)
        
    except Exception as e:
        return error_response(f"Analysis failed: {str(e)}", 500)

def calculate_carbon_score(analysis):
    """Calculate sustainability score 0-100"""
    sentiment_score = analysis.get('sentiment', {}).get('document', {}).get('score', 0)
    base_score = max(0, (sentiment_score + 1) * 50)
    return round(min(100, base_score), 1)

def get_carbon_grade(score):
    """Convert score to grade"""
    if score >= 90: return 'A+'
    elif score >= 80: return 'A'
    elif score >= 70: return 'B'
    elif score >= 60: return 'C'
    else: return 'D'

def generate_recommendations(analysis):
    """Generate carbon recommendations"""
    sentiment = analysis.get('sentiment', {}).get('document', {}).get('label', 'neutral')
    
    if sentiment == 'positive':
        return ['Consider renewable energy credits', 'Explore carbon offset programs']
    else:
        return ['Review carbon footprint', 'Implement efficiency measures']

def health_check():
    """Health check endpoint"""
    return success_response({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'service': 'carbonflow-ai',
        'version': '1.0.0'
    })

def success_response(data):
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(data)
    }

def error_response(message, status_code):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'error': message})
    }
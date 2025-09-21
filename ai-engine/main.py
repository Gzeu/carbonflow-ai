from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from models.satellite_analyzer import SatelliteAnalyzer
from models.carbon_predictor import CarbonPredictor
from models.fraud_detector import FraudDetector
from models.price_forecaster import PriceForecaster
from utils.image_processor import ImageProcessor
from utils.database import get_database
from config import settings

# Initialize FastAPI app
app = FastAPI(
    title="CarbonFlow AI Engine",
    description="AI-powered carbon credit verification and analysis platform",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://carbonflow.ai"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize AI models
satellite_analyzer = SatelliteAnalyzer()
carbon_predictor = CarbonPredictor()
fraud_detector = FraudDetector()
price_forecaster = PriceForecaster()
image_processor = ImageProcessor()

# Logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic models for API requests/responses
class ProjectData(BaseModel):
    project_id: str
    name: str
    location: Dict[str, float]  # {"lat": 45.0, "lng": 25.0}
    project_type: str  # "reforestation", "renewable_energy", etc.
    area_hectares: float
    start_date: datetime
    description: Optional[str] = None

class VerificationResult(BaseModel):
    project_id: str
    verification_status: bool
    confidence_score: float
    co2_capture_estimate: float
    fraud_risk_score: float
    analysis_details: Dict[str, Any]
    satellite_images: List[str]
    timestamp: datetime

class PredictionRequest(BaseModel):
    project_id: str
    timeframe_days: int = 365
    include_weather_data: bool = True

class PredictionResult(BaseModel):
    project_id: str
    predicted_co2_capture: float
    confidence_interval: Dict[str, float]
    monthly_breakdown: List[Dict[str, float]]
    factors_analysis: Dict[str, float]
    recommendation: str

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "CarbonFlow AI Engine",
        "status": "operational",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.post("/verify-carbon-project", response_model=VerificationResult)
async def verify_carbon_project(
    project_data: ProjectData,
    background_tasks: BackgroundTasks
):
    """
    Main endpoint pentru verificarea completă a unui proiect carbon
    Combină analiza satelit, detectarea fraudelor și predicțiile CO2
    """
    try:
        logger.info(f"Starting verification for project {project_data.project_id}")
        
        # Parallel processing pentru eficiență
        tasks = [
            satellite_analyzer.analyze_project_area(
                project_data.location, 
                project_data.area_hectares
            ),
            fraud_detector.assess_project_legitimacy(project_data),
            carbon_predictor.estimate_co2_capture(project_data)
        ]
        
        satellite_result, fraud_result, carbon_result = await asyncio.gather(*tasks)
        
        # Combine results
        verification_result = VerificationResult(
            project_id=project_data.project_id,
            verification_status=(
                satellite_result["vegetation_detected"] and 
                fraud_result["legitimacy_score"] > 0.8 and
                carbon_result["feasibility"] > 0.7
            ),
            confidence_score=min(
                satellite_result["confidence"],
                fraud_result["legitimacy_score"],
                carbon_result["feasibility"]
            ),
            co2_capture_estimate=carbon_result["annual_co2_tonnes"],
            fraud_risk_score=1.0 - fraud_result["legitimacy_score"],
            analysis_details={
                "satellite_analysis": satellite_result,
                "fraud_assessment": fraud_result,
                "carbon_estimation": carbon_result
            },
            satellite_images=satellite_result.get("image_urls", []),
            timestamp=datetime.now()
        )
        
        # Background task pentru salvarea în database
        background_tasks.add_task(
            save_verification_result, 
            verification_result
        )
        
        logger.info(f"Verification completed for project {project_data.project_id}")
        return verification_result
        
    except Exception as e:
        logger.error(f"Verification failed for project {project_data.project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")

@app.post("/analyze-satellite")
async def analyze_satellite_image(
    file: UploadFile = File(...),
    project_id: str = None
):
    """
    Analizează o imagine satelit uploadată pentru detectarea vegetației
    """
    try:
        # Validate image format
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="Invalid file format")
        
        # Process image
        image_data = await file.read()
        processed_image = image_processor.preprocess_satellite_image(image_data)
        
        # Analyze cu CNN model
        analysis_result = await satellite_analyzer.analyze_single_image(processed_image)
        
        return {
            "project_id": project_id,
            "filename": file.filename,
            "analysis": analysis_result,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Satellite analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/carbon-prediction/{project_id}", response_model=PredictionResult)
async def predict_carbon_capture(
    project_id: str,
    timeframe_days: int = 365,
    include_weather: bool = True
):
    """
    Generează predicții CO2 capture pentru un proiect specific
    """
    try:
        # Get project data from database
        db = get_database()
        project_data = await db.get_project(project_id)
        
        if not project_data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Generate prediction
        prediction = await carbon_predictor.predict_capture(
            project_data=project_data,
            timeframe_days=timeframe_days,
            include_weather_data=include_weather
        )
        
        return prediction
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction failed for project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@app.get("/market-analysis")
async def get_market_analysis():
    """
    Analiză de piață pentru carbon credits cu forecasting prețuri
    """
    try:
        market_data = await price_forecaster.get_market_analysis()
        
        return {
            "current_prices": market_data["current_prices"],
            "price_trends": market_data["trends"],
            "volume_analysis": market_data["volume"],
            "forecast_30_days": market_data["forecast"],
            "market_sentiment": market_data["sentiment"],
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Market analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Market analysis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """
    Health check pentru monitoring system
    """
    return {
        "status": "healthy",
        "models_loaded": {
            "satellite_analyzer": satellite_analyzer.is_loaded(),
            "carbon_predictor": carbon_predictor.is_loaded(),
            "fraud_detector": fraud_detector.is_loaded(),
            "price_forecaster": price_forecaster.is_loaded()
        },
        "timestamp": datetime.now().isoformat(),
        "uptime": "operational"
    }

async def save_verification_result(result: VerificationResult):
    """
    Background task pentru salvarea rezultatelor în database
    """
    try:
        db = get_database()
        await db.save_verification_result(result.dict())
        logger.info(f"Saved verification result for project {result.project_id}")
    except Exception as e:
        logger.error(f"Failed to save verification result: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=True if settings.ENVIRONMENT == "development" else False
    )

from pydantic_settings import BaseSettings
from typing import Optional
import os

class Settings(BaseSettings):
    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    
    # API Configuration
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8001
    API_WORKERS: int = 1
    
    # Database
    DATABASE_URL: str = "postgresql://carbonflow:password@localhost:5432/carbonflow_db"
    REDIS_URL: str = "redis://localhost:6379"
    
    # AI Models Configuration
    MODEL_PATH: str = "./models"
    TRAINING_DATA_PATH: str = "./data"
    TENSORFLOW_ENABLE_GPU: bool = True
    MODEL_CACHE_SIZE: int = 1000
    
    # Satellite APIs
    SATELLITE_API_KEY: Optional[str] = None
    NASA_API_KEY: Optional[str] = None
    GOOGLE_EARTH_API_KEY: Optional[str] = None
    ESA_API_KEY: Optional[str] = None
    
    # External APIs
    WEATHER_API_KEY: Optional[str] = None
    CARBON_REGISTRY_API_KEY: Optional[str] = None
    
    # ML Model Parameters
    CNN_INPUT_SIZE: tuple = (224, 224, 3)
    LSTM_SEQUENCE_LENGTH: int = 60
    BATCH_SIZE: int = 32
    LEARNING_RATE: float = 0.001
    
    # Verification Thresholds
    MIN_CONFIDENCE_SCORE: float = 0.85
    MAX_FRAUD_RISK: float = 0.2
    MIN_VEGETATION_COVERAGE: float = 0.6
    
    # Processing Limits
    MAX_IMAGE_SIZE: int = 10 * 1024 * 1024  # 10MB
    MAX_PROCESSING_TIME: int = 300  # 5 minutes
    CONCURRENT_REQUESTS: int = 10
    
    # IoT Configuration
    MQTT_BROKER_URL: str = "mqtt://localhost:1883"
    MQTT_USERNAME: Optional[str] = None
    MQTT_PASSWORD: Optional[str] = None
    INFLUXDB_URL: str = "http://localhost:8086"
    INFLUXDB_TOKEN: Optional[str] = None
    INFLUXDB_ORG: str = "carbonflow"
    INFLUXDB_BUCKET: str = "iot-sensors"
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ENCRYPTION_KEY: Optional[str] = None
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

# Validate critical settings
if settings.ENVIRONMENT == "production":
    required_settings = [
        "SATELLITE_API_KEY",
        "NASA_API_KEY",
        "SECRET_KEY"
    ]
    
    missing_settings = []
    for setting in required_settings:
        if not getattr(settings, setting):
            missing_settings.append(setting)
    
    if missing_settings:
        raise ValueError(f"Missing required production settings: {missing_settings}")

print(f"CarbonFlow AI Engine configured for {settings.ENVIRONMENT} environment")

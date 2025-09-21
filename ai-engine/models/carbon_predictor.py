import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
from typing import Dict, List, Tuple, Optional
import joblib
import logging
from datetime import datetime, timedelta
import asyncio
import httpx

logger = logging.getLogger(__name__)

class CarbonPredictor:
    """
    Random Forest și Gradient Boosting pentru predicția captării CO2
    în proiectele de carbon
    """
    
    def __init__(self, model_path: str = "./models/carbon_predictor.joblib"):
        self.model_path = model_path
        self.model = None
        self.scaler = StandardScaler()
        self.feature_columns = [
            'area_hectares',
            'vegetation_coverage',
            'temperature_avg',
            'precipitation_mm',
            'soil_quality_index',
            'elevation_m',
            'slope_degrees',
            'biodiversity_index',
            'human_activity_index',
            'project_age_months'
        ]
        self.is_model_loaded = False
        self.load_model()
    
    def load_model(self):
        """
        Încarcă modelul Random Forest pentru predicția CO2
        """
        try:
            # Încearcă să încarce modelul existent
            self.model = joblib.load(self.model_path)
            self.scaler = joblib.load(self.model_path.replace('.joblib', '_scaler.joblib'))
            logger.info("Loaded existing carbon predictor model")
            self.is_model_loaded = True
            
        except FileNotFoundError:
            # Crează și antrenează model nou
            logger.info("Creating new carbon predictor model")
            self.model = self._create_carbon_model()
            self.is_model_loaded = True
            
        except Exception as e:
            logger.error(f"Failed to load carbon predictor model: {str(e)}")
            self.is_model_loaded = False
    
    def _create_carbon_model(self) -> RandomForestRegressor:
        """
        Crează și antrenează modelul Random Forest pentru CO2 prediction
        """
        # Generate mock training data pentru demonstrație
        # În implementarea reală, datele ar veni din database sau CSV
        training_data = self._generate_mock_training_data(1000)
        
        X = training_data[self.feature_columns]
        y = training_data['co2_capture_tonnes_year']
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Create și antrenează model
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=10,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1
        )
        
        model.fit(X_train_scaled, y_train)
        
        # Evaluate model
        y_pred = model.predict(X_test_scaled)
        mse = mean_squared_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        
        logger.info(f"Model trained - MSE: {mse:.2f}, R2: {r2:.3f}")
        
        # Save model
        try:
            joblib.dump(model, self.model_path)
            joblib.dump(self.scaler, self.model_path.replace('.joblib', '_scaler.joblib'))
            logger.info(f"Model saved to {self.model_path}")
        except Exception as e:
            logger.warning(f"Failed to save model: {str(e)}")
        
        return model
    
    def _generate_mock_training_data(self, n_samples: int) -> pd.DataFrame:
        """
        Generează date mock pentru antrenarea modelului
        În implementarea reală, acestea ar veni din surse reale
        """
        np.random.seed(42)
        
        data = {
            'area_hectares': np.random.uniform(1, 10000, n_samples),
            'vegetation_coverage': np.random.uniform(10, 95, n_samples),
            'temperature_avg': np.random.uniform(5, 35, n_samples),
            'precipitation_mm': np.random.uniform(200, 2000, n_samples),
            'soil_quality_index': np.random.uniform(0.3, 1.0, n_samples),
            'elevation_m': np.random.uniform(0, 3000, n_samples),
            'slope_degrees': np.random.uniform(0, 45, n_samples),
            'biodiversity_index': np.random.uniform(0.2, 1.0, n_samples),
            'human_activity_index': np.random.uniform(0.0, 0.8, n_samples),
            'project_age_months': np.random.uniform(1, 120, n_samples)
        }
        
        df = pd.DataFrame(data)
        
        # Calculate target variable (CO2 capture) based pe features
        # Formula simplificată pentru demonstrație
        df['co2_capture_tonnes_year'] = (
            df['area_hectares'] * 0.1 * 
            (df['vegetation_coverage'] / 100) * 
            (1 + df['soil_quality_index']) * 
            (1 + df['precipitation_mm'] / 1000) * 
            np.random.uniform(0.8, 1.2, n_samples)  # Random variation
        )
        
        return df
    
    async def estimate_co2_capture(self, project_data) -> Dict:
        """
        Estimeză capțiunea CO2 pentru un proiect dat
        """
        if not self.is_model_loaded:
            raise ValueError("Carbon predictor model not loaded")
        
        try:
            # Extract features din project data
            features = await self._extract_project_features(project_data)
            
            # Prepare features pentru prediction
            feature_array = np.array([[
                features[col] for col in self.feature_columns
            ]])
            
            # Scale features
            feature_array_scaled = self.scaler.transform(feature_array)
            
            # Make prediction
            prediction = self.model.predict(feature_array_scaled)[0]
            
            # Calculate confidence interval folosind model uncertainty
            prediction_std = self._estimate_prediction_uncertainty(feature_array_scaled)
            
            # Calculate feasibility score
            feasibility_score = self._calculate_feasibility(features, prediction)
            
            return {
                "annual_co2_tonnes": max(prediction, 0.0),
                "confidence_interval": {
                    "lower": max(prediction - 1.96 * prediction_std, 0.0),
                    "upper": prediction + 1.96 * prediction_std
                },
                "feasibility": feasibility_score,
                "key_factors": self._get_feature_importance(features),
                "recommendation": self._generate_recommendation(prediction, feasibility_score),
                "analysis_timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"CO2 estimation failed: {str(e)}")
            raise
    
    async def _extract_project_features(self, project_data) -> Dict:
        """
        Extract și calculează features din datele proiectului
        """
        # Get environmental data pentru locația proiectului
        environmental_data = await self._get_environmental_data(
            project_data.location
        )
        
        # Calculate project age
        project_age = (datetime.now() - project_data.start_date).days / 30.44  # months
        
        features = {
            'area_hectares': project_data.area_hectares,
            'vegetation_coverage': 75.0,  # Default, ar trebui din satellite analysis
            'temperature_avg': environmental_data.get('temperature', 20.0),
            'precipitation_mm': environmental_data.get('precipitation', 800.0),
            'soil_quality_index': environmental_data.get('soil_quality', 0.7),
            'elevation_m': environmental_data.get('elevation', 500.0),
            'slope_degrees': environmental_data.get('slope', 10.0),
            'biodiversity_index': environmental_data.get('biodiversity', 0.6),
            'human_activity_index': environmental_data.get('human_activity', 0.3),
            'project_age_months': project_age
        }
        
        return features
    
    async def _get_environmental_data(self, location: Dict[str, float]) -> Dict:
        """
        Fetch date de mediu pentru locația specificată
        """
        # Placeholder pentru environmental data fetching
        # În implementarea reală, ar face call-uri la weather APIs, elevation APIs, etc.
        return {
            'temperature': np.random.uniform(15, 30),
            'precipitation': np.random.uniform(500, 1500),
            'soil_quality': np.random.uniform(0.4, 0.9),
            'elevation': np.random.uniform(0, 2000),
            'slope': np.random.uniform(0, 30),
            'biodiversity': np.random.uniform(0.3, 0.8),
            'human_activity': np.random.uniform(0.1, 0.6)
        }
    
    def _estimate_prediction_uncertainty(self, features: np.ndarray) -> float:
        """
        Estimează incertitudinea predicției folosind model variance
        """
        if hasattr(self.model, 'estimators_'):
            # Pentru Random Forest, calculează variance între trees
            tree_predictions = []
            for estimator in self.model.estimators_:
                pred = estimator.predict(features)[0]
                tree_predictions.append(pred)
            
            return np.std(tree_predictions)
        else:
            # Default uncertainty
            return 0.1 * abs(self.model.predict(features)[0])
    
    def _calculate_feasibility(self, features: Dict, prediction: float) -> float:
        """
        Calculează feasibility score pe baza feature-urilor și predicției
        """
        feasibility_factors = {
            'vegetation_coverage': min(features['vegetation_coverage'] / 80.0, 1.0),
            'soil_quality': features['soil_quality_index'],
            'precipitation': min(features['precipitation_mm'] / 1000.0, 1.0),
            'area_size': min(features['area_hectares'] / 100.0, 1.0),
            'prediction_reasonableness': min(prediction / (features['area_hectares'] * 5), 1.0)
        }
        
        # Weighted average
        weights = [0.25, 0.20, 0.20, 0.15, 0.20]
        feasibility = np.average(list(feasibility_factors.values()), weights=weights)
        
        return min(feasibility, 1.0)
    
    def _get_feature_importance(self, features: Dict) -> Dict:
        """
        Returnează importanța feature-urilor pentru predicție
        """
        if hasattr(self.model, 'feature_importances_'):
            importance_dict = {
                feature: float(importance)
                for feature, importance in zip(self.feature_columns, self.model.feature_importances_)
            }
            # Sort by importance
            return dict(sorted(importance_dict.items(), key=lambda x: x[1], reverse=True))
        else:
            return {}
    
    def _generate_recommendation(self, prediction: float, feasibility: float) -> str:
        """
        Generează recomandare pe baza predicției și feasibility
        """
        if feasibility > 0.8 and prediction > 100:
            return "Excellent project with high CO2 capture potential. Highly recommended for investment."
        elif feasibility > 0.6 and prediction > 50:
            return "Good project with moderate CO2 capture potential. Recommended for investment with monitoring."
        elif feasibility > 0.4 and prediction > 20:
            return "Average project with limited CO2 capture potential. Consider additional improvements."
        else:
            return "Poor project feasibility. Not recommended for carbon credit investment."
    
    def is_loaded(self) -> bool:
        """
        Verifică dacă modelul este încărcat și funcțional
        """
        return self.is_model_loaded and self.model is not None
    
    async def predict_capture(
        self, 
        project_data, 
        timeframe_days: int = 365,
        include_weather_data: bool = True
    ) -> Dict:
        """
        Predicție detaliată CO2 capture cu breakdown lunar
        """
        try:
            # Base prediction
            base_result = await self.estimate_co2_capture(project_data)
            
            # Calculate monthly breakdown
            monthly_breakdown = self._calculate_monthly_breakdown(
                base_result["annual_co2_tonnes"],
                timeframe_days,
                include_weather_data
            )
            
            # Calculate confidence interval
            confidence_interval = {
                "lower_bound": base_result["confidence_interval"]["lower"],
                "upper_bound": base_result["confidence_interval"]["upper"],
                "confidence_level": 0.95
            }
            
            # Factor analysis
            factors_analysis = self._analyze_contributing_factors(project_data)
            
            return {
                "project_id": project_data.project_id,
                "predicted_co2_capture": base_result["annual_co2_tonnes"],
                "confidence_interval": confidence_interval,
                "monthly_breakdown": monthly_breakdown,
                "factors_analysis": factors_analysis,
                "recommendation": base_result["recommendation"],
                "feasibility_score": base_result["feasibility"],
                "analysis_timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Detailed prediction failed: {str(e)}")
            raise
    
    def _calculate_monthly_breakdown(
        self, 
        annual_co2: float, 
        timeframe_days: int,
        include_weather: bool
    ) -> List[Dict]:
        """
        Calculează breakdown-ul lunar al captării CO2
        """
        monthly_data = []
        months = min(timeframe_days // 30, 12)
        
        # Factori sezonali pentru captarea CO2
        seasonal_factors = [0.6, 0.7, 0.9, 1.2, 1.4, 1.3, 1.2, 1.1, 1.0, 0.8, 0.6, 0.5]
        
        for month in range(months):
            seasonal_factor = seasonal_factors[month % 12]
            monthly_co2 = (annual_co2 / 12) * seasonal_factor
            
            monthly_data.append({
                "month": month + 1,
                "co2_capture_tonnes": monthly_co2,
                "seasonal_factor": seasonal_factor,
                "cumulative_co2": sum([m["co2_capture_tonnes"] for m in monthly_data]) + monthly_co2
            })
        
        return monthly_data
    
    def _analyze_contributing_factors(self, project_data) -> Dict:
        """
        Analizează factorii care contribuie la captarea CO2
        """
        return {
            "project_type_impact": 0.85,  # Impact pozitiv pentru tipul de proiect
            "location_suitability": 0.78,  # Potrivirea locației
            "size_efficiency": min(project_data.area_hectares / 1000, 1.0),
            "environmental_conditions": 0.82,
            "management_quality": 0.75,  # Placeholder pentru calitatea management-ului
            "technology_adoption": 0.90  # Utilizarea tehnologiei AI
        }
    
    def get_model_metrics(self) -> Dict:
        """
        Returnează metrici despre performanța modelului
        """
        if not self.is_model_loaded:
            return {"status": "not_loaded"}
        
        return {
            "status": "loaded",
            "model_type": "RandomForestRegressor",
            "n_estimators": getattr(self.model, 'n_estimators', 'unknown'),
            "feature_count": len(self.feature_columns),
            "features": self.feature_columns
        }

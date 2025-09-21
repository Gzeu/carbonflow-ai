import tensorflow as tf
import numpy as np
from typing import Dict, List, Tuple, Optional
import cv2
from PIL import Image
import logging
from datetime import datetime, timedelta
import asyncio
import httpx

logger = logging.getLogger(__name__)

class SatelliteAnalyzer:
    """
    CNN-based satellite image analyzer pentru detectarea vegetației
    și monitorizarea proiectelor de carbon
    """
    
    def __init__(self, model_path: str = "./models/vegetation_cnn.h5"):
        self.model_path = model_path
        self.model = None
        self.is_model_loaded = False
        self.vegetation_classes = [
            "no_vegetation",
            "sparse_vegetation", 
            "moderate_vegetation",
            "dense_vegetation",
            "forest",
            "deforestation",
            "reforestation"
        ]
        self.load_model()
    
    def load_model(self):
        """
        Încarcă modelul CNN pentru analiza vegetației
        """
        try:
            # Încearcă să încarce modelul existent
            if tf.io.gfile.exists(self.model_path):
                self.model = tf.keras.models.load_model(self.model_path)
                logger.info("Loaded existing vegetation CNN model")
            else:
                # Crează model nou dacă nu există
                self.model = self._create_vegetation_cnn()
                logger.info("Created new vegetation CNN model")
            
            self.is_model_loaded = True
            
        except Exception as e:
            logger.error(f"Failed to load/create CNN model: {str(e)}")
            self.is_model_loaded = False
    
    def _create_vegetation_cnn(self) -> tf.keras.Model:
        """
        Crează arhitectura CNN pentru detectarea vegetației
        """
        model = tf.keras.Sequential([
            # Input layer
            tf.keras.layers.InputLayer(input_shape=(224, 224, 3)),
            
            # Conv Block 1
            tf.keras.layers.Conv2D(32, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Conv2D(32, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.MaxPooling2D((2, 2)),
            tf.keras.layers.Dropout(0.25),
            
            # Conv Block 2
            tf.keras.layers.Conv2D(64, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Conv2D(64, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.MaxPooling2D((2, 2)),
            tf.keras.layers.Dropout(0.25),
            
            # Conv Block 3
            tf.keras.layers.Conv2D(128, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Conv2D(128, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.MaxPooling2D((2, 2)),
            tf.keras.layers.Dropout(0.25),
            
            # Conv Block 4
            tf.keras.layers.Conv2D(256, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.GlobalAveragePooling2D(),
            
            # Dense layers
            tf.keras.layers.Dense(512, activation='relu'),
            tf.keras.layers.Dropout(0.5),
            tf.keras.layers.Dense(256, activation='relu'),
            tf.keras.layers.Dropout(0.3),
            
            # Output layer
            tf.keras.layers.Dense(len(self.vegetation_classes), activation='softmax')
        ])
        
        # Compile model
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
            loss='categorical_crossentropy',
            metrics=['accuracy', 'precision', 'recall']
        )
        
        return model
    
    def preprocess_image(self, image_data: np.ndarray) -> np.ndarray:
        """
        Preprocessă imaginea pentru analiză CNN
        """
        try:
            # Resize la dimensiunea standard
            image = cv2.resize(image_data, (224, 224))
            
            # Normalize pixel values
            image = image.astype(np.float32) / 255.0
            
            # Add batch dimension
            image = np.expand_dims(image, axis=0)
            
            return image
            
        except Exception as e:
            logger.error(f"Image preprocessing failed: {str(e)}")
            raise
    
    async def analyze_single_image(self, image_data: np.ndarray) -> Dict:
        """
        Analizează o singură imagine satelit
        """
        if not self.is_model_loaded:
            raise ValueError("CNN model not loaded")
        
        try:
            # Preprocess image
            processed_image = self.preprocess_image(image_data)
            
            # Run prediction
            prediction = self.model.predict(processed_image, verbose=0)
            confidence_scores = prediction[0]
            
            # Get predicted class
            predicted_class_idx = np.argmax(confidence_scores)
            predicted_class = self.vegetation_classes[predicted_class_idx]
            max_confidence = float(confidence_scores[predicted_class_idx])
            
            # Calculate vegetation coverage percentage
            vegetation_coverage = self._calculate_vegetation_coverage(image_data)
            
            # Analyze change detection (dacă avem imagini istorice)
            change_detection = await self._detect_changes(image_data)
            
            return {
                "vegetation_detected": max_confidence > 0.7,
                "predicted_class": predicted_class,
                "confidence": max_confidence,
                "vegetation_coverage_percent": vegetation_coverage,
                "class_probabilities": {
                    class_name: float(score) 
                    for class_name, score in zip(self.vegetation_classes, confidence_scores)
                },
                "change_detection": change_detection,
                "analysis_timestamp": datetime.now().isoformat(),
                "model_version": "v1.0"
            }
            
        except Exception as e:
            logger.error(f"Satellite analysis failed: {str(e)}")
            raise
    
    async def analyze_project_area(
        self, 
        location: Dict[str, float], 
        area_hectares: float
    ) -> Dict:
        """
        Analizează o zonă completă de proiect folosind multiple imagini satelit
        """
        try:
            # Get satellite images pentru zona specificată
            images = await self._fetch_satellite_images(location, area_hectares)
            
            if not images:
                raise ValueError("No satellite images available for the specified area")
            
            # Analizează fiecare imagine
            analysis_results = []
            for image_data in images:
                result = await self.analyze_single_image(image_data)
                analysis_results.append(result)
            
            # Aggregate results
            avg_confidence = np.mean([r["confidence"] for r in analysis_results])
            avg_vegetation_coverage = np.mean([r["vegetation_coverage_percent"] for r in analysis_results])
            
            vegetation_detected = avg_confidence > 0.8 and avg_vegetation_coverage > 60
            
            # Calculate CO2 sequestration potential
            co2_potential = self._calculate_co2_potential(
                area_hectares, 
                avg_vegetation_coverage,
                analysis_results
            )
            
            return {
                "vegetation_detected": vegetation_detected,
                "confidence": avg_confidence,
                "vegetation_coverage_percent": avg_vegetation_coverage,
                "co2_sequestration_potential_tonnes_year": co2_potential,
                "images_analyzed": len(images),
                "detailed_analysis": analysis_results,
                "image_urls": [f"satellite_image_{i}.jpg" for i in range(len(images))],
                "analysis_timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Project area analysis failed: {str(e)}")
            raise
    
    def _calculate_vegetation_coverage(self, image_data: np.ndarray) -> float:
        """
        Calculează procentajul de acoperire cu vegetație din imagine
        folosind analiza culorilor și NDVI
        """
        try:
            # Convert to RGB if needed
            if len(image_data.shape) == 3 and image_data.shape[2] == 3:
                rgb_image = image_data
            else:
                rgb_image = cv2.cvtColor(image_data, cv2.COLOR_BGR2RGB)
            
            # Extract green channel (vegetation indicator)
            green_channel = rgb_image[:, :, 1]
            red_channel = rgb_image[:, :, 0]
            
            # Calculate NDVI (Normalized Difference Vegetation Index)
            # Simulated NDVI using visible spectrum
            ndvi = (green_channel.astype(float) - red_channel.astype(float)) / \
                   (green_channel.astype(float) + red_channel.astype(float) + 1e-8)
            
            # Threshold pentru vegetație (NDVI > 0.2)
            vegetation_pixels = np.sum(ndvi > 0.2)
            total_pixels = ndvi.size
            
            coverage_percent = (vegetation_pixels / total_pixels) * 100
            
            return min(coverage_percent, 100.0)
            
        except Exception as e:
            logger.error(f"Vegetation coverage calculation failed: {str(e)}")
            return 0.0
    
    async def _detect_changes(self, current_image: np.ndarray) -> Dict:
        """
        Detectează schimbările în vegetație comparând cu imagini istorice
        """
        # Placeholder pentru change detection
        # În implementarea reală, ar compara cu imagini din database
        return {
            "change_detected": False,
            "change_type": "no_change",
            "change_confidence": 0.0,
            "change_area_percent": 0.0
        }
    
    async def _fetch_satellite_images(
        self, 
        location: Dict[str, float], 
        area_hectares: float
    ) -> List[np.ndarray]:
        """
        Fetch satellite images din multiple surse (Google Earth, NASA, ESA)
        """
        # Placeholder pentru satellite image fetching
        # În implementarea reală, ar face call-uri la API-urile satelit
        logger.info(f"Fetching satellite images for location {location}, area {area_hectares} ha")
        
        # Simulează fetching cu o imagine mock
        mock_image = np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8)
        return [mock_image]
    
    def _calculate_co2_potential(
        self, 
        area_hectares: float, 
        vegetation_coverage: float, 
        analysis_results: List[Dict]
    ) -> float:
        """
        Calculează potențialul de sechestrare CO2 pe baza analizării vegetației
        """
        # Factori de conversie standard (tonnes CO2/hectar/an)
        conversion_factors = {
            "forest": 10.0,
            "dense_vegetation": 6.0,
            "moderate_vegetation": 3.0,
            "sparse_vegetation": 1.0,
            "no_vegetation": 0.0,
            "reforestation": 8.0,
            "deforestation": -5.0
        }
        
        # Calculează media ponderată
        total_co2_potential = 0.0
        total_confidence = 0.0
        
        for result in analysis_results:
            class_probs = result["class_probabilities"]
            for vegetation_class, probability in class_probs.items():
                if vegetation_class in conversion_factors:
                    co2_factor = conversion_factors[vegetation_class]
                    total_co2_potential += co2_factor * probability
                    total_confidence += probability
        
        if total_confidence > 0:
            weighted_co2_factor = total_co2_potential / total_confidence
        else:
            weighted_co2_factor = 0.0
        
        # Aplică factorul de acoperire vegetație
        vegetation_factor = vegetation_coverage / 100.0
        annual_co2_potential = area_hectares * weighted_co2_factor * vegetation_factor
        
        return max(annual_co2_potential, 0.0)
    
    def is_loaded(self) -> bool:
        """
        Verifică dacă modelul este încărcat și funcțional
        """
        return self.is_model_loaded and self.model is not None
    
    async def batch_analyze(
        self, 
        images: List[np.ndarray]
    ) -> List[Dict]:
        """
        Analizează multiple imagini în batch pentru eficiență
        """
        if not self.is_model_loaded:
            raise ValueError("CNN model not loaded")
        
        results = []
        for image in images:
            try:
                result = await self.analyze_single_image(image)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to analyze image in batch: {str(e)}")
                results.append({
                    "error": str(e),
                    "vegetation_detected": False,
                    "confidence": 0.0
                })
        
        return results
    
    async def temporal_analysis(
        self, 
        location: Dict[str, float], 
        start_date: datetime, 
        end_date: datetime
    ) -> Dict:
        """
        Analiză temporală pentru detectarea schimbărilor în timp
        """
        try:
            # Fetch imagini pentru perioada specificată
            time_series_images = await self._fetch_time_series_images(
                location, start_date, end_date
            )
            
            # Analizează fiecare imagine
            temporal_results = []
            for date, image in time_series_images.items():
                analysis = await self.analyze_single_image(image)
                analysis["date"] = date.isoformat()
                temporal_results.append(analysis)
            
            # Calculate trends
            vegetation_trend = self._calculate_vegetation_trend(temporal_results)
            
            return {
                "temporal_analysis": temporal_results,
                "vegetation_trend": vegetation_trend,
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
                "images_analyzed": len(temporal_results)
            }
            
        except Exception as e:
            logger.error(f"Temporal analysis failed: {str(e)}")
            raise
    
    async def _fetch_time_series_images(
        self, 
        location: Dict[str, float], 
        start_date: datetime, 
        end_date: datetime
    ) -> Dict[datetime, np.ndarray]:
        """
        Fetch imagini satelit pentru o perioadă de timp
        """
        # Placeholder pentru time series fetching
        # În implementarea reală, ar face call-uri la API-urile satelit cu range de date
        images = {}
        current_date = start_date
        
        while current_date <= end_date:
            # Simulează o imagine pentru fiecare lună
            mock_image = np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8)
            images[current_date] = mock_image
            current_date += timedelta(days=30)
        
        return images
    
    def _calculate_vegetation_trend(self, temporal_results: List[Dict]) -> Dict:
        """
        Calculează trendul vegetației pe perioada analizată
        """
        if len(temporal_results) < 2:
            return {"trend": "insufficient_data", "change_rate": 0.0}
        
        # Extract vegetation coverage values
        coverages = [r["vegetation_coverage_percent"] for r in temporal_results]
        dates = [datetime.fromisoformat(r["date"]) for r in temporal_results]
        
        # Calculate linear trend
        x_values = [(d - dates[0]).days for d in dates]
        coefficients = np.polyfit(x_values, coverages, 1)
        trend_slope = coefficients[0]
        
        # Classify trend
        if trend_slope > 1.0:
            trend_type = "increasing"
        elif trend_slope < -1.0:
            trend_type = "decreasing"
        else:
            trend_type = "stable"
        
        return {
            "trend": trend_type,
            "change_rate": trend_slope,
            "initial_coverage": coverages[0],
            "final_coverage": coverages[-1],
            "total_change": coverages[-1] - coverages[0]
        }
    
    def get_model_info(self) -> Dict:
        """
        Returnează informații despre modelul CNN
        """
        if not self.is_model_loaded:
            return {"status": "not_loaded"}
        
        return {
            "status": "loaded",
            "model_path": self.model_path,
            "input_shape": self.model.input_shape,
            "output_classes": len(self.vegetation_classes),
            "classes": self.vegetation_classes,
            "trainable_params": self.model.count_params()
        }

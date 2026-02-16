"""
Audio Processing API Routes
Endpoints for audio processing during purity testing
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from models.database import get_db
from schemas.audio import (
    AudioChunkRequest,
    AudioPredictionResponse,
    AudioInferenceRequest,
    AudioBufferStatus,
    AudioSettings,
    AudioFeaturesResponse,
    AudioAnalysisRequest,
    ModelLoadRequest,
    ModelLoadResponse,
    AudioStatusResponse,
    PurityTestRequest,
    PurityTestResponse,
    AudioFeatures,
    AudioSpectralFeatures
)
from services.audio_service import (
    get_audio_processor,
    get_audio_analyzer,
    initialize_audio_service
)
from typing import Optional, Dict, Any
from datetime import datetime
import logging
import os

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/audio", tags=["audio"])


# ============================================================================
# Audio Configuration Endpoints
# ============================================================================

@router.post("/initialize", response_model=Dict[str, Any])
async def initialize_audio_service_endpoint(
    model_path: Optional[str] = Query(None, description="Path to audio model file"),
    db: Session = Depends(get_db)
):
    """
    Initialize audio service with optional model loading
    
    - **model_path**: Optional path to trained audio model (.pth file)
    
    Returns initialization status and model information
    """
    try:
        # If no model_path provided, look for default model in ml_models folder
        if not model_path:
            # Common paths to check
            possible_paths = [
                "backend/ml_models/audio_model.pth",
                "backend/ml_models/mic_waveform_cnn.pth",
                "ml_models/audio_model.pth",
                "ml_models/mic_waveform_cnn.pth"
            ]
            
            for path in possible_paths:
                if os.path.isfile(path):
                    model_path = path
                    break
        
        processor = initialize_audio_service(model_path=model_path)
        
        return {
            "status": "initialized",
            "model_loaded": processor.is_model_loaded,
            "model_path": processor.model_path,
            "sample_rate": processor.sample_rate,
            "window_size": processor.window_size,
            "device": str(processor.device),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to initialize audio service: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Initialization failed: {str(e)}")


@router.post("/configure", response_model=Dict[str, Any])
async def configure_audio_settings(
    settings: AudioSettings,
    db: Session = Depends(get_db)
):
    """
    Configure audio processing settings
    
    - **settings**: AudioSettings with sample_rate, device, window_size, etc.
    
    Returns updated configuration
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        # Update settings
        processor.sample_rate = settings.sample_rate
        processor.window_size = settings.window_size
        processor.confidence_threshold = settings.confidence_threshold
        
        return {
            "status": "configured",
            "settings": settings.dict(),
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Configuration failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Configuration failed: {str(e)}")


# ============================================================================
# Audio Stream Processing Endpoints
# ============================================================================

@router.post("/process-chunk", response_model=Dict[str, Any])
async def process_audio_chunk(
    request: AudioChunkRequest,
    db: Session = Depends(get_db)
):
    """
    Process a single audio chunk
    
    - **audio_data**: List of float samples in range [-1, 1]
    - **chunk_index**: Optional index for tracking chunks
    - **session_id**: Optional session identifier
    
    Returns buffer status after adding chunk
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        # Process the chunk
        processor.process_audio_chunk(request.audio_data)
        
        # Return buffer status
        status = processor.get_buffer_status()
        return {
            "status": "processed",
            "chunk_size": len(request.audio_data),
            "buffer_status": status,
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chunk processing failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Processing failed: {str(e)}")


@router.post("/infer", response_model=Dict[str, Any])
async def run_audio_inference(
    request: AudioInferenceRequest,
    db: Session = Depends(get_db)
):
    """
    Run inference on buffered audio
    
    - **session_id**: Optional session identifier
    - **reset_buffer**: Whether to reset buffer after inference
    
    Returns prediction result
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        if not processor.is_model_loaded:
            raise HTTPException(status_code=503, detail="Model not loaded")
        
        # Run inference
        result = processor.infer()
        
        if result is None:
            # Insufficient data
            return {
                "status": "insufficient_data",
                "buffer_status": processor.get_buffer_status(),
                "timestamp": datetime.now().isoformat()
            }
        
        # Prepare response
        response = {
            "status": "success",
            "prediction": AudioPredictionResponse(**result),
            "timestamp": datetime.now().isoformat()
        }
        
        # Reset buffer if requested
        if request.reset_buffer:
            processor.reset_buffer()
            response["buffer_reset"] = True
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Inference failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")


@router.get("/buffer-status", response_model=AudioBufferStatus)
async def get_buffer_status(db: Session = Depends(get_db)):
    """
    Get current audio buffer status
    
    Returns buffer capacity, current size, and model status
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        return processor.get_buffer_status()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get buffer status: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get buffer status")


@router.post("/reset-buffer", response_model=Dict[str, Any])
async def reset_audio_buffer(db: Session = Depends(get_db)):
    """
    Clear the audio buffer
    
    Returns confirmation of buffer reset
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        processor.reset_buffer()
        
        return {
            "status": "reset",
            "buffer_status": processor.get_buffer_status(),
            "timestamp": datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Buffer reset failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Buffer reset failed")


# ============================================================================
# Audio Analysis Endpoints
# ============================================================================

@router.post("/analyze", response_model=AudioFeaturesResponse)
async def analyze_audio(
    request: AudioAnalysisRequest,
    db: Session = Depends(get_db)
):
    """
    Analyze audio data and extract features
    
    - **audio_data**: List of float samples
    - **session_id**: Optional session identifier
    
    Returns temporal and spectral features
    """
    try:
        analyzer = get_audio_analyzer()
        if not analyzer:
            raise HTTPException(status_code=500, detail="Audio analyzer not initialized")
        
        # Extract features
        temporal = analyzer.extract_features(request.audio_data)
        spectral = analyzer.compute_spectral_features(request.audio_data)
        
        return AudioFeaturesResponse(
            temporal_features=AudioFeatures(**temporal),
            spectral_features=AudioSpectralFeatures(**spectral)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Feature analysis failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Analysis failed: {str(e)}")


# ============================================================================
# Model Management Endpoints
# ============================================================================

@router.post("/load-model", response_model=ModelLoadResponse)
async def load_audio_model(
    request: ModelLoadRequest,
    db: Session = Depends(get_db)
):
    """
    Load a different audio model at runtime
    
    - **model_path**: Absolute path to model file
    - **session_id**: Optional session identifier
    
    Returns loading status
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        if not os.path.isfile(request.model_path):
            raise HTTPException(status_code=404, detail=f"Model file not found: {request.model_path}")
        
        success = processor.change_model(request.model_path)
        
        return ModelLoadResponse(
            success=success,
            message="Model loaded successfully" if success else "Failed to load model",
            model_path=request.model_path if success else None
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Model loading failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Model loading failed: {str(e)}")


# ============================================================================
# Status and Health Endpoints
# ============================================================================

@router.get("/status", response_model=AudioStatusResponse)
async def get_audio_service_status(db: Session = Depends(get_db)):
    """
    Get overall audio service status
    
    Returns service state, model status, and buffer information
    """
    try:
        processor = get_audio_processor()
        
        if not processor:
            return AudioStatusResponse(
                service_active=False,
                model_loaded=False,
                buffer_status=AudioBufferStatus(
                    buffer_size=0,
                    buffer_capacity=0,
                    duration_seconds=0.0,
                    buffer_percentage=0.0,
                    is_model_loaded=False
                ),
                last_prediction=None
            )
        
        return AudioStatusResponse(
            service_active=True,
            model_loaded=processor.is_model_loaded,
            buffer_status=processor.get_buffer_status(),
            last_prediction=None
        )
    except Exception as e:
        logger.error(f"Failed to get service status: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get service status")


@router.get("/health")
async def health_check():
    """
    Health check for audio service
    
    Returns service availability status
    """
    processor = get_audio_processor()
    
    return {
        "status": "healthy" if processor else "not_initialized",
        "service_available": processor is not None,
        "timestamp": datetime.now().isoformat()
    }


# ============================================================================
# Purity Testing Endpoint (Integration with Appraisal)
# ============================================================================

@router.post("/purity-test", response_model=PurityTestResponse)
async def perform_purity_test(
    request: PurityTestRequest,
    db: Session = Depends(get_db)
):
    """
    Perform audio-based purity test
    
    - **session_id**: Session identifier
    - **appraisal_id**: Optional appraisal ID
    - **test_type**: Type of test (rubbing_audio)
    - **settings**: Audio settings for test
    
    Returns purity test result
    """
    try:
        processor = get_audio_processor()
        if not processor:
            raise HTTPException(status_code=500, detail="Audio service not initialized")
        
        if not processor.is_model_loaded:
            raise HTTPException(status_code=503, detail="Model not loaded")
        
        # Run inference on current buffer
        result = processor.infer()
        
        if result is None:
            raise HTTPException(status_code=400, detail="Insufficient audio data for testing")
        
        # Map prediction to purity result
        audio_pred = AudioPredictionResponse(**result)
        test_result = "PURE" if audio_pred.prediction == "OK" else "NOT_PURE"
        
        response = PurityTestResponse(
            session_id=request.session_id,
            test_result=test_result,
            audio_prediction=audio_pred,
            confidence=audio_pred.confidence,
            test_duration=audio_pred.duration_seconds,
            timestamp=datetime.now().isoformat()
        )
        
        # Reset buffer after test
        processor.reset_buffer()
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Purity test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Purity test failed: {str(e)}")


# ============================================================================
# Device Management Endpoints
# ============================================================================

@router.get("/devices")
async def list_audio_devices():
    """
    List available audio input devices
    
    Returns list of available microphone/audio devices
    """
    try:
        # This is a placeholder - actual implementation depends on available audio library
        return {
            "devices": [
                {"id": "default", "name": "Default Device"},
                {"id": "microphone", "name": "Microphone"},
                {"id": "line_in", "name": "Line In"},
                {"id": "system_audio", "name": "System Audio"}
            ],
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to list devices: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to list devices")

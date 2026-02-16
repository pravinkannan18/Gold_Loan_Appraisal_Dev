"""
Audio Processing Schemas
Pydantic models for audio API requests and responses
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from enum import Enum


class AudioDevice(str, Enum):
    """Available audio input devices"""
    DEFAULT = "default"
    MICROPHONE = "microphone"
    LINE_IN = "line_in"
    SYSTEM_AUDIO = "system_audio"


class AudioSettings(BaseModel):
    """Audio configuration settings"""
    sample_rate: int = Field(default=16000, ge=8000, le=48000, description="Sample rate in Hz")
    device: AudioDevice = Field(default=AudioDevice.DEFAULT, description="Audio input device")
    window_size: float = Field(default=2.0, ge=0.5, le=5.0, description="Window size in seconds")
    confidence_threshold: float = Field(default=0.75, ge=0.0, le=1.0, description="Confidence threshold for predictions")
    channels: int = Field(default=1, ge=1, le=2, description="Number of audio channels")


class AudioChunkRequest(BaseModel):
    """Request for processing audio chunk"""
    audio_data: list[float] = Field(..., description="Audio samples as floats in range [-1, 1]")
    chunk_index: Optional[int] = Field(default=None, description="Index of chunk for tracking")
    session_id: Optional[str] = Field(default=None, description="Session identifier")


class AudioPredictionResponse(BaseModel):
    """Response from audio inference"""
    prediction: str = Field(..., description="Prediction: 'OK' or 'NOK'")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score (0-1)")
    is_confident: bool = Field(..., description="Whether prediction meets confidence threshold")
    ok_prob: float = Field(..., description="Probability of OK class")
    nok_prob: float = Field(..., description="Probability of NOK class")
    buffer_size: int = Field(..., description="Current buffer size in samples")
    duration_seconds: float = Field(..., description="Duration of buffered audio in seconds")


class AudioInferenceRequest(BaseModel):
    """Request for running inference on buffered audio"""
    session_id: Optional[str] = Field(default=None, description="Session identifier")
    reset_buffer: bool = Field(default=False, description="Reset buffer after inference")


class AudioBufferStatus(BaseModel):
    """Status of the audio buffer"""
    buffer_size: int = Field(..., description="Current number of samples in buffer")
    buffer_capacity: int = Field(..., description="Maximum buffer capacity in samples")
    duration_seconds: float = Field(..., description="Duration of buffered audio")
    buffer_percentage: float = Field(..., description="Percentage of buffer filled (0-100)")
    is_model_loaded: bool = Field(..., description="Whether the model is loaded")


class AudioFeatures(BaseModel):
    """Extracted audio features"""
    rms: float = Field(..., description="RMS (Root Mean Square) amplitude")
    peak: float = Field(..., description="Peak amplitude")
    mean: float = Field(..., description="Mean amplitude")
    std: float = Field(..., description="Standard deviation of amplitude")
    zero_crossing_rate: float = Field(..., description="Zero crossing rate")


class AudioSpectralFeatures(BaseModel):
    """Spectral features of audio"""
    fft_max_freq: float = Field(..., description="Frequency with maximum magnitude (Hz)")
    fft_max_magnitude: float = Field(..., description="Maximum magnitude in log scale")
    fft_mean_magnitude: float = Field(..., description="Mean magnitude in log scale")


class AudioFeaturesResponse(BaseModel):
    """Response with extracted audio features"""
    temporal_features: AudioFeatures = Field(..., description="Temporal domain features")
    spectral_features: AudioSpectralFeatures = Field(..., description="Frequency domain features")


class AudioAnalysisRequest(BaseModel):
    """Request for audio feature analysis"""
    audio_data: list[float] = Field(..., description="Audio samples")
    session_id: Optional[str] = Field(default=None, description="Session identifier")


class ModelLoadRequest(BaseModel):
    """Request to load a different model"""
    model_path: str = Field(..., description="Absolute path to model file (.pth)")
    session_id: Optional[str] = Field(default=None, description="Session identifier")


class ModelLoadResponse(BaseModel):
    """Response from model loading"""
    success: bool = Field(..., description="Whether model loaded successfully")
    message: str = Field(..., description="Status message")
    model_path: Optional[str] = Field(default=None, description="Loaded model path")


class AudioStatusResponse(BaseModel):
    """Overall audio service status"""
    service_active: bool = Field(..., description="Whether service is active")
    model_loaded: bool = Field(..., description="Whether model is loaded")
    buffer_status: AudioBufferStatus = Field(..., description="Buffer status")
    last_prediction: Optional[AudioPredictionResponse] = Field(default=None, description="Last prediction if available")


class PurityTestRequest(BaseModel):
    """Request for purity testing with audio"""
    session_id: str = Field(..., description="Session identifier")
    appraisal_id: Optional[str] = Field(default=None, description="Appraisal ID")
    test_type: str = Field(default="rubbing_audio", description="Type of test")
    settings: AudioSettings = Field(default_factory=AudioSettings, description="Audio settings")


class PurityTestResponse(BaseModel):
    """Response from purity test"""
    session_id: str = Field(..., description="Session identifier")
    test_result: str = Field(..., description="Test result: 'PURE' or 'NOT_PURE'")
    audio_prediction: AudioPredictionResponse = Field(..., description="Audio inference result")
    confidence: float = Field(..., description="Overall confidence in result")
    test_duration: float = Field(..., description="Test duration in seconds")
    timestamp: str = Field(..., description="Test timestamp")

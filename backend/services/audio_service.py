"""
Audio Processing Service
Handles audio inference for purity testing using trained WaveCNN1D model
"""

import numpy as np
import torch
import torch.nn as nn
from typing import Dict, Tuple, Optional, List
from collections import deque
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class WaveCNN1D(nn.Module):
    """
    1D CNN Model for raw waveform audio classification
    Processes raw audio samples directly without spectral transformations
    """
    
    def __init__(self, n_classes: int = 2):
        """
        Initialize the WaveCNN1D model
        
        Args:
            n_classes: Number of output classes (default 2: OK/NOK)
        """
        super().__init__()
        self.net = nn.Sequential(
            # First conv block: (1, length) -> (32, length/4)
            nn.Conv1d(1, 32, kernel_size=80, stride=4, padding=40),
            nn.ReLU(),
            nn.MaxPool1d(4),
            
            # Second conv block
            nn.Conv1d(32, 64, kernel_size=5, stride=1, padding=2),
            nn.ReLU(),
            nn.MaxPool1d(4),
            
            # Third conv block
            nn.Conv1d(64, 128, kernel_size=5, stride=1, padding=2),
            nn.ReLU(),
            nn.MaxPool1d(4),
            
            # Fourth conv block
            nn.Conv1d(128, 256, kernel_size=5, stride=1, padding=2),
            nn.ReLU(),
            nn.MaxPool1d(4),
            
            # Global average pooling
            nn.AdaptiveAvgPool1d(1)
        )
        self.fc = nn.Linear(256, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass through the model
        
        Args:
            x: Input tensor of shape (batch, 1, length)
            
        Returns:
            Logits tensor of shape (batch, n_classes)
        """
        z = self.net(x).squeeze(-1)  # (batch, 256)
        return self.fc(z)


class AudioProcessor:
    """
    Audio Processing Service
    Handles real-time audio stream processing and inference for purity testing
    """
    
    def __init__(self, model_path: Optional[str] = None, 
                 sample_rate: int = 16000,
                 window_size: float = 2.0,
                 confidence_threshold: float = 0.75):
        """
        Initialize the AudioProcessor
        
        Args:
            model_path: Path to trained model (.pth file)
            sample_rate: Audio sample rate in Hz
            window_size: Window size for processing in seconds
            confidence_threshold: Confidence threshold for predictions
        """
        self.sample_rate = sample_rate
        self.window_size = window_size
        self.confidence_threshold = confidence_threshold
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Audio buffer for accumulating samples
        self.audio_buffer = deque(maxlen=int(sample_rate * window_size))
        
        # Model initialization
        self.model = None
        self.model_path = model_path
        self.is_model_loaded = False
        
        if model_path and os.path.isfile(model_path):
            self._load_model(model_path)
        else:
            logger.warning(f"Model not found at {model_path}")
    
    def _load_model(self, model_path: str) -> bool:
        """
        Load trained model from disk
        
        Args:
            model_path: Path to model file
            
        Returns:
            True if successful, False otherwise
        """
        try:
            self.model = WaveCNN1D(n_classes=2).to(self.device)
            
            # Load checkpoint with support for both direct state_dict and dict wrapper
            checkpoint = torch.load(model_path, map_location=self.device, weights_only=True)
            state_dict = checkpoint.get('model', checkpoint) if isinstance(checkpoint, dict) else checkpoint
            
            self.model.load_state_dict(state_dict)
            self.model.eval()
            
            self.is_model_loaded = True
            logger.info(f"✅ Audio model loaded successfully from {model_path}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load audio model from {model_path}: {str(e)}")
            self.is_model_loaded = False
            return False
    
    def _normalize_audio(self, audio_data: np.ndarray) -> np.ndarray:
        """
        Normalize audio using peak normalization
        
        Args:
            audio_data: Raw audio samples
            
        Returns:
            Normalized audio data
        """
        max_abs = np.max(np.abs(audio_data)) if np.any(audio_data) else 1.0
        if max_abs > 0:
            return audio_data / max_abs
        return audio_data
    
    def process_audio_chunk(self, audio_chunk: np.ndarray) -> None:
        """
        Add audio chunk to buffer
        
        Args:
            audio_chunk: Raw audio samples (1D array of float32)
        """
        if isinstance(audio_chunk, (list, tuple)):
            audio_chunk = np.array(audio_chunk, dtype=np.float32)
        
        # Ensure float32
        audio_chunk = audio_chunk.astype(np.float32)
        
        # Add to buffer
        self.audio_buffer.extend(audio_chunk)
        
        # Debug log periodically
        if not hasattr(self, '_last_log_time'): self._last_log_time = 0
        import time
        if time.time() - self._last_log_time > 5:
            logger.info(f"🔊 Audio buffer feeding: size={len(self.audio_buffer)}, chunk={len(audio_chunk)}, max={np.max(np.abs(audio_chunk)) if len(audio_chunk) > 0 else 0:.4f}")
            self._last_log_time = time.time()
    
    def infer(self) -> Optional[Dict]:
        """
        Run inference on current buffer
        
        Returns:
            Dictionary with prediction results or None if insufficient data
        """
        if not self.is_model_loaded:
            logger.warning("Model not loaded, cannot run inference")
            return None
        
        if len(self.audio_buffer) < self.sample_rate * 0.5:  # At least 0.5 seconds
            if len(self.audio_buffer) > 0:
                logger.debug(f"🔊 Buffer too small for inference: {len(self.audio_buffer)} < {self.sample_rate * 0.5}")
            return None
        
        try:
            # Prepare audio chunk
            audio_data = np.array(list(self.audio_buffer), dtype=np.float32)
            
            # Normalize
            audio_normalized = self._normalize_audio(audio_data)
            
            # Convert to tensor (1, 1, length)
            x = torch.from_numpy(audio_normalized).unsqueeze(0).unsqueeze(0).to(self.device)
            
            # Run inference
            with torch.no_grad():
                logits = self.model(x)
                probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
            
            # Diagnostic log for every inference
            logger.info(f"🔊 Audio Inference: OK={probs[0]:.4f}, NOK={probs[1]:.4f}")
            
            # Get prediction
            class_idx = np.argmax(probs)
            confidence = float(probs[class_idx])
            class_label = 'OK' if class_idx == 0 else 'NOK'
            
            # Determine if prediction is above threshold
            is_confident = confidence >= self.confidence_threshold
            
            result = {
                'prediction': class_label,
                'confidence': confidence,
                'is_confident': is_confident,
                'ok_prob': float(probs[0]),
                'nok_prob': float(probs[1]),
                'buffer_size': len(self.audio_buffer),
                'duration_seconds': len(self.audio_buffer) / self.sample_rate
            }
            
            return result
        except Exception as e:
            logger.error(f"Inference failed: {str(e)}")
            return None
    
    def reset_buffer(self) -> None:
        """Clear the audio buffer"""
        self.audio_buffer.clear()
    
    def get_buffer_status(self) -> Dict:
        """
        Get current buffer status
        
        Returns:
            Dictionary with buffer information
        """
        return {
            'buffer_size': len(self.audio_buffer),
            'buffer_capacity': self.audio_buffer.maxlen,
            'duration_seconds': len(self.audio_buffer) / self.sample_rate,
            'buffer_percentage': (len(self.audio_buffer) / self.audio_buffer.maxlen * 100) if self.audio_buffer.maxlen else 0,
            'is_model_loaded': self.is_model_loaded
        }
    
    def change_model(self, model_path: str) -> bool:
        """
        Load a different model at runtime
        
        Args:
            model_path: Path to new model file
            
        Returns:
            True if successful, False otherwise
        """
        return self._load_model(model_path)


class AudioStreamAnalyzer:
    """
    Analyzes audio streams for feature extraction and anomaly detection
    """
    
    def __init__(self, sample_rate: int = 16000):
        """
        Initialize the AudioStreamAnalyzer
        
        Args:
            sample_rate: Audio sample rate in Hz
        """
        self.sample_rate = sample_rate
    
    def extract_features(self, audio_data: np.ndarray) -> Dict:
        """
        Extract audio features for analysis
        
        Args:
            audio_data: Audio samples
            
        Returns:
            Dictionary of audio features
        """
        audio_data = np.array(audio_data, dtype=np.float32)
        
        features = {
            'rms': float(np.sqrt(np.mean(audio_data ** 2))),
            'peak': float(np.max(np.abs(audio_data))),
            'dtype': str(audio_data.dtype),
            'length': len(audio_data),
            'mean': float(np.mean(audio_data)),
            'std': float(np.std(audio_data)),
            'zero_crossing_rate': float(self._zero_crossing_rate(audio_data))
        }
        
        return features
    
    @staticmethod
    def _zero_crossing_rate(audio_data: np.ndarray) -> float:
        """Calculate zero crossing rate"""
        zero_crossings = np.sum(np.abs(np.sign(audio_data[:-1]) - np.sign(audio_data[1:])))
        return zero_crossings / max(1, len(audio_data) - 1)
    
    def compute_spectral_features(self, audio_data: np.ndarray) -> Dict:
        """
        Compute spectral features using FFT
        
        Args:
            audio_data: Audio samples
            
        Returns:
            Dictionary of spectral features
        """
        audio_data = np.array(audio_data, dtype=np.float32)
        
        # Apply Hann window
        windowed = audio_data * np.hanning(len(audio_data))
        
        # Compute FFT
        fft = np.abs(np.fft.rfft(windowed))
        freqs = np.fft.rfftfreq(len(audio_data), 1 / self.sample_rate)
        
        # Convert to log scale
        log_fft = np.log1p(fft * 5)
        
        return {
            'fft_max_freq': float(freqs[np.argmax(fft)]) if len(fft) > 0 else 0.0,
            'fft_max_magnitude': float(np.max(log_fft)) if len(log_fft) > 0 else 0.0,
            'fft_mean_magnitude': float(np.mean(log_fft)) if len(log_fft) > 0 else 0.0
        }


# Global audio processor instance
_audio_processor: Optional[AudioProcessor] = None
_audio_analyzer: Optional[AudioStreamAnalyzer] = None


def initialize_audio_service(model_path: Optional[str] = None) -> AudioProcessor:
    """
    Initialize the global audio service
    
    Args:
        model_path: Path to trained model
        
    Returns:
        AudioProcessor instance
    """
    global _audio_processor, _audio_analyzer
    
    _audio_processor = AudioProcessor(model_path=model_path)
    _audio_analyzer = AudioStreamAnalyzer()
    
    logger.info("🎵 Audio service initialized")
    return _audio_processor


def get_audio_processor() -> Optional[AudioProcessor]:
    """Get the global audio processor instance"""
    global _audio_processor
    
    if _audio_processor is None:
        logger.warning("Audio processor not initialized. Call initialize_audio_service() first.")
    
    return _audio_processor


def get_audio_analyzer() -> Optional[AudioStreamAnalyzer]:
    """Get the global audio analyzer instance"""
    global _audio_analyzer
    
    if _audio_analyzer is None:
        _audio_analyzer = AudioStreamAnalyzer()
    
    return _audio_analyzer

"""
Audio Inference Worker - Real-time rubbing sound detection
Processes audio chunks using 1D CNN waveform model
"""

import numpy as np
import torch
import torch.nn as nn
import logging
from typing import Tuple
from collections import deque
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WaveCNN1D(nn.Module):
    """
    1D CNN model for waveform-based audio classification.
    Detects rubbing sounds (NOK) vs normal sounds (OK).
    """
    def __init__(self, n_classes=2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(1,    32, kernel_size=80, stride=4, padding=40), 
            nn.ReLU(), 
            nn.MaxPool1d(4),
            nn.Conv1d(32,   64, kernel_size=5,  stride=1, padding=2),  
            nn.ReLU(), 
            nn.MaxPool1d(4),
            nn.Conv1d(64,  128, kernel_size=5,  stride=1, padding=2),  
            nn.ReLU(), 
            nn.MaxPool1d(4),
            nn.Conv1d(128, 256, kernel_size=5,  stride=1, padding=2),  
            nn.ReLU(), 
            nn.MaxPool1d(4),
            nn.AdaptiveAvgPool1d(1)
        )
        self.fc = nn.Linear(256, n_classes)

    def forward(self, x):
        """
        Forward pass
        Args:
            x: (batch, 1, length) tensor
        Returns:
            (batch, n_classes) logits
        """
        z = self.net(x).squeeze(-1)  # → (batch, 256)
        return self.fc(z)


class AudioInferenceWorker:
    """
    Real-time audio inference worker for rubbing sound detection.
    
    Features:
    - Sliding window approach (2s window, 1s hop)
    - Peak normalization for robustness
    - Confidence-based prediction
    - Buffer management for streaming audio
    """
    
    def __init__(self, 
                 model_path: str = None,
                 sample_rate: int = 16000, 
                 window_seconds: float = 2.0, 
                 hop_ratio: float = 0.1, 
                 confidence_threshold: float = 0.75):
        """
        Initialize audio inference worker.
        
        Args:
            model_path: Path to trained model (.pth file)
            sample_rate: Audio sample rate (Hz)
            window_seconds: Inference window size (seconds)
            hop_ratio: Hop size as fraction of window (0.5 = 50% overlap)
            confidence_threshold: Minimum confidence for prediction
        """
        self.sample_rate = sample_rate
        self.window_sec = window_seconds
        self.hop_ratio = hop_ratio
        self.confidence_threshold = confidence_threshold

        # Setup device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Load model
        self.model_path = model_path or self._get_default_model_path()
        self.model = self._load_model()
        self.model.to(self.device)
        self.model.eval()

        # Calculate window and hop sizes in samples
        self.win_samples = max(8000, int(sample_rate * window_seconds))
        self.hop_samples = int(self.win_samples * hop_ratio)

        # Audio buffer - fixed size numpy array for efficiency
        # We store up to 30 seconds of audio to be safe, but only use win_samples
        self.buffer_size = sample_rate * 30 
        self._buffer = np.zeros(self.buffer_size, dtype=np.float32)
        self._write_ptr = 0
        self._samples_accumulated = 0
        
        # Statistics
        self.inference_count = 0
        self.last_prediction = "WAIT"
        self.last_confidence = 0.0
        
        logger.info(f"🎤 AudioInferenceWorker initialized (Numpy Buffer)")
        logger.info(f"   Device: {self.device}")
        logger.info(f"   Model: {self.model_path}")
        logger.info(f"   Window: {window_seconds}s, Hop: {hop_ratio} ({self.hop_samples} samples)")
        logger.info(f"   Confidence threshold: {confidence_threshold}")

    def _get_default_model_path(self) -> str:
        """Get default model path from environment or hardcoded fallback"""
        # Try environment variable first
        env_path = os.getenv("AUDIO_MODEL_PATH")
        if env_path and os.path.exists(env_path):
            return env_path
        
        # Fallback to hardcoded path
        default_path = r"E:\Intern\amptocsv\amptocsv\shibu mic sound\models\mic_waveform_cnn2.pth"
        if os.path.exists(default_path):
            return default_path
        
        raise FileNotFoundError(
            f"Audio model not found. Please set AUDIO_MODEL_PATH environment variable "
            f"or place model at: {default_path}"
        )

    def _load_model(self) -> nn.Module:
        """Load trained model from disk"""
        try:
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found: {self.model_path}")
            
            state_dict = torch.load(self.model_path, map_location=self.device, weights_only=True)
            
            # Handle different save formats
            if isinstance(state_dict, dict) and 'model' in state_dict:
                state_dict = state_dict['model']
            
            model = WaveCNN1D(n_classes=2)
            model.load_state_dict(state_dict)
            
            logger.info(f"✅ Audio model loaded from {self.model_path}")
            return model
            
        except Exception as e:
            logger.error(f"❌ Failed to load audio model: {e}")
            raise RuntimeError(f"Cannot load audio model from {self.model_path}: {e}")

    def process_chunk(self, chunk: np.ndarray) -> Tuple[str, float]:
        """
        Process an audio chunk and return prediction.
        
        Args:
            chunk: Audio samples (np.float32 1D array)
        """
        n_samples = len(chunk)
        if n_samples == 0:
            return "WAIT", 0.0

        # Efficient circular write
        if self._write_ptr + n_samples <= self.buffer_size:
            self._buffer[self._write_ptr : self._write_ptr + n_samples] = chunk
            self._write_ptr += n_samples
        else:
            # Handle wrap around
            space_left = self.buffer_size - self._write_ptr
            self._buffer[self._write_ptr:] = chunk[:space_left]
            self._buffer[: n_samples - space_left] = chunk[space_left:]
            self._write_ptr = n_samples - space_left

        self._samples_accumulated += n_samples

        # Check if we have enough samples for inference
        if self._samples_accumulated >= self.win_samples:
            # Extract the last win_samples from the circular buffer
            if self._write_ptr >= self.win_samples:
                x = self._buffer[self._write_ptr - self.win_samples : self._write_ptr].copy()
            else:
                # Window wraps around end of buffer
                part2 = self._buffer[0 : self._write_ptr]
                part1 = self._buffer[self.buffer_size - (self.win_samples - self._write_ptr) :]
                x = np.concatenate([part1, part2])

            # Mean-std normalization (consistent with original prediction.py)
            mean = np.mean(x)
            std = np.std(x)
            x = (x - mean) / (std + 1e-6)

            # Convert to tensor: (1, 1, length)
            t = torch.from_numpy(x.astype(np.float32)).unsqueeze(0).unsqueeze(0).to(self.device)

            # Run inference
            with torch.no_grad():
                logits = self.model(t)
                probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

            # Get prediction
            idx = np.argmax(probs)
            conf = float(probs[idx])
            label = "OK" if idx == 0 else "NOT OK"
            
            # Update statistics
            self.inference_count += 1
            self.last_prediction = label
            self.last_confidence = conf
            
            # Advance logical window by reducing accumulation count by hop_samples
            # This ensures we run inference every hop_samples
            self._samples_accumulated -= self.hop_samples
            
            return label, conf

        # Not enough data yet
        return "WAIT", 0.0

    def reset(self):
        """Reset audio buffer and state"""
        self._buffer.fill(0)
        self._write_ptr = 0
        self._samples_accumulated = 0
        self.last_prediction = "WAIT"
        self.last_confidence = 0.0
        logger.info("🔄 Audio buffer reset")

    def get_status(self) -> dict:
        """Get worker status for monitoring"""
        return {
            "device": str(self.device),
            "model_path": self.model_path,
            "sample_rate": self.sample_rate,
            "window_seconds": self.window_sec,
            "hop_ratio": self.hop_ratio,
            "confidence_threshold": self.confidence_threshold,
            "buffer_size": self.buffer_size,
            "samples_accumulated": self._samples_accumulated,
            "inference_count": self.inference_count,
            "last_prediction": self.last_prediction,
            "last_confidence": self.last_confidence
        }


# Global singleton instance (initialized in main.py lifespan)
_audio_worker = None


def init_audio_worker(model_path: str = None, **kwargs) -> AudioInferenceWorker:
    """Initialize global audio worker instance"""
    global _audio_worker
    _audio_worker = AudioInferenceWorker(model_path=model_path, **kwargs)
    return _audio_worker


def get_audio_worker() -> AudioInferenceWorker:
    """Get global audio worker instance"""
    if _audio_worker is None:
        raise RuntimeError("Audio worker not initialized. Call init_audio_worker() first.")
    return _audio_worker

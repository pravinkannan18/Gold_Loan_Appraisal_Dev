"""
WebRTC Audio Processor
Receives audio frames via WebRTC, processes through inference, sends results via data channel
"""
import asyncio
import json
import logging
import numpy as np
from typing import Any, Optional

try:
    from aiortc import MediaStreamTrack
    import av
    AIORTC_AVAILABLE = True
except ImportError:
    AIORTC_AVAILABLE = False
    # Create dummy classes for import
    class MediaStreamTrack:
        pass

from inference.audio_inference_worker import get_audio_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AudioAnalysisTrack(MediaStreamTrack):
    """
    A MediaStreamTrack that intercepts audio frames,
    resamples them to 16kHz mono, and sends to inference worker.
    
    Results are sent back to client via data channel.
    """
    kind = "audio"

    def __init__(self, track: MediaStreamTrack, session: Any):
        """
        Initialize audio analysis track.
        
        Args:
            track: Incoming audio track from client
            session: WebRTC session for state management
        """
        super().__init__()
        self.track = track
        self.session = session
        
        # Get audio worker
        try:
            self.audio_worker = get_audio_worker()
        except RuntimeError as e:
            logger.error(f"❌ Audio worker not initialized: {e}")
            self.audio_worker = None
        
        # Resample to 16kHz mono float32 for the model
        self.resampler = av.AudioResampler(format='flt', layout='mono', rate=16000)
        
        # Frame counter
        self.frame_count = 0
        self.last_inference_time = 0
        
        logger.info("🎤 AudioAnalysisTrack initialized")

    async def recv(self):
        """
        Receive audio frame, process it, and pass through.
        
        Returns:
            The original audio frame (passthrough)
        """
        try:
            frame = await self.track.recv()
        except Exception:
            # Track ended
            self.stop()
            raise

        # Process audio for inference
        await self._process_frame(frame)

        # Return original frame (passthrough - don't modify audio)
        return frame

    async def _process_frame(self, frame):
        """Process audio frame through inference worker"""
        if self.audio_worker is None:
            return
        
        self.frame_count += 1
        
        try:
            # Resample audio frame
            # frame is av.AudioFrame
            out_frames = self.resampler.resample(frame)
            
            for out_frame in out_frames:
                # Convert to numpy
                # to_ndarray returns (channels, samples), so (1, N) for mono
                chunk = out_frame.to_ndarray()[0]  # Extract mono channel
                
                # Calculate RMS (volume) for instantaneous silence detection
                rms = np.sqrt(np.mean(chunk**2))
                
                # Feed to worker in a separate thread to avoid blocking event loop
                label, conf = await asyncio.to_thread(self.audio_worker.process_chunk, chunk)
                
                if self.frame_count % 100 == 0:
                    logger.info(f"🎤 Received and processed 100 audio frames (Total: {self.frame_count})")
                
                # INSTANT RESET: If volume is very low, override ML result and clear status
                # Threshold of 0.005 is a safe "silence" level for normalized float32 audio
                if rms < 0.005:
                    if self.session.detection_status.get('sound_detected'):
                        self.session.detection_status['sound_detected'] = False
                        self.session.detection_status['sound_status'] = "Waiting"
                elif label != "WAIT":
                    # Update session state
                    self._update_audio_state(label, conf)
                    
                    # Send result via DataChannel
                    self._send_audio_result(label, conf)
                    
                    # Log periodically (every 10 inferences)
                    if self.audio_worker.inference_count % 10 == 0:
                        logger.info(f"🎤 Audio Inference Result: {label} (conf={conf:.3f})")
        
        except Exception as e:
            logger.error(f"❌ Error processing audio frame: {e}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")

    def _update_audio_state(self, label: str, confidence: float):
        """Update session with audio detection result"""
        if not hasattr(self.session, 'detection_status'):
            return
        
        # Update sound status
        self.session.detection_status['sound_status'] = label
        self.session.detection_status['sound_confidence'] = float(confidence)
        
        # NOT OK means rubbing sound detected (this is what we want to hear during rubbing)
        if label == "NOT OK":
            self.session.detection_status['sound_detected'] = True
        else:
            self.session.detection_status['sound_detected'] = False

    def _send_audio_result(self, label: str, confidence: float):
        """Send audio detection result via data channel"""
        if not hasattr(self.session, 'status_channel') or not self.session.status_channel:
            return
        
        try:
            # Check if data channel is open
            if self.session.status_channel.readyState != 'open':
                return
            
            msg = json.dumps({
                "type": "audio",
                "label": label,
                "confidence": float(confidence)
            })
            self.session.status_channel.send(msg)
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to send audio result via data channel: {e}")

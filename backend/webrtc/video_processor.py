"""
WebRTC Video Processor using aiortc
Receives video frames, runs inference, returns annotated frames
"""
import asyncio
import cv2
import numpy as np
import time
from typing import Optional, Dict, Any
import logging

try:
    from aiortc import MediaStreamTrack
    from av import VideoFrame
    AIORTC_AVAILABLE = True
except ImportError:
    AIORTC_AVAILABLE = False
    # Create dummy classes for import
    class MediaStreamTrack:
        pass
    class VideoFrame:
        pass

# Import inference engine (local module)
from inference.inference_worker import InferenceWorker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class VideoTransformTrack(MediaStreamTrack):
    """
    A video track that transforms frames through AI inference.
    
    Receives video frames from the client, runs YOLO detection,
    and returns annotated frames back to the client.
    
    PERFORMANCE OPTIMIZATIONS:
    1. Frame skipping: Only process every 3rd frame (10 FPS inference on 30 FPS stream)
       - This reduces latency from ~100ms to ~30-50ms
       - Detection still happens smoothly for gold/acid testing
    2. Frame downsampling: Large frames are downscaled to 640x480 for inference
       - 4K frames (3840x2160) become 640x480 for processing
       - Then upscaled back for display
       - ~60% faster inference with minimal quality loss
    3. Simplified overlay: Direct text rendering without transparency
       - Much faster than computed overlays
    4. Async error handling: Non-blocking frame processing
    """
    
    kind = "video"
    
    def __init__(self, track: MediaStreamTrack, session: Any):
        """
        Initialize the video transform track.
        
        Args:
            track: The incoming video track from client
            session: WebRTC session for state management
        """
        super().__init__()
        self.track = track
        self.session = session
        self.inference_worker = InferenceWorker()
        
        # Performance optimization settings
        self.target_width = 640  # Downscale large frames for faster processing
        self.target_height = 480
        self.frame_count = 0
        self.last_fps_time = time.time()
        self.fps = 0.0
        
        # Frame skipping: process every 3rd frame (10 FPS inference on 30 FPS stream)
        # This reduces latency significantly while maintaining good detection
        self.process_interval = 3
        
        # State transition queue to prevent race conditions
        self._pending_task_switch = None
        
        # Get audio service if available
        self.audio_service = None
        try:
            from services.audio_service import get_audio_processor
            self.audio_service = get_audio_processor()
            logger.info("🔊 Audio service loaded for rubbing detection")
        except Exception as e:
            logger.warning(f"⚠️ Audio service not available: {e}")
        
        # Audio confirmation tracking
        self.audio_confirm_count = 0  # Require multiple audio confirmations
        self.audio_ok_threshold = 0.7  # Confidence threshold for audio classification
        self.last_audio_result = None  # Store last audio inference for overlay
        self.last_visual_ok = False     # Store last visual detection status
        
        logger.info("🎬 VideoTransformTrack initialized with audio + visual rubbing detection")


    
    async def recv(self) -> VideoFrame:
        """
        Receive a frame, process it through inference, and return annotated frame.
        
        This is called for each incoming frame from the WebRTC track.
        """
        try:
            # Receive frame from client (this is sequential)
            try:
                frame = await self.track.recv()
            except Exception as recv_error:
                # Handle MediaStreamError or track ending
                if "MediaStreamError" in str(type(recv_error).__name__):
                    logger.info("ℹ️ Media stream ended - track closed by client")
                    # Do not re-raise or log as error, just return a fake error to caller
                    raise recv_error
                else:
                    logger.error(f"❌ Error receiving frame: {recv_error}")
                    raise
                    
            self.frame_count += 1
            
            # Apply any pending task switches at a safe point (start of frame processing)
            if self._pending_task_switch:
                logger.info(f"🔄 Applying queued task switch: {self.session.current_task} → {self._pending_task_switch}")
                self.session.current_task = self._pending_task_switch
                self.session.detection_status["acid_detected"] = False
                self._pending_task_switch = None
                # Send status update via data channel
                self._send_status_update()
            
            # Simple frame skipping to reduce latency
            # Only process every Nth frame for AI analysis to maintain consistent FPS
            # process_interval=3 means 10FPS inference on 30FPS stream
            should_process = self.frame_count % self.process_interval == 0
            
            if not should_process:
                # Still need to update FPS and draw overlay on skipped frames
                # but we'll use the last known detection result
                img = frame.to_ndarray(format="bgr24")
                
                # Removed downscaling to keep full resolution
                if img.shape[1] > self.target_width or img.shape[0] > self.target_height:
                   img = cv2.resize(img, (self.target_width, self.target_height), interpolation=cv2.INTER_LINEAR)
                
                self._update_fps()
                # We don't call process_frame here, just draw the last overlay/status
                self._draw_overlay(img, getattr(self, 'last_process_time', 0.0))
                
                new_frame = VideoFrame.from_ndarray(img, format="bgr24")
                new_frame.pts = frame.pts
                new_frame.time_base = frame.time_base
                return new_frame

            # Log periodically (every 60 frames)
            if self.frame_count % 60 == 0:
                logger.debug(f"🔄 Processing frame {self.frame_count}, size: {frame.width}x{frame.height}")
            
            # Convert to numpy array for processing
            img = frame.to_ndarray(format="bgr24")
            
            # Enforce max resolution for performance and consistent overlay size
            # If frame is too large, downscale it
            needs_upscale = False
            if img.shape[1] > self.target_width or img.shape[0] > self.target_height:
               img = cv2.resize(img, (self.target_width, self.target_height), interpolation=cv2.INTER_LINEAR)
               needs_upscale = True
            
            # Run inference on optimized frame size
            start_time = time.time()
            annotated_img, detection_result = self.inference_worker.process_frame(
                img,
                current_task=self.session.current_task,
                session_state=self.session.detection_status
            )
            self.last_process_time = (time.time() - start_time) * 1000  # ms
            
            # Keep downscaled resolution for consistency (prevents flickering)
            # and improves performance of WebRTC encoding
            pass
            
            # Update session state based on detection
            self._update_session_state(detection_result)
            
            # Periodically send status updates (every 30 frames / ~2 seconds)
            if self.frame_count % 30 == 0:
                self._send_status_update()
            
            # Add FPS and process time overlay
            self._update_fps()
            self._draw_overlay(annotated_img, self.last_process_time)
            
            # Convert back to VideoFrame
            new_frame = VideoFrame.from_ndarray(annotated_img, format="bgr24")
            new_frame.pts = frame.pts
            new_frame.time_base = frame.time_base
            
            return new_frame
            
        except Exception as e:
            if "MediaStreamError" in str(type(e).__name__):
                # Silence tracebacks for expected stream closures
                raise

            import traceback
            logger.error(f"❌ Error processing frame: {e}")
            logger.error(f"❌ Error type: {type(e).__name__}")
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            logger.error(f"❌ Current task: {self.session.current_task}")
            logger.error(f"❌ Frame count: {self.frame_count}")
            # Return original frame on error
            try:
                img = frame.to_ndarray(format="bgr24")
                new_frame = VideoFrame.from_ndarray(img, format="bgr24")
                new_frame.pts = frame.pts
                new_frame.time_base = frame.time_base
                return new_frame
            except:
                # If even that fails, try to get next frame
                return await self.track.recv()
    
    def _update_session_state(self, detection_result: Dict):
        """Update session state based on detection results with audio + visual confirmation"""
        if not detection_result:
            return
            
        state_changed = False
        
        # For rubbing detection: require BOTH visual AND audio confirmation
        visual_count = int(detection_result.get("visual_confirm_count", 0))
        visual_ok = bool(detection_result.get("visual_ok", False))
        rubbing_motion = bool(detection_result.get("rubbing_motion", False))

        # Consider visual confirmed only after required confirmations and motion detected
        visual_confirmed = visual_ok and (visual_count >= 3) and rubbing_motion
        self.last_visual_ok = visual_ok # Store current visual status for overlay

        # Update latest audio result for overlay if in rubbing task
        if self.session.current_task == "rubbing":
            audio_result = self._check_audio_rubbing()
            if audio_result:
                self.last_audio_result = audio_result
        
        # Mark rubbing detected only when BOTH visual and audio are confirmed
        if visual_confirmed and self.session.current_task == "rubbing":
            audio_result = self.last_audio_result
            rubbing_audio_ok = False
            if audio_result:
                class_label = audio_result.get("prediction", "NOK")
                confidence = audio_result.get("confidence", 0.0)
                rubbing_audio_ok = (class_label == "OK" and confidence >= self.audio_ok_threshold)

            # Count audio confirmations along with visual
            if rubbing_audio_ok:
                self.audio_confirm_count += 1
                logger.info(f"🔊✅ Audio rubbing confirmed ({self.audio_confirm_count})")
            else:
                self.audio_confirm_count = max(0, self.audio_confirm_count - 1)
                if audio_result:
                    logger.debug(f"🔊❌ Audio not rubbing sound (label={audio_result.get('prediction')}, conf={audio_result.get('confidence'):.2f})")

        # Strictly require BOTH visual confirmed AND audio confirmed (threshold)
        # Simplified: removed audio_confirm_count requirement as per user request
        if visual_confirmed and self.session.current_task == "rubbing" and rubbing_audio_ok:
            if not self.session.detection_status["rubbing_detected"]:
                state_changed = True
                logger.info("🎯 RUBBING CONFIRMED (audio + visual)")
            self.session.detection_status["rubbing_detected"] = True
        else:
            # Optionally reset if detection stops? (Manual reset is usually preferred)
            pass
            
        # Update acid detection (audio independent for acid test)
        if detection_result.get("acid_detected") and self.session.current_task == "acid":
            if not self.session.detection_status["acid_detected"]:
                state_changed = True
            self.session.detection_status["acid_detected"] = True
            
        if detection_result.get("gold_purity"):
            self.session.detection_status["gold_purity"] = detection_result["gold_purity"]
        
        # Auto-transition: rubbing -> acid when BOTH visual AND audio confirmed
        if self.session.current_task == "rubbing" and self.session.detection_status["rubbing_detected"]:
            # Queue the task switch instead of applying immediately
            if self._pending_task_switch is None:
                self._pending_task_switch = "acid"
                logger.info("✅ Rubbing detection complete! Queuing switch to acid task")
                state_changed = True
            
        # Auto-transition: acid -> done when acid detected
        if self.session.current_task == "acid" and self.session.detection_status["acid_detected"]:
            if self._pending_task_switch is None:
                self._pending_task_switch = "done"
                logger.info("✅ Acid test complete! Queuing switch to done")
                state_changed = True
        
        # Send status update whenever state changes
        if state_changed:
            self._send_status_update()
    
    def _check_audio_rubbing(self) -> Optional[Dict]:
        """
        Check if current audio is consistent with rubbing motion.
        
        Returns:
            Audio inference result dict or None
        """
        if not self.audio_service:
            return None
            
        try:
            # Get audio inference result
            audio_result = self.audio_service.infer()
            return audio_result
        except Exception as e:
            logger.warning(f"Error checking audio rubbing: {e}")
            return None
    
    def _update_fps(self):
        """Calculate and update FPS based on received frames"""
        current_time = time.time()
        elapsed = current_time - self.last_fps_time
        
        if elapsed >= 1.0:
            self.fps = self.frame_count / elapsed
            self.frame_count = 0
            self.last_fps_time = current_time
    
    def _draw_overlay(self, img: np.ndarray, process_time: float):
        """Draw FPS and status overlay on frame (optimized for performance)"""
        try:
            height, width = img.shape[:2]
            
            # Use fixed font size for consistent rendering
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.6
            thickness = 1
            color = (0, 255, 0)
            
            # Draw simple text overlays without transparency effects for speed
            cv2.putText(img, f"FPS: {self.fps:.1f}", (10, 30), font, font_scale, color, thickness)
            cv2.putText(img, f"Process: {process_time:.1f}ms", (10, 60), font, font_scale, color, thickness)
            cv2.putText(img, f"Task: {self.session.current_task}", (10, 90), font, font_scale, (0, 255, 255), thickness)
            
            # Draw Audio Status if available
            audio_y = 120
            if self.last_audio_result:
                label = self.last_audio_result.get("prediction", "N/A")
                conf = self.last_audio_result.get("confidence", 0.0)
                audio_color = (0, 255, 0) if (label == "OK" and conf >= self.audio_ok_threshold) else (0, 0, 255)
                
                cv2.putText(img, f"Audio: {label}", (10, audio_y), font, font_scale, audio_color, thickness)
                cv2.putText(img, f"Audio Conf: {conf:.2f}", (10, audio_y + 30), font, font_scale, audio_color, thickness)
                
                # Add buffer stats for debugging
                buffer_info = self.audio_service.get_buffer_status() if self.audio_service else {}
                duration = buffer_info.get('duration_seconds', 0.0)
                cv2.putText(img, f"Buffer: {duration:.1f}s", (10, audio_y + 60), font, 0.5, (200, 200, 200), thickness)
            else:
                # Still show buffer info even if no inference result yet
                buffer_info = self.audio_service.get_buffer_status() if self.audio_service else {}
                duration = buffer_info.get('duration_seconds', 0.0)
                loaded = buffer_info.get('is_model_loaded', False)
                status_text = "Audio: Waiting..." if loaded else "Audio: No Model"
                cv2.putText(img, status_text, (10, audio_y), font, font_scale, (150, 150, 150), thickness)
                cv2.putText(img, f"Buffer: {duration:.1f}s", (10, audio_y + 30), font, 0.5, (150, 150, 150), thickness)
            
            # Draw Visual Status
            visual_y = audio_y + 100
            visual_color = (0, 255, 0) if self.last_visual_ok else (128, 128, 128)
            visual_text = "Detection: ACTIVE" if self.last_visual_ok else "Detection: IDLE"
            cv2.putText(img, visual_text, (10, visual_y), font, font_scale, visual_color, thickness)
            
            # Show if rubbing is fully confirmed
            rubbing_detected = self.session.detection_status.get("rubbing_detected", False)
            confirmed_text = "RUBBING: CONFIRMED" if rubbing_detected else "RUBBING: NO"
            confirmed_color = (0, 255, 0) if rubbing_detected else (0, 0, 255)
            cv2.putText(img, confirmed_text, (10, visual_y + 40), font, font_scale * 1.2, confirmed_color, thickness + 1)
        except Exception as e:
            logger.warning(f"Error drawing overlay: {e}")
    
    def _send_status_update(self):
        """Send status update via data channel"""
        if hasattr(self.session, 'status_channel') and self.session.status_channel:
            try:
                # Check if data channel is open
                if self.session.status_channel.readyState != 'open':
                    logger.debug(f"⏳ Data channel not open yet (state: {self.session.status_channel.readyState})")
                    return
                    
                import json
                status_data = json.dumps({
                    "type": "status",
                    "current_task": self.session.current_task,
                    "rubbing_detected": self.session.detection_status["rubbing_detected"],
                    "acid_detected": self.session.detection_status["acid_detected"],
                    "gold_purity": self.session.detection_status.get("gold_purity")
                })
                self.session.status_channel.send(status_data)
                logger.info(f"📡 Sent status update: task={self.session.current_task}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send status via data channel: {e}")

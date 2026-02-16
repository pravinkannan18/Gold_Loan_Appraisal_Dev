"""
WebRTC Signaling and Session Management
Handles SDP offer/answer exchange, ICE candidates, and peer connection lifecycle

NOTE: aiortc requires PyAV which needs C++ build tools on Windows.
When aiortc is not available, this module provides a WebSocket-based fallback.
"""
import asyncio
import json
import uuid
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import logging
import numpy as np
import av

# Try to import aiortc
try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
    from aiortc.contrib.media import MediaRelay
    AIORTC_AVAILABLE = True
except ImportError:
    AIORTC_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class WebRTCSession:
    """Represents a WebRTC peer connection session"""
    session_id: str
    peer_connection: Any = None  # RTCPeerConnection when available
    created_at: datetime = field(default_factory=datetime.now)
    video_track: Optional[Any] = None
    inference_enabled: bool = True
    current_task: str = "rubbing"  # rubbing, acid, done
    detection_status: Dict = field(default_factory=lambda: {
        "rubbing_detected": False,
        "acid_detected": False,
        "gold_purity": None
    })
    # For WebSocket fallback mode
    websocket: Any = None
    is_websocket_mode: bool = False
    # For WebRTC data channel status updates
    status_channel: Any = None


class WebRTCManager:
    """
    Manages WebRTC sessions and signaling.
    
    When aiortc is available:
    - Full WebRTC support with video track processing
    
    When aiortc is NOT available (fallback mode):
    - Uses WebSocket for frame transfer
    - Frontend sends frames, backend processes and returns annotated frames
    """
    
    def __init__(self):
        self.sessions: Dict[str, WebRTCSession] = {}
        self.relay = None
        self.initialized = False
        
    def initialize(self):
        """Initialize the WebRTC manager and inference models"""
        if AIORTC_AVAILABLE:
            try:
                self.relay = MediaRelay()
                self.initialized = True
                logger.info("✅ WebRTC Manager initialized with aiortc and MediaRelay")
            except Exception as e:
                logger.error(f"❌ Failed to initialize MediaRelay: {e}")
                self.initialized = True  # Still mark as initialized for fallback mode
        else:
            self.initialized = True
            logger.info("✅ WebRTC Manager initialized in WebSocket fallback mode")
        
        self.initialized = True
    
    def is_available(self) -> bool:
        """Check if WebRTC/WebSocket is available and initialized"""
        return self.initialized
    
    def is_webrtc_available(self) -> bool:
        """Check if full WebRTC (aiortc) is available"""
        return AIORTC_AVAILABLE and self.initialized
    
    async def create_session(self, offer_sdp: str = None, offer_type: str = "offer") -> Dict:
        """
        Create a new session.
        
        For WebRTC mode: processes SDP offer and returns answer
        For WebSocket mode: just creates a session ID
        """
        session_id = str(uuid.uuid4())[:8]
        
        if AIORTC_AVAILABLE and offer_sdp:
            return await self._create_webrtc_session(session_id, offer_sdp, offer_type)
        else:
            return self._create_websocket_session(session_id)
    
    def _create_websocket_session(self, session_id: str) -> Dict:
        """Create a WebSocket-based session (fallback mode)"""
        session = WebRTCSession(
            session_id=session_id,
            is_websocket_mode=True
        )
        self.sessions[session_id] = session
        logger.info(f"✅ Created WebSocket session: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "mode": "websocket",
            "message": "WebSocket mode - use /api/webrtc/ws/{session_id} for frame streaming"
        }
    
    async def _create_webrtc_session(self, session_id: str, offer_sdp: str, offer_type: str) -> Dict:
        """Create a full WebRTC session with aiortc"""
        try:
            # Import video processor with better error handling
            try:
                from .video_processor import VideoTransformTrack
            except ImportError as import_error:
                logger.error(f"❌ Failed to import VideoTransformTrack: {import_error}")
                logger.error(f"   Make sure inference module __init__.py exists")
                raise
            
            pc = RTCPeerConnection()
            session = WebRTCSession(
                session_id=session_id,
                peer_connection=pc,
                is_websocket_mode=False
            )
            
            # Listen for data channel from CLIENT (standard WebRTC pattern)
            @pc.on("datachannel")
            def on_datachannel(channel):
                logger.info(f"📡 Received data channel from client: {channel.label}")
                session.status_channel = channel
                
                @channel.on("open")
                def on_channel_open():
                    logger.info("📡✅ Status data channel OPENED - ready to send")
                    # Send initial status when channel opens
                    try:
                        import json
                        initial_status = json.dumps({
                            "type": "status",
                            "current_task": session.current_task,
                            "rubbing_detected": session.detection_status["rubbing_detected"],
                            "acid_detected": session.detection_status["acid_detected"],
                            "gold_purity": session.detection_status.get("gold_purity")
                        })
                        channel.send(initial_status)
                        logger.info("📡 Sent initial status via data channel")
                    except Exception as e:
                        logger.error(f"❌ Failed to send initial status: {e}")
                
                @channel.on("message")
                def on_message(message):
                    logger.info(f"📡 Received message from client: {message}")
            
            # Store the transform track to be created when we receive the client track
            transform_track = None
            
            @pc.on("track")
            def on_track(track):
                nonlocal transform_track
                logger.info(f"📹 Received track: {track.kind}")
                if track.kind == "video":
                    # Create transform track from incoming video
                    # If relay is not available, use track directly
                    subscribed_track = self.relay.subscribe(track) if self.relay else track
                    transform_track = VideoTransformTrack(
                        track=subscribed_track,
                        session=session
                    )
                    session.video_track = transform_track
                    # Add the processed track to send back to client
                    pc.addTrack(transform_track)
                    logger.info(f"📹 Added transform track to peer connection")
                elif track.kind == "audio":
                    # Spawn background task to consume audio frames and feed audio service
                    logger.info("🔊 Received audio track - starting consumer")
                    try:
                        # Use raw track for audio to avoid potential relay ingestion delays/issues
                        audio_consumer_task = asyncio.create_task(self._consume_audio(track, session))
                        # store task on session to cancel on cleanup if needed
                        session.audio_task = audio_consumer_task
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to start audio consumer: {e}")
            
            @pc.on("connectionstatechange")
            async def on_connectionstatechange():
                logger.info(f"🔗 Connection state: {pc.connectionState}")
                if pc.connectionState in ("failed", "closed"):
                    await self.close_session(session_id)
            
            # Set remote description (this triggers on_track for incoming tracks)
            offer = RTCSessionDescription(sdp=offer_sdp, type=offer_type)
            await pc.setRemoteDescription(offer)
            
            # Create answer - this includes any tracks we've added
            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            
            self.sessions[session_id] = session
            logger.info(f"✅ Created WebRTC session: {session_id}")
            
            return {
                "success": True,
                "session_id": session_id,
                "mode": "webrtc",
                "answer": {
                    "sdp": pc.localDescription.sdp,
                    "type": pc.localDescription.type
                }
            }
        except Exception as e:
            logger.error(f"❌ Failed to create WebRTC session: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e), "success": False}
    
    async def add_ice_candidate(self, session_id: str, candidate: Dict) -> Dict:
        """Add ICE candidate (WebRTC mode only)"""
        if not AIORTC_AVAILABLE:
            return {"success": True, "message": "ICE not needed in WebSocket mode"}
        
        session = self.sessions.get(session_id)
        if not session or not session.peer_connection:
            return {"error": "Session not found", "success": False}
        
        try:
            ice = RTCIceCandidate(
                candidate=candidate.get("candidate"),
                sdpMid=candidate.get("sdpMid"),
                sdpMLineIndex=candidate.get("sdpMLineIndex")
            )
            await session.peer_connection.addIceCandidate(ice)
            return {"success": True}
        except Exception as e:
            return {"error": str(e), "success": False}

    async def _consume_audio(self, track, session: WebRTCSession):
        """Consume audio frames from an aiortc audio track and feed to audio service."""
        try:
            # Resample to 16kHz mono float32 for the model (matching user's working backend.py)
            resampler = av.AudioResampler(format='flt', layout='mono', rate=16000)
            
            # Try to import audio service getter
            try:
                # Use absolute import to ensure singleton consistency
                from services.audio_service import get_audio_processor
                audio_processor = get_audio_processor()
                if audio_processor:
                    logger.info("🔊 Audio processor retrieved successfully in consumer task")
                else:
                    logger.warning("🔊 Audio processor NOT INITIALIZED in consumer task")
            except Exception as e:
                logger.warning(f"🔊 Failed to get audio processor: {e}")
                audio_processor = None

            while True:
                try:
                    frame = await track.recv()
                    # Log metadata once per session
                    if not hasattr(self, '_audio_meta_logged'):
                        logger.info(f"🔊 Audio Track Meta: rate={frame.sample_rate}, format={frame.format}, channels={len(frame.layout.channels)}")
                        self._audio_meta_logged = True
                        
                    # Heartbeat log every 100 frames (~2 seconds of audio)
                    if not hasattr(self, '_audio_frame_count'): self._audio_frame_count = 0
                    self._audio_frame_count += 1
                    if self._audio_frame_count % 100 == 0:
                        logger.info(f"🔊 Audio consumer heartbeat: received {self._audio_frame_count} frames")
                except Exception as e:
                    logger.info(f"🔊 Audio track ended or recv error: {e}")
                    break

                # Resample and Convert audio frame to numpy samples if possible
                try:
                    # Resample to target format (16kHz, mono, float32)
                    resampled_frames = resampler.resample(frame)
                    
                    for resampled_frame in resampled_frames:
                        # to_ndarray() returns (channels, samples), for mono it's (1, N)
                        samples = resampled_frame.to_ndarray()[0].astype('float32')

                        if audio_processor is not None:
                            # Log sample stats occasionally
                            if not hasattr(self, '_audio_stats_log'): self._audio_stats_log = 0
                            import time
                            if time.time() - self._audio_stats_log > 5:
                                logger.info(f"🔊 Processing resampled chunk: samples={len(samples)}, max_val={np.max(np.abs(samples)) if len(samples) > 0 else 0:.4f}")
                                self._audio_stats_log = time.time()
                            
                            audio_processor.process_audio_chunk(samples)
                        else:
                            # Periodically warn if processor is missing
                            if not hasattr(self, '_audio_stats_log'): self._audio_stats_log = 0
                            import time
                            if time.time() - self._audio_stats_log > 5:
                                logger.warning("🔊 Skipping audio chunk - processor is None")
                                self._audio_stats_log = time.time()
                except Exception as e:
                    logger.debug(f"🔊 Skipping audio frame conversion: {e}")
                    continue
        except Exception as e:
            logger.error(f"🔊 FATAL error in audio consumer task: {e}")
            import traceback
            logger.error(traceback.format_exc())
    
    def get_session(self, session_id: str) -> Optional[WebRTCSession]:
        """Get a session by ID"""
        return self.sessions.get(session_id)
    
    def get_session_status(self, session_id: str) -> Dict:
        """Get session status"""
        session = self.sessions.get(session_id)
        if not session:
            return {"error": "Session not found"}
        
        return {
            "session_id": session_id,
            "created_at": session.created_at.isoformat(),
            "current_task": session.current_task,
            "detection_status": session.detection_status,
            "mode": "websocket" if session.is_websocket_mode else "webrtc",
            "connection_state": "connected" if session.is_websocket_mode else (
                session.peer_connection.connectionState if session.peer_connection else "unknown"
            )
        }
    
    def reset_session(self, session_id: str) -> Dict:
        """Reset detection status"""
        session = self.sessions.get(session_id)
        if not session:
            return {"error": "Session not found", "success": False}
        
        session.current_task = "rubbing"
        session.detection_status = {
            "rubbing_detected": False,
            "acid_detected": False,
            "gold_purity": None
        }
        return {"success": True, "message": "Session reset"}
    
    async def close_session(self, session_id: str) -> Dict:
        """Close and cleanup a session"""
        session = self.sessions.pop(session_id, None)
        if not session:
            return {"error": "Session not found", "success": False}
        
        try:
            if session.peer_connection:
                await session.peer_connection.close()
            logger.info(f"🔒 Closed session: {session_id}")
            return {"success": True}
        except Exception as e:
            return {"error": str(e), "success": False}
    
    async def cleanup(self):
        """Cleanup all sessions"""
        for session_id in list(self.sessions.keys()):
            await self.close_session(session_id)
        logger.info("🧹 WebRTC Manager cleanup complete")
    
    def get_status(self) -> Dict:
        """Get manager status"""
        return {
            "available": self.is_available(),
            "webrtc_available": self.is_webrtc_available(),
            "aiortc_installed": AIORTC_AVAILABLE,
            "mode": "webrtc" if AIORTC_AVAILABLE else "websocket",
            "initialized": self.initialized,
            "active_sessions": len(self.sessions),
            "sessions": [
                {
                    "session_id": s.session_id,
                    "created_at": s.created_at.isoformat(),
                    "current_task": s.current_task,
                    "mode": "websocket" if s.is_websocket_mode else "webrtc"
                }
                for s in self.sessions.values()
            ]
        }


# Singleton instance
webrtc_manager = WebRTCManager()

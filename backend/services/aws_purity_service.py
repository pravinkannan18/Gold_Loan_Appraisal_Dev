"""
AWS-Compatible Fast Purity Testing Service
Camera runs on user's browser, YOLO runs on AWS GPU
Uses WebSocket for bidirectional frame streaming
"""

import os
import cv2
import time
import warnings
import numpy as np
import base64
import torch
import asyncio
from typing import Optional, Dict, List, Any
from pathlib import Path
from collections import deque
import threading
from queue import Queue, Empty

# Suppress warnings
warnings.filterwarnings("ignore")
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Patch torch.load for YOLO compatibility
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    if 'weights_only' not in kwargs:
        kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# Try to import YOLO
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
    print("✓ YOLO libraries loaded (AWS Service)")
except ImportError as e:
    print(f"⚠️ YOLO not available: {e}")
    YOLO_AVAILABLE = False


class AWSPurityService:
    """
    AWS-Compatible Purity Testing Service.
    
    Key difference from FastPurityService:
    - Camera runs on USER'S BROWSER (not backend)
    - Backend receives frames via WebSocket
    - YOLO inference runs on AWS GPU
    - Annotated frames sent back to browser
    
    This works with:
    - AWS EC2 (with GPU: g4dn, p3, etc.)
    - AWS Lambda (CPU only, slower)
    - Any cloud provider
    """

    # Paths
    _BASE_DIR = Path(__file__).resolve().parent.parent
    _ML_MODELS_DIR = _BASE_DIR / "ml_models"
    
    MODEL_GOLD_PATH = _ML_MODELS_DIR / "best_top2.pt"
    MODEL_STONE_PATH = _ML_MODELS_DIR / "best_top_stone.pt"
    MODEL_ACID_PATH = _ML_MODELS_DIR / "best_aci_liq.pt"

    # Optimized settings
    IMGSZ = 320
    CONF_THRESH = 0.35

    # Colors (BGR)
    STONE_COLOR = (0, 0, 255)
    GOLD_COLOR = (0, 215, 255)
    ACID_COLOR = (0, 255, 255)

    # Rubbing detection
    FLUCTUATION_THRESHOLD = 2.0
    MIN_FLUCTUATIONS = 3
    WINDOW_SIZE = 10

    def __init__(self):
        self.available = YOLO_AVAILABLE
        
        # Device setup
        self.device = self._setup_device()
        self.use_half = self.device == 'cuda'
        
        # Models
        self.model_gold = None
        self.model_stone = None
        self.model_acid = None
        
        # State (per-session, should use session IDs for multi-user)
        self.sessions: Dict[str, Dict] = {}
        
        # Load models
        if YOLO_AVAILABLE:
            self._load_models()

    def _setup_device(self) -> str:
        """Setup optimal device"""
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1024**3
            print(f"✓ AWS GPU: {gpu_name} ({gpu_mem:.1f}GB) - Using FP16")
            return 'cuda'
        print("ℹ️ Using CPU (no GPU available)")
        return 'cpu'

    def _load_models(self):
        """Load and optimize YOLO models"""
        print(f"\n🔄 Loading YOLO models for AWS on {self.device.upper()}...")
        
        try:
            if self.MODEL_STONE_PATH.exists():
                self.model_stone = YOLO(str(self.MODEL_STONE_PATH))
                self.model_stone.to(self.device)
                if self.use_half:
                    self.model_stone.model.half()
                print(f"  ✓ Stone model loaded")

            if self.MODEL_GOLD_PATH.exists():
                self.model_gold = YOLO(str(self.MODEL_GOLD_PATH))
                self.model_gold.to(self.device)
                if self.use_half:
                    self.model_gold.model.half()
                print(f"  ✓ Gold model loaded")

            if self.MODEL_ACID_PATH.exists():
                self.model_acid = YOLO(str(self.MODEL_ACID_PATH))
                self.model_acid.to(self.device)
                if self.use_half:
                    self.model_acid.model.half()
                print(f"  ✓ Acid model loaded")

            # Warmup
            self._warmup_models()
            
        except Exception as e:
            print(f"  ❌ Model loading error: {e}")

        self.available = all([self.model_gold, self.model_stone, self.model_acid])
        print(f"  Models ready: {self.available}")

    def _warmup_models(self):
        """Warmup models"""
        print("  🔥 Warming up models...")
        dummy = np.zeros((self.IMGSZ, self.IMGSZ, 3), dtype=np.uint8)
        try:
            if self.model_stone:
                self.model_stone(dummy, imgsz=self.IMGSZ, verbose=False)
            if self.model_gold:
                self.model_gold(dummy, imgsz=self.IMGSZ, verbose=False)
            if self.model_acid:
                self.model_acid(dummy, imgsz=self.IMGSZ, verbose=False)
            print("  ✓ Models warmed up")
        except Exception as e:
            print(f"  ⚠️ Warmup error: {e}")

    # ================================================================
    # SESSION MANAGEMENT (for multi-user support)
    # ================================================================
    
    def create_session(self, session_id: str) -> Dict:
        """Create a new session for a user"""
        self.sessions[session_id] = {
            'current_task': 'rubbing',
            'rubbing_confirmed': False,
            'acid_detected': False,
            'recent_distances': deque(maxlen=self.WINDOW_SIZE),
            'created_at': time.time()
        }
        print(f"📝 Session created: {session_id}")
        return {"success": True, "session_id": session_id}

    def get_session(self, session_id: str) -> Optional[Dict]:
        """Get session state"""
        return self.sessions.get(session_id)

    def reset_session(self, session_id: str):
        """Reset session state"""
        if session_id in self.sessions:
            self.sessions[session_id]['current_task'] = 'rubbing'
            self.sessions[session_id]['rubbing_confirmed'] = False
            self.sessions[session_id]['acid_detected'] = False
            self.sessions[session_id]['recent_distances'].clear()

    def delete_session(self, session_id: str):
        """Delete session"""
        if session_id in self.sessions:
            del self.sessions[session_id]
            print(f"🗑️ Session deleted: {session_id}")

    # ================================================================
    # FRAME PROCESSING (receives frame from browser)
    # ================================================================
    
    async def process_frame_b64(self, session_id: str, frame_b64: str) -> Dict:
        """
        Process a base64 frame from browser camera.
        
        Args:
            session_id: Unique session identifier
            frame_b64: Base64 encoded JPEG from browser
            
        Returns:
            Dict with annotated frame and status
        """
        start_time = time.time()
        
        # Get or create session
        if session_id not in self.sessions:
            self.create_session(session_id)
        session = self.sessions[session_id]
        
        try:
            # Decode frame
            if ',' in frame_b64:
                frame_b64 = frame_b64.split(',')[1]
            img_bytes = base64.b64decode(frame_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None:
                return {"error": "Failed to decode frame"}
            
            # Process through YOLO
            annotated, status = self._process_frame(frame, session)
            
            # Calculate timing
            process_time = (time.time() - start_time) * 1000
            fps = 1000 / process_time if process_time > 0 else 0
            
            # Add FPS overlay
            cv2.putText(annotated, f"FPS: {fps:.1f} | {process_time:.0f}ms", 
                       (10, annotated.shape[0] - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            
            # Encode result
            _, buffer = cv2.imencode('.jpg', annotated, 
                [cv2.IMWRITE_JPEG_QUALITY, 80])
            result_b64 = base64.b64encode(buffer).decode('utf-8')
            
            return {
                'frame': result_b64,
                'status': status,
                'fps': round(fps, 1),
                'process_ms': round(process_time, 1)
            }
            
        except Exception as e:
            print(f"Frame processing error: {e}")
            return {"error": str(e)}

    def _process_frame(self, frame: np.ndarray, session: Dict) -> tuple:
        """Process single frame through YOLO models"""
        H, W = frame.shape[:2]
        annotated = frame.copy()
        
        current_task = session['current_task']
        status = {
            'task': current_task,
            'rubbing_detected': session['rubbing_confirmed'],
            'acid_detected': session['acid_detected'],
            'message': ''
        }

        # ============== RUBBING STAGE ==============
        if current_task == "rubbing":
            cv2.putText(annotated, "STAGE 1: RUBBING TEST", (10, 30),
                       cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 2)
            
            stone_bbox = None
            gold_mask = np.zeros((H, W), dtype=np.uint8)
            
            # Detect stone
            if self.model_stone:
                try:
                    results = self.model_stone(frame, imgsz=self.IMGSZ, 
                        conf=self.CONF_THRESH, verbose=False)
                    for r in results:
                        if r.boxes is not None and len(r.boxes) > 0:
                            boxes = r.boxes.xyxy.cpu().numpy()
                            x1, y1, x2, y2 = map(int, boxes[0][:4])
                            cv2.rectangle(annotated, (x1, y1), (x2, y2), 
                                         self.STONE_COLOR, 2)
                            stone_bbox = (x1, y1, x2, y2)
                except Exception as e:
                    pass

            # Detect gold overlay
            if stone_bbox and self.model_gold:
                try:
                    results = self.model_gold(frame, imgsz=self.IMGSZ,
                        conf=self.CONF_THRESH, verbose=False)
                    for r in results:
                        if r.masks is not None and len(r.masks) > 0:
                            mask = r.masks.data[0].cpu().numpy()
                            if mask.ndim == 3:
                                mask = mask[0]
                            
                            mask_resized = cv2.resize((mask > 0.5).astype(np.uint8) * 255, 
                                                       (W, H), cv2.INTER_NEAREST)
                            
                            sx1, sy1, sx2, sy2 = stone_bbox
                            stone_mask = np.zeros((H, W), dtype=np.uint8)
                            cv2.rectangle(stone_mask, (sx1, sy1), (sx2, sy2), 255, -1)
                            
                            gold_mask = cv2.bitwise_and(mask_resized, stone_mask)
                            annotated[gold_mask > 0] = self.GOLD_COLOR
                except Exception as e:
                    pass

            # Compute rubbing movement
            rubbing_ok = self._compute_rubbing(gold_mask, stone_bbox, annotated, session)
            
            status_text = "Visual: OK" if rubbing_ok else "Visual: DETECTING..."
            color = (0, 255, 0) if rubbing_ok else (0, 165, 255)
            cv2.putText(annotated, status_text, (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            
            if rubbing_ok:
                session['rubbing_confirmed'] = True
                session['current_task'] = "acid"
                status['message'] = "Rubbing Confirmed! Switch to Acid Test"

        # ============== ACID STAGE ==============
        elif current_task == "acid":
            cv2.putText(annotated, "STAGE 2: ACID TEST", (10, 30),
                       cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(annotated, "✓ RUBBING OK", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            
            acid_found = False
            if self.model_acid:
                try:
                    results = self.model_acid(frame, imgsz=self.IMGSZ,
                        conf=0.6, verbose=False)
                    for r in results:
                        if r.boxes is not None and len(r.boxes) > 0:
                            for box in r.boxes:
                                conf = box.conf[0].item()
                                if conf > 0.4:
                                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                                    cv2.rectangle(annotated, (x1, y1), (x2, y2),
                                                 self.ACID_COLOR, 3)
                                    cv2.putText(annotated, f"ACID {conf:.2f}", 
                                               (x1, y1 - 10),
                                               cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                                               self.ACID_COLOR, 2)
                                    acid_found = True
                except Exception as e:
                    pass

            if acid_found:
                session['acid_detected'] = True
                session['current_task'] = "done"
                status['message'] = "Acid Detected! Test Complete"
            else:
                cv2.putText(annotated, "Waiting for Acid...", (10, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

        # ============== DONE STAGE ==============
        elif current_task == "done":
            cv2.putText(annotated, "TEST COMPLETE", (10, 30),
                       cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 255, 0), 2)
            cv2.putText(annotated, "✓ RUBBING OK", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.putText(annotated, "✓ ACID OK", (10, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            status['message'] = "Purity test complete!"

        status['rubbing_detected'] = session['rubbing_confirmed']
        status['acid_detected'] = session['acid_detected']
        status['task'] = session['current_task']
        
        return annotated, status

    def _compute_rubbing(self, mask: np.ndarray, stone_bbox: tuple, 
                         annotated: np.ndarray, session: Dict) -> bool:
        """Detect rubbing motion"""
        if stone_bbox is None or (mask > 0).sum() == 0:
            return False

        M = cv2.moments(mask)
        if M['m00'] == 0:
            return False

        cx = int(M['m10'] / M['m00'])
        cy = int(M['m01'] / M['m00'])
        cv2.circle(annotated, (cx, cy), 5, (0, 0, 255), -1)

        sx1, sy1, sx2, sy2 = stone_bbox
        scx = (sx1 + sx2) / 2
        scy = (sy1 + sy2) / 2
        dist = np.hypot(cx - scx, cy - scy)
        
        session['recent_distances'].append(dist)

        if len(session['recent_distances']) >= 3:
            diffs = np.diff(list(session['recent_distances']))
            meaningful = np.abs(diffs) >= self.FLUCTUATION_THRESHOLD
            signs = np.sign(diffs)
            
            sign_changes = 0
            prev_sign = signs[0] if len(signs) > 0 else 0
            for i in range(1, len(signs)):
                s = signs[i]
                if meaningful[i] and meaningful[i-1] and s != 0 and prev_sign != 0 and s != prev_sign:
                    sign_changes += 1
                prev_sign = s if s != 0 else prev_sign
            
            return sign_changes >= self.MIN_FLUCTUATIONS

        return False

    # ================================================================
    # PUBLIC API
    # ================================================================
    
    def get_status(self) -> Dict:
        """Get service status"""
        return {
            "available": self.available,
            "device": self.device,
            "use_half": self.use_half,
            "active_sessions": len(self.sessions),
            "deployment": "aws-compatible"
        }

    def is_available(self) -> bool:
        return self.available


# Singleton instance
_aws_service: Optional[AWSPurityService] = None

def get_aws_purity_service() -> AWSPurityService:
    """Get or create the AWS purity service singleton"""
    global _aws_service
    if _aws_service is None:
        _aws_service = AWSPurityService()
    return _aws_service

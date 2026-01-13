"""
Fast Purity Testing Service - Optimized for Real-time YOLO Inference
Uses WebSocket streaming for maximum speed with backend camera control
"""

import os
import cv2
import time
import warnings
import numpy as np
import base64
import torch
import asyncio
from typing import Optional, Dict, List, Any, AsyncGenerator
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
    print("✓ YOLO libraries loaded (Fast Service)")
except ImportError as e:
    print(f"⚠️ YOLO not available: {e}")
    YOLO_AVAILABLE = False


class FastPurityService:
    """
    Optimized Purity Testing Service for real-time performance.
    Features:
    - Backend camera capture with dedicated thread
    - GPU-accelerated inference with FP16
    - Frame queue for non-blocking processing
    - WebSocket streaming for minimal latency
    """

    # Paths
    _BASE_DIR = Path(__file__).resolve().parent.parent
    _ML_MODELS_DIR = _BASE_DIR / "ml_models"
    
    MODEL_GOLD_PATH = _ML_MODELS_DIR / "best_top2.pt"
    MODEL_STONE_PATH = _ML_MODELS_DIR / "best_top_stone.pt"
    MODEL_ACID_PATH = _ML_MODELS_DIR / "best_aci_liq.pt"

    # Optimized settings for speed
    IMGSZ = 320  # Small size for fast inference
    CONF_THRESH = 0.35
    TARGET_FPS = 30  # Target frame rate
    FRAME_INTERVAL = 1.0 / TARGET_FPS

    # Colors (BGR)
    STONE_COLOR = (0, 0, 255)  # Red
    GOLD_COLOR = (0, 215, 255)  # Gold
    ACID_COLOR = (0, 255, 255)  # Yellow

    # Rubbing detection thresholds
    FLUCTUATION_THRESHOLD = 2.0
    MIN_FLUCTUATIONS = 3
    WINDOW_SIZE = 10

    def __init__(self):
        self.available = YOLO_AVAILABLE
        
        # Device setup (prefer GPU with FP16)
        self.device = self._setup_device()
        self.use_half = self.device == 'cuda'  # Use FP16 on GPU
        
        # Models
        self.model_gold = None
        self.model_stone = None
        self.model_acid = None
        
        # Camera
        self.camera: Optional[cv2.VideoCapture] = None
        self.camera_index = 0
        self.camera_lock = threading.Lock()
        
        # Frame processing
        self.frame_queue: Queue = Queue(maxsize=3)  # Small queue to drop old frames
        self.result_queue: Queue = Queue(maxsize=3)
        self.capture_thread: Optional[threading.Thread] = None
        self.process_thread: Optional[threading.Thread] = None
        
        # State
        self.is_running = False
        self.current_task = "rubbing"  # rubbing -> acid -> done
        self.rubbing_confirmed = False
        self.acid_detected = False
        
        # Rubbing tracking
        self.recent_distances = deque(maxlen=self.WINDOW_SIZE)
        
        # Clients
        self.active_clients: set = set()
        
        # Load models
        if YOLO_AVAILABLE:
            self._load_models()

    def _setup_device(self) -> str:
        """Setup optimal device (GPU with FP16 if available)"""
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1024**3
            print(f"✓ GPU: {gpu_name} ({gpu_mem:.1f}GB) - Using FP16")
            return 'cuda'
        print("ℹ️ Using CPU (GPU not available)")
        return 'cpu'

    def _load_models(self):
        """Load and optimize YOLO models"""
        print(f"\n🔄 Loading optimized YOLO models on {self.device.upper()}...")
        
        try:
            if self.MODEL_STONE_PATH.exists():
                self.model_stone = YOLO(str(self.MODEL_STONE_PATH))
                self.model_stone.to(self.device)
                if self.use_half:
                    self.model_stone.model.half()
                print(f"  ✓ Stone model loaded (FP16: {self.use_half})")

            if self.MODEL_GOLD_PATH.exists():
                self.model_gold = YOLO(str(self.MODEL_GOLD_PATH))
                self.model_gold.to(self.device)
                if self.use_half:
                    self.model_gold.model.half()
                print(f"  ✓ Gold model loaded (FP16: {self.use_half})")

            if self.MODEL_ACID_PATH.exists():
                self.model_acid = YOLO(str(self.MODEL_ACID_PATH))
                self.model_acid.to(self.device)
                if self.use_half:
                    self.model_acid.model.half()
                print(f"  ✓ Acid model loaded (FP16: {self.use_half})")

            # Warmup models with dummy inference
            self._warmup_models()
            
        except Exception as e:
            print(f"  ❌ Model loading error: {e}")

        self.available = all([self.model_gold, self.model_stone, self.model_acid])
        print(f"  Models ready: {self.available}")

    def _warmup_models(self):
        """Warmup models with dummy inference for faster first prediction"""
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
    # CAMERA MANAGEMENT
    # ================================================================
    
    def _open_camera(self, index: int = 0) -> bool:
        """Open camera with optimized settings"""
        with self.camera_lock:
            if self.camera and self.camera.isOpened():
                self.camera.release()
            
            # Try DSHOW first (fastest on Windows)
            for backend in [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]:
                cam = cv2.VideoCapture(index, backend)
                if cam.isOpened():
                    # Optimize camera settings
                    cam.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    cam.set(cv2.CAP_PROP_FPS, 30)
                    cam.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize latency
                    
                    ret, _ = cam.read()
                    if ret:
                        self.camera = cam
                        self.camera_index = index
                        print(f"✓ Camera {index} opened")
                        return True
                    cam.release()
            
            print(f"❌ Failed to open camera {index}")
            return False

    def _close_camera(self):
        """Close camera safely"""
        with self.camera_lock:
            if self.camera:
                self.camera.release()
                self.camera = None

    # ================================================================
    # FRAME CAPTURE THREAD
    # ================================================================
    
    def _capture_loop(self):
        """Continuous frame capture thread"""
        while self.is_running:
            with self.camera_lock:
                if self.camera and self.camera.isOpened():
                    ret, frame = self.camera.read()
                    if ret:
                        # Drop old frames if queue is full
                        if self.frame_queue.full():
                            try:
                                self.frame_queue.get_nowait()
                            except Empty:
                                pass
                        self.frame_queue.put(frame)
            time.sleep(0.001)  # Small delay to prevent CPU overload

    # ================================================================
    # FRAME PROCESSING THREAD
    # ================================================================
    
    def _process_loop(self):
        """Continuous YOLO processing thread"""
        while self.is_running:
            try:
                frame = self.frame_queue.get(timeout=0.1)
                
                start_time = time.time()
                annotated, status = self._process_frame(frame)
                process_time = (time.time() - start_time) * 1000
                
                # Add FPS counter
                fps = 1000 / process_time if process_time > 0 else 0
                cv2.putText(annotated, f"FPS: {fps:.1f}", (540, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                
                # Encode to JPEG
                _, buffer = cv2.imencode('.jpg', annotated, 
                    [cv2.IMWRITE_JPEG_QUALITY, 75])
                
                result = {
                    'frame': base64.b64encode(buffer).decode('utf-8'),
                    'status': status,
                    'fps': round(fps, 1),
                    'process_ms': round(process_time, 1)
                }
                
                # Drop old results if queue is full
                if self.result_queue.full():
                    try:
                        self.result_queue.get_nowait()
                    except Empty:
                        pass
                self.result_queue.put(result)
                
            except Empty:
                continue
            except Exception as e:
                print(f"Processing error: {e}")

    def _process_frame(self, frame: np.ndarray) -> tuple:
        """Process single frame through YOLO models"""
        H, W = frame.shape[:2]
        annotated = frame.copy()
        status = {
            'task': self.current_task,
            'rubbing_detected': self.rubbing_confirmed,
            'acid_detected': self.acid_detected,
            'message': ''
        }

        # ============== RUBBING STAGE ==============
        if self.current_task == "rubbing":
            cv2.putText(annotated, "STAGE 1: RUBBING TEST", (10, 30),
                       cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 2)
            
            stone_bbox = None
            gold_mask_pct = 0.0
            gold_mask = np.zeros((H, W), dtype=np.uint8)
            
            # Detect stone
            if self.model_stone:
                try:
                    results = self.model_stone(frame, imgsz=self.IMGSZ, 
                        conf=self.CONF_THRESH, verbose=False, stream=True)
                    for r in results:
                        if r.boxes is not None:
                            boxes = r.boxes.xyxy.cpu().numpy()
                            for box in boxes:
                                x1, y1, x2, y2 = map(int, box[:4])
                                cv2.rectangle(annotated, (x1, y1), (x2, y2), 
                                             self.STONE_COLOR, 2)
                                stone_bbox = (x1, y1, x2, y2)
                                break  # Use first detection
                except Exception as e:
                    pass

            # Detect gold overlay
            if stone_bbox and self.model_gold:
                try:
                    results = self.model_gold(frame, imgsz=self.IMGSZ,
                        conf=self.CONF_THRESH, verbose=False)
                    for r in results:
                        if r.masks is not None:
                            mask = r.masks.data[0].cpu().numpy()
                            if mask.ndim == 3:
                                mask = mask[0]
                            
                            # Resize and clip to stone bbox
                            mask_resized = cv2.resize((mask > 0.5).astype(np.uint8) * 255, 
                                                       (W, H), cv2.INTER_NEAREST)
                            
                            sx1, sy1, sx2, sy2 = stone_bbox
                            stone_mask = np.zeros((H, W), dtype=np.uint8)
                            cv2.rectangle(stone_mask, (sx1, sy1), (sx2, sy2), 255, -1)
                            
                            gold_mask = cv2.bitwise_and(mask_resized, stone_mask)
                            annotated[gold_mask > 0] = self.GOLD_COLOR
                            
                            stone_area = max(1, (sx2 - sx1) * (sy2 - sy1))
                            gold_mask_pct = (gold_mask > 0).sum() / stone_area * 100
                            break
                except Exception as e:
                    pass

            # Compute rubbing movement
            rubbing_ok = self._compute_rubbing(gold_mask, stone_bbox, annotated)
            
            status_text = "Visual: OK" if rubbing_ok else "Visual: DETECTING..."
            color = (0, 255, 0) if rubbing_ok else (0, 165, 255)
            cv2.putText(annotated, status_text, (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            
            if rubbing_ok:
                self.rubbing_confirmed = True
                self.current_task = "acid"
                status['message'] = "Rubbing Confirmed! Switch to Acid Test"
                print("✅ Rubbing confirmed!")

        # ============== ACID STAGE ==============
        elif self.current_task == "acid":
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
                        if r.boxes is not None:
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
                self.acid_detected = True
                self.current_task = "done"
                status['message'] = "Acid Detected! Test Complete"
                print("✅ Acid detected!")
            else:
                cv2.putText(annotated, "Waiting for Acid...", (10, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

        # ============== DONE STAGE ==============
        elif self.current_task == "done":
            cv2.putText(annotated, "TEST COMPLETE", (10, 30),
                       cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 255, 0), 2)
            cv2.putText(annotated, "✓ RUBBING OK", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.putText(annotated, "✓ ACID OK", (10, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            status['message'] = "Purity test complete!"

        status['rubbing_detected'] = self.rubbing_confirmed
        status['acid_detected'] = self.acid_detected
        status['task'] = self.current_task
        
        return annotated, status

    def _compute_rubbing(self, mask: np.ndarray, stone_bbox: tuple, 
                         annotated: np.ndarray) -> bool:
        """Detect rubbing motion from gold mask centroid movement"""
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
        
        self.recent_distances.append(dist)

        if len(self.recent_distances) >= 3:
            diffs = np.diff(list(self.recent_distances))
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
    
    def start(self, camera_index: int = 0) -> Dict:
        """Start the fast purity testing service"""
        if self.is_running:
            return {"success": True, "message": "Already running"}

        print(f"\n🚀 Starting Fast Purity Service (Camera {camera_index})...")
        
        if not self._open_camera(camera_index):
            return {"success": False, "error": "Failed to open camera"}

        # Reset state
        self.is_running = True
        self.current_task = "rubbing"
        self.rubbing_confirmed = False
        self.acid_detected = False
        self.recent_distances.clear()
        
        # Clear queues
        while not self.frame_queue.empty():
            try: self.frame_queue.get_nowait()
            except: pass
        while not self.result_queue.empty():
            try: self.result_queue.get_nowait()
            except: pass

        # Start threads
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.process_thread = threading.Thread(target=self._process_loop, daemon=True)
        self.capture_thread.start()
        self.process_thread.start()

        print("✓ Fast Purity Service started")
        return {
            "success": True,
            "message": "Service started",
            "camera_index": camera_index,
            "device": self.device,
            "use_half": self.use_half
        }

    def stop(self) -> Dict:
        """Stop the service"""
        print("\n🛑 Stopping Fast Purity Service...")
        self.is_running = False
        
        # Wait for threads
        if self.capture_thread:
            self.capture_thread.join(timeout=1.0)
        if self.process_thread:
            self.process_thread.join(timeout=1.0)
        
        self._close_camera()
        print("✓ Fast Purity Service stopped")
        
        return {"success": True, "message": "Service stopped"}

    async def stream_frames(self) -> AsyncGenerator[Dict, None]:
        """Async generator for WebSocket streaming"""
        while self.is_running:
            try:
                result = self.result_queue.get(timeout=0.1)
                yield result
            except Empty:
                await asyncio.sleep(0.01)
            except Exception as e:
                print(f"Stream error: {e}")
                break

    def get_latest_frame(self) -> Optional[Dict]:
        """Get latest processed frame (non-blocking)"""
        try:
            return self.result_queue.get_nowait()
        except Empty:
            return None

    def get_status(self) -> Dict:
        """Get current service status"""
        return {
            "available": self.available,
            "running": self.is_running,
            "task": self.current_task,
            "rubbing_detected": self.rubbing_confirmed,
            "acid_detected": self.acid_detected,
            "device": self.device,
            "use_half": self.use_half,
            "camera_index": self.camera_index
        }

    def reset(self):
        """Reset detection state"""
        self.current_task = "rubbing"
        self.rubbing_confirmed = False
        self.acid_detected = False
        self.recent_distances.clear()

    def get_available_cameras(self) -> List[Dict]:
        """List available cameras"""
        cameras = []
        for i in range(4):
            try:
                cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
                if cap.isOpened():
                    cameras.append({
                        "index": i,
                        "name": f"Camera {i}",
                        "resolution": "640x480"
                    })
                    cap.release()
            except:
                pass
        return cameras

    def is_available(self) -> bool:
        return self.available


# Singleton instance
_fast_service: Optional[FastPurityService] = None

def get_fast_purity_service() -> FastPurityService:
    """Get or create the fast purity service singleton"""
    global _fast_service
    if _fast_service is None:
        _fast_service = FastPurityService()
    return _fast_service

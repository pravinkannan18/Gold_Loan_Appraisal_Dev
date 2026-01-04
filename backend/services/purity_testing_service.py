"""
Purity Testing Service for Gold Loan Appraisal System
Converted from FastAPI to regular Python service
"""

import os
import cv2
import time
import math
import warnings
import pandas as pd
import numpy as np
import base64
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime
import threading
import queue

# Suppress warnings
warnings.filterwarnings("ignore")
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Try to import YOLO - make it optional for development
try:
    from ultralytics import YOLO
    import torch
    
    # Fix for newer PyTorch versions that default to weights_only=True
    # This is required for loading YOLO models which use custom classes
    try:
        if hasattr(torch.serialization, 'add_safe_globals'):
            import ultralytics.nn.tasks
            import ultralytics.nn.modules.conv
            import ultralytics.nn.modules.block
            import ultralytics.nn.modules.head
            import torch.nn.modules.container
            import torch.nn.modules.conv
            import torch.nn.modules.batchnorm
            import torch.nn.modules.activation
            import torch.nn.modules.pooling
            import torch.nn.modules.upsampling
            import torch.nn.modules.linear
            import collections
            
            # Common classes found in YOLOv8 models
            safe_classes = [
                ultralytics.nn.tasks.DetectionModel,
                ultralytics.nn.modules.conv.Conv,
                ultralytics.nn.modules.conv.Concat,
                ultralytics.nn.modules.block.C2f,
                ultralytics.nn.modules.block.Bottleneck,
                ultralytics.nn.modules.block.DFL,
                ultralytics.nn.modules.block.SPPF,
                ultralytics.nn.modules.head.Detect,
                torch.nn.modules.container.Sequential,
                torch.nn.modules.container.ModuleList,
                torch.nn.modules.conv.Conv2d,
                torch.nn.modules.batchnorm.BatchNorm2d,
                torch.nn.modules.activation.SiLU,
                torch.nn.modules.pooling.MaxPool2d,
                torch.nn.modules.upsampling.Upsample,
                torch.nn.modules.linear.Identity,
                torch.Size,
                torch.device,
                collections.OrderedDict,
            ]
            
            # Add storage types if available
            for storage in ['FloatStorage', 'LongStorage', 'IntStorage', 'DoubleStorage', 'HalfStorage', 'ByteStorage', 'CharStorage', 'ShortStorage', 'BoolStorage', 'UntypedStorage']:
                if hasattr(torch, storage):
                    safe_classes.append(getattr(torch, storage))
            
            torch.serialization.add_safe_globals(safe_classes)
            print("✓ Added comprehensive YOLO/Torch classes to safe globals")
    except Exception as e:
        print(f"⚠️ Failed to add safe globals: {e}")

    YOLO_AVAILABLE = True
    print("YOLO libraries loaded successfully")
except ImportError as e:
    print(f"YOLO libraries not available: {e}")
    print("Install with: pip install ultralytics")
    YOLO_AVAILABLE = False
    # Mock class for development
    class YOLO:
        def __init__(self, model_path):
            self.model_path = model_path
            self.model = type('obj', (object,), {'names': {}})()
        def predict(self, frame, **kwargs):
            return [type('obj', (object,), {
                'boxes': type('obj', (object,), {
                    'xyxy': type('obj', (object,), {'cpu': lambda: type('obj', (object,), {'numpy': lambda: np.array([])})()})(),
                    'cls': type('obj', (object,), {'cpu': lambda: type('obj', (object,), {'numpy': lambda: np.array([])})()})()
                })()
            })]

class PurityTestingService:
    """Service class for handling purity testing operations"""
    
    def __init__(self, database=None):
        self.db = database
        self.available = YOLO_AVAILABLE
        
        # Detection status tracking
        self.detection_status = {"message": "No detection yet", "timestamp": None}
        self.detection_states = {}
        
        # Models and cameras
        self.model1 = None
        self.model2 = None
        self.camera1 = None
        self.camera2 = None
        
        # Service state
        self.is_running = False
        self.current_task = None
        
        # Configuration - Updated paths
        self.model1_path = "ml_models/best_rub2_2.pt"
        self.model2_path = "ml_models/best_rub2_1.pt"
        self.csv1_path = "data/task_sequence.csv"
        self.csv2_path = "data/task_sequence_main.csv"
        
        # Threading for video processing
        self._stop_event = threading.Event()
        # self._video_threads = {}
        # self._frame_queues = {}
        
        # Initialize if available
        if self.available:
            self._initialize_models()
    
    def _initialize_models(self):
        """Initialize YOLO models"""
        try:
            if os.path.exists(self.model1_path):
                self.model1 = YOLO(self.model1_path)
                print(f"✓ Model 1 loaded: {self.model1_path}")
            else:
                print(f"⚠️ Model 1 not found: {self.model1_path}")
                
            if os.path.exists(self.model2_path):
                self.model2 = YOLO(self.model2_path)
                print(f"✓ Model 2 loaded: {self.model2_path}")
            else:
                print(f"⚠️ Model 2 not found: {self.model2_path}")
                
        except Exception as e:
            print(f"Error loading models: {e}")
            self.available = False
    
    def is_available(self) -> bool:
        """Check if purity testing service is available"""
        return self.available and (self.model1 is not None or self.model2 is not None)
    
    def iou(self, box1: List[float], box2: List[float]) -> float:
        """Calculate Intersection over Union (IoU) between two bounding boxes"""
        x1, y1 = max(box1[0], box2[0]), max(box1[1], box2[1])
        x2, y2 = min(box1[2], box2[2]), min(box1[3], box2[3])
        inter_area = max(0, x2 - x1) * max(0, y2 - y1)
        union = ((box1[2] - box1[0]) * (box1[3] - box1[1])) + ((box2[2] - box2[0]) * (box2[3] - box2[1])) - inter_area
        return inter_area / union if union else 0
    
    def detect_pairs(self, bboxes: np.ndarray, classes: List[str], target_class1: str, target_class2: str, iou_threshold: float = 0.1) -> List[Tuple[int, int]]:
        """Detect pairs of target classes based on IoU threshold"""
        pairs = []
        indices_class1 = [i for i, c in enumerate(classes) if c == target_class1]
        indices_class2 = [i for i, c in enumerate(classes) if c == target_class2]
        
        for i in indices_class1:
            for j in indices_class2:
                if self.iou(bboxes[i], bboxes[j]) > iou_threshold:
                    pairs.append((i, j))
        return pairs
    
    def run_yolo_with_csv(self, frame: np.ndarray, model, csv_path: str, detection_states: Dict) -> np.ndarray:
        """Run YOLO detection with CSV task logic and timer tracking"""
        if not os.path.exists(csv_path):
            print(f"Warning: CSV file not found: {csv_path}")
            return frame
        
        try:
            tasks = pd.read_csv(csv_path)
            results = model.predict(frame, imgsz=320, conf=0.3, verbose=False)
            detections = results[0]
            boxes = detections.boxes.xyxy.cpu().numpy()
            class_ids = detections.boxes.cls.cpu().numpy().astype(int)
            class_names = model.model.names
            class_labels = [class_names[i] for i in class_ids]
            
            for idx, row in tasks.iterrows():
                t1, t2 = str(row['target1']), str(row['target2'])
                label = row['label']
                hold_seconds = float(row.get('hold_seconds', 5))
                min_fluctuations = int(row.get('min_fluctuations', 3))
                pairs = self.detect_pairs(boxes, class_labels, t1, t2, iou_threshold=0.05)
                
                key = (csv_path, label)
                state = detection_states.setdefault(key, {
                    "detected_time": None,
                    "last_detected": False,
                    "fluctuation_count": 0,
                })
                
                detected_now = bool(pairs)
                
                # Fluctuation Logic
                if detected_now and not state["last_detected"]:
                    state["fluctuation_count"] += 1
                state["last_detected"] = detected_now
                
                if detected_now and state["detected_time"] is None:
                    state["detected_time"] = time.time()
                
                if state["detected_time"]:
                    elapsed = time.time() - state["detected_time"]
                    cv2.putText(frame, f"{label}: {elapsed:.1f}s, fluc:{state['fluctuation_count']}",
                                (10, 40 + idx * 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                    
                    if elapsed > hold_seconds:
                        if state["fluctuation_count"] >= min_fluctuations:
                            print(f"✅ {label} detected. Moving to next task.")
                            self.detection_status["message"] = f"{label} detected ✅"
                            self.detection_status["timestamp"] = datetime.now().isoformat()
                            cv2.putText(frame, f"{label} DETECTED!", (50, 60 + idx * 40),
                                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
                            # Reset for next round
                            state["detected_time"] = None
                            state["fluctuation_count"] = 0
                            state["last_detected"] = False
                        else:
                            # Not enough fluctuations -> reset
                            state["detected_time"] = None
                            state["fluctuation_count"] = 0
                            state["last_detected"] = False
                
                # Draw Boxes
                for idx_box, box in enumerate(boxes):
                    x1, y1, x2, y2 = map(int, box)
                    color = (0, 255, 0)
                    if any(idx_box in pair for pair in pairs):
                        color = (0, 0, 255)
                        cv2.putText(frame, f"{label}", (x1, y1 - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, class_labels[idx_box],
                                (x1, y2 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
            
        except Exception as e:
            print(f"Error in YOLO processing: {e}")
            cv2.putText(frame, f"Error: {str(e)[:50]}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        
        return frame
    def run_yolo_analysis_on_frame(self, frame: np.ndarray) -> np.ndarray:
        """Run YOLO + CSV logic on a single frame and return annotated image"""
        if not self.is_available():
            cv2.putText(frame, "YOLO Not Available", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            return frame

        # Use model 1 (or make dynamic)
        model = self.model1
        csv_path = self.csv1_path

        if model is None or not os.path.exists(csv_path):
            cv2.putText(frame, "Model/CSV Missing", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            return frame

        try:
            results = model.predict(frame, imgsz=320, conf=0.3, verbose=False)
            detections = results[0]
            boxes = detections.boxes.xyxy.cpu().numpy()
            class_ids = detections.boxes.cls.cpu().numpy().astype(int)
            class_names = model.model.names
            class_labels = [class_names[i] for i in class_ids]

            tasks = pd.read_csv(csv_path)
            for idx, row in tasks.iterrows():
                t1, t2 = str(row['target1']), str(row['target2'])
                label = row['label']
                pairs = self.detect_pairs(boxes, class_labels, t1, t2, iou_threshold=0.05)

                key = (csv_path, label)
                state = self.detection_states.setdefault(key, {
                    "detected_time": None, "last_detected": False, "fluctuation_count": 0
                })

                detected_now = bool(pairs)
                if detected_now and not state["last_detected"]:
                    state["fluctuation_count"] += 1
                state["last_detected"] = detected_now

                if detected_now and state["detected_time"] is None:
                    state["detected_time"] = time.time()

                if state["detected_time"]:
                    elapsed = time.time() - state["detected_time"]
                    cv2.putText(frame, f"{label}: {elapsed:.1f}s fluc:{state['fluctuation_count']}",
                                (10, 40 + idx * 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

                    hold_seconds = float(row.get('hold_seconds', 5))
                    min_fluctuations = int(row.get('min_fluctuations', 3))
                    if elapsed > hold_seconds and state["fluctuation_count"] >= min_fluctuations:
                        self.detection_status["message"] = f"{label} detected"
                        self.detection_status["timestamp"] = datetime.now().isoformat()
                        cv2.putText(frame, f"{label} DETECTED!", (50, 60 + idx * 40),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
                        state["detected_time"] = None
                        state["fluctuation_count"] = 0
                        state["last_detected"] = False

                # Draw boxes
                for i, box in enumerate(boxes):
                    x1, y1, x2, y2 = map(int, box)
                    color = (0, 0, 255) if any(i in pair for pair in pairs) else (0, 255, 0)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, class_labels[i], (x1, y2 + 20),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

        except Exception as e:
            cv2.putText(frame, f"Error: {str(e)[:40]}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        return frame

    def analyze_frames(self, frame1_b64: str = None, frame2_b64: str = None) -> Dict[str, Any]:
        """Analyze one or two frames sent as base64 from the frontend"""
        results = {
            "annotated_frame1": None,
            "annotated_frame2": None,
            "detection_status": self.get_detection_status()
        }

        try:
            # Process Frame 1 (Top View / Rubbing)
            if frame1_b64:
                img1_bytes = base64.b64decode(frame1_b64.split(",")[1])
                nparr1 = np.frombuffer(img1_bytes, np.uint8)
                frame1 = cv2.imdecode(nparr1, cv2.IMREAD_COLOR)
                
                if frame1 is not None and self.model1:
                    annotated1 = self.run_yolo_with_csv(frame1, self.model1, self.csv1_path, self.detection_states)
                    _, buf1 = cv2.imencode('.jpg', annotated1, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    results["annotated_frame1"] = f"data:image/jpeg;base64,{base64.b64encode(buf1).decode()}"

            # Process Frame 2 (Side View / Acid)
            if frame2_b64:
                img2_bytes = base64.b64decode(frame2_b64.split(",")[1])
                nparr2 = np.frombuffer(img2_bytes, np.uint8)
                frame2 = cv2.imdecode(nparr2, cv2.IMREAD_COLOR)
                
                if frame2 is not None and self.model2:
                    annotated2 = self.run_yolo_with_csv(frame2, self.model2, self.csv2_path, self.detection_states)
                    _, buf2 = cv2.imencode('.jpg', annotated2, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    results["annotated_frame2"] = f"data:image/jpeg;base64,{base64.b64encode(buf2).decode()}"

            # Update detection status in results
            results["detection_status"] = self.get_detection_status()
            
            # Extract specific flags for frontend convenience
            msg = results["detection_status"]["message"].lower()
            results["rubbing_detected"] = "rub" in msg and "detected" in msg
            results["acid_detected"] = "acid" in msg and "detected" in msg

        except Exception as e:
            print(f"Error in analyze_frames: {e}")
            results["error"] = str(e)

        return results
        
    def open_camera(self, camera_index: int = 0) -> Optional[cv2.VideoCapture]:
        """Open camera with error handling - tries multiple backends"""
        return self._try_open_camera(camera_index)
    
    def close_camera(self, cap: cv2.VideoCapture):
        """Close camera safely"""
        if cap is not None:
            cap.release()
    
    def capture_frame(self, camera_index: int = 0, model_index: int = 1) -> Optional[str]:
        """Capture a single frame with purity testing analysis"""
        if not self.is_available():
            raise Exception("Purity testing service not available")
        
        cap = self.open_camera(camera_index)
        if cap is None:
            raise Exception(f"Cannot open camera {camera_index}")
        
        try:
            ret, frame = cap.read()
            if not ret:
                raise Exception("Failed to capture frame")
            
            # Apply YOLO analysis
            model = self.model1 if model_index == 1 else self.model2
            csv_path = self.csv1_path if model_index == 1 else self.csv2_path
            
            if model is not None:
                frame = self.run_yolo_with_csv(frame, model, csv_path, self.detection_states)
            
            # Encode frame to base64
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                img_base64 = base64.b64encode(buffer).decode('utf-8')
                return f"data:image/jpeg;base64,{img_base64}"
            else:
                raise Exception("Failed to encode frame")
                
        finally:
            self.close_camera(cap)
    
    # def start_continuous_analysis(self, camera_index: int = 0, model_index: int = 1) -> str:
    #     """Start continuous purity testing analysis"""
    #     if not self.is_available():
    #         raise Exception("Purity testing service not available")
        
    #     session_id = f"session_{camera_index}_{model_index}_{int(time.time())}"
        
    #     # Initialize frame queue for this session
    #     self._frame_queues[session_id] = queue.Queue(maxsize=10)
        
    #     # Start video processing thread
    #     def video_processor():
    #         cap = self.open_camera(camera_index)
    #         if cap is None:
    #             return
            
    #         model = self.model1 if model_index == 1 else self.model2
    #         csv_path = self.csv1_path if model_index == 1 else self.csv2_path
    #         local_detection_states = {}
            
    #         try:
    #             while not self._stop_event.is_set():
    #                 ret, frame = cap.read()
    #                 if not ret:
    #                     time.sleep(0.1)
    #                     continue
                    
    #                 # Apply YOLO analysis
    #                 if model is not None:
    #                     frame = self.run_yolo_with_csv(frame, model, csv_path, local_detection_states)
                    
    #                 # Encode frame
    #                 ret, buffer = cv2.imencode('.jpg', frame)
    #                 if ret:
    #                     img_base64 = base64.b64encode(buffer).decode('utf-8')
    #                     frame_data = f"data:image/jpeg;base64,{img_base64}"
                        
    #                     # Add to queue (non-blocking)
    #                     try:
    #                         self._frame_queues[session_id].put_nowait({
    #                             "frame": frame_data,
    #                             "timestamp": time.time(),
    #                             "detection_status": self.detection_status.copy()
    #                         })
    #                     except queue.Full:
    #                         # Remove oldest frame and add new one
    #                         try:
    #                             self._frame_queues[session_id].get_nowait()
    #                             self._frame_queues[session_id].put_nowait({
    #                                 "frame": frame_data,
    #                                 "timestamp": time.time(),
    #                                 "detection_status": self.detection_status.copy()
    #                             })
    #                         except queue.Empty:
    #                             pass
                    
    #                 time.sleep(0.033)  # ~30 FPS
                    
    #         finally:
    #             self.close_camera(cap)
        
        # # Start thread
        # thread = threading.Thread(target=video_processor, daemon=True)
        # thread.start()
        # self._video_threads[session_id] = thread
        
        # return session_id
    
    # def get_latest_frame(self, session_id: str) -> Optional[Dict]:
    #     """Get the latest frame from continuous analysis"""
    #     if session_id not in self._frame_queues:
    #         return None
        
    #     try:
    #         return self._frame_queues[session_id].get_nowait()
    #     except queue.Empty:
    #         return None
    
    # def stop_continuous_analysis(self, session_id: str) -> bool:
    #     """Stop continuous analysis session"""
    #     if session_id in self._video_threads:
    #         # Clean up
    #         if session_id in self._frame_queues:
    #             del self._frame_queues[session_id]
    #         if session_id in self._video_threads:
    #             del self._video_threads[session_id]
    #         return True
    #     return False
    
    def get_detection_status(self) -> Dict[str, Any]:
        """Get current detection status"""
        return self.detection_status.copy()
    
    def reset_detection_status(self):
        """Reset detection status"""
        self.detection_status = {"message": "No detection yet", "timestamp": None}
        self.detection_states.clear()
    
    def get_available_cameras(self) -> List[int]:
        """Get list of available cameras (returns indices only)"""
        available_cameras = []
        for i in range(4):  # Check first 4 camera indices
            cap = self.open_camera(i)
            if cap is not None:
                available_cameras.append(i)
                self.close_camera(cap)
        return available_cameras
    
    def get_camera_details(self) -> List[Dict[str, Any]]:
        """Get detailed information about available cameras"""
        camera_details = []
        
        for i in range(4):  # Check first 4 camera indices
            print(f"\nScanning camera {i}...")
            cap = self._try_open_camera(i)
            
            if cap is not None:
                try:
                    # Get camera properties
                    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    fps = int(cap.get(cv2.CAP_PROP_FPS))
                    backend = cap.getBackendName()
                    
                    # Try to read a frame to verify it's working
                    ret, frame = cap.read()
                    is_working = ret and frame is not None
                    
                    camera_info = {
                        "index": i,
                        "name": f"Camera {i}",
                        "resolution": f"{width}x{height}",
                        "width": width,
                        "height": height,
                        "fps": fps if fps > 0 else 30,
                        "backend": backend,
                        "status": "available" if is_working else "detected_but_error",
                        "is_working": is_working
                    }
                    
                    camera_details.append(camera_info)
                    print(f"✅ Camera {i}: {width}x{height} @ {fps}fps ({backend})")
                    
                except Exception as e:
                    print(f"⚠️ Camera {i} error getting details: {e}")
                    camera_details.append({
                        "index": i,
                        "name": f"Camera {i}",
                        "status": "error",
                        "error": str(e),
                        "is_working": False
                    })
                finally:
                    self.close_camera(cap)
            else:
                print(f"❌ Camera {i} not available")
        
        return camera_details
    
    def validate_csv_files(self) -> Dict[str, Any]:
        """Validate CSV task files"""
        validation = {
            "csv1": {"exists": False, "valid": False, "path": self.csv1_path},
            "csv2": {"exists": False, "valid": False, "path": self.csv2_path},
        }
        
        for csv_key, csv_path in [("csv1", self.csv1_path), ("csv2", self.csv2_path)]:
            if os.path.exists(csv_path):
                validation[csv_key]["exists"] = True
                try:
                    df = pd.read_csv(csv_path)
                    required_columns = ['target1', 'target2', 'label']
                    if all(col in df.columns for col in required_columns):
                        validation[csv_key]["valid"] = True
                        validation[csv_key]["tasks"] = len(df)
                    else:
                        validation[csv_key]["error"] = f"Missing required columns: {required_columns}"
                except Exception as e:
                    validation[csv_key]["error"] = str(e)
        
        return validation
    
    def create_sample_csv_files(self):
        """Create sample CSV files for testing"""
        sample_tasks1 = pd.DataFrame({
            'target1': ['gold', 'sample', 'acid'],
            'target2': ['acid', 'gold', 'test'],
            'label': ['Gold-Acid Test', 'Sample Preparation', 'Acid Reaction'],
            'hold_seconds': [5, 3, 7],
            'min_fluctuations': [3, 2, 4]
        })
        
        sample_tasks2 = pd.DataFrame({
            'target1': ['electronic', 'probe', 'result'],
            'target2': ['probe', 'sample', 'display'],
            'label': ['Electronic Test', 'Probe Contact', 'Result Reading'],
            'hold_seconds': [4, 6, 5],
            'min_fluctuations': [2, 3, 3]
        })
        
        try:
            sample_tasks1.to_csv(self.csv1_path, index=False)
            sample_tasks2.to_csv(self.csv2_path, index=False)
            return {"success": True, "message": "Sample CSV files created"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # def cleanup(self):
    #     """Cleanup all resources"""
    #     self._stop_event.set()
        
    #     # Wait for threads to finish
    #     for thread in self._video_threads.values():
    #         if thread.is_alive():
    #             thread.join(timeout=2)
        
    #     # Clear all data structures
    #     self._video_threads.clear()
    #     self._frame_queues.clear()
    #     self.detection_states.clear()
        
    #     print("✓ Purity testing service cleaned up")
    
    def __del__(self):
        """Cleanup when object is destroyed"""
        try:
            if hasattr(self, 'camera1') and self.camera1:
                self.camera1.release()
            if hasattr(self, 'camera2') and self.camera2:
                self.camera2.release()
        except:
            pass
    
    # ===== NEW METHODS FOR START/STOP/VIDEO FEEDS =====
    
    def _try_open_camera(self, index: int) -> Optional[cv2.VideoCapture]:
        """Try to open camera with multiple backends"""
        backends = [
            ("Auto", cv2.CAP_ANY),
            ("Media Foundation", cv2.CAP_MSMF),
            ("DirectShow", cv2.CAP_DSHOW),
        ]
        
        for backend_name, backend in backends:
            try:
                print(f"  Trying {backend_name} backend...")
                cap = cv2.VideoCapture(index, backend)
                
                # Give it a moment to initialize
                import time
                time.sleep(0.5)
                
                if cap.isOpened():
                    # Try to read a frame to verify it works
                    ret, frame = cap.read()
                    if ret:
                        print(f"  ✅ Camera {index} opened with {backend_name}")
                        return cap
                    else:
                        print(f"  ⚠️ Camera opened but can't read frame")
                        cap.release()
                else:
                    cap.release()
            except Exception as e:
                print(f"  ❌ {backend_name} failed: {e}")
        
        return None
    
    def start(self, camera1_index: Optional[int] = None, camera2_index: Optional[int] = None):
        """Start purity testing cameras
        
        Args:
            camera1_index: Index of first camera (optional, auto-detected if not provided)
            camera2_index: Index of second camera (optional, auto-detected if not provided)
        """
        try:
            print("Starting purity testing service...")
            print("\n🔍 Scanning for cameras...")
            
            # Get available cameras if not specified
            if camera1_index is None or camera2_index is None:
                available_cameras = []
                for i in range(4):
                    print(f"\nChecking camera {i}...")
                    cap = self._try_open_camera(i)
                    if cap is not None:
                        available_cameras.append(i)
                        cap.release()
                    else:
                        print(f"Camera {i} not available")
                
                if len(available_cameras) < 1:
                    error_msg = """
No cameras available. Please:
1. Check if a camera is connected
2. Close other apps using the camera (Chrome, Teams, etc.)
3. Check camera permissions in Windows Settings
4. Try running: python backend/test_camera.py

See CAMERA_TROUBLESHOOTING.md for more help.
"""
                    raise Exception(error_msg)
                
                print(f"\n✅ Available cameras: {available_cameras}")
                
                # Auto-select cameras if not provided
                if camera1_index is None:
                    camera1_index = available_cameras[0]
                if camera2_index is None:
                    camera2_index = available_cameras[1] if len(available_cameras) > 1 else available_cameras[0]
            
            print(f"\n📹 Using Camera1: {camera1_index}, Camera2: {camera2_index}")
            
            print(f"\n📹 Opening camera1 (index {camera1_index})...")
            self.camera1 = self._try_open_camera(camera1_index)
            if not self.camera1:
                raise Exception(f"Failed to open camera {camera1_index}")
            
            # Set camera properties
            self.camera1.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.camera1.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.camera1.set(cv2.CAP_PROP_FPS, 30)
            print(f"  Camera1 configured: 640x480 @ 30fps")
            
            print(f"\n📹 Opening camera2 (index {camera2_index})...")
            if camera1_index != camera2_index:
                self.camera2 = self._try_open_camera(camera2_index)
                if not self.camera2:
                    print(f"  ⚠️ Warning: Failed to open second camera, using camera1 for both feeds")
                    self.camera2 = self.camera1
                else:
                    self.camera2.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    self.camera2.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    self.camera2.set(cv2.CAP_PROP_FPS, 30)
            else:
                print("Only one camera available, using it for both feeds")
                self.camera2 = self.camera1
            
            self.is_running = True
            self.current_task = "monitoring"
            
            print("✓ Purity testing service started successfully")
            return {
                "success": True,
                "message": "Purity testing started",
                "cameras": {
                    "camera1": camera1_index,
                    "camera2": camera2_index
                }
            }
            
        except Exception as e:
            print(f"Error starting purity testing: {e}")
            if self.camera1:
                self.camera1.release()
                self.camera1 = None
            if self.camera2 and self.camera2 != self.camera1:
                self.camera2.release()
                self.camera2 = None
            raise Exception(f"Failed to start purity testing: {str(e)}")
    
    def stop(self):
        """Stop purity testing cameras"""
        try:
            if self.camera1:
                self.camera1.release()
                self.camera1 = None
                print("cam1 released")
            
            if self.camera2 and self.camera2 != self.camera1:
                self.camera2.release()
                self.camera2 = None
                print("cam2 released")
            
            self.is_running = False
            self.current_task = None
            
            return {"success": True, "message": "Purity testing stopped"}
        except Exception as e:
            print(f"Error stopping purity testing: {e}")
            return {"success": False, "error": str(e)}
    
    def video_feed1(self):
        """Video feed from camera 1 with YOLO analysis"""
        from fastapi.responses import StreamingResponse
        
        def generate():
            while self.camera1 and self.camera1.isOpened():
                try:
                    ret, frame = self.camera1.read()
                    if not ret:
                        time.sleep(0.01)
                        continue
                    
                    # Apply YOLO analysis if model is available
                    if self.model1:
                        try:
                            frame = self.run_yolo_analysis_on_frame(frame)
                        except Exception as e:
                            cv2.putText(frame, f"Analysis Error: {str(e)[:30]}", 
                                      (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                    
                    # Encode frame as JPEG
                    ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ret:
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                    
                    time.sleep(0.033)  # ~30 FPS
                    
                except Exception as e:
                    print(f"Error in video feed 1: {e}")
                    time.sleep(0.1)
        
        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
    
    def video_feed2(self):
        """Video feed from camera 2 with YOLO analysis"""
        from fastapi.responses import StreamingResponse
        
        def generate():
            while self.camera2 and self.camera2.isOpened():
                try:
                    ret, frame = self.camera2.read()
                    if not ret:
                        time.sleep(0.01)
                        continue
                    
                    # Apply YOLO analysis if model is available
                    if self.model2:
                        try:
                            # Use model2 and csv2 for second camera
                            tasks = pd.read_csv(self.csv2_path) if os.path.exists(self.csv2_path) else None
                            if tasks is not None:
                                frame = self.run_yolo_with_csv(frame, self.model2, self.csv2_path, self.detection_states)
                        except Exception as e:
                            cv2.putText(frame, f"Analysis Error: {str(e)[:30]}", 
                                      (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                    
                    # Encode frame as JPEG
                    ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ret:
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                    
                    time.sleep(0.033)  # ~30 FPS
                    
                except Exception as e:
                    print(f"Error in video feed 2: {e}")
                    time.sleep(0.1)
        
        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
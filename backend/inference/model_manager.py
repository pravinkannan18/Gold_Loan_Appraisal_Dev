"""
Model Manager - Centralized loading and management of AI models
Supports YOLO (gold, stone, acid detection) and InsightFace (face recognition)
"""
import os
import warnings
import torch
import numpy as np
from typing import Optional, Dict, Any, Tuple
import logging

# Suppress warnings
warnings.filterwarnings("ignore")
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Patch torch.load for YOLO compatibility with PyTorch 2.6+
_original_torch_load = torch.load

def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _original_torch_load(*args, **kwargs)

torch.load = _patched_torch_load

# Try to import YOLO
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    logger.warning("⚠️ ultralytics not available - YOLO detection disabled")

# Try to import ONNX Runtime
try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
    # Check for CUDA support
    providers = ort.get_available_providers()
    CUDA_AVAILABLE = 'CUDAExecutionProvider' in providers
except ImportError:
    ONNX_AVAILABLE = False
    CUDA_AVAILABLE = False
    logger.warning("⚠️ onnxruntime not available")


class ModelManager:
    """
    Centralized model loading and management.
    
    Supports:
    - YOLO models for gold, stone, and acid detection
    - InsightFace for face recognition
    - Automatic GPU/CPU device selection
    - Model warmup for faster first inference
    """
    
    # Default model paths (actual files in ml_models)
    MODEL_GOLD_PATH = os.path.join(os.path.dirname(__file__), "..", "ml_models", "best_top2.pt")
    MODEL_STONE_PATH = os.path.join(os.path.dirname(__file__), "..", "ml_models", "best_top_stone.pt")
    MODEL_ACID_PATH = os.path.join(os.path.dirname(__file__), "..", "ml_models", "best_aci_liq.pt")
    
    def __init__(self):
        self.device = self._detect_device()
        self.models: Dict[str, Any] = {}
        self.initialized = False
        
        # Load models
        self._load_models()
        self._warmup_models()
    
    def _detect_device(self) -> str:
        """Detect best available device (CUDA or CPU)"""
        if torch.cuda.is_available():
            device = "cuda"
            gpu_name = torch.cuda.get_device_name(0)
            logger.info(f"🎮 Using GPU: {gpu_name}")
        else:
            device = "cpu"
            logger.info("💻 Using CPU for inference")
        return device
    
    def _load_models(self):
        """Load all YOLO models"""
        if not YOLO_AVAILABLE:
            logger.warning("YOLO not available - models not loaded")
            return
        
        # Load gold detection model (for rubbing)
        try:
            if os.path.exists(self.MODEL_GOLD_PATH):
                self.models["gold"] = YOLO(self.MODEL_GOLD_PATH)
                self.models["gold"].to(self.device)
                logger.info(f"✅ Loaded gold model: {os.path.basename(self.MODEL_GOLD_PATH)}")
            else:
                logger.warning(f"⚠️ Gold model not found: {self.MODEL_GOLD_PATH}")
        except Exception as e:
            logger.error(f"❌ Failed to load gold model: {e}")
        
        # Load stone detection model
        try:
            if os.path.exists(self.MODEL_STONE_PATH):
                self.models["stone"] = YOLO(self.MODEL_STONE_PATH)
                self.models["stone"].to(self.device)
                logger.info(f"✅ Loaded stone model: {os.path.basename(self.MODEL_STONE_PATH)}")
            else:
                logger.warning(f"⚠️ Stone model not found: {self.MODEL_STONE_PATH}")
        except Exception as e:
            logger.error(f"❌ Failed to load stone model: {e}")
        
        # Load acid detection model
        try:
            if os.path.exists(self.MODEL_ACID_PATH):
                self.models["acid"] = YOLO(self.MODEL_ACID_PATH)
                self.models["acid"].to(self.device)
                logger.info(f"✅ Loaded acid model: {os.path.basename(self.MODEL_ACID_PATH)}")
            else:
                logger.warning(f"⚠️ Acid model not found: {self.MODEL_ACID_PATH}")
        except Exception as e:
            logger.error(f"❌ Failed to load acid model: {e}")
        
        self.initialized = len(self.models) > 0
    
    def _warmup_models(self):
        """Warmup models with dummy inference for faster first prediction"""
        if not self.initialized:
            return
        
        logger.info("🔥 Warming up models...")
        dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        
        for name, model in self.models.items():
            try:
                _ = model(dummy_frame, verbose=False)
                logger.info(f"  ✓ {name} model warmed up")
            except Exception as e:
                logger.warning(f"  ⚠️ Failed to warmup {name}: {e}")
    
    def get_model(self, name: str) -> Optional[Any]:
        """Get a model by name"""
        return self.models.get(name)
    
    def predict(self, model_name: str, frame: np.ndarray, 
                conf: float = 0.5, iou: float = 0.5) -> Optional[Any]:
        """
        Run prediction on a frame using specified model.
        
        Args:
            model_name: Name of model (gold, stone, acid)
            frame: Input frame as numpy array
            conf: Confidence threshold
            iou: IOU threshold for NMS
            
        Returns:
            YOLO Results object or None
        """
        model = self.models.get(model_name)
        if not model:
            return None
        
        try:
            # Use fixed image size 320 as requested for performance
            results = model(frame, conf=conf, iou=iou, imgsz=320, verbose=False)
            return results[0] if results else None
        except Exception as e:
            logger.error(f"❌ Prediction error ({model_name}): {e}")
            return None
    
    def get_status(self) -> Dict:
        """Get model manager status"""
        return {
            "available": self.initialized,
            "device": self.device,
            "cuda_available": torch.cuda.is_available(),
            "yolo_available": YOLO_AVAILABLE,
            "onnx_available": ONNX_AVAILABLE,
            "models_loaded": list(self.models.keys()),
            "model_paths": {
                "gold": self.MODEL_GOLD_PATH,
                "stone": self.MODEL_STONE_PATH,
                "acid": self.MODEL_ACID_PATH
            }
        }


# Singleton instance
_model_manager: Optional[ModelManager] = None

def get_model_manager() -> ModelManager:
    """Get or create the model manager singleton"""
    global _model_manager
    if _model_manager is None:
        _model_manager = ModelManager()
    return _model_manager

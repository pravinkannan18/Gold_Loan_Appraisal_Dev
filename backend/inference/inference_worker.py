"""
Inference Worker - Main inference pipeline for video frames
Handles gold detection, rubbing analysis, and acid testing
"""
import cv2
import numpy as np
import time
from typing import Dict, Tuple, Optional, Any
from collections import deque
import logging

from .model_manager import get_model_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class InferenceWorker:
    """
    Main inference pipeline for processing video frames.
    
    Features:
    - Gold detection with rubbing motion analysis (distance-based fluctuation)
    - Stone detection with ROI-based gold inference
    - Acid test detection
    - Persisted gold masks to reduce flicker
    - Two-stage workflow: RUBBING -> ACID
    """
    
    # Configuration constants
    IMGSZ = 320  # Model inference size
    CONF_THRESH = 0.5
    IOU_THRESH = 0.5
    THRESHOLD_FLUCTUATION = 2.5  # Minimum distance change for meaningful movement (reduced for sensitivity)
    MIN_FLUCTUATIONS = 2  # Minimum direction changes for rubbing
    GOLD_MASK_PERSIST_FRAMES = 2  # How long to keep gold mask between detections (reduced for responsiveness)
    GOLD_INFERENCE_INTERVAL = 1  # Run gold inference EVERY frame for real-time tracking
    GOLD_OVERLAY_COLOR = (0, 255, 0)  # Green overlay for gold mask
    STONE_BOX_COLOR = (255, 0, 0)  # Blue for stone bbox
    RENDER_TEXT = True  # Whether to render status text on frames
    
    def __init__(self):
        self.model_manager = get_model_manager()
        
        # Rubbing motion tracking - distance-based
        self.recent_distances = deque(maxlen=30)
        
        # Detection state
        self.detection_status = {
            'last_distance': 0.0,
            'sound_status': 'Waiting...',
            'message': 'Place gold on stone and start rubbing',
            'stage': 'RUBBING',
            'rubbing_confirmed': False,
            'acid_detected': False
        }
        
        # Stage tracking
        self.stage = "RUBBING"
        self.rubbing_confirmed = False
        self.acid_detected = False
        self.visual_confirm_count = 0
        
        # Gold mask persistence
        self._last_gold_mask = None
        self._gold_mask_age = 0
        
        # Stone bbox smoothing
        self.prev_stone_bbox = None
        
        # Frame counter
        self._frame_idx = 0
        
        logger.info("🔧 InferenceWorker initialized with distance-based rubbing detection")
    
    def process_frame(self, frame: np.ndarray, current_task: str = "rubbing",
                      session_state: Dict = None) -> Tuple[np.ndarray, Dict]:
        """
        Process a single frame through the inference pipeline.
        
        Args:
            frame: Input frame (BGR numpy array)
            current_task: Current task (rubbing, acid, done)
            session_state: Session detection state dict
            
        Returns:
            Tuple of (annotated_frame, detection_result)
        """
        if session_state is None:
            session_state = {}
        
        # Track previous stage to detect transitions
        previous_stage = self.stage
        
        # Sync stage with current_task
        if current_task == "rubbing":
            self.stage = "RUBBING"
        elif current_task == "acid":
            self.stage = "ACID"
        elif current_task == "done":
            self.stage = "PLETED"
        
        # AUTO-RESET: If we just switched TO rubbing (from acid/done) = new item
        # This clears stale detection from previous item
        if self.stage == "RUBBING" and previous_stage != "RUBBING":
            logger.info("🔄 New item detected (switching to RUBBING) - resetting inference state")
            self._reset_for_new_item()
        
        # Also check session_state for item_index change
        current_item = session_state.get('current_item_index', 0)
        if not hasattr(self, '_last_item_index'):
            self._last_item_index = current_item
        elif current_item != self._last_item_index:
            logger.info(f"🔄 Item changed from {self._last_item_index} to {current_item} - resetting")
            self._reset_for_new_item()
            self._last_item_index = current_item
        
        annotated = frame.copy()
        detection_result = {
            "rubbing_detected": False,
            "acid_detected": False,
            "gold_purity": None,
            "detections": [],
            "stage": self.stage
        }
        
        try:
            if self.stage == "RUBBING":
                annotated, detection_result = self._process_rubbing(frame, annotated, detection_result)
            elif self.stage == "ACID":
                annotated, detection_result = self._process_acid(frame, annotated, detection_result)
            elif self.stage == "COMPLETED":
                self._draw_done_overlay(annotated)
        except Exception as e:
            logger.error(f"❌ Error in process_frame (stage={self.stage}): {e}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            cv2.putText(annotated, f"Error: {str(e)[:50]}", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        self._frame_idx += 1
        return annotated, detection_result
    
    def _process_rubbing(self, frame: np.ndarray, annotated: np.ndarray, 
                         detection_result: Dict) -> Tuple[np.ndarray, Dict]:
        """Process frame for rubbing detection using distance-based fluctuation"""
        
        # 1. Run Stone Detection FIRST
        largest_stone = None
        try:
            stone_result = self.model_manager.predict("stone", frame,
                                                       conf=self.CONF_THRESH,
                                                       iou=self.IOU_THRESH)
            
            if stone_result is not None and stone_result.boxes is not None and len(stone_result.boxes):
                # Get largest stone by area
                boxes = stone_result.boxes.xyxy.cpu().numpy()
                areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
                idx = np.argmax(areas)
                largest_stone = tuple(map(int, boxes[idx]))
                
                # Apply smoothing
                if self.prev_stone_bbox is not None:
                    px1, py1, px2, py2 = self.prev_stone_bbox
                    x1, y1, x2, y2 = largest_stone
                    prev_cx, prev_cy = (px1 + px2) / 2, (py1 + py2) / 2
                    curr_cx, curr_cy = (x1 + x2) / 2, (y1 + y2) / 2
                    dist = np.hypot(curr_cx - prev_cx, curr_cy - prev_cy)
                    
                    if dist < 10:
                        largest_stone = self.prev_stone_bbox
                    else:
                        alpha = 0.3
                        largest_stone = (
                            int(x1 * alpha + px1 * (1 - alpha)),
                            int(y1 * alpha + py1 * (1 - alpha)),
                            int(x2 * alpha + px2 * (1 - alpha)),
                            int(y2 * alpha + py2 * (1 - alpha))
                        )
                
                self.prev_stone_bbox = largest_stone
                
                # Draw stone bbox
                x1, y1, x2, y2 = largest_stone
                cv2.rectangle(annotated, (x1, y1), (x2, y2), self.STONE_BOX_COLOR, 3)
                
                detection_result["detections"].append({
                    "type": "stone",
                    "bbox": largest_stone,
                    "confidence": float(stone_result.boxes.conf[idx])
                })
        except Exception as e:
            logger.warning(f"Stone detection error: {e}")
        
        # 2. Use persisted gold mask or initialize empty
        h, w = annotated.shape[:2]
        if self._last_gold_mask is not None and self._last_gold_mask.shape == (h, w):
            gold_mask = self._last_gold_mask.copy()
        else:
            gold_mask = np.zeros((h, w), dtype=np.uint8)
        
        # Age and clear persisted mask if too old
        self._gold_mask_age += 1
        if self._gold_mask_age > self.GOLD_MASK_PERSIST_FRAMES:
            gold_mask = np.zeros_like(gold_mask)
            self._last_gold_mask = None
        
        # 3. Run Gold Detection inside Stone ROI (less frequently for performance)
        if largest_stone and (self._frame_idx % self.GOLD_INFERENCE_INTERVAL) == 0:
            try:
                sx1, sy1, sx2, sy2 = largest_stone
                
                # Add padding around bbox
                bw, bh = sx2 - sx1, sy2 - sy1
                pad = max(5, int(0.2 * max(bw, bh)))
                cx1 = max(0, sx1 - pad)
                cy1 = max(0, sy1 - pad)
                cx2 = min(w, sx2 + pad)
                cy2 = min(h, sy2 + pad)
                
                crop = frame[cy1:cy2, cx1:cx2]
                if crop.size == 0:
                    raise ValueError("Empty crop for gold inference")
                
                gold_result = self.model_manager.predict("gold", crop,
                                                          conf=self.CONF_THRESH,
                                                          iou=self.IOU_THRESH)
                
                if gold_result is not None and hasattr(gold_result, 'masks') and gold_result.masks is not None and len(gold_result.masks):
                    # Get first mask
                    mask = gold_result.masks.data[0].cpu().numpy()
                    if mask.ndim == 3:
                        mask = mask[0]
                    mask_bin = (mask > 0.5).astype(np.uint8) * 255
                    
                    # Resize mask to crop size
                    mask_resized = cv2.resize(mask_bin, (crop.shape[1], crop.shape[0]), 
                                              interpolation=cv2.INTER_NEAREST)
                    
                    # Place into full-frame mask
                    full_mask = np.zeros((h, w), dtype=np.uint8)
                    full_mask[cy1:cy2, cx1:cx2] = mask_resized
                    
                    # Clip to stone bbox
                    stone_mask = np.zeros_like(full_mask)
                    cv2.rectangle(stone_mask, (sx1, sy1), (sx2, sy2), 255, -1)
                    gold_clipped = cv2.bitwise_and(full_mask, stone_mask)
                    
                    gold_mask = gold_clipped.copy()
                    self._last_gold_mask = gold_mask.copy()
                    self._gold_mask_age = 0
                    
                    # Draw gold overlay
                    annotated[gold_mask > 0] = self.GOLD_OVERLAY_COLOR
                    
                    # Add detection result
                    if gold_result.boxes is not None and len(gold_result.boxes):
                        gx1, gy1, gx2, gy2 = map(int, gold_result.boxes.xyxy[0].tolist())
                        detection_result["detections"].append({
                            "type": "gold",
                            "bbox": (gx1 + cx1, gy1 + cy1, gx2 + cx1, gy2 + cy1),
                            "confidence": float(gold_result.boxes.conf[0])
                        })
                        
            except Exception as e:
                logger.warning(f"Gold mask error: {e}")
        
        # Draw persistent gold overlay if we have a mask
        if self._last_gold_mask is not None and np.any(self._last_gold_mask > 0):
            annotated[self._last_gold_mask > 0] = self.GOLD_OVERLAY_COLOR
        
        # 4. Compute rubbing motion using distance-based fluctuation
        annotated, rubbing = self._compute_rubbing_motion(annotated, gold_mask, largest_stone)
        
        # 5. Check visual OK (gold inside stone + rubbing motion)
        visual_ok = False
        if largest_stone is not None and np.sum(gold_mask) > 0 and rubbing:
            sx1, sy1, sx2, sy2 = largest_stone
            sx1, sy1 = max(0, sx1), max(0, sy1)
            sx2, sy2 = min(w, sx2), min(h, sy2)
            roi = gold_mask[sy1:sy2, sx1:sx2]
            if roi.size and np.any(roi > 0):
                visual_ok = True
        
        # Provide detailed detection flags to caller; do NOT auto-confirm stage here
        detection_result["rubbing_motion"] = rubbing
        detection_result["visual_ok"] = visual_ok
        if visual_ok:
            self.visual_confirm_count += 1
        # expose visual confirmation count so caller (video processor) can combine with audio
        detection_result["visual_confirm_count"] = self.visual_confirm_count

        # Update user-facing message for visual confirmations only (no stage change here)
        if self.RENDER_TEXT and not self.rubbing_confirmed:
            self.detection_status["message"] = f"Visual confirmations: {self.visual_confirm_count}/3"
        
        # Set status message (rendered by video processor overlay for consistent sizing)
        if self.RENDER_TEXT:
            # Keep detection_status.message up-to-date; overlay draws the message
            self.detection_status["stage"] = self.stage
            # message field already updated above for transitions and confirmations
        
        return annotated, detection_result
    
    def _compute_rubbing_motion(self, frame: np.ndarray, gold_mask: np.ndarray, 
                                 stone_bbox: Optional[Tuple]) -> Tuple[np.ndarray, bool]:
        """
        Compute rubbing motion using distance-based fluctuation detection.
        
        Rubbing is detected when the gold centroid oscillates back and forth
        relative to the stone center.
        """
        if stone_bbox is None or np.sum(gold_mask > 0) == 0:
            return frame, False
        
        # Calculate gold mask centroid
        M = cv2.moments(gold_mask)
        if M['m00'] == 0:
            return frame, False
        
        cx = int(M['m10'] / M['m00'])
        cy = int(M['m01'] / M['m00'])
        
        # Draw centroid
        cv2.circle(frame, (cx, cy), 4, (0, 0, 255), -1)
        
        # Calculate distance from stone center
        sx1, sy1, sx2, sy2 = stone_bbox
        scx = (sx1 + sx2) // 2
        scy = (sy1 + sy2) // 2
        dist = np.hypot(cx - scx, cy - scy)
        
        # Draw distance text
        try:
            cv2.putText(frame, f"Dist: {dist:.1f}", (cx + 10, cy - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        except Exception:
            pass
        
        self.recent_distances.append(dist)
        self.detection_status['last_distance'] = float(dist)
        
        # Detect rubbing through distance fluctuations
        rubbing = False
        if len(self.recent_distances) >= 3:
            diffs = np.diff(list(self.recent_distances))
            meaningful = np.abs(diffs) >= self.THRESHOLD_FLUCTUATION
            if np.sum(meaningful) >= 2:
                signs = np.sign(diffs[meaningful])
                if len(signs) >= 2:
                    sign_changes = np.sum(np.diff(signs) != 0)
                    rubbing = sign_changes >= self.MIN_FLUCTUATIONS
        
        return frame, rubbing
    
    def _process_acid(self, frame: np.ndarray, annotated: np.ndarray,
                      detection_result: Dict) -> Tuple[np.ndarray, Dict]:
        """Process frame for acid test detection"""
        try:
            acid_result = self.model_manager.predict("acid", frame,
                                                      conf=0.8,
                                                      iou=self.IOU_THRESH)
            
            acid_found = False
            
            if acid_result is not None and acid_result.boxes is not None:
                for box in acid_result.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])
                    cls = int(box.cls[0]) if hasattr(box, 'cls') else 0
                    
                    class_name = acid_result.names.get(cls, "Acid")
                    
                    detection_result["detections"].append({
                        "type": "acid",
                        "class": class_name,
                        "bbox": (x1, y1, x2, y2),
                        "confidence": conf
                    })
                    
                    # Draw acid detection
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 255), 3)
                    if self.RENDER_TEXT:
                        cv2.putText(annotated, f"{class_name} {conf:.2f}", (x1, y1 - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
                    
                    acid_found = True
                    
                    # Parse purity from class name
                    if "22k" in class_name.lower():
                        detection_result["gold_purity"] = "22K"
                    elif "18k" in class_name.lower():
                        detection_result["gold_purity"] = "18K"
                    elif "24k" in class_name.lower():
                        detection_result["gold_purity"] = "24K"
            
            if acid_found and not self.acid_detected:
                self.acid_detected = True
                self.stage = "COMPLETED"
                detection_result["acid_detected"] = True
                detection_result["stage"] = "COMPLETED"
                self.detection_status.update({
                    "message": "Purity test complete! Both rubbing and acid detected.",
                    "stage": "COMPLETED",
                    "acid_detected": True
                })
        except Exception as e:
            logger.error(f"Acid detection error: {e}")
        
        # Draw status text
        if self.RENDER_TEXT:
            cv2.putText(annotated, "STAGE 2: ACID DETECTION", (30, 60), 
                        cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 255, 255), 2)
            cv2.putText(annotated, self.detection_status.get("message", "")[:80], 
                        (30, annotated.shape[0] - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        return annotated, detection_result
    
    def _draw_done_overlay(self, frame: np.ndarray):
        """Draw completion overlay"""
        height, width = frame.shape[:2]
        
        # Semi-transparent overlay
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (width, height), (0, 100, 0), -1)
        cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)
        
        # Draw checkmark and text
        text = "ANALYSIS COMPLETE"
        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.2, 3)[0]
        x = (width - text_size[0]) // 2
        y = height // 2
        
        cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    
    def reset(self):
        """Reset internal state for new appraisal"""
        self.recent_distances.clear()
        self.stage = "RUBBING"
        self.rubbing_confirmed = False
        self.acid_detected = False
        self.visual_confirm_count = 0
        self._last_gold_mask = None
        self._gold_mask_age = 0
        self.prev_stone_bbox = None
        self._frame_idx = 0
        self.detection_status = {
            'last_distance': 0.0,
            'sound_status': 'Waiting...',
            'message': 'Place gold on stone and start rubbing',
            'stage': 'RUBBING',
            'rubbing_confirmed': False,
            'acid_detected': False
        }
        logger.info("🔄 InferenceWorker state reset")
    
    def _reset_for_new_item(self):
        """
        Partial reset for switching to a new item.
        Clears detection state but preserves stage management.
        """
        # Clear gold mask persistence (main cause of stale detection)
        self._last_gold_mask = None
        self._gold_mask_age = 0
        
        # Clear distance history (prevents false rubbing detection from old item)
        self.recent_distances.clear()
        
        # Reset rubbing confirmation counters
        self.visual_confirm_count = 0
        self.rubbing_confirmed = False
        self.acid_detected = False
        
        # Clear stone bbox to avoid showing old stone position briefly
        self.prev_stone_bbox = None
        
        # Reset frame counter
        self._frame_idx = 0
        
        # Update status message
        self.detection_status['message'] = 'Place gold on stone and start rubbing'
        self.detection_status['rubbing_confirmed'] = False
        self.detection_status['acid_detected'] = False
        
        logger.info("🧹 Detection state cleared for new item")

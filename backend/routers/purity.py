"""Purity Testing API routes"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/purity", tags=["purity-testing"])

# Request models
class StartPurityRequest(BaseModel):
    camera1_index: Optional[int] = None
    camera2_index: Optional[int] = None

class AnalyzeRequest(BaseModel):
    frame1: Optional[str] = None
    frame2: Optional[str] = None

# Dependency injection
purity_service = None

def set_service(service):
    global purity_service
    purity_service = service

@router.get("/status")
async def purity_status():
    """Get purity testing service status"""
    return {
        "available": purity_service.is_available(),
        "service": "PurityTestingService",
        "available_cameras": purity_service.get_available_cameras()
    }

@router.get("/cameras/list")
async def list_cameras():
    """Get detailed list of available cameras with their specifications"""
    try:
        cameras = purity_service.get_camera_details()
        return {
            "success": True,
            "cameras": cameras,
            "count": len(cameras)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/start")
async def purity_start(request: StartPurityRequest = None):
    """Start purity testing cameras and analysis
    
    Optional body parameters:
    - camera1_index: Index of first camera (0-3)
    - camera2_index: Index of second camera (0-3)
    
    If not provided, cameras will be auto-detected.
    """
    try:
        if request:
            return purity_service.start(
                camera1_index=request.camera1_index,
                camera2_index=request.camera2_index
            )
        else:
            return purity_service.start()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop")
async def purity_stop():
    """Stop purity testing cameras"""
    return purity_service.stop()

@router.get("/detection_status")
async def purity_detection_status():
    """Get current detection status"""
    return purity_service.get_detection_status()

@router.get("/video_feed1")
async def purity_video_feed1():
    """MJPEG stream from camera 1 with YOLO analysis"""
    return purity_service.video_feed1()

@router.get("/video_feed2")
async def purity_video_feed2():
    """MJPEG stream from camera 2 with YOLO analysis"""
    return purity_service.video_feed2()

@router.get("/cameras")
async def purity_cameras():
    """Get list of available cameras"""
    return {"available_cameras": purity_service.get_available_cameras()}

@router.get("/health")
async def purity_health():
    """Check health of purity testing service"""
    return {
        "cameras": [
            purity_service.camera1.isOpened() if purity_service.camera1 else False,
            purity_service.camera2.isOpened() if purity_service.camera2 else False
        ],
        "running": purity_service.is_running,
        "task": purity_service.current_task
    }

@router.post("/reset_status")
async def purity_reset():
    """Reset detection status"""
    purity_service.reset_detection_status()
    return {"success": True, "message": "Detection status reset"}

@router.get("/validate_csv")
async def purity_validate_csv():
    """Validate CSV task files"""
    return purity_service.validate_csv_files()

@router.post("/create_sample_csv")
async def purity_create_sample():
    """Create sample CSV files for testing"""
    return purity_service.create_sample_csv_files()

@router.post("/analyze_frame")
def analyze_frame(payload: dict):
    """Analyze a single frame with YOLO (for testing)"""
    import base64
    import cv2
    import numpy as np
    
    frame_b64 = payload.get("frame")
    if not frame_b64:
        raise HTTPException(status_code=400, detail="Missing 'frame'")

    img_bytes = base64.b64decode(frame_b64.split(",")[1])
    nparr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image")

    # Use the YOLO analysis method
    annotated = purity_service.run_yolo_analysis_on_frame(frame)

    _, buf = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    annotated_b64 = base64.b64encode(buf).decode()
    annotated_url = f"data:image/jpeg;base64,{annotated_b64}"

    return {
        "annotated_frame": annotated_url,
        "detection_status": purity_service.get_detection_status()
    }

@router.post("/analyze")
def analyze_dual_frames(request: AnalyzeRequest):
    """Analyze dual frames sent from frontend"""
    try:
        results = purity_service.analyze_frames(
            frame1_b64=request.frame1,
            frame2_b64=request.frame2
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

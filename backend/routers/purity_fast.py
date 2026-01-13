"""
Fast Purity Testing WebSocket Router
Provides real-time YOLO predictions via WebSocket streaming
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
import json

router = APIRouter(prefix="/api/purity/fast", tags=["purity-fast"])

# Service will be injected
fast_service = None

def set_service(service):
    global fast_service
    fast_service = service


class StartRequest(BaseModel):
    camera_index: Optional[int] = 0


# ============================================================================
# REST Endpoints
# ============================================================================

@router.get("/status")
async def get_status():
    """Get fast purity service status"""
    return fast_service.get_status()


@router.get("/cameras")
async def list_cameras():
    """List available cameras"""
    return {
        "cameras": fast_service.get_available_cameras(),
        "current": fast_service.camera_index if fast_service.is_running else None
    }


@router.post("/start")
async def start_service(request: StartRequest = None):
    """Start the fast purity testing service"""
    camera_index = request.camera_index if request else 0
    result = fast_service.start(camera_index)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to start"))
    return result


@router.post("/stop")
async def stop_service():
    """Stop the fast purity testing service"""
    return fast_service.stop()


@router.post("/reset")
async def reset_service():
    """Reset detection state (keep camera running)"""
    fast_service.reset()
    return {"success": True, "message": "Detection reset"}


@router.get("/frame")
async def get_frame():
    """Get latest processed frame (HTTP polling fallback)"""
    result = fast_service.get_latest_frame()
    if result:
        return result
    return {"frame": None, "status": fast_service.get_status()}


# ============================================================================
# WebSocket Streaming (Fastest Method)
# ============================================================================

@router.websocket("/stream")
async def websocket_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time frame streaming.
    
    Connect to: ws://localhost:8000/api/purity/fast/stream
    
    Messages sent to client:
    {
        "frame": "<base64 JPEG>",
        "status": {
            "task": "rubbing|acid|done",
            "rubbing_detected": bool,
            "acid_detected": bool,
            "message": str
        },
        "fps": float,
        "process_ms": float
    }
    
    Commands from client:
    - {"action": "start", "camera_index": 0}
    - {"action": "stop"}
    - {"action": "reset"}
    """
    await websocket.accept()
    print(f"🔌 WebSocket client connected")
    
    try:
        # Handle incoming commands and stream frames
        while True:
            # Check for incoming commands (non-blocking)
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(), 
                    timeout=0.01
                )
                cmd = json.loads(data)
                action = cmd.get("action")
                
                if action == "start":
                    camera_index = cmd.get("camera_index", 0)
                    result = fast_service.start(camera_index)
                    await websocket.send_json({"type": "control", "result": result})
                    
                elif action == "stop":
                    result = fast_service.stop()
                    await websocket.send_json({"type": "control", "result": result})
                    
                elif action == "reset":
                    fast_service.reset()
                    await websocket.send_json({"type": "control", "result": {"success": True}})
                    
            except asyncio.TimeoutError:
                pass  # No command received, continue streaming
            except json.JSONDecodeError:
                pass  # Invalid JSON, ignore

            # Send latest frame if available
            if fast_service.is_running:
                result = fast_service.get_latest_frame()
                if result:
                    await websocket.send_json({
                        "type": "frame",
                        **result
                    })
            else:
                # Send status only when not running
                await websocket.send_json({
                    "type": "status",
                    "status": fast_service.get_status()
                })
                await asyncio.sleep(0.5)  # Slower updates when idle

            await asyncio.sleep(0.01)  # Small delay for next frame

    except WebSocketDisconnect:
        print(f"🔌 WebSocket client disconnected")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
    finally:
        # Don't stop service on disconnect (other clients may be connected)
        pass


# ============================================================================
# MJPEG Streaming (Alternative for browsers without WebSocket)
# ============================================================================

@router.get("/mjpeg")
async def mjpeg_stream():
    """
    MJPEG stream for browsers/tools that don't support WebSocket.
    
    Usage: <img src="http://localhost:8000/api/purity/fast/mjpeg" />
    """
    async def generate():
        while fast_service.is_running:
            result = fast_service.get_latest_frame()
            if result and result.get("frame"):
                import base64
                frame_bytes = base64.b64decode(result["frame"])
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            await asyncio.sleep(0.033)  # ~30 FPS
    
    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

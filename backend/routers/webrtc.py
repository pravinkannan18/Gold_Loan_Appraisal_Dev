"""
WebRTC Signaling API Router
Handles SDP offer/answer exchange, ICE candidates, and session management.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from webrtc.signaling import webrtc_manager

router = APIRouter(prefix="/api/webrtc", tags=["webrtc"])


# ============================================================================
# Request/Response Models
# ============================================================================

class SDPOffer(BaseModel):
    """SDP offer from frontend"""
    sdp: str
    type: str = "offer"


class ICECandidate(BaseModel):
    """ICE candidate from frontend"""
    session_id: str
    candidate: str
    sdpMid: Optional[str] = None
    sdpMLineIndex: Optional[int] = None


class TaskUpdate(BaseModel):
    """Update current task for a session"""
    task: str  # rubbing, acid, done


# ============================================================================
# Signaling Endpoints
# ============================================================================

@router.post("/offer")
async def create_offer(offer: SDPOffer):
    """
    Process SDP offer from frontend and return SDP answer.
    Creates a new WebRTC peer connection session.
    """
    if not webrtc_manager.is_available():
        webrtc_manager.initialize()
    
    result = await webrtc_manager.create_session(offer.sdp, offer.type)
    
    if not result.get("success"):
        # Ensure we return a string detail for HTTPException
        err = result.get("error", "Failed to create session")
        if isinstance(err, dict):
            err = str(err)
        raise HTTPException(
            status_code=500,
            detail=err
        )
    
    return result


@router.post("/session/create")
async def create_session():
    """Create a new WebRTC session without SDP offer"""
    if not webrtc_manager.is_available():
        webrtc_manager.initialize()
    
    result = await webrtc_manager.create_session()
    return result


@router.post("/ice")
async def add_ice_candidate(candidate: ICECandidate):
    """Add ICE candidate to an existing WebRTC session"""
    result = await webrtc_manager.add_ice_candidate(
        candidate.session_id,
        {
            "candidate": candidate.candidate,
            "sdpMid": candidate.sdpMid,
            "sdpMLineIndex": candidate.sdpMLineIndex
        }
    )
    
    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to add ICE candidate")
        )
    
    return result


# ============================================================================
# Session Management
# ============================================================================

@router.get("/session/{session_id}")
async def get_session_status(session_id: str):
    """Get current status of a WebRTC session"""
    result = webrtc_manager.get_session_status(session_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    return result


@router.post("/session/{session_id}/task")
async def update_session_task(session_id: str, update: TaskUpdate):
    """Update the current task (rubbing/acid/done) for a session"""
    session = webrtc_manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    valid_tasks = ["rubbing", "acid", "done"]
    if update.task not in valid_tasks:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task. Must be one of: {', '.join(valid_tasks)}"
        )
    
    session.current_task = update.task
    return {"success": True, "current_task": session.current_task}


@router.post("/session/{session_id}/reset")
async def reset_session(session_id: str):
    """Reset detection status for a session"""
    result = webrtc_manager.reset_session(session_id)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=404,
            detail=result.get("error", "Failed to reset session")
        )
    
    return result


@router.delete("/session/{session_id}")
async def close_session(session_id: str):
    """Close and cleanup a WebRTC session"""
    result = await webrtc_manager.close_session(session_id)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=404,
            detail=result.get("error", "Session not found")
        )
    
    return result


# ============================================================================
# Status & Health
# ============================================================================

@router.get("/status")
async def get_webrtc_status():
    """Get WebRTC service availability and configuration status"""
    if not webrtc_manager.initialized:
        webrtc_manager.initialize()
    
    return {
        "webrtc": webrtc_manager.get_status(),
        "active_sessions": len(webrtc_manager.sessions) if hasattr(webrtc_manager, 'sessions') else 0
    }

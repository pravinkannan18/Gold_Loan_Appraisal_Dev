"""Session API routes for appraisal workflow data storage"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Any
import json

router = APIRouter(prefix="/api/session", tags=["session"])

# ============================================================================
# Pydantic Models (Request/Response Schemas)
# ============================================================================

class AppraiserData(BaseModel):
    name: str
    id: str
    image: str  # base64 image
    timestamp: str
    photo: Optional[str] = None  # Alternative field for photo

class CustomerImages(BaseModel):
    front_image: str  # base64 image
    side_image: Optional[str] = None  # base64 image

class JewelleryItemData(BaseModel):
    itemNumber: int
    image: str  # base64 image
    description: Optional[str] = None

class OverallImageData(BaseModel):
    id: int
    image: str  # base64 image
    timestamp: str

class RBIComplianceData(BaseModel):
    overall_images: List[OverallImageData]
    captured_items: List[JewelleryItemData]
    total_items: int
    capture_method: Optional[str] = None

class ItemTestResult(BaseModel):
    itemNumber: int
    rubbingCompleted: bool
    acidCompleted: bool
    timestamp: Optional[str] = None

class PurityTestData(BaseModel):
    items: List[ItemTestResult]
    total_items: int
    completed_at: Optional[str] = None

class SessionResponse(BaseModel):
    session_id: str
    success: bool
    message: Optional[str] = None

# ============================================================================
# Dependency Injection
# ============================================================================

db = None

def set_database(database):
    global db
    db = database

# ============================================================================
# POST Endpoints (Create/Update Operations)
# ============================================================================

@router.post("/create", response_model=SessionResponse)
async def create_session():
    """
    Create a new appraisal session
    
    Returns a session_id to be stored in localStorage
    """
    try:
        session_id = db.create_session()
        return SessionResponse(
            session_id=session_id,
            success=True,
            message="Session created successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@router.post("/{session_id}/appraiser", response_model=SessionResponse)
async def save_appraiser(session_id: str, data: AppraiserData):
    """
    Save appraiser data to session
    """
    try:
        appraiser_dict = data.dict()
        success = db.update_session_field(session_id, 'appraiser_data', appraiser_dict)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return SessionResponse(
            session_id=session_id,
            success=True,
            message="Appraiser data saved"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save appraiser data: {str(e)}")


@router.post("/{session_id}/customer", response_model=SessionResponse)
async def save_customer_images(session_id: str, data: CustomerImages):
    """
    Save customer images to session
    """
    try:
        updates = {
            'customer_front_image': data.front_image
        }
        if data.side_image:
            updates['customer_side_image'] = data.side_image
        
        success = db.update_session_multiple(session_id, updates)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return SessionResponse(
            session_id=session_id,
            success=True,
            message="Customer images saved"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save customer images: {str(e)}")


@router.post("/{session_id}/rbi-compliance", response_model=SessionResponse)
async def save_rbi_compliance(session_id: str, data: RBIComplianceData):
    """
    Save RBI compliance data (overall images and jewellery items) to session
    """
    try:
        rbi_dict = data.dict()
        
        # Also prepare jewellery items in the format expected by purity testing
        jewellery_items = []
        if data.captured_items and len(data.captured_items) == data.total_items:
            # Use individual items
            jewellery_items = [item.dict() for item in data.captured_items]
        elif data.overall_images:
            # Create items from overall image
            overall_image = data.overall_images[0].image if data.overall_images else ""
            jewellery_items = [
                {"itemNumber": i + 1, "image": overall_image, "description": f"Item {i + 1} (from overall)"}
                for i in range(data.total_items)
            ]
        
        updates = {
            'rbi_compliance': rbi_dict,
            'jewellery_items': jewellery_items,
            'total_items': data.total_items
        }
        
        success = db.update_session_multiple(session_id, updates)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return SessionResponse(
            session_id=session_id,
            success=True,
            message=f"RBI compliance saved with {data.total_items} items"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save RBI compliance: {str(e)}")


@router.post("/{session_id}/purity-test", response_model=SessionResponse)
async def save_purity_results(session_id: str, data: PurityTestData):
    """
    Save purity test results to session
    """
    try:
        purity_dict = data.dict()
        success = db.update_session_field(session_id, 'purity_results', purity_dict)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        # Also update status to 'purity_completed'
        try:
            db.update_session_field(session_id, 'status', 'purity_completed')
        except:
            pass # Non-critical if status update fails

        return SessionResponse(
            session_id=session_id,
            success=True,
            message="Purity test results saved"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save purity results: {str(e)}")


@router.post("/{session_id}/gps", response_model=SessionResponse)
async def save_gps_data(session_id: str, data: dict):
    """
    Save GPS/location data to session
    """
    try:
        success = db.update_session_field(session_id, 'gps_data', data)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return SessionResponse(
            session_id=session_id,
            success=True,
            message="GPS data saved"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save GPS data: {str(e)}")


@router.post("/{session_id}/finalize")
async def finalize_session(session_id: str):
    """
    Finalize session and mark as completed
    Could be extended to move data to permanent appraisal records
    """
    try:
        success = db.update_session_field(session_id, 'status', 'completed')
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return {
            "session_id": session_id,
            "success": True,
            "message": "Session finalized successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to finalize session: {str(e)}")


# ============================================================================
# GET Endpoints (Read Operations)
# ============================================================================

@router.get("/{session_id}")
async def get_session(session_id: str):
    """
    Get all session data
    """
    try:
        session = db.get_session(session_id)
        
        if not session:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return session
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get session: {str(e)}")


@router.get("/{session_id}/jewellery-items")
async def get_jewellery_items(session_id: str):
    """
    Get jewellery items for purity testing
    """
    try:
        session = db.get_session(session_id)
        
        if not session:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return {
            "session_id": session_id,
            "jewellery_items": session.get('jewellery_items', []),
            "total_items": session.get('total_items', 0)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get jewellery items: {str(e)}")


# ============================================================================
# DELETE Endpoints
# ============================================================================

@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a session
    """
    try:
        success = db.delete_session(session_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return {
            "session_id": session_id,
            "success": True,
            "message": "Session deleted"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {str(e)}")

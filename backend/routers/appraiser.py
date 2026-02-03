"""Appraiser API routes"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import traceback

router = APIRouter(prefix="/api/appraiser", tags=["appraiser"])

# Pydantic models
class AppraiserDetails(BaseModel):
    name: str
    id: str
    image: str
    timestamp: str
    bank: Optional[str] = None
    branch: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    # Add bank_id and branch_id fields to prevent auto-creation of duplicate banks
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    # RBAC fields for registration validation
    registrar_role: Optional[str] = None  # 'super_admin', 'bank_admin', 'branch_admin'
    registrar_bank_id: Optional[int] = None
    registrar_branch_id: Optional[int] = None

# Dependency injection (will be set in main.py)
db = None
facial_service = None

def set_database(database):
    global db
    db = database

def set_facial_service(service):
    global facial_service
    facial_service = service

@router.post("")
async def create_appraiser(appraiser: AppraiserDetails):
    """Create a new appraiser with face encoding extraction using InsightFace"""
    try:
        # RBAC Validation - Ensure registrar has permission to register in this bank/branch
        if appraiser.registrar_role:
            if appraiser.registrar_role == 'branch_admin':
                # Branch Admin can only register in their own branch
                if not appraiser.registrar_branch_id:
                    raise HTTPException(status_code=400, detail="Branch Admin must have a branch_id")
                if appraiser.branch_id and appraiser.branch_id != appraiser.registrar_branch_id:
                    raise HTTPException(
                        status_code=403, 
                        detail="Branch Admin can only register appraisers in their own branch"
                    )
                # Force the branch_id to be the registrar's branch
                appraiser.branch_id = appraiser.registrar_branch_id
                appraiser.bank_id = appraiser.registrar_bank_id
                
            elif appraiser.registrar_role == 'bank_admin':
                # Bank Admin can register in any branch of their bank
                if not appraiser.registrar_bank_id:
                    raise HTTPException(status_code=400, detail="Bank Admin must have a bank_id")
                if appraiser.bank_id and appraiser.bank_id != appraiser.registrar_bank_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Bank Admin can only register appraisers in their own bank"
                    )
                # Force the bank_id to be the registrar's bank
                appraiser.bank_id = appraiser.registrar_bank_id
                
            elif appraiser.registrar_role == 'super_admin':
                # Super Admin can register anywhere - no restrictions
                pass
            else:
                raise HTTPException(status_code=400, detail=f"Invalid registrar role: {appraiser.registrar_role}")
        
        face_encoding = None
        
        # Debug logging
        print(f"DEBUG: facial_service is None: {facial_service is None}")
        if facial_service:
            print(f"DEBUG: facial_service.is_available(): {facial_service.is_available()}")
        print(f"DEBUG: appraiser.image exists: {bool(appraiser.image)}")
        
        # Extract face encoding from image if facial service is available
        if facial_service and facial_service.is_available() and appraiser.image:
            try:
                print(f"Extracting face encoding for appraiser: {appraiser.name}")
                # Convert base64 to cv2 image and extract face embedding
                img = facial_service.base64_to_cv2_image(appraiser.image)
                if img is not None:
                    face_data = facial_service.extract_face_embedding(img)
                    if face_data and "embedding" in face_data:
                        # Convert numpy array to comma-separated string for storage
                        face_encoding = ",".join(map(str, face_data["embedding"]))
                        print(f"Face encoding extracted successfully for: {appraiser.name}")
                    else:
                        print(f"Warning: No face embedding extracted for {appraiser.name}")
                else:
                    print(f"Warning: Could not convert image for {appraiser.name}")
            except Exception as face_error:
                print(f"Warning: Face extraction failed for {appraiser.name}: {face_error}")
                traceback.print_exc()
                # Continue without face encoding - don't fail the registration
        else:
            print(f"Facial service not available, registering without face encoding")
        
        appraiser_db_id = db.insert_appraiser(
            name=appraiser.name,
            appraiser_id=appraiser.id,
            image_data=appraiser.image,
            timestamp=appraiser.timestamp,
            face_encoding=face_encoding,  # Now includes extracted face encoding
            bank=appraiser.bank,
            branch=appraiser.branch,
            email=appraiser.email,
            phone=appraiser.phone,
            # Pass IDs to prevent duplicate bank creation
            bank_id=appraiser.bank_id,
            branch_id=appraiser.branch_id
        )
        
        result_message = "Appraiser saved"
        if face_encoding:
            result_message += " with face encoding"
        else:
            result_message += " (face encoding not available - photo recognition may not work)"
            
        return {"success": True, "id": appraiser_db_id, "message": result_message, "has_face_encoding": bool(face_encoding)}
    
    except Exception as e:
        print(f"Error creating appraiser: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create appraiser: {str(e)}")

@router.get("/{appraiser_id}")
async def get_appraiser(appraiser_id: str):
    """Get appraiser by ID"""
    appraiser = db.get_appraiser_by_id(appraiser_id)
    if not appraiser:
        raise HTTPException(status_code=404, detail="Appraiser not found")
    return appraiser

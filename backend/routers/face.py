"""Facial Recognition API routes"""
from fastapi import APIRouter, Form, HTTPException
import traceback

router = APIRouter(prefix="/api/face", tags=["facial-recognition"])

# Dependency injection
facial_service = None

def set_service(service):
    global facial_service
    facial_service = service

@router.post("/register")
async def register_face(
    name: str = Form(...),
    appraiser_id: str = Form(...),
    image: str = Form(...),
    bank: str = Form(None),
    branch: str = Form(None),
    email: str = Form(None),
    phone: str = Form(None)
):
    """Register a new face for facial recognition"""
    try:
        result = facial_service.register_face(
            name, appraiser_id, image,
            bank=bank, branch=branch, email=email, phone=phone
        )
        return result
    except Exception as e:
        print(f"Error in register_face endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/recognize")
async def recognize_face(image: str = Form(...)):
    """Recognize a face from image"""
    try:
        if facial_service is None:
            raise HTTPException(status_code=500, detail="Facial service not initialized")
        result = facial_service.recognize_face(image)
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in recognize_face endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/identify")
async def identify_appraiser(
    image: str = Form(...),
    appraiser_id: str = Form(None),
    name: str = Form(None), 
    bank_id: str = Form(None),
    branch_id: str = Form(None)
):
    """Identify a specific appraiser by comparing with their registered face in specific bank/branch"""
    try:
        if facial_service is None:
            raise HTTPException(status_code=500, detail="Facial service not initialized")
        
        # Use the specific identify method for bank/branch context
        result = facial_service.identify_appraiser(
            image=image,
            expected_appraiser_id=appraiser_id,
            expected_name=name,
            bank_id=bank_id,
            branch_id=branch_id
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in identify_appraiser endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/appraisers")
async def get_registered_appraisers():
    """Get list of registered appraisers"""
    return {"appraisers": facial_service.get_registered_appraisers()}

@router.post("/info")
async def get_face_info(image: str = Form(...)):
    """Get face information from image"""
    return facial_service.get_face_info(image)

@router.post("/threshold")
async def update_threshold(threshold: float = Form(...)):
    """Update recognition threshold"""
    return facial_service.update_threshold(threshold)

@router.get("/status")
async def get_face_service_status():
    """Get facial recognition service status"""
    return {
        "available": facial_service.is_available(),
        "threshold": facial_service.threshold,
        "service": "FacialRecognitionService"
    }

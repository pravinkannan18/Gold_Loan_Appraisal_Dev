"""
Gold Loan Appraisal API
Backend API for Gold Loan Appraisal System with WebRTC video streaming.
"""
import os
import warnings
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv

# Suppress noisy warnings
warnings.filterwarnings("ignore", category=UserWarning, module="onnxruntime")
os.environ["ORT_LOG_LEVEL"] = "3"
os.environ["ORT_DISABLE_CUDA"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Load environment variables
load_dotenv()

# Import models and services
from models.database import Database
from services.camera_service import CameraService
from services.facial_recognition_service import FacialRecognitionService
from services.gps_service import GPSService
from services.classification_service import ClassificationService

# Import routers
from routers import (
    appraiser,
    appraisal,
    camera,
    face,
    gps,
    webrtc,
    session,
    classification,
    bank,
    branch,
    admin,
    super_admin,
    password_reset,
    tenant
)

# ============================================================================
# Application Setup
# ============================================================================

app = FastAPI(
    title="Gold Loan Appraisal API",
    version="3.0.0",
    description="Backend API for Gold Loan Appraisal System with WebRTC video streaming, facial recognition, and GPS"
)

# ============================================================================
# CORS Configuration
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],  # Allow all origins (Netlify, localhost, etc.)
    allow_credentials=True,  # Must be False when using allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ============================================================================
# Service Initialization
# ============================================================================

db = Database()
camera_service = CameraService()
facial_service = FacialRecognitionService(db)
gps_service = GPSService()
# Skip classification service for now to avoid model loading issues
# classification_service = ClassificationService()

# ============================================================================
# Router Dependency Injection
# ============================================================================

appraiser.set_database(db)
appraiser.set_facial_service(facial_service)  # Inject facial service for face encoding extraction
session.set_database(db)
camera.set_service(camera_service)
face.set_service(facial_service)
gps.set_service(gps_service)
# classification.set_service(classification_service)

# ============================================================================
# Register Routers
# ============================================================================

app.include_router(appraiser.router)
app.include_router(appraisal.router)
app.include_router(session.router)
app.include_router(camera.router)
app.include_router(face.router)
app.include_router(gps.router)
app.include_router(webrtc.router)
# app.include_router(classification.router)
app.include_router(bank.router)
app.include_router(branch.router)
app.include_router(admin.router)
app.include_router(super_admin.router)
app.include_router(password_reset.router)
app.include_router(tenant.router)

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
async def root():
    """API information and available endpoints"""
    return {
        "message": "Gold Loan Appraisal API",
        "version": "3.0.0",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "appraiser": "/api/appraiser",
            "appraisal": "/api/appraisal",
            "session": "/api/session",
            "camera": "/api/camera",
            "face": "/api/face",
            "webrtc": "/api/webrtc",
            "gps": "/api/gps",
            "classification": "/api/classification",
            "bank": "/api/bank",
            "branch": "/api/branch",
            "admin": "/api/admin",
            "super-admin": "/api/super-admin (hidden)"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    from webrtc.signaling import webrtc_manager
    
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": "connected" if db.test_connection() else "disconnected",
            "camera": "available" if camera_service.check_camera_available() else "unavailable",
            "facial_recognition": "available" if facial_service.is_available() else "unavailable",
            "webrtc": "available" if webrtc_manager.is_available() else "unavailable",
            "gps": "available" if gps_service.available else "unavailable",
            "classification": "available" if classification_service.is_available() else "unavailable"
        }
    }


@app.get("/api/statistics")
async def get_statistics():
    """Get overall system statistics"""
    return db.get_statistics()


# ============================================================================
# Lifecycle Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize services on application startup"""
    db.init_database()
    db.test_connection()
    
    from webrtc.signaling import webrtc_manager
    webrtc_manager.initialize()


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources on application shutdown"""
    from webrtc.signaling import webrtc_manager
    await webrtc_manager.cleanup()
    
    db.close()


# ============================================================================
# Development Server
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="warning"
    )

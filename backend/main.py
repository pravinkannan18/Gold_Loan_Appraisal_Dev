"""
Gold Loan Appraisal API - Main Application
Clean architecture with routers, services, and models separation
WebRTC-based real-time video streaming with aiortc
"""
import os

# Suppress ONNX Runtime CUDA warnings (YOLO uses PyTorch directly, not ONNX)
os.environ["ORT_LOG_LEVEL"] = "ERROR"  # Suppress ONNX Runtime warnings
os.environ["ORT_DISABLE_CUDA"] = "1"   # Don't try to load CUDA for ONNX
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import models and services
from models.database import Database
from services.camera_service import CameraService
from services.facial_recognition_service import FacialRecognitionService
from services.gps_service import GPSService

# Import routers
from routers import appraiser, appraisal, camera, face, gps, webrtc, session

# ============================================================================
# FastAPI App Initialization
# ============================================================================

app = FastAPI(
    title="Gold Loan Appraisal API",
    version="3.0.0",
    description="Backend API for Gold Loan Appraisal System with WebRTC video streaming, facial recognition, and GPS"
)

# ============================================================================
# CORS Middleware
# ============================================================================

# Allow all origins for production deployment (Netlify + local dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (Netlify, localhost, etc.)
    allow_credentials=False,  # Must be False when using allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ============================================================================
# Initialize Services (Singleton Pattern)
# ============================================================================

# Database
db = Database()

# Camera Service
camera_service = CameraService()

# Facial Recognition Service
facial_service = FacialRecognitionService(db)

# GPS Service
gps_service = GPSService()

# ============================================================================
# Dependency Injection for Routers
# ============================================================================

# Inject dependencies into routers
appraiser.set_database(db)
appraisal.set_database(db)
session.set_database(db)
camera.set_service(camera_service)
face.set_service(facial_service)
gps.set_service(gps_service)

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

# ============================================================================
# Root Endpoints
# ============================================================================

@app.get("/")
async def root():
    """API information endpoint"""
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
            "gps": "/api/gps"
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    db_status = db.test_connection()
    
    # Import webrtc service for health check
    from webrtc.signaling import webrtc_manager
    
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": "connected" if db_status else "disconnected",
            "camera": "available" if camera_service.check_camera_available() else "unavailable",
            "facial_recognition": "available" if facial_service.is_available() else "unavailable",
            "webrtc": "available" if webrtc_manager.is_available() else "unavailable",
            "gps": "available" if gps_service.available else "unavailable"
        }
    }

@app.get("/api/statistics")
async def get_statistics():
    """Get overall statistics"""
    return db.get_statistics()

# ============================================================================
# Lifecycle Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize database and services on startup"""
    # Initialize database tables
    db.init_database()
    
    # Test database connection
    db.test_connection()
    
    # Initialize WebRTC and inference
    from webrtc.signaling import webrtc_manager
    webrtc_manager.initialize()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    # Cleanup WebRTC sessions
    from webrtc.signaling import webrtc_manager
    await webrtc_manager.cleanup()
    
    # Close database connections
    db.close()

# ============================================================================
# Run Server
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

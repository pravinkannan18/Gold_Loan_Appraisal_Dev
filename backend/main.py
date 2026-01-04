"""
Gold Loan Appraisal API - Main Application
Clean architecture with routers, services, and models separation
"""
import os
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
from services.purity_testing_service import PurityTestingService
from services.gps_service import GPSService

# Import routers
from routers import appraiser, appraisal, camera, face, purity, gps

# ============================================================================
# FastAPI App Initialization
# ============================================================================

print("\n" + "="*70)
print("  Gold Loan Appraisal API - Initializing...")
print("="*70 + "\n")

app = FastAPI(
    title="Gold Loan Appraisal API",
    version="2.0.0",
    description="Backend API for Gold Loan Appraisal System with camera, facial recognition, purity testing, and GPS"
)

# ============================================================================
# CORS Middleware
# ============================================================================

# Allow both local development and production origins
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://embsys.netlify.app",
    "https://*.netlify.app",  # Allow all Netlify preview domains
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ============================================================================
# Initialize Services (Singleton Pattern)
# ============================================================================

print("Initializing services...")

# Database
db = Database()
print("✓ Database initialized")

# Camera Service
camera_service = CameraService()
print("✓ Camera service initialized")

# Facial Recognition Service
facial_service = FacialRecognitionService(db)
print(f"✓ Facial recognition service initialized (Available: {facial_service.is_available()})")

# Purity Testing Service
purity_service = PurityTestingService(database=db)
print(f"✓ Purity testing service initialized (Available: {purity_service.is_available()})")

# GPS Service
gps_service = GPSService()
print(f"✓ GPS service initialized")

print()

# ============================================================================
# Dependency Injection for Routers
# ============================================================================

# Inject dependencies into routers
appraiser.set_database(db)
appraisal.set_database(db)
camera.set_service(camera_service)
face.set_service(facial_service)
purity.set_service(purity_service)
gps.set_service(gps_service)

# ============================================================================
# Register Routers
# ============================================================================

app.include_router(appraiser.router)
app.include_router(appraisal.router)
app.include_router(camera.router)
app.include_router(face.router)
app.include_router(purity.router)
app.include_router(gps.router)

# ============================================================================
# Root Endpoints
# ============================================================================

@app.get("/")
async def root():
    """API information endpoint"""
    return {
        "message": "Gold Loan Appraisal API",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "appraiser": "/api/appraiser",
            "appraisal": "/api/appraisal",
            "camera": "/api/camera",
            "face": "/api/face",
            "purity": "/api/purity",
            "gps": "/api/gps"
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    db_status = db.test_connection()
    
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": "connected" if db_status else "disconnected",
            "camera": "available" if camera_service.check_camera_available() else "unavailable",
            "facial_recognition": "available" if facial_service.is_available() else "unavailable",
            "purity_testing": "available" if purity_service.is_available() else "unavailable",
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
    print("\n" + "="*70)
    print("  Application Starting...")
    print("="*70)
    
    # Initialize database tables
    db.init_database()
    print("✓ Database tables initialized")
    
    # Test database connection
    if db.test_connection():
        print("✓ Database connection successful")
    else:
        print("✗ Database connection failed")
    
    print("="*70)
    print("  Server Ready!")
    print("  API Docs: http://localhost:8000/docs")
    print("="*70 + "\n")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("\n" + "="*70)
    print("  Application Shutting Down...")
    print("="*70)
    
    # Stop purity testing if running
    if purity_service.is_running:
        purity_service.stop()
        print("✓ Purity testing service stopped")
    
    # Close database connections
    db.close()
    print("✓ Database connections closed")
    
    print("="*70)
    print("  Shutdown Complete")
    print("="*70 + "\n")

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

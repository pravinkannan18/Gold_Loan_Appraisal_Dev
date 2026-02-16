"""
Gold Loan Appraisal API
Backend API for Gold Loan Appraisal System with WebRTC video streaming.
"""
import os
import sys
import warnings
import logging
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import uvicorn
from dotenv import load_dotenv

# Configure logging first
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Suppress noisy warnings
warnings.filterwarnings("ignore", category=UserWarning, module="onnxruntime")
os.environ["ORT_LOG_LEVEL"] = "3"
os.environ["ORT_DISABLE_CUDA"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Load environment variables
load_dotenv()

# Import models and services
from models.database import Database, get_database
from services.camera_service import CameraService
from services.facial_recognition_service import FacialRecognitionService
from services.gps_service import GPSService
from services.classification_service import ClassificationService

# Import middleware
from middleware.error_handler import setup_exception_handlers
from middleware.rate_limiter import RateLimiter, RateLimitMiddleware
from middleware.request_validator import RequestValidationMiddleware
from middleware.logging_middleware import RequestLoggingMiddleware
from middleware.tenant_context import TenantContextMiddleware
from services.audio_service import initialize_audio_service

# Import routers
from routers import (
    appraiser,
    appraisal,
    audio,
    camera,
    face,
    gps,
    webrtc,
    session,
    classification,
    bank,
    branch,
    branch_admin,
    admin,
    super_admin,
    password_reset,
    tenant
)

# ============================================================================
# Application Setup with Lifespan
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown"""
    # Startup
    logger.info("🚀 Starting Gold Loan Appraisal API...")
    
    # Initialize database
    global db, camera_service, facial_service, gps_service
    db = get_database()
    logger.info("✅ Database connection pool initialized")
    
    # Initialize services
    camera_service = CameraService()
    facial_service = FacialRecognitionService(db)
    gps_service = GPSService()
    
    # Initialize audio service - pick uploaded model if present in ml_models
    ml_models_dir = os.path.join(os.path.dirname(__file__), "ml_models")
    audio_model_path = None
    try:
        if os.path.isdir(ml_models_dir):
            # Prefer files containing 'audio' in name, else any .pth/.pt
            candidates = [f for f in os.listdir(ml_models_dir) if f.lower().endswith(('.pth', '.pt'))]
            audio_candidates = [f for f in candidates if 'audio' in f.lower()]
            use_file = None
            if audio_candidates:
                use_file = audio_candidates[0]
            elif candidates:
                use_file = candidates[0]

            if use_file:
                audio_model_path = os.path.join(ml_models_dir, use_file)
                logger.info(f"🔍 Using audio model: {audio_model_path}")
    except Exception as e:
        logger.warning(f"Failed to locate audio model in ml_models: {e}")

    logger.info(f"🔍 Final Audio Model Path chosen: {audio_model_path}")
    initialize_audio_service(model_path=audio_model_path)
    logger.info("✅ Audio service initialized")
    
    logger.info("✅ Services initialized")
    
    # Initialize WebRTC
    from webrtc.signaling import webrtc_manager
    webrtc_manager.initialize()
    logger.info("✅ WebRTC manager initialized")
    
    # Inject dependencies into routers
    appraiser.set_database(db)
    appraiser.set_facial_service(facial_service)
    session.set_database(db)
    camera.set_service(camera_service)
    face.set_service(facial_service)
    gps.set_service(gps_service)
    logger.info("✅ Router dependencies injected")
    
    logger.info("🎉 API startup complete!")
    
    yield  # Application runs here
    
    # Shutdown
    logger.info("🛑 Shutting down Gold Loan Appraisal API...")
    
    await webrtc_manager.cleanup()
    logger.info("✅ WebRTC manager cleaned up")
    
    # Close database connections
    try:
        from models.database import _connection_pool
        if _connection_pool:
            _connection_pool.closeall()
            logger.info("✅ Database connection pool closed")
    except Exception as e:
        logger.warning(f"Error closing connection pool: {e}")
    
    logger.info("👋 Shutdown complete!")


app = FastAPI(
    title="Gold Loan Appraisal API",
    version="3.0.0",
    description="Backend API for Gold Loan Appraisal System with WebRTC video streaming, facial recognition, and GPS",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# ============================================================================
# Setup Exception Handlers
# ============================================================================

setup_exception_handlers(app)

# ============================================================================
# Middleware Configuration (order matters - executed in reverse order)
# ============================================================================

# 1. CORS (outermost - must be first to handle preflight)
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:8081,http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Response-Time", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
)

# 2. GZip compression for large responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

# 3. Request logging (logs all requests with timing)
app.add_middleware(RequestLoggingMiddleware, slow_threshold=2.0)

# 4. Request validation (validates input, checks for injection)
app.add_middleware(RequestValidationMiddleware, enable_sql_check=True, enable_xss_check=True)

# 5. Rate limiting (protects against abuse)
rate_limiter = RateLimiter(
    requests_per_minute=120,  # 2 requests per second average
    requests_per_second=15,   # Allow some burst
    burst_limit=30
)
app.add_middleware(RateLimitMiddleware, rate_limiter=rate_limiter)

# 6. Tenant context (multi-bank/branch isolation)
app.add_middleware(TenantContextMiddleware)

# ============================================================================
# Service Initialization (done in lifespan now)
# ============================================================================

db = None
camera_service = None
facial_service = None
gps_service = None

# ============================================================================
# Router Dependency Injection (done in lifespan now)
# ============================================================================

# Dependencies are injected in the lifespan handler above

# ============================================================================
# Register Routers
# ============================================================================

app.include_router(appraiser.router)
app.include_router(appraisal.router)
app.include_router(audio.router)
app.include_router(session.router)
app.include_router(camera.router)
app.include_router(face.router)
app.include_router(gps.router)
app.include_router(webrtc.router)
# app.include_router(classification.router)
app.include_router(bank.router)
app.include_router(branch.router)
app.include_router(branch_admin.router)
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
async def health_check(request: Request):
    """Health check endpoint for monitoring"""
    from webrtc.signaling import webrtc_manager
    
    # Get request ID if available
    request_id = getattr(request.state, 'request_id', 'unknown')
    
    # Perform health checks
    services_status = {
        "database": "unknown",
        "camera": "unknown",
        "facial_recognition": "unknown",
        "webrtc": "unknown",
        "gps": "unknown"
    }
    
    try:
        services_status["database"] = "connected" if db and db.test_connection() else "disconnected"
    except Exception:
        services_status["database"] = "error"
    
    try:
        services_status["camera"] = "available" if camera_service and camera_service.check_camera_available() else "unavailable"
    except Exception:
        services_status["camera"] = "error"
    
    try:
        services_status["facial_recognition"] = "available" if facial_service and facial_service.is_available() else "unavailable"
    except Exception:
        services_status["facial_recognition"] = "error"
    
    try:
        services_status["webrtc"] = "available" if webrtc_manager.is_available() else "unavailable"
    except Exception:
        services_status["webrtc"] = "error"
    
    try:
        services_status["gps"] = "available" if gps_service and gps_service.available else "unavailable"
    except Exception:
        services_status["gps"] = "error"
    
    # Determine overall health
    critical_services = ["database"]
    is_healthy = all(
        services_status.get(svc) in ["connected", "available"] 
        for svc in critical_services
    )
    
    return {
        "status": "healthy" if is_healthy else "degraded",
        "timestamp": datetime.now().isoformat(),
        "request_id": request_id,
        "services": services_status,
        "version": "3.0.0"
    }


@app.get("/api/statistics")
async def get_statistics():
    """Get overall system statistics"""
    if not db:
        return {"error": "Database not initialized", "success": False}
    return db.get_statistics()


@app.get("/api/ready")
async def readiness_check():
    """Kubernetes-style readiness probe"""
    from fastapi.responses import JSONResponse
    
    if not db:
        return JSONResponse(
            status_code=503,
            content={"ready": False, "reason": "Database not initialized"}
        )
    
    try:
        if db.test_connection():
            return JSONResponse(
                status_code=200,
                content={"ready": True}
            )
        else:
            return JSONResponse(
                status_code=503,
                content={"ready": False, "reason": "Database connection failed"}
            )
    except Exception as e:
        logger.error(f"Readiness check failed: {type(e).__name__}: {e}")
        return JSONResponse(
            status_code=500,
            content={"ready": False, "reason": "Internal server error during health check"}
        )


@app.get("/api/live")
async def liveness_check():
    """Kubernetes-style liveness probe"""
    return {"alive": True, "timestamp": datetime.now().isoformat()}


@app.get("/api/debug/query-stats")
async def get_query_stats():
    """
    Get database query performance statistics.
    Only available in development mode.
    """
    if os.getenv("ENVIRONMENT", "development") == "production":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    
    from middleware.profiling_middleware import get_profiler
    profiler = get_profiler()
    
    stats = profiler.get_stats()
    
    return {
        "query_stats": stats[:20],  # Top 20 slowest queries
        "total_unique_queries": len(stats),
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/debug/reset-query-stats")
async def reset_query_stats():
    """Reset query statistics. Only available in development mode."""
    if os.getenv("ENVIRONMENT", "development") == "production":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    
    from middleware.profiling_middleware import get_profiler
    profiler = get_profiler()
    profiler.reset_stats()
    
    return {"message": "Query statistics reset", "timestamp": datetime.now().isoformat()}


# ============================================================================
# Lifecycle Events (deprecated - using lifespan handler instead)
# ============================================================================

# Lifecycle events are now handled by the lifespan context manager above


# ============================================================================
# Development Server
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
        access_log=True,
        timeout_keep_alive=30
    )

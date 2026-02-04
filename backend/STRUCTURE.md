# Backend Project Structure

## Overview
The backend follows a clean architecture pattern with clear separation of concerns, robust error handling, and production-ready middleware.

```
backend/
├── main.py                          # FastAPI app with lifespan, middleware, routers
├── config.py                        # Configuration settings
├── requirements.txt                 # Python dependencies
├── .env                            # Environment variables (local only, not in git)
├── .env.example                    # Environment template
├── Dockerfile                      # Docker container configuration
├── README.md                       # Project documentation
│
├── middleware/                     # 🛡️ Middleware Layer (NEW)
│   ├── __init__.py
│   ├── error_handler.py            # Global exception handling with custom errors
│   ├── rate_limiter.py             # Sliding window rate limiting
│   ├── request_validator.py        # Input validation, SQL/XSS protection
│   └── logging_middleware.py       # Request logging with timing
│
├── routers/                        # 🎯 API Endpoints (HTTP Layer)
│   ├── __init__.py
│   ├── appraiser.py                # POST/GET appraiser endpoints
│   ├── appraisal.py                # CRUD appraisal endpoints
│   ├── admin.py                    # Admin management (bank/branch admins)
│   ├── bank.py                     # Bank CRUD endpoints
│   ├── branch.py                   # Branch CRUD endpoints
│   ├── branch_admin.py             # Dedicated branch admin endpoints
│   ├── camera.py                   # Camera operation endpoints
│   ├── classification.py           # Jewellery classification endpoints
│   ├── face.py                     # Facial recognition endpoints
│   ├── gps.py                      # GPS location endpoints
│   ├── password_reset.py           # Password reset flow
│   ├── session.py                  # Session management
│   ├── super_admin.py              # Super admin operations
│   ├── tenant.py                   # Tenant management
│   ├── tenant_management.py        # Advanced tenant operations
│   └── webrtc.py                   # WebRTC signaling endpoints
│
├── services/                       # 💼 Business Logic Layer
│   ├── __init__.py
│   ├── camera_service.py           # Camera capture and preview operations
│   ├── classification_service.py   # Jewellery classification with YOLO
│   ├── facial_recognition_service.py  # Face detection and recognition
│   └── gps_service.py              # GPS device and IP geolocation
│
├── models/                         # 💾 Data Layer
│   ├── __init__.py
│   ├── database.py                 # PostgreSQL with connection pooling
│   ├── schemas.py                  # Core Pydantic models
│   └── tenant_schemas.py           # Tenant-specific schemas
│
├── schemas/                        # 📋 Request/Response Schemas
│   ├── __init__.py
│   ├── appraisal.py                # Appraisal data schemas
│   ├── appraiser.py                # Appraiser schemas
│   ├── common.py                   # Shared schemas
│   ├── customer.py                 # Customer schemas
│   ├── purity.py                   # Purity testing schemas
│   ├── rbi.py                      # RBI compliance schemas
│   └── tenant.py                   # Tenant hierarchy schemas
│
├── utils/                          # 🔧 Utility Functions
│   ├── __init__.py
│   ├── db_utils.py                 # Database helpers with retry logic (NEW)
│   ├── validators.py               # Input validation utilities (NEW)
│   ├── setup_database.py           # Database initialization script
│   └── tenant_setup.py             # Tenant initialization utilities
│
├── webrtc/                         # 📹 WebRTC Module
│   ├── __init__.py
│   ├── signaling.py                # WebRTC signaling server
│   └── video_processor.py          # Video frame processing
│
├── ml_models/                      # 🤖 Machine Learning Models
│   ├── __init__.py
│   ├── README.md                   # Model documentation
│   ├── best_aci_liq.pt            # YOLO model for acid testing
│   ├── best_top_stone.pt          # YOLO model for stone detection
│   ├── best_top2.pt               # YOLO model for purity testing
│   ├── dbcnn.pth                  # 1D CNN model for serial data
│   └── jewellery_classification/   # Jewellery classification models
│       ├── class_names.json        # Classification labels
│       └── resnet50_local.pth      # ResNet50 classifier
│
└── data/                           # 📊 Data Files and Outputs
    ├── __init__.py
    ├── task_sequence.csv           # Rubbing test task definitions
    ├── task_sequence_main.csv      # Acid test task definitions
    ├── result.txt                  # Processing results
    └── model_results.txt           # Model outputs
```

## Layer Responsibilities

### 🛡️ Middleware (Cross-Cutting Concerns)
- **error_handler.py**: Global exception handling with custom error classes (APIError, DatabaseConnectionError, ValidationException, etc.)
- **rate_limiter.py**: Sliding window rate limiting per IP/endpoint with configurable limits
- **request_validator.py**: Input validation, SQL injection detection, XSS prevention, path traversal protection
- **logging_middleware.py**: Request/response logging with timing, slow request detection
- **tenant_context.py**: Multi-bank/branch tenant isolation and access control (NEW)

### 🎯 Routers (HTTP Layer)
- Handle HTTP requests and responses
- Input validation using Pydantic schemas
- Call service layer for business logic
- Return formatted JSON responses

### 💼 Services (Business Logic Layer)
- Core application logic
- Coordinate between routers and data layer
- Handle camera operations, ML inference, GPS
- Manage external integrations

### 💾 Models (Data Layer)
- **Connection Pooling**: ThreadedConnectionPool (2-20 connections)
- **Retry Logic**: Automatic retry on transient failures
- **Transaction Support**: Context managers for safe transactions
- Database operations with proper error handling

### 🔧 Utils (Utilities)
- **db_utils.py**: Database operations with retry logic, transactions, batch operations
- **validators.py**: Email, phone, password, bank code validation
- **tenant_queries.py**: Multi-tenant scoped database queries (NEW)
- Setup and initialization scripts

## Robustness Features

### 1. Connection Pooling
```python
# Singleton pool with 2-20 connections
_connection_pool = ThreadedConnectionPool(minconn=2, maxconn=20, ...)
```

### 2. Global Error Handling
```python
# Custom exceptions with consistent responses
class APIError(Exception):
    def __init__(self, message, status_code, error_code, details): ...

# Automatic exception -> JSON response conversion
setup_exception_handlers(app)
```

### 3. Rate Limiting
```python
# Per-IP, per-endpoint rate limiting
rate_limiter = RateLimiter(
    requests_per_minute=120,
    requests_per_second=15,
    burst_limit=30
)
```

### 4. Input Validation
- SQL injection pattern detection
- XSS pattern detection
- Path traversal prevention
- Content-type validation
- Request size limiting

### 5. Request Logging
- Unique request IDs for tracing
- Request/response timing
- Slow request warnings
- Error tracking

### 6. Multi-Tenant Isolation (Multiple Banks/Branches)
```python
# Automatic tenant context extraction from JWT/headers
app.add_middleware(TenantContextMiddleware)

# Get current tenant in any route
from middleware.tenant_context import get_current_tenant
ctx = get_current_tenant()

# Scoped queries automatically filter by bank/branch
from utils.tenant_queries import get_scoped_queries
scoped = get_scoped_queries(db, request)
sessions = scoped.get_sessions()  # Auto-filtered by tenant
```

**Tenant Hierarchy:**
```
Super Admin (all banks)
    └── Bank Admin (single bank, all branches)
            └── Branch Admin (single branch)
                    └── Appraiser (own sessions only)
```

**Automatic Data Isolation:**
- Bank admins see only their bank's data
- Branch admins see only their branch's data
- Appraisers see only their own sessions
- Super admins have full access

## API Endpoints Summary

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `/health` | Health check | No |
| `/api/ready` | Readiness probe | No |
| `/api/live` | Liveness probe | No |
| `/api/bank` | Bank CRUD | Super Admin |
| `/api/branch` | Branch CRUD | Super/Bank Admin |
| `/api/admin` | Admin management | Admin |
| `/api/super-admin` | Super admin ops | Super Admin |
| `/api/appraiser` | Appraiser registration | Admin |
| `/api/face` | Facial recognition | No |
| `/api/webrtc` | WebRTC signaling | No |
| `/api/session` | Appraisal sessions | Scoped |
| `/api/tenant` | Tenant management | Admin |

## Benefits of This Structure

1. **Separation of Concerns** - Each layer has a single responsibility
2. **Easy Testing** - Each component can be tested independently
3. **Maintainability** - Clear organization makes code easy to find and modify
4. **Scalability** - Easy to add new banks/branches without code changes
5. **Security** - Automatic tenant isolation prevents data leakage
6. **Professional** - Follows industry-standard multi-tenant SaaS patterns

## Multi-Tenant Architecture

### Database Schema
- **banks**: Top-level tenants with unique bank_code
- **branches**: Sub-tenants under banks with bank_id FK
- **bank_admins**: Bank-level administrators
- **branch_admins**: Branch-level administrators
- **tenant_users**: Appraisers linked to bank/branch
- **overall_sessions**: Sessions with bank_id/branch_id for isolation

### Access Control Matrix

| Role | Own Bank | Other Banks | All Branches | Own Branch |
|------|----------|-------------|--------------|------------|
| Super Admin | ✅ | ✅ | ✅ | ✅ |
| Bank Admin | ✅ | ❌ | ✅ | ✅ |
| Branch Admin | ✅ | ❌ | ❌ | ✅ |
| Appraiser | ✅ | ❌ | ❌ | ✅ |
- **Data Files**: 4

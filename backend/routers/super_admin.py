"""
Super Admin management API router
Handles all super admin authentication and token management
Hidden endpoints not exposed in API documentation
Uses JWT tokens for persistent sessions
"""
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from pydantic import BaseModel
import logging
import os
import jwt
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/super-admin", tags=["super-admin"])

# ============================================================================
# Super Admin Configuration (Environment-based for security)
# ============================================================================

# Super Admin credentials (in production, use environment variables)
SUPER_ADMIN_EMAILS = os.getenv("SUPER_ADMIN_EMAILS", "embsysintelligence@gmail.com,pravinkannan18@gmail.com").split(",")
SUPER_ADMIN_PHONE_NUMBERS = os.getenv("SUPER_ADMIN_PHONE_NUMBERS", "7418562461,9944865029").split(",")
SUPER_ADMIN_PASSWORD = os.getenv("SUPER_ADMIN_PASSWORD", "embsysai@123")

# JWT Configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "super-admin-secret-key-2024-embsys-gold-loan")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_MINUTES = 60  # Token valid for 60 minutes (increased from 10)

# Blacklisted tokens (for logout)
BLACKLISTED_TOKENS = set()

# ============================================================================
# Helper Functions
# ============================================================================

def generate_super_admin_token(credential: str) -> str:
    """Generate a JWT token for super admin session"""
    expiration = datetime.utcnow() + timedelta(minutes=JWT_EXPIRATION_MINUTES)
    payload = {
        "credential": credential,
        "role": "super_admin",
        "exp": expiration,
        "iat": datetime.utcnow()
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token

def validate_super_admin_token(token: str) -> bool:
    """Validate if token is a valid super admin JWT token"""
    if not token or token in BLACKLISTED_TOKENS:
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        # Check if token has super_admin role
        if payload.get("role") != "super_admin":
            return False
        return True
    except jwt.ExpiredSignatureError:
        logger.warning("Super admin token expired")
        return False
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid super admin token: {e}")
        return False

# ============================================================================
# Request/Response Models
# ============================================================================

class SuperAdminLoginRequest(BaseModel):
    """Super Admin login request model"""
    credential: str  # Can be email or phone
    password: str

class SuperAdminLoginResponse(BaseModel):
    """Super Admin login response model"""
    success: bool
    message: str
    token: Optional[str] = None
    user: Optional[dict] = None

class SuperAdminVerifyResponse(BaseModel):
    """Super Admin token verification response"""
    valid: bool
    role: Optional[str] = None

# ============================================================================
# Super Admin Endpoints (Hidden from API docs)
# ============================================================================

@router.post("/login", include_in_schema=False)
async def super_admin_login(login_data: SuperAdminLoginRequest) -> SuperAdminLoginResponse:
    """
    Super Admin login endpoint - HIDDEN from API docs
    Only accessible via direct POST request
    Supports email or phone as credential
    
    Credentials:
    - Emails: embsysintelligence@gmail.com, pravinkannan18@gmail.com
    - Phones: 7418562461, 9944865029
    - Password: embsysai@123
    """
    try:
        # Clean up credentials (remove spaces)
        clean_credential = login_data.credential.strip()
        
        # Check if credential matches email or phone list
        is_valid_email = clean_credential in [e.strip() for e in SUPER_ADMIN_EMAILS]
        is_valid_phone = clean_credential in [p.strip() for p in SUPER_ADMIN_PHONE_NUMBERS]
        is_valid_credential = is_valid_email or is_valid_phone
        
        # Validate super admin credentials
        if is_valid_credential and login_data.password == SUPER_ADMIN_PASSWORD:
            token = generate_super_admin_token(clean_credential)
            credential_type = "email" if is_valid_email else "phone"
            
            logger.info(f"Super Admin login successful: {credential_type} - {clean_credential}")
            return SuperAdminLoginResponse(
                success=True,
                message="Super Admin login successful",
                token=token,
                user={
                    "credential": clean_credential,
                    "credential_type": credential_type,
                    "role": "super_admin",
                    "name": "Super Administrator",
                    "bank_id": None,
                    "branch_id": None
                }
            )
        else:
            # Return generic error - don't reveal what's wrong
            logger.warning(f"Failed super admin login attempt: {clean_credential}")
            return SuperAdminLoginResponse(
                success=False,
                message="Invalid credentials",
                token=None,
                user=None
            )
    except Exception as e:
        logger.error(f"Super admin login error: {e}")
        return SuperAdminLoginResponse(
            success=False,
            message="Authentication failed",
            token=None,
            user=None
        )

@router.post("/logout", include_in_schema=False)
async def super_admin_logout(x_super_admin_token: Optional[str] = Header(None)):
    """
    Super Admin logout - blacklist the JWT token
    """
    try:
        if x_super_admin_token and validate_super_admin_token(x_super_admin_token):
            BLACKLISTED_TOKENS.add(x_super_admin_token)
            logger.info("Super Admin logout successful - token blacklisted")
            return {"success": True, "message": "Logged out successfully"}
        
        logger.warning("Logout attempt with invalid token")
        return {"success": False, "message": "Invalid token"}
    except Exception as e:
        logger.error(f"Super admin logout error: {e}")
        return {"success": False, "message": "Logout failed"}

@router.get("/verify", include_in_schema=False)
async def verify_super_admin(x_super_admin_token: Optional[str] = Header(None)) -> SuperAdminVerifyResponse:
    """
    Verify if super admin token is valid
    Returns token validity status and role
    """
    try:
        if x_super_admin_token and validate_super_admin_token(x_super_admin_token):
            logger.info("Super Admin token verification successful")
            return SuperAdminVerifyResponse(valid=True, role="super_admin")
        
        logger.debug("Super Admin token verification failed - invalid token")
        return SuperAdminVerifyResponse(valid=False)
    except Exception as e:
        logger.error(f"Super admin verification error: {e}")
        return SuperAdminVerifyResponse(valid=False)

@router.get("/health", include_in_schema=False)
async def super_admin_health():
    """
    Health check endpoint for super admin service
    """
    return {
        "status": "healthy",
        "service": "super-admin",
        "emails_configured": len(SUPER_ADMIN_EMAILS),
        "phones_configured": len(SUPER_ADMIN_PHONE_NUMBERS)
    }

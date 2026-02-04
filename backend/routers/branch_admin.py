"""
Branch Admin Management API Router

Handles all branch administrator operations with proper access control.
Branch admins have exclusive access to their assigned branch only.

Features:
- Branch admin authentication
- CRUD operations for branch admins
- Access verification and authorization
- Branch-scoped permissions
"""

from fastapi import APIRouter, HTTPException, Depends, Header
from typing import List, Optional
from sqlalchemy.orm import Session
from models.database import get_db
from schemas.tenant import (
    BranchAdminCreate, BranchAdminUpdate, BranchAdminResponse,
    BranchAdminLoginRequest, BranchAdminLoginResponse
)
import logging
import hashlib
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/branch-admin", tags=["branch-admin"])

# ============================================================================
# Helper Functions
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_bank_admin_access(x_bank_admin_token: Optional[str] = Header(None),
                             bank_id: Optional[int] = None) -> dict:
    """
    Verify that the requester is a bank admin with access to the specified bank.
    This should be replaced with proper JWT token validation in production.
    """
    # TODO: Implement proper JWT token validation
    # For now, we'll use a simple token check
    if not x_bank_admin_token:
        raise HTTPException(status_code=401, detail="Bank admin authentication required")
    
    # In production, decode JWT and extract bank_id, role, etc.
    # For now, accept any token
    return {"role": "bank_admin", "bank_id": bank_id}

def verify_branch_admin_token(x_branch_admin_token: Optional[str] = Header(None)) -> dict:
    """
    Verify branch admin token and extract admin info.
    This should be replaced with proper JWT token validation in production.
    """
    # TODO: Implement proper JWT token validation
    if not x_branch_admin_token:
        raise HTTPException(status_code=401, detail="Branch admin authentication required")
    
    # In production, decode JWT and return admin_id, bank_id, branch_id
    return {"admin_id": 1, "bank_id": 1, "branch_id": 1}

# ============================================================================
# Authentication Endpoints
# ============================================================================

@router.post("/login", response_model=BranchAdminLoginResponse)
async def branch_admin_login(
    login_data: BranchAdminLoginRequest,
    db: Session = Depends(get_db)
) -> BranchAdminLoginResponse:
    """
    Branch admin login endpoint with bank/branch verification.
    
    - Validates email and password
    - Verifies admin belongs to specified bank and branch
    - Returns admin info with token (in production, use JWT)
    """
    try:
        # Hash the provided password
        password_hash = hash_password(login_data.password)
        
        # Get branch admin by email with bank/branch filtering
        admin = db.get_branch_admin_by_email(
            email=login_data.email,
            bank_id=login_data.bank_id,
            branch_id=login_data.branch_id
        )
        
        if not admin:
            logger.warning(f"Login failed: No admin found with email {login_data.email} "
                         f"for bank {login_data.bank_id}, branch {login_data.branch_id}")
            return BranchAdminLoginResponse(
                success=False,
                message="Invalid credentials or insufficient access"
            )
        
        # Verify password
        if admin['password_hash'] != password_hash:
            logger.warning(f"Login failed: Invalid password for {login_data.email}")
            return BranchAdminLoginResponse(
                success=False,
                message="Invalid credentials"
            )
        
        # Check if admin is active
        if not admin['is_active']:
            logger.warning(f"Login failed: Inactive admin {login_data.email}")
            return BranchAdminLoginResponse(
                success=False,
                message="Account is inactive. Please contact your bank administrator."
            )
        
        # Update last login timestamp
        db.update_branch_admin_login(admin['id'])
        
        # In production, generate JWT token here
        # For now, use a simple token (admin_id as string)
        token = f"branch_admin_{admin['id']}"
        
        logger.info(f"Branch admin login successful: {admin['email']} "
                   f"(Bank: {admin['bank_name']}, Branch: {admin['branch_name']})")
        
        return BranchAdminLoginResponse(
            success=True,
            message="Login successful",
            admin=BranchAdminResponse(**admin),
            token=token
        )
        
    except Exception as e:
        logger.error(f"Error during branch admin login: {e}")
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")

# ============================================================================
# Branch Admin CRUD Endpoints (Bank Admin Access Required)
# ============================================================================

@router.post("/", response_model=BranchAdminResponse, status_code=201)
async def create_branch_admin(
    admin_data: BranchAdminCreate,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> BranchAdminResponse:
    """
    Create a new branch administrator.
    
    **Requires:** Bank Admin access
    
    **Validates:**
    - Branch belongs to the specified bank
    - No duplicate email within the same bank/branch
    - Password meets security requirements
    """
    try:
        # Verify bank admin has access to this bank
        if auth.get('bank_id') and auth['bank_id'] != admin_data.bank_id:
            raise HTTPException(
                status_code=403,
                detail="You don't have access to create admins for this bank"
            )
        
        # Hash the password
        password_hash = hash_password(admin_data.password)
        
        # Create branch admin
        admin_id = db.create_branch_admin(
            bank_id=admin_data.bank_id,
            branch_id=admin_data.branch_id,
            admin_id=admin_data.admin_id,
            full_name=admin_data.full_name,
            email=admin_data.email,
            password_hash=password_hash,
            phone=admin_data.phone,
            permissions=admin_data.permissions.dict() if admin_data.permissions else None,
            created_by=auth.get('admin_id')  # Track who created this admin
        )
        
        # Retrieve and return the created admin
        admin = db.get_branch_admin_by_id(admin_id)
        
        logger.info(f"Branch admin created: {admin['email']} "
                   f"(Bank: {admin['bank_name']}, Branch: {admin['branch_name']})")
        
        return BranchAdminResponse(**admin)
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating branch admin: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating branch admin: {str(e)}")

@router.get("/bank/{bank_id}", response_model=List[BranchAdminResponse])
async def get_bank_branch_admins(
    bank_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> List[BranchAdminResponse]:
    """
    Get all branch admins for a specific bank.
    
    **Requires:** Bank Admin access for the specified bank
    """
    try:
        # Verify bank admin has access to this bank
        if auth.get('bank_id') and auth['bank_id'] != bank_id:
            raise HTTPException(
                status_code=403,
                detail="You don't have access to view admins for this bank"
            )
        
        admins = db.get_branch_admins_by_bank(bank_id)
        return [BranchAdminResponse(**admin) for admin in admins]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving branch admins for bank {bank_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admins: {str(e)}")

@router.get("/branch/{branch_id}", response_model=List[BranchAdminResponse])
async def get_branch_admins(
    branch_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> List[BranchAdminResponse]:
    """
    Get all admins for a specific branch.
    
    **Requires:** Bank Admin access
    """
    try:
        admins = db.get_branch_admins_by_branch(branch_id)
        
        # Verify bank admin has access to this bank
        if admins and auth.get('bank_id'):
            if admins[0]['bank_id'] != auth['bank_id']:
                raise HTTPException(
                    status_code=403,
                    detail="You don't have access to view admins for this branch"
                )
        
        return [BranchAdminResponse(**admin) for admin in admins]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving admins for branch {branch_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admins: {str(e)}")

@router.get("/{admin_id}", response_model=BranchAdminResponse)
async def get_branch_admin(
    admin_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> BranchAdminResponse:
    """
    Get branch admin by ID.
    
    **Requires:** Bank Admin access to the admin's bank
    """
    try:
        admin = db.get_branch_admin_by_id(admin_id)
        
        if not admin:
            raise HTTPException(status_code=404, detail="Branch admin not found")
        
        # Verify bank admin has access to this bank
        if auth.get('bank_id') and auth['bank_id'] != admin['bank_id']:
            raise HTTPException(
                status_code=403,
                detail="You don't have access to view this admin"
            )
        
        return BranchAdminResponse(**admin)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving branch admin {admin_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admin: {str(e)}")

@router.put("/{admin_id}", response_model=BranchAdminResponse)
async def update_branch_admin(
    admin_id: int,
    update_data: BranchAdminUpdate,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> BranchAdminResponse:
    """
    Update branch admin information.
    
    **Requires:** Bank Admin access to the admin's bank
    """
    try:
        # Get existing admin
        admin = db.get_branch_admin_by_id(admin_id)
        
        if not admin:
            raise HTTPException(status_code=404, detail="Branch admin not found")
        
        # Verify bank admin has access to this bank
        if auth.get('bank_id') and auth['bank_id'] != admin['bank_id']:
            raise HTTPException(
                status_code=403,
                detail="You don't have access to update this admin"
            )
        
        # Hash new password if provided
        password_hash = None
        if update_data.password:
            password_hash = hash_password(update_data.password)
        
        # Update admin
        success = db.update_branch_admin(
            admin_id=admin_id,
            full_name=update_data.full_name,
            email=update_data.email,
            phone=update_data.phone,
            password_hash=password_hash,
            permissions=update_data.permissions.dict() if update_data.permissions else None,
            is_active=update_data.is_active
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to update admin")
        
        # Return updated admin
        updated_admin = db.get_branch_admin_by_id(admin_id)
        
        logger.info(f"Branch admin updated: {updated_admin['email']}")
        
        return BranchAdminResponse(**updated_admin)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating branch admin {admin_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating admin: {str(e)}")

@router.delete("/{admin_id}", status_code=204)
async def delete_branch_admin(
    admin_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_bank_admin_access)
) -> None:
    """
    Delete (deactivate) a branch admin.
    
    **Requires:** Bank Admin access to the admin's bank
    
    **Note:** This is a soft delete - the admin is marked as inactive.
    """
    try:
        # Get existing admin
        admin = db.get_branch_admin_by_id(admin_id)
        
        if not admin:
            raise HTTPException(status_code=404, detail="Branch admin not found")
        
        # Verify bank admin has access to this bank
        if auth.get('bank_id') and auth['bank_id'] != admin['bank_id']:
            raise HTTPException(
                status_code=403,
                detail="You don't have access to delete this admin"
            )
        
        # Soft delete
        success = db.delete_branch_admin(admin_id)
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to delete admin")
        
        logger.info(f"Branch admin deactivated: {admin['email']}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting branch admin {admin_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting admin: {str(e)}")

# ============================================================================
# Branch Admin Self-Service Endpoints
# ============================================================================

@router.get("/me/info", response_model=BranchAdminResponse)
async def get_current_admin_info(
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_branch_admin_token)
) -> BranchAdminResponse:
    """
    Get current branch admin's information.
    
    **Requires:** Branch Admin authentication token
    """
    try:
        admin = db.get_branch_admin_by_id(auth['admin_id'])
        
        if not admin:
            raise HTTPException(status_code=404, detail="Admin not found")
        
        return BranchAdminResponse(**admin)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving admin info: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving info: {str(e)}")

@router.post("/me/verify-access")
async def verify_admin_access(
    bank_id: int,
    branch_id: int,
    db: Session = Depends(get_db),
    auth: dict = Depends(verify_branch_admin_token)
) -> dict:
    """
    Verify that the current branch admin has access to specified bank/branch.
    
    Used for authorization checks in other endpoints.
    """
    try:
        has_access = db.verify_branch_admin_access(
            admin_id=auth['admin_id'],
            bank_id=bank_id,
            branch_id=branch_id
        )
        
        return {
            "has_access": has_access,
            "admin_id": auth['admin_id'],
            "bank_id": bank_id,
            "branch_id": branch_id
        }
        
    except Exception as e:
        logger.error(f"Error verifying admin access: {e}")
        raise HTTPException(status_code=500, detail=f"Error verifying access: {str(e)}")

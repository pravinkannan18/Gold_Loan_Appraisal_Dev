"""
Branch management API router
Handles all branch-related operations
Super Admin or Bank Admin required for create/update/delete operations
"""
from fastapi import APIRouter, HTTPException, Depends, Header
from typing import List, Optional
from sqlalchemy.orm import Session
from models.database import get_db
from schemas.tenant import BranchCreate, BranchUpdate, BranchResponse
from routers.super_admin import validate_super_admin_token
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/branch", tags=["branch"])

def check_admin_access(x_super_admin_token: Optional[str] = Header(None)):
    """Check if user has super admin or bank admin access for branch operations"""
    # Super admin has full access
    if x_super_admin_token and validate_super_admin_token(x_super_admin_token):
        return {"role": "super_admin", "bank_id": None}
    # Bank admin access is verified at the API level based on bank_id
    return {"role": "bank_admin", "bank_id": None}

@router.get("/", response_model=List[BranchResponse])
async def get_all_branches(db: Session = Depends(get_db)) -> List[BranchResponse]:
    """Get all branches across all banks"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT b.id, b.bank_id, b.branch_code, b.branch_name, b.branch_address, 
                   b.branch_city, b.branch_state, b.branch_pincode,
                   b.contact_email, b.contact_phone, b.manager_name,
                   b.operational_hours, b.is_active, b.created_at,
                   bk.bank_name
            FROM branches b
            LEFT JOIN banks bk ON b.bank_id = bk.id
            ORDER BY b.branch_name
        """)
        
        rows = cursor.fetchall()
        branches = []
        
        for row in rows:
            branches.append(BranchResponse(
                id=row[0],
                bank_id=row[1],
                branch_code=row[2],
                branch_name=row[3],
                branch_address=row[4],
                branch_city=row[5],
                branch_state=row[6],
                branch_pincode=row[7],
                contact_email=row[8],
                contact_phone=row[9],
                manager_name=row[10],
                operational_hours=row[11] or {},
                is_active=row[12],
                created_at=row[13],
                bank_name=row[14]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(branches)} branches total")
        return branches
        
    except Exception as e:
        logger.error(f"Error retrieving all branches: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving branches: {str(e)}")

@router.get("/bank/{bank_id}", response_model=List[BranchResponse])
async def get_branches_by_bank(bank_id: int, db: Session = Depends(get_db)) -> List[BranchResponse]:
    """Get all branches for a specific bank"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT b.id, b.bank_id, b.branch_code, b.branch_name, b.branch_address,
                   b.branch_city, b.branch_state, b.branch_pincode,
                   b.contact_email, b.contact_phone, b.manager_name,
                   b.operational_hours, b.is_active, b.created_at,
                   bk.bank_name
            FROM branches b
            LEFT JOIN banks bk ON b.bank_id = bk.id
            WHERE b.bank_id = %s
            ORDER BY b.branch_name
        """, (bank_id,))
        
        rows = cursor.fetchall()
        branches = []
        
        for row in rows:
            branches.append(BranchResponse(
                id=row[0],
                bank_id=row[1],
                branch_code=row[2],
                branch_name=row[3],
                branch_address=row[4],
                branch_city=row[5],
                branch_state=row[6],
                branch_pincode=row[7],
                contact_email=row[8],
                contact_phone=row[9],
                manager_name=row[10],
                operational_hours=row[11] or {},
                is_active=row[12],
                created_at=row[13],
                bank_name=row[14]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(branches)} branches for bank {bank_id}")
        return branches
        
    except Exception as e:
        logger.error(f"Error retrieving branches: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving branches: {str(e)}")

@router.get("/{branch_id}", response_model=BranchResponse)
async def get_branch(branch_id: int, db: Session = Depends(get_db)) -> BranchResponse:
    """Get a specific branch by ID"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT b.id, b.bank_id, b.branch_code, b.branch_name, b.branch_address,
                   b.branch_city, b.branch_state, b.branch_pincode,
                   b.contact_email, b.contact_phone, b.manager_name,
                   b.operational_hours, b.is_active, b.created_at,
                   bk.bank_name
            FROM branches b
            LEFT JOIN banks bk ON b.bank_id = bk.id
            WHERE b.id = %s
        """, (branch_id,))
        
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Branch not found")
        
        branch = BranchResponse(
            id=row[0],
            bank_id=row[1],
            branch_code=row[2],
            branch_name=row[3],
            branch_address=row[4],
            branch_city=row[5],
            branch_state=row[6],
            branch_pincode=row[7],
            contact_email=row[8],
            contact_phone=row[9],
            manager_name=row[10],
            operational_hours=row[11] or {},
            is_active=row[12],
            created_at=row[13],
            bank_name=row[14]
        )
        
        cursor.close()
        logger.info(f"Retrieved branch {branch_id}")
        return branch
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving branch: {str(e)}")

def require_super_admin(x_super_admin_token: Optional[str] = Header(None)):
    """Require super admin token for branch write operations"""
    if not x_super_admin_token:
        raise HTTPException(status_code=403, detail="Super Admin access required")
    if not validate_super_admin_token(x_super_admin_token):
        raise HTTPException(status_code=403, detail="Invalid or expired Super Admin token")
    return True

@router.post("/", response_model=BranchResponse)
async def create_branch(
    branch: BranchCreate, 
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
) -> BranchResponse:
    """Create a new branch - requires Super Admin"""
    try:
        cursor = db.cursor()
        
        # Check if bank exists
        cursor.execute("SELECT id FROM banks WHERE id = %s", (branch.bank_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail="Bank not found")
        
        # Check if branch code already exists for this bank
        cursor.execute("SELECT id FROM branches WHERE bank_id = %s AND branch_code = %s", 
                      (branch.bank_id, branch.branch_code))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Branch code already exists for this bank")
        
        # Create branch
        operational_hours_json = "{}"
        if branch.operational_hours:
            try:
                operational_hours_json = json.dumps(branch.operational_hours.model_dump())
            except:
                # Fallback to dict() for older Pydantic versions
                operational_hours_json = json.dumps(branch.operational_hours.dict())
        
        cursor.execute("""
            INSERT INTO branches (bank_id, branch_code, branch_name, branch_address,
                                branch_city, branch_state, branch_pincode, contact_email,
                                contact_phone, manager_name, operational_hours)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            branch.bank_id, branch.branch_code, branch.branch_name, branch.branch_address,
            branch.branch_city, branch.branch_state, branch.branch_pincode,
            branch.contact_email, branch.contact_phone, branch.manager_name,
            operational_hours_json
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        # Return created branch
        operational_hours_dict = {}
        if branch.operational_hours:
            try:
                operational_hours_dict = branch.operational_hours.model_dump()
            except:
                # Fallback to dict() for older Pydantic versions
                operational_hours_dict = branch.operational_hours.dict()
                
        created_branch = BranchResponse(
            id=result[0],
            bank_id=branch.bank_id,
            branch_code=branch.branch_code,
            branch_name=branch.branch_name,
            branch_address=branch.branch_address,
            branch_city=branch.branch_city,
            branch_state=branch.branch_state,
            branch_pincode=branch.branch_pincode,
            contact_email=branch.contact_email,
            contact_phone=branch.contact_phone,
            manager_name=branch.manager_name,
            operational_hours=operational_hours_dict,
            is_active=True,
            created_at=result[1]
        )
        
        logger.info(f"Created branch {branch.branch_code}")
        return created_branch
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating branch: {str(e)}")

@router.put("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: int, 
    branch: BranchUpdate, 
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
) -> BranchResponse:
    """Update an existing branch - requires Super Admin"""
    try:
        cursor = db.cursor()
        
        # Check if branch exists
        cursor.execute("SELECT id FROM branches WHERE id = %s", (branch_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Branch not found")
        
        # Build update query dynamically
        update_fields = []
        update_values = []
        
        if branch.branch_name is not None:
            update_fields.append("branch_name = %s")
            update_values.append(branch.branch_name)
        if branch.branch_address is not None:
            update_fields.append("branch_address = %s")
            update_values.append(branch.branch_address)
        if branch.branch_city is not None:
            update_fields.append("branch_city = %s")
            update_values.append(branch.branch_city)
        if branch.branch_state is not None:
            update_fields.append("branch_state = %s")
            update_values.append(branch.branch_state)
        if branch.branch_pincode is not None:
            update_fields.append("branch_pincode = %s")
            update_values.append(branch.branch_pincode)
        if branch.contact_email is not None:
            update_fields.append("contact_email = %s")
            update_values.append(branch.contact_email)
        if branch.contact_phone is not None:
            update_fields.append("contact_phone = %s")
            update_values.append(branch.contact_phone)
        if branch.manager_name is not None:
            update_fields.append("manager_name = %s")
            update_values.append(branch.manager_name)
        if branch.operational_hours is not None:
            update_fields.append("operational_hours = %s")
            try:
                operational_hours_json = json.dumps(branch.operational_hours.model_dump())
            except:
                # Fallback to dict() for older Pydantic versions  
                operational_hours_json = json.dumps(branch.operational_hours.dict())
            update_values.append(operational_hours_json)
        if branch.is_active is not None:
            update_fields.append("is_active = %s")
            update_values.append(branch.is_active)
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_values.append(branch_id)
        update_query = f"UPDATE branches SET {', '.join(update_fields)} WHERE id = %s"
        
        cursor.execute(update_query, update_values)
        db.commit()
        
        # Get updated branch
        cursor.execute("""
            SELECT b.id, b.bank_id, b.branch_code, b.branch_name, b.branch_address,
                   b.branch_city, b.branch_state, b.branch_pincode,
                   b.contact_email, b.contact_phone, b.manager_name,
                   b.operational_hours, b.is_active, b.created_at,
                   bk.bank_name
            FROM branches b
            LEFT JOIN banks bk ON b.bank_id = bk.id
            WHERE b.id = %s
        """, (branch_id,))
        
        row = cursor.fetchone()
        updated_branch = BranchResponse(
            id=row[0],
            bank_id=row[1],
            branch_code=row[2],
            branch_name=row[3],
            branch_address=row[4],
            branch_city=row[5],
            branch_state=row[6],
            branch_pincode=row[7],
            contact_email=row[8],
            contact_phone=row[9],
            manager_name=row[10],
            operational_hours=row[11] or {},
            is_active=row[12],
            created_at=row[13],
            bank_name=row[14]
        )
        
        cursor.close()
        logger.info(f"Updated branch {branch_id}")
        return updated_branch
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating branch: {str(e)}")

@router.delete("/{branch_id}")
async def delete_branch(
    branch_id: int, 
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
):
    """Delete a branch - requires Super Admin"""
    try:
        cursor = db.cursor()
        
        # Check if branch exists
        cursor.execute("SELECT id FROM branches WHERE id = %s", (branch_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Branch not found")
        
        # Check if branch has users
        cursor.execute("SELECT COUNT(*) FROM tenant_users WHERE branch_id = %s", (branch_id,))
        user_count = cursor.fetchone()[0]
        if user_count > 0:
            raise HTTPException(status_code=400, detail=f"Cannot delete branch with {user_count} users")
        
        # Delete branch
        cursor.execute("DELETE FROM branches WHERE id = %s", (branch_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deleted branch {branch_id}")
        return {"message": "Branch deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting branch: {str(e)}")
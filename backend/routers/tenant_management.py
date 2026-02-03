"""
Tenant management API router
Provides endpoints for managing banks, branches, and tenant users
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from models.database import Database, get_db
from schemas.tenant import (
    BankCreate, BankUpdate, BankResponse,
    BranchCreate, BranchUpdate, BranchResponse,
    TenantUserCreate, TenantUserUpdate, TenantUserResponse
)
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tenant", tags=["tenant"])

# Bank Management Endpoints
@router.get("/banks", response_model=List[BankResponse])
async def get_banks(db: Session = Depends(get_db)) -> List[BankResponse]:
    """Get all banks"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT id, bank_code, bank_name, bank_short_name, headquarters_address,
                   contact_email, contact_phone, rbi_license_number,
                   system_configuration, tenant_settings, is_active, created_at
            FROM banks 
            ORDER BY bank_short_name
        """)
        
        rows = cursor.fetchall()
        banks = []
        
        for row in rows:
            banks.append(BankResponse(
                id=row[0],
                bank_code=row[1],
                bank_name=row[2],
                bank_short_name=row[3],
                headquarters_address=row[4],
                contact_email=row[5],
                contact_phone=row[6],
                rbi_license_number=row[7],
                system_configuration=row[8] or {},
                tenant_settings=row[9] or {},
                is_active=row[10],
                created_at=row[11]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(banks)} banks")
        return banks
        
    except Exception as e:
        logger.error(f"Error retrieving banks: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving banks: {str(e)}")

@router.post("/banks", response_model=BankResponse)
async def create_bank(bank: BankCreate, db: Session = Depends(get_db)) -> BankResponse:
    """Create a new bank"""
    try:
        cursor = db.cursor()
        
        # Check if bank code already exists
        cursor.execute("SELECT id FROM banks WHERE bank_code = %s", (bank.bank_code,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Bank code already exists")
        
        # Insert new bank
        cursor.execute("""
            INSERT INTO banks (
                bank_code, bank_name, bank_short_name, headquarters_address,
                contact_email, contact_phone, rbi_license_number,
                system_configuration, tenant_settings
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            bank.bank_code, bank.bank_name, bank.bank_short_name,
            bank.headquarters_address, bank.contact_email, bank.contact_phone,
            bank.rbi_license_number, bank.system_configuration, bank.tenant_settings
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        logger.info(f"Created bank: {bank.bank_short_name}")
        
        return BankResponse(
            id=result[0],
            bank_code=bank.bank_code,
            bank_name=bank.bank_name,
            bank_short_name=bank.bank_short_name,
            headquarters_address=bank.headquarters_address,
            contact_email=bank.contact_email,
            contact_phone=bank.contact_phone,
            rbi_license_number=bank.rbi_license_number,
            system_configuration=bank.system_configuration,
            tenant_settings=bank.tenant_settings,
            is_active=True,
            created_at=result[1]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating bank: {str(e)}")

@router.put("/banks/{bank_id}", response_model=BankResponse)
async def update_bank(bank_id: int, bank: BankUpdate, db: Session = Depends(get_db)) -> BankResponse:
    """Update a bank"""
    try:
        cursor = db.cursor()
        
        # Check if bank exists
        cursor.execute("SELECT * FROM banks WHERE id = %s", (bank_id,))
        existing_bank = cursor.fetchone()
        if not existing_bank:
            raise HTTPException(status_code=404, detail="Bank not found")
        
        # Update bank
        cursor.execute("""
            UPDATE banks SET
                bank_code = %s, bank_name = %s, bank_short_name = %s,
                headquarters_address = %s, contact_email = %s, contact_phone = %s,
                rbi_license_number = %s, system_configuration = %s, tenant_settings = %s
            WHERE id = %s
            RETURNING created_at
        """, (
            bank.bank_code, bank.bank_name, bank.bank_short_name,
            bank.headquarters_address, bank.contact_email, bank.contact_phone,
            bank.rbi_license_number, bank.system_configuration, bank.tenant_settings,
            bank_id
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        logger.info(f"Updated bank ID: {bank_id}")
        
        return BankResponse(
            id=bank_id,
            bank_code=bank.bank_code,
            bank_name=bank.bank_name,
            bank_short_name=bank.bank_short_name,
            headquarters_address=bank.headquarters_address,
            contact_email=bank.contact_email,
            contact_phone=bank.contact_phone,
            rbi_license_number=bank.rbi_license_number,
            system_configuration=bank.system_configuration,
            tenant_settings=bank.tenant_settings,
            is_active=existing_bank[10],  # Keep existing is_active status
            created_at=result[0]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating bank: {str(e)}")

@router.delete("/banks/{bank_id}")
async def delete_bank(
    bank_id: int, 
    force: bool = False,
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Delete a bank
    
    Args:
        bank_id: ID of bank to delete
        force: If True, deletes bank and all associated branches/data (cascade delete)
    """
    try:
        cursor = db.cursor()
        
        # Check if bank exists
        cursor.execute("SELECT id, bank_name FROM banks WHERE id = %s", (bank_id,))
        bank_row = cursor.fetchone()
        if not bank_row:
            raise HTTPException(status_code=404, detail="Bank not found")
        
        bank_name = bank_row[1]
        
        # Check if bank has branches
        cursor.execute("SELECT COUNT(*) FROM branches WHERE bank_id = %s", (bank_id,))
        branch_count = cursor.fetchone()[0]
        
        if branch_count > 0 and not force:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete bank '{bank_name}' with {branch_count} branches. Use force=true parameter to cascade delete all associated data."
            )
        
        if force and branch_count > 0:
            # Cascade delete all associated data
            logger.info(f"Force deleting bank {bank_id} with {branch_count} branches")
            
            # Get all branch IDs for this bank
            cursor.execute("SELECT id FROM branches WHERE bank_id = %s", (bank_id,))
            branch_ids = [row[0] for row in cursor.fetchall()]
            
            if branch_ids:
                branch_ids_str = ','.join(map(str, branch_ids))
                
                # Delete in correct order due to foreign key constraints
                # Use individual operations with error handling for each table
                
                tables_to_clean = [
                    ("overall_sessions", "session data"),
                    ("appraiser_details", "appraiser data"), 
                    ("customer_details", "customer data"),
                    ("rbi_compliance_details", "compliance data"),
                    ("purity_test_details", "purity test data")
                ]
                
                for table_name, description in tables_to_clean:
                    try:
                        cursor.execute(f"DELETE FROM {table_name} WHERE branch_id IN ({branch_ids_str})")
                        affected_rows = cursor.rowcount
                        logger.info(f"Deleted {affected_rows} {description} records for branches: {branch_ids_str}")
                    except Exception as e:
                        # Log but continue - table might not exist or be empty
                        logger.warning(f"Could not delete from {table_name}: {e}")
                
                # Delete tenant users (includes branch admins with user_role='branch_admin')
                try:
                    cursor.execute(f"DELETE FROM tenant_users WHERE branch_id IN ({branch_ids_str})")
                    affected_rows = cursor.rowcount
                    logger.info(f"Deleted {affected_rows} tenant users for branches: {branch_ids_str}")
                except Exception as e:
                    logger.warning(f"Could not delete tenant users: {e}")
            
            # Delete branches (this will cascade to other related data)
            cursor.execute("DELETE FROM branches WHERE bank_id = %s", (bank_id,))
            affected_rows = cursor.rowcount
            logger.info(f"Deleted {affected_rows} branches for bank: {bank_id}")
            
            # Delete bank admins
            try:
                cursor.execute("DELETE FROM bank_admins WHERE bank_id = %s", (bank_id,))
                affected_rows = cursor.rowcount
                logger.info(f"Deleted {affected_rows} bank admins for bank: {bank_id}")
            except Exception as e:
                logger.warning(f"Could not delete bank admins: {e}")
        
        # Finally, delete the bank
        cursor.execute("DELETE FROM banks WHERE id = %s", (bank_id,))
        db.commit()
        cursor.close()
        
        if force and branch_count > 0:
            logger.info(f"Force deleted bank {bank_id} ({bank_name}) with {branch_count} branches and all associated data")
            return {"message": f"Bank '{bank_name}' and all {branch_count} branches deleted successfully (cascade)"}
        else:
            logger.info(f"Deleted bank {bank_id} ({bank_name})")
            return {"message": f"Bank '{bank_name}' deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting bank: {str(e)}")

# Branch Management Endpoints
@router.get("/branches", response_model=List[BranchResponse])
async def get_all_branches(db: Session = Depends(get_db)) -> List[BranchResponse]:
    """Get all branches across all banks"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT b.id, b.bank_id, b.branch_code, b.branch_name, b.branch_address, b.pincode,
                   b.contact_email, b.contact_phone, b.branch_manager_name, b.branch_manager_phone,
                   b.operational_hours, b.services_offered, b.is_active, b.created_at,
                   b.branch_city, b.branch_state, bk.bank_name
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
                branch_pincode=row[5],
                contact_email=row[6],
                contact_phone=row[7],
                manager_name=row[8],
                operational_hours=row[10] or {},
                is_active=row[12],
                created_at=row[13],
                branch_city=row[14],
                branch_state=row[15],
                bank_name=row[16]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(branches)} branches total")
        return branches
        
    except Exception as e:
        logger.error(f"Error retrieving all branches: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving branches: {str(e)}")

@router.get("/banks/{bank_id}/branches", response_model=List[BranchResponse])
async def get_branches(bank_id: int, db: Session = Depends(get_db)) -> List[BranchResponse]:
    """Get all branches for a specific bank"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT id, bank_id, branch_code, branch_name, branch_address, pincode,
                   contact_email, contact_phone, branch_manager_name, branch_manager_phone,
                   operational_hours, services_offered, is_active, created_at
            FROM branches 
            WHERE bank_id = %s
            ORDER BY branch_name
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
                pincode=row[5],
                contact_email=row[6],
                contact_phone=row[7],
                branch_manager_name=row[8],
                branch_manager_phone=row[9],
                operational_hours=row[10] or {},
                services_offered=row[11] or {},
                is_active=row[12],
                created_at=row[13]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(branches)} branches for bank {bank_id}")
        return branches
        
    except Exception as e:
        logger.error(f"Error retrieving branches: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving branches: {str(e)}")

@router.post("/branches", response_model=BranchResponse)
async def create_branch(branch: BranchCreate, db: Session = Depends(get_db)) -> BranchResponse:
    """Create a new branch"""
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
        
        # Insert new branch
        cursor.execute("""
            INSERT INTO branches (
                bank_id, branch_code, branch_name, branch_address, pincode,
                contact_email, contact_phone, branch_manager_name, branch_manager_phone,
                operational_hours, services_offered
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            branch.bank_id, branch.branch_code, branch.branch_name,
            branch.branch_address, branch.pincode, branch.contact_email,
            branch.contact_phone, branch.branch_manager_name, branch.branch_manager_phone,
            branch.operational_hours, branch.services_offered
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        logger.info(f"Created branch: {branch.branch_name}")
        
        return BranchResponse(
            id=result[0],
            bank_id=branch.bank_id,
            branch_code=branch.branch_code,
            branch_name=branch.branch_name,
            branch_address=branch.branch_address,
            pincode=branch.pincode,
            contact_email=branch.contact_email,
            contact_phone=branch.contact_phone,
            branch_manager_name=branch.branch_manager_name,
            branch_manager_phone=branch.branch_manager_phone,
            operational_hours=branch.operational_hours,
            services_offered=branch.services_offered,
            is_active=True,
            created_at=result[1]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating branch: {str(e)}")

@router.put("/branches/{branch_id}", response_model=BranchResponse)
async def update_branch(branch_id: int, branch: BranchUpdate, db: Session = Depends(get_db)) -> BranchResponse:
    """Update a branch"""
    try:
        cursor = db.cursor()
        
        # Check if branch exists
        cursor.execute("SELECT * FROM branches WHERE id = %s", (branch_id,))
        existing_branch = cursor.fetchone()
        if not existing_branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        
        # Update branch
        cursor.execute("""
            UPDATE branches SET
                branch_code = %s, branch_name = %s, branch_address = %s, pincode = %s,
                contact_email = %s, contact_phone = %s, branch_manager_name = %s,
                branch_manager_phone = %s, operational_hours = %s, services_offered = %s
            WHERE id = %s
            RETURNING created_at
        """, (
            branch.branch_code, branch.branch_name, branch.branch_address, branch.pincode,
            branch.contact_email, branch.contact_phone, branch.branch_manager_name,
            branch.branch_manager_phone, branch.operational_hours, branch.services_offered,
            branch_id
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        logger.info(f"Updated branch ID: {branch_id}")
        
        return BranchResponse(
            id=branch_id,
            bank_id=existing_branch[1],
            branch_code=branch.branch_code,
            branch_name=branch.branch_name,
            branch_address=branch.branch_address,
            pincode=branch.pincode,
            contact_email=branch.contact_email,
            contact_phone=branch.contact_phone,
            branch_manager_name=branch.branch_manager_name,
            branch_manager_phone=branch.branch_manager_phone,
            operational_hours=branch.operational_hours,
            services_offered=branch.services_offered,
            is_active=existing_branch[12],  # Keep existing is_active status
            created_at=result[0]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating branch: {str(e)}")

@router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Delete a branch"""
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
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete branch with {user_count} users. Reassign or delete users first."
            )
        
        # Delete branch
        cursor.execute("DELETE FROM branches WHERE id = %s", (branch_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deleted branch ID: {branch_id}")
        return {"message": "Branch deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting branch: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting branch: {str(e)}")

# Tenant User Management Endpoints
@router.get("/users", response_model=List[TenantUserResponse])
async def get_tenant_users(db: Session = Depends(get_db)) -> List[TenantUserResponse]:
    """Get all tenant users"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT tu.id, tu.username, tu.full_name, tu.email, tu.phone_number,
                   tu.role, tu.bank_id, tu.branch_id, tu.permissions, tu.is_active, tu.created_at,
                   b.bank_short_name, br.branch_name
            FROM tenant_users tu
            LEFT JOIN banks b ON tu.bank_id = b.id
            LEFT JOIN branches br ON tu.branch_id = br.id
            ORDER BY tu.full_name
        """)
        
        rows = cursor.fetchall()
        users = []
        
        for row in rows:
            users.append(TenantUserResponse(
                id=row[0],
                username=row[1],
                full_name=row[2],
                email=row[3],
                phone_number=row[4],
                role=row[5],
                bank_id=row[6],
                branch_id=row[7],
                permissions=row[8] or {},
                is_active=row[9],
                created_at=row[10],
                bank_name=row[11],
                branch_name=row[12]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(users)} tenant users")
        return users
        
    except Exception as e:
        logger.error(f"Error retrieving tenant users: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving tenant users: {str(e)}")

@router.post("/users", response_model=TenantUserResponse)
async def create_tenant_user(user: TenantUserCreate, db: Session = Depends(get_db)) -> TenantUserResponse:
    """Create a new tenant user"""
    try:
        cursor = db.cursor()
        
        # Check if username already exists
        cursor.execute("SELECT id FROM tenant_users WHERE username = %s", (user.username,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Username already exists")
        
        # Check if email already exists
        cursor.execute("SELECT id FROM tenant_users WHERE email = %s", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already exists")
        
        # Hash password (in real app, use proper password hashing)
        # For now, we'll store it as plain text for demo purposes
        
        # Insert new user
        cursor.execute("""
            INSERT INTO tenant_users (
                username, full_name, email, phone_number, password_hash,
                role, bank_id, branch_id, permissions
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            user.username, user.full_name, user.email, user.phone_number,
            user.password,  # In production, hash this
            user.role, user.bank_id, user.branch_id, user.permissions
        ))
        
        result = cursor.fetchone()
        
        # Get bank and branch names
        cursor.execute("""
            SELECT b.bank_short_name, br.branch_name 
            FROM banks b 
            LEFT JOIN branches br ON br.id = %s 
            WHERE b.id = %s
        """, (user.branch_id, user.bank_id))
        
        bank_branch = cursor.fetchone()
        bank_name = bank_branch[0] if bank_branch else None
        branch_name = bank_branch[1] if bank_branch and len(bank_branch) > 1 else None
        
        db.commit()
        cursor.close()
        
        logger.info(f"Created tenant user: {user.username}")
        
        return TenantUserResponse(
            id=result[0],
            username=user.username,
            full_name=user.full_name,
            email=user.email,
            phone_number=user.phone_number,
            role=user.role,
            bank_id=user.bank_id,
            branch_id=user.branch_id,
            permissions=user.permissions,
            is_active=True,
            created_at=result[1],
            bank_name=bank_name,
            branch_name=branch_name
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating tenant user: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating tenant user: {str(e)}")

@router.put("/users/{user_id}", response_model=TenantUserResponse)
async def update_tenant_user(user_id: int, user: TenantUserUpdate, db: Session = Depends(get_db)) -> TenantUserResponse:
    """Update a tenant user"""
    try:
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute("SELECT * FROM tenant_users WHERE id = %s", (user_id,))
        existing_user = cursor.fetchone()
        if not existing_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update user
        update_query = """
            UPDATE tenant_users SET
                username = %s, full_name = %s, email = %s, phone_number = %s,
                role = %s, bank_id = %s, branch_id = %s, permissions = %s
        """
        params = [
            user.username, user.full_name, user.email, user.phone_number,
            user.role, user.bank_id, user.branch_id, user.permissions
        ]
        
        # Only update password if provided
        if user.password:
            update_query += ", password_hash = %s"
            params.append(user.password)  # In production, hash this
        
        update_query += " WHERE id = %s RETURNING created_at"
        params.append(user_id)
        
        cursor.execute(update_query, params)
        
        result = cursor.fetchone()
        
        # Get bank and branch names
        cursor.execute("""
            SELECT b.bank_short_name, br.branch_name 
            FROM banks b 
            LEFT JOIN branches br ON br.id = %s 
            WHERE b.id = %s
        """, (user.branch_id, user.bank_id))
        
        bank_branch = cursor.fetchone()
        bank_name = bank_branch[0] if bank_branch else None
        branch_name = bank_branch[1] if bank_branch and len(bank_branch) > 1 else None
        
        db.commit()
        cursor.close()
        
        logger.info(f"Updated tenant user ID: {user_id}")
        
        return TenantUserResponse(
            id=user_id,
            username=user.username,
            full_name=user.full_name,
            email=user.email,
            phone_number=user.phone_number,
            role=user.role,
            bank_id=user.bank_id,
            branch_id=user.branch_id,
            permissions=user.permissions,
            is_active=existing_user[9],  # Keep existing is_active status
            created_at=result[0],
            bank_name=bank_name,
            branch_name=branch_name
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating tenant user: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating tenant user: {str(e)}")

@router.delete("/users/{user_id}")
async def delete_tenant_user(user_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Delete a tenant user"""
    try:
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute("SELECT id FROM tenant_users WHERE id = %s", (user_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        
        # Delete user
        cursor.execute("DELETE FROM tenant_users WHERE id = %s", (user_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deleted tenant user ID: {user_id}")
        return {"message": "User deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting tenant user: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting tenant user: {str(e)}")
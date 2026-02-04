"""
Admin management API router
Handles all admin-related operations including tenant users management
"""
from fastapi import APIRouter, HTTPException, Depends, Header
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from models.database import get_db
from schemas.tenant import AdminUserResponse, AdminUserCreate, AdminUserUpdate
import logging
import hashlib
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# ============================================================================
# Helper Functions
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password for comparison"""
    return hashlib.sha256(password.encode()).hexdigest()

# ============================================================================
# Login Models
# ============================================================================

class AdminLoginRequest(BaseModel):
    """Admin login request model"""
    email: EmailStr
    password: str
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    role: str

class AdminLoginResponse(BaseModel):
    """Admin login response model"""
    success: bool
    message: str
    user: Optional[dict] = None

# ============================================================================
# Login Endpoint
# ============================================================================

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(login_data: AdminLoginRequest, db: Session = Depends(get_db)) -> AdminLoginResponse:
    """Admin login endpoint with support for branch admin authentication from dedicated branch_admins table"""
    try:
        cursor = db.cursor()
        
        # Branch admin login - Use dedicated branch_admins table
        if login_data.role == 'branch_admin':
            # Branch admin login using the dedicated branch_admins table
            # Verify they have access to the specified bank and branch
            if not login_data.bank_id or not login_data.branch_id:
                cursor.close()
                return AdminLoginResponse(
                    success=False,
                    message="Please select both bank and branch for branch admin login"
                )
            
            password_hash = hash_password(login_data.password)
            
            # Query the dedicated branch_admins table
            cursor.execute("""
                SELECT ba.id, ba.full_name, ba.email, ba.bank_id, ba.branch_id,
                       br.branch_name, bk.bank_name, ba.password_hash, ba.permissions
                FROM branch_admins ba
                JOIN branches br ON ba.branch_id = br.id
                JOIN banks bk ON ba.bank_id = bk.id
                WHERE ba.email = %s AND ba.password_hash = %s
                AND ba.is_active = true
                AND ba.bank_id = %s AND ba.branch_id = %s
            """, (login_data.email, password_hash, login_data.bank_id, login_data.branch_id))
            
            admin = cursor.fetchone()
            if admin:
                # Update last login
                cursor.execute("""
                    UPDATE branch_admins SET last_login = CURRENT_TIMESTAMP WHERE id = %s
                """, (admin[0],))
                db.commit()
                cursor.close()
                
                logger.info(f"Branch admin login successful: {admin[2]} "
                          f"(Bank: {admin[6]}, Branch: {admin[5]})")
                
                return AdminLoginResponse(
                    success=True,
                    message="Branch admin login successful",
                    user={
                        "id": admin[0],
                        "name": admin[1] or "Branch Admin",
                        "email": admin[2],
                        "role": "branch_admin",
                        "bank_id": admin[3],
                        "branch_id": admin[4],
                        "bank_name": admin[6],
                        "branch_name": admin[5],
                        "permissions": admin[8] or {}
                    }
                )
            else:
                cursor.close()
                logger.warning(f"Branch admin login failed: {login_data.email} "
                             f"(Bank: {login_data.bank_id}, Branch: {login_data.branch_id})")
                return AdminLoginResponse(
                    success=False,
                    message="Invalid credentials or you don't have access to the selected branch"
                )
        
        # Bank admin login - Check bank_admins table first with password verification
        if login_data.role == 'bank_admin' and login_data.bank_id:
            # First check bank_admins table
            password_hash = hash_password(login_data.password)
            logger.info(f"Login attempt - Email: {login_data.email}, Bank ID: {login_data.bank_id}, Password hash: {password_hash[:16]}...")
            
            cursor.execute("""
                SELECT ba.id, ba.full_name, ba.email, ba.bank_id, ba.phone,
                       b.bank_name, ba.password_hash
                FROM bank_admins ba
                LEFT JOIN banks b ON ba.bank_id = b.id
                WHERE ba.email = %s AND ba.bank_id = %s AND ba.is_active = TRUE
            """, (login_data.email, login_data.bank_id))
            
            admin = cursor.fetchone()
            if not admin:
                logger.info(f"No bank admin found for email {login_data.email} and bank_id {login_data.bank_id}")
                cursor.close()
                return AdminLoginResponse(
                    success=False,
                    message="Invalid credentials or access denied"
                )
            
            stored_hash = admin[6]
            logger.info(f"Found admin - Stored hash: {stored_hash[:16]}..., Input hash: {password_hash[:16]}...")
            logger.info(f"Hash match: {stored_hash == password_hash}")
            
            # Verify password
            if stored_hash != password_hash:
                cursor.close()
                return AdminLoginResponse(
                    success=False,
                    message="Invalid credentials or access denied"
                )
            
            # Update last login
            cursor.execute("""
                UPDATE bank_admins SET last_login = CURRENT_TIMESTAMP WHERE id = %s
            """, (admin[0],))
            db.commit()
            cursor.close()
            return AdminLoginResponse(
                success=True,
                message="Bank admin login successful",
                user={
                    "id": admin[0],
                    "name": admin[1] or "Bank Admin",
                    "email": admin[2],
                    "role": "bank_admin",
                    "bank_id": admin[3],
                    "branch_id": None,
                    "bank_name": admin[5],
                    "branch_name": None
                }
            )
            
            # Fallback to tenant_users table (for existing users without password reset)
            cursor.execute("""
                SELECT tu.id, tu.full_name, tu.email, tu.user_role, tu.bank_id, tu.branch_id,
                       b.bank_name, br.branch_name
                FROM tenant_users tu
                LEFT JOIN banks b ON tu.bank_id = b.id
                LEFT JOIN branches br ON tu.branch_id = br.id
                WHERE tu.email = %s AND tu.bank_id = %s AND tu.is_active = true
            """, (login_data.email, login_data.bank_id))
            
            user = cursor.fetchone()
            if user:
                cursor.close()
                return AdminLoginResponse(
                    success=True,
                    message="Login successful",
                    user={
                        "id": user[0],
                        "name": user[1],
                        "email": user[2],
                        "role": user[3],
                        "bank_id": user[4],
                        "branch_id": user[5],
                        "bank_name": user[6],
                        "branch_name": user[7]
                    }
                )
        
        cursor.close()
        # Login failed
        return AdminLoginResponse(
            success=False,
            message="Invalid credentials or access denied",
            user=None
        )
            
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")

@router.get("/users", response_model=List[AdminUserResponse])
async def get_all_admin_users(
    bank_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    db: Session = Depends(get_db)
) -> List[AdminUserResponse]:
    """Get all admin users with optional bank/branch filtering"""
    try:
        cursor = db.cursor()
        
        # Base query
        base_query = """
            SELECT tu.id, tu.full_name, tu.email, tu.user_role, tu.phone, tu.employee_id,
                   tu.bank_id, tu.branch_id, tu.is_active, tu.created_at,
                   b.bank_name, br.branch_name
            FROM tenant_users tu
            LEFT JOIN banks b ON tu.bank_id = b.id
            LEFT JOIN branches br ON tu.branch_id = br.id
        """
        
        # Add filters
        where_conditions = []
        params = []
        
        if bank_id:
            where_conditions.append("tu.bank_id = %s")
            params.append(bank_id)
            
        if branch_id:
            where_conditions.append("tu.branch_id = %s")
            params.append(branch_id)
        
        if where_conditions:
            query = f"{base_query} WHERE {' AND '.join(where_conditions)}"
        else:
            query = base_query
            
        query += " ORDER BY tu.full_name"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        users = []
        for row in rows:
            users.append(AdminUserResponse(
                id=row[0],
                name=row[1],
                email=row[2],
                role=row[3],
                phone=row[4],
                employee_id=row[5],
                bank_id=row[6],
                branch_id=row[7],
                is_active=row[8],
                created_at=row[9],
                bank_name=row[10],
                branch_name=row[11]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(users)} admin users")
        return users
        
    except Exception as e:
        logger.error(f"Error retrieving admin users: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admin users: {str(e)}")

@router.get("/users/{user_id}", response_model=AdminUserResponse)
async def get_admin_user(user_id: int, db: Session = Depends(get_db)) -> AdminUserResponse:
    """Get a specific admin user by ID"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT tu.id, tu.full_name, tu.email, tu.user_role, tu.phone, tu.employee_id,
                   tu.bank_id, tu.branch_id, tu.is_active, tu.created_at,
                   b.bank_name, br.branch_name
            FROM tenant_users tu
            LEFT JOIN banks b ON tu.bank_id = b.id
            LEFT JOIN branches br ON tu.branch_id = br.id
            WHERE tu.id = %s
        """, (user_id,))
        
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Admin user not found")
        
        user = AdminUserResponse(
            id=row[0],
            name=row[1],
            email=row[2],
            role=row[3],
            phone=row[4],
            employee_id=row[5],
            bank_id=row[6],
            branch_id=row[7],
            is_active=row[8],
            created_at=row[9],
            bank_name=row[10],
            branch_name=row[11]
        )
        
        cursor.close()
        logger.info(f"Retrieved admin user {user_id}")
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving admin user: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admin user: {str(e)}")

@router.post("/users", response_model=AdminUserResponse)
async def create_admin_user(user: AdminUserCreate, db: Session = Depends(get_db)) -> AdminUserResponse:
    """Create a new admin user"""
    try:
        cursor = db.cursor()
        
        # Check if email already exists
        cursor.execute("SELECT id FROM tenant_users WHERE email = %s", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already exists")
        
        # Check if employee_id already exists (if provided)
        if user.employee_id:
            cursor.execute("SELECT id FROM tenant_users WHERE employee_id = %s", (user.employee_id,))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Employee ID already exists")
        
        # Validate bank exists
        if user.bank_id:
            cursor.execute("SELECT id FROM banks WHERE id = %s", (user.bank_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=400, detail="Bank not found")
        
        # Validate branch exists and belongs to bank (if both provided)
        if user.branch_id:
            if user.bank_id:
                cursor.execute("SELECT id FROM branches WHERE id = %s AND bank_id = %s", 
                              (user.branch_id, user.bank_id))
            else:
                cursor.execute("SELECT id FROM branches WHERE id = %s", (user.branch_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=400, detail="Branch not found or does not belong to specified bank")
        
        # Create user
        cursor.execute("""
            INSERT INTO tenant_users (name, email, role, phone, employee_id, bank_id, branch_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            user.name, user.email, user.role, user.phone, user.employee_id,
            user.bank_id, user.branch_id
        ))
        
        result = cursor.fetchone()
        db.commit()
        
        # Get bank and branch names
        bank_name = None
        branch_name = None
        
        if user.bank_id:
            cursor.execute("SELECT bank_name FROM banks WHERE id = %s", (user.bank_id,))
            bank_result = cursor.fetchone()
            bank_name = bank_result[0] if bank_result else None
            
        if user.branch_id:
            cursor.execute("SELECT branch_name FROM branches WHERE id = %s", (user.branch_id,))
            branch_result = cursor.fetchone()
            branch_name = branch_result[0] if branch_result else None
        
        cursor.close()
        
        # Return created user
        created_user = AdminUserResponse(
            id=result[0],
            name=user.name,
            email=user.email,
            role=user.role,
            phone=user.phone,
            employee_id=user.employee_id,
            bank_id=user.bank_id,
            branch_id=user.branch_id,
            is_active=True,
            created_at=result[1],
            bank_name=bank_name,
            branch_name=branch_name
        )
        
        logger.info(f"Created admin user {user.email}")
        return created_user
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating admin user: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating admin user: {str(e)}")

@router.put("/users/{user_id}", response_model=AdminUserResponse)
async def update_admin_user(user_id: int, user: AdminUserUpdate, db: Session = Depends(get_db)) -> AdminUserResponse:
    """Update an existing admin user"""
    try:
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute("SELECT id FROM tenant_users WHERE id = %s", (user_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Admin user not found")
        
        # Check email uniqueness (if updating email)
        if user.email is not None:
            cursor.execute("SELECT id FROM tenant_users WHERE email = %s AND id != %s", (user.email, user_id))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")
        
        # Check employee_id uniqueness (if updating employee_id)
        if user.employee_id is not None:
            cursor.execute("SELECT id FROM tenant_users WHERE employee_id = %s AND id != %s", 
                          (user.employee_id, user_id))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Employee ID already exists")
        
        # Build update query dynamically
        update_fields = []
        update_values = []
        
        if user.name is not None:
            update_fields.append("name = %s")
            update_values.append(user.name)
        if user.email is not None:
            update_fields.append("email = %s")
            update_values.append(user.email)
        if user.role is not None:
            update_fields.append("role = %s")
            update_values.append(user.role)
        if user.phone is not None:
            update_fields.append("phone = %s")
            update_values.append(user.phone)
        if user.employee_id is not None:
            update_fields.append("employee_id = %s")
            update_values.append(user.employee_id)
        if user.bank_id is not None:
            update_fields.append("bank_id = %s")
            update_values.append(user.bank_id)
        if user.branch_id is not None:
            update_fields.append("branch_id = %s")
            update_values.append(user.branch_id)
        if user.is_active is not None:
            update_fields.append("is_active = %s")
            update_values.append(user.is_active)
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_values.append(user_id)
        update_query = f"UPDATE tenant_users SET {', '.join(update_fields)} WHERE id = %s"
        
        cursor.execute(update_query, update_values)
        db.commit()
        
        # Get updated user
        cursor.execute("""
            SELECT tu.id, tu.full_name, tu.email, tu.user_role, tu.phone, tu.employee_id,
                   tu.bank_id, tu.branch_id, tu.is_active, tu.created_at,
                   b.bank_name, br.branch_name
            FROM tenant_users tu
            LEFT JOIN banks b ON tu.bank_id = b.id
            LEFT JOIN branches br ON tu.branch_id = br.id
            WHERE tu.id = %s
        """, (user_id,))
        
        row = cursor.fetchone()
        updated_user = AdminUserResponse(
            id=row[0],
            name=row[1],
            email=row[2],
            role=row[3],
            phone=row[4],
            employee_id=row[5],
            bank_id=row[6],
            branch_id=row[7],
            is_active=row[8],
            created_at=row[9],
            bank_name=row[10],
            branch_name=row[11]
        )
        
        cursor.close()
        logger.info(f"Updated admin user {user_id}")
        return updated_user
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating admin user: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating admin user: {str(e)}")

@router.delete("/users/{user_id}")
async def delete_admin_user(user_id: int, db: Session = Depends(get_db)):
    """Delete an admin user"""
    try:
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute("SELECT id FROM tenant_users WHERE id = %s", (user_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Admin user not found")
        
        # Delete user
        cursor.execute("DELETE FROM tenant_users WHERE id = %s", (user_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deleted admin user {user_id}")
        return {"message": "Admin user deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting admin user: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting admin user: {str(e)}")

@router.get("/statistics")
async def get_admin_statistics(db: Session = Depends(get_db)):
    """Get overall system statistics"""
    try:
        cursor = db.cursor()
        
        # Get total counts
        cursor.execute("SELECT COUNT(*) FROM banks")
        total_banks = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM branches")
        total_branches = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM tenant_users")
        total_users = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM tenant_users WHERE is_active = true")
        active_users = cursor.fetchone()[0]
        
        # Get banks with their branch counts
        cursor.execute("""
            SELECT b.id, b.bank_name, b.bank_code, COUNT(br.id) as branch_count
            FROM banks b
            LEFT JOIN branches br ON b.id = br.bank_id
            GROUP BY b.id, b.bank_name, b.bank_code
            ORDER BY b.bank_name
        """)
        bank_stats = cursor.fetchall()
        
        # Get user distribution by role
        cursor.execute("""
            SELECT role, COUNT(*) as count
            FROM tenant_users
            GROUP BY role
            ORDER BY role
        """)
        role_distribution = cursor.fetchall()
        
        cursor.close()
        
        statistics = {
            "overview": {
                "total_banks": total_banks,
                "total_branches": total_branches,
                "total_users": total_users,
                "active_users": active_users
            },
            "banks": [
                {
                    "id": bank[0],
                    "name": bank[1],
                    "code": bank[2],
                    "branch_count": bank[3]
                }
                for bank in bank_stats
            ],
            "user_roles": [
                {
                    "role": role[0],
                    "count": role[1]
                }
                for role in role_distribution
            ]
        }
        
        logger.info("Retrieved admin statistics")
        return statistics
        
    except Exception as e:
        logger.error(f"Error retrieving admin statistics: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving statistics: {str(e)}")


# ============================================================================
# Bank Admin Management (for Super Admin)
# ============================================================================

class BankAdminCreate(BaseModel):
    """Create bank admin model"""
    bank_id: int
    email: EmailStr
    password: str
    phone: Optional[str] = None
    full_name: Optional[str] = None

class BankAdminResponse(BaseModel):
    """Bank admin response model"""
    id: int
    bank_id: int
    email: str
    phone: Optional[str]
    full_name: Optional[str]
    is_active: bool
    bank_name: Optional[str] = None
    created_at: Optional[str] = None

@router.post("/bank-admin", response_model=BankAdminResponse)
async def create_bank_admin(data: BankAdminCreate, db = Depends(get_db)):
    """Create a new bank admin with password (Super Admin only)"""
    try:
        cursor = db.cursor()
        
        # Check if bank exists
        cursor.execute("SELECT id, bank_name FROM banks WHERE id = %s", (data.bank_id,))
        bank = cursor.fetchone()
        if not bank:
            raise HTTPException(status_code=404, detail="Bank not found")
        
        # Check if admin already exists for this bank and email
        cursor.execute("""
            SELECT id FROM bank_admins WHERE bank_id = %s AND email = %s
        """, (data.bank_id, data.email))
        existing = cursor.fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Bank admin with this email already exists for this bank")
        
        # Hash password
        password_hash = hash_password(data.password)
        
        # Create bank admin
        cursor.execute("""
            INSERT INTO bank_admins (bank_id, email, password_hash, phone, full_name)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (data.bank_id, data.email, password_hash, data.phone, data.full_name))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        logger.info(f"Created bank admin for bank {data.bank_id}: {data.email}")
        
        return BankAdminResponse(
            id=result[0],
            bank_id=data.bank_id,
            email=data.email,
            phone=data.phone,
            full_name=data.full_name,
            is_active=True,
            bank_name=bank[1],
            created_at=str(result[1]) if result[1] else None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating bank admin: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating bank admin: {str(e)}")

@router.get("/bank-admins/{bank_id}", response_model=List[BankAdminResponse])
async def get_bank_admins(bank_id: int, db = Depends(get_db)):
    """Get all admins for a bank"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT ba.id, ba.bank_id, ba.email, ba.phone, ba.full_name, ba.is_active, 
                   ba.created_at, b.bank_name
            FROM bank_admins ba
            LEFT JOIN banks b ON ba.bank_id = b.id
            WHERE ba.bank_id = %s
            ORDER BY ba.created_at DESC
        """, (bank_id,))
        
        rows = cursor.fetchall()
        cursor.close()
        
        return [
            BankAdminResponse(
                id=row[0],
                bank_id=row[1],
                email=row[2],
                phone=row[3],
                full_name=row[4],
                is_active=row[5],
                created_at=str(row[6]) if row[6] else None,
                bank_name=row[7]
            )
            for row in rows
        ]
        
    except Exception as e:
        logger.error(f"Error getting bank admins: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting bank admins: {str(e)}")

@router.delete("/bank-admin/{admin_id}")
async def delete_bank_admin(admin_id: int, db = Depends(get_db)):
    """Delete a bank admin (Super Admin only)"""
    try:
        cursor = db.cursor()
        
        # Check if admin exists
        cursor.execute("SELECT id FROM bank_admins WHERE id = %s", (admin_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bank admin not found")
        
        # Delete admin
        cursor.execute("DELETE FROM bank_admins WHERE id = %s", (admin_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deleted bank admin {admin_id}")
        return {"message": "Bank admin deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting bank admin: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting bank admin: {str(e)}")

# ============================================================================
# Branch Admin Management (for Bank Admins)
# ============================================================================

class BranchAdminCreate(BaseModel):
    """Branch admin creation model"""
    branch_id: int
    email: EmailStr
    password: str
    full_name: str
    phone: Optional[str] = None

class BranchAdminResponse(BaseModel):
    """Branch admin response model - matches branch_admins table structure"""
    id: int
    admin_id: str  # Changed from user_id to admin_id
    branch_id: int
    bank_id: int
    email: str
    phone: Optional[str]
    full_name: str
    is_active: bool
    created_at: Optional[str]
    last_login: Optional[datetime] = None
    permissions: Dict[str, Any] = {}
    branch_name: Optional[str]
    branch_code: Optional[str]
    bank_name: Optional[str]
    bank_code: Optional[str]
    created_by: Optional[int] = None

@router.post("/branch-admin", response_model=BranchAdminResponse)
async def create_branch_admin(data: BranchAdminCreate, db = Depends(get_db)):
    """Create a new branch admin (Bank Admin only) - stores in dedicated branch_admins table"""
    try:
        cursor = db.cursor()
        
        # Check if branch exists and get bank_id
        cursor.execute("""
            SELECT b.id, b.branch_name, b.bank_id, bk.bank_name, bk.bank_code, b.branch_code
            FROM branches b
            LEFT JOIN banks bk ON b.bank_id = bk.id
            WHERE b.id = %s
        """, (data.branch_id,))
        branch = cursor.fetchone()
        
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        
        branch_id, branch_name, bank_id, bank_name, bank_code, branch_code = branch
        
        # Check if email already exists in branch_admins for this bank/branch
        cursor.execute("""
            SELECT id FROM branch_admins 
            WHERE email = %s AND bank_id = %s AND branch_id = %s
        """, (data.email, bank_id, branch_id))
        if cursor.fetchone():
            raise HTTPException(
                status_code=400, 
                detail=f"Email already exists for this branch. Please use a different email."
            )
        
        # Generate unique admin_id
        import uuid
        admin_id = f"BA_{bank_id}_{branch_id}_{str(uuid.uuid4())[:8]}".upper()
        
        # Hash password for branch admin login
        password_hash = hash_password(data.password)
        
        # Insert into dedicated branch_admins table
        cursor.execute("""
            INSERT INTO branch_admins (
                bank_id, branch_id, admin_id, full_name, email, phone, 
                password_hash, permissions, is_active, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            RETURNING id
        """, (
            bank_id, branch_id, admin_id, data.full_name, 
            data.email, data.phone, password_hash, '{}', True
        ))
        
        new_id = cursor.fetchone()[0]
        db.commit()
        cursor.close()
        
        logger.info(f"Created branch admin in branch_admins table: {data.email} for branch {branch_name} (Bank: {bank_name})")
        
        return BranchAdminResponse(
            id=new_id,
            admin_id=admin_id,
            branch_id=branch_id,
            bank_id=bank_id,
            email=data.email,
            phone=data.phone,
            full_name=data.full_name,
            is_active=True,
            created_at=str(datetime.now()),
            branch_name=branch_name,
            bank_name=bank_name,
            bank_code=bank_code,
            branch_code=branch_code,
            permissions={},
            last_login=None,
            created_by=None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating branch admin: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating branch admin: {str(e)}")

@router.get("/branch-admins/{bank_id}", response_model=List[BranchAdminResponse])
async def get_branch_admins(bank_id: int, db = Depends(get_db)):
    """Get all branch admins for a bank (Bank Admin only) - reads from branch_admins table"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT ba.id, ba.admin_id, ba.branch_id, ba.bank_id, ba.email, ba.phone, 
                   ba.full_name, ba.is_active, ba.created_at, ba.last_login, ba.permissions,
                   b.branch_name, b.branch_code, bk.bank_name, bk.bank_code
            FROM branch_admins ba
            LEFT JOIN branches b ON ba.branch_id = b.id
            LEFT JOIN banks bk ON ba.bank_id = bk.id
            WHERE ba.bank_id = %s
            ORDER BY ba.created_at DESC
        """, (bank_id,))
        
        rows = cursor.fetchall()
        cursor.close()
        
        return [
            BranchAdminResponse(
                id=row[0],
                admin_id=row[1],
                branch_id=row[2],
                bank_id=row[3],
                email=row[4],
                phone=row[5],
                full_name=row[6],
                is_active=row[7],
                created_at=str(row[8]) if row[8] else None,
                last_login=row[9],
                permissions=row[10] or {},
                branch_name=row[11],
                branch_code=row[12],
                bank_name=row[13],
                bank_code=row[14]
            )
            for row in rows
        ]
        
    except Exception as e:
        logger.error(f"Error getting branch admins: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting branch admins: {str(e)}")

@router.delete("/branch-admin/{admin_id}")
async def delete_branch_admin(admin_id: int, db = Depends(get_db)):
    """Delete a branch admin (Bank Admin only) - soft delete in branch_admins table"""
    try:
        cursor = db.cursor()
        
        # Check if admin exists in branch_admins table
        cursor.execute("""
            SELECT id FROM branch_admins 
            WHERE id = %s
        """, (admin_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Branch admin not found")
        
        # Soft delete admin (set is_active to false)
        cursor.execute("""
            UPDATE branch_admins 
            SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
        """, (admin_id,))
        db.commit()
        cursor.close()
        
        logger.info(f"Deactivated branch admin {admin_id}")
        return {"message": "Branch admin deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting branch admin: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting branch admin: {str(e)}")

@router.get("/all-branch-admins", response_model=List[BranchAdminResponse])
async def get_all_branch_admins(db = Depends(get_db)):
    """Get all branch admins across all banks (Super Admin only)"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT tu.id, tu.user_id, tu.branch_id, tu.bank_id, tu.email, tu.phone, 
                   tu.full_name, tu.is_active, tu.created_at,
                   b.branch_name, bk.bank_name
            FROM tenant_users tu
            LEFT JOIN branches b ON tu.branch_id = b.id
            LEFT JOIN banks bk ON tu.bank_id = bk.id
            WHERE tu.user_role = 'branch_admin'
            ORDER BY bk.bank_name, b.branch_name, tu.created_at DESC
        """)
        
        rows = cursor.fetchall()
        cursor.close()
        
        return [
            BranchAdminResponse(
                id=row[0],
                user_id=row[1],
                branch_id=row[2],
                bank_id=row[3],
                email=row[4],
                phone=row[5],
                full_name=row[6],
                is_active=row[7],
                created_at=str(row[8]) if row[8] else None,
                branch_name=row[9],
                bank_name=row[10]
            )
            for row in rows
        ]
        
    except Exception as e:
        logger.error(f"Error getting all branch admins: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting all branch admins: {str(e)}")

# ============================================================================
# Appraiser Verification Endpoint
# ============================================================================

class AppraiserVerificationRequest(BaseModel):
    """Request model for appraiser verification"""
    name: str
    bank_id: int
    branch_id: int

class AppraiserVerificationResponse(BaseModel):
    """Response model for appraiser verification"""
    exists: bool
    message: str
    appraiser: Optional[dict] = None

@router.post("/verify-appraiser", response_model=AppraiserVerificationResponse)
async def verify_appraiser(request: AppraiserVerificationRequest, db: Session = Depends(get_db)) -> AppraiserVerificationResponse:
    """
    Verify if an appraiser exists and is mapped to the specified bank and branch.
    
    This endpoint:
    1. First checks if appraiser exists in the system by name
    2. Then verifies if they are mapped to the requested bank/branch
    3. Supports appraisers working in multiple banks/branches via mapping table
    
    - **name**: Appraiser's full name
    - **bank_id**: Bank ID where appraiser should be authorized
    - **branch_id**: Branch ID where appraiser should be authorized
    
    Returns verification result and appraiser details if found and mapped
    """
    try:
        from models.database import Database
        database = Database()
        
        # Use the new verification method that checks mapping table
        appraiser_data = database.verify_appraiser_exists_in_bank_branch(
            name=request.name.strip(),
            bank_id=request.bank_id,
            branch_id=request.branch_id
        )
        
        if appraiser_data:
            return AppraiserVerificationResponse(
                exists=True,
                message=f"Appraiser '{request.name}' is authorized for {appraiser_data['bank_name']} - {appraiser_data['branch_name']}",
                appraiser=appraiser_data
            )
        else:
            # Check if appraiser exists but not mapped to this bank/branch
            cursor = db.cursor()
            cursor.execute("""
                SELECT os.name, b.bank_name, br.branch_name 
                FROM overall_sessions os
                LEFT JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                WHERE os.status = 'registered' AND LOWER(os.name) = LOWER(%s)
                LIMIT 1
            """, (request.name.strip(),))
            existing = cursor.fetchone()
            cursor.close()
            
            if existing:
                return AppraiserVerificationResponse(
                    exists=False,
                    message=f"Appraiser '{request.name}' exists but is not authorized for the selected bank/branch. They are registered at {existing[1]} - {existing[2]}. Contact Branch Admin to add authorization."
                )
            else:
                return AppraiserVerificationResponse(
                    exists=False,
                    message=f"Appraiser '{request.name}' is not registered in the system. Only Branch Admin can register new appraisers."
                )
        
    except Exception as e:
        logger.error(f"Error verifying appraiser: {e}")
        raise HTTPException(status_code=500, detail=f"Error verifying appraiser: {str(e)}")

# ============================================================================
# Appraiser Bank/Branch Mapping Endpoints
# ============================================================================

class AppraiserMappingRequest(BaseModel):
    """Request model for appraiser bank/branch mapping"""
    appraiser_id: str
    bank_id: int
    branch_id: int

@router.post("/appraiser-mapping")
async def add_appraiser_mapping(request: AppraiserMappingRequest, db: Session = Depends(get_db)):
    """
    Add an appraiser to a bank/branch mapping.
    Allows the same appraiser to work at multiple banks/branches.
    """
    try:
        from models.database import Database
        database = Database()
        
        # Verify the appraiser exists
        appraiser = database.get_appraiser_by_id(request.appraiser_id)
        if not appraiser:
            raise HTTPException(status_code=404, detail=f"Appraiser '{request.appraiser_id}' not found")
        
        # Add the mapping
        database.add_appraiser_to_bank_branch(request.appraiser_id, request.bank_id, request.branch_id)
        
        return {
            "success": True,
            "message": f"Appraiser mapped to bank {request.bank_id}, branch {request.branch_id}"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding appraiser mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/appraiser-mapping")
async def remove_appraiser_mapping(request: AppraiserMappingRequest, db: Session = Depends(get_db)):
    """
    Remove an appraiser from a bank/branch mapping.
    """
    try:
        from models.database import Database
        database = Database()
        
        database.remove_appraiser_from_bank_branch(request.appraiser_id, request.bank_id, request.branch_id)
        
        return {
            "success": True,
            "message": f"Appraiser mapping removed from bank {request.bank_id}, branch {request.branch_id}"
        }
    except Exception as e:
        logger.error(f"Error removing appraiser mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/appraiser-mappings/{appraiser_id}")
async def get_appraiser_mappings(appraiser_id: str, db: Session = Depends(get_db)):
    """
    Get all bank/branch mappings for an appraiser.
    """
    try:
        from models.database import Database
        database = Database()
        
        mappings = database.get_appraiser_bank_branch_mappings(appraiser_id)
        
        return {
            "appraiser_id": appraiser_id,
            "mappings": mappings,
            "total_mappings": len(mappings)
        }
    except Exception as e:
        logger.error(f"Error getting appraiser mappings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/branch-appraisers/{bank_id}/{branch_id}")
async def get_branch_appraisers(bank_id: int, branch_id: int, db: Session = Depends(get_db)):
    """
    Get all appraisers mapped to a specific bank/branch.
    """
    try:
        from models.database import Database
        database = Database()
        
        appraisers = database.get_appraisers_for_bank_branch(bank_id, branch_id)
        
        return {
            "bank_id": bank_id,
            "branch_id": branch_id,
            "appraisers": appraisers,
            "total_appraisers": len(appraisers)
        }
    except Exception as e:
        logger.error(f"Error getting branch appraisers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# RBAC Appraiser Management Endpoints
# ============================================================================

class AppraiserListRequest(BaseModel):
    """Request model for listing appraisers with RBAC"""
    role: str  # 'super_admin', 'bank_admin', 'branch_admin'
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None

@router.post("/appraisers/list")
async def list_appraisers_rbac(request: AppraiserListRequest, db: Session = Depends(get_db)):
    """
    List appraisers with role-based access control.
    
    - Super Admin: Can view all appraisers across all banks and branches
    - Bank Admin: Can view appraisers only in their bank (all branches)
    - Branch Admin: Can view appraisers only in their specific branch
    """
    try:
        from models.database import Database
        database = Database()
        
        cursor = db.cursor()
        
        # Build query based on role
        base_query = """
            SELECT DISTINCT
                os.id, os.name, os.appraiser_id, os.email, os.phone, os.created_at,
                os.bank_id, os.branch_id, os.image_data,
                b.bank_name, b.bank_code,
                br.branch_name, br.branch_code,
                CASE WHEN os.face_encoding IS NOT NULL THEN true ELSE false END as has_face_encoding,
                (SELECT COUNT(*) FROM overall_sessions s 
                 WHERE s.appraiser_id = os.appraiser_id AND s.status != 'registered') as appraisals_completed
            FROM overall_sessions os
            LEFT JOIN banks b ON os.bank_id = b.id
            LEFT JOIN branches br ON os.branch_id = br.id
            WHERE os.status = 'registered'
        """
        
        params = []
        
        if request.role == 'super_admin':
            # Super Admin: No additional filters - can see all
            pass
        elif request.role == 'bank_admin':
            # Bank Admin: Filter by bank_id
            if not request.bank_id:
                raise HTTPException(status_code=400, detail="bank_id is required for bank_admin role")
            base_query += " AND os.bank_id = %s"
            params.append(request.bank_id)
        elif request.role == 'branch_admin':
            # Branch Admin: Filter by branch_id
            if not request.branch_id:
                raise HTTPException(status_code=400, detail="branch_id is required for branch_admin role")
            base_query += " AND os.branch_id = %s"
            params.append(request.branch_id)
        else:
            raise HTTPException(status_code=400, detail=f"Invalid role: {request.role}")
        
        base_query += " ORDER BY os.created_at DESC"
        
        cursor.execute(base_query, params)
        rows = cursor.fetchall()
        cursor.close()
        
        appraisers = [
            {
                "id": row[0],
                "name": row[1],
                "appraiser_id": row[2],
                "email": row[3],
                "phone": row[4],
                "created_at": str(row[5]) if row[5] else None,
                "bank_id": row[6],
                "branch_id": row[7],
                "image_data": row[8],
                "bank_name": row[9],
                "bank_code": row[10],
                "branch_name": row[11],
                "branch_code": row[12],
                "has_face_encoding": row[13],
                "appraisals_completed": row[14] or 0
            }
            for row in rows
        ]
        
        return {
            "success": True,
            "appraisers": appraisers,
            "total_count": len(appraisers),
            "role": request.role,
            "filtered_by": {
                "bank_id": request.bank_id,
                "branch_id": request.branch_id
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing appraisers with RBAC: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/appraisers/all")
async def get_all_appraisers(
    role: str,
    bank_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    GET endpoint for listing appraisers with role-based access control.
    Query parameters: role (required), bank_id (for bank_admin), branch_id (for branch_admin)
    """
    try:
        cursor = db.cursor()
        
        # Build query based on role
        base_query = """
            SELECT DISTINCT
                os.id, os.name, os.appraiser_id, os.email, os.phone, os.created_at,
                os.bank_id, os.branch_id, os.image_data,
                b.bank_name, b.bank_code,
                br.branch_name, br.branch_code,
                CASE WHEN os.face_encoding IS NOT NULL THEN true ELSE false END as has_face_encoding,
                (SELECT COUNT(*) FROM overall_sessions s 
                 WHERE s.appraiser_id = os.appraiser_id AND s.status != 'registered') as appraisals_completed
            FROM overall_sessions os
            LEFT JOIN banks b ON os.bank_id = b.id
            LEFT JOIN branches br ON os.branch_id = br.id
            WHERE os.status = 'registered'
        """
        
        params = []
        
        if role == 'super_admin':
            # Super Admin: No additional filters
            pass
        elif role == 'bank_admin':
            if not bank_id:
                raise HTTPException(status_code=400, detail="bank_id is required for bank_admin role")
            base_query += " AND os.bank_id = %s"
            params.append(bank_id)
        elif role == 'branch_admin':
            if not branch_id:
                raise HTTPException(status_code=400, detail="branch_id is required for branch_admin role")
            base_query += " AND os.branch_id = %s"
            params.append(branch_id)
        else:
            raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
        
        base_query += " ORDER BY os.created_at DESC"
        
        cursor.execute(base_query, params)
        rows = cursor.fetchall()
        cursor.close()
        
        appraisers = [
            {
                "id": row[0],
                "name": row[1],
                "appraiser_id": row[2],
                "email": row[3],
                "phone": row[4],
                "created_at": str(row[5]) if row[5] else None,
                "bank_id": row[6],
                "branch_id": row[7],
                "image_data": row[8],
                "bank_name": row[9],
                "bank_code": row[10],
                "branch_name": row[11],
                "branch_code": row[12],
                "has_face_encoding": row[13],
                "appraisals_completed": row[14] or 0
            }
            for row in rows
        ]
        
        return {
            "success": True,
            "appraisers": appraisers,
            "total_count": len(appraisers)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting appraisers: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Banks and Branches Endpoints
# ============================================================================

@router.get("/banks")
async def get_banks(db: Session = Depends(get_db)):
    """Get all banks"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT id, bank_name, bank_code, headquarters_address, created_at, is_active
            FROM banks
            WHERE is_active = true
            ORDER BY bank_name
        """)
        
        rows = cursor.fetchall()
        cursor.close()
        
        banks = [
            {
                "id": row[0],
                "bank_name": row[1],
                "bank_code": row[2],
                "bank_address": row[3],
                "created_at": str(row[4]) if row[4] else None,
                "is_active": row[5]
            }
            for row in rows
        ]
        
        return {"banks": banks}
        
    except Exception as e:
        logger.error(f"Error getting banks: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting banks: {str(e)}")

@router.get("/branches")
async def get_branches(bank_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Get all branches, optionally filtered by bank_id"""
    try:
        cursor = db.cursor()
        
        if bank_id:
            cursor.execute("""
                SELECT id, branch_name, branch_code, branch_address, bank_id, created_at, is_active
                FROM branches
                WHERE bank_id = %s AND is_active = true
                ORDER BY branch_name
            """, (bank_id,))
        else:
            cursor.execute("""
                SELECT id, branch_name, branch_code, branch_address, bank_id, created_at, is_active
                FROM branches
                WHERE is_active = true
                ORDER BY branch_name
            """)
        
        rows = cursor.fetchall()
        cursor.close()
        
        branches = [
            {
                "id": row[0],
                "branch_name": row[1],
                "branch_code": row[2],
                "branch_address": row[3],
                "bank_id": row[4],
                "created_at": str(row[5]) if row[5] else None,
                "is_active": row[6]
            }
            for row in rows
        ]
        
        return {"branches": branches}
        
    except Exception as e:
        logger.error(f"Error getting branches: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting branches: {str(e)}")
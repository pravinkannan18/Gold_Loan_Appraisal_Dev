"""
Bank management API router
Handles all bank-related operations
Super Admin required for create/update/delete operations
"""
from fastapi import APIRouter, HTTPException, Depends, Header
from typing import List, Optional
from sqlalchemy.orm import Session
from models.database import get_db
from schemas.tenant import BankCreate, BankUpdate, BankResponse
from routers.super_admin import validate_super_admin_token
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bank", tags=["bank"])

def require_super_admin(x_super_admin_token: Optional[str] = Header(None)):
    """Dependency to require super admin authentication"""
    if not x_super_admin_token or not validate_super_admin_token(x_super_admin_token):
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return True

@router.get("/", response_model=List[BankResponse])
async def get_all_banks(db: Session = Depends(get_db)) -> List[BankResponse]:
    """Get all banks"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT id, bank_code, bank_name, bank_short_name, headquarters_address,
                   contact_email, contact_phone, rbi_license_number,
                   is_active, created_at
            FROM banks ORDER BY bank_name
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
                is_active=row[8],
                created_at=row[9]
            ))
        
        cursor.close()
        logger.info(f"Retrieved {len(banks)} banks")
        return banks
        
    except Exception as e:
        logger.error(f"Error retrieving banks: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving banks: {str(e)}")

@router.get("/{bank_id}", response_model=BankResponse)
async def get_bank(bank_id: int, db: Session = Depends(get_db)) -> BankResponse:
    """Get a specific bank by ID"""
    try:
        cursor = db.cursor()
        cursor.execute("""
            SELECT id, bank_code, bank_name, bank_short_name, headquarters_address,
                   contact_email, contact_phone, rbi_license_number,
                   is_active, created_at
            FROM banks WHERE id = %s
        """, (bank_id,))
        
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bank not found")
        
        bank = BankResponse(
            id=row[0],
            bank_code=row[1],
            bank_name=row[2],
            bank_short_name=row[3],
            headquarters_address=row[4],
            contact_email=row[5],
            contact_phone=row[6],
            rbi_license_number=row[7],
            is_active=row[8],
            created_at=row[9]
        )
        
        cursor.close()
        logger.info(f"Retrieved bank {bank_id}")
        return bank
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving bank: {str(e)}")

@router.post("/", response_model=BankResponse)
async def create_bank(
    bank: BankCreate, 
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
) -> BankResponse:
    """Create a new bank - SUPER ADMIN ONLY"""
    try:
        cursor = db.cursor()
        
        # Check if bank code already exists
        cursor.execute("SELECT id FROM banks WHERE bank_code = %s", (bank.bank_code,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Bank code already exists")
        
        # Create bank
        cursor.execute("""
            INSERT INTO banks (bank_code, bank_name, bank_short_name, headquarters_address,
                             contact_email, contact_phone, rbi_license_number)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (
            bank.bank_code, bank.bank_name, bank.bank_short_name,
            bank.headquarters_address, bank.contact_email, bank.contact_phone,
            bank.rbi_license_number
        ))
        
        result = cursor.fetchone()
        db.commit()
        cursor.close()
        
        # Return created bank
        created_bank = BankResponse(
            id=result[0],
            bank_code=bank.bank_code,
            bank_name=bank.bank_name,
            bank_short_name=bank.bank_short_name,
            headquarters_address=bank.headquarters_address,
            contact_email=bank.contact_email,
            contact_phone=bank.contact_phone,
            rbi_license_number=bank.rbi_license_number,
            is_active=True,
            created_at=result[1]
        )
        
        logger.info(f"Created bank {bank.bank_code}")
        return created_bank
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating bank: {str(e)}")

@router.put("/{bank_id}", response_model=BankResponse)
async def update_bank(
    bank_id: int, 
    bank: BankUpdate, 
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
) -> BankResponse:
    """Update an existing bank - SUPER ADMIN ONLY"""
    try:
        cursor = db.cursor()
        
        # Check if bank exists
        cursor.execute("SELECT id FROM banks WHERE id = %s", (bank_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bank not found")
        
        # Build update query dynamically
        update_fields = []
        update_values = []
        
        if bank.bank_name is not None:
            update_fields.append("bank_name = %s")
            update_values.append(bank.bank_name)
        if bank.bank_short_name is not None:
            update_fields.append("bank_short_name = %s")
            update_values.append(bank.bank_short_name)
        if bank.headquarters_address is not None:
            update_fields.append("headquarters_address = %s")
            update_values.append(bank.headquarters_address)
        if bank.contact_email is not None:
            update_fields.append("contact_email = %s")
            update_values.append(bank.contact_email)
        if bank.contact_phone is not None:
            update_fields.append("contact_phone = %s")
            update_values.append(bank.contact_phone)
        if bank.is_active is not None:
            update_fields.append("is_active = %s")
            update_values.append(bank.is_active)
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_values.append(bank_id)
        update_query = f"UPDATE banks SET {', '.join(update_fields)} WHERE id = %s"
        
        cursor.execute(update_query, update_values)
        db.commit()
        
        # Get updated bank
        cursor.execute("""
            SELECT id, bank_code, bank_name, bank_short_name, headquarters_address,
                   contact_email, contact_phone, rbi_license_number,
                   is_active, created_at
            FROM banks WHERE id = %s
        """, (bank_id,))
        
        row = cursor.fetchone()
        updated_bank = BankResponse(
            id=row[0],
            bank_code=row[1],
            bank_name=row[2],
            bank_short_name=row[3],
            headquarters_address=row[4],
            contact_email=row[5],
            contact_phone=row[6],
            rbi_license_number=row[7],
            is_active=row[8],
            created_at=row[9]
        )
        
        cursor.close()
        logger.info(f"Updated bank {bank_id}")
        return updated_bank
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating bank: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating bank: {str(e)}")

@router.delete("/{bank_id}")
async def delete_bank(
    bank_id: int, 
    force: bool = False,
    db: Session = Depends(get_db),
    _: bool = Depends(require_super_admin)
):
    """Delete a bank - SUPER ADMIN ONLY
    
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
                detail=f"Cannot delete bank '{bank_name}' with {branch_count} branches. Use force=true to cascade delete all associated data."
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
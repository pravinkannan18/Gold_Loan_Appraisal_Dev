"""
Tenant Hierarchy Schemas for Gold Loan Appraisal System

This module contains schemas for:
- Banks (top-level tenants)
- Branches (sub-tenants under banks)
- Tenant Users (employees/appraisers within the hierarchy)
- Tenant context and relationships
"""

from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

from .common import TimestampMixin, ContactInfo, AddressInfo, SystemConfiguration, TenantSettings

# ============================================================================
# Tenant-specific Enums
# ============================================================================

class UserRole(str, Enum):
    """User roles in the tenant hierarchy"""
    SUPER_ADMIN = "super_admin"
    BANK_ADMIN = "bank_admin" 
    BRANCH_MANAGER = "branch_manager"
    SENIOR_APPRAISER = "senior_appraiser"
    APPRAISER = "appraiser"
    TRAINEE_APPRAISER = "trainee_appraiser"

# ============================================================================
# Bank Models
# ============================================================================

class BankBase(BaseModel):
    """Base bank model with common fields"""
    bank_code: str = Field(..., min_length=2, max_length=20, description="Unique bank identifier code")
    bank_name: str = Field(..., min_length=1, max_length=255, description="Full bank name")
    bank_short_name: Optional[str] = Field(None, max_length=50, description="Short display name")
    headquarters_address: Optional[str] = Field(None, description="Bank headquarters address")
    contact_email: Optional[EmailStr] = Field(None, description="Bank contact email")
    contact_phone: Optional[str] = Field(None, max_length=20, description="Bank contact phone")
    rbi_license_number: Optional[str] = Field(None, max_length=50, description="RBI license number")
    
    @validator('bank_code')
    def validate_bank_code(cls, v):
        # Allow alphanumeric and underscores
        if not all(c.isalnum() or c == '_' for c in v):
            raise ValueError('Bank code must be alphanumeric (underscores allowed)')
        return v.upper()

class BankCreate(BankBase):
    """Schema for creating a new bank"""
    system_configuration: Optional[SystemConfiguration] = Field(None, description="System configuration")
    tenant_settings: Optional[TenantSettings] = Field(None, description="Tenant settings")

class BankUpdate(BaseModel):
    """Schema for updating bank information"""
    bank_name: Optional[str] = None
    bank_short_name: Optional[str] = None
    headquarters_address: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    rbi_license_number: Optional[str] = None
    system_configuration: Optional[SystemConfiguration] = None
    tenant_settings: Optional[TenantSettings] = None
    is_active: Optional[bool] = None

class Bank(BankBase, TimestampMixin):
    """Complete bank model with all fields"""
    id: int
    is_active: bool = True
    system_configuration: Optional[SystemConfiguration] = None
    tenant_settings: Optional[TenantSettings] = None
    
    class Config:
        from_attributes = True

# ============================================================================
# Branch Models
# ============================================================================

class BranchBase(BaseModel):
    """Base branch model with common fields"""
    branch_code: str = Field(..., min_length=1, max_length=20, description="Branch code within bank")
    branch_name: str = Field(..., min_length=1, max_length=255, description="Full branch name")
    branch_address: Optional[str] = Field(None, description="Branch address")
    branch_city: Optional[str] = Field(None, max_length=100, description="Branch city")
    branch_state: Optional[str] = Field(None, max_length=100, description="Branch state")
    branch_pincode: Optional[str] = Field(None, max_length=10, description="Branch pincode")
    contact_email: Optional[EmailStr] = Field(None, description="Branch contact email")
    contact_phone: Optional[str] = Field(None, max_length=20, description="Branch phone")
    manager_name: Optional[str] = Field(None, max_length=255, description="Branch manager name")
    latitude: Optional[float] = Field(None, ge=-90, le=90, description="Branch latitude")
    longitude: Optional[float] = Field(None, ge=-180, le=180, description="Branch longitude")
    
    @validator('branch_code')
    def validate_branch_code(cls, v):
        if not v.replace('_', '').isalnum():
            raise ValueError('Branch code must be alphanumeric (underscores allowed)')
        return v.upper()

class OperationalHours(BaseModel):
    """Model for branch operational hours"""
    monday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    tuesday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    wednesday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    thursday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    friday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    saturday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)
    sunday: Optional[Dict[str, Optional[str]]] = Field(default_factory=dict)

class BranchCreate(BranchBase):
    """Schema for creating a new branch"""
    bank_id: int = Field(..., description="Bank ID this branch belongs to")
    branch_settings: Optional[Dict[str, Any]] = Field(default_factory=dict)
    operational_hours: Optional[OperationalHours] = None

class BranchUpdate(BaseModel):
    """Schema for updating branch information"""
    branch_name: Optional[str] = None
    branch_address: Optional[str] = None
    branch_city: Optional[str] = None
    branch_state: Optional[str] = None
    branch_pincode: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    manager_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    branch_settings: Optional[Dict[str, Any]] = None
    operational_hours: Optional[OperationalHours] = None
    is_active: Optional[bool] = None

class Branch(BranchBase, TimestampMixin):
    """Complete branch model with all fields"""
    id: int
    bank_id: int
    is_active: bool = True
    branch_settings: Optional[Dict[str, Any]] = None
    operational_hours: Optional[OperationalHours] = None
    
    # Populated from joins
    bank_name: Optional[str] = None
    bank_code: Optional[str] = None
    
    class Config:
        from_attributes = True

# ============================================================================
# Tenant User Models
# ============================================================================

class TenantUserBase(BaseModel):
    """Base tenant user model"""
    user_id: str = Field(..., min_length=1, max_length=50, description="Unique user ID within bank")
    full_name: str = Field(..., min_length=1, max_length=255, description="User's full name")
    email: Optional[EmailStr] = Field(None, description="User email")
    phone: Optional[str] = Field(None, max_length=20, description="User phone")
    employee_id: Optional[str] = Field(None, max_length=50, description="Employee ID")
    designation: Optional[str] = Field(None, max_length=100, description="Job designation")
    user_role: UserRole = Field(UserRole.APPRAISER, description="User role in system")
    
    @validator('user_id')
    def validate_user_id(cls, v):
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('User ID must be alphanumeric (underscores and hyphens allowed)')
        return v.upper()

class UserPermissions(BaseModel):
    """Model for user permissions"""
    can_create_sessions: bool = Field(True, description="Can create appraisal sessions")
    can_view_reports: bool = Field(True, description="Can view reports")
    can_approve_loans: bool = Field(False, description="Can approve loans")
    can_manage_users: bool = Field(False, description="Can manage other users")
    can_manage_branches: bool = Field(False, description="Can manage branches")
    max_loan_amount: Optional[float] = Field(None, description="Maximum loan amount user can handle")
    access_level: Optional[str] = Field("standard", description="Access level")

class TenantUserCreate(TenantUserBase):
    """Schema for creating a new tenant user"""
    bank_id: int = Field(..., description="Bank ID user belongs to")
    branch_id: Optional[int] = Field(None, description="Branch ID user belongs to")
    face_encoding: Optional[str] = Field(None, description="Encoded face data for recognition")
    image_data: Optional[str] = Field(None, description="Base64 encoded profile image")
    permissions: Optional[UserPermissions] = Field(None, description="User permissions")

class TenantUserUpdate(BaseModel):
    """Schema for updating tenant user information"""
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    designation: Optional[str] = None
    user_role: Optional[UserRole] = None
    branch_id: Optional[int] = None
    face_encoding: Optional[str] = None
    image_data: Optional[str] = None
    permissions: Optional[UserPermissions] = None
    is_active: Optional[bool] = None

class TenantUser(TenantUserBase, TimestampMixin):
    """Complete tenant user model"""
    id: int
    bank_id: int
    branch_id: Optional[int] = None
    face_encoding: Optional[str] = None
    image_data: Optional[str] = None
    permissions: Optional[UserPermissions] = None
    is_active: bool = True
    last_login: Optional[datetime] = None
    
    # Populated from joins
    bank_name: Optional[str] = None
    bank_code: Optional[str] = None
    branch_name: Optional[str] = None
    branch_code: Optional[str] = None
    
    class Config:
        from_attributes = True

# ============================================================================
# Tenant Context Models
# ============================================================================

class TenantContext(BaseModel):
    """Model for passing tenant context throughout the application"""
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    tenant_user_id: Optional[int] = None
    bank_code: Optional[str] = None
    branch_code: Optional[str] = None
    user_id: Optional[str] = None
    
    # Resolved names for display
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    user_full_name: Optional[str] = None
    
    # Permissions and settings
    user_role: Optional[UserRole] = None
    permissions: Optional[UserPermissions] = None
    tenant_settings: Optional[TenantSettings] = None

# ============================================================================
# Response Models
# ============================================================================

class TenantHierarchyBranch(BaseModel):
    """Branch information for hierarchy response"""
    branch_id: int
    branch_code: str
    branch_name: str
    branch_city: Optional[str] = None
    user_count: int
    users: List[Dict[str, Any]] = Field(default_factory=list)

class TenantHierarchyBank(BaseModel):
    """Bank information for hierarchy response"""
    bank_id: int
    bank_code: str
    bank_name: str
    branch_count: int
    branches: List[TenantHierarchyBranch] = Field(default_factory=list)

class TenantHierarchyResponse(BaseModel):
    """Complete tenant hierarchy response"""
    total_banks: int
    hierarchy: List[TenantHierarchyBank]

class BankStatsResponse(BaseModel):
    """Bank statistics response"""
    total_appraisals: int
    completed_appraisals: int
    in_progress_appraisals: int
    total_items: int
    branch_breakdown: List[Dict[str, Any]]

class TenantSetupResponse(BaseModel):
    """Tenant setup response"""
    status: str
    setup_summary: Dict[str, int]
    sample_data: Optional[Dict[str, Any]] = None
    migration_result: Optional[Dict[str, Any]] = None

# ============================================================================
# Request Models
# ============================================================================

class TenantContextRequest(BaseModel):
    """Request model for resolving tenant context"""
    bank_code: Optional[str] = Field(None, description="Bank code")
    branch_code: Optional[str] = Field(None, description="Branch code")
    user_id: Optional[str] = Field(None, description="User ID")

class BulkUserCreateRequest(BaseModel):
    """Request model for creating multiple users"""
    users: List[TenantUserCreate] = Field(..., description="List of users to create")
    bank_id: int = Field(..., description="Bank ID for all users")
    send_notifications: bool = Field(True, description="Send welcome notifications")

class TenantMigrationRequest(BaseModel):
    """Request model for tenant data migration"""
    migrate_sessions: bool = Field(True, description="Migrate existing sessions")
    migrate_appraisers: bool = Field(True, description="Migrate appraiser data")
    create_missing_tenants: bool = Field(True, description="Auto-create missing banks/branches")
    dry_run: bool = Field(False, description="Perform validation only")

# ============================================================================
# Response Models for API
# ============================================================================

class BankResponse(Bank):
    """Bank response model for API"""
    pass

class BranchResponse(Branch):
    """Branch response model for API"""
    pass

class TenantUserResponse(TenantUser):
    """Tenant user response model for API"""
    bank_name: Optional[str] = Field(None, description="Bank name for display")
    branch_name: Optional[str] = Field(None, description="Branch name for display")

# ============================================================================
# Admin User Models
# ============================================================================

class AdminUserResponse(BaseModel):
    """Admin user response model"""
    id: int
    name: str
    email: str
    role: UserRole
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    is_active: bool = True
    created_at: datetime
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    
    class Config:
        from_attributes = True

class AdminUserCreate(BaseModel):
    """Create admin user model"""
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    role: UserRole
    phone: Optional[str] = Field(None, max_length=20)
    employee_id: Optional[str] = Field(None, max_length=50)
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None

class AdminUserUpdate(BaseModel):
    """Update admin user model"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    phone: Optional[str] = Field(None, max_length=20)
    employee_id: Optional[str] = Field(None, max_length=50)
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    is_active: Optional[bool] = None
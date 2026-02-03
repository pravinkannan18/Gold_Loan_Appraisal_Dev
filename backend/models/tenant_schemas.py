"""
Pydantic Models for Tenant Hierarchy in Gold Loan Appraisal System

This module defines the data models for:
- Banks (top-level tenants)
- Branches (sub-tenants under banks)
- Tenant Users (employees/appraisers within the hierarchy)
- Session models with tenant context
"""

from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from enum import Enum

# ============================================================================
# Enums
# ============================================================================

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    BANK_ADMIN = "bank_admin" 
    BRANCH_MANAGER = "branch_manager"
    SENIOR_APPRAISER = "senior_appraiser"
    APPRAISER = "appraiser"
    TRAINEE_APPRAISER = "trainee_appraiser"

class SessionStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    APPRAISER_COMPLETED = "appraiser_completed"
    CUSTOMER_COMPLETED = "customer_completed"
    RBI_COMPLETED = "rbi_completed"
    PURITY_COMPLETED = "purity_completed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REGISTERED = "registered"

# ============================================================================
# Base Models
# ============================================================================

class TimestampMixin(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# ============================================================================
# Bank Models
# ============================================================================

class BankBase(BaseModel):
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
    system_configuration: Optional[Dict[str, Any]] = Field(default_factory=dict)
    tenant_settings: Optional[Dict[str, Any]] = Field(default_factory=dict)

class BankUpdate(BaseModel):
    bank_name: Optional[str] = None
    bank_short_name: Optional[str] = None
    headquarters_address: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    rbi_license_number: Optional[str] = None
    system_configuration: Optional[Dict[str, Any]] = None
    tenant_settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

class Bank(BankBase, TimestampMixin):
    id: int
    is_active: bool = True
    system_configuration: Dict[str, Any] = Field(default_factory=dict)
    tenant_settings: Dict[str, Any] = Field(default_factory=dict)
    
    class Config:
        from_attributes = True

# ============================================================================
# Branch Models
# ============================================================================

class BranchBase(BaseModel):
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

class BranchCreate(BranchBase):
    bank_id: int = Field(..., description="Bank ID this branch belongs to")
    branch_settings: Optional[Dict[str, Any]] = Field(default_factory=dict)
    operational_hours: Optional[Dict[str, Any]] = Field(default_factory=dict)

class BranchUpdate(BaseModel):
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
    operational_hours: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

class Branch(BranchBase, TimestampMixin):
    id: int
    bank_id: int
    is_active: bool = True
    branch_settings: Dict[str, Any] = Field(default_factory=dict)
    operational_hours: Dict[str, Any] = Field(default_factory=dict)
    
    # Populated from joins
    bank_name: Optional[str] = None
    bank_code: Optional[str] = None
    
    class Config:
        from_attributes = True

# ============================================================================
# Tenant User Models
# ============================================================================

class TenantUserBase(BaseModel):
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

class TenantUserCreate(TenantUserBase):
    bank_id: int = Field(..., description="Bank ID user belongs to")
    branch_id: Optional[int] = Field(None, description="Branch ID user belongs to")
    face_encoding: Optional[str] = Field(None, description="Encoded face data for recognition")
    image_data: Optional[str] = Field(None, description="Base64 encoded profile image")
    permissions: Optional[Dict[str, Any]] = Field(default_factory=dict, description="User permissions")

class TenantUserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    designation: Optional[str] = None
    user_role: Optional[UserRole] = None
    branch_id: Optional[int] = None
    face_encoding: Optional[str] = None
    image_data: Optional[str] = None
    permissions: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

class TenantUser(TenantUserBase, TimestampMixin):
    id: int
    bank_id: int
    branch_id: Optional[int] = None
    face_encoding: Optional[str] = None
    image_data: Optional[str] = None
    permissions: Dict[str, Any] = Field(default_factory=dict)
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
# Session Models with Tenant Context
# ============================================================================

class SessionBase(BaseModel):
    session_id: str = Field(..., description="Unique session identifier")
    status: SessionStatus = Field(SessionStatus.IN_PROGRESS, description="Session status")

class SessionCreate(SessionBase):
    bank_id: Optional[int] = Field(None, description="Bank ID for tenant context")
    branch_id: Optional[int] = Field(None, description="Branch ID for tenant context")
    tenant_user_id: Optional[int] = Field(None, description="Tenant user ID for appraiser")
    session_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    customer_context: Optional[Dict[str, Any]] = Field(default_factory=dict)

class SessionUpdate(BaseModel):
    status: Optional[SessionStatus] = None
    session_metadata: Optional[Dict[str, Any]] = None
    customer_context: Optional[Dict[str, Any]] = None

class Session(SessionBase, TimestampMixin):
    id: int
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    tenant_user_id: Optional[int] = None
    session_metadata: Dict[str, Any] = Field(default_factory=dict)
    customer_context: Dict[str, Any] = Field(default_factory=dict)
    
    # Legacy fields for backward compatibility
    name: Optional[str] = None
    bank: Optional[str] = None
    branch: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    appraiser_id: Optional[str] = None
    image_data: Optional[str] = None
    face_encoding: Optional[str] = None
    
    # Populated from joins
    bank_name: Optional[str] = None
    bank_code: Optional[str] = None
    branch_name: Optional[str] = None
    branch_code: Optional[str] = None
    appraiser_name: Optional[str] = None
    
    class Config:
        from_attributes = True

# ============================================================================
# Appraiser Data Models (Enhanced)
# ============================================================================

class AppraiserData(BaseModel):
    name: str = Field(..., description="Appraiser name")
    id: str = Field(..., description="Appraiser ID")  # Legacy field name
    bank: Optional[str] = Field(None, description="Bank name (legacy)")
    branch: Optional[str] = Field(None, description="Branch name (legacy)")
    email: Optional[EmailStr] = Field(None, description="Appraiser email")
    phone: Optional[str] = Field(None, description="Appraiser phone")
    image: Optional[str] = Field(None, description="Base64 encoded image")
    timestamp: Optional[datetime] = None
    
    # New tenant hierarchy fields
    bank_id: Optional[int] = Field(None, description="Bank ID from tenant hierarchy")
    branch_id: Optional[int] = Field(None, description="Branch ID from tenant hierarchy")
    tenant_user_id: Optional[int] = Field(None, description="Tenant user ID")

# ============================================================================
# Customer Data Models (Enhanced)
# ============================================================================

class CustomerData(BaseModel):
    customer_front_image: Optional[str] = Field(None, description="Customer front image (base64)")
    customer_name: Optional[str] = Field(None, max_length=255, description="Customer name")
    customer_id: Optional[str] = Field(None, max_length=100, description="Customer ID/document number")
    customer_phone: Optional[str] = Field(None, max_length=20, description="Customer phone")
    customer_address: Optional[str] = Field(None, description="Customer address")

# ============================================================================
# RBI Compliance Models (Enhanced)
# ============================================================================

class RBIComplianceData(BaseModel):
    total_items: Optional[int] = Field(0, ge=0, description="Total number of items")
    overall_images: Optional[List[str]] = Field(default_factory=list, description="Overall images")
    jewellery_items: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Individual jewellery items")
    gps_coords: Optional[str] = Field(None, description="GPS coordinates")
    compliance_checklist: Optional[Dict[str, Any]] = Field(default_factory=dict, description="RBI compliance checklist")
    regulatory_notes: Optional[str] = Field(None, description="Regulatory notes")

# ============================================================================
# Purity Test Models (Enhanced) 
# ============================================================================

class PurityTestData(BaseModel):
    total_items: Optional[int] = Field(0, ge=0, description="Total number of items tested")
    results: Union[str, Dict[str, Any], List[Dict[str, Any]]] = Field(..., description="Purity test results")
    test_method: Optional[str] = Field("standard", description="Test method used")
    quality_parameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Quality parameters")
    certification_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Certification data")

# ============================================================================
# Response Models
# ============================================================================

class TenantHierarchyResponse(BaseModel):
    total_banks: int
    hierarchy: List[Dict[str, Any]]

class BankStatsResponse(BaseModel):
    total_appraisals: int
    completed_appraisals: int
    in_progress_appraisals: int
    total_items: int
    branch_breakdown: List[Dict[str, Any]]

class SessionListResponse(BaseModel):
    sessions: List[Session]
    total_count: int
    bank_context: Optional[Bank] = None
    branch_context: Optional[Branch] = None

class TenantSetupResponse(BaseModel):
    status: str
    setup_summary: Dict[str, int]
    sample_data: Optional[Dict[str, Any]] = None
    migration_result: Optional[Dict[str, Any]] = None

# ============================================================================
# Request Models for API Endpoints
# ============================================================================

class SessionCreateRequest(BaseModel):
    bank_code: Optional[str] = Field(None, description="Bank code for session context")
    branch_code: Optional[str] = Field(None, description="Branch code for session context")
    user_id: Optional[str] = Field(None, description="User ID for appraiser context")
    session_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class AppraiserRegistrationRequest(BaseModel):
    name: str = Field(..., description="Appraiser full name")
    appraiser_id: str = Field(..., description="Unique appraiser ID")
    bank_code: Optional[str] = Field(None, description="Bank code")
    branch_code: Optional[str] = Field(None, description="Branch code")
    email: Optional[EmailStr] = Field(None, description="Appraiser email")
    phone: Optional[str] = Field(None, description="Appraiser phone")
    image_data: Optional[str] = Field(None, description="Base64 encoded image")
    employee_id: Optional[str] = Field(None, description="Employee ID")
    designation: Optional[str] = Field(None, description="Job designation")

# ============================================================================
# Utility Models
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
    permissions: Optional[Dict[str, Any]] = Field(default_factory=dict)
    tenant_settings: Optional[Dict[str, Any]] = Field(default_factory=dict)
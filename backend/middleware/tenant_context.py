"""
Tenant Context Middleware for Multi-Bank/Multi-Branch Isolation

Provides:
- Automatic tenant context extraction from requests
- Request-scoped tenant context storage
- Tenant isolation validation
- Cross-tenant access prevention
"""

import logging
from typing import Optional, Dict, Any
from contextvars import ContextVar
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ============================================================================
# Context Variables (Thread-Safe Request-Scoped Storage)
# ============================================================================

# Context variable for storing tenant context per request
_tenant_context: ContextVar[Optional["TenantContext"]] = ContextVar(
    "tenant_context", default=None
)


class TenantContext(BaseModel):
    """
    Tenant context for the current request
    
    This is extracted from JWT tokens, headers, or request parameters
    and used to scope all database queries to the appropriate tenant.
    """
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    user_id: Optional[int] = None
    user_role: Optional[str] = None  # 'super_admin', 'bank_admin', 'branch_admin', 'appraiser'
    
    # Resolved names for logging/display
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    user_name: Optional[str] = None
    
    # Permission flags
    is_super_admin: bool = False
    can_access_all_banks: bool = False
    can_access_all_branches: bool = False
    
    class Config:
        arbitrary_types_allowed = True

    def can_access_bank(self, target_bank_id: int) -> bool:
        """Check if current context can access the target bank"""
        if self.is_super_admin or self.can_access_all_banks:
            return True
        return self.bank_id == target_bank_id
    
    def can_access_branch(self, target_bank_id: int, target_branch_id: int) -> bool:
        """Check if current context can access the target branch"""
        if self.is_super_admin or self.can_access_all_banks:
            return True
        if self.bank_id != target_bank_id:
            return False
        if self.can_access_all_branches:
            return True
        return self.branch_id == target_branch_id or self.branch_id is None
    
    def get_bank_filter(self) -> Optional[int]:
        """Get bank_id to filter queries, or None for super_admin"""
        if self.is_super_admin or self.can_access_all_banks:
            return None
        return self.bank_id
    
    def get_branch_filter(self) -> Optional[int]:
        """Get branch_id to filter queries, or None if can access all branches"""
        if self.is_super_admin or self.can_access_all_banks or self.can_access_all_branches:
            return None
        return self.branch_id


# ============================================================================
# Context Accessors
# ============================================================================

def get_current_tenant() -> Optional[TenantContext]:
    """Get the current tenant context for this request"""
    return _tenant_context.get()


def set_current_tenant(context: TenantContext) -> None:
    """Set the tenant context for this request"""
    _tenant_context.set(context)


def clear_current_tenant() -> None:
    """Clear the tenant context"""
    _tenant_context.set(None)


def require_tenant_context() -> TenantContext:
    """Get tenant context or raise exception if not set"""
    ctx = get_current_tenant()
    if ctx is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required - no tenant context"
        )
    return ctx


def require_bank_access(bank_id: int) -> TenantContext:
    """Require that current context can access the specified bank"""
    ctx = require_tenant_context()
    if not ctx.can_access_bank(bank_id):
        logger.warning(f"Access denied: User {ctx.user_id} tried to access bank {bank_id}")
        raise HTTPException(
            status_code=403,
            detail="Access denied - you don't have permission to access this bank"
        )
    return ctx


def require_branch_access(bank_id: int, branch_id: int) -> TenantContext:
    """Require that current context can access the specified branch"""
    ctx = require_tenant_context()
    if not ctx.can_access_branch(bank_id, branch_id):
        logger.warning(f"Access denied: User {ctx.user_id} tried to access branch {branch_id}")
        raise HTTPException(
            status_code=403,
            detail="Access denied - you don't have permission to access this branch"
        )
    return ctx


# ============================================================================
# Middleware
# ============================================================================

class TenantContextMiddleware(BaseHTTPMiddleware):
    """
    Middleware to extract tenant context from requests
    
    Extracts tenant information from:
    1. JWT tokens (Authorization header)
    2. X-Bank-ID / X-Branch-ID headers
    3. Query parameters (bank_id, branch_id)
    """
    
    # Paths that don't require tenant context
    PUBLIC_PATHS = {
        "/health",
        "/api/ready",
        "/api/live",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/api/super-admin/login",
        "/api/admin/login",
        "/api/banks",  # Public bank list for login dropdown
        "/api/branches",  # Public branch list for login dropdown
    }
    
    # Path prefixes that don't require tenant context
    PUBLIC_PREFIXES = (
        "/api/face/",  # Face recognition for login
        "/api/webrtc/",  # WebRTC for video streaming
    )
    
    async def dispatch(self, request: Request, call_next):
        # Clear any existing context
        clear_current_tenant()
        
        path = request.url.path
        
        # Skip tenant extraction for public paths
        if self._is_public_path(path):
            return await call_next(request)
        
        try:
            # Extract tenant context from request
            context = await self._extract_tenant_context(request)
            
            if context:
                set_current_tenant(context)
                logger.debug(f"Tenant context set: bank={context.bank_id}, branch={context.branch_id}, role={context.user_role}")
            
            response = await call_next(request)
            return response
            
        finally:
            # Always clear context after request
            clear_current_tenant()
    
    def _is_public_path(self, path: str) -> bool:
        """Check if path is public (no tenant context needed)"""
        if path in self.PUBLIC_PATHS:
            return True
        for prefix in self.PUBLIC_PREFIXES:
            if path.startswith(prefix):
                return True
        return False
    
    async def _extract_tenant_context(self, request: Request) -> Optional[TenantContext]:
        """Extract tenant context from request - JWT tokens only for security"""
        
        # Only extract from Authorization header (JWT) - secure authentication
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            context = self._extract_from_jwt(token)
            if context:
                return context
        
        # NOTE: Header-based and query-parameter based tenant context extraction
        # has been removed for security. Tenant context must come from validated JWT.
        # If internal service-to-service calls need tenant context, they should
        # use a separate authentication mechanism (e.g., mTLS, service tokens).
        
        return None
    
    def _extract_from_jwt(self, token: str) -> Optional[TenantContext]:
        """Extract tenant context from JWT token"""
        import jwt
        import os
        
        # Get JWT secret - REQUIRED, no fallback for security
        jwt_secret = os.getenv("JWT_SECRET_KEY")
        if not jwt_secret:
            logger.error("JWT_SECRET_KEY environment variable is not set")
            return None
        
        # Try to decode token
        try:
            payload = jwt.decode(token, jwt_secret, algorithms=["HS256"])
            
            role = payload.get("role")
            is_super = role == "super_admin"
            
            return TenantContext(
                bank_id=payload.get("bank_id"),
                branch_id=payload.get("branch_id"),
                user_id=payload.get("user_id"),
                user_role=role,
                is_super_admin=is_super,
                can_access_all_banks=is_super,
                can_access_all_branches=role in ("super_admin", "bank_admin"),
            )
        except jwt.ExpiredSignatureError:
            logger.debug("JWT token has expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.debug(f"Invalid JWT token: {type(e).__name__}")
            return None


# ============================================================================
# Query Builder Helpers for Tenant Isolation
# ============================================================================

def build_tenant_where_clause(
    table_alias: str = "",
    include_bank: bool = True,
    include_branch: bool = True,
    additional_conditions: list = None
) -> tuple[str, list]:
    """
    Build WHERE clause conditions based on current tenant context
    
    Returns:
        tuple: (where_clause_string, params_list)
    
    Example:
        clause, params = build_tenant_where_clause("os")
        query = f"SELECT * FROM overall_sessions os WHERE {clause}"
        cursor.execute(query, params)
    """
    ctx = get_current_tenant()
    # Always create a fresh list to avoid mutating caller's list
    conditions = list(additional_conditions) if additional_conditions else []
    params = []
    
    prefix = f"{table_alias}." if table_alias else ""
    
    # If no context or super admin, no tenant filtering
    if ctx is None or ctx.is_super_admin:
        if conditions:
            return " AND ".join(conditions), params
        return "1=1", params
    
    # Add bank filter if needed
    if include_bank and ctx.bank_id:
        conditions.append(f"{prefix}bank_id = %s")
        params.append(ctx.bank_id)
    
    # Add branch filter if needed (only for branch-scoped users)
    if include_branch and ctx.branch_id and not ctx.can_access_all_branches:
        conditions.append(f"{prefix}branch_id = %s")
        params.append(ctx.branch_id)
    
    if conditions:
        return " AND ".join(conditions), params
    return "1=1", params


def add_tenant_filter_to_query(
    base_query: str,
    table_alias: str = "",
    params: list = None
) -> tuple[str, list]:
    """
    Add tenant filtering to an existing query
    
    Example:
        query = "SELECT * FROM sessions"
        query, params = add_tenant_filter_to_query(query, params=[])
        cursor.execute(query, params)
    """
    params = params or []
    
    clause, tenant_params = build_tenant_where_clause(table_alias)
    
    # Check if query already has WHERE
    upper_query = base_query.upper()
    if "WHERE" in upper_query:
        # Add to existing WHERE clause
        where_idx = upper_query.index("WHERE")
        # Find end of WHERE clause (before GROUP BY, ORDER BY, LIMIT, etc.)
        end_markers = ["GROUP BY", "ORDER BY", "LIMIT", "HAVING", ";"]
        end_idx = len(base_query)
        for marker in end_markers:
            marker_idx = upper_query.find(marker)
            if marker_idx > where_idx and marker_idx < end_idx:
                end_idx = marker_idx
        
        # Insert tenant conditions
        before_where = base_query[:where_idx + 6]  # "WHERE "
        where_conditions = base_query[where_idx + 6:end_idx].strip()
        after_where = base_query[end_idx:]
        
        new_query = f"{before_where}{where_conditions} AND {clause}{after_where}"
    else:
        # Add new WHERE clause before GROUP BY, ORDER BY, LIMIT
        end_markers = ["GROUP BY", "ORDER BY", "LIMIT", ";"]
        insert_idx = len(base_query)
        for marker in end_markers:
            marker_idx = upper_query.find(marker)
            if marker_idx != -1 and marker_idx < insert_idx:
                insert_idx = marker_idx
        
        before = base_query[:insert_idx].rstrip()
        after = base_query[insert_idx:]
        new_query = f"{before} WHERE {clause} {after}"
    
    return new_query, params + tenant_params


# ============================================================================
# Dependency Injection Helpers
# ============================================================================

async def get_tenant_context(request: Request) -> Optional[TenantContext]:
    """FastAPI dependency to get current tenant context"""
    return get_current_tenant()


async def require_authenticated_tenant(request: Request) -> TenantContext:
    """FastAPI dependency that requires valid tenant context"""
    return require_tenant_context()


async def require_super_admin(request: Request) -> TenantContext:
    """FastAPI dependency that requires super admin access"""
    ctx = require_tenant_context()
    if not ctx.is_super_admin:
        raise HTTPException(
            status_code=403,
            detail="Super admin access required"
        )
    return ctx


async def require_bank_admin_or_higher(request: Request) -> TenantContext:
    """FastAPI dependency that requires bank admin or super admin access"""
    ctx = require_tenant_context()
    if ctx.user_role not in ("super_admin", "bank_admin"):
        raise HTTPException(
            status_code=403,
            detail="Bank admin or higher access required"
        )
    return ctx

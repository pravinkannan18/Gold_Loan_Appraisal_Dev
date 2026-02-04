"""
Middleware package for robust API handling and multi-tenant support
"""
from .error_handler import setup_exception_handlers
from .rate_limiter import RateLimiter
from .request_validator import RequestValidationMiddleware
from .logging_middleware import RequestLoggingMiddleware
from .tenant_context import (
    TenantContextMiddleware,
    TenantContext,
    get_current_tenant,
    set_current_tenant,
    require_tenant_context,
    require_bank_access,
    require_branch_access,
    get_tenant_context,
    require_authenticated_tenant,
    require_super_admin,
    require_bank_admin_or_higher,
    build_tenant_where_clause,
    add_tenant_filter_to_query,
)

__all__ = [
    # Error handling
    'setup_exception_handlers',
    # Rate limiting
    'RateLimiter',
    # Request validation
    'RequestValidationMiddleware',
    # Logging
    'RequestLoggingMiddleware',
    # Tenant context (Multi-bank/branch support)
    'TenantContextMiddleware',
    'TenantContext',
    'get_current_tenant',
    'set_current_tenant',
    'require_tenant_context',
    'require_bank_access',
    'require_branch_access',
    'get_tenant_context',
    'require_authenticated_tenant',
    'require_super_admin',
    'require_bank_admin_or_higher',
    'build_tenant_where_clause',
    'add_tenant_filter_to_query',
]

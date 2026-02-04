# Utils package
"""
Utility modules for the Gold Loan Appraisal System

Available modules:
- db_utils: Database operations with retry logic and transactions
- validators: Input validation helpers
- tenant_queries: Multi-tenant scoped database queries

Note: setup_database and tenant_setup are standalone scripts, 
imported directly when needed (not re-exported from this package).
"""

from .db_utils import (
    with_retry,
    transaction,
    safe_cursor,
    execute_with_fetch,
    execute_with_commit,
    batch_execute,
    check_connection_health,
    sanitize_identifier,
    build_where_clause,
    build_update_clause,
    DatabaseRetryConfig
)

from .validators import (
    validate_email,
    validate_phone,
    validate_password,
    validate_bank_code,
    validate_branch_code,
    validate_pincode,
    validate_name,
    validate_id,
    validate_session_id,
    sanitize_string,
    validate_required_fields,
    validate_enum_value,
    validate_range
)

from .tenant_queries import (
    TenantScopedQueries,
    get_scoped_queries,
    tenant_filtered_query
)

__all__ = [
    # Database utilities
    'with_retry',
    'transaction',
    'safe_cursor',
    'execute_with_fetch',
    'execute_with_commit',
    'batch_execute',
    'check_connection_health',
    'sanitize_identifier',
    'build_where_clause',
    'build_update_clause',
    'DatabaseRetryConfig',
    # Validators
    'validate_email',
    'validate_phone',
    'validate_password',
    'validate_bank_code',
    'validate_branch_code',
    'validate_pincode',
    'validate_name',
    'validate_id',
    'validate_session_id',
    'sanitize_string',
    'validate_required_fields',
    'validate_enum_value',
    'validate_range',
    # Tenant-scoped queries (Multi-bank/branch support)
    'TenantScopedQueries',
    'get_scoped_queries',
    'tenant_filtered_query',
]
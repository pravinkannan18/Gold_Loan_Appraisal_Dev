"""
Tenant-Scoped Database Operations

Provides database operation wrappers that automatically apply
tenant isolation filters based on the current request context.

This ensures that:
- Bank admins only see data from their bank
- Branch admins only see data from their branch
- Super admins can see all data
- Appraisers only see their own sessions
"""

import logging
from typing import Optional, List, Dict, Any, Tuple
from functools import wraps

logger = logging.getLogger(__name__)


class TenantScopedQueries:
    """
    Database query wrapper that automatically applies tenant filtering
    
    Usage:
        scoped = TenantScopedQueries(db_connection, bank_id=1, branch_id=2)
        sessions = scoped.get_sessions(status='completed')
    """
    
    def __init__(
        self,
        db,
        bank_id: Optional[int] = None,
        branch_id: Optional[int] = None,
        user_role: str = 'appraiser',
        user_id: Optional[int] = None,
        is_super_admin: bool = False
    ):
        self.db = db
        self.bank_id = bank_id
        self.branch_id = branch_id
        self.user_role = user_role
        self.user_id = user_id
        self.is_super_admin = is_super_admin
    
    @classmethod
    def from_context(cls, db, context):
        """Create from TenantContext object"""
        from middleware.tenant_context import TenantContext
        if context is None:
            return cls(db)
        return cls(
            db=db,
            bank_id=context.bank_id,
            branch_id=context.branch_id,
            user_role=context.user_role,
            user_id=context.user_id,
            is_super_admin=context.is_super_admin
        )
    
    def _build_where(
        self,
        table_alias: str = "",
        include_bank: bool = True,
        include_branch: bool = True,
        additional: Dict[str, Any] = None
    ) -> Tuple[str, List]:
        """Build WHERE clause with tenant filters"""
        conditions = []
        params = []
        prefix = f"{table_alias}." if table_alias else ""
        
        # Add tenant filters (unless super admin)
        if not self.is_super_admin:
            if include_bank and self.bank_id:
                conditions.append(f"{prefix}bank_id = %s")
                params.append(self.bank_id)
            
            # Branch filter only for branch-level users
            if include_branch and self.branch_id and self.user_role == 'branch_admin':
                conditions.append(f"{prefix}branch_id = %s")
                params.append(self.branch_id)
        
        # Add additional conditions
        if additional:
            for field, value in additional.items():
                if value is not None:
                    conditions.append(f"{prefix}{field} = %s")
                    params.append(value)
        
        if conditions:
            return " AND ".join(conditions), params
        return "1=1", params
    
    # ========================================================================
    # Session Queries (Scoped)
    # ========================================================================
    
    # Allowlist for order_by validation
    ALLOWED_ORDER_COLUMNS = {
        "created_at", "id", "status", "session_id", "bank_id", "branch_id",
        "name", "appraiser_id", "updated_at"
    }
    ALLOWED_ORDER_DIRECTIONS = {"ASC", "DESC"}
    
    def _validate_order_by(self, order_by: str, default: str = "created_at DESC") -> str:
        """
        Validate and sanitize order_by clause against allowlist.
        Returns validated order_by or default if invalid.
        """
        if not order_by:
            return default
        
        parts = order_by.strip().split()
        if len(parts) == 0:
            return default
        
        # Extract column and direction
        column = parts[0].lower()
        direction = parts[1].upper() if len(parts) > 1 else "ASC"
        
        # Handle table alias prefix (e.g., "os.created_at")
        if "." in column:
            column = column.split(".")[-1]
        
        # Validate against allowlist
        if column not in self.ALLOWED_ORDER_COLUMNS:
            logger.warning(f"Invalid order_by column: {column}, using default")
            return default
        
        if direction not in self.ALLOWED_ORDER_DIRECTIONS:
            direction = "ASC"
        
        return f"{column} {direction}"
    
    def get_sessions(
        self,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "created_at DESC"
    ) -> List[Dict]:
        """Get sessions filtered by tenant context"""
        conn = self.db.get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            conditions = {"status": status} if status else {}
            where_clause, params = self._build_where("os", additional=conditions)
            
            # Validate order_by to prevent SQL injection
            safe_order_by = self._validate_order_by(order_by)
            
            query = f"""
                SELECT os.*, b.bank_name, br.branch_name
                FROM overall_sessions os
                LEFT JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                WHERE {where_clause}
                ORDER BY os.{safe_order_by}
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            cursor.close()
            return [dict(r) for r in results]
        finally:
            self.db.return_connection(conn)
    
    def get_session_count(self, status: Optional[str] = None) -> int:
        """Get count of sessions for current tenant"""
        conn = self.db.get_connection()
        try:
            cursor = conn.cursor()
            
            conditions = {"status": status} if status else {}
            where_clause, params = self._build_where("os", additional=conditions)
            
            query = f"""
                SELECT COUNT(*) FROM overall_sessions os
                WHERE {where_clause}
            """
            
            cursor.execute(query, params)
            count = cursor.fetchone()[0]
            cursor.close()
            return count
        finally:
            self.db.return_connection(conn)
    
    def get_session_by_id(self, session_id: str) -> Optional[Dict]:
        """Get session by ID with tenant validation"""
        conn = self.db.get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            where_clause, params = self._build_where("os", additional={"session_id": session_id})
            
            query = f"""
                SELECT os.*, b.bank_name, br.branch_name
                FROM overall_sessions os
                LEFT JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                WHERE {where_clause}
            """
            
            cursor.execute(query, params)
            result = cursor.fetchone()
            cursor.close()
            return dict(result) if result else None
        finally:
            self.db.return_connection(conn)
    
    # ========================================================================
    # Appraiser Queries (Scoped)
    # ========================================================================
    
    def get_appraisers(
        self,
        status: str = 'registered',
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """Get appraisers filtered by tenant context"""
        conn = self.db.get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            where_clause, params = self._build_where("os", additional={"status": status})
            
            query = f"""
                SELECT os.*, b.bank_name, br.branch_name
                FROM overall_sessions os
                LEFT JOIN banks b ON os.bank_id = b.id
                LEFT JOIN branches br ON os.branch_id = br.id
                WHERE {where_clause}
                ORDER BY os.created_at DESC
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            cursor.close()
            return [dict(r) for r in results]
        finally:
            self.db.return_connection(conn)
    
    def get_appraiser_count(self, status: str = 'registered') -> int:
        """Get count of appraisers for current tenant"""
        conn = self.db.get_connection()
        try:
            cursor = conn.cursor()
            
            where_clause, params = self._build_where("os", additional={"status": status})
            
            query = f"""
                SELECT COUNT(*) FROM overall_sessions os
                WHERE {where_clause}
            """
            
            cursor.execute(query, params)
            count = cursor.fetchone()[0]
            cursor.close()
            return count
        finally:
            self.db.return_connection(conn)
    
    # ========================================================================
    # Branch Admin Queries (Scoped)
    # ========================================================================
    
    def get_branch_admins(
        self,
        is_active: bool = True,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """Get branch admins filtered by tenant context"""
        conn = self.db.get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            conditions = {"is_active": is_active}
            where_clause, params = self._build_where("ba", additional=conditions)
            
            query = f"""
                SELECT ba.*, b.bank_name, br.branch_name
                FROM branch_admins ba
                JOIN banks b ON ba.bank_id = b.id
                JOIN branches br ON ba.branch_id = br.id
                WHERE {where_clause}
                ORDER BY ba.full_name
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            cursor.close()
            return [dict(r) for r in results]
        finally:
            self.db.return_connection(conn)
    
    # ========================================================================
    # Statistics Queries (Scoped)
    # ========================================================================
    
    def get_dashboard_stats(self) -> Dict[str, Any]:
        """Get dashboard statistics for current tenant scope"""
        conn = self.db.get_connection()
        try:
            cursor = conn.cursor()
            
            where_clause, params = self._build_where("os")
            
            # Total sessions
            cursor.execute(f"""
                SELECT COUNT(*) FROM overall_sessions os
                WHERE {where_clause}
            """, params)
            total_sessions = cursor.fetchone()[0]
            
            # Sessions by status
            cursor.execute(f"""
                SELECT status, COUNT(*) 
                FROM overall_sessions os
                WHERE {where_clause}
                GROUP BY status
            """, params)
            status_counts = dict(cursor.fetchall())
            
            # Registered appraisers
            appraiser_where, appraiser_params = self._build_where(
                "os", additional={"status": "registered"}
            )
            cursor.execute(f"""
                SELECT COUNT(DISTINCT appraiser_id) 
                FROM overall_sessions os
                WHERE {appraiser_where}
            """, appraiser_params)
            total_appraisers = cursor.fetchone()[0]
            
            # Today's sessions
            today_where, today_params = self._build_where("os")
            cursor.execute(f"""
                SELECT COUNT(*) FROM overall_sessions os
                WHERE {today_where} AND DATE(created_at) = CURRENT_DATE
            """, today_params)
            today_sessions = cursor.fetchone()[0]
            
            cursor.close()
            
            return {
                "total_sessions": total_sessions,
                "status_breakdown": status_counts,
                "total_appraisers": total_appraisers,
                "today_sessions": today_sessions,
                "completed": status_counts.get("completed", 0),
                "in_progress": status_counts.get("in_progress", 0),
                "pending": status_counts.get("pending", 0),
            }
        finally:
            self.db.return_connection(conn)
    
    def get_branch_breakdown(self) -> List[Dict]:
        """Get session counts per branch for current bank"""
        if not self.bank_id and not self.is_super_admin:
            return []
        
        conn = self.db.get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            params = []
            
            # Build the query based on whether we have a bank_id or not
            if self.bank_id:
                # Bank-scoped query
                query = """
                    SELECT 
                        br.id as branch_id,
                        br.branch_name,
                        br.branch_code,
                        COUNT(os.id) as total_sessions,
                        COUNT(CASE WHEN os.status = 'completed' THEN 1 END) as completed,
                        COUNT(CASE WHEN os.status = 'in_progress' THEN 1 END) as in_progress
                    FROM branches br
                    LEFT JOIN overall_sessions os ON os.branch_id = br.id AND os.bank_id = br.bank_id
                    WHERE br.bank_id = %s AND br.is_active = true
                    GROUP BY br.id, br.branch_name, br.branch_code
                    ORDER BY br.branch_name
                """
                params.append(self.bank_id)
            else:
                # Super admin - all branches
                query = """
                    SELECT 
                        br.id as branch_id,
                        br.branch_name,
                        br.branch_code,
                        COUNT(os.id) as total_sessions,
                        COUNT(CASE WHEN os.status = 'completed' THEN 1 END) as completed,
                        COUNT(CASE WHEN os.status = 'in_progress' THEN 1 END) as in_progress
                    FROM branches br
                    LEFT JOIN overall_sessions os ON os.branch_id = br.id
                    WHERE br.is_active = true
                    GROUP BY br.id, br.branch_name, br.branch_code
                    ORDER BY br.branch_name
                """
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            cursor.close()
            return [dict(r) for r in results]
        finally:
            self.db.return_connection(conn)


# ============================================================================
# Helper Functions
# ============================================================================

def get_scoped_queries(db, request=None) -> TenantScopedQueries:
    """
    Create TenantScopedQueries from current request context
    
    Usage in router:
        @router.get("/sessions")
        async def get_sessions(request: Request, db = Depends(get_db)):
            scoped = get_scoped_queries(db, request)
            return scoped.get_sessions()
    """
    from middleware.tenant_context import get_current_tenant
    
    context = get_current_tenant()
    return TenantScopedQueries.from_context(db, context)


# Allowlists for tenant_filtered_query validation
ALLOWED_TABLES = {
    "overall_sessions", "appraiser_details", "customer_details",
    "rbi_compliance_details", "purity_test_details", "banks", "branches",
    "tenant_users", "bank_admins", "branch_admins"
}

ALLOWED_COLUMNS = {
    "id", "session_id", "status", "created_at", "updated_at", "bank_id",
    "branch_id", "appraiser_id", "name", "email", "phone", "bank_name",
    "branch_name", "bank_code", "branch_code", "is_active", "total_items",
    "full_name", "user_role", "employee_id"
}

ALLOWED_ORDER_DIRECTIONS = {"ASC", "DESC"}


def _validate_table_name(table: str) -> str:
    """Validate table name against allowlist"""
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not in the allowed list")
    return table


def _validate_select_fields(fields: str) -> str:
    """Validate select fields - only allow * or whitelisted columns"""
    if fields == "*":
        return fields
    
    # Regex for safe identifier: starts with letter/underscore, then alphanumerics/underscore
    import re
    safe_identifier = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    
    validated = []
    for field in fields.split(","):
        field = field.strip()
        # Handle aliases like "column AS alias"
        parts = field.lower().split(" as ")
        col_name = parts[0].strip()
        # Handle table prefix
        if "." in col_name:
            col_name = col_name.split(".")[-1]
        
        if col_name not in ALLOWED_COLUMNS:
            raise ValueError(f"Column '{col_name}' is not in the allowed list")
        
        # Validate alias if present
        if len(parts) > 1:
            alias = parts[1].strip()
            if not safe_identifier.match(alias):
                raise ValueError(f"Invalid alias '{alias}': must be a valid identifier")
            validated.append(f"{parts[0].strip()} AS {alias}")
        else:
            validated.append(parts[0].strip())
    
    return ", ".join(validated)


def _validate_order_by(order_by: str) -> str:
    """Validate order_by clause"""
    if not order_by:
        return None
    
    parts = order_by.strip().split()
    if len(parts) == 0:
        return None
    
    column = parts[0].lower()
    direction = parts[1].upper() if len(parts) > 1 else "ASC"
    
    # Handle table prefix
    if "." in column:
        column = column.split(".")[-1]
    
    if column not in ALLOWED_COLUMNS:
        raise ValueError(f"Order column '{column}' is not in the allowed list")
    
    if direction not in ALLOWED_ORDER_DIRECTIONS:
        direction = "ASC"
    
    return f"{column} {direction}"


def tenant_filtered_query(
    db,
    table: str,
    select_fields: str = "*",
    additional_where: str = "",
    additional_params: list = None,
    order_by: str = None,
    limit: int = None,
    offset: int = None
) -> List[Dict]:
    """
    Execute a tenant-filtered query on any table with validation.
    
    WARNING: This function validates table, select_fields, and order_by against
    allowlists to prevent SQL injection. Use TenantScopedQueries class methods
    for better type safety.
    
    Args:
        db: Database connection manager
        table: Table name (must be in ALLOWED_TABLES)
        select_fields: Column names or "*" (columns must be in ALLOWED_COLUMNS)
        additional_where: Parameterized WHERE clause (use %s placeholders)
        additional_params: Parameters for additional_where
        order_by: Column and direction (column must be in ALLOWED_COLUMNS)
        limit: Maximum rows to return
        offset: Number of rows to skip
    
    Returns:
        List of dictionaries with query results
    """
    from middleware.tenant_context import build_tenant_where_clause
    
    additional_params = additional_params or []
    
    # Validate identifiers against allowlists
    safe_table = _validate_table_name(table)
    safe_fields = _validate_select_fields(select_fields)
    safe_order_by = _validate_order_by(order_by) if order_by else None
    
    # Build tenant filter
    tenant_where, tenant_params = build_tenant_where_clause()
    
    # Combine with additional conditions
    where_clauses = [tenant_where]
    params = tenant_params.copy()
    
    if additional_where:
        where_clauses.append(f"({additional_where})")
        params.extend(additional_params)
    
    where_clause = " AND ".join(where_clauses)
    
    # Build query with validated identifiers
    query = f"SELECT {safe_fields} FROM {safe_table} WHERE {where_clause}"
    
    if safe_order_by:
        query += f" ORDER BY {safe_order_by}"
    if limit is not None:
        query += " LIMIT %s"
        params.append(int(limit))
    if offset is not None:
        query += " OFFSET %s"
        params.append(int(offset))
    
    # Execute
    conn = db.get_connection()
    try:
        from psycopg2.extras import RealDictCursor
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(query, params)
        results = cursor.fetchall()
        cursor.close()
        return [dict(r) for r in results]
    finally:
        db.return_connection(conn)

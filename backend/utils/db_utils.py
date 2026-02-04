"""
Database Utilities
Robust database operations with retry logic, transactions, and error handling
"""
import time
import functools
import logging
from typing import TypeVar, Callable, Any, Optional
from contextlib import contextmanager
import psycopg2
from psycopg2 import OperationalError, InterfaceError, DatabaseError
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

T = TypeVar('T')


class DatabaseRetryConfig:
    """Configuration for database retry behavior"""
    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 0.5,
        max_delay: float = 10.0,
        exponential_base: float = 2.0
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base


DEFAULT_RETRY_CONFIG = DatabaseRetryConfig()


def with_retry(
    config: DatabaseRetryConfig = DEFAULT_RETRY_CONFIG,
    retryable_exceptions: tuple = (OperationalError, InterfaceError)
):
    """
    Decorator for database operations with automatic retry on transient failures
    
    Usage:
        @with_retry()
        def fetch_user(db, user_id):
            cursor = db.cursor()
            cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            return cursor.fetchone()
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> T:
            last_exception = None
            
            for attempt in range(config.max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if attempt < config.max_retries:
                        # Calculate delay with exponential backoff
                        delay = min(
                            config.base_delay * (config.exponential_base ** attempt),
                            config.max_delay
                        )
                        
                        logger.warning(
                            f"Database operation failed (attempt {attempt + 1}/{config.max_retries + 1}): "
                            f"{type(e).__name__}: {e}. Retrying in {delay:.2f}s..."
                        )
                        
                        time.sleep(delay)
                    else:
                        logger.error(
                            f"Database operation failed after {config.max_retries + 1} attempts: "
                            f"{type(e).__name__}: {e}"
                        )
            
            raise last_exception
        
        return wrapper
    return decorator


@contextmanager
def transaction(connection):
    """
    Context manager for database transactions with automatic commit/rollback
    
    Usage:
        with transaction(conn) as cursor:
            cursor.execute("INSERT INTO users (name) VALUES (%s)", ("John",))
            cursor.execute("INSERT INTO logs (action) VALUES (%s)", ("user_created",))
        # Auto-commits if no exception, auto-rolls back on exception
    """
    cursor = connection.cursor(cursor_factory=RealDictCursor)
    try:
        yield cursor
        connection.commit()
        logger.debug("Transaction committed successfully")
    except Exception as e:
        connection.rollback()
        logger.error(f"Transaction rolled back due to error: {e}")
        raise
    finally:
        cursor.close()


@contextmanager
def safe_cursor(connection, cursor_factory=None):
    """
    Context manager for safe cursor usage with automatic cleanup
    
    Usage:
        with safe_cursor(conn) as cursor:
            cursor.execute("SELECT * FROM users")
            return cursor.fetchall()
    """
    cursor = connection.cursor(cursor_factory=cursor_factory or RealDictCursor)
    try:
        yield cursor
    finally:
        cursor.close()


def execute_with_fetch(
    connection,
    query: str,
    params: tuple = None,
    fetch_one: bool = False,
    fetch_all: bool = True
) -> Optional[Any]:
    """
    Execute a query and fetch results safely
    
    Args:
        connection: Database connection
        query: SQL query to execute
        params: Query parameters
        fetch_one: If True, fetch only one result
        fetch_all: If True, fetch all results (ignored if fetch_one is True)
    
    Returns:
        Query results or None
    """
    with safe_cursor(connection) as cursor:
        cursor.execute(query, params or ())
        
        if fetch_one:
            result = cursor.fetchone()
            return dict(result) if result else None
        elif fetch_all:
            results = cursor.fetchall()
            return [dict(row) for row in results]
        return None


def execute_with_commit(
    connection,
    query: str,
    params: tuple = None,
    returning: bool = False
) -> Optional[Any]:
    """
    Execute a query with commit (for INSERT/UPDATE/DELETE)
    
    Args:
        connection: Database connection
        query: SQL query to execute
        params: Query parameters
        returning: If True, fetch and return the RETURNING clause result
    
    Returns:
        RETURNING result if requested, None otherwise
    """
    cursor = connection.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(query, params or ())
        
        result = None
        if returning:
            row = cursor.fetchone()
            result = dict(row) if row else None
        
        connection.commit()
        return result
    except Exception as e:
        connection.rollback()
        raise
    finally:
        cursor.close()


def batch_execute(
    connection,
    query: str,
    params_list: list,
    batch_size: int = 100
) -> int:
    """
    Execute a query in batches for bulk operations using executemany.
    
    Note: Each batch is committed separately. If a failure occurs, previous
    batches remain committed and only the current batch is rolled back.
    For full atomicity, wrap the entire operation in a transaction context.
    
    Args:
        connection: Database connection
        query: SQL query to execute
        params_list: List of parameter tuples
        batch_size: Number of operations per batch
    
    Returns:
        Total number of affected rows
    """
    total_affected = 0
    cursor = connection.cursor()
    
    try:
        for i in range(0, len(params_list), batch_size):
            batch = params_list[i:i + batch_size]
            
            # Use executemany for efficiency
            cursor.executemany(query, batch)
            total_affected += cursor.rowcount if cursor.rowcount >= 0 else len(batch)
            
            connection.commit()
            logger.debug(f"Batch {i // batch_size + 1} committed: {len(batch)} operations")
        
        return total_affected
    except Exception as e:
        connection.rollback()
        logger.error(f"Batch operation failed at batch {i // batch_size + 1}: {e}")
        raise
    finally:
        cursor.close()


def check_connection_health(connection) -> bool:
    """
    Check if database connection is healthy
    
    Returns:
        True if connection is healthy, False otherwise
    """
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        return True
    except Exception as e:
        logger.warning(f"Connection health check failed: {e}")
        return False
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass


def sanitize_identifier(identifier: str) -> str:
    """
    Sanitize a database identifier (table/column name) to prevent SQL injection
    
    Only allows alphanumeric characters and underscores
    """
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', identifier):
        raise ValueError(f"Invalid identifier: {identifier}")
    return identifier


def build_where_clause(conditions: dict) -> tuple[str, list]:
    """
    Build a WHERE clause from a dictionary of conditions
    
    Args:
        conditions: Dict of column -> value pairs
    
    Returns:
        Tuple of (WHERE clause string, list of parameter values)
    """
    if not conditions:
        return "", []
    
    clauses = []
    values = []
    
    for column, value in conditions.items():
        # Sanitize column name
        safe_column = sanitize_identifier(column)
        
        if value is None:
            clauses.append(f"{safe_column} IS NULL")
        elif isinstance(value, (list, tuple)):
            # Handle empty sequences - produce always-false clause
            if len(value) == 0:
                clauses.append("FALSE")  # No values = no matches
            else:
                placeholders = ", ".join(["%s"] * len(value))
                clauses.append(f"{safe_column} IN ({placeholders})")
                values.extend(value)
        else:
            clauses.append(f"{safe_column} = %s")
            values.append(value)
    
    return "WHERE " + " AND ".join(clauses), values


def build_update_clause(updates: dict) -> tuple[str, list]:
    """
    Build a SET clause for UPDATE from a dictionary
    
    Args:
        updates: Dict of column -> new_value pairs
    
    Returns:
        Tuple of (SET clause string, list of parameter values)
    """
    if not updates:
        raise ValueError("No updates provided")
    
    clauses = []
    values = []
    
    for column, value in updates.items():
        safe_column = sanitize_identifier(column)
        clauses.append(f"{safe_column} = %s")
        values.append(value)
    
    return "SET " + ", ".join(clauses), values

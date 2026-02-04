"""
Request Validation Middleware
Validates and sanitizes incoming requests
"""
import re
import html
from typing import Callable, Set
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import logging

logger = logging.getLogger(__name__)


class RequestValidationMiddleware(BaseHTTPMiddleware):
    """
    Middleware for validating and sanitizing incoming requests
    
    Features:
    - Content-Type validation
    - Request size limiting
    - SQL injection pattern detection
    - XSS pattern detection
    - Path traversal detection
    """
    
    # Maximum request body size (10MB)
    MAX_BODY_SIZE = 10 * 1024 * 1024
    
    # Allowed content types for POST/PUT/PATCH
    ALLOWED_CONTENT_TYPES: Set[str] = {
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "text/plain"
    }
    
    # SQL injection patterns
    SQL_INJECTION_PATTERNS = [
        r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b.*\b(FROM|INTO|TABLE|SET|WHERE)\b)",
        r"(--\s)",  # SQL single-line comment (double-hyphen followed by whitespace)
        r"(/\*[\s\S]*?\*/)",  # SQL block comments (multi-line safe)
        r"(\b(OR|AND)\b\s+\d+\s*=\s*\d+)",  # OR 1=1 type attacks
        r"(;.*\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b)",  # Chained queries
    ]
    
    # XSS patterns
    XSS_PATTERNS = [
        r"<script[^>]*>.*?</script>",
        r"javascript:",
        r"on\w+\s*=",
        r"<iframe[^>]*>",
        r"<object[^>]*>",
        r"<embed[^>]*>",
    ]
    
    # Path traversal patterns (including double-encoded variants)
    PATH_TRAVERSAL_PATTERNS = [
        r"\.\./",
        r"\.\.\\",
        r"%2e%2e%2f",
        r"%2e%2e/",
        r"\.%2e/",
        # Double-encoded variants
        r"%252e%252e%252f",
        r"%252e%252e/",
        r"%255c%255c",
        r"%252e%252e%255c",
    ]
    
    def __init__(self, app, enable_sql_check: bool = True, enable_xss_check: bool = True):
        super().__init__(app)
        self.enable_sql_check = enable_sql_check
        self.enable_xss_check = enable_xss_check
        
        # Compile patterns for efficiency
        self._sql_patterns = [re.compile(p, re.IGNORECASE) for p in self.SQL_INJECTION_PATTERNS]
        self._xss_patterns = [re.compile(p, re.IGNORECASE) for p in self.XSS_PATTERNS]
        self._path_patterns = [re.compile(p, re.IGNORECASE) for p in self.PATH_TRAVERSAL_PATTERNS]
    
    def _check_sql_injection(self, text: str) -> bool:
        """Check for SQL injection patterns"""
        if not self.enable_sql_check:
            return False
        for pattern in self._sql_patterns:
            if pattern.search(text):
                return True
        return False
    
    def _check_xss(self, text: str) -> bool:
        """Check for XSS patterns"""
        if not self.enable_xss_check:
            return False
        for pattern in self._xss_patterns:
            if pattern.search(text):
                return True
        return False
    
    def _check_path_traversal(self, path: str) -> bool:
        """Check for path traversal attempts including double-encoded"""
        from urllib.parse import unquote
        
        # Check original path
        for pattern in self._path_patterns:
            if pattern.search(path):
                return True
        
        # Check URL-decoded path (single decode)
        decoded_once = unquote(path)
        if decoded_once != path:
            for pattern in self._path_patterns:
                if pattern.search(decoded_once):
                    return True
        
        # Check double-decoded path
        decoded_twice = unquote(decoded_once)
        if decoded_twice != decoded_once:
            for pattern in self._path_patterns:
                if pattern.search(decoded_twice):
                    return True
        
        return False
    
    def _sanitize_string(self, text: str) -> str:
        """Sanitize string by escaping HTML entities"""
        return html.escape(text)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Check for path traversal in URL
        if self._check_path_traversal(request.url.path):
            # Sanitize path for logging: escape, truncate, remove control chars
            raw_path = request.url.path
            safe_path = raw_path.replace('\n', '').replace('\r', '').replace('\x00', '')[:200]
            safe_path = repr(safe_path)  # Escape special characters
            logger.warning(f"Path traversal attempt detected: {safe_path}")
            return Response(
                content='{"success": false, "error": {"code": "INVALID_REQUEST", '
                        '"message": "Invalid request path"}}',
                status_code=400,
                media_type="application/json"
            )
        
        # Check request method and content-type
        if request.method in ("POST", "PUT", "PATCH"):
            content_type = request.headers.get("content-type", "")
            
            # Extract base content type (ignore parameters like charset)
            base_content_type = content_type.split(";")[0].strip().lower()
            
            # Safely parse content-length
            content_length_raw = request.headers.get("content-length", "0")
            try:
                content_length = int(content_length_raw) if content_length_raw.isdigit() else 0
            except (ValueError, TypeError):
                content_length = 0
            
            # Skip content-type check for file uploads and empty bodies
            if content_length > 0:
                # Allow if content type starts with any allowed type
                is_allowed = any(
                    base_content_type.startswith(allowed) 
                    for allowed in self.ALLOWED_CONTENT_TYPES
                )
                
                if not is_allowed and base_content_type:
                    logger.warning(f"Invalid content-type: {content_type}")
                    return Response(
                        content='{"success": false, "error": {"code": "INVALID_CONTENT_TYPE", '
                                '"message": "Unsupported content type"}}',
                        status_code=415,
                        media_type="application/json"
                    )
            
            # Check body size
            if content_length > self.MAX_BODY_SIZE:
                logger.warning(f"Request body too large: {content_length} bytes")
                return Response(
                    content='{"success": false, "error": {"code": "REQUEST_TOO_LARGE", '
                            '"message": "Request body exceeds maximum allowed size"}}',
                    status_code=413,
                    media_type="application/json"
                )
            
            # For JSON requests, check body for injection patterns
            if base_content_type == "application/json" and content_length > 0:
                try:
                    body = await request.body()
                    body_text = body.decode("utf-8", errors="ignore")
                    
                    # Check for SQL injection
                    if self._check_sql_injection(body_text):
                        logger.warning(f"Potential SQL injection detected in request body")
                        return Response(
                            content='{"success": false, "error": {"code": "INVALID_INPUT", '
                                    '"message": "Request contains invalid characters"}}',
                            status_code=400,
                            media_type="application/json"
                        )
                    
                    # Check for XSS
                    if self._check_xss(body_text):
                        logger.warning(f"Potential XSS detected in request body")
                        return Response(
                            content='{"success": false, "error": {"code": "INVALID_INPUT", '
                                    '"message": "Request contains invalid characters"}}',
                            status_code=400,
                            media_type="application/json"
                        )
                except Exception as e:
                    logger.error(f"Error reading request body: {type(e).__name__}")
                    return Response(
                        content='{"success": false, "error": {"code": "INVALID_REQUEST", '
                                '"message": "Malformed request body"}}',
                        status_code=400,
                        media_type="application/json"
                    )
        
        # Check query parameters for injection
        query_string = str(request.query_params)
        if self._check_sql_injection(query_string) or self._check_xss(query_string):
            # Log path only, not the actual query parameters to avoid leaking sensitive data
            # Sanitize path to prevent log injection
            safe_path = request.url.path.replace('\n', '').replace('\r', '').replace('\x00', '')[:200]
            safe_path = repr(safe_path)
            logger.warning(f"Potential injection in query params for path: {safe_path}")
            return Response(
                content='{"success": false, "error": {"code": "INVALID_INPUT", '
                        '"message": "Invalid query parameters"}}',
                status_code=400,
                media_type="application/json"
            )
        
        # Continue to next middleware/route
        response = await call_next(request)
        return response

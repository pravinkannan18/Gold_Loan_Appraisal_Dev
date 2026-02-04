"""
Request Logging Middleware
Logs all incoming requests with timing and response information
"""
import time
import uuid
import logging
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for comprehensive request logging
    
    Features:
    - Request ID generation for tracing
    - Request timing
    - Response status logging
    - Slow request detection
    """
    
    # Threshold for slow request warning (in seconds)
    SLOW_REQUEST_THRESHOLD = 2.0
    
    # Paths to exclude from detailed logging
    EXCLUDED_PATHS = {
        "/health",
        "/",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/favicon.ico"
    }
    
    def __init__(self, app, log_body: bool = False, slow_threshold: float = 2.0):
        super().__init__(app)
        self.log_body = log_body
        self.slow_threshold = slow_threshold
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request"""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        return request.client.host if request.client else "unknown"
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate unique request ID
        request_id = str(uuid.uuid4())[:8]
        
        # Store request ID in state for access in route handlers
        request.state.request_id = request_id
        
        # Record start time
        start_time = time.time()
        
        # Get request info
        client_ip = self._get_client_ip(request)
        method = request.method
        path = request.url.path
        query = str(request.query_params) if request.query_params else ""
        
        # Skip detailed logging for excluded paths
        is_excluded = path in self.EXCLUDED_PATHS
        
        if not is_excluded:
            logger.info(
                f"[{request_id}] ➡️  {method} {path}"
                f"{f'?{query}' if query else ''} "
                f"- Client: {client_ip}"
            )
        
        # Process request
        try:
            response = await call_next(request)
            
            # Calculate duration
            duration = time.time() - start_time
            duration_ms = round(duration * 1000, 2)
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{duration_ms}ms"
            
            # Log response
            status_code = response.status_code
            status_emoji = "✅" if 200 <= status_code < 400 else "⚠️" if 400 <= status_code < 500 else "❌"
            
            if not is_excluded:
                log_message = (
                    f"[{request_id}] {status_emoji} {method} {path} "
                    f"- Status: {status_code} - Duration: {duration_ms}ms"
                )
                
                # Log slow requests as warnings
                if duration > self.slow_threshold:
                    logger.warning(f"🐢 SLOW REQUEST: {log_message}")
                elif status_code >= 500:
                    logger.error(log_message)
                elif status_code >= 400:
                    logger.warning(log_message)
                else:
                    logger.info(log_message)
            
            return response
            
        except Exception as e:
            # Calculate duration even for errors
            duration = time.time() - start_time
            duration_ms = round(duration * 1000, 2)
            
            # Sanitize error message to prevent sensitive data leakage
            error_type = type(e).__name__
            error_msg = str(e)
            # Remove common credential patterns FIRST (before truncation)
            import re
            # Match quoted strings (with spaces) or unquoted tokens
            sanitized_msg = re.sub(r'(password|token|secret|api_key|apikey|auth)(["\']?\s*[:=]\s*)(("[^"]*")|(\\'[^\\']*\\')|([^\s,;"\'}\]]+))', '\\1\\2***REDACTED***', error_msg, flags=re.IGNORECASE)
            sanitized_msg = sanitized_msg.replace('\n', ' ').replace('\r', '')
            # Truncate after redaction to ensure secrets aren't leaked
            sanitized_msg = sanitized_msg[:200] if len(sanitized_msg) > 200 else sanitized_msg
            
            logger.error(
                f"[{request_id}] ❌ {method} {path} "
                f"- Error: {error_type}: {sanitized_msg} "
                f"- Duration: {duration_ms}ms"
            )
            raise

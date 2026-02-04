"""
Rate Limiter Middleware
Implements sliding window rate limiting to prevent abuse
"""
import time
import asyncio
from collections import defaultdict
from typing import Dict, Optional, Callable
from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import logging

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    Sliding window rate limiter for API endpoints
    
    Features:
    - Per-IP rate limiting
    - Per-endpoint rate limiting
    - Configurable windows and limits
    - Automatic cleanup of expired entries
    """
    
    def __init__(
        self,
        requests_per_minute: int = 60,
        requests_per_second: int = 10,
        burst_limit: int = 20,
        cleanup_interval: int = 60,
        trust_forwarded_headers: bool = False
    ):
        self.requests_per_minute = requests_per_minute
        self.requests_per_second = requests_per_second
        self.burst_limit = burst_limit
        self.cleanup_interval = cleanup_interval
        self.trust_forwarded_headers = trust_forwarded_headers
        
        # Store request timestamps per IP
        self._requests: Dict[str, list] = defaultdict(list)
        self._last_cleanup = time.time()
        self._lock = asyncio.Lock()
        
        # Whitelist for internal/health endpoints
        self._whitelist = {
            "/health",
            "/",
            "/docs",
            "/openapi.json",
            "/redoc"
        }
        
        # Custom limits per endpoint pattern
        self._endpoint_limits: Dict[str, Dict] = {
            "/api/admin/login": {"per_minute": 10, "per_second": 2},
            "/api/super-admin/login": {"per_minute": 5, "per_second": 1},
            "/api/face/": {"per_minute": 30, "per_second": 5},  # Face recognition is heavy
            "/api/classification/": {"per_minute": 20, "per_second": 3},
        }
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request, handling proxies only when trusted"""
        # Only check forwarded headers when behind a trusted proxy
        if self.trust_forwarded_headers:
            forwarded = request.headers.get("X-Forwarded-For")
            if forwarded:
                return forwarded.split(",")[0].strip()
            
            real_ip = request.headers.get("X-Real-IP")
            if real_ip:
                return real_ip
        
        # Fallback to direct connection
        return request.client.host if request.client else "unknown"
    
    def _get_endpoint_limits(self, path: str) -> Dict:
        """Get rate limits for specific endpoint"""
        for pattern, limits in self._endpoint_limits.items():
            if path.startswith(pattern):
                return limits
        return {
            "per_minute": self.requests_per_minute,
            "per_second": self.requests_per_second
        }
    
    async def _cleanup_expired(self):
        """Remove expired request entries"""
        current_time = time.time()
        
        async with self._lock:
            # Re-check timing inside the lock to prevent redundant cleanup
            if current_time - self._last_cleanup < self.cleanup_interval:
                return
            
            cutoff = current_time - 60  # Keep only last minute
            for ip in list(self._requests.keys()):
                self._requests[ip] = [
                    ts for ts in self._requests[ip] if ts > cutoff
                ]
                if not self._requests[ip]:
                    del self._requests[ip]
            self._last_cleanup = current_time
    
    async def is_allowed(self, request: Request) -> tuple[bool, Optional[int]]:
        """
        Check if request is allowed under rate limits
        
        Returns:
            tuple: (is_allowed, retry_after_seconds)
        """
        path = request.url.path
        
        # Skip rate limiting for whitelisted endpoints
        if path in self._whitelist:
            return True, None
        
        await self._cleanup_expired()
        
        client_ip = self._get_client_ip(request)
        key = f"{client_ip}:{path}"
        current_time = time.time()
        
        async with self._lock:
            # Get recent requests
            recent = self._requests[key]
            
            # Get endpoint-specific limits
            limits = self._get_endpoint_limits(path)
            per_minute = limits.get("per_minute", self.requests_per_minute)
            per_second = limits.get("per_second", self.requests_per_second)
            
            # Count requests in last minute
            minute_ago = current_time - 60
            requests_last_minute = len([ts for ts in recent if ts > minute_ago])
            
            # Count requests in last second
            second_ago = current_time - 1
            requests_last_second = len([ts for ts in recent if ts > second_ago])
            
            # Check burst limit
            if len(recent) >= self.burst_limit:
                # Find oldest request in current burst
                oldest_in_window = min(recent[-self.burst_limit:]) if recent else current_time
                retry_after = int(1 - (current_time - oldest_in_window)) + 1
                return False, max(1, retry_after)
            
            # Check per-second limit
            if requests_last_second >= per_second:
                return False, 1
            
            # Check per-minute limit
            if requests_last_minute >= per_minute:
                # Calculate retry after
                oldest_in_minute = min([ts for ts in recent if ts > minute_ago])
                retry_after = int(60 - (current_time - oldest_in_minute)) + 1
                return False, max(1, retry_after)
            
            # Request allowed - record it
            self._requests[key].append(current_time)
            
            # Trim old entries
            self._requests[key] = [
                ts for ts in self._requests[key] if ts > minute_ago
            ]
            
            return True, None
    
    def get_remaining_requests(self, request: Request) -> Dict:
        """Get remaining request counts for client"""
        client_ip = self._get_client_ip(request)
        path = request.url.path
        key = f"{client_ip}:{path}"
        current_time = time.time()
        
        limits = self._get_endpoint_limits(path)
        per_minute = limits.get("per_minute", self.requests_per_minute)
        per_second = limits.get("per_second", self.requests_per_second)
        
        # Note: This method is sync but called from async context.
        # For thread safety, we read the list atomically and compute from snapshot.
        # Since Python's GIL and list access is atomic, this is safe for reads.
        recent = list(self._requests.get(key, []))  # Create snapshot
        minute_ago = current_time - 60
        second_ago = current_time - 1
        
        requests_last_minute = len([ts for ts in recent if ts > minute_ago])
        requests_last_second = len([ts for ts in recent if ts > second_ago])
        
        return {
            "remaining_per_minute": max(0, per_minute - requests_last_minute),
            "remaining_per_second": max(0, per_second - requests_last_second),
            "limit_per_minute": per_minute,
            "limit_per_second": per_second
        }


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Middleware to apply rate limiting to all requests"""
    
    def __init__(self, app, rate_limiter: RateLimiter):
        super().__init__(app)
        self.rate_limiter = rate_limiter
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        is_allowed, retry_after = await self.rate_limiter.is_allowed(request)
        
        if not is_allowed:
            client_ip = self.rate_limiter._get_client_ip(request)
            # Hash IP for privacy in logs
            import hashlib
            ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()[:16]
            logger.warning(
                f"Rate limit exceeded for IP hash {ip_hash} "
                f"on {request.url.path}"
            )
            return Response(
                content='{"success": false, "error": {"code": "RATE_LIMIT_EXCEEDED", '
                        f'"message": "Too many requests. Retry after {retry_after} seconds"}}',
                status_code=429,
                media_type="application/json",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Reset": str(int(time.time()) + retry_after)
                }
            )
        
        # Add rate limit headers to response
        response = await call_next(request)
        remaining = self.rate_limiter.get_remaining_requests(request)
        response.headers["X-RateLimit-Limit"] = str(remaining["limit_per_minute"])
        response.headers["X-RateLimit-Remaining"] = str(remaining["remaining_per_minute"])
        
        return response

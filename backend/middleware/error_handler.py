"""
Global Exception Handler for robust error handling
Catches all exceptions and returns consistent error responses
"""
import logging
import traceback
from typing import Union
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from psycopg2 import OperationalError, InterfaceError, DatabaseError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

class APIError(Exception):
    """Base API Error class for custom exceptions"""
    def __init__(
        self, 
        message: str, 
        status_code: int = 500, 
        error_code: str = "INTERNAL_ERROR",
        details: dict = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)


class DatabaseConnectionError(APIError):
    """Database connection error"""
    def __init__(self, message: str = "Database connection failed"):
        super().__init__(
            message=message,
            status_code=503,
            error_code="DATABASE_CONNECTION_ERROR"
        )


class ValidationException(APIError):
    """Input validation error"""
    def __init__(self, message: str, details: dict = None):
        super().__init__(
            message=message,
            status_code=422,
            error_code="VALIDATION_ERROR",
            details=details
        )


class AuthenticationError(APIError):
    """Authentication failed"""
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(
            message=message,
            status_code=401,
            error_code="AUTHENTICATION_ERROR"
        )


class AuthorizationError(APIError):
    """Authorization/permission error"""
    def __init__(self, message: str = "Access denied"):
        super().__init__(
            message=message,
            status_code=403,
            error_code="AUTHORIZATION_ERROR"
        )


class ResourceNotFoundError(APIError):
    """Resource not found"""
    def __init__(self, resource: str, identifier: Union[str, int] = None):
        message = f"{resource} not found"
        if identifier:
            message = f"{resource} with ID '{identifier}' not found"
        super().__init__(
            message=message,
            status_code=404,
            error_code="RESOURCE_NOT_FOUND",
            details={"resource": resource, "identifier": identifier}
        )


class RateLimitExceededError(APIError):
    """Rate limit exceeded"""
    def __init__(self, retry_after: int = 60):
        super().__init__(
            message=f"Rate limit exceeded. Retry after {retry_after} seconds",
            status_code=429,
            error_code="RATE_LIMIT_EXCEEDED",
            details={"retry_after": retry_after}
        )


def create_error_response(
    status_code: int,
    error_code: str,
    message: str,
    details: dict = None,
    path: str = None
) -> JSONResponse:
    """Create a standardized error response"""
    response_body = {
        "success": False,
        "error": {
            "code": error_code,
            "message": message,
            "status_code": status_code
        }
    }
    
    if details:
        response_body["error"]["details"] = details
    if path:
        response_body["error"]["path"] = path
        
    return JSONResponse(
        status_code=status_code,
        content=response_body
    )


def setup_exception_handlers(app: FastAPI):
    """Setup global exception handlers for the FastAPI app"""
    
    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError):
        """Handle custom API errors"""
        logger.warning(f"API Error: {exc.error_code} - {exc.message} - Path: {request.url.path}")
        return create_error_response(
            status_code=exc.status_code,
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            path=request.url.path
        )
    
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """Handle FastAPI HTTP exceptions"""
        logger.warning(f"HTTP Exception: {exc.status_code} - {exc.detail} - Path: {request.url.path}")
        
        error_code = {
            400: "BAD_REQUEST",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            409: "CONFLICT",
            422: "UNPROCESSABLE_ENTITY",
            429: "TOO_MANY_REQUESTS",
            500: "INTERNAL_SERVER_ERROR",
            502: "BAD_GATEWAY",
            503: "SERVICE_UNAVAILABLE"
        }.get(exc.status_code, "HTTP_ERROR")
        
        return create_error_response(
            status_code=exc.status_code,
            error_code=error_code,
            message=str(exc.detail),
            path=request.url.path
        )
    
    @app.exception_handler(StarletteHTTPException)
    async def starlette_exception_handler(request: Request, exc: StarletteHTTPException):
        """Handle Starlette HTTP exceptions"""
        return create_error_response(
            status_code=exc.status_code,
            error_code="HTTP_ERROR",
            message=str(exc.detail),
            path=request.url.path
        )
    
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handle Pydantic request validation errors"""
        errors = []
        for error in exc.errors():
            field = " -> ".join(str(loc) for loc in error.get("loc", []))
            errors.append({
                "field": field,
                "message": error.get("msg", "Validation error"),
                "type": error.get("type", "unknown")
            })
        
        logger.warning(f"Validation Error: {errors} - Path: {request.url.path}")
        
        return create_error_response(
            status_code=422,
            error_code="VALIDATION_ERROR",
            message="Request validation failed",
            details={"errors": errors},
            path=request.url.path
        )
    
    @app.exception_handler(ValidationError)
    async def pydantic_validation_handler(request: Request, exc: ValidationError):
        """Handle Pydantic validation errors"""
        errors = []
        for error in exc.errors():
            field = " -> ".join(str(loc) for loc in error.get("loc", []))
            errors.append({
                "field": field,
                "message": error.get("msg", "Validation error"),
                "type": error.get("type", "unknown")
            })
        
        return create_error_response(
            status_code=422,
            error_code="VALIDATION_ERROR",
            message="Data validation failed",
            details={"errors": errors},
            path=request.url.path
        )
    
    @app.exception_handler(OperationalError)
    async def database_operational_error_handler(request: Request, exc: OperationalError):
        """Handle database operational errors (connection issues)"""
        logger.error(f"Database Operational Error: {exc} - Path: {request.url.path}")
        return create_error_response(
            status_code=503,
            error_code="DATABASE_ERROR",
            message="Database service temporarily unavailable. Please retry.",
            path=request.url.path
        )
    
    @app.exception_handler(InterfaceError)
    async def database_interface_error_handler(request: Request, exc: InterfaceError):
        """Handle database interface errors"""
        logger.error(f"Database Interface Error: {exc} - Path: {request.url.path}")
        return create_error_response(
            status_code=503,
            error_code="DATABASE_ERROR",
            message="Database connection error. Please retry.",
            path=request.url.path
        )
    
    @app.exception_handler(DatabaseError)
    async def database_error_handler(request: Request, exc: DatabaseError):
        """Handle general database errors"""
        logger.error(f"Database Error: {exc} - Path: {request.url.path}")
        return create_error_response(
            status_code=500,
            error_code="DATABASE_ERROR",
            message="Database operation failed",
            path=request.url.path
        )
    
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        """Catch-all handler for unexpected exceptions"""
        # Log the full traceback for debugging
        logger.error(
            f"Unhandled Exception: {type(exc).__name__}: {exc}\n"
            f"Path: {request.url.path}\n"
            f"Traceback: {traceback.format_exc()}"
        )
        
        # Don't expose internal errors to clients in production
        return create_error_response(
            status_code=500,
            error_code="INTERNAL_SERVER_ERROR",
            message="An unexpected error occurred. Please try again later.",
            path=request.url.path
        )
    
    logger.info("✅ Global exception handlers configured")

"""
Input Validation Utilities
Provides robust input validation for API requests
"""
import re
from typing import Optional, Any, List, Union
from pydantic import validator
import logging

logger = logging.getLogger(__name__)


# ============================================================================
# Constants
# ============================================================================

# Common regex patterns
PATTERNS = {
    "email": re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'),
    "phone_india": re.compile(r'^(\+91)?[6-9]\d{9}$'),
    "phone_international": re.compile(r'^\+?[1-9]\d{1,14}$'),
    "alphanumeric": re.compile(r'^[a-zA-Z0-9]+$'),
    "alphanumeric_underscore": re.compile(r'^[a-zA-Z0-9_]+$'),
    "alphanumeric_dash": re.compile(r'^[a-zA-Z0-9-]+$'),
    "bank_code": re.compile(r'^[A-Z0-9_]{2,20}$'),
    "branch_code": re.compile(r'^[A-Z0-9_]{1,20}$'),
    "pincode_india": re.compile(r'^[1-9][0-9]{5}$'),
    "uuid": re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', re.IGNORECASE),
    "session_id": re.compile(r'^[a-zA-Z0-9_-]{8,64}$'),
    "name": re.compile(r"^[a-zA-Z\u0080-\uFFFF][a-zA-Z\u0080-\uFFFF\s\.\-\']*$", re.UNICODE),  # Starts with letter, no digits/underscores, allows apostrophes
    "safe_string": re.compile(r'^[a-zA-Z0-9\s\.\-\_\'\,\@\#\(\)\/]+$'),
}

# Maximum lengths for common fields
MAX_LENGTHS = {
    "email": 255,
    "phone": 20,
    "name": 255,
    "address": 500,
    "bank_code": 20,
    "branch_code": 20,
    "city": 100,
    "state": 100,
    "pincode": 10,
    "password_min": 8,
    "password_max": 128,
}


# ============================================================================
# Validation Functions
# ============================================================================

def validate_email(email: str) -> tuple[bool, Optional[str]]:
    """
    Validate email format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not email:
        return False, "Email is required"
    
    if len(email) > MAX_LENGTHS["email"]:
        return False, f"Email must be less than {MAX_LENGTHS['email']} characters"
    
    if not PATTERNS["email"].match(email):
        return False, "Invalid email format"
    
    return True, None


def validate_phone(phone: str, allow_international: bool = True) -> tuple[bool, Optional[str]]:
    """
    Validate phone number format
    
    Args:
        phone: Phone number to validate
        allow_international: If True, allows international format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not phone:
        return True, None  # Phone is often optional
    
    # Remove spaces and dashes for validation
    clean_phone = re.sub(r'[\s\-\(\)]', '', phone)
    
    if len(clean_phone) > MAX_LENGTHS["phone"]:
        return False, f"Phone number must be less than {MAX_LENGTHS['phone']} characters"
    
    if allow_international:
        if not PATTERNS["phone_international"].match(clean_phone):
            return False, "Invalid phone number format"
    else:
        if not PATTERNS["phone_india"].match(clean_phone):
            return False, "Invalid Indian phone number format"
    
    return True, None


def validate_password(password: str, min_length: int = 8) -> tuple[bool, Optional[str]]:
    """
    Validate password strength
    
    Requirements:
    - Minimum length (default 8)
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one digit
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not password:
        return False, "Password is required"
    
    if len(password) < min_length:
        return False, f"Password must be at least {min_length} characters"
    
    if len(password) > MAX_LENGTHS["password_max"]:
        return False, f"Password must be less than {MAX_LENGTHS['password_max']} characters"
    
    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"
    
    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"
    
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one digit"
    
    return True, None


def validate_bank_code(code: str) -> tuple[bool, Optional[str]]:
    """
    Validate bank code format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not code:
        return False, "Bank code is required"
    
    code = code.upper()
    
    if not PATTERNS["bank_code"].match(code):
        return False, "Bank code must be 2-20 alphanumeric characters (underscores allowed)"
    
    return True, None


def validate_branch_code(code: str) -> tuple[bool, Optional[str]]:
    """
    Validate branch code format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not code:
        return False, "Branch code is required"
    
    code = code.upper()
    
    if not PATTERNS["branch_code"].match(code):
        return False, "Branch code must be 1-20 alphanumeric characters (underscores allowed)"
    
    return True, None


def validate_pincode(pincode: str) -> tuple[bool, Optional[str]]:
    """
    Validate Indian pincode format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not pincode:
        return True, None  # Pincode is often optional
    
    if not PATTERNS["pincode_india"].match(pincode):
        return False, "Invalid pincode format (must be 6 digits starting with non-zero)"
    
    return True, None


def validate_name(name: str, field_name: str = "Name") -> tuple[bool, Optional[str]]:
    """
    Validate person/entity name (supports Unicode for Indian names)
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not name:
        return False, f"{field_name} is required"
    
    name = name.strip()
    
    if len(name) > MAX_LENGTHS["name"]:
        return False, f"{field_name} must be less than {MAX_LENGTHS['name']} characters"
    
    if len(name) < 1:
        return False, f"{field_name} cannot be empty"
    
    # Block dangerous characters for security while allowing Unicode letters and apostrophes
    dangerous_chars = ['<', '>', '&', '"', '\\', ';', '--', '/*']
    for char in dangerous_chars:
        if char in name:
            return False, f"{field_name} contains invalid characters"
    
    if not PATTERNS["name"].match(name):
        return False, f"{field_name} contains invalid characters"
    
    return True, None


def validate_id(value: Any, field_name: str = "ID") -> tuple[bool, Optional[str]]:
    """
    Validate ID field (must be positive integer)
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if value is None:
        return False, f"{field_name} is required"
    
    try:
        int_value = int(value)
        if int_value <= 0:
            return False, f"{field_name} must be a positive integer"
        return True, None
    except (TypeError, ValueError):
        return False, f"{field_name} must be a valid integer"


def validate_session_id(session_id: str) -> tuple[bool, Optional[str]]:
    """
    Validate session ID format
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if not session_id:
        return False, "Session ID is required"
    
    if not PATTERNS["session_id"].match(session_id):
        return False, "Invalid session ID format"
    
    return True, None


def sanitize_string(value: str, max_length: int = 255, strip: bool = True) -> str:
    """
    Sanitize a string by removing potentially dangerous characters
    
    Args:
        value: String to sanitize
        max_length: Maximum allowed length
        strip: Whether to strip whitespace
    
    Returns:
        Sanitized string
    """
    if not value:
        return ""
    
    if strip:
        value = value.strip()
    
    # Truncate to max length
    value = value[:max_length]
    
    # Remove null bytes
    value = value.replace('\x00', '')
    
    # Remove control characters (except newline and tab)
    value = ''.join(char for char in value if char in '\n\t' or ord(char) >= 32)
    
    return value


def validate_required_fields(data: dict, required: List[str]) -> tuple[bool, Optional[str]]:
    """
    Validate that all required fields are present and non-empty
    
    Returns:
        tuple: (is_valid, error_message)
    """
    missing = []
    for field in required:
        if field not in data or data[field] is None or data[field] == "":
            missing.append(field)
    
    if missing:
        return False, f"Missing required fields: {', '.join(missing)}"
    
    return True, None


def validate_enum_value(value: Any, allowed_values: List[Any], field_name: str = "Field") -> tuple[bool, Optional[str]]:
    """
    Validate that a value is one of the allowed values
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if value not in allowed_values:
        return False, f"{field_name} must be one of: {', '.join(str(v) for v in allowed_values)}"
    
    return True, None


def validate_range(
    value: Union[int, float],
    min_value: Union[int, float] = None,
    max_value: Union[int, float] = None,
    field_name: str = "Value"
) -> tuple[bool, Optional[str]]:
    """
    Validate that a numeric value is within a range
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if value is None:
        return False, f"{field_name} is required"
    
    if min_value is not None and value < min_value:
        return False, f"{field_name} must be at least {min_value}"
    
    if max_value is not None and value > max_value:
        return False, f"{field_name} must be at most {max_value}"
    
    return True, None


# ============================================================================
# Pydantic Validators (for use in schemas)
# ============================================================================

def pydantic_email_validator(v: str) -> str:
    """Pydantic validator for email"""
    is_valid, error = validate_email(v)
    if not is_valid:
        raise ValueError(error)
    return v.lower()


def pydantic_phone_validator(v: str) -> str:
    """Pydantic validator for phone"""
    if not v:
        return v
    is_valid, error = validate_phone(v)
    if not is_valid:
        raise ValueError(error)
    return re.sub(r'[\s\-\(\)]', '', v)


def pydantic_bank_code_validator(v: str) -> str:
    """Pydantic validator for bank code"""
    is_valid, error = validate_bank_code(v)
    if not is_valid:
        raise ValueError(error)
    return v.upper()


def pydantic_branch_code_validator(v: str) -> str:
    """Pydantic validator for branch code"""
    is_valid, error = validate_branch_code(v)
    if not is_valid:
        raise ValueError(error)
    return v.upper()

"""
Email Verification - Validate email format and optionally check deliverability.
"""
import re
from typing import Optional


def verify_email_format(email: str) -> dict:
    """
    Basic email format validation.
    Returns: {valid: bool, reason?: str}
    """
    if not email or not isinstance(email, str):
        return {"valid": False, "reason": "Empty or invalid"}
    email = email.strip().lower()
    if "@" not in email:
        return {"valid": False, "reason": "Missing @"}
    local, domain = email.rsplit("@", 1)
    if not local or not domain:
        return {"valid": False, "reason": "Invalid format"}
    if "." not in domain:
        return {"valid": False, "reason": "Invalid domain"}
    if len(local) > 64 or len(domain) > 255:
        return {"valid": False, "reason": "Too long"}
    # Basic pattern
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if not re.match(pattern, email):
        return {"valid": False, "reason": "Invalid format"}
    return {"valid": True}

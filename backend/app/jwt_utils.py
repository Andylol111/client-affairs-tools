"""JWT helpers - no imports from routers to avoid circular deps."""
import logging
import os
import secrets
import jwt
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Stable default for local dev only — avoids a new random secret every process start (which invalidates all tokens).
_raw_jwt = (os.getenv("JWT_SECRET") or "").strip()
if not _raw_jwt:
    _raw_jwt = "dev-jwt-secret-not-for-production"
    logger.warning(
        "JWT_SECRET is not set; using a fixed development default. "
        "Set JWT_SECRET in backend/.env for production and for consistent tokens across restarts."
    )
JWT_SECRET = _raw_jwt
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7  # 7 days


def create_token(user_id: int, email: str, name: str | None = None, picture: str | None = None, role: str = "standard") -> str:
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "email": email,
        "name": name,
        "picture": picture,
        "role": role,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None

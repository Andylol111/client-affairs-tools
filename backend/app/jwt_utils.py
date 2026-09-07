"""JWT helpers - no imports from routers to avoid circular deps."""
import os
import jwt
from datetime import datetime, timedelta

_WEAK_JWT_SECRETS = frozenset({
    "",
    "dev-jwt-secret-not-for-production",
    "your_jwt_secret_here",
    "changeme",
    "secret",
})
_raw_jwt = (os.getenv("JWT_SECRET") or "").strip()
if _raw_jwt in _WEAK_JWT_SECRETS:
    raise RuntimeError(
        "JWT_SECRET is missing or is a known insecure default. "
        "Set a long random value in backend/.env "
        '(python -c "import secrets; print(secrets.token_hex(32))").'
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

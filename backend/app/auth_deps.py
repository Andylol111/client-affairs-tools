"""Auth dependencies for protected routes."""
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader

from app.jwt_utils import decode_token
from app.database import get_db, row_to_dict

security = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _user_from_payload(payload: dict) -> dict:
    return {
        "id": int(payload["sub"]),
        "email": payload.get("email"),
        "name": payload.get("name"),
        "picture": payload.get("picture"),
        "role": payload.get("role") or "standard",
    }


async def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    api_key: str | None,
) -> dict | None:
    """Resolve user from Bearer token or API key."""
    if credentials and credentials.credentials:
        payload = decode_token(credentials.credentials)
        if payload:
            return _user_from_payload(payload)
    if api_key:
        db = await get_db()
        try:
            import hashlib
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            key_prefix = api_key[:12] + "..." if len(api_key) > 12 else api_key
            cursor = await db.execute(
                "SELECT u.id, u.email, u.name, u.role FROM users u JOIN api_keys k ON k.user_id = u.id WHERE k.key_hash = ?",
                (key_hash,),
            )
            row = await cursor.fetchone()
            if row:
                row = row_to_dict(row)
                await db.execute(
                    "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?",
                    (key_hash,),
                )
                await db.commit()
                return {
                    "id": row["id"],
                    "email": row["email"],
                    "name": row.get("name"),
                    "picture": None,
                    "role": row.get("role") or "standard",
                    "api_key": True,
                }
        finally:
            await db.close()
    return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    api_key: str | None = Depends(api_key_header),
) -> dict:
    """Get current user from JWT or API key. Raises 401 if not authenticated."""
    user = await _resolve_user(credentials, api_key)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    api_key: str | None = Depends(api_key_header),
) -> dict | None:
    """Get current user from JWT or API key if present."""
    return await _resolve_user(credentials, api_key)


async def get_current_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require admin role. Raises 403 if not admin."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

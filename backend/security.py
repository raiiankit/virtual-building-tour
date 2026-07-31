"""Authentication utilities — implemented with the Python standard library only
(pbkdf2 password hashing + HMAC-signed tokens) so the app has no fragile crypto
dependencies to install. Covers BRD AUTH-001..005 and role checks (BRD 4.1).

For production, swap pbkdf2 for argon2/bcrypt and these tokens for real JWT."""
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import config
from .database import get_db
from .models import User

_PBKDF_ROUNDS = 200_000


# ---------- password hashing ----------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF_ROUNDS)
    return f"pbkdf2${_PBKDF_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---------- tokens (compact HMAC-signed, JWT-like) ----------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def create_token(user_id: int) -> str:
    payload = {"sub": user_id, "exp": int(time.time()) + config.ACCESS_TOKEN_EXPIRE_HOURS * 3600}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> Optional[int]:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            return None
        return int(payload["sub"])
    except Exception:
        return None


# ---------- scoped, single-purpose signed tokens (password reset, etc.) ----------
# Stateless HMAC token carrying a `scope` claim so a reset link cannot be used as
# an access token. Additive — needs no schema change (BRD AUTH-004).
def create_scoped_token(user_id: int, scope: str, ttl_seconds: int) -> str:
    payload = {"sub": user_id, "scope": scope, "exp": int(time.time()) + ttl_seconds}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_scoped_token(token: str, scope: str) -> Optional[int]:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("scope") != scope or payload["exp"] < time.time():
            return None
        return int(payload["sub"])
    except Exception:
        return None


# ---------- FastAPI dependencies ----------
_bearer = HTTPBearer(auto_error=False)


def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
                 db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    uid = decode_token(creds.credentials)
    if uid is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, uid)
    if user is None or user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def require_roles(*allowed: str):
    """Route dependency enforcing role-based access (BRD 4.1, BR-008)."""
    def checker(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Requires role: {', '.join(allowed)}")
        return user
    return checker

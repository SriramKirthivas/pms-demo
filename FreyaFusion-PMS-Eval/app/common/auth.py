"""Slim auth: validate the shared JWT (issued by the platform / auth service).

In the URF platform this is replaced by the API Gateway Lambda Authorizer + UAM;
here each service verifies the token locally with the shared SECRET_KEY.
"""

import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ROLES = ("employee", "manager", "admin")


DEFAULT_TENANT_ID = "default"


@dataclass
class CurrentUser:
    role: str
    email: str
    name: str
    country: str = "IE"
    tenant_id: str = DEFAULT_TENANT_ID


def get_current_user(
    authorization: str = Header(default=""),
    x_tenant_id: str = Header(default=""),
) -> CurrentUser:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(authorization[len("Bearer "):], SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    role = payload.get("role", "employee")
    if role not in ROLES:
        role = "employee"
    # Tenant comes from the JWT claim (set by the platform's auth/UAM layer at
    # login); fall back to an X-Tenant-Id header (useful for local/dev calls
    # that mint tokens without the claim), and finally to the shared default
    # tenant when neither is present (e.g. single-tenant dev environments).
    tenant_id = payload.get("tenant_id") or payload.get("tenantId") or x_tenant_id or DEFAULT_TENANT_ID
    return CurrentUser(
        role=role,
        email=payload.get("sub", ""),
        name=payload.get("name", ""),
        country=payload.get("country", "IE"),
        tenant_id=tenant_id,
    )


def require(*roles: str):
    """Dependency: allow only the given roles (empty = any authenticated user)."""

    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if roles and user.role not in roles:
            raise HTTPException(status_code=403, detail=f"requires role in {roles}")
        return user

    return checker

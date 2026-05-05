"""
auth.py — AWS Cognito OAuth 2.0 auth layer for System Flow API.

Flow:
  1. GET /auth/login       → redirect browser to Cognito Hosted UI
  2. GET /auth/callback    → exchange code, validate JWT via JWKS,
                             create opaque session token, set cookie,
                             redirect to Streamlit
  3. GET /auth/me          → verify session token, return user info
  4. POST /auth/logout     → delete session token, clear cookie
  5. POST /auth/merge_tokens → carry over guest token count at login time

Session tokens are opaque UUIDs stored in DynamoDB (sf-auth-sessions).
The Cognito JWT never leaves the server.
The cookie is HttpOnly so only the Next.js BFF can read it server-side.
a Bearer header in server-side requests.py calls.
"""

import os
import uuid
import time
import json

import httpx
import boto3
from botocore.exceptions import ClientError
from jose import jwk, jwt
from jose.utils import base64url_decode
from dotenv import load_dotenv
from logger import get_logger

load_dotenv()

log = get_logger("auth")

# ---------------------------------------------------------------------------
# Config (all from .env)
# ---------------------------------------------------------------------------

COGNITO_DOMAIN       = os.getenv("COGNITO_DOMAIN", "").rstrip("/")
CLIENT_ID            = os.getenv("COGNITO_CLIENT_ID", "")
CLIENT_SECRET        = os.getenv("COGNITO_CLIENT_SECRET", "")
USER_POOL_ID         = os.getenv("COGNITO_USER_POOL_ID", "")
REGION               = os.getenv("COGNITO_REGION", "us-east-1")
AUTH_SESSION_TABLE   = os.getenv("AUTH_SESSION_TABLE", "sf-auth-sessions")
SESSION_TTL_SECONDS  = 60 * 60 * 24  # 24 hours

REDIRECT_URI     = os.getenv("REDIRECT_URI")
FRONTEND_URL     = os.getenv("FRONTEND_URL", "http://localhost:3000")
JWKS_URL         = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
TOKEN_URL        = f"{COGNITO_DOMAIN}/oauth2/token"
LOGOUT_URL       = f"{COGNITO_DOMAIN}/logout"

# ---------------------------------------------------------------------------
# DynamoDB — sf-auth-sessions table
# ---------------------------------------------------------------------------

_dynamodb = boto3.resource(
    "dynamodb",
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)
_sessions_table = _dynamodb.Table(AUTH_SESSION_TABLE)

# ---------------------------------------------------------------------------
# JWKS cache — fetched once per process, refreshed on key-not-found
# ---------------------------------------------------------------------------

_jwks_cache: dict | None = None


def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        log.info("auth | fetching JWKS from %s", JWKS_URL)
        try:
            resp = httpx.get(JWKS_URL, timeout=10)
            resp.raise_for_status()
            _jwks_cache = resp.json()
        except httpx.HTTPError as e:
            log.error("auth | JWKS fetch failed: %s", e)
            raise ValueError(f"Failed to fetch JWKS from Cognito: {e}") from e
    return _jwks_cache


def _refresh_jwks() -> dict:
    global _jwks_cache
    _jwks_cache = None
    return _get_jwks()


# ---------------------------------------------------------------------------
# JWT validation
# ---------------------------------------------------------------------------

def validate_cognito_jwt(token: str) -> dict:
    """
    Validate a Cognito ID token.
    Returns the decoded claims dict on success, raises ValueError on failure.
    """
    jwks = _get_jwks()

    # Decode header without verification to find the key id
    try:
        headers = jwt.get_unverified_headers(token)
    except Exception as e:
        raise ValueError(f"Cannot decode JWT headers: {e}")

    kid = headers.get("kid")

    # Find the matching public key in the JWKS
    key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key_data is None:
        # Key might have rotated — refresh and retry once
        jwks = _refresh_jwks()
        key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key_data is None:
            raise ValueError(f"Public key kid='{kid}' not found in JWKS")

    public_key = jwk.construct(key_data)

    # Verify signature and standard claims
    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=CLIENT_ID,
            options={"verify_exp": True, "verify_at_hash": False},
        )
    except Exception as e:
        raise ValueError(f"JWT validation failed: {e}")

    # Cognito-specific: confirm issuer
    expected_issuer = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"
    if claims.get("iss") != expected_issuer:
        raise ValueError(f"Unexpected issuer: {claims.get('iss')}")

    log.debug("auth | JWT validated for sub='%s'", claims.get("sub", "")[:12] + "...")
    return claims


# ---------------------------------------------------------------------------
# Session token CRUD (DynamoDB)
# ---------------------------------------------------------------------------

def create_session(user_id: str, email: str, name: str, refresh_token: str) -> str:
    """
    Store a new auth session in DynamoDB.
    Returns the opaque session token (UUID).
    """
    session_token = str(uuid.uuid4())
    expires_at = int(time.time()) + SESSION_TTL_SECONDS

    try:
        _sessions_table.put_item(Item={
            "session_token": session_token,
            "user_id":       user_id,
            "email":         email,
            "name":          name,
            "refresh_token": refresh_token,
            "expires_at":    expires_at,
            "created_at":    int(time.time()),
        })
    except ClientError as e:
        log.error("auth | create_session DynamoDB error: %s", e.response["Error"]["Message"])
        raise

    log.info("auth | session created for user_id='%s'", user_id[:12] + "...")
    return session_token


def get_session(session_token: str) -> dict | None:
    """
    Retrieve a session by token. Returns None if not found or expired.
    """
    try:
        resp = _sessions_table.get_item(Key={"session_token": session_token})
    except ClientError as e:
        log.error("auth | get_session DynamoDB error: %s", e.response["Error"]["Message"])
        return None

    item = resp.get("Item")
    if not item:
        return None

    # Manual expiry check (DynamoDB TTL deletion is eventual, not instant)
    if int(time.time()) > item.get("expires_at", 0):
        log.info("auth | session expired for token prefix='%s'", session_token[:8])
        delete_session(session_token)
        return None

    return item


def delete_session(session_token: str) -> None:
    """Delete a session record from DynamoDB."""
    try:
        _sessions_table.delete_item(Key={"session_token": session_token})
    except ClientError as e:
        log.error("auth | delete_session DynamoDB error: %s", e.response["Error"]["Message"])


# ---------------------------------------------------------------------------
# OAuth code exchange
# ---------------------------------------------------------------------------

def exchange_code_for_tokens(code: str) -> dict:
    """
    Exchange an authorization code for Cognito tokens.
    Returns the full token response dict (access_token, id_token, refresh_token).
    Raises ValueError on network or HTTP failure.
    """
    log.info("auth | exchanging authorization code")
    try:
        resp = httpx.post(
            TOKEN_URL,
            data={
                "grant_type":   "authorization_code",
                "client_id":    CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "code":         code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        log.error("auth | token exchange failed: %s", e)
        raise ValueError(f"Token exchange with Cognito failed: {e}") from e


# ---------------------------------------------------------------------------
# Login URL builder
# ---------------------------------------------------------------------------

def build_login_url(state: str = "") -> str:
    """Return the Cognito Hosted UI authorization URL."""
    params = (
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&scope=openid+email+profile"
        f"&redirect_uri={REDIRECT_URI}"
    )
    if state:
        params += f"&state={state}"
    return f"{COGNITO_DOMAIN}/oauth2/authorize{params}"


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

COOKIE_NAME = "sf_auth"
_USE_SECURE_COOKIE = FRONTEND_URL.startswith("https://")


def make_auth_cookie_header(token: str) -> str:
    """Return a Set-Cookie header value for the auth session token."""
    secure = "; Secure" if _USE_SECURE_COOKIE else ""
    return (
        f"{COOKIE_NAME}={token}; "
        f"Path=/; "
        f"Max-Age={SESSION_TTL_SECONDS}; "
        f"HttpOnly; "
        f"SameSite=Lax"
        f"{secure}"
    )


def make_clear_cookie_header() -> str:
    """Return a Set-Cookie header that clears the auth cookie."""
    secure = "; Secure" if _USE_SECURE_COOKIE else ""
    return f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{secure}"


def extract_session_token_from_header(authorization: str | None) -> str | None:
    """Extract the bearer token from an Authorization header value."""
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None

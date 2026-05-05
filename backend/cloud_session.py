"""
cloud_session.py — DynamoDB CRUD for authenticated user sessions (Phase 2).

Table: sf-user-sessions
  PK: user_id   (string)  — Cognito sub
  SK: session_id (string) — UUID matching the frontend session key

Each item stores the complete session dict (same shape as localStorage):
  {
    "user_id":       str,
    "session_id":    str,
    "first_prompt":  str,
    "messages":      list,
    "current_graph": dict | None,
    "thread_id":     str,
    "initialized":   bool,
    "created_at":    int,
    "token_usage":   {"input_tokens": int, "output_tokens": int},
    "updated_at":    int,
  }
"""

import os
import time

import boto3
from boto3.dynamodb.types import TypeSerializer, TypeDeserializer
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from logger import get_logger

load_dotenv()

log = get_logger("cloud_session")

_REGION     = os.getenv("COGNITO_REGION", "us-east-1")
_TABLE_NAME = os.getenv("USER_SESSION_TABLE", "sf-user-sessions")

_dynamodb = boto3.resource(
    "dynamodb",
    region_name=_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)
_table = _dynamodb.Table(_TABLE_NAME)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_sessions(user_id: str) -> dict:
    """
    Fetch all sessions for a user, returned as a dict keyed by session_id
    (matching the localStorage shape the frontend expects).
    """
    log.info("cloud_session.list | user_id='%s'", user_id[:12] + "...")
    try:
        resp = _table.query(
            KeyConditionExpression="user_id = :uid",
            ExpressionAttributeValues={":uid": user_id},
        )
    except ClientError as e:
        log.error("cloud_session.list | DynamoDB error: %s", e.response["Error"]["Message"])
        raise

    sessions = {}
    for item in resp.get("Items", []):
        sid = item.get("session_id")
        if sid:
            # Strip DynamoDB housekeeping keys before returning to frontend
            session_data = {k: v for k, v in item.items() if k not in ("user_id",)}
            sessions[sid] = session_data

    log.info("cloud_session.list | found %d sessions", len(sessions))
    return sessions


def upsert_session(user_id: str, session_id: str, session_data: dict) -> None:
    """
    Write (create or replace) a single session for a user.
    `session_data` must be the full session dict from the frontend.
    """
    log.info(
        "cloud_session.upsert | user_id='%s' session_id='%s'",
        user_id[:12] + "...", session_id[:8] + "...",
    )
    item = {
        "user_id":       user_id,
        "session_id":    session_id,
        "updated_at":    int(time.time()),
        **{k: v for k, v in session_data.items() if k not in ("user_id", "session_id")},
    }
    try:
        _table.put_item(Item=item)
    except ClientError as e:
        log.error("cloud_session.upsert | DynamoDB error: %s", e.response["Error"]["Message"])
        raise


def bulk_sync(user_id: str, sessions: dict) -> int:
    """
    Write multiple sessions at once (used for guest-to-cloud migration at login).
    `sessions` is the full sessions dict from localStorage: {session_id: session_data}.
    Returns the count of sessions written.
    """
    log.info(
        "cloud_session.bulk_sync | user_id='%s' count=%d",
        user_id[:12] + "...", len(sessions),
    )
    written = 0
    for session_id, session_data in sessions.items():
        if not session_id or not isinstance(session_data, dict):
            continue
        try:
            upsert_session(user_id, session_id, session_data)
            written += 1
        except Exception as e:
            log.warning(
                "cloud_session.bulk_sync | skipping session_id='%s': %s",
                session_id[:8] + "...", e,
            )

    log.info("cloud_session.bulk_sync | written=%d", written)
    return written

import os
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timezone
from dotenv import load_dotenv
from logger import get_logger

log = get_logger("tracker")

load_dotenv()

_TOKEN_LIMIT = int(os.getenv("TOKEN_LIMIT", "100000"))
_TABLE_NAME = "system-flow-token-tracker"
_REGION = "us-east-1"

# Module-level DynamoDB resource — one connection, reused for all calls
_dynamodb = boto3.resource(
    "dynamodb",
    region_name=_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)
_table = _dynamodb.Table(_TABLE_NAME)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_limit() -> int:
    return _TOKEN_LIMIT


_AUTH_TOKEN_LIMIT = int(os.getenv("AUTH_USER_TOKEN_LIMIT", "1000000"))


def _default_auth_limit() -> int:
    return _AUTH_TOKEN_LIMIT


def resolve_tracker_key(device_id: str, user_id: str | None) -> tuple[str, int]:
    """
    Return (dynamodb_key, token_limit) based on whether the user is authenticated.
    Authenticated users use their Cognito sub (user_id) as the DynamoDB key and
    get the higher AUTH_USER_TOKEN_LIMIT. Guests use device_id and TOKEN_LIMIT.
    """
    if user_id and user_id.strip():
        return user_id.strip(), _default_auth_limit()
    return device_id, _default_limit()


def init_user(user_id: str, date: str) -> dict:
    """
    Ensure a DynamoDB record exists for an authenticated user (user_id, date).
    Uses the AUTH_USER_TOKEN_LIMIT. Same semantics as init_device.
    Returns the current state: {total_tokens, token_limit, is_blocked}.
    """
    limit = _default_auth_limit()
    log.info("init_user | user_id='%s' date='%s' limit=%d", user_id[:12] + "...", date, limit)
    try:
        _table.update_item(
            Key={"device_id": user_id, "date": date},
            UpdateExpression=(
                "SET #tl = :limit, "
                "    first_seen = if_not_exists(first_seen, :ts), "
                "    total_tokens = if_not_exists(total_tokens, :zero) "
                "ADD request_count :zero_num"
            ),
            ExpressionAttributeNames={"#tl": "token_limit"},
            ExpressionAttributeValues={
                ":limit": limit,
                ":ts": _now_iso(),
                ":zero": 0,
                ":zero_num": 0,
            },
        )
        resp = _table.get_item(Key={"device_id": user_id, "date": date})
    except ClientError as e:
        log.error("init_user | DynamoDB error: %s", e.response["Error"]["Message"])
        raise

    item = resp.get("Item", {})
    total = int(item.get("total_tokens", 0))
    is_blocked = total >= limit
    log.info("init_user | total=%d limit=%d is_blocked=%s", total, limit, is_blocked)
    return {"total_tokens": total, "token_limit": limit, "is_blocked": is_blocked}


def init_device(device_id: str, token_limit: int, date: str) -> dict:
    """
    Ensure a DynamoDB record exists for (device_id, date).
    Uses attribute_not_exists conditions so an existing day's total is never reset.
    Returns the current state: {total_tokens, token_limit, is_blocked}.
    """
    log.info("init_device | device_id='%s' date='%s' limit=%d", device_id[:12] + "...", date, token_limit)
    try:
        _table.update_item(
            Key={"device_id": device_id, "date": date},
            UpdateExpression=(
                "SET #tl = if_not_exists(#tl, :limit), "
                "    first_seen = if_not_exists(first_seen, :ts), "
                "    total_tokens = if_not_exists(total_tokens, :zero) "
                "ADD request_count :zero_num"
            ),
            ExpressionAttributeNames={"#tl": "token_limit"},
            ExpressionAttributeValues={
                ":limit": token_limit,
                ":ts": _now_iso(),
                ":zero": 0,
                ":zero_num": 0,
            },
        )
        # Read back the current state
        resp = _table.get_item(Key={"device_id": device_id, "date": date})
    except ClientError as e:
        log.error("init_device | DynamoDB error: %s", e.response["Error"]["Message"])
        raise

    item = resp.get("Item", {})
    total = int(item.get("total_tokens", 0))
    limit = int(item.get("token_limit", token_limit))
    is_blocked = total >= limit
    log.info("init_device | total=%d limit=%d is_blocked=%s", total, limit, is_blocked)
    return {"total_tokens": total, "token_limit": limit, "is_blocked": is_blocked}


def add_tokens(device_id: str, date: str, tokens: int) -> dict:
    """
    Atomically increment total_tokens for (device_id, date).
    Returns {total_tokens, is_blocked} after the update.
    """
    log.info("add_tokens | device_id='%s' date='%s' tokens=%d", device_id[:12] + "...", date, tokens)
    try:
        resp = _table.update_item(
            Key={"device_id": device_id, "date": date},
            UpdateExpression=(
                "ADD total_tokens :n, request_count :one "
                "SET last_updated = :ts"
            ),
            ExpressionAttributeValues={
                ":n": tokens,
                ":one": 1,
                ":ts": _now_iso(),
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        log.error("add_tokens | DynamoDB error: %s", e.response["Error"]["Message"])
        raise

    item = resp.get("Attributes", {})
    total = int(item.get("total_tokens", 0))
    limit = int(item.get("token_limit", _default_limit()))
    is_blocked = total >= limit
    log.info("add_tokens | new_total=%d limit=%d is_blocked=%s", total, limit, is_blocked)
    return {"total_tokens": total, "is_blocked": is_blocked}


def check_limit(device_id: str, date: str) -> bool:
    """
    Returns True if the user has reached or exceeded their daily token limit.
    Called before every Bedrock invocation.
    """
    log.debug("check_limit | device_id='%s' date='%s'", device_id[:12] + "...", date)
    try:
        resp = _table.get_item(
            Key={"device_id": device_id, "date": date},
            ProjectionExpression="total_tokens, token_limit",
        )
    except ClientError as e:
        log.error("check_limit | DynamoDB error: %s", e.response["Error"]["Message"])
        # Fail open — if DynamoDB is unreachable, don't block the user
        return False

    item = resp.get("Item")
    if not item:
        # No record yet — not blocked
        return False

    total = int(item.get("total_tokens", 0))
    limit = int(item.get("token_limit", _default_limit()))
    blocked = total >= limit
    log.info("check_limit | total=%d limit=%d blocked=%s", total, limit, blocked)
    return blocked


def merge_guest_tokens(device_id: str, user_id: str, date: str, user_limit: int) -> int:
    """
    At login time: read the guest device's today token total and add it to the
    authenticated user's record. The guest record is then zeroed out so the
    tokens aren't double-counted if the user logs out and back in.

    Uses `device_id` as the PK for guest records and `user_id` as the PK for
    authenticated user records (same table, different PK values).

    Returns the merged total for the user.
    """
    log.info(
        "merge_guest_tokens | device_id='%s' user_id='%s' date='%s'",
        device_id[:12] + "...", user_id[:12] + "...", date,
    )

    # Read the guest total for today
    try:
        guest_resp = _table.get_item(
            Key={"device_id": device_id, "date": date},
            ProjectionExpression="total_tokens",
        )
    except ClientError as e:
        log.error("merge_guest_tokens | failed to read guest record: %s", e.response["Error"]["Message"])
        guest_tokens = 0
    else:
        guest_tokens = int(guest_resp.get("Item", {}).get("total_tokens", 0))

    log.info("merge_guest_tokens | guest_tokens=%d", guest_tokens)

    # Ensure the user record exists with the correct limit, then add guest tokens
    try:
        _table.update_item(
            Key={"device_id": user_id, "date": date},
            UpdateExpression=(
                "SET #tl = if_not_exists(#tl, :limit), "
                "    first_seen = if_not_exists(first_seen, :ts), "
                "    total_tokens = if_not_exists(total_tokens, :zero) "
                "ADD request_count :zero_num"
            ),
            ExpressionAttributeNames={"#tl": "token_limit"},
            ExpressionAttributeValues={
                ":limit": user_limit,
                ":ts": _now_iso(),
                ":zero": 0,
                ":zero_num": 0,
            },
        )
        if guest_tokens > 0:
            resp = _table.update_item(
                Key={"device_id": user_id, "date": date},
                UpdateExpression="ADD total_tokens :n SET last_updated = :ts",
                ExpressionAttributeValues={":n": guest_tokens, ":ts": _now_iso()},
                ReturnValues="ALL_NEW",
            )
            merged_total = int(resp.get("Attributes", {}).get("total_tokens", guest_tokens))
        else:
            user_resp = _table.get_item(Key={"device_id": user_id, "date": date})
            merged_total = int(user_resp.get("Item", {}).get("total_tokens", 0))
    except ClientError as e:
        log.error("merge_guest_tokens | failed to update user record: %s", e.response["Error"]["Message"])
        raise

    # Zero out the guest record to prevent double-counting
    if guest_tokens > 0:
        try:
            _table.update_item(
                Key={"device_id": device_id, "date": date},
                UpdateExpression="SET total_tokens = :zero, last_updated = :ts",
                ExpressionAttributeValues={":zero": 0, ":ts": _now_iso()},
            )
        except ClientError as e:
            log.warning("merge_guest_tokens | failed to zero guest record: %s", e.response["Error"]["Message"])

    log.info("merge_guest_tokens | merged_total=%d", merged_total)
    return merged_total


import os
import time
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from logger import get_logger

log = get_logger("session_util")

_TABLE_NAME = os.getenv("SESSION_STATE_TABLE", "sf-session-state")
_REGION = os.getenv("COGNITO_REGION", "us-east-1")
_HISTORY_TTL_SECONDS = 90 * 24 * 3600  # 90 days

_ddb = boto3.resource("dynamodb", region_name=_REGION)
_table = _ddb.Table(_TABLE_NAME)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _history_ttl() -> int:
    return int(time.time()) + _HISTORY_TTL_SECONDS


# ---------------------------------------------------------------------------
# Description
# ---------------------------------------------------------------------------

def description_write(thread_id: str, description: str):
    _write_description(thread_id, description)


def description_append(thread_id: str, description: str):
    _write_description(thread_id, description)


def description_read_latest(thread_id: str) -> str:
    try:
        item = _table.get_item(
            Key={"thread_id": thread_id, "rev_id": "LATEST"}
        ).get("Item", {})
    except ClientError as e:
        log.error("session_util | description_read_latest DynamoDB error: %s", e.response["Error"]["Message"])
        raise
    return item.get("latest_description", "")


def _write_description(thread_id: str, description: str):
    ts = _now_iso()
    try:
        # History row — expires after 90 days
        _table.put_item(Item={
            "thread_id": thread_id,
            "rev_id": f"{ts}_desc",
            "type": "desc",
            "value": description,
            "timestamp": ts,
            "ttl": _history_ttl(),
        })
        # LATEST row — no TTL, always reflects current state
        _table.update_item(
            Key={"thread_id": thread_id, "rev_id": "LATEST"},
            UpdateExpression="SET latest_description = :d, updated_at = :t",
            ExpressionAttributeValues={":d": description, ":t": ts},
        )
    except ClientError as e:
        log.error("session_util | _write_description DynamoDB error: %s", e.response["Error"]["Message"])
        raise


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------

def graph_write(thread_id: str, graph_json: dict):
    _write_graph(thread_id, graph_json)


def graph_append(thread_id: str, graph_json: dict):
    _write_graph(thread_id, graph_json)


def graph_read_latest(thread_id: str) -> dict:
    try:
        item = _table.get_item(
            Key={"thread_id": thread_id, "rev_id": "LATEST"}
        ).get("Item", {})
    except ClientError as e:
        log.error("session_util | graph_read_latest DynamoDB error: %s", e.response["Error"]["Message"])
        raise
    return item.get("latest_graph", {})


def _write_graph(thread_id: str, graph_json: dict):
    ts = _now_iso()
    try:
        # History row — expires after 90 days
        _table.put_item(Item={
            "thread_id": thread_id,
            "rev_id": f"{ts}_graph",
            "type": "graph",
            "value": graph_json,
            "timestamp": ts,
            "ttl": _history_ttl(),
        })
        # LATEST row — no TTL, always reflects current state
        _table.update_item(
            Key={"thread_id": thread_id, "rev_id": "LATEST"},
            UpdateExpression="SET latest_graph = :g, updated_at = :t",
            ExpressionAttributeValues={":g": graph_json, ":t": ts},
        )
    except ClientError as e:
        log.error("session_util | _write_graph DynamoDB error: %s", e.response["Error"]["Message"])
        raise

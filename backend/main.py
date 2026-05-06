import os
import asyncio
from contextlib import asynccontextmanager
from datetime import date as _date
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from langchain_core.messages import HumanMessage

from util import get_description, get_graph_json_description
from session_util import description_write, graph_write, graph_read_latest, description_read_latest
from agent import build_agent
import tracker
import auth
import cloud_session
from logger import get_logger

log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with build_agent() as (_agent, _checkpointer):
        app.state.agent = _agent
        app.state.checkpointer = _checkpointer
        log.info("lifespan | agent initialised with AsyncSqliteSaver")
        yield
    log.info("lifespan | agent shut down")


app = FastAPI(title="System Flow API v3", lifespan=lifespan)

_allow_origins = [
    o.strip()
    for o in os.getenv("ALLOW_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,  # set ALLOW_ORIGINS env var for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from typing import Optional

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------



class GenerateDescriptionRequest(BaseModel):
    prompt: str
    device_id: str
    thread_id: str
    user_id: Optional[str] = None

class GenerateDescriptionResponse(BaseModel):
    description: str
    usage: dict = {}
    daily_total: int = 0
    is_blocked: bool = False
#________________________________________________________

class GenerateGraphRequest(BaseModel):
    description: str
    device_id: str
    thread_id: str
    user_id: Optional[str] = None

class GenerateGraphResponse(BaseModel):
    graph: dict
    usage: dict = {}
    daily_total: int = 0
    is_blocked: bool = False
#________________________________________________________

class GenerateRequest(BaseModel):
    prompt: str

class GenerateResponse(BaseModel):
    description: str
    graph: dict
#________________________________________________________

class ChatRequest(BaseModel):
    prompt: str
    thread_id: str
    device_id: str
    user_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    graph: dict
    description: str = ""
    usage: dict = {}
    daily_total: int = 0
    is_blocked: bool = False
#________________________________________________________

class InitTokensRequest(BaseModel):
    device_id: str
    user_id: Optional[str] = None

class InitTokensResponse(BaseModel):
    total_tokens: int
    token_limit: int
    is_blocked: bool
    date: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _today() -> str:
    return _date.today().isoformat()


@app.post("/api/tokens/init", response_model=InitTokensResponse)
def init_tokens(request: InitTokensRequest):
    """Create or retrieve today's token record for this device or user."""
    if not request.device_id or not request.device_id.strip():
        raise HTTPException(status_code=400, detail="device_id must not be empty.")

    if request.user_id and request.user_id.strip():
        log.info("tokens/init | user_id='%s'", request.user_id[:12] + "...")
        try:
            state = tracker.init_user(request.user_id.strip(), _today())
        except Exception as exc:
            log.error("tokens/init | tracker.init_user failed: %s", exc)
            raise HTTPException(status_code=503, detail="Token tracking service unavailable. Please try again.")
    else:
        log.info("tokens/init | device_id='%s'", request.device_id[:12] + "...")
        try:
            state = tracker.init_device(request.device_id, int(os.getenv("TOKEN_LIMIT", "100000")), _today())
        except Exception as exc:
            log.error("tokens/init | tracker.init_device failed: %s", exc)
            raise HTTPException(status_code=503, detail="Token tracking service unavailable. Please try again.")

    return InitTokensResponse(
        total_tokens=state["total_tokens"],
        token_limit=state["token_limit"],
        is_blocked=state["is_blocked"],
        date=_today(),
    )


@app.post("/api/generate_description", response_model=GenerateDescriptionResponse)
async def generate_description(request: GenerateDescriptionRequest):
    """
    First-call endpoint — bypasses the agent entirely.
    Calls get_description and returns the description text to the frontend.
    """
    log.info("generate | START | prompt='%s'", request.prompt[:80])

    if not request.prompt or not request.prompt.strip():
        log.warning("generate | rejected empty prompt")
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    tracker_key, _limit = tracker.resolve_tracker_key(request.device_id, request.user_id)
    if tracker.check_limit(tracker_key, _today()):
        log.warning("generate | tracker_key='%s' is over daily token limit", tracker_key[:12] + "...")
        raise HTTPException(status_code=429, detail="Daily token limit reached. Your quota resets tomorrow.")

    # Step 1: expand the user prompt into a full system description
    log.info("generate | calling get_description")
    try:
        description, usage = await get_description(request.prompt)
    except Exception as exc:
        log.error("generate | get_description failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI description generation failed. Please try again.")
    log.info("generate | description generated, length=%d usage=%s", len(description), usage)

    # Step 2: persist so agent tools can read them from turn 2 onward
    try:
        description_write(request.thread_id, description)
    except Exception as exc:
        log.error("generate | description_write failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to save description. Please try again.")

    tokens_used = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
    try:
        state = tracker.add_tokens(tracker_key, _today(), tokens_used)
    except Exception as exc:
        log.error("generate | add_tokens failed: %s", exc)
        raise HTTPException(status_code=503, detail="Token tracking service unavailable. Please try again.")
    log.info("generate | daily_total=%d is_blocked=%s", state["total_tokens"], state["is_blocked"])

    return GenerateDescriptionResponse(
        description=description,
        usage=usage,
        daily_total=state["total_tokens"],
        is_blocked=state["is_blocked"],
    )

@app.post("/api/generate_graph", response_model=GenerateGraphResponse)
async def generate_graph(request: GenerateGraphRequest):
    """
    First-call endpoint — bypasses the agent entirely.
    Calls get_graph_json_description and returns the graph JSON to the frontend.
    """
    log.info("generate | START | prompt='%s'", request.description[:80])

    if not request.description or not request.description.strip():
        log.warning("generate | rejected empty prompt")
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    tracker_key, _limit = tracker.resolve_tracker_key(request.device_id, request.user_id)
    if tracker.check_limit(tracker_key, _today()):
        log.warning("graph | tracker_key='%s' is over daily token limit", tracker_key[:12] + "...")
        raise HTTPException(status_code=429, detail="Daily token limit reached. Your quota resets tomorrow.")

    # Step 1: generate the graph from the description
    log.info("generate | calling get_graph_json_description")
    try:
        graph, usage = await get_graph_json_description(request.description)
    except Exception as exc:
        log.error("generate | get_graph_json_description failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI graph generation failed. Please try again.")
    if graph == 500:
        log.error("generate | graph generation failed")
        raise HTTPException(status_code=502, detail="Failed to generate graph from AI.")

    # Step 2: persist so agent tools can read them from turn 2 onward
    try:
        graph_write(request.thread_id, graph)
    except Exception as exc:
        log.error("generate | graph_write failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to save graph. Please try again.")

    node_count = len(graph.get('nodes', []))
    edge_count = len(graph.get('edges', []))
    log.info("generate | END | nodes=%d edges=%d", node_count, edge_count)

    tokens_used = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
    try:
        state = tracker.add_tokens(tracker_key, _today(), tokens_used)
    except Exception as exc:
        log.error("graph | add_tokens failed: %s", exc)
        raise HTTPException(status_code=503, detail="Token tracking service unavailable. Please try again.")
    log.info("graph | daily_total=%d is_blocked=%s", state["total_tokens"], state["is_blocked"])

    return GenerateGraphResponse(
        graph=graph,
        usage=usage,
        daily_total=state["total_tokens"],
        is_blocked=state["is_blocked"],
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, http_request: Request):
    """
    Subsequent-turn endpoint — routes through the ReAct agent.
    The agent selects from description_question, description_update,
    graph_question, or graph_update based on the user prompt.
    Always returns the latest graph state after the agent completes.
    """
    log.info("chat | START | thread_id='%s' prompt='%s'", request.thread_id, request.prompt[:80])

    if not request.prompt or not request.prompt.strip():
        log.warning("chat | rejected empty prompt")
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    if not request.thread_id or not request.thread_id.strip():
        log.warning("chat | rejected empty thread_id")
        raise HTTPException(status_code=400, detail="thread_id must not be empty.")

    tracker_key, _limit = tracker.resolve_tracker_key(request.device_id, request.user_id)
    if tracker.check_limit(tracker_key, _today()):
        log.warning("chat | tracker_key='%s' is over daily token limit", tracker_key[:12] + "...")
        raise HTTPException(status_code=429, detail="Daily token limit reached. Your quota resets tomorrow.")

    config = {
        "configurable": {"thread_id": request.thread_id},
        "recursion_limit": 10,
    }

    log.info("chat | invoking agent")
    max_attempts = 2
    result = None
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            result = await http_request.app.state.agent.ainvoke(
                {"messages": [HumanMessage(content=request.prompt)]},
                config=config,
            )
            break
        except ValueError as exc:
            if "do not have a corresponding ToolMessage" in str(exc):
                log.error("chat | corrupt checkpoint for thread_id='%s' — %s", request.thread_id, exc)
                raise HTTPException(
                    status_code=409,
                    detail=f"Conversation history is corrupted. Call DELETE /api/chat/{request.thread_id}/checkpoint to reset, then retry.",
                )
            last_exc = exc
            log.warning(
                "chat | ainvoke failed | attempt=%d/%d | error=%s",
                attempt,
                max_attempts,
                exc,
            )
            if attempt < max_attempts:
                await asyncio.sleep(0.3 * attempt)
        except Exception as exc:
            last_exc = exc
            log.warning(
                "chat | ainvoke failed | attempt=%d/%d | error=%s",
                attempt,
                max_attempts,
                exc,
            )
            if attempt < max_attempts:
                await asyncio.sleep(0.3 * attempt)

    if result is None:
        log.error("chat | agent failed after %d attempts: %s", max_attempts, last_exc)
        raise HTTPException(
            status_code=502,
            detail="The AI agent failed to respond. Please try again.",
        )

    agent_response = result["messages"][-1].content
    log.info("chat | agent response length=%d", len(agent_response))

    total_input, total_output = 0, 0
    for m in result["messages"]:
        meta = getattr(m, 'usage_metadata', None) or {}
        total_input += meta.get('input_tokens', 0) or 0
        total_output += meta.get('output_tokens', 0) or 0
    usage = {"input_tokens": total_input, "output_tokens": total_output}
    log.info("chat | usage=%s", usage)

    # Always read the latest graph and description so the frontend reflects any updates
    try:
        current_graph = graph_read_latest(request.thread_id)
    except Exception as exc:
        log.warning("chat | graph_read_latest failed — returning empty graph: %s", exc)
        current_graph = {"nodes": [], "edges": []}

    try:
        current_description = description_read_latest(request.thread_id)
    except Exception as exc:
        log.warning("chat | description_read_latest failed: %s", exc)
        current_description = ""

    tokens_used = total_input + total_output
    try:
        state = tracker.add_tokens(tracker_key, _today(), tokens_used)
    except Exception as exc:
        log.error("chat | add_tokens failed: %s", exc)
        raise HTTPException(status_code=503, detail="Token tracking service unavailable. Please try again.")
    log.info("chat | daily_total=%d is_blocked=%s", state["total_tokens"], state["is_blocked"])

    log.info("chat | END")
    return ChatResponse(
        response=agent_response,
        graph=current_graph,
        description=current_description,
        usage=usage,
        daily_total=state["total_tokens"],
        is_blocked=state["is_blocked"],
    )


@app.delete("/api/chat/{thread_id}/checkpoint")
async def reset_checkpoint(thread_id: str, http_request: Request):
    """
    Deletes the LangGraph checkpoint for a given thread_id from SQLite.
    Call this when /api/chat returns 409 (corrupted history) to unblock the thread.
    The next call to /api/chat with the same thread_id will start a fresh conversation.
    """
    if not thread_id or not thread_id.strip():
        raise HTTPException(status_code=400, detail="thread_id must not be empty.")
    checkpointer = http_request.app.state.checkpointer
    await checkpointer.conn.execute(
        "DELETE FROM writes WHERE thread_id = ?", (thread_id,)
    )
    await checkpointer.conn.execute(
        "DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,)
    )
    await checkpointer.conn.commit()
    log.info("reset_checkpoint | cleared checkpoint for thread_id='%s'", thread_id)
    return {"reset": True, "thread_id": thread_id}


@app.get("/health")
def health():
    log.debug("health | health check requested")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Auth endpoints (Phase 1)
# ---------------------------------------------------------------------------

@app.get("/auth/login")
def auth_login(request: Request):
    """
    Redirect the browser to the Cognito Hosted UI.
    The 'state' query param is forwarded so the frontend can restore the
    active session after the OAuth round-trip completes.
    """
    state = request.query_params.get("state", "")
    login_url = auth.build_login_url(state=state)
    log.info("auth/login | redirecting to Cognito Hosted UI")
    return RedirectResponse(url=login_url)


@app.get("/auth/callback")
def auth_callback(request: Request):
    """
    Cognito redirects here after the user authenticates.
    Exchanges the authorization code for tokens, validates the ID token JWT,
    creates an opaque session token, stores it in DynamoDB, sets the cookie,
    and redirects the browser back to the frontend.
    """
    code  = request.query_params.get("code")
    state = request.query_params.get("state", "")
    error = request.query_params.get("error")

    if error:
        log.warning("auth/callback | Cognito returned error: %s", error)
        return RedirectResponse(url=f"{auth.FRONTEND_URL}?auth_error={error}")

    if not code:
        log.warning("auth/callback | no code in callback params")
        raise HTTPException(status_code=400, detail="Missing authorization code.")

    # Exchange code for Cognito tokens
    try:
        tokens = auth.exchange_code_for_tokens(code)
    except Exception as e:
        log.error("auth/callback | token exchange failed: %s", e)
        raise HTTPException(status_code=502, detail="Token exchange with Cognito failed.")

    id_token      = tokens.get("id_token", "")
    refresh_token = tokens.get("refresh_token", "")

    # Validate the ID token via Cognito's JWKS
    try:
        claims = auth.validate_cognito_jwt(id_token)
    except ValueError as e:
        log.error("auth/callback | JWT validation failed: %s", e)
        raise HTTPException(status_code=401, detail=f"Token validation failed: {e}")

    user_id = claims.get("sub", "")
    email   = claims.get("email", "")
    name    = claims.get("name", "") or claims.get("cognito:username", email)

    # Create an opaque session token stored server-side
    session_token = auth.create_session(
        user_id=user_id,
        email=email,
        name=name,
        refresh_token=refresh_token,
    )

    # Redirect browser to frontend, passing state so it can restore the session
    redirect_target = auth.FRONTEND_URL
    if state:
        redirect_target += f"?auth_state={state}"

    response = RedirectResponse(url=redirect_target)
    response.headers["Set-Cookie"] = auth.make_auth_cookie_header(session_token)
    log.info("auth/callback | login complete for user_id='%s'", user_id[:12] + "...")
    return response


@app.get("/auth/me")
def auth_me(request: Request):
    """
    Verify the session token from the Authorization Bearer header.
    Returns {user_id, email, name} on success, 401 on invalid/expired token.
    """
    raw_auth = request.headers.get("Authorization")
    session_token = auth.extract_session_token_from_header(raw_auth)

    if not session_token:
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")

    session = auth.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found or expired.")

    return {
        "user_id": session["user_id"],
        "email":   session["email"],
        "name":    session["name"],
    }


class LogoutRequest(BaseModel):
    device_id: Optional[str] = None

@app.post("/auth/logout")
def auth_logout(request_body: LogoutRequest, request: Request):
    """
    Delete the server-side session and clear the browser cookie.
    If device_id is provided and the session is valid, syncs the user's
    token total back to the device record before deleting the session so
    guest-mode views after sign-out show the correct consumed total.
    """
    raw_auth = request.headers.get("Authorization")
    session_token = auth.extract_session_token_from_header(raw_auth)

    if session_token:
        session = auth.get_session(session_token)
        if session and request_body.device_id and request_body.device_id.strip():
            try:
                tracker.sync_user_tokens_to_device(
                    device_id=request_body.device_id.strip(),
                    user_id=session["user_id"],
                    date=_today(),
                )
                log.info("auth/logout | token sync complete for user_id='%s'", session["user_id"][:12] + "...")
            except Exception as exc:
                log.warning("auth/logout | token sync failed (non-fatal): %s", exc)
        auth.delete_session(session_token)
        log.info("auth/logout | session deleted")

    response = JSONResponse(content={"status": "logged out"})
    response.headers["Set-Cookie"] = auth.make_clear_cookie_header()
    return response


class MergeTokensRequest(BaseModel):
    device_id: str

@app.post("/auth/merge_tokens")
def auth_merge_tokens(request_body: MergeTokensRequest, request: Request):
    """
    At login time: add the guest device's today token count to the user's
    count so consumption carries over. Zeros out the guest record.
    Called once per login by the Streamlit frontend.
    """
    raw_auth = request.headers.get("Authorization")
    session_token = auth.extract_session_token_from_header(raw_auth)

    if not session_token:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    session = auth.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found or expired.")

    today     = _today()
    user_id   = session["user_id"]
    device_id = request_body.device_id

    try:
        merged_total = tracker.merge_guest_tokens(
            device_id=device_id,
            user_id=user_id,
            date=today,
            user_limit=int(os.getenv("AUTH_USER_TOKEN_LIMIT", "1000000")),
        )
    except Exception as exc:
        log.error("auth/merge_tokens | merge_guest_tokens failed: %s", exc)
        raise HTTPException(status_code=503, detail="Token merge service unavailable. Please try again.")

    log.info("auth/merge_tokens | user_id='%s' merged total=%d", user_id[:12] + "...", merged_total)
    return {"merged_total": merged_total, "date": today}


# ---------------------------------------------------------------------------
# Cloud session endpoints (Phase 2)
# ---------------------------------------------------------------------------

def _require_auth(request: Request) -> dict:
    """Extract and validate the Bearer session token. Returns the session dict."""
    raw_auth = request.headers.get("Authorization")
    session_token = auth.extract_session_token_from_header(raw_auth)
    if not session_token:
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    session = auth.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found or expired.")
    return session


@app.get("/api/sessions")
def get_sessions(request: Request):
    """
    Return all cloud sessions for the authenticated user.
    Response shape: {"sessions": {session_id: session_data, ...}}
    """
    session = _require_auth(request)
    user_id = session["user_id"]
    log.info("api/sessions GET | user_id='%s'", user_id[:12] + "...")
    try:
        sessions = cloud_session.list_sessions(user_id)
    except Exception as exc:
        log.error("api/sessions GET | list_sessions failed: %s", exc)
        raise HTTPException(status_code=503, detail="Session storage unavailable. Please try again.")
    return {"sessions": sessions}


class UpsertSessionRequest(BaseModel):
    session_data: dict


@app.put("/api/sessions/{session_id}")
def upsert_session(session_id: str, body: UpsertSessionRequest, request: Request):
    """
    Create or replace a single session for the authenticated user.
    Called by the frontend after every chat message.
    """
    session = _require_auth(request)
    user_id = session["user_id"]
    log.info(
        "api/sessions PUT | user_id='%s' session_id='%s'",
        user_id[:12] + "...", session_id[:8] + "...",
    )
    try:
        cloud_session.upsert_session(user_id, session_id, body.session_data)
    except Exception as exc:
        log.error("api/sessions PUT | upsert_session failed: %s", exc)
        raise HTTPException(status_code=503, detail="Session storage unavailable. Please try again.")
    return {"status": "ok", "session_id": session_id}


class SyncSessionsRequest(BaseModel):
    sessions: dict  # {session_id: session_data} — full localStorage sessions dict


@app.post("/api/sessions/sync")
def sync_sessions(body: SyncSessionsRequest, request: Request):
    """
    Bulk-write guest localStorage sessions to the cloud on first login.
    Existing cloud sessions with the same session_id are overwritten.
    Returns the count of sessions written.
    """
    session = _require_auth(request)
    user_id = session["user_id"]
    log.info(
        "api/sessions/sync | user_id='%s' incoming=%d",
        user_id[:12] + "...", len(body.sessions),
    )
    try:
        written = cloud_session.bulk_sync(user_id, body.sessions)
    except Exception as exc:
        log.error("api/sessions/sync | bulk_sync failed: %s", exc)
        raise HTTPException(status_code=503, detail="Session storage unavailable. Please try again.")
    return {"status": "ok", "written": written}



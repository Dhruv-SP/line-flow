import boto3
import json
import os
import time
from contextlib import asynccontextmanager
from langchain_aws import ChatBedrockConverse
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from typing import List, Literal
from typing_extensions import Annotated, TypedDict
from pydantic import BaseModel as PydanticBase
from logger import get_logger

from util import get_boto3_client
from session_util import (
    description_read_latest,
    description_append,
    graph_read_latest,
    graph_append,
)

log = get_logger("agent")


def _invoke_with_retry(chain, payload: dict, max_attempts: int = 2):
    """Invoke an LLM chain with bounded retries for transient model/tool failures."""
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return chain.invoke(payload)
        except Exception as exc:
            last_exc = exc
            log.warning(
                "invoke_with_retry | attempt=%d/%d failed: %s",
                attempt,
                max_attempts,
                exc,
            )
            if attempt < max_attempts:
                time.sleep(0.25 * attempt)
    raise last_exc

# ---------------------------------------------------------------------------
# TypedDict schemas (used internally by each tool's LLM call)
# ---------------------------------------------------------------------------

class description_question_structure(TypedDict):
    answer: Annotated[str, ..., 'The answer to the user question based on the current system description.']

class description_update_structure(TypedDict):
    system_description: Annotated[str, ..., 'The updated system description based on the user prompt and the current system description.']

class graph_question_structure(TypedDict):
    answer: Annotated[str, ..., 'The answer to the user question based on the current system graph.']

NodeLabel = Literal[
    "flight", "train", "directions_car", "place", "flag",
    "translate", "alternate_email", "email", "chat", "phone",
    "wifi", "router", "cell_tower", "language",
    "credit_card", "wallet", "account_balance", "sell",
    "lock", "key", "badge",
    "store", "shopping_cart", "local_shipping", "business", "inventory",
    "person", "group",
    "smartphone", "sim_card", "laptop", "monitor", "storage", "cloud",
    "dns", "description", "folder", "swap_horiz", "link",
]

class GraphNodeData(PydanticBase):
    id: str
    label: NodeLabel
    name: str

class GraphNode(PydanticBase):
    data: GraphNodeData

class GraphEdgeData(PydanticBase):
    id: str
    label: str
    source: str
    target: str

class GraphEdge(PydanticBase):
    data: GraphEdgeData

class GraphStruct(PydanticBase):
    nodes: List[GraphNode]
    edges: List[GraphEdge]

class json_struct(PydanticBase):
    graph_struct: GraphStruct


# ---------------------------------------------------------------------------
# Graph sanitiser — 100% guarantee: replaces any invalid label with "link"
# ---------------------------------------------------------------------------

_VALID_LABELS = {
    "flight", "train", "directions_car", "place", "flag",
    "translate", "alternate_email", "email", "chat", "phone",
    "wifi", "router", "cell_tower", "language",
    "credit_card", "wallet", "account_balance", "sell",
    "lock", "key", "badge",
    "store", "shopping_cart", "local_shipping", "business", "inventory",
    "person", "group",
    "smartphone", "sim_card", "laptop", "monitor", "storage", "cloud",
    "dns", "description", "folder", "swap_horiz", "link",
}

def _sanitise_graph(graph: dict) -> dict:
    """Replace any unrecognised node label with 'link' (generic fallback)."""
    for node in graph.get("nodes", []):
        d = node.get("data", {})
        if d.get("label") not in _VALID_LABELS:
            d["label"] = "link"
    return graph


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def description_question(new_prompt: str, config: RunnableConfig) -> str:
    """
    Use this tool when the user asks a READ-ONLY question about the system description —
    such as 'what does the system do?', 'why is X designed this way?', 'how many components are there?',
    'explain the architecture', or 'list the services'.

    DO NOT use this tool if the user wants to CHANGE or MODIFY the description (use description_update instead).
    DO NOT use this tool for questions about graph topology, nodes, or edges (use graph_question instead).

    Reads the latest system description and answers the question using an LLM.

    Args:
        new_prompt (str): The user's question about the system description.

    Returns:
        str: A direct answer to the question based on the current system description.
    """
    thread_id = config["configurable"]["thread_id"]
    description = description_read_latest(thread_id)
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    llm = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='global.anthropic.claude-haiku-4-5-20251001-v1:0',
        temperature=0.4,
    )
    llm_structured = llm.with_structured_output(description_question_structure)

    SYS_PROMPT = """
    you are a technical system design architect. you are provided with the current system description along with user question.
    Analyze the user question and answer the question based on the current system description. if the question is not related to the system description, answer "the question is not related to the system description".
    """
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT),
        ("human", "system description: {description}\nquestion: {new_prompt}"),
    ])

    response = _invoke_with_retry(
        prompt_template | llm_structured,
        {"new_prompt": new_prompt, "description": description},
        max_attempts=2,
    )
    return response['answer']


@tool
def description_update(new_prompt: str, config: RunnableConfig) -> str:
    """
    Use this tool when the user wants to MODIFY, CHANGE, ADD TO, or REMOVE FROM the system description text —
    such as 'add a caching layer', 'remove the legacy service', 'simplify the architecture',
    'reduce inter-dependencies', or 'rewrite the description to include X'.

    DO NOT use this tool if the user is only asking a question (use description_question instead).
    DO NOT use this tool for changes to graph nodes or edges (use graph_update instead).

    Reads the latest system description, applies the requested changes via LLM,
    persists the result automatically, and returns the updated description text.

    Args:
        new_prompt (str): The user's instruction describing what to change in the system description.

    Returns:
        str: The complete updated system description text (already persisted).
    """
    thread_id = config["configurable"]["thread_id"]
    description = description_read_latest(thread_id)
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    llm = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='us.meta.llama3-3-70b-instruct-v1:0',
        temperature=0.4,
        top_p=0.8,
    )
    llm_structured = llm.with_structured_output(description_update_structure)

    SYS_PROMPT = """
    You are a technical system design architect. you are provided with the current system description along with user prompt.
    Analyze the user prompt and update the current system description based on the user prompt. 
    """
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT),
        ("human", "system description: {description}\nuser prompt: {new_prompt}"),
    ])

    response = _invoke_with_retry(
        prompt_template | llm_structured,
        {"new_prompt": new_prompt, "description": description},
        max_attempts=2,
    )
    new_description = response['system_description']
    description_append(thread_id, new_description)
    return new_description


@tool
def graph_question(new_prompt: str, config: RunnableConfig) -> str:
    """
    Use this tool when the user asks a READ-ONLY question about the system GRAPH —
    such as 'how many nodes are there?', 'which nodes are connected to X?', 'why does node Y have so many edges?',
    'list all edges', 'what type is node Z?', or 'explain the graph topology'.

    DO NOT use this tool if the user wants to CHANGE the graph (use graph_update instead).
    DO NOT use this tool for questions about the high-level system description text (use description_question instead).

    Reads the latest graph JSON and answers the question using an LLM.

    Args:
        new_prompt (str): The user's question about the system graph structure.

    Returns:
        str: A direct answer to the question based on the current graph JSON.
    """
    thread_id = config["configurable"]["thread_id"]
    graph_json = graph_read_latest(thread_id)
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    llm = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='global.anthropic.claude-haiku-4-5-20251001-v1:0',
        temperature=0.4,
    )
    llm_structured = llm.with_structured_output(graph_question_structure)

    SYS_PROMPT = """
    you are a technical system design architect. you are provided with the current system graph json along with user question.
    Analyze the user question and answer the question based on the current system graph.
    """
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT),
        ("human", "graph json: {graph_json}\nquestion: {new_prompt}"),
    ])

    response = _invoke_with_retry(
        prompt_template | llm_structured,
        {"new_prompt": new_prompt, "graph_json": graph_json},
        max_attempts=2,
    )
    return response['answer']


@tool
def graph_update(new_prompt: str, config: RunnableConfig) -> str:
    """
    Use this tool when the user wants to MODIFY, ADD, or REMOVE nodes or edges in the system GRAPH —
    such as 'add a node for Redis', 'remove the legacy database node', 'merge these two nodes',
    'reduce the number of nodes', 'add an edge between X and Y', or 'restructure the graph to reduce complexity'.

    DO NOT use this tool if the user is only asking a question (use graph_question instead).
    DO NOT use this tool for changes to the system description text (use description_update instead).

    Reads the latest graph JSON, applies the requested structural changes via LLM,
    persists the result automatically, and returns the updated graph as a JSON string.

    Args:
        new_prompt (str): The user's instruction describing what to change in the graph structure.

    Returns:
        str: The complete updated graph JSON string (already persisted).
    """
    thread_id = config["configurable"]["thread_id"]
    graph_json = graph_read_latest(thread_id)
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    llm = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='global.anthropic.claude-haiku-4-5-20251001-v1:0',
        temperature=0.2,
    )
    llm_structured = llm.with_structured_output(json_struct)

    SYS_PROMPT = """
    You are a technical system design architect. You are provided with the current system graph json along with user prompt.
    Analyze the user prompt and update the current system graph json based on the user prompt.

    Possible node labels are ONLY: flight, train, directions_car, place, flag, translate, alternate_email, email, chat, phone, wifi, router, cell_tower, language, credit_card, wallet, account_balance, sell, lock, key, badge, store, shopping_cart, local_shipping, business, inventory, person, group, smartphone, sim_card, laptop, monitor, storage, cloud, dns, description, folder, swap_horiz, link.
    Do NOT use any other label values for nodes. Never use "home" or any label not in the list above.
    Every node MUST have at least one edge connecting it to another node. Do not leave any node disconnected.
    Make sure the IDs in the edges are unique and do not repeat the ID of the nodes.
    """
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT),
        ("human", "graph json: {graph_json}\nuser prompt: {new_prompt}"),
    ])

    response = _invoke_with_retry(
        prompt_template | llm_structured,
        {"new_prompt": new_prompt, "graph_json": graph_json},
        max_attempts=2,
    )
    new_graph = _sanitise_graph(response.graph_struct.model_dump())
    graph_append(thread_id, new_graph)
    return json.dumps(new_graph)


# ---------------------------------------------------------------------------
# Orchestrator LLM — plain chat model, no structured output
# ---------------------------------------------------------------------------

AGENT_SYSTEM_PROMPT = """
You are a technical system design architect assistant.
You help users query and evolve a system architecture that is stored in two forms:
  - A system description (plain text) — captures the high-level narrative of the architecture.
  - A system graph (JSON of nodes and edges) — captures the structural topology of the architecture.

You have exactly 4 tools. Always pick the most specific one:
  - description_question : answer READ-ONLY questions about the system description text
  - description_update   : MODIFY the system description based on user instructions (auto-saves)
  - graph_question       : answer READ-ONLY questions about the graph topology (nodes, edges)
  - graph_update         : MODIFY the graph structure based on user instructions (auto-saves)

Rules:
  - If the user asks a question → use a _question tool. Do NOT call an _update tool.
  - If the user asks for a change → use the appropriate _update tool.
  - If the request spans both description and graph (e.g. 'simplify the system and update the graph to match'), call both update tools in sequence — description first, then graph.
  - Never fabricate architecture details. Always rely on the tools to read the current state.
"""

_agent_boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

_agent_llm = ChatBedrockConverse(
    client=_agent_boto_client,
    region_name='us-east-1',
    model='global.anthropic.claude-haiku-4-5-20251001-v1:0',
    temperature=0.4,
)

# ---------------------------------------------------------------------------
# Agent — built once at module import, shared across all requests
# ---------------------------------------------------------------------------

_tools = [description_question, description_update, graph_question, graph_update]

# ---------------------------------------------------------------------------
# Persistent SQLite checkpointer — survives container restarts.
# CHECKPOINT_DB_PATH is set via .env; defaults to ./checkpoints.db locally.
# In Docker, mount a named volume at the parent directory so the file
# persists across container rebuilds.
# ---------------------------------------------------------------------------
_checkpoint_db_path = os.getenv("CHECKPOINT_DB_PATH", "checkpoints.db")
os.makedirs(os.path.dirname(os.path.abspath(_checkpoint_db_path)), exist_ok=True)

@asynccontextmanager
async def build_agent():
    async with AsyncSqliteSaver.from_conn_string(_checkpoint_db_path) as checkpointer:
        _agent = create_react_agent(
            model=_agent_llm,
            tools=_tools,
            prompt=AGENT_SYSTEM_PROMPT,
            checkpointer=checkpointer,
        )
        yield _agent, checkpointer

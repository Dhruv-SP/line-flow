import boto3
from langchain_aws import ChatBedrockConverse
from langchain_core.prompts import ChatPromptTemplate
import json
import os
from dotenv import load_dotenv
from typing_extensions import Annotated, TypedDict
from logger import get_logger

log = get_logger("util")

load_dotenv()

os.environ['AWS_ACCESS_KEY_ID'] = os.getenv("AWS_ACCESS_KEY_ID")
os.environ['AWS_SECRET_ACCESS_KEY'] = os.getenv("AWS_SECRET_ACCESS_KEY")
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'


def get_boto3_client(service_name: str, region_name: str):
    log.debug("get_boto3_client | creating client for service='%s' region='%s'", service_name, region_name)
    return boto3.client(service_name, region_name=region_name)


def close_boto3_client(client):
    log.debug("close_boto3_client | closing boto3 client")
    client.close()


async def get_description(system_desc: str):
    """
    Takes a system description and returns a detailed high-level design as plain text.
    Uses AWS Bedrock Llama 3.3 70B.
    """
    log.info("get_description | START | prompt_length=%d", len(system_desc))
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    llama_bedrock = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='us.meta.llama3-3-70b-instruct-v1:0',
        temperature=0.4,
        top_p=0.8,
    )

    SYS_PROMPT = """
    you are a technical system design architect. You will be given a system description and you have to provide a detailed high-level design of the entire system.
    If required, assume the appropriate attributes and components of the system. Format your response using Markdown: use headings, bullet points, and bold text where appropriate.
    """

    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT),
        ("human", "System description:\n{System_desc}"),
    ])

    invoke_chain = prompt_template | llama_bedrock
    log.info("get_description | invoking Llama 3.3 70B via Bedrock")
    response = await invoke_chain.ainvoke({"System_desc": system_desc})
    close_boto3_client(boto_client)
    usage = getattr(response, 'usage_metadata', None) or {}
    usage_dict = {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)}
    log.info("get_description | END | response_length=%d usage=%s", len(response.content), usage_dict)
    return response.content, usage_dict


class json_struct(TypedDict):
    graph_struct: Annotated[dict, ..., 'A JSON representing the graph structure']


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


async def get_graph_json_description(system_desc: str):
    """
    Takes a system description and returns a graph JSON with nodes and edges.
    Uses AWS Bedrock Claude Haiku with structured output.
    """
    log.info("get_graph_json_description | START | description_length=%d", len(system_desc))
    boto_client = get_boto3_client("bedrock-runtime", "us-east-1")

    claude_bedrock = ChatBedrockConverse(
        client=boto_client,
        region_name='us-east-1',
        model='global.anthropic.claude-haiku-4-5-20251001-v1:0',
        temperature=0.3
    )

    structured_claude = claude_bedrock.with_structured_output(json_struct, include_raw=True)

    SYS_PROMPT_2 = """
    You are provided with a system description. Generate a JSON representation of the entire process flow diagram for the system. 
    the JSON should include nodes and edges. The JSON should be structured as follows: 
    
    {{"nodes": [
            {{"data": {{"id": 1, "label": "person", "name": "User", "description": "sample description"}}}},
            {{"data": {{"id": 2, "label": "smartphone", "name": "Mobile App"}}}},
            {{"data": {{"id": 3, "label": "cloud", "name": "Backend"}}}}

        ],
        "edges": [
            {{"data": {{"id": 4, "label": "USES", "source": 1, "target": 2, "description": "sample description"}}}},
            {{"data": {{"id": 5, "label": "CONNECTS", "source": 2, "target": 3, "description": "sample description"}}}}
        ]}}

    Possible node labels are ONLY: flight, train, directions_car, place, flag, translate, alternate_email, email, chat, phone, wifi, router, cell_tower, language, credit_card, wallet, account_balance, sell, lock, key, badge, store, shopping_cart, local_shipping, business, inventory, person, group, smartphone, sim_card, laptop, monitor, storage, cloud, dns, description, folder, swap_horiz, link.
    Do NOT use any other label values for nodes. Never use "home" or any label not in the list above.
    Every node MUST have at least one edge connecting it to another node. Do not leave any node disconnected.
    Possible edge labels are: FOLLOWS, CONNECTS, USES, CONTAINS, STORES, READS, WRITES and so on.
    make sure the ID in the edges are unique and do not repeat the ID of the nodes.
    """

    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYS_PROMPT_2),
        ("human", "System description: {System_desc}"),
    ])

    invoke_chain = prompt_template | structured_claude

    log.info("get_graph_json_description | invoking Claude Haiku via Bedrock")
    while True:
        response = await invoke_chain.ainvoke({"System_desc": system_desc})
        parsed = response.get("parsed") if isinstance(response, dict) else None
        if parsed is not None and parsed.get('graph_struct') is not None:
            log.debug("get_graph_json_description | raw AI response received")
            break
        log.warning("get_graph_json_description | graph_struct was None, retrying")

    raw_msg = response.get("raw")
    usage = getattr(raw_msg, 'usage_metadata', None) or {}
    usage_dict = {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)}

    log.info("get_graph_json_description | parsing and normalising graph JSON")
    if type(parsed) != dict:
        parsed = json.loads(parsed)
    if type(parsed['graph_struct']) != dict:
        parsed['graph_struct'] = json.loads(parsed['graph_struct'].replace("'", '"'))
    if type(parsed['graph_struct']['nodes']) != list:
        parsed['graph_struct']['nodes'] = json.loads(parsed['graph_struct']['nodes'].replace("'", '"'))
    if type(parsed['graph_struct']['edges']) != list:
        parsed['graph_struct']['edges'] = json.loads(parsed['graph_struct']['edges'].replace("'", '"'))

    graph = _sanitise_graph(parsed['graph_struct'])
    node_count = len(graph.get('nodes', []))
    edge_count = len(graph.get('edges', []))
    log.info("get_graph_json_description | END | nodes=%d edges=%d usage=%s", node_count, edge_count, usage_dict)
    close_boto3_client(boto_client)
    return graph, usage_dict

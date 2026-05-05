// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type GraphNode = {
  data: {
    id: string;
    label: string;
    name: string;
    description?: string;
  };
};

export type GraphEdge = {
  data: {
    id: string;
    label: string;
    source: string;
    target: string;
  };
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: {
    description: string;
    graph: GraphData | null; // null = loading sentinel (description arrived, graph pending)
  };
};

export type Message = UserMessage | AssistantMessage;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type Session = {
  session_id: string;   // UUID, generated client-side
  first_prompt: string; // truncated label shown in sidebar
  messages: Message[];
  current_graph: GraphData | null;
  current_description: string | null;
  thread_id: string;    // UUID, same as session_id — used as LangGraph thread key
  initialized: boolean; // false until first turn completes
  created_at: number;   // Unix ms timestamp
  token_usage: TokenUsage;
};

export type Sessions = Record<string, Session>; // keyed by session_id

// ---------------------------------------------------------------------------
// Retry / error recovery
// ---------------------------------------------------------------------------

export type RetryStep = "description" | "graph" | "chat" | "corrupted" | "quota";

export type RetryContext = {
  step: RetryStep;
  prompt: string;
  description?: string; // only set when step="graph" (description succeeded, graph failed)
  message: string;      // user-facing error text
};

// ---------------------------------------------------------------------------
// Token usage / quota
// ---------------------------------------------------------------------------

export type DailyUsage = {
  date: string;  // ISO date string "YYYY-MM-DD"
  total: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export type Usage = {
  input_tokens: number;
  output_tokens: number;
};

export type TokenInitResponse = {
  total_tokens: number;
  token_limit: number;
  is_blocked: boolean;
  date: string;
};

export type GenerateDescriptionResponse = {
  description: string;
  usage: Usage;
  daily_total: number;
  is_blocked: boolean;
};

export type GenerateGraphResponse = {
  graph: GraphData;
  usage: Usage;
  daily_total: number;
  is_blocked: boolean;
};

export type ChatApiResponse = {
  response: string;
  graph: GraphData;
  description: string;
  usage: Usage;
  daily_total: number;
  is_blocked: boolean;
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthUser = {
  user_id: string;
  email: string;
  name: string;
};

// ---------------------------------------------------------------------------
// API error
// ---------------------------------------------------------------------------

export type ApiError = {
  status: number;
  message: string;
};

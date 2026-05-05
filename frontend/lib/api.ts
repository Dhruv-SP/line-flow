import type {
  TokenInitResponse,
  GenerateDescriptionResponse,
  GenerateGraphResponse,
  ChatApiResponse,
  ApiError,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  options: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.detail) message = body.detail;
    } catch {
      // ignore parse errors — use statusText
    }
    const err: ApiError = { status: res.status, message };
    throw err;
  }

  // DELETE /checkpoint returns 200 with no body
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function initTokens(params: {
  device_id: string;
  user_id?: string;
}): Promise<TokenInitResponse> {
  return apiFetch<TokenInitResponse>("/api/tokens/init", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function generateDescription(params: {
  prompt: string;
  device_id: string;
  thread_id: string;
  user_id?: string;
}): Promise<GenerateDescriptionResponse> {
  return apiFetch<GenerateDescriptionResponse>("/api/generate-description", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function generateGraph(params: {
  description: string;
  device_id: string;
  thread_id: string;
  user_id?: string;
}): Promise<GenerateGraphResponse> {
  return apiFetch<GenerateGraphResponse>("/api/generate-graph", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function chat(params: {
  prompt: string;
  thread_id: string;
  device_id: string;
  user_id?: string;
}): Promise<ChatApiResponse> {
  return apiFetch<ChatApiResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function deleteCheckpoint(thread_id: string): Promise<void> {
  return apiFetch<void>(`/api/chat/${encodeURIComponent(thread_id)}/checkpoint`, {
    method: "DELETE",
  });
}

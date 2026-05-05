"use client";

import { useReducer, useEffect, useCallback } from "react";
import type { Session, Sessions, Message, AssistantMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Initial session factory
// ---------------------------------------------------------------------------

function makeBlankSession(session_id: string): Session {
  return {
    session_id,
    first_prompt: "New Session",
    messages: [],
    current_graph: null,
    current_description: null,
    thread_id: session_id,
    initialized: false,
    created_at: Date.now(),
    token_usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function makeInitialState(): { sessions: Sessions; activeSessionId: string } {
  const id = crypto.randomUUID();
  return {
    sessions: { [id]: makeBlankSession(id) },
    activeSessionId: id,
  };
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

type Action =
  | { type: "CREATE_SESSION"; payload: { session_id: string; thread_id: string } }
  | { type: "SET_ACTIVE"; payload: { session_id: string } }
  | { type: "UPDATE_SESSION"; payload: { session_id: string; updates: Partial<Session> } }
  | { type: "HYDRATE"; payload: Sessions }
  | {
      type: "PATCH_LAST_MESSAGE";
      payload: { session_id: string; updates: Partial<AssistantMessage["content"]> };
    };

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

type State = {
  sessions: Sessions;
  activeSessionId: string;
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CREATE_SESSION": {
      const { session_id, thread_id } = action.payload;
      const newSession: Session = {
        ...makeBlankSession(session_id),
        thread_id,
      };
      return {
        ...state,
        sessions: { ...state.sessions, [session_id]: newSession },
      };
    }

    case "SET_ACTIVE": {
      return { ...state, activeSessionId: action.payload.session_id };
    }

    case "UPDATE_SESSION": {
      const { session_id, updates } = action.payload;
      const existing = state.sessions[session_id];
      if (!existing) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [session_id]: { ...existing, ...updates },
        },
      };
    }

    case "HYDRATE": {
      const hydratedSessions = action.payload;
      // Preserve activeSessionId if it still exists in hydrated data, otherwise pick first
      const ids = Object.keys(hydratedSessions);
      const activeId =
        state.activeSessionId in hydratedSessions
          ? state.activeSessionId
          : ids[0] ?? state.activeSessionId;
      return { sessions: hydratedSessions, activeSessionId: activeId };
    }

    case "PATCH_LAST_MESSAGE": {
      const { session_id, updates } = action.payload;
      const session = state.sessions[session_id];
      if (!session) return state;

      const messages = [...session.messages];
      // Find last assistant message
      let lastAssistantIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx === -1) return state;

      const lastMsg = messages[lastAssistantIdx] as AssistantMessage;
      messages[lastAssistantIdx] = {
        ...lastMsg,
        content: { ...lastMsg.content, ...updates },
      };

      return {
        ...state,
        sessions: {
          ...state.sessions,
          [session_id]: { ...session, messages },
        },
      };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessions() {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sf_sessions");
      if (raw) {
        const parsed: Sessions = JSON.parse(raw);
        // Basic validation: must be a non-empty object
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          dispatch({ type: "HYDRATE", payload: parsed });
        }
      }
    } catch {
      // Corrupted localStorage — keep initial blank session
    }
  }, []);

  // Persist to localStorage whenever sessions change
  useEffect(() => {
    try {
      localStorage.setItem("sf_sessions", JSON.stringify(state.sessions));
    } catch {
      // Storage quota exceeded or unavailable — ignore
    }
  }, [state.sessions]);

  // Convenience helper: create a new session and make it active
  const createSession = useCallback(() => {
    const session_id = crypto.randomUUID();
    dispatch({ type: "CREATE_SESSION", payload: { session_id, thread_id: session_id } });
    dispatch({ type: "SET_ACTIVE", payload: { session_id } });
    return session_id;
  }, []);

  // Append a message to a session
  const appendMessage = useCallback(
    (session_id: string, message: Message) => {
      const session = state.sessions[session_id];
      if (!session) return;
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          session_id,
          updates: { messages: [...session.messages, message] },
        },
      });
    },
    [state.sessions]
  );

  return {
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    activeSession: state.sessions[state.activeSessionId] ?? null,
    dispatch,
    createSession,
    appendMessage,
  };
}

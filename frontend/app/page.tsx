"use client";

import { useState, useEffect, useRef } from "react";
import { useDeviceId } from "@/hooks/useDeviceId";
import { useSessions } from "@/hooks/useSessions";
import { useTokenUsage } from "@/hooks/useTokenUsage";
import { useAuth } from "@/hooks/useAuth";
import { initTokens, generateDescription, generateGraph, chat, deleteCheckpoint } from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import AppShell from "@/components/AppShell";
import AuthPanel from "@/components/AuthPanel";
import type { RetryContext, ApiError, Session } from "@/lib/types";

export default function Page() {
  const { deviceId } = useDeviceId();
  const { sessions, activeSessionId, activeSession, dispatch, createSession } = useSessions();
  const { dailyUsage, isBlocked, addUsage, setUsageFromServer } = useTokenUsage();
  const { user, isAuthLoading, login, logout } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [retryContext, setRetryContext] = useState<RetryContext | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Keep a ref to the latest sessions so the hydration effect can read them
  // without adding `sessions` as a dependency (which would re-run on every message).
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Ref to prevent running cloud hydration more than once per user_id
  const hydratedUserIdRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // 4.1 — Startup: init token quota from server (guest mode)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!deviceId) return;
    initTokens({ device_id: deviceId })
      .then(setUsageFromServer)
      .catch(() => {
        // Silently ignore — default quota (100k) applies
      });
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // 7.5 — Cloud hydration at login
  // Runs once per user_id whenever the auth state resolves to a logged-in user.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user || !deviceId) return;
    if (hydratedUserIdRef.current === user.user_id) return; // already done
    hydratedUserIdRef.current = user.user_id;

    async function hydrateFromCloud() {
      // 1. Push any local (guest) sessions to the cloud so they aren't lost
      try {
        await fetch("/api/sessions/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessions: sessionsRef.current }),
        });
      } catch { /* non-fatal */ }

      // 2. Merge today's guest token usage into the user's account
      try {
        await fetch("/api/auth/merge-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        });
      } catch { /* non-fatal */ }

      // 3. Fetch authoritative sessions from the cloud and replace local state
      try {
        const res = await fetch("/api/sessions");
        if (res.ok) {
          const data = await res.json() as { sessions: import("@/lib/types").Sessions };
          if (data.sessions && Object.keys(data.sessions).length > 0) {
            dispatch({ type: "HYDRATE", payload: data.sessions });
          }
        }
      } catch { /* keep local sessions */ }

      // 4. Re-init token quota using the user's record (reflects merged total)
      try {
        const result = await initTokens({ device_id: deviceId!, user_id: user!.user_id });
        setUsageFromServer(result);
      } catch { /* keep current quota */ }
    }

    hydrateFromCloud();
  }, [user, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** 7.6 — Fire-and-forget cloud save. Only runs for authenticated users. */
  function saveSessionToCloud(session: Session) {
    if (!user) return; // guest mode — skip
    fetch(`/api/sessions/${encodeURIComponent(session.session_id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_data: session }),
    }).catch(() => { /* non-fatal — localStorage remains the source of truth */ });
  }

  function errorMessageForStatus(status: number): string {
    if (status === 400) return "Invalid request.";
    if (status === 401) return "Session expired. Please log in again.";
    if (status === 429) return "Daily token limit reached.";
    if (status === 502) return "AI service unavailable. Please try again.";
    if (status === 503) return "Service temporarily unavailable.";
    return "Something went wrong. Please try again.";
  }

  // ---------------------------------------------------------------------------
  // 4.2 — First Turn Flow
  // ---------------------------------------------------------------------------

  async function handleFirstTurn(prompt: string) {
    if (!activeSession || !deviceId) return;
    const { session_id, thread_id } = activeSession;

    // Append user message
    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        session_id,
        updates: {
          messages: [
            ...activeSession.messages,
            { role: "user", content: prompt },
          ],
        },
      },
    });

    setIsLoading(true);
    setRetryContext(null);

    // ---- Description step ----
    let description: string;

    if (retryContext?.step === "graph" && retryContext.description) {
      // Retrying after graph failure — reuse existing description
      description = retryContext.description;
    } else {
      try {
        const res = await generateDescription({ prompt, device_id: deviceId, thread_id });
        addUsage(res.usage.input_tokens + res.usage.output_tokens);

        if (res.is_blocked) {
          setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
          setIsLoading(false);
          return;
        }

        description = res.description;
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 429) {
          setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
        } else {
          setRetryContext({ step: "description", prompt, message: errorMessageForStatus(apiErr.status) });
        }
        setIsLoading(false);
        return;
      }

      // Append assistant message with description; graph: null = loading sentinel
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          session_id,
          updates: {
            messages: [
              ...activeSession.messages,
              { role: "user", content: prompt },
              { role: "assistant", content: { description, graph: null } },
            ],
          },
        },
      });
    }

    // Description visible — switch to graph loading
    setIsLoading(false);
    setIsGraphLoading(true);

    // ---- Graph step ----
    try {
      const res = await generateGraph({ description, device_id: deviceId, thread_id });
      addUsage(res.usage.input_tokens + res.usage.output_tokens);

      if (res.is_blocked) {
        setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
        setIsGraphLoading(false);
        return;
      }

      const graph = res.graph;

      // Patch last assistant message: graph null → graph
      dispatch({ type: "PATCH_LAST_MESSAGE", payload: { session_id, updates: { graph } } });

      // Mark session initialized
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          session_id,
          updates: {
            initialized: true,
            current_graph: graph,
            current_description: description,
            first_prompt: prompt.slice(0, 60),
          },
        },
      });

      // 7.6 — Cloud save: build complete final session state and push to DynamoDB
      saveSessionToCloud({
        ...activeSession,
        messages: [
          ...activeSession.messages,
          { role: "user" as const, content: prompt },
          { role: "assistant" as const, content: { description, graph } },
        ],
        initialized: true,
        current_graph: graph,
        current_description: description,
        first_prompt: prompt.slice(0, 60),
      });

      setRetryContext(null);
    } catch (err) {
      const apiErr = err as ApiError;
      setRetryContext({
        step: "graph",
        prompt,
        description,
        message: errorMessageForStatus(apiErr.status),
      });
    }

    setIsGraphLoading(false);
  }

  // ---------------------------------------------------------------------------
  // 4.3 — Follow-Up Turn Flow
  // ---------------------------------------------------------------------------

  async function handleFollowUp(prompt: string) {
    if (!activeSession || !deviceId) return;
    const { session_id, thread_id } = activeSession;

    // Append user message
    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        session_id,
        updates: {
          messages: [...activeSession.messages, { role: "user", content: prompt }],
        },
      },
    });

    setIsLoading(true);
    setRetryContext(null);

    let result: Awaited<ReturnType<typeof chat>>;

    try {
      result = await chat({ prompt, thread_id, device_id: deviceId });
    } catch (err) {
      const apiErr = err as ApiError;

      if (apiErr.status === 409) {
        // Corrupted LangGraph checkpoint — attempt auto-recovery
        try {
          await deleteCheckpoint(thread_id);
          result = await chat({ prompt, thread_id, device_id: deviceId });
        } catch {
          setRetryContext({
            step: "corrupted",
            prompt,
            message: "Conversation state corrupted. Start a new session.",
          });
          setIsLoading(false);
          return;
        }
      } else if (apiErr.status === 429) {
        setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
        setIsLoading(false);
        return;
      } else {
        setRetryContext({ step: "chat", prompt, message: errorMessageForStatus(apiErr.status) });
        setIsLoading(false);
        return;
      }
    }

    // Success
    addUsage(result!.usage.input_tokens + result!.usage.output_tokens);

    if (result!.is_blocked) {
      setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
      setIsLoading(false);
      return;
    }

    const updatedMessages = [
      ...activeSession.messages,
      { role: "user" as const, content: prompt },
      { role: "assistant" as const, content: { description: result!.response, graph: result!.graph } },
    ];

    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        session_id,
        updates: {
          messages: updatedMessages,
          current_graph: result!.graph,
          current_description: result!.description || null,
        },
      },
    });

    // 7.6 — Cloud save
    saveSessionToCloud({
      ...activeSession,
      messages: updatedMessages,
      current_graph: result!.graph,
      current_description: result!.description || null,
    });

    setIsLoading(false);
    setRetryContext(null);
  }

  // ---------------------------------------------------------------------------
  // 4.4 — handleSubmit
  // ---------------------------------------------------------------------------

  function handleSubmit() {
    const prompt = inputValue.trim();

    // Guards
    if (!deviceId) return; // fingerprint not ready yet
    if (!prompt) return;   // empty input (button already disabled, but defensive)

    if (isBlocked) {
      setRetryContext({ step: "quota", prompt, message: "Daily token limit reached." });
      return;
    }

    setInputValue("");
    setRetryContext(null);

    if (!activeSession?.initialized) {
      handleFirstTurn(prompt);
    } else {
      handleFollowUp(prompt);
    }
  }

  // ---------------------------------------------------------------------------
  // 4.5 — handleRetry
  // ---------------------------------------------------------------------------

  function handleRetry() {
    if (!retryContext) return;

    if (retryContext.step === "description" || retryContext.step === "graph") {
      // handleFirstTurn detects step="graph" internally and skips description call
      handleFirstTurn(retryContext.prompt);
    } else if (retryContext.step === "chat") {
      handleFollowUp(retryContext.prompt);
    }
    // "corrupted" and "quota" have no Retry button — handled by RetryBanner
  }

  function handleNewSession() {
    createSession();
    setIsLoading(false);
    setIsGraphLoading(false);
    setRetryContext(null);
  }

  function handleSelectSession(sessionId: string) {
    dispatch({ type: "SET_ACTIVE", payload: { session_id: sessionId } });
    setIsLoading(false);
    setIsGraphLoading(false);
    setRetryContext(null);
  }

  function handleSelectPrompt(prompt: string) {
    setInputValue(prompt);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-full bg-gray-950 text-gray-100">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        dailyUsage={dailyUsage}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        authSlot={
          <AuthPanel
            user={user}
            isAuthLoading={isAuthLoading}
            activeSessionId={activeSessionId}
            onLogin={login}
            onLogout={logout}
          />
        }
      />
      <main className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile top bar — hamburger */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 md:hidden">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Open sidebar"
          >
            <span className="material-icons text-[24px]">menu</span>
          </button>
          <span className="text-sm font-semibold text-gray-100 tracking-tight">SystemFlow</span>
        </div>
        <div className="flex flex-1 overflow-hidden">
        <AppShell
          activeSession={activeSession}
          isLoading={isLoading || isGraphLoading}
          retryContext={retryContext}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={handleSubmit}
          onRetry={handleRetry}
          onNewSession={handleNewSession}
          onSelectPrompt={handleSelectPrompt}
        />
        </div>
      </main>
    </div>
  );
}

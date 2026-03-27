"use client";

import { useEffect, useRef } from "react";
import { createEventsClient, type WsClient } from "@/lib/ws-client";
import { getWsTokenProvider } from "@/lib/ws-auth";
import { useStore } from "./use-store";

export function useGlobalWebSocket() {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const client = createEventsClient(getWsTokenProvider());
    clientRef.current = client;
    client.connect();

    client.on("task:state_changed", (event) => {
      useStore
        .getState()
        .updateTask(event.taskId, { state: event.toState, updatedAt: event.timestamp });

      if (["needs_attention", "pr_opened", "completed", "failed"].includes(event.toState)) {
        useStore.getState().addNotification({
          id: crypto.randomUUID(),
          type:
            event.toState === "completed" || event.toState === "pr_opened"
              ? "success"
              : event.toState === "failed"
                ? "error"
                : "warning",
          title: `Task ${event.toState.replace("_", " ")}`,
          message: `Task moved to ${event.toState}`,
          taskId: event.taskId,
          timestamp: event.timestamp,
        });

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`Optio: Task ${event.toState.replace("_", " ")}`, {
            body: `Task moved to ${event.toState}`,
          });
        }
      }
    });

    client.on("auth:failed", (event) => {
      useStore.getState().addNotification({
        id: "auth-failed",
        type: "error",
        title: "Authentication Failed",
        message:
          event.message ||
          "Claude Code OAuth token has expired. Run 'claude auth login' to re-authenticate.",
        timestamp: event.timestamp,
      });

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Optio: Authentication Failed", {
          body: "Claude Code OAuth token expired — tasks will fail until re-authenticated.",
        });
      }
    });

    client.on("task:pending_reason", (event) => {
      useStore
        .getState()
        .updateTask(event.taskId, { pendingReason: event.data?.pendingReason ?? null });
    });

    client.on("task:created", (event) => {
      useStore.getState().addTask({
        id: event.taskId,
        title: event.title,
        state: "pending",
        agentType: "",
        repoUrl: "",
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      });
    });

    return () => {
      client.disconnect();
    };
  }, []); // stable — uses getState() instead of hook selectors
}

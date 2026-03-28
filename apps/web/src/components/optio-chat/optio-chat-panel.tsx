"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { X, Send, RotateCcw, Bot, User, Loader2, AlertTriangle, Info } from "lucide-react";
import { ActionConfirmation } from "./action-confirmation.js";
import { useOptioChatStore, MAX_EXCHANGES, type OptioChatMessage } from "./optio-chat-store.js";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function OptioChatPanel() {
  const {
    isOpen,
    messages,
    status,
    prefill,
    exchangeCount,
    closePanel,
    addMessage,
    updateMessage,
    setStatus,
    setPrefill,
    resetConversation,
    incrementExchangeCount,
  } = useOptioChatStore();

  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const prevPathname = useRef(pathname);

  // Reset conversation on page navigation
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      resetConversation();
      wsRef.current?.close();
      wsRef.current = null;
    }
    prevPathname.current = pathname;
  }, [pathname, resetConversation]);

  // Apply prefill to input
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      setPrefill("");
      inputRef.current?.focus();
    }
  }, [prefill, setPrefill]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Connect to WebSocket
  const ensureConnection = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return;

    setStatus("connecting");
    const ws = new WebSocket(`${WS_URL}/ws/optio/chat`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("ready");
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "status":
          setStatus(msg.status);
          break;

        case "message": {
          const assistantMsg: OptioChatMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: msg.content,
            timestamp: new Date().toISOString(),
            actionProposal: msg.actionProposal
              ? {
                  ...msg.actionProposal,
                  id: msg.actionProposal.id ?? `proposal-${Date.now()}`,
                  status: "pending",
                }
              : undefined,
          };
          addMessage(assistantMsg);
          incrementExchangeCount();
          setStatus("ready");
          break;
        }

        case "action_result": {
          const resultMsg: OptioChatMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: msg.content,
            timestamp: new Date().toISOString(),
          };
          addMessage(resultMsg);
          setStatus("ready");
          break;
        }

        case "error":
          setStatus("error");
          const errorMsg: OptioChatMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: msg.message ?? "Something went wrong. Please try again.",
            timestamp: new Date().toISOString(),
          };
          addMessage(errorMsg);
          break;
      }
    };

    ws.onclose = () => {
      setStatus("ready");
      wsRef.current = null;
    };

    ws.onerror = () => {
      setStatus("unavailable");
      wsRef.current = null;
    };
  }, [setStatus, addMessage, incrementExchangeCount]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closePanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closePanel]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || status === "thinking") return;

    if (exchangeCount >= MAX_EXCHANGES) return;

    ensureConnection();

    const userMsg: OptioChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);
    incrementExchangeCount();
    setStatus("thinking");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    }

    setInput("");
  };

  const handleApprove = (proposalId: string) => {
    // Update the proposal status in the message
    const msg = messages.find((m) => m.actionProposal?.id === proposalId);
    if (msg) {
      updateMessage(msg.id, {
        actionProposal: { ...msg.actionProposal!, status: "approved" },
      });
    }

    setStatus("thinking");
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "approve", proposalId }));
    }
  };

  const handleDeny = (proposalId: string, feedback: string) => {
    const msg = messages.find((m) => m.actionProposal?.id === proposalId);
    if (msg) {
      updateMessage(msg.id, {
        actionProposal: { ...msg.actionProposal!, status: "denied", feedback },
      });
    }

    setStatus("thinking");
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "deny", proposalId, feedback }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const atLimit = exchangeCount >= MAX_EXCHANGES;

  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] optio-panel-backdrop"
          onClick={closePanel}
        />
      )}

      {/* Slide-out panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-[420px] max-w-full flex flex-col",
          "bg-bg border-l border-border shadow-2xl",
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-bg-card">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="font-semibold text-sm">Optio</span>
              <span className="ml-2 text-[10px] text-text-muted">
                {status === "thinking"
                  ? "Thinking..."
                  : status === "unavailable"
                    ? "Unavailable"
                    : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={resetConversation}
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted transition-colors"
              title="Reset conversation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closePanel}
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Session ephemeral indicator */}
        <div className="shrink-0 px-4 py-1.5 bg-bg-subtle/50 border-b border-border/50 flex items-center gap-1.5">
          <Info className="w-3 h-3 text-text-muted/50" />
          <span className="text-[10px] text-text-muted/50">Session resets on page change</span>
        </div>

        {/* Unavailable state */}
        {status === "unavailable" ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-warning/60" />
              <p className="text-sm font-medium text-text-muted">Optio is unavailable</p>
              <p className="text-xs text-text-muted/60 mt-1 max-w-xs">
                The Optio chat backend is not running. Check that the WebSocket endpoint is
                configured.
              </p>
              <button
                onClick={() => {
                  setStatus("ready");
                  ensureConnection();
                }}
                className="mt-4 px-3 py-1.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Retry connection
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-text-muted">
                  <div className="text-center">
                    <Bot className="w-8 h-8 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Ask Optio anything</p>
                    <p className="text-xs mt-1 max-w-[260px] text-text-muted/60">
                      Retry failed tasks, update repo settings, check status, or get help debugging.
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "")}
                >
                  {msg.role === "assistant" && (
                    <div className="shrink-0 mt-1">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      </div>
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%]",
                      msg.role === "user"
                        ? "bg-primary/10 border border-primary/20 rounded-lg px-3.5 py-2"
                        : "space-y-2 min-w-0",
                    )}
                  >
                    {msg.actionProposal ? (
                      <ActionConfirmation
                        proposal={msg.actionProposal}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                      />
                    ) : (
                      <div className="text-sm whitespace-pre-wrap leading-relaxed optio-chat-markdown">
                        {msg.content}
                      </div>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="shrink-0 mt-1">
                      <div className="w-6 h-6 rounded-full bg-bg-card border border-border flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-text-muted" />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {status === "thinking" && (
                <div className="flex gap-2.5">
                  <div className="shrink-0 mt-1">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary animate-pulse" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}

              {/* Exchange limit warning */}
              {atLimit && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-xs text-warning">
                    This conversation is getting long. Start a fresh one?
                  </p>
                  <button
                    onClick={resetConversation}
                    className="px-3 py-1.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    Reset conversation
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-border px-4 py-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      atLimit
                        ? "Conversation limit reached"
                        : status === "thinking"
                          ? "Optio is thinking..."
                          : "Ask Optio..."
                    }
                    disabled={atLimit}
                    rows={1}
                    className={cn(
                      "w-full resize-none rounded-lg border border-border bg-bg-card px-3 py-2.5 text-sm",
                      "placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      "min-h-[40px] max-h-[100px]",
                    )}
                    style={{ height: "auto" }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = "auto";
                      target.style.height = `${Math.min(target.scrollHeight, 100)}px`;
                    }}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || status === "thinking" || atLimit}
                  className={cn(
                    "shrink-0 p-2.5 rounded-lg transition-colors",
                    input.trim() && status !== "thinking"
                      ? "bg-primary text-white hover:bg-primary/90"
                      : "bg-bg-card text-text-muted border border-border",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                  title="Send (Enter)"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-text-muted/50">
                  Enter to send, Shift+Enter for new line
                </span>
                <span className="text-[10px] text-text-muted/50">
                  {exchangeCount}/{MAX_EXCHANGES}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

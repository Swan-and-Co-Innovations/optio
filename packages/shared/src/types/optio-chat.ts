/** Action proposal from the Optio chat agent */
export interface OptioChatActionProposal {
  description: string;
  details: string;
}

/** Conversation message sent as context with each request */
export interface OptioChatConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** Client → Server messages for the Optio chat WebSocket */
export type OptioChatClientMessage =
  | { type: "message"; content: string; conversationContext?: OptioChatConversationMessage[] }
  | { type: "approve" }
  | { type: "decline" }
  | { type: "interrupt" };

/** Server → Client messages for the Optio chat WebSocket */
export type OptioChatServerMessage =
  | { type: "text"; content: string }
  | { type: "chat_event"; event: OptioChatEvent }
  | { type: "action_proposal"; actions: OptioChatActionProposal[] }
  | { type: "action_result"; success: boolean; summary: string }
  | { type: "error"; message: string }
  | { type: "status"; status: OptioChatStatus };

export type OptioChatStatus = "ready" | "thinking" | "executing" | "waiting_for_approval" | "idle";

export interface OptioChatEvent {
  taskId: string;
  timestamp: string;
  sessionId?: string;
  type: "text" | "tool_use" | "tool_result" | "thinking" | "system" | "error" | "info";
  content: string;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    cost?: number;
    turns?: number;
    durationMs?: number;
    [key: string]: unknown;
  };
}

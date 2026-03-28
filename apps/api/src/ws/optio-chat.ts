import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "child_process";
import { authenticateWs } from "./ws-auth.js";
import { logger } from "../logger.js";
import { parseClaudeEvent } from "../services/agent-event-parser.js";
import {
  buildSystemPrompt,
  getSystemStatus,
  isUserActive,
  setUserActive,
  parseActionProposals,
} from "../services/optio-chat-service.js";

/**
 * Optio chat WebSocket handler.
 *
 * Provides a conversational interface to the Optio system. Each user message
 * spawns a new `claude -p` invocation with conversation context. Write operations
 * require explicit user approval via an action proposal flow.
 *
 * Route: WS /ws/optio/chat
 *
 * Client → Server messages:
 *   { type: "message", content: string, conversationContext?: ConversationMessage[] }
 *   { type: "approve" }   — approve a pending action proposal
 *   { type: "decline" }   — decline a pending action proposal
 *   { type: "interrupt" } — cancel the current agent invocation
 *
 * Server → Client messages:
 *   { type: "text", content: string }
 *   { type: "action_proposal", actions: ActionProposal[] }
 *   { type: "action_result", success: boolean, summary: string }
 *   { type: "error", message: string }
 *   { type: "status", status: "thinking" | "executing" | "waiting_for_approval" }
 */
export async function optioChatWs(app: FastifyInstance) {
  app.get("/ws/optio/chat", { websocket: true }, async (socket, req) => {
    const log = logger.child({ ws: "optio-chat" });

    // Authenticate
    const user = await authenticateWs(socket, req);
    if (!user) return;

    const userId = user.id;
    log.info({ userId }, "Optio chat connected");

    // Enforce one active conversation per user
    if (isUserActive(userId)) {
      send({
        type: "error",
        message: "You already have an active Optio conversation. Close the other one first.",
      });
      socket.close(4409, "Concurrent conversation");
      return;
    }

    setUserActive(userId, true);

    let childProc: ChildProcess | null = null;
    let isProcessing = false;
    let outputBuffer = "";
    let pendingProposal: {
      actions: { description: string; details: string }[];
      context: ConversationMessage[];
    } | null = null;

    function send(msg: Record<string, unknown>) {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(msg));
      }
    }

    // Resolve auth env vars for the claude process
    const authEnv = await buildAuthEnv(log);

    // Resolve the internal API base URL for agent curl calls
    const apiPort = process.env.PORT ?? process.env.API_PORT ?? "4000";
    const apiBaseUrl = `http://localhost:${apiPort}`;

    send({ type: "status", status: "ready" as string });

    /**
     * Execute a single claude prompt. Each user message (or approval) triggers
     * a new invocation — there is no persistent agent process.
     */
    async function runPrompt(prompt: string, conversationContext: ConversationMessage[]) {
      if (isProcessing) {
        send({ type: "error", message: "Agent is already processing a request" });
        return;
      }

      isProcessing = true;
      send({ type: "status", status: "thinking" });

      try {
        // Fetch live system status for the prompt
        const status = await getSystemStatus();
        const systemPrompt = buildSystemPrompt(status, apiBaseUrl);

        // Build the full prompt with conversation context
        const fullPrompt = buildFullPrompt(systemPrompt, conversationContext, prompt);

        const args = [
          "-p",
          fullPrompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
          "--max-turns",
          "20",
        ];

        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          ...authEnv,
          // Suppress interactive prompts
          CI: "true",
        };

        childProc = spawn("claude", args, {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let accumulatedText = "";

        childProc.stdout!.on("data", (chunk: Buffer) => {
          outputBuffer += chunk.toString("utf-8");

          const lines = outputBuffer.split("\n");
          outputBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            const { entries } = parseClaudeEvent(line, "optio-chat");

            for (const entry of entries) {
              if (entry.type === "text") {
                accumulatedText += entry.content;
              }
              // Forward all events as chat_event for full transparency
              send({ type: "chat_event", event: entry });
            }
          }
        });

        childProc.stderr!.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8").trim();
          if (text) {
            log.warn({ stderr: text }, "Claude stderr");
          }
        });

        // Wait for process to exit
        await new Promise<void>((resolve) => {
          childProc!.on("close", () => {
            // Process remaining buffer
            if (outputBuffer.trim()) {
              const { entries } = parseClaudeEvent(outputBuffer, "optio-chat");
              for (const entry of entries) {
                if (entry.type === "text") {
                  accumulatedText += entry.content;
                }
                send({ type: "chat_event", event: entry });
              }
              outputBuffer = "";
            }
            resolve();
          });
        });

        // Check for action proposals in accumulated text
        const { proposals, cleanText } = parseActionProposals(accumulatedText);
        if (proposals.length > 0) {
          // Store the pending proposal for approve/decline flow
          pendingProposal = { actions: proposals, context: conversationContext };

          // Send the clean text first (if any)
          if (cleanText.trim()) {
            send({ type: "text", content: cleanText });
          }

          // Send the action proposal
          send({ type: "action_proposal", actions: proposals });
          send({ type: "status", status: "waiting_for_approval" });
        } else {
          // No proposals — send final text if we haven't been streaming it
          if (accumulatedText.trim()) {
            send({ type: "text", content: accumulatedText });
          }
        }
      } catch (err) {
        log.error({ err }, "Failed to run Optio chat prompt");
        const message =
          err instanceof Error && err.message.includes("ENOENT")
            ? "Optio is starting up — the claude CLI is not available. Try again in a moment."
            : "Failed to execute agent prompt";
        send({ type: "error", message });
      } finally {
        isProcessing = false;
        childProc = null;
        if (!pendingProposal) {
          send({ type: "status", status: "idle" as string });
        }
      }
    }

    // Handle incoming messages
    socket.on("message", (data: Buffer | string) => {
      const str = typeof data === "string" ? data : data.toString("utf-8");

      let msg: {
        type: string;
        content?: string;
        conversationContext?: ConversationMessage[];
      };
      try {
        msg = JSON.parse(str);
      } catch {
        send({ type: "error", message: "Invalid JSON message" });
        return;
      }

      switch (msg.type) {
        case "message": {
          if (!msg.content?.trim()) {
            send({ type: "error", message: "Empty message" });
            return;
          }
          // Clear any pending proposal when new message arrives
          pendingProposal = null;
          const ctx = (msg.conversationContext ?? []).slice(-20); // cap at 20 exchanges
          runPrompt(msg.content, ctx).catch((err) => {
            log.error({ err }, "Prompt execution failed");
            send({ type: "error", message: "Prompt failed" });
          });
          break;
        }

        case "approve": {
          if (!pendingProposal) {
            send({ type: "error", message: "No pending action to approve" });
            return;
          }
          const proposal = pendingProposal;
          pendingProposal = null;
          send({ type: "status", status: "executing" });

          const actionSummary = proposal.actions
            .map((a) => `- ${a.description}: ${a.details}`)
            .join("\n");

          // Build a new conversation context with the approval
          const approvalContext: ConversationMessage[] = [
            ...proposal.context,
            {
              role: "assistant",
              content: `I proposed these actions:\n${actionSummary}`,
            },
            { role: "user", content: "Approved. Please execute these actions now." },
          ];

          runPrompt(
            "The user approved the proposed actions. Execute them now using curl against the API.",
            approvalContext,
          ).catch((err) => {
            log.error({ err }, "Approval execution failed");
            send({ type: "error", message: "Failed to execute approved actions" });
          });
          break;
        }

        case "decline": {
          if (!pendingProposal) {
            send({ type: "error", message: "No pending action to decline" });
            return;
          }
          const proposal = pendingProposal;
          pendingProposal = null;

          const declinedSummary = proposal.actions.map((a) => `- ${a.description}`).join("\n");

          const declineContext: ConversationMessage[] = [
            ...proposal.context,
            {
              role: "assistant",
              content: `I proposed these actions:\n${declinedSummary}`,
            },
            {
              role: "user",
              content: "I declined these actions. What would you like to change?",
            },
          ];

          runPrompt(
            "The user declined the proposed actions. Ask what they would like to change.",
            declineContext,
          ).catch((err) => {
            log.error({ err }, "Decline follow-up failed");
            send({ type: "error", message: "Failed to handle decline" });
          });
          break;
        }

        case "interrupt": {
          if (childProc) {
            log.info("Interrupting Optio chat agent");
            childProc.kill("SIGTERM");
            childProc = null;
            isProcessing = false;
            outputBuffer = "";
            pendingProposal = null;
            send({ type: "status", status: "idle" as string });
          }
          break;
        }

        default:
          send({ type: "error", message: `Unknown message type: ${msg.type}` });
      }
    });

    socket.on("close", () => {
      log.info({ userId }, "Optio chat disconnected");
      setUserActive(userId, false);
      if (childProc) {
        childProc.kill("SIGTERM");
        childProc = null;
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build the full prompt string from system prompt, conversation history, and
 * the current user message.
 */
function buildFullPrompt(
  systemPrompt: string,
  conversationContext: ConversationMessage[],
  currentMessage: string,
): string {
  const parts: string[] = [systemPrompt];

  if (conversationContext.length > 0) {
    parts.push("\n## Conversation History\n");
    for (const msg of conversationContext) {
      const role = msg.role === "user" ? "User" : "Assistant";
      parts.push(`${role}: ${msg.content}`);
    }
  }

  parts.push(`\n## Current Request\n\nUser: ${currentMessage}`);

  return parts.join("\n");
}

/**
 * Build auth environment variables for the claude process.
 * Reuses the same logic as session-chat.ts.
 */
async function buildAuthEnv(log: {
  warn: (obj: any, msg: string) => void;
}): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  try {
    const { retrieveSecret } = await import("../services/secret-service.js");
    const authMode = (await retrieveSecret("CLAUDE_AUTH_MODE").catch(() => null)) as string | null;

    if (authMode === "api-key") {
      const apiKey = await retrieveSecret("ANTHROPIC_API_KEY").catch(() => null);
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey as string;
      }
    } else if (authMode === "max-subscription") {
      const { getClaudeAuthToken } = await import("../services/auth-service.js");
      const result = getClaudeAuthToken();
      if (result.available && result.token) {
        env.CLAUDE_CODE_OAUTH_TOKEN = result.token;
      }
    } else if (authMode === "oauth-token") {
      const token = await retrieveSecret("CLAUDE_CODE_OAUTH_TOKEN").catch(() => null);
      if (token) {
        env.CLAUDE_CODE_OAUTH_TOKEN = token as string;
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to build auth env for Optio chat");
  }

  return env;
}

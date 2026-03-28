import type { FastifyInstance } from "fastify";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { getRuntime } from "../services/container-service.js";
import { getSettings } from "../services/optio-settings-service.js";
import { parseClaudeEvent } from "../services/agent-event-parser.js";
import { authenticateWs } from "./ws-auth.js";
import { logger } from "../logger.js";
import { OPTIO_TOOL_CATEGORIES, type OptioToolDefinition } from "@optio/shared";
import type { ExecSession } from "@optio/shared";

const NAMESPACE = "optio";
const POD_ROLE_LABEL = "optio.pod-role=optio";

// ─── Per-user concurrency tracking ───

/** Map of userId → active WebSocket (only one active conversation per user). */
const activeConnections = new Map<string, WebSocket>();

/** @internal Reset active connections — only for tests. */
export function _resetActiveConnections(): void {
  activeConnections.clear();
}

// ─── Optio pod discovery ───

let cachedPod: { ready: boolean; podName: string | null } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

/** @internal Reset the pod cache — only for tests. */
export function _resetPodCache(): void {
  cachedPod = null;
  cachedAt = 0;
}

function getK8sApi(): CoreV1Api {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc.makeApiClient(CoreV1Api);
}

async function findOptioPod(): Promise<{ ready: boolean; podName: string | null }> {
  const now = Date.now();
  if (cachedPod && now - cachedAt < CACHE_TTL_MS) {
    return cachedPod;
  }

  try {
    const k8s = getK8sApi();
    const res = await k8s.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: POD_ROLE_LABEL,
    });

    const pods = res.items ?? [];
    if (pods.length === 0) {
      cachedPod = { ready: false, podName: null };
      cachedAt = now;
      return cachedPod;
    }

    const pod = pods[0];
    const podName = pod.metadata?.name ?? null;
    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions ?? [];
    const readyCondition = conditions.find((c) => c.type === "Ready");
    const ready = phase === "Running" && readyCondition?.status === "True";

    cachedPod = { ready, podName };
    cachedAt = now;
    return cachedPod;
  } catch {
    cachedPod = { ready: false, podName: null };
    cachedAt = now;
    return cachedPod;
  }
}

// ─── Tool confirmation classification ───

/** Tool names that require user confirmation before execution. */
const WRITE_TOOL_PREFIXES = [
  "create_",
  "retry_",
  "cancel_",
  "update_",
  "bulk_",
  "assign_",
  "delete_",
  "restart_",
  "manage_",
];

export function toolRequiresConfirmation(toolName: string): boolean {
  return WRITE_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

// ─── System prompt builder ───

export function buildToolDefinitionsBlock(enabledTools: string[]): string {
  const allTools: OptioToolDefinition[] = OPTIO_TOOL_CATEGORIES.flatMap((cat) => cat.tools);
  const tools =
    enabledTools.length > 0 ? allTools.filter((t) => enabledTools.includes(t.name)) : allTools;

  const lines = tools.map((t) => {
    const confirm = toolRequiresConfirmation(t.name);
    return `- ${t.name}: ${t.description} [requiresConfirmation: ${confirm}]`;
  });
  return lines.join("\n");
}

export function buildSystemPrompt(settings: {
  systemPrompt: string;
  enabledTools: string[];
  confirmWrites: boolean;
}): string {
  const toolBlock = buildToolDefinitionsBlock(settings.enabledTools);

  const parts: string[] = [
    `You are Optio, an AI operations assistant for managing coding agent tasks and infrastructure.`,
    `You help users manage their task pipeline: retry failed tasks, cancel tasks, update repo settings, check status, and more.`,
    ``,
    `## Available Operations`,
    toolBlock,
    ``,
    `## Response Format`,
    ``,
    `For read-only operations (list_*, get_*, watch_*), respond directly with the information.`,
    ``,
  ];

  if (settings.confirmWrites) {
    parts.push(
      `For write operations (create, retry, cancel, update, delete, restart, manage, assign, bulk), you MUST propose the action first using this exact JSON format on its own line:`,
      ``,
      "```",
      `ACTION_PROPOSAL: {"description": "<what you want to do>", "items": ["<action item 1>", "<action item 2>"]}`,
      "```",
      ``,
      `Wait for the user to approve before executing. Never execute write operations without proposing first.`,
      `After the user approves, execute the actions and report results using this format:`,
      ``,
      "```",
      `ACTION_RESULT: {"success": true, "summary": "<what was done>"}`,
      "```",
      ``,
    );
  }

  parts.push(
    `## Guidelines`,
    `- Be concise and direct`,
    `- When listing tasks, show task ID, title, state, and age`,
    `- When errors occur, explain what went wrong and suggest fixes`,
    `- For bulk operations, summarize what will be affected before proposing`,
    `- Use the Optio API at $OPTIO_API_URL for all operations`,
  );

  if (settings.systemPrompt) {
    parts.push(``, `## Additional Instructions`, settings.systemPrompt);
  }

  return parts.join("\n");
}

// ─── Action proposal parser ───

export interface ParsedActionProposal {
  description: string;
  items: string[];
}

export interface ParsedActionResult {
  success: boolean;
  summary: string;
}

const ACTION_PROPOSAL_RE = /ACTION_PROPOSAL:\s*(\{.*\})/;
const ACTION_RESULT_RE = /ACTION_RESULT:\s*(\{.*\})/;

export function parseActionProposal(text: string): ParsedActionProposal | null {
  const match = text.match(ACTION_PROPOSAL_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.description && Array.isArray(parsed.items)) {
      return { description: parsed.description, items: parsed.items };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

export function parseActionResult(text: string): ParsedActionResult | null {
  const match = text.match(ACTION_RESULT_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.success === "boolean" && parsed.summary) {
      return { success: parsed.success, summary: parsed.summary };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

// ─── WebSocket handler ───

export async function optioChatWs(app: FastifyInstance) {
  app.get("/ws/optio/chat", { websocket: true }, async (socket, req) => {
    const user = await authenticateWs(socket, req);
    if (!user) return;

    const userId = user.id;
    const log = logger.child({ userId, ws: "optio-chat" });

    // Enforce one active conversation per user
    if (activeConnections.has(userId)) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: "You already have an active Optio conversation. Close the other one first.",
        }),
      );
      socket.close(4409, "Concurrent conversation");
      return;
    }

    activeConnections.set(userId, socket as unknown as WebSocket);
    log.info("Optio chat connected");

    let execSession: ExecSession | null = null;
    let isProcessing = false;
    let outputBuffer = "";
    let accumulatedText = "";
    let currentActionId: string | null = null;

    const send = (msg: Record<string, unknown>) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(msg));
      }
    };

    // Send initial ready status
    send({ type: "status", status: "ready" });

    /**
     * Build the conversation context into a single prompt string.
     * Each message in conversationContext is { role, content }.
     */
    const buildPromptWithContext = (
      userMessage: string,
      conversationContext: Array<{ role: string; content: string }>,
    ): string => {
      if (!conversationContext.length) return userMessage;

      const contextLines = conversationContext.map((msg) => {
        const prefix = msg.role === "user" ? "User" : "Assistant";
        return `${prefix}: ${msg.content}`;
      });

      return [...contextLines, `User: ${userMessage}`].join("\n\n");
    };

    /**
     * Execute a single claude -p invocation in the Optio pod.
     */
    const runPrompt = async (
      userMessage: string,
      conversationContext: Array<{ role: string; content: string }>,
    ) => {
      if (isProcessing) {
        send({ type: "error", message: "Already processing a request" });
        return;
      }

      isProcessing = true;
      accumulatedText = "";
      currentActionId = null;
      send({ type: "status", status: "thinking" });

      // Check pod readiness
      const enabled = process.env.OPTIO_POD_ENABLED === "true";
      if (!enabled) {
        send({ type: "error", message: "Optio pod is not enabled" });
        isProcessing = false;
        send({ type: "status", status: "ready" });
        return;
      }

      const podInfo = await findOptioPod();
      if (!podInfo.ready || !podInfo.podName) {
        send({
          type: "error",
          message: "Optio is starting up, try again in a moment",
        });
        isProcessing = false;
        send({ type: "status", status: "ready" });
        return;
      }

      // Load settings
      const settings = await getSettings(user.workspaceId);

      // Build the full prompt
      const systemPrompt = buildSystemPrompt({
        systemPrompt: settings.systemPrompt,
        enabledTools: settings.enabledTools,
        confirmWrites: settings.confirmWrites,
      });
      const conversationPrompt = buildPromptWithContext(userMessage, conversationContext);
      const fullPrompt = `${systemPrompt}\n\n---\n\n${conversationPrompt}`;

      // Build the claude command
      const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
      const modelFlag = settings.model ? `--model ${settings.model}` : "";

      // Build auth env vars
      const authEnv = await buildAuthEnv(log);

      const script = [
        "set -e",
        // Set auth env vars
        ...Object.entries(authEnv).map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`),
        // Run claude in one-shot prompt mode
        `claude -p '${escapedPrompt}' ${modelFlag} --output-format stream-json --verbose --dangerously-skip-permissions 2>&1 || true`,
      ].join("\n");

      const rt = getRuntime();
      const handle = { id: podInfo.podName, name: podInfo.podName };

      try {
        execSession = await rt.exec(handle, ["bash", "-c", script], { tty: false });

        execSession.stdout.on("data", (chunk: Buffer) => {
          outputBuffer += chunk.toString("utf-8");

          // Process complete lines
          const lines = outputBuffer.split("\n");
          outputBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            processOutputLine(line);
          }
        });

        execSession.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8").trim();
          if (text) {
            log.warn({ stderr: text }, "Agent stderr");
          }
        });

        // Wait for exec to finish
        await new Promise<void>((resolve) => {
          execSession!.stdout.on("end", () => {
            // Process remaining buffer
            if (outputBuffer.trim()) {
              processOutputLine(outputBuffer);
              outputBuffer = "";
            }
            resolve();
          });
        });
      } catch (err) {
        log.error({ err }, "Failed to run claude prompt in Optio pod");
        send({ type: "error", message: "Failed to execute agent prompt" });
      } finally {
        isProcessing = false;
        execSession = null;

        // Check if we accumulated an action proposal
        const proposal = parseActionProposal(accumulatedText);
        if (proposal) {
          currentActionId = `action-${Date.now()}`;
          send({
            type: "action_proposal",
            actionId: currentActionId,
            description: proposal.description,
            items: proposal.items,
          });
          send({ type: "status", status: "waiting_for_approval" });
        } else {
          const result = parseActionResult(accumulatedText);
          if (result) {
            send({
              type: "action_result",
              success: result.success,
              summary: result.summary,
            });
          }
          send({ type: "status", status: "ready" });
        }
      }
    };

    /**
     * Process a single line of NDJSON output from claude.
     */
    const processOutputLine = (line: string) => {
      const { entries } = parseClaudeEvent(line, `optio-${userId}`);
      for (const entry of entries) {
        if (entry.type === "text") {
          accumulatedText += entry.content;
          send({ type: "text", content: entry.content });
        }
        // We still send other event types as info for debugging/logging
        if (entry.type === "error") {
          send({ type: "error", message: entry.content });
        }
      }
    };

    // Handle incoming messages from the client
    socket.on("message", (data: Buffer | string) => {
      const str = typeof data === "string" ? data : data.toString("utf-8");

      let msg: {
        type: string;
        content?: string;
        conversationContext?: Array<{ role: string; content: string }>;
        actionId?: string;
        feedback?: string;
      };
      try {
        msg = JSON.parse(str);
      } catch {
        send({ type: "error", message: "Invalid JSON message" });
        return;
      }

      switch (msg.type) {
        case "message":
          if (!msg.content?.trim()) {
            send({ type: "error", message: "Empty message" });
            return;
          }
          runPrompt(msg.content, msg.conversationContext ?? []).catch((err) => {
            log.error({ err }, "Prompt execution failed");
            send({ type: "error", message: "Prompt failed" });
          });
          break;

        case "approve":
          if (!currentActionId || msg.actionId !== currentActionId) {
            send({ type: "error", message: "No pending action to approve" });
            return;
          }
          {
            const approvalContext = [
              ...(msg.conversationContext ?? []),
              {
                role: "assistant" as const,
                content: accumulatedText,
              },
            ];
            currentActionId = null;
            send({ type: "status", status: "executing" });
            runPrompt(
              "The user approved. Execute the proposed actions now.",
              approvalContext,
            ).catch((err) => {
              log.error({ err }, "Approval execution failed");
              send({ type: "error", message: "Execution failed" });
            });
          }
          break;

        case "deny":
          if (!currentActionId || msg.actionId !== currentActionId) {
            send({ type: "error", message: "No pending action to deny" });
            return;
          }
          {
            const feedback = msg.feedback ?? "The user declined.";
            const denyContext = [
              ...(msg.conversationContext ?? []),
              {
                role: "assistant" as const,
                content: accumulatedText,
              },
            ];
            currentActionId = null;
            runPrompt(
              `The user declined. Their feedback: "${feedback}". Ask them what they'd like to change.`,
              denyContext,
            ).catch((err) => {
              log.error({ err }, "Denial follow-up failed");
              send({ type: "error", message: "Follow-up failed" });
            });
          }
          break;

        case "interrupt":
          if (execSession) {
            log.info("Interrupting Optio agent process");
            execSession.close();
            execSession = null;
            isProcessing = false;
            outputBuffer = "";
            accumulatedText = "";
            currentActionId = null;
            send({ type: "status", status: "ready" });
          }
          break;

        default:
          send({ type: "error", message: `Unknown message type: ${msg.type}` });
      }
    });

    socket.on("close", () => {
      log.info("Optio chat disconnected");
      activeConnections.delete(userId);
      if (execSession) {
        execSession.close();
        execSession = null;
      }
    });
  });
}

// ─── Auth helpers (shared with session-chat.ts pattern) ───

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

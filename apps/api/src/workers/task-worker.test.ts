import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAgentCommand, inferExitCode } from "./task-worker.js";

describe("buildAgentCommand", () => {
  describe("claude-code agent", () => {
    it("produces a basic claude command with prompt from env", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("claude-code", env);

      expect(cmds.some((c) => c.includes("claude -p"))).toBe(true);
      expect(cmds.some((c) => c.includes("--dangerously-skip-permissions"))).toBe(true);
      expect(cmds.some((c) => c.includes("--output-format stream-json"))).toBe(true);
      expect(cmds.some((c) => c.includes("--verbose"))).toBe(true);
      expect(cmds.some((c) => c.includes("--max-turns 250"))).toBe(true);
    });

    it("uses default coding max turns (250)", () => {
      const env = { OPTIO_PROMPT: "Do stuff" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--max-turns 250"))).toBe(true);
    });

    it("uses default review max turns (30) when isReview is true", () => {
      const env = { OPTIO_PROMPT: "Review PR" };
      const cmds = buildAgentCommand("claude-code", env, { isReview: true });
      expect(cmds.some((c) => c.includes("--max-turns 30"))).toBe(true);
    });

    it("respects custom maxTurnsCoding override", () => {
      const env = { OPTIO_PROMPT: "Build feature" };
      const cmds = buildAgentCommand("claude-code", env, { maxTurnsCoding: 100 });
      expect(cmds.some((c) => c.includes("--max-turns 100"))).toBe(true);
    });

    it("respects custom maxTurnsReview override for reviews", () => {
      const env = { OPTIO_PROMPT: "Review code" };
      const cmds = buildAgentCommand("claude-code", env, {
        isReview: true,
        maxTurnsReview: 25,
      });
      expect(cmds.some((c) => c.includes("--max-turns 25"))).toBe(true);
    });

    it("adds resume flag when resumeSessionId is provided", () => {
      const env = { OPTIO_PROMPT: "Continue work" };
      const cmds = buildAgentCommand("claude-code", env, {
        resumeSessionId: "sess-abc-123",
      });
      expect(cmds.some((c) => c.includes("--resume"))).toBe(true);
      expect(cmds.some((c) => c.includes("sess-abc-123"))).toBe(true);
    });

    it("uses resumePrompt with original prompt as context when provided", () => {
      const env = { OPTIO_PROMPT: "Original prompt" };
      buildAgentCommand("claude-code", env, {
        resumePrompt: "Fix the tests now",
      });
      // The prompt is mutated in env.OPTIO_PROMPT (passed via $OPTIO_PROMPT in the script)
      expect(env.OPTIO_PROMPT).toContain("Fix the tests now");
      expect(env.OPTIO_PROMPT).toContain("Original prompt");
    });

    it("adds max-subscription auth setup when auth mode is max-subscription", () => {
      const env = {
        OPTIO_PROMPT: "Do work",
        OPTIO_AUTH_MODE: "max-subscription",
        OPTIO_API_URL: "http://localhost:4000",
      };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("Token proxy OK"))).toBe(true);
      expect(cmds.some((c) => c.includes("unset ANTHROPIC_API_KEY"))).toBe(true);
    });

    it("does not add auth setup for api-key mode", () => {
      const env = { OPTIO_PROMPT: "Do work", OPTIO_AUTH_MODE: "api-key" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("Token proxy OK"))).toBe(false);
      expect(cmds.some((c) => c.includes("unset ANTHROPIC_API_KEY"))).toBe(false);
    });

    it("includes review label in echo when isReview is true", () => {
      const env = { OPTIO_PROMPT: "Review" };
      const cmds = buildAgentCommand("claude-code", env, { isReview: true });
      expect(cmds.some((c) => c.includes("(review)"))).toBe(true);
    });

    it("adds --model flag when OPTIO_CLAUDE_MODEL is set", () => {
      const env = { OPTIO_PROMPT: "Do work", OPTIO_CLAUDE_MODEL: "opus" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--model opus"))).toBe(true);
    });

    it("adds context window suffix to --model flag", () => {
      const env = {
        OPTIO_PROMPT: "Do work",
        OPTIO_CLAUDE_MODEL: "opus",
        OPTIO_CLAUDE_CONTEXT_WINDOW: "1m",
      };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--model opus[1m]"))).toBe(true);
    });

    it("does not add --model flag when OPTIO_CLAUDE_MODEL is not set", () => {
      const env = { OPTIO_PROMPT: "Do work" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--model"))).toBe(false);
    });

    it("includes --input-format stream-json for mid-task messaging support", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--input-format stream-json"))).toBe(true);
    });

    it("includes --replay-user-messages for message acknowledgment", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("claude-code", env);
      expect(cmds.some((c) => c.includes("--replay-user-messages"))).toBe(true);
    });

    it("does not include stream-json flags for codex agent", () => {
      const env = { OPTIO_PROMPT: "Build feature" };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("--input-format stream-json"))).toBe(false);
      expect(cmds.some((c) => c.includes("--replay-user-messages"))).toBe(false);
    });
  });

  describe("codex agent", () => {
    it("produces a codex exec command", () => {
      const env = { OPTIO_PROMPT: "Build feature" };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("codex exec"))).toBe(true);
      expect(cmds.some((c) => c.includes("--full-auto"))).toBe(true);
      expect(cmds.some((c) => c.includes("--json"))).toBe(true);
    });

    it("does not include --app-server flag in api-key mode", () => {
      const env = { OPTIO_PROMPT: "Build feature", OPTIO_CODEX_AUTH_MODE: "api-key" };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("--app-server"))).toBe(false);
    });

    it("includes --app-server flag with URL in app-server mode", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_CODEX_AUTH_MODE: "app-server",
        OPTIO_CODEX_APP_SERVER_URL: "ws://localhost:3900/v1/connect",
      };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("--app-server"))).toBe(true);
      expect(cmds.some((c) => c.includes("ws://localhost:3900/v1/connect"))).toBe(true);
    });

    it("includes app-server label in echo when in app-server mode", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_CODEX_AUTH_MODE: "app-server",
        OPTIO_CODEX_APP_SERVER_URL: "ws://localhost:3900/v1/connect",
      };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("(app-server)"))).toBe(true);
    });

    it("does not include --app-server flag when auth mode is app-server but URL is missing", () => {
      const env = { OPTIO_PROMPT: "Build feature", OPTIO_CODEX_AUTH_MODE: "app-server" };
      const cmds = buildAgentCommand("codex", env);
      expect(cmds.some((c) => c.includes("--app-server"))).toBe(false);
    });
  });

  describe("opencode agent", () => {
    it("produces an opencode run command with --format json", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("opencode", env);
      expect(cmds.some((c) => c.includes("opencode run"))).toBe(true);
      expect(cmds.some((c) => c.includes("--format json"))).toBe(true);
    });

    it("includes experimental label in echo", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("opencode", env);
      expect(cmds.some((c) => c.includes("(experimental)"))).toBe(true);
    });

    it("adds --model flag when OPTIO_OPENCODE_MODEL is set", () => {
      const env = {
        OPTIO_PROMPT: "Fix the bug",
        OPTIO_OPENCODE_MODEL: "anthropic/claude-sonnet-4",
      };
      const cmds = buildAgentCommand("opencode", env);
      expect(cmds.some((c) => c.includes("--model"))).toBe(true);
      expect(cmds.some((c) => c.includes("anthropic/claude-sonnet-4"))).toBe(true);
    });

    it("adds --agent flag when OPTIO_OPENCODE_AGENT is set", () => {
      const env = { OPTIO_PROMPT: "Fix the bug", OPTIO_OPENCODE_AGENT: "build" };
      const cmds = buildAgentCommand("opencode", env);
      expect(cmds.some((c) => c.includes("--agent"))).toBe(true);
      expect(cmds.some((c) => c.includes("build"))).toBe(true);
    });

    it("does not add --model or --agent flags when not set", () => {
      const env = { OPTIO_PROMPT: "Fix the bug" };
      const cmds = buildAgentCommand("opencode", env);
      expect(cmds.some((c) => c.includes("--model"))).toBe(false);
      expect(cmds.some((c) => c.includes("--agent"))).toBe(false);
    });

    it("adds --session flag for resume", () => {
      const env = { OPTIO_PROMPT: "Continue work" };
      const cmds = buildAgentCommand("opencode", env, {
        resumeSessionId: "oc-sess-abc",
      });
      expect(cmds.some((c) => c.includes("--session"))).toBe(true);
      expect(cmds.some((c) => c.includes("oc-sess-abc"))).toBe(true);
    });
  });

  describe("azure-foundry agent", () => {
    it("produces an aider command routed to Azure", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "api-key",
        OPTIO_AZURE_FOUNDRY_DEPLOYMENT: "GSD-PI_gpt-5-codex",
        OPENAI_BASE_URL: "https://test.openai.azure.com/",
      };
      const cmds = buildAgentCommand("azure-foundry", env);
      expect(cmds.some((c) => c.includes("aider"))).toBe(true);
      expect(cmds.some((c) => c.includes("--yes-always"))).toBe(true);
      expect(cmds.some((c) => c.includes("Azure Foundry"))).toBe(true);
    });

    it("maps AZURE_FOUNDRY_API_KEY to AZURE_API_KEY in api-key mode", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "api-key",
      };
      const cmds = buildAgentCommand("azure-foundry", env);
      expect(cmds.some((c) => c.includes("AZURE_FOUNDRY_API_KEY"))).toBe(true);
      expect(cmds.some((c) => c.includes("AZURE_API_KEY"))).toBe(true);
    });

    it("acquires managed identity token in managed-identity mode", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "managed-identity",
      };
      const cmds = buildAgentCommand("azure-foundry", env);
      expect(cmds.some((c) => c.includes("managed identity token"))).toBe(true);
      expect(cmds.some((c) => c.includes("169.254.169.254"))).toBe(true);
    });

    it("adds --model flag with azure/ prefix when deployment name is set", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "api-key",
        OPTIO_AZURE_FOUNDRY_DEPLOYMENT: "GSD-PI_gpt-5.3-chat",
      };
      const cmds = buildAgentCommand("azure-foundry", env);
      expect(cmds.some((c) => c.includes("--model"))).toBe(true);
      expect(cmds.some((c) => c.includes("azure/GSD-PI_gpt-5.3-chat"))).toBe(true);
    });

    it("sets AZURE_API_BASE from endpoint", () => {
      const env = {
        OPTIO_PROMPT: "Build feature",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "api-key",
        OPENAI_BASE_URL: "https://test.openai.azure.com/",
      };
      const cmds = buildAgentCommand("azure-foundry", env);
      expect(cmds.some((c) => c.includes("AZURE_API_BASE"))).toBe(true);
      expect(cmds.some((c) => c.includes("test.openai.azure.com"))).toBe(true);
    });

    it("includes review label when isReview is true", () => {
      const env = {
        OPTIO_PROMPT: "Review code",
        OPTIO_AZURE_FOUNDRY_AUTH_MODE: "api-key",
      };
      const cmds = buildAgentCommand("azure-foundry", env, { isReview: true });
      expect(cmds.some((c) => c.includes("(review)"))).toBe(true);
    });
  });

  describe("unknown agent", () => {
    it("produces an error exit command for unknown agent types", () => {
      const env = { OPTIO_PROMPT: "Do something" };
      const cmds = buildAgentCommand("unknown-agent", env);
      expect(cmds.some((c) => c.includes("Unknown agent type"))).toBe(true);
      expect(cmds.some((c) => c.includes("exit 1"))).toBe(true);
    });
  });
});

describe("inferExitCode", () => {
  describe("claude-code", () => {
    it("returns 0 for clean logs", () => {
      const logs = '{"type":"assistant","content":"All done"}\n';
      expect(inferExitCode("claude-code", logs)).toBe(0);
    });

    it("returns 1 when is_error is true in result", () => {
      const logs = '{"type":"result","is_error":true,"error":"Something failed"}\n';
      expect(inferExitCode("claude-code", logs)).toBe(1);
    });

    it("returns 1 on fatal git error", () => {
      const logs = "fatal: repository not found\n";
      expect(inferExitCode("claude-code", logs)).toBe(1);
    });

    it("returns 1 on authentication_failed error", () => {
      const logs = "Error: authentication_failed - token expired\n";
      expect(inferExitCode("claude-code", logs)).toBe(1);
    });

    it("returns 0 when exit 1 appears in logs (not a real error signal)", () => {
      const logs = "some output\nexit 1\nmore output\n";
      expect(inferExitCode("claude-code", logs)).toBe(0);
    });

    it("returns 0 when logs contain non-fatal content", () => {
      const logs = '{"type":"result","is_error":false}\nCompleted successfully\n';
      expect(inferExitCode("claude-code", logs)).toBe(0);
    });
  });

  describe("codex", () => {
    it("returns 0 for clean codex logs", () => {
      const logs = '{"type":"message","content":"Done"}\n';
      expect(inferExitCode("codex", logs)).toBe(0);
    });

    it("returns 1 when error event is present", () => {
      const logs = '{"type":"error","message":"something broke"}\n';
      expect(inferExitCode("codex", logs)).toBe(1);
    });

    it("returns 1 when error event has spaces in JSON", () => {
      const logs = '{"type": "error", "message": "broke"}\n';
      expect(inferExitCode("codex", logs)).toBe(1);
    });

    it("returns 1 on OPENAI_API_KEY auth error", () => {
      const logs = "Error: OPENAI_API_KEY is not set\n";
      expect(inferExitCode("codex", logs)).toBe(1);
    });

    it("returns 1 on invalid API key", () => {
      const logs = "invalid api key provided\n";
      expect(inferExitCode("codex", logs)).toBe(1);
    });

    it("returns 1 on quota exceeded", () => {
      const logs = "Error: insufficient_quota - you have exceeded your billing limit\n";
      expect(inferExitCode("codex", logs)).toBe(1);
    });

    it("returns 1 on billing error", () => {
      const logs = "billing limit exceeded\n";
      expect(inferExitCode("codex", logs)).toBe(1);
    });
  });

  describe("opencode", () => {
    it("returns 0 for clean opencode logs", () => {
      const logs = '{"type":"message","role":"assistant","content":"Done"}\n';
      expect(inferExitCode("opencode", logs)).toBe(0);
    });

    it("returns 1 when error event is present", () => {
      const logs = '{"type":"error","message":"something broke"}\n';
      expect(inferExitCode("opencode", logs)).toBe(1);
    });

    it("returns 1 on ANTHROPIC_API_KEY auth error", () => {
      const logs = "Error: ANTHROPIC_API_KEY is not set\n";
      expect(inferExitCode("opencode", logs)).toBe(1);
    });

    it("returns 1 on OPENAI_API_KEY auth error", () => {
      const logs = "Error: OPENAI_API_KEY is invalid\n";
      expect(inferExitCode("opencode", logs)).toBe(1);
    });

    it("returns 1 on model not found", () => {
      const logs = "model_not_found: the specified model does not exist\n";
      expect(inferExitCode("opencode", logs)).toBe(1);
    });

    it("returns 1 on fatal error", () => {
      const logs = "fatal: repository not found\n";
      expect(inferExitCode("opencode", logs)).toBe(1);
    });
  });

  describe("azure-foundry", () => {
    it("returns 0 for clean logs", () => {
      const logs = '{"type":"message","content":"Done"}\n';
      expect(inferExitCode("azure-foundry", logs)).toBe(0);
    });

    it("returns 1 on aider error", () => {
      const logs = "Error: aider encountered a problem\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on AZURE_API_KEY auth error", () => {
      const logs = "InvalidApiKey: The AZURE_API_KEY is not valid\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on DeploymentNotFound error", () => {
      const logs = "DeploymentNotFound: The deployment does not exist\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on rate limit / 429 error", () => {
      const logs = "Error: 429 Too Many Requests — rate limit exceeded\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on content filter violation", () => {
      const logs = "ResponsibleAIPolicyViolation: content_filter triggered\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on managed identity auth failure", () => {
      const logs = "Error: failed to acquire token via managed identity\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });

    it("returns 1 on Azure OpenAI deployment not found error", () => {
      const logs = "Error: The deployment 'GSD-PI_test' was not found\n";
      expect(inferExitCode("azure-foundry", logs)).toBe(1);
    });
  });

  describe("default (unknown agent type)", () => {
    it("uses claude-code patterns as default", () => {
      expect(inferExitCode("some-future-agent", "fatal: error")).toBe(1);
      expect(inferExitCode("some-future-agent", "all good")).toBe(0);
    });
  });
});

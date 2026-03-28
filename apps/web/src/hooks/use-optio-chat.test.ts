import { describe, it, expect, beforeEach } from "vitest";
import { useOptioChatStore, MAX_EXCHANGES } from "./use-optio-chat";
import type { OptioChatMessage } from "./use-optio-chat";

describe("useOptioChatStore", () => {
  beforeEach(() => {
    useOptioChatStore.setState({
      isOpen: false,
      messages: [],
      prefillInput: "",
      status: "ready",
      exchangeCount: 0,
    });
  });

  const mockUserMsg: OptioChatMessage = {
    id: "user-1",
    role: "user",
    content: "Hello Optio",
    timestamp: "2025-01-15T00:00:00Z",
  };

  const mockAssistantMsg: OptioChatMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Hello! How can I help?",
    timestamp: "2025-01-15T00:00:01Z",
  };

  describe("panel open/close", () => {
    it("initializes closed", () => {
      expect(useOptioChatStore.getState().isOpen).toBe(false);
    });

    it("opens the panel", () => {
      useOptioChatStore.getState().open();
      expect(useOptioChatStore.getState().isOpen).toBe(true);
    });

    it("closes the panel", () => {
      useOptioChatStore.getState().open();
      useOptioChatStore.getState().close();
      expect(useOptioChatStore.getState().isOpen).toBe(false);
    });

    it("toggles the panel", () => {
      useOptioChatStore.getState().toggle();
      expect(useOptioChatStore.getState().isOpen).toBe(true);
      useOptioChatStore.getState().toggle();
      expect(useOptioChatStore.getState().isOpen).toBe(false);
    });
  });

  describe("messages", () => {
    it("initializes with empty messages", () => {
      expect(useOptioChatStore.getState().messages).toEqual([]);
    });

    it("adds a message", () => {
      useOptioChatStore.getState().addMessage(mockUserMsg);
      expect(useOptioChatStore.getState().messages).toHaveLength(1);
      expect(useOptioChatStore.getState().messages[0]).toEqual(mockUserMsg);
    });

    it("adds multiple messages in order", () => {
      useOptioChatStore.getState().addMessage(mockUserMsg);
      useOptioChatStore.getState().addMessage(mockAssistantMsg);
      const msgs = useOptioChatStore.getState().messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });

    it("updates a message by id", () => {
      useOptioChatStore.getState().addMessage(mockAssistantMsg);
      useOptioChatStore.getState().updateMessage("assistant-1", {
        content: "Updated content",
      });
      expect(useOptioChatStore.getState().messages[0].content).toBe("Updated content");
    });

    it("does not modify other messages when updating", () => {
      useOptioChatStore.getState().addMessage(mockUserMsg);
      useOptioChatStore.getState().addMessage(mockAssistantMsg);
      useOptioChatStore.getState().updateMessage("assistant-1", {
        content: "Updated",
      });
      expect(useOptioChatStore.getState().messages[0].content).toBe("Hello Optio");
    });

    it("leaves messages unchanged if id is not found", () => {
      useOptioChatStore.getState().addMessage(mockUserMsg);
      useOptioChatStore.getState().updateMessage("nonexistent", { content: "X" });
      expect(useOptioChatStore.getState().messages[0].content).toBe("Hello Optio");
    });

    it("resets messages and exchange count", () => {
      useOptioChatStore.getState().addMessage(mockUserMsg);
      useOptioChatStore.getState().incrementExchange();
      useOptioChatStore.getState().resetMessages();
      expect(useOptioChatStore.getState().messages).toEqual([]);
      expect(useOptioChatStore.getState().exchangeCount).toBe(0);
    });
  });

  describe("prefill input", () => {
    it("initializes empty", () => {
      expect(useOptioChatStore.getState().prefillInput).toBe("");
    });

    it("sets prefill input", () => {
      useOptioChatStore.getState().setPrefillInput("Task #123 failed");
      expect(useOptioChatStore.getState().prefillInput).toBe("Task #123 failed");
    });

    it("clears prefill input", () => {
      useOptioChatStore.getState().setPrefillInput("something");
      useOptioChatStore.getState().setPrefillInput("");
      expect(useOptioChatStore.getState().prefillInput).toBe("");
    });
  });

  describe("status", () => {
    it("initializes as ready", () => {
      expect(useOptioChatStore.getState().status).toBe("ready");
    });

    it("sets status", () => {
      useOptioChatStore.getState().setStatus("thinking");
      expect(useOptioChatStore.getState().status).toBe("thinking");
    });

    it("can set all status values", () => {
      const statuses = ["ready", "unavailable", "starting", "thinking", "disconnected"] as const;
      for (const s of statuses) {
        useOptioChatStore.getState().setStatus(s);
        expect(useOptioChatStore.getState().status).toBe(s);
      }
    });
  });

  describe("exchange count", () => {
    it("initializes at zero", () => {
      expect(useOptioChatStore.getState().exchangeCount).toBe(0);
    });

    it("increments exchange count", () => {
      useOptioChatStore.getState().incrementExchange();
      expect(useOptioChatStore.getState().exchangeCount).toBe(1);
      useOptioChatStore.getState().incrementExchange();
      expect(useOptioChatStore.getState().exchangeCount).toBe(2);
    });

    it("resets exchange count", () => {
      useOptioChatStore.getState().incrementExchange();
      useOptioChatStore.getState().incrementExchange();
      useOptioChatStore.getState().resetExchangeCount();
      expect(useOptioChatStore.getState().exchangeCount).toBe(0);
    });
  });

  describe("MAX_EXCHANGES constant", () => {
    it("is 20", () => {
      expect(MAX_EXCHANGES).toBe(20);
    });
  });

  describe("action messages", () => {
    it("stores messages with action data", () => {
      const actionMsg: OptioChatMessage = {
        id: "assistant-action",
        role: "assistant",
        content: "I'd like to do the following:",
        timestamp: "2025-01-15T00:00:00Z",
        action: {
          id: "action-1",
          description: "Retry failed tasks",
          items: ["Retry task #201", "Retry task #203"],
          decision: null,
        },
      };
      useOptioChatStore.getState().addMessage(actionMsg);
      const msg = useOptioChatStore.getState().messages[0];
      expect(msg.action).toBeDefined();
      expect(msg.action!.items).toHaveLength(2);
      expect(msg.action!.decision).toBeNull();
    });

    it("updates action decision via updateMessage", () => {
      const actionMsg: OptioChatMessage = {
        id: "assistant-action",
        role: "assistant",
        content: "Plan",
        timestamp: "2025-01-15T00:00:00Z",
        action: {
          id: "action-1",
          description: "Do something",
          items: ["Item 1"],
          decision: null,
        },
      };
      useOptioChatStore.getState().addMessage(actionMsg);
      useOptioChatStore.getState().updateMessage("assistant-action", {
        action: { ...actionMsg.action!, decision: true },
      });
      expect(useOptioChatStore.getState().messages[0].action!.decision).toBe(true);
    });
  });
});

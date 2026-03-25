import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { signPayload, VALID_EVENTS } from "./webhook-service.js";

describe("signPayload", () => {
  it("produces a valid HMAC-SHA256 hex signature", () => {
    const payload = JSON.stringify({ event: "task.completed", data: { taskId: "123" } });
    const secret = "test-secret-key";
    const signature = signPayload(payload, secret);

    // Verify it matches what Node's crypto would produce
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expect(signature).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    const payload = JSON.stringify({ event: "task.completed" });
    const sig1 = signPayload(payload, "secret-1");
    const sig2 = signPayload(payload, "secret-2");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "same-secret";
    const sig1 = signPayload(JSON.stringify({ event: "task.completed" }), secret);
    const sig2 = signPayload(JSON.stringify({ event: "task.failed" }), secret);
    expect(sig1).not.toBe(sig2);
  });

  it("returns a 64-character hex string", () => {
    const signature = signPayload("test", "secret");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("VALID_EVENTS", () => {
  it("contains all expected webhook events", () => {
    expect(VALID_EVENTS).toContain("task.completed");
    expect(VALID_EVENTS).toContain("task.failed");
    expect(VALID_EVENTS).toContain("task.needs_attention");
    expect(VALID_EVENTS).toContain("task.pr_opened");
    expect(VALID_EVENTS).toContain("review.completed");
    expect(VALID_EVENTS).toHaveLength(5);
  });
});

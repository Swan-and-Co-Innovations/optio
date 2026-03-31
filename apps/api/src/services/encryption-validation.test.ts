import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database module — required by secret-service but not used for validation
vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  secrets: {
    id: "secrets.id",
    name: "secrets.name",
    scope: "secrets.scope",
    encryptedValue: "secrets.encrypted_value",
    iv: "secrets.iv",
    authTag: "secrets.auth_tag",
    createdAt: "secrets.created_at",
    updatedAt: "secrets.updated_at",
  },
}));

describe("encryption key validation", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.OPTIO_ENCRYPTION_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.OPTIO_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.OPTIO_ENCRYPTION_KEY;
    }
  });

  it("throws when OPTIO_ENCRYPTION_KEY is not set", async () => {
    delete process.env.OPTIO_ENCRYPTION_KEY;
    const { validateEncryptionKey } = await import("./secret-service.js");
    expect(() => validateEncryptionKey()).toThrow("OPTIO_ENCRYPTION_KEY is not set");
  });

  it("throws when encryption key is set to 'change-me-in-production'", async () => {
    process.env.OPTIO_ENCRYPTION_KEY = "change-me-in-production";
    const { validateEncryptionKey } = await import("./secret-service.js");
    expect(() => validateEncryptionKey()).toThrow("known-weak value");
  });

  it("throws for weak values regardless of case", async () => {
    process.env.OPTIO_ENCRYPTION_KEY = "Change-Me-In-Production";
    const { validateEncryptionKey } = await import("./secret-service.js");
    expect(() => validateEncryptionKey()).toThrow("known-weak value");
  });

  it("throws for other known-weak values", async () => {
    for (const weak of ["changeme", "test", "secret", "password", "default"]) {
      vi.resetModules();
      process.env.OPTIO_ENCRYPTION_KEY = weak;
      const { validateEncryptionKey } = await import("./secret-service.js");
      expect(() => validateEncryptionKey()).toThrow("known-weak value");
    }
  });

  it("accepts a valid 64-character hex key", async () => {
    process.env.OPTIO_ENCRYPTION_KEY = "a".repeat(64);
    const { validateEncryptionKey } = await import("./secret-service.js");
    expect(() => validateEncryptionKey()).not.toThrow();
  });

  it("accepts a valid non-hex key", async () => {
    process.env.OPTIO_ENCRYPTION_KEY = "my-sufficiently-complex-production-key-2024!";
    const { validateEncryptionKey } = await import("./secret-service.js");
    expect(() => validateEncryptionKey()).not.toThrow();
  });
});

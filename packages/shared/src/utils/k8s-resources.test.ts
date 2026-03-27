import { describe, it, expect } from "vitest";
import {
  validateCpuQuantity,
  validateMemoryQuantity,
  validateRequestLimitPair,
  parseCpuMillicores,
  parseMemoryMi,
} from "./k8s-resources.js";

describe("parseCpuMillicores", () => {
  it("parses millicores", () => {
    expect(parseCpuMillicores("500m")).toBe(500);
    expect(parseCpuMillicores("1000m")).toBe(1000);
    expect(parseCpuMillicores("100m")).toBe(100);
  });

  it("parses whole cores", () => {
    expect(parseCpuMillicores("1")).toBe(1000);
    expect(parseCpuMillicores("2")).toBe(2000);
    expect(parseCpuMillicores("0.5")).toBe(500);
  });
});

describe("parseMemoryMi", () => {
  it("parses Mi suffix", () => {
    expect(parseMemoryMi("512Mi")).toBe(512);
    expect(parseMemoryMi("1024Mi")).toBe(1024);
  });

  it("parses Gi suffix", () => {
    expect(parseMemoryMi("1Gi")).toBe(1024);
    expect(parseMemoryMi("2Gi")).toBe(2048);
    expect(parseMemoryMi("0.5Gi")).toBe(512);
  });

  it("parses Ki suffix", () => {
    expect(parseMemoryMi("262144Ki")).toBe(256);
  });

  it("parses Ti suffix", () => {
    expect(parseMemoryMi("1Ti")).toBe(1024 * 1024);
  });
});

describe("validateCpuQuantity", () => {
  it("accepts valid millicores", () => {
    expect(validateCpuQuantity("500m")).toEqual({ valid: true });
    expect(validateCpuQuantity("1000m")).toEqual({ valid: true });
    expect(validateCpuQuantity("100m")).toEqual({ valid: true });
    expect(validateCpuQuantity("32000m")).toEqual({ valid: true });
  });

  it("accepts valid whole cores", () => {
    expect(validateCpuQuantity("1")).toEqual({ valid: true });
    expect(validateCpuQuantity("2")).toEqual({ valid: true });
    expect(validateCpuQuantity("4")).toEqual({ valid: true });
  });

  it("accepts valid decimal cores", () => {
    expect(validateCpuQuantity("0.5")).toEqual({ valid: true });
    expect(validateCpuQuantity("2.5")).toEqual({ valid: true });
  });

  it("rejects invalid format", () => {
    expect(validateCpuQuantity("abc").valid).toBe(false);
    expect(validateCpuQuantity("500Mi").valid).toBe(false);
    expect(validateCpuQuantity("-100m").valid).toBe(false);
    expect(validateCpuQuantity("").valid).toBe(false);
  });

  it("rejects below minimum (100m)", () => {
    expect(validateCpuQuantity("50m").valid).toBe(false);
    expect(validateCpuQuantity("0.05").valid).toBe(false);
  });

  it("rejects above maximum (32000m)", () => {
    expect(validateCpuQuantity("33000m").valid).toBe(false);
    expect(validateCpuQuantity("33").valid).toBe(false);
  });
});

describe("validateMemoryQuantity", () => {
  it("accepts valid Mi values", () => {
    expect(validateMemoryQuantity("256Mi")).toEqual({ valid: true });
    expect(validateMemoryQuantity("512Mi")).toEqual({ valid: true });
    expect(validateMemoryQuantity("1024Mi")).toEqual({ valid: true });
  });

  it("accepts valid Gi values", () => {
    expect(validateMemoryQuantity("1Gi")).toEqual({ valid: true });
    expect(validateMemoryQuantity("4Gi")).toEqual({ valid: true });
    expect(validateMemoryQuantity("64Gi")).toEqual({ valid: true });
  });

  it("rejects invalid format", () => {
    expect(validateMemoryQuantity("abc").valid).toBe(false);
    expect(validateMemoryQuantity("500m").valid).toBe(false);
    expect(validateMemoryQuantity("-256Mi").valid).toBe(false);
    expect(validateMemoryQuantity("").valid).toBe(false);
  });

  it("rejects below minimum (256Mi)", () => {
    expect(validateMemoryQuantity("128Mi").valid).toBe(false);
    expect(validateMemoryQuantity("100Mi").valid).toBe(false);
  });

  it("rejects above maximum (64Gi)", () => {
    expect(validateMemoryQuantity("65Gi").valid).toBe(false);
    expect(validateMemoryQuantity("128Gi").valid).toBe(false);
  });
});

describe("validateRequestLimitPair", () => {
  it("passes when request <= limit", () => {
    expect(validateRequestLimitPair("500m", "1000m", parseCpuMillicores, "CPU")).toEqual({
      valid: true,
    });
    expect(validateRequestLimitPair("1Gi", "2Gi", parseMemoryMi, "Memory")).toEqual({
      valid: true,
    });
  });

  it("passes when request equals limit", () => {
    expect(validateRequestLimitPair("1000m", "1000m", parseCpuMillicores, "CPU")).toEqual({
      valid: true,
    });
  });

  it("fails when request > limit", () => {
    const result = validateRequestLimitPair("2000m", "1000m", parseCpuMillicores, "CPU");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("cannot exceed");
  });

  it("passes when only one is set", () => {
    expect(validateRequestLimitPair("500m", null, parseCpuMillicores, "CPU")).toEqual({
      valid: true,
    });
    expect(validateRequestLimitPair(null, "1000m", parseCpuMillicores, "CPU")).toEqual({
      valid: true,
    });
    expect(validateRequestLimitPair(undefined, undefined, parseCpuMillicores, "CPU")).toEqual({
      valid: true,
    });
  });
});

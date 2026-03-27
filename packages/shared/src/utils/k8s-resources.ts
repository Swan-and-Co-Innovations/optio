/**
 * Validation utilities for Kubernetes resource quantities (CPU and memory).
 */

/** Matches K8s CPU quantities: integer or decimal, optionally with 'm' suffix (millicores). */
const CPU_REGEX = /^\d+(\.\d+)?m?$/;

/** Matches K8s memory quantities: integer with optional binary suffix (Ki, Mi, Gi, Ti). */
const MEMORY_REGEX = /^\d+(\.\d+)?(Ki|Mi|Gi|Ti)?$/;

/**
 * Parse a CPU quantity string into millicores.
 * Examples: "500m" → 500, "1" → 1000, "2.5" → 2500
 */
export function parseCpuMillicores(value: string): number {
  if (value.endsWith("m")) {
    return parseFloat(value.slice(0, -1));
  }
  return parseFloat(value) * 1000;
}

/**
 * Parse a memory quantity string into mebibytes (MiB).
 * Examples: "512Mi" → 512, "1Gi" → 1024, "256Ki" → 0.25
 */
export function parseMemoryMi(value: string): number {
  if (value.endsWith("Ti")) {
    return parseFloat(value.slice(0, -2)) * 1024 * 1024;
  }
  if (value.endsWith("Gi")) {
    return parseFloat(value.slice(0, -2)) * 1024;
  }
  if (value.endsWith("Mi")) {
    return parseFloat(value.slice(0, -2));
  }
  if (value.endsWith("Ki")) {
    return parseFloat(value.slice(0, -2)) / 1024;
  }
  // Plain number is bytes
  return parseFloat(value) / (1024 * 1024);
}

/**
 * Validate a Kubernetes CPU resource quantity.
 * Accepts: "500m", "1000m", "1", "2.5", etc.
 * Range: 100m–32000m (0.1 to 32 vCPUs).
 */
export function validateCpuQuantity(value: string): { valid: boolean; error?: string } {
  if (!CPU_REGEX.test(value)) {
    return {
      valid: false,
      error: `Invalid CPU format "${value}". Use millicores (e.g. "500m") or cores (e.g. "2").`,
    };
  }
  const millicores = parseCpuMillicores(value);
  if (millicores < 100) {
    return { valid: false, error: "CPU must be at least 100m (0.1 vCPU)." };
  }
  if (millicores > 32000) {
    return { valid: false, error: "CPU must be at most 32000m (32 vCPUs)." };
  }
  return { valid: true };
}

/**
 * Validate a Kubernetes memory resource quantity.
 * Accepts: "256Mi", "1Gi", "512Mi", etc.
 * Range: 256Mi–64Gi.
 */
export function validateMemoryQuantity(value: string): { valid: boolean; error?: string } {
  if (!MEMORY_REGEX.test(value)) {
    return {
      valid: false,
      error: `Invalid memory format "${value}". Use binary units (e.g. "512Mi", "2Gi").`,
    };
  }
  const mi = parseMemoryMi(value);
  if (mi < 256) {
    return { valid: false, error: "Memory must be at least 256Mi." };
  }
  if (mi > 64 * 1024) {
    return { valid: false, error: "Memory must be at most 64Gi." };
  }
  return { valid: true };
}

/**
 * Validate that request <= limit when both are specified for a resource type.
 */
export function validateRequestLimitPair(
  request: string | undefined | null,
  limit: string | undefined | null,
  parseValue: (v: string) => number,
  label: string,
): { valid: boolean; error?: string } {
  if (request && limit) {
    const reqVal = parseValue(request);
    const limVal = parseValue(limit);
    if (reqVal > limVal) {
      return {
        valid: false,
        error: `${label} request (${request}) cannot exceed ${label} limit (${limit}).`,
      };
    }
  }
  return { valid: true };
}

export type { ContainerRuntime, LogOptions, ExecOptions } from "./types.js";
export { DockerContainerRuntime } from "./docker.js";
export type { DockerRuntimeOptions } from "./docker.js";
export {
  KubernetesContainerRuntime,
  ALLOWED_CAPABILITIES,
  ALLOWED_HOST_PATH_PREFIXES,
} from "./kubernetes.js";

import type { ContainerRuntime } from "./types.js";
import { DockerContainerRuntime, type DockerRuntimeOptions } from "./docker.js";
import { KubernetesContainerRuntime } from "./kubernetes.js";

export interface RuntimeConfig {
  type: "docker" | "kubernetes";
  docker?: DockerRuntimeOptions;
  kubernetes?: { namespace?: string };
}

export function createRuntime(config: RuntimeConfig): ContainerRuntime {
  switch (config.type) {
    case "docker":
      return new DockerContainerRuntime(config.docker);
    case "kubernetes":
      return new KubernetesContainerRuntime(config.kubernetes?.namespace);
    default:
      throw new Error(`Unknown runtime type: ${config.type}`);
  }
}

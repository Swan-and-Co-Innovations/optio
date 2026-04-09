import { createRuntime, type ContainerRuntime } from "@optio/container-runtime";
import type { ContainerSpec, ContainerHandle, ContainerStatus } from "@optio/shared";
import { DEFAULT_AGENT_IMAGE } from "@optio/shared";

/**
 * No-op runtime stub for ACA deployments.
 *
 * In ACA mode, agent tasks run as ACA Jobs (via AcaContainerRuntime),
 * not as K8s pods or Docker containers. The workers that call getRuntime()
 * (repo-cleanup, task-worker) need a runtime that won't crash — this stub
 * returns safe defaults so those code paths degrade gracefully.
 */
const acaStubRuntime: ContainerRuntime = {
  async create() {
    throw new Error("ACA runtime: use AcaContainerRuntime.createJob() instead");
  },
  async status() {
    return { state: "unknown" } as ContainerStatus;
  },
  async *logs() {
    /* no-op */
  },
  async exec() {
    throw new Error("ACA runtime: use AcaContainerRuntime for exec");
  },
  async destroy() {
    /* no-op */
  },
  async ping() {
    return true;
  },
};

let runtime: ContainerRuntime | null = null;

export function getRuntime(): ContainerRuntime {
  if (!runtime) {
    const type = process.env.OPTIO_RUNTIME ?? "docker";
    if (type === "aca") {
      runtime = acaStubRuntime;
    } else {
      runtime = createRuntime({ type: type as "docker" | "kubernetes" });
    }
  }
  return runtime;
}

export async function launchAgentContainer(
  spec: Omit<ContainerSpec, "image" | "workDir" | "labels"> & {
    taskId: string;
    agentType: string;
    image?: string;
  },
): Promise<ContainerHandle> {
  const rt = getRuntime();
  const fullSpec: ContainerSpec = {
    image: spec.image ?? process.env.OPTIO_AGENT_IMAGE ?? DEFAULT_AGENT_IMAGE,
    command: spec.command,
    env: spec.env,
    workDir: "/workspace",
    labels: {
      "optio.task-id": spec.taskId,
      "optio.agent-type": spec.agentType,
      "managed-by": "optio",
    },
    cpuLimit: spec.cpuLimit,
    memoryLimit: spec.memoryLimit,
    volumes: spec.volumes,
    networkMode: spec.networkMode,
  };
  return rt.create(fullSpec);
}

export async function getContainerStatus(handle: ContainerHandle): Promise<ContainerStatus> {
  return getRuntime().status(handle);
}

export function streamContainerLogs(
  handle: ContainerHandle,
  opts?: { follow?: boolean },
): AsyncIterable<string> {
  return getRuntime().logs(handle, opts);
}

export async function destroyAgentContainer(handle: ContainerHandle): Promise<void> {
  return getRuntime().destroy(handle);
}

export async function checkRuntimeHealth(): Promise<boolean> {
  // ACA runtime: the API is already running inside Azure Container Apps,
  // so the runtime is inherently available — no ping needed.
  if ((process.env.OPTIO_RUNTIME ?? "docker") === "aca") return true;
  return getRuntime().ping();
}

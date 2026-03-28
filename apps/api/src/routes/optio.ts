import type { FastifyInstance } from "fastify";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";

const NAMESPACE = "optio";
const POD_ROLE_LABEL = "optio.pod-role=optio";

// Cache status to avoid hitting the K8s API on every poll.
let cachedStatus: { ready: boolean; podName: string | null } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

/** @internal Reset the cache — only for tests. */
export function _resetCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}

function getK8sApi(): CoreV1Api {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc.makeApiClient(CoreV1Api);
}

async function getOptioPodStatus(): Promise<{
  ready: boolean;
  podName: string | null;
}> {
  const now = Date.now();
  if (cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  try {
    const k8s = getK8sApi();
    const res = await k8s.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: POD_ROLE_LABEL,
    });

    const pods = res.items ?? [];
    if (pods.length === 0) {
      cachedStatus = { ready: false, podName: null };
      cachedAt = now;
      return cachedStatus;
    }

    const pod = pods[0];
    const podName = pod.metadata?.name ?? null;
    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions ?? [];
    const readyCondition = conditions.find((c) => c.type === "Ready");
    const ready = phase === "Running" && readyCondition?.status === "True";

    cachedStatus = { ready, podName };
    cachedAt = now;
    return cachedStatus;
  } catch {
    cachedStatus = { ready: false, podName: null };
    cachedAt = now;
    return cachedStatus;
  }
}

export async function optioRoutes(app: FastifyInstance) {
  app.get("/api/optio/status", async (_req, reply) => {
    const enabled = process.env.OPTIO_POD_ENABLED === "true";
    if (!enabled) {
      return reply.send({ ready: false, podName: null, enabled: false });
    }

    const status = await getOptioPodStatus();
    return reply.send({ ...status, enabled: true });
  });
}

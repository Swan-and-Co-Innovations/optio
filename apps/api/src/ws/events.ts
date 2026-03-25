import type { FastifyInstance } from "fastify";
import { createSubscriber } from "../services/event-bus.js";
import { authenticateWs } from "./ws-auth.js";
import { getRecentEvents } from "../services/task-service.js";

export async function eventsWs(app: FastifyInstance) {
  app.get("/ws/events", { websocket: true }, async (socket, req) => {
    const user = await authenticateWs(socket, req);
    if (!user) return;

    // Send catch-up: recent state-change events so reconnecting clients stay in sync
    try {
      const recentEvents = await getRecentEvents({ limit: 20 });
      for (const event of recentEvents) {
        socket.send(
          JSON.stringify({
            type: "task:state_changed",
            taskId: event.taskId,
            fromState: event.fromState,
            toState: event.toState,
            timestamp: event.createdAt,
            catchUp: true,
          }),
        );
      }
    } catch {
      // ignore catch-up errors — still subscribe to live events
    }

    const subscriber = createSubscriber();
    const channel = "optio:events";
    subscriber.subscribe(channel);

    subscriber.on("message", (_ch: string, message: string) => {
      socket.send(message);
    });

    socket.on("close", () => {
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    });
  });
}

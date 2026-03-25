import type { TaskState } from "./task.js";

export type WsEvent =
  | TaskStateChangedEvent
  | TaskLogEvent
  | TaskCreatedEvent
  | AuthFailedEvent
  | TaskCommentEvent;

export interface TaskStateChangedEvent {
  type: "task:state_changed";
  taskId: string;
  fromState: TaskState;
  toState: TaskState;
  timestamp: string;
}

export interface TaskLogEvent {
  type: "task:log";
  taskId: string;
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

export interface TaskCreatedEvent {
  type: "task:created";
  taskId: string;
  title: string;
  timestamp: string;
}

export interface AuthFailedEvent {
  type: "auth:failed";
  message: string;
  timestamp: string;
}

export interface TaskCommentEvent {
  type: "task:comment";
  taskId: string;
  commentId: string;
  timestamp: string;
}

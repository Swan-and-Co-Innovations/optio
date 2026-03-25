export enum TaskState {
  PENDING = "pending",
  QUEUED = "queued",
  PROVISIONING = "provisioning",
  RUNNING = "running",
  NEEDS_ATTENTION = "needs_attention",
  PR_OPENED = "pr_opened",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  repoUrl: string;
  repoBranch: string;
  state: TaskState;
  agentType: string;
  containerId?: string;
  prUrl?: string;
  resultSummary?: string;
  errorMessage?: string;
  ticketSource?: string;
  ticketExternalId?: string;
  metadata?: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  fromState?: TaskState;
  toState: TaskState;
  trigger: string;
  message?: string;
  userId?: string;
  createdAt: Date;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId?: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    displayName: string;
    avatarUrl?: string;
  };
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  repoUrl: string;
  repoBranch?: string;
  agentType: string;
  ticketSource?: string;
  ticketExternalId?: string;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
  priority?: number;
}

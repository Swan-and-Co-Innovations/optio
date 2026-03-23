import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  isTerminal,
  getValidTransitions,
  InvalidTransitionError,
} from "./state-machine.js";
import { TaskState } from "../types/task.js";

describe("state-machine", () => {
  describe("canTransition", () => {
    it("allows valid transitions", () => {
      expect(canTransition(TaskState.PENDING, TaskState.QUEUED)).toBe(true);
      expect(canTransition(TaskState.QUEUED, TaskState.PROVISIONING)).toBe(true);
      expect(canTransition(TaskState.PROVISIONING, TaskState.RUNNING)).toBe(true);
      expect(canTransition(TaskState.RUNNING, TaskState.PR_OPENED)).toBe(true);
      expect(canTransition(TaskState.RUNNING, TaskState.FAILED)).toBe(true);
      expect(canTransition(TaskState.FAILED, TaskState.QUEUED)).toBe(true);
    });

    it("allows cancelling queued tasks", () => {
      expect(canTransition(TaskState.QUEUED, TaskState.CANCELLED)).toBe(true);
    });

    it("allows failing queued tasks", () => {
      expect(canTransition(TaskState.QUEUED, TaskState.FAILED)).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(canTransition(TaskState.PENDING, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.COMPLETED, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.FAILED, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.FAILED, TaskState.PROVISIONING)).toBe(false);
    });
  });

  describe("transition", () => {
    it("returns the target state on valid transition", () => {
      expect(transition(TaskState.PENDING, TaskState.QUEUED)).toBe(TaskState.QUEUED);
    });

    it("throws InvalidTransitionError on invalid transition", () => {
      expect(() => transition(TaskState.FAILED, TaskState.PROVISIONING)).toThrow(
        InvalidTransitionError,
      );
    });
  });

  describe("isTerminal", () => {
    it("identifies terminal states", () => {
      expect(isTerminal(TaskState.COMPLETED)).toBe(true);
    });

    it("identifies non-terminal states", () => {
      expect(isTerminal(TaskState.RUNNING)).toBe(false);
      expect(isTerminal(TaskState.FAILED)).toBe(false);
      expect(isTerminal(TaskState.QUEUED)).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns correct transitions for running state", () => {
      const valid = getValidTransitions(TaskState.RUNNING);
      expect(valid).toContain(TaskState.PR_OPENED);
      expect(valid).toContain(TaskState.NEEDS_ATTENTION);
      expect(valid).toContain(TaskState.FAILED);
      expect(valid).toContain(TaskState.CANCELLED);
      expect(valid).not.toContain(TaskState.QUEUED);
    });

    it("returns empty array for terminal state", () => {
      expect(getValidTransitions(TaskState.COMPLETED)).toEqual([]);
    });

    it("includes cancelled and failed for queued state", () => {
      const valid = getValidTransitions(TaskState.QUEUED);
      expect(valid).toContain(TaskState.PROVISIONING);
      expect(valid).toContain(TaskState.CANCELLED);
      expect(valid).toContain(TaskState.FAILED);
    });
  });

  describe("retry lifecycle", () => {
    it("supports failed → queued retry path", () => {
      let state = TaskState.RUNNING;
      state = transition(state, TaskState.FAILED);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("supports cancelled → queued retry path", () => {
      let state = TaskState.QUEUED;
      state = transition(state, TaskState.CANCELLED);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });
  });

  describe("startup reconciliation paths", () => {
    it("can reconcile orphaned queued tasks (queued stays queued-compatible)", () => {
      // Queued tasks just need to be re-added to BullMQ — no state change needed
      expect(canTransition(TaskState.QUEUED, TaskState.PROVISIONING)).toBe(true);
    });

    it("can reconcile orphaned provisioning tasks via fail-then-requeue", () => {
      let state = TaskState.PROVISIONING;
      state = transition(state, TaskState.FAILED);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("can reconcile orphaned running tasks via fail-then-requeue", () => {
      let state = TaskState.RUNNING;
      state = transition(state, TaskState.FAILED);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("rejects direct running → queued (must go through failed)", () => {
      expect(canTransition(TaskState.RUNNING, TaskState.QUEUED)).toBe(false);
    });

    it("allows provisioning → queued for concurrency re-queue", () => {
      expect(canTransition(TaskState.PROVISIONING, TaskState.QUEUED)).toBe(true);
    });
  });

  describe("PR lifecycle auto-resume paths", () => {
    it("supports pr_opened → needs_attention → queued for merge conflicts", () => {
      let state = TaskState.PR_OPENED;
      state = transition(state, TaskState.NEEDS_ATTENTION);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("supports pr_opened → needs_attention → queued for CI failures", () => {
      let state = TaskState.PR_OPENED;
      state = transition(state, TaskState.NEEDS_ATTENTION);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("supports pr_opened → needs_attention → queued for review changes", () => {
      let state = TaskState.PR_OPENED;
      state = transition(state, TaskState.NEEDS_ATTENTION);
      state = transition(state, TaskState.QUEUED);
      expect(state).toBe(TaskState.QUEUED);
    });

    it("rejects direct pr_opened → queued", () => {
      expect(canTransition(TaskState.PR_OPENED, TaskState.QUEUED)).toBe(false);
    });

    it("allows failed → completed when PR merges after agent fix", () => {
      expect(canTransition(TaskState.FAILED, TaskState.COMPLETED)).toBe(true);
    });
  });
});

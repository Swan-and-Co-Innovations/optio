import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StateBadge } from "./state-badge";

afterEach(() => {
  cleanup();
});

describe("StateBadge", () => {
  it("renders the correct label for known states", () => {
    const { rerender } = render(<StateBadge state="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();

    rerender(<StateBadge state="completed" />);
    expect(screen.getByText("Done")).toBeInTheDocument();

    rerender(<StateBadge state="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();

    rerender(<StateBadge state="pr_opened" />);
    expect(screen.getByText("PR")).toBeInTheDocument();

    rerender(<StateBadge state="needs_attention" />);
    expect(screen.getByText("Attention")).toBeInTheDocument();

    rerender(<StateBadge state="provisioning" />);
    expect(screen.getByText("Setup")).toBeInTheDocument();

    rerender(<StateBadge state="cancelled" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders the raw state for unknown states", () => {
    render(<StateBadge state="unknown_state" />);
    expect(screen.getByText("unknown_state")).toBeInTheDocument();
  });

  it("renders a dot by default", () => {
    const { container } = render(<StateBadge state="running" />);
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("hides the dot when showDot is false", () => {
    const { container } = render(<StateBadge state="running" showDot={false} />);
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(0);
  });

  it("applies pulse class for running state", () => {
    const { container } = render(<StateBadge state="running" />);
    const dot = container.querySelector(".rounded-full");
    expect(dot?.className).toContain("glow-dot");
  });

  it("applies pulse class for provisioning state", () => {
    const { container } = render(<StateBadge state="provisioning" />);
    const dot = container.querySelector(".rounded-full");
    expect(dot?.className).toContain("glow-dot");
  });

  it("does not apply pulse class for completed state", () => {
    const { container } = render(<StateBadge state="completed" />);
    const dot = container.querySelector(".rounded-full");
    expect(dot?.className).not.toContain("glow-dot");
  });

  it("renders Stuck pill when isStalled is true", () => {
    const { rerender } = render(<StateBadge state="running" isStalled={true} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Stuck")).toBeInTheDocument();

    // does not render Stuck pill when isStalled is false
    rerender(<StateBadge state="running" isStalled={false} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Stuck")).not.toBeInTheDocument();

    // does not render Stuck pill when isStalled is undefined
    rerender(<StateBadge state="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Stuck")).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ActionCard } from "./action-card";
import type { OptioPendingAction } from "@/hooks/use-optio-chat";

describe("ActionCard", () => {
  afterEach(cleanup);

  const baseAction: OptioPendingAction = {
    id: "action-1",
    description: "I'd like to do the following:",
    items: ["Retry task #201", "Update concurrency to 4"],
    decision: null,
  };

  it("renders the action description", () => {
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("I'd like to do the following:")).toBeInTheDocument();
  });

  it("renders all action items", () => {
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("Retry task #201")).toBeInTheDocument();
    expect(screen.getByText("Update concurrency to 4")).toBeInTheDocument();
  });

  it("shows Approve and Deny buttons when undecided", () => {
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });

  it("calls onApprove when Approve is clicked", () => {
    const onApprove = vi.fn();
    render(<ActionCard action={baseAction} onApprove={onApprove} onDeny={vi.fn()} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledWith("action-1");
  });

  it("shows feedback input when Deny is clicked", () => {
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={vi.fn()} />);
    fireEvent.click(screen.getByText("Deny"));
    expect(screen.getByPlaceholderText("Your feedback...")).toBeInTheDocument();
    expect(screen.getByText("What should I change?")).toBeInTheDocument();
  });

  it("calls onDeny with feedback when Send is clicked", () => {
    const onDeny = vi.fn();
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={onDeny} />);
    fireEvent.click(screen.getByText("Deny"));
    const input = screen.getByPlaceholderText("Your feedback...");
    fireEvent.change(input, { target: { value: "Skip the concurrency update" } });
    fireEvent.click(screen.getByText("Send"));
    expect(onDeny).toHaveBeenCalledWith("action-1", "Skip the concurrency update");
  });

  it("calls onDeny with default feedback when Send is clicked with empty input", () => {
    const onDeny = vi.fn();
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={onDeny} />);
    fireEvent.click(screen.getByText("Deny"));
    fireEvent.click(screen.getByText("Send"));
    expect(onDeny).toHaveBeenCalledWith("action-1", "No changes specified");
  });

  it("submits feedback on Enter key", () => {
    const onDeny = vi.fn();
    render(<ActionCard action={baseAction} onApprove={vi.fn()} onDeny={onDeny} />);
    fireEvent.click(screen.getByText("Deny"));
    const input = screen.getByPlaceholderText("Your feedback...");
    fireEvent.change(input, { target: { value: "Change plan" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDeny).toHaveBeenCalledWith("action-1", "Change plan");
  });

  it("shows Approved state when decision is true", () => {
    const approved = { ...baseAction, decision: true as const };
    render(<ActionCard action={approved} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Deny")).not.toBeInTheDocument();
  });

  it("shows Denied state when decision is false", () => {
    const denied = { ...baseAction, decision: false as const };
    render(<ActionCard action={denied} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Deny")).not.toBeInTheDocument();
  });

  it("renders without description when empty", () => {
    const noDesc = { ...baseAction, description: "" };
    render(<ActionCard action={noDesc} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("Retry task #201")).toBeInTheDocument();
  });
});

"use client";

import { useState } from "react";
import { Check, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionProposal } from "./optio-chat-store.js";

interface ActionConfirmationProps {
  proposal: ActionProposal;
  onApprove: (id: string) => void;
  onDeny: (id: string, feedback: string) => void;
}

export function ActionConfirmation({ proposal, onApprove, onDeny }: ActionConfirmationProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  const isResolved = proposal.status !== "pending";

  const handleDeny = () => {
    if (showFeedback && feedback.trim()) {
      onDeny(proposal.id, feedback.trim());
    } else {
      setShowFeedback(true);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border-2 overflow-hidden",
        isResolved
          ? proposal.status === "approved"
            ? "border-success/30 bg-success/5"
            : "border-error/30 bg-error/5"
          : "border-primary/30 bg-primary/5",
      )}
    >
      <div className="px-4 py-3">
        <p className="text-sm font-medium mb-2">{proposal.description}</p>
        <ul className="space-y-1.5">
          {proposal.actions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
              <span className="text-primary mt-0.5 shrink-0">&bull;</span>
              {action}
            </li>
          ))}
        </ul>
      </div>

      {!isResolved && (
        <div className="border-t border-border/50 px-4 py-3 space-y-2">
          {showFeedback && (
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && feedback.trim()) {
                    onDeny(proposal.id, feedback.trim());
                  }
                }}
                placeholder="What should I change?"
                className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50"
                autoFocus
              />
              <button
                onClick={() => {
                  if (feedback.trim()) onDeny(proposal.id, feedback.trim());
                }}
                disabled={!feedback.trim()}
                className="px-3 py-1.5 rounded-md text-xs bg-text-muted/10 text-text-muted hover:bg-text-muted/20 transition-colors disabled:opacity-50"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleDeny}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-error/10 text-error hover:bg-error/20 transition-colors btn-press"
            >
              <X className="w-3.5 h-3.5" />
              Deny
            </button>
            <button
              onClick={() => onApprove(proposal.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-success/10 text-success hover:bg-success/20 transition-colors btn-press"
            >
              <Check className="w-3.5 h-3.5" />
              Approve
            </button>
          </div>
        </div>
      )}

      {isResolved && (
        <div
          className={cn(
            "border-t px-4 py-2 text-xs",
            proposal.status === "approved"
              ? "border-success/20 text-success/70"
              : "border-error/20 text-error/70",
          )}
        >
          {proposal.status === "approved"
            ? "Approved"
            : `Denied${proposal.feedback ? `: ${proposal.feedback}` : ""}`}
        </div>
      )}
    </div>
  );
}

"use client";

import { create } from "zustand";

export type OptioChatStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "thinking"
  | "error"
  | "unavailable";

export interface ActionProposal {
  id: string;
  description: string;
  actions: string[];
  status: "pending" | "approved" | "denied";
  feedback?: string;
}

export interface OptioChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actionProposal?: ActionProposal;
}

interface OptioChatState {
  isOpen: boolean;
  messages: OptioChatMessage[];
  status: OptioChatStatus;
  prefill: string;
  exchangeCount: number;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  openWithPrefill: (text: string) => void;
  addMessage: (msg: OptioChatMessage) => void;
  updateMessage: (id: string, updates: Partial<OptioChatMessage>) => void;
  setStatus: (status: OptioChatStatus) => void;
  setPrefill: (text: string) => void;
  resetConversation: () => void;
  incrementExchangeCount: () => void;
}

const MAX_EXCHANGES = 20;

export const useOptioChatStore = create<OptioChatState>((set) => ({
  isOpen: false,
  messages: [],
  status: "ready",
  prefill: "",
  exchangeCount: 0,

  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false }),
  togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),
  openWithPrefill: (text: string) => set({ isOpen: true, prefill: text }),

  addMessage: (msg) =>
    set((s) => ({
      messages: [...s.messages, msg],
    })),

  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  setStatus: (status) => set({ status }),
  setPrefill: (prefill) => set({ prefill }),

  resetConversation: () =>
    set({
      messages: [],
      exchangeCount: 0,
      prefill: "",
      status: "ready",
    }),

  incrementExchangeCount: () => set((s) => ({ exchangeCount: s.exchangeCount + 1 })),
}));

export { MAX_EXCHANGES };

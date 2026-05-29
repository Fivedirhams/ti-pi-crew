import type { AgentProgress } from "../runtime/progress-tracker.ts";

export type CrewEventType =
  | "agent:progress"
  | "agent:complete"
  | "agent:error"
  | "run:start"
  | "run:complete";

export interface CrewEvent {
  type: CrewEventType;
  runId: string;
  agentId?: string;
  payload?: AgentProgress | string;
  timestamp: number;
}

type CrewEventListener = (event: CrewEvent) => void;

class EventBus {
  private listeners = new Map<CrewEventType, Set<CrewEventListener>>();
  private static instance?: EventBus;

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  emit(event: CrewEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (e) {
          console.error("[EventBus] Listener error:", e);
        }
      }
    }
  }

  on(type: CrewEventType, listener: CrewEventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  off(type: CrewEventType, listener: CrewEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

export const crewEventBus = EventBus.getInstance();
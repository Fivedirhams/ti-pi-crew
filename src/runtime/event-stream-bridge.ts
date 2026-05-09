import { runEventBus } from "../ui/run-event-bus.ts";
import { subprocessToolRegistry, type SubprocessToolEvent } from "./subprocess-tool-registry.ts";

export interface StreamBridgeEvent {
	runId: string;
	taskId: string;
	eventType: string;
	toolName?: string;
	toolArgs?: string;
	intent?: string;
	tokens?: number;
	timestamp: number;
	extractedToolData?: Record<string, unknown>;
}

const activeBridges = new Map<string, (event: StreamBridgeEvent) => void>();

export function registerStreamBridge(runId: string): { handler: (event: StreamBridgeEvent) => void; dispose: () => void } {
	const existing = activeBridges.get(runId);
	if (existing) {
		return { handler: existing, dispose: () => unregisterStreamBridge(runId) };
	}

	const handler = (event: StreamBridgeEvent) => {
		runEventBus.emit({
			type: "worker_status",
			runId: event.runId,
			taskId: event.taskId,
			data: event,
		});
	};

	activeBridges.set(runId, handler);
	return { handler, dispose: () => unregisterStreamBridge(runId) };
}

export function unregisterStreamBridge(runId: string): void {
	activeBridges.delete(runId);
}

export function bridgeEventFromJsonEvent(runId: string, taskId: string, event: unknown): StreamBridgeEvent | null {
	if (!event || typeof event !== "object") return null;
	const record = event as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : "";

	const result: StreamBridgeEvent = {
		runId,
		taskId,
		eventType: type,
		timestamp: Date.now(),
	};

	if (typeof record.toolName === "string") result.toolName = record.toolName;
	if (record.args && typeof record.args === "object") {
		try {
			const json = JSON.stringify(record.args);
			// Truncate at a JSON boundary to avoid breaking structure
			result.toolArgs = json.length > 200 ? json.slice(0, 197) + "..." : json;
		} catch {
			/* skip */
		}
	}
	if (typeof record.intent === "string") result.intent = record.intent;

	// Extract tokens from usage/message_end events
	const usage = record.usage ?? (record.message as Record<string, unknown> | undefined)?.usage;
	if (usage && typeof usage === "object") {
		const u = usage as Record<string, unknown>;
		const input = typeof u.input === "number" ? u.input : 0;
		const output = typeof u.output === "number" ? u.output : 0;
		if (input || output) result.tokens = input + output;
	}

	// Attach extracted tool data via subprocess tool registry
	if (result.toolName && subprocessToolRegistry.hasHandler(result.toolName)) {
		const handler = subprocessToolRegistry.getHandler(result.toolName);
		if (handler?.extractData) {
			const extracted = handler.extractData({
				toolName: result.toolName,
				toolCallId: (record.toolCallId as string) ?? "",
				args: record.args as Record<string, unknown> | undefined,
				result: record.result as SubprocessToolEvent["result"],
				isError: record.isError as boolean | undefined,
			});
			if (extracted !== undefined) {
				result.extractedToolData = { [result.toolName]: extracted };
			}
		}
	}

	return result;
}

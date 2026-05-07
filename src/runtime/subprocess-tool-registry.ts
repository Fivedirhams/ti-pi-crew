export interface SubprocessToolEvent {
	toolName: string;
	toolCallId: string;
	args?: Record<string, unknown>;
	result?: { content: Array<{ type: string; text?: string }>; details?: unknown };
	isError?: boolean;
}

export interface SubprocessToolHandler<TData = unknown> {
	extractData?: (event: SubprocessToolEvent) => TData | undefined;
	shouldTerminate?: (event: SubprocessToolEvent) => boolean;
}

export interface SubprocessToolRegistry {
	register<T>(toolName: string, handler: SubprocessToolHandler<T>): void;
	getHandler(toolName: string): SubprocessToolHandler | undefined;
	hasHandler(toolName: string): boolean;
	getRegisteredTools(): string[];
	extractAll(event: SubprocessToolEvent): Record<string, unknown>;
}

class SubprocessToolRegistryImpl implements SubprocessToolRegistry {
	private readonly handlers = new Map<string, SubprocessToolHandler>();

	register<T>(toolName: string, handler: SubprocessToolHandler<T>): void {
		this.handlers.set(toolName, handler as SubprocessToolHandler);
	}

	getHandler(toolName: string): SubprocessToolHandler | undefined {
		return this.handlers.get(toolName);
	}

	hasHandler(toolName: string): boolean {
		return this.handlers.has(toolName);
	}

	getRegisteredTools(): string[] {
		return [...this.handlers.keys()];
	}

	extractAll(event: SubprocessToolEvent): Record<string, unknown> {
		const extracted: Record<string, unknown> = {};
		for (const [toolName, handler] of this.handlers) {
			if (handler.extractData) {
				const data = handler.extractData(event);
				if (data !== undefined) {
					extracted[toolName] = data;
				}
			}
		}
		return extracted;
	}
}

export const subprocessToolRegistry: SubprocessToolRegistry = new SubprocessToolRegistryImpl();

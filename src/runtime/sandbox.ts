import * as vm from "node:vm";

export interface SandboxOptions {
	timeout?: number;
	globals?: Record<string, unknown>;
	onLog?: (message: string) => void;
	onError?: (message: string) => void;
	onWarn?: (message: string) => void;
}

/**
 * WorkflowSandbox provides a safe execution context for dynamic JavaScript
 * in pi-crew workflows. It creates a VM context with restricted globals
 * and provides safe console and process objects.
 */
export class WorkflowSandbox {
	private context: vm.Context;
	private timeout: number;

	constructor(options: SandboxOptions = {}) {
		this.timeout = options.timeout ?? 30000;
		this.context = this.createSafeContext(options.globals ?? {}, options);
	}

	private createSafeContext(globals: Record<string, unknown>, options: SandboxOptions): vm.Context {
		// Frozen process object - limited access to process internals
		const frozenProcess = {
			cwd: () => process.cwd(),
			platform: process.platform,
			arch: process.arch,
			version: process.version,
			env: { ...process.env }, // Copy, not reference
			// Explicitly excluded: exit, kill, hrtime, memoryUsage, cpuUsage, etc.
		};

		// Safe console implementation
		const safeConsole = {
			log: (...args: unknown[]) => (options.onLog ?? console.log)(args.map(formatArg).join(" ")),
			error: (...args: unknown[]) => (options.onError ?? console.error)(args.map(formatArg).join(" ")),
			warn: (...args: unknown[]) => (options.onWarn ?? console.warn)(args.map(formatArg).join(" ")),
			info: (...args: unknown[]) => (options.onLog ?? console.log)(args.map(formatArg).join(" ")),
			debug: (...args: unknown[]) => (options.onLog ?? console.log)(args.map(formatArg).join(" ")),
			table: (data: unknown) => (options.onLog ?? console.log)(JSON.stringify(data, null, 2)),
			dir: (data: unknown) => (options.onLog ?? console.log)(JSON.stringify(data, null, 2)),
		};

		return vm.createContext({
			...globals,
			process: frozenProcess,
			console: safeConsole,
			// Safe Math (static methods only)
			Math: Math,
			// Safe JSON
			JSON: JSON,
			// Safe Number
			Number: Number,
			// Safe String
			String: String,
			// Safe Boolean
			Boolean: Boolean,
			// Safe Array
			Array: Array,
			// Safe Object
			Object: Object,
			// Safe RegExp
			RegExp: RegExp,
			// Safe Error
			Error: Error,
			// Safe Map
			Map: Map,
			// Safe Set
			Set: Set,
			// Safe Promise
			Promise: Promise,
			// Safe Symbol
			Symbol: Symbol,
			// Safe parseInt/parseFloat
			parseInt: parseInt,
			parseFloat: parseFloat,
			isNaN: isNaN,
			isFinite: isFinite,
			// Safe encodeURI/decodeURI
			encodeURI: encodeURI,
			decodeURI: decodeURI,
			encodeURIComponent: encodeURIComponent,
			decodeURIComponent: decodeURIComponent,
			// Safe typed arrays (read-only buffer views)
			ArrayBuffer: ArrayBuffer,
			Uint8Array: Uint8Array,
		});
	}

	/**
	 * Execute JavaScript code in the sandboxed context.
	 * @param code - The JavaScript code to execute
	 * @param timeout - Optional timeout override in milliseconds
	 * @returns The result of the script execution
	 */
	execute(code: string, timeout?: number): unknown {
		const effectiveTimeout = timeout ?? this.timeout;
		// Wrap code in an IIFE to allow return statements
		const wrappedCode = `(function(){ ${code} })()`;
		const script = new vm.Script(wrappedCode, {
			filename: "workflow.js",
		});

		return script.runInContext(this.context, {
			timeout: effectiveTimeout,
			displayErrors: true,
		});
	}

	/**
	 * Execute an async function in the sandboxed context.
	 * @param fn - Async function to execute
	 * @param timeout - Optional timeout override in milliseconds
	 * @returns Promise resolving to the function result
	 */
	async executeAsync<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
		const effectiveTimeout = timeout ?? this.timeout;
		const script = new vm.Script(`(${fn.toString()})()`, {
			filename: "workflow.js",
		});

		const result = script.runInContext(this.context, {
			timeout: effectiveTimeout,
			displayErrors: true,
		});

		return result as Promise<T>;
	}

	/**
	 * Create a new sandbox with additional globals merged in.
	 */
	extend(additionalGlobals: Record<string, unknown>): WorkflowSandbox {
		const newSandbox = new WorkflowSandbox({
			timeout: this.timeout,
			globals: { ...additionalGlobals },
		});
		return newSandbox;
	}

	/**
	 * Get the VM context for advanced use cases.
	 */
	getContext(): vm.Context {
		return this.context;
	}
}

function formatArg(arg: unknown): string {
	if (typeof arg === "string") return arg;
	if (arg === null) return "null";
	if (arg === undefined) return "undefined";
	if (typeof arg === "object") {
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}
	return String(arg);
}

/**
 * Create a pre-configured sandbox for workflow execution.
 */
export function createWorkflowSandbox(options?: SandboxOptions): WorkflowSandbox {
	return new WorkflowSandbox(options);
}

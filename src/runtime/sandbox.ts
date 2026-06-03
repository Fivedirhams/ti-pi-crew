import * as vm from "node:vm";

import { sanitizeEnvSecrets } from "../utils/env-filter.ts";

/**
 * Forbidden patterns for sandbox security (C4).
 * These are checked during script compilation/validation.
 */
const FORBIDDEN_PATTERNS = [
	// ESM patterns
	/import\s*\(/,                    // Dynamic import()
	/import\s+.*from\s+/,            // Static import
	/export\s+(default\s+)?/,         // Export statements
	/import\.meta/,                   // import.meta
	// Module patterns
	/require\s*\(/,                   // CommonJS require
	/module\./,                        // module.exports, module.id, etc.
	/__dirname/,                       // __dirname reference
	/__filename/,                      // __filename reference
	/\bdefine\s*\(/,                  // AMD define
	// Global escape vectors
	/\bglobalThis\b/,                 // globalThis reference
	/\bglobal\b/,                      // global reference (Node.js)
] as const;

/**
 * Whitelist of allowed identifiers for strict mode.
 * Only these identifiers can be used in sandboxed code.
 */
const ALLOWED_IDENTIFIERS = new Set([
	// Built-in constructors
	"Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Number", "Object", "Promise", "RegExp", "Set", "String", "Symbol",
	// Static methods
	"ArrayBuffer", "Uint8Array", "parseInt", "parseFloat", "isNaN", "isFinite",
	// URI encoding
	"encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent",
	// Math (read-only)
	"Math",
	// Console (safe methods only)
	"console",
	// Process (limited)
	"process",
]);

Object.freeze(FORBIDDEN_PATTERNS);

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
		// C4: Frozen process object - limited access to process internals.
		// FIX (Round 14, C1+C3): Sanitize env to a small allow-list so secrets
		// like ANTHROPIC_API_KEY, AWS_SECRET_ACCESS_KEY, etc. never reach
		// sandboxed code. Then deep-freeze the env so callers cannot inject
		// new keys (Object.freeze on the wrapper alone would not prevent
		// `frozenProcess.env.newKey = "..."`).
		const safeEnv = Object.freeze(sanitizeEnvSecrets(process.env, {
			allowList: [
				"NODE_ENV",
				"PI_CREW_*",
				"PATH",
				"PATH_SEPARATOR",
				"USERPROFILE",
				"USER",
				"SHELL",
				"LANG",
				"LC_ALL",
				"LC_CTYPE",
				"TERM",
				"TZ",
				"TMPDIR",
				"TMP",
				"TEMP",
			],
		}));
		const frozenProcess = Object.freeze({
			cwd: () => process.cwd(),
			platform: process.platform,
			arch: process.arch,
			version: process.version,
			env: safeEnv,
			// Explicitly excluded: exit, kill, hrtime, memoryUsage, cpuUsage, binding, dlopen, _tickCallback
		});

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

		// C4: Ensure globals don't include process, global, or globalThis references
		const safeGlobals: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(globals)) {
			// Filter out dangerous global references
			if (key === "process" || key === "global" || key === "globalThis" || key === "GLOBAL") {
				continue; // Skip - these are handled by frozenProcess or intentionally omitted
			}
			safeGlobals[key] = value;
		}

		// Freeze prototypes before passing to sandbox context to prevent
		// prototype pollution from sandboxed code escaping the sandbox.
		Object.freeze(Object.prototype);
		Object.freeze(Array.prototype);

		// Context isolation - explicitly list allowed globals
		const contextGlobals: Record<string, unknown> = {
			...safeGlobals,
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
		};

		return vm.createContext(contextGlobals);
	}

	/**
	 * C4: Validate code before execution - check for forbidden patterns and
	 * ensure compilation is safe.
	 */
	private validateScript(code: string): void {
		// Check for ESM/module patterns
		for (const pattern of FORBIDDEN_PATTERNS) {
			if (pattern.test(code)) {
				throw new Error(`Forbidden pattern detected: ${pattern.source}`);
			}
		}

		// Check for import.meta specifically (C4)
		if (/import\.meta/.test(code)) {
			throw new Error("import.meta is not allowed in sandboxed code");
		}

		// Verify compilation succeeds (C4)
		const wrappedCode = `(function(){ ${code} })()`;
		new vm.Script(wrappedCode, {
			filename: "sandbox-validate.js",
		});
	}

	/**
	 * Execute JavaScript code in the sandboxed context.
	 * @param code - The JavaScript code to execute
	 * @param timeout - Optional timeout override in milliseconds
	 * @returns The result of the script execution
	 * @throws Error if code contains forbidden patterns or fails compilation
	 */
	execute(code: string, timeout?: number): unknown {
		// C4: Validate script before execution
		this.validateScript(code);

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
		// FIX (Round 14, C2): Run the same validation chain as `execute()` so
		// forbidden patterns (require/import/__dirname/etc.) cannot slip through
		// by hiding inside an arrow function. Previously the function body was
		// stringified and executed with no checks.
		const fnSource = fn.toString();
		this.validateScript(fnSource);
		const script = new vm.Script(`(${fnSource})()`, {
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

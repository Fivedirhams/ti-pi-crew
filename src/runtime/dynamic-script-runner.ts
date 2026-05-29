import * as vm from "node:vm";
import { WorkflowSandbox, type SandboxOptions } from "./sandbox.ts";

/**
 * Forbidden globals that could compromise sandbox security or cause side effects.
 * These are checked during AST validation before execution.
 */
export const FORBIDDEN_GLOBALS = [
	"Date",
	"Math.random",
	"require",
	"import",
	"module",
	"exports",
	"__dirname",
	"__filename",
	"process.exit",
	"process.kill",
	"process.hrtime",
	"process.memoryUsage",
	"process.cpuUsage",
	"process.binding",
	"process.dlopen",
	"process._tickCallback",
	"eval",
	"Function",
	"AsyncFunction",
	"GeneratorFunction",
	"Proxy",
	"Reflect",
	"WebAssembly",
	"global",
	"globalThis",
	"window",
	"document",
	"XMLHttpRequest",
	"fetch",
	"WebSocket",
	"Worker",
	"SharedArrayBuffer",
	"Atomics",
] as const;

// Freeze the array at runtime to ensure it's truly immutable
Object.freeze(FORBIDDEN_GLOBALS);

export type ForbiddenGlobal = (typeof FORBIDDEN_GLOBALS)[number];

export interface ScriptValidationResult {
	valid: boolean;
	errors: ScriptValidationError[];
	warnings: ScriptValidationWarning[];
}

export interface ScriptValidationError {
	type: "forbidden_global" | "forbidden_syntax" | "parse_error";
	message: string;
	location?: { line: number; column: number };
}

export interface ScriptValidationWarning {
	type: "deprecated_api" | "potentially_unsafe";
	message: string;
	location?: { line: number; column: number };
}

export interface DynamicScriptOptions {
	timeout?: number;
	maxTokens?: number;
	allowAwait?: boolean;
	allowAsync?: boolean;
	strictMode?: boolean;
}

export interface ScriptExecutionResult {
	success: boolean;
	value?: unknown;
	error?: string;
	executionTime: number;
	validation: ScriptValidationResult;
}

/**
 * DynamicScriptRunner executes JavaScript in a VM sandbox with AST validation
 * and forbidden pattern detection.
 * 
 * Note: AST parsing is simplified without acorn. For full AST validation,
 * add acorn as a dependency.
 */
export class DynamicScriptRunner {
	private sandbox: WorkflowSandbox;
	private defaultTimeout: number;
	private options: DynamicScriptOptions;

	constructor(options: DynamicScriptOptions = {}) {
		this.defaultTimeout = options.timeout ?? 30000;
		this.options = options;
		this.sandbox = new WorkflowSandbox({
			timeout: this.defaultTimeout,
		});
	}

	/**
	 * Validate script before execution.
	 * Performs basic pattern checking for forbidden globals.
	 * Note: Full AST parsing requires acorn dependency.
	 */
	validate(code: string): ScriptValidationResult {
		const errors: ScriptValidationError[] = [];
		const warnings: ScriptValidationWarning[] = [];

		// Check for parse errors by attempting to execute with a return wrapper
		try {
			new vm.Script(`(function(){ ${code} })()`, {
				filename: "validation.js",
			});
		} catch (parseError) {
			errors.push({
				type: "parse_error",
				message: `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
			});
			return { valid: false, errors, warnings };
		}

		// Check for forbidden globals using regex patterns
		this.checkForForbiddenGlobals(code, errors);

		// Check for forbidden syntax patterns
		this.checkForForbiddenSyntax(code, errors, warnings);

		// Check for potentially unsafe patterns
		this.checkForPotentiallyUnsafePatterns(code, warnings);

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	private checkForForbiddenGlobals(code: string, errors: ScriptValidationError[]): void {
		// Check each forbidden global pattern
		for (const forbidden of FORBIDDEN_GLOBALS) {
			if (forbidden.includes(".")) {
				// Check for member expressions like Math.random, process.exit
				const [obj, prop] = forbidden.split(".");
				const pattern = new RegExp(`\\b${obj}\\s*\\.\\s*${prop}\\b`);
				if (pattern.test(code)) {
					errors.push({
						type: "forbidden_global",
						message: `Forbidden global access: '${forbidden}'`,
					});
				}
			} else {
				// Check for simple identifiers
				// But avoid false positives like "myDate" matching "Date"
				const pattern = new RegExp(`\\b${forbidden}\\b`);
				if (pattern.test(code)) {
					errors.push({
						type: "forbidden_global",
						message: `Forbidden global: '${forbidden}'`,
					});
				}
			}
		}
	}

	private checkForForbiddenSyntax(
		code: string,
		errors: ScriptValidationError[],
		warnings: ScriptValidationWarning[],
	): void {
		// Check for eval()
		if (/\beval\s*\(/.test(code)) {
			errors.push({
				type: "forbidden_syntax",
				message: "eval() is not allowed",
			});
		}

		// Check for Function constructor
		if (/\bnew\s+Function\s*\(/.test(code) || /\bFunction\s*\(\s*['"`]/.test(code)) {
			errors.push({
				type: "forbidden_syntax",
				message: "Function constructor is not allowed",
			});
		}

		// Check for AsyncFunction constructor
		if (/\bnew\s+AsyncFunction\s*\(/.test(code) || /\bAsyncFunction\s*\(\s*['"`]/.test(code)) {
			errors.push({
				type: "forbidden_syntax",
				message: "AsyncFunction constructor is not allowed",
			});
		}

		// Check for GeneratorFunction constructor
		if (/\bnew\s+GeneratorFunction\s*\(/.test(code)) {
			errors.push({
				type: "forbidden_syntax",
				message: "GeneratorFunction constructor is not allowed",
			});
		}

		// Check for Promise constructor - warn but don't block
		if (/\bnew\s+Promise\s*\(/.test(code)) {
			warnings.push({
				type: "potentially_unsafe",
				message: "Direct Promise constructor usage - consider using async/await instead",
			});
		}
	}

	private checkForPotentiallyUnsafePatterns(code: string, warnings: ScriptValidationWarning[]): void {
		// Check for try-catch with broad catch - warn
		if (/\bcatch\s*\(\s*\)\s*\{/.test(code)) {
			warnings.push({
				type: "potentially_unsafe",
				message: "Broad catch clause - consider catching specific error types",
			});
		}

		// Check for nested function declarations - warn about potential complexity
		if (/function\s+\w+\s*\([^)]*\)\s*\{[^}]*function\s+/.test(code)) {
			warnings.push({
				type: "potentially_unsafe",
				message: "Nested function declaration - consider extracting to module level",
			});
		}

		// Check for with statement - deprecated and potentially unsafe
		if (/\bwith\s*\(/.test(code)) {
			warnings.push({
				type: "potentially_unsafe",
				message: "with statement is deprecated and potentially unsafe",
			});
		}
	}

	/**
	 * Execute a script with validation.
	 * @param code - The JavaScript code to execute
	 * @param options - Execution options
	 * @returns The execution result
	 */
	execute(code: string, options?: DynamicScriptOptions): ScriptExecutionResult {
		const startTime = Date.now();
		const timeout = options?.timeout ?? this.defaultTimeout;

		// Validate first
		const validation = this.validate(code);
		if (!validation.valid) {
			return {
				success: false,
				error: validation.errors.map((e) => e.message).join("; "),
				executionTime: Date.now() - startTime,
				validation,
			};
		}

		try {
			const value = this.sandbox.execute(code, timeout);
			return {
				success: true,
				value,
				executionTime: Date.now() - startTime,
				validation,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTime: Date.now() - startTime,
				validation,
			};
		}
	}

	/**
	 * Execute an async script with validation.
	 * @param code - The JavaScript code to execute (must be async or return Promise)
	 * @param options - Execution options
	 * @returns Promise resolving to the execution result
	 */
	async executeAsync(code: string, options?: DynamicScriptOptions): Promise<ScriptExecutionResult> {
		const startTime = Date.now();
		const timeout = options?.timeout ?? this.defaultTimeout;

		// Wrap in async IIFE for async/await support
		const asyncCode = `(async () => { ${code} })()`;

		// Validate the wrapped code (not the original code)
		const validation = this.validate(asyncCode);
		if (!validation.valid) {
			return {
				success: false,
				error: validation.errors.map((e) => e.message).join("; "),
				executionTime: Date.now() - startTime,
				validation,
			};
		}

		try {
			// Execute using vm directly for async support
			const script = new vm.Script(asyncCode, {
				filename: "workflow.js",
			});

			const result = await script.runInContext(this.sandbox.getContext(), {
				timeout,
				displayErrors: true,
			});
			return {
				success: true,
				value: result,
				executionTime: Date.now() - startTime,
				validation,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTime: Date.now() - startTime,
				validation,
			};
		}
	}

	/**
	 * Execute a script without validation (assumes pre-validated).
	 * Use with caution - prefer execute() for untrusted scripts.
	 */
	executeUnchecked(code: string, timeout?: number): ScriptExecutionResult {
		const startTime = Date.now();

		try {
			const value = this.sandbox.execute(code, timeout ?? this.defaultTimeout);
			return {
				success: true,
				value,
				executionTime: Date.now() - startTime,
				validation: { valid: true, errors: [], warnings: [] },
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTime: Date.now() - startTime,
				validation: { valid: true, errors: [], warnings: [] },
			};
		}
	}

	/**
	 * Get the list of forbidden globals for documentation.
	 */
	getForbiddenGlobals(): readonly string[] {
		return FORBIDDEN_GLOBALS;
	}
}

/**
 * Create a pre-configured script runner for workflow execution.
 */
export function createScriptRunner(options?: DynamicScriptOptions): DynamicScriptRunner {
	return new DynamicScriptRunner(options);
}

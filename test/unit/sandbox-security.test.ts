/**
 * Tests for WorkflowSandbox security fixes (Round 14, Phase 1):
 * - C1: process.env sanitized to allow-list (no API key leakage)
 * - C2: executeAsync now validates forbidden patterns
 * - C3: env object is deeply frozen (no injection)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflowSandbox, WorkflowSandbox } from "../../src/runtime/sandbox.ts";

test("C1: sandbox env is filtered to allow-list (no API key leakage)", () => {
	const sandbox = createWorkflowSandbox();
	// Set a fake secret in process.env to verify it does NOT leak into sandbox.
	process.env.TEST_API_KEY = "sk-test-secret-12345";
	try {
		const result = sandbox.execute(`
			// Return the keys visible in process.env from inside the sandbox
			const keys = Object.keys(process.env);
			return keys.includes("TEST_API_KEY");
		`) as boolean;
		assert.equal(result, false, "sandbox must NOT expose TEST_API_KEY");
	} finally {
		delete process.env.TEST_API_KEY;
	}
});

test("C1: sandbox env allows whitelisted vars through", () => {
	// Set env var BEFORE creating the sandbox, since the sandbox captures env
	// at construction time. Use a var already in the sandbox allowlist.
	process.env.PI_CREW_DEPTH = "3";
	let sandbox: ReturnType<typeof createWorkflowSandbox>;
	try {
		sandbox = createWorkflowSandbox();
	} finally {
		delete process.env.PI_CREW_DEPTH;
	}
	const result = sandbox!.execute(`
		const keys = Object.keys(process.env);
		return keys.includes("PI_CREW_DEPTH");
	`) as boolean;
	assert.equal(result, true, "sandbox should allow PI_CREW_* through");
});

test("C3: sandbox env is deeply frozen (cannot inject new keys)", () => {
	const sandbox = createWorkflowSandbox();
	const result = sandbox.execute(`
		let injected = false;
		try {
			process.env.NEW_INJECTED_KEY = "evil";
			injected = process.env.NEW_INJECTED_KEY === "evil";
		} catch {
			// Either silent no-op or throw is acceptable, but env must not be mutated
			injected = false;
		}
		return injected;
	`) as boolean;
	assert.equal(result, false, "sandbox must prevent env mutation");
});

test("C2: executeAsync rejects require()", async () => {
	const sandbox = createWorkflowSandbox();
	const fn = async () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("fs");
		return fs;
	};
	await assert.rejects(
		() => sandbox.executeAsync(fn),
		/Forbidden pattern/,
		"executeAsync must validate forbidden patterns",
	);
});

test("C2: executeAsync rejects __dirname", async () => {
	const sandbox = createWorkflowSandbox();
	const fn = async () => __dirname;
	await assert.rejects(
		() => sandbox.executeAsync(fn),
		/Forbidden pattern/,
		"executeAsync must reject __dirname reference",
	);
});

test("C2: executeAsync allows safe code", async () => {
	const sandbox = createWorkflowSandbox();
	const fn = async () => {
		const x = await Promise.resolve(42);
		return x * 2;
	};
	const result = await sandbox.executeAsync(fn);
	assert.equal(result, 84);
});

test("WorkflowSandbox class can be extended safely", () => {
	const sandbox = new WorkflowSandbox({ timeout: 1000 });
	const result = sandbox.execute("return 1 + 1;");
	assert.equal(result, 2);
});

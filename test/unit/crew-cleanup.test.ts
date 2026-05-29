import test from "node:test";
import assert from "node:assert/strict";
import { childProcessRegistry, registerChildProcess, unregisterChildProcess } from "../../src/extension/crew-cleanup.ts";

test("ChildProcessRegistry registers processes", () => {
	childProcessRegistry.clear();

	registerChildProcess(1234, "run-1", "agent-1");
	registerChildProcess(5678, "run-1", "agent-2");

	const pids = childProcessRegistry.getAllPids();
	assert.equal(pids.length, 2);
	assert.ok(pids.includes(1234));
	assert.ok(pids.includes(5678));

	childProcessRegistry.clear();
});

test("ChildProcessRegistry unregisters processes", () => {
	childProcessRegistry.clear();

	registerChildProcess(1234, "run-1", "agent-1");
	registerChildProcess(5678, "run-1", "agent-2");

	unregisterChildProcess(1234);

	const pids = childProcessRegistry.getAllPids();
	assert.equal(pids.length, 1);
	assert.ok(!pids.includes(1234));
	assert.ok(pids.includes(5678));

	childProcessRegistry.clear();
});

test("ChildProcessRegistry returns process info", () => {
	childProcessRegistry.clear();

	const before = Date.now();
	registerChildProcess(9999, "run-test", "agent-test");
	const after = Date.now();

	const info = childProcessRegistry.getInfo(9999);
	assert.ok(info !== undefined);
	assert.equal(info!.pid, 9999);
	assert.equal(info!.runId, "run-test");
	assert.equal(info!.agentId, "agent-test");
	assert.ok(info!.startedAt >= before);
	assert.ok(info!.startedAt <= after);

	childProcessRegistry.clear();
});

test("ChildProcessRegistry clears all processes", () => {
	childProcessRegistry.clear();

	registerChildProcess(1111, "run-1", "agent-1");
	registerChildProcess(2222, "run-2", "agent-2");
	registerChildProcess(3333, "run-3", "agent-3");

	assert.equal(childProcessRegistry.getAllPids().length, 3);

	childProcessRegistry.clear();

	assert.equal(childProcessRegistry.getAllPids().length, 0);
});

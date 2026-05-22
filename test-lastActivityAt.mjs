/**
 * Test for lastActivityAt fallback in heartbeat-watcher
 * Verifies that tasks with stale heartbeat but recent lastActivityAt are not marked dead
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMetricRegistry } from "./src/observability/metric-registry.ts";
import { HeartbeatWatcher } from "./src/runtime/heartbeat-watcher.ts";
import { createRunManifest, saveRunTasks, updateRunStatus } from "./src/state/state-store.ts";
import { createManifestCache } from "./src/runtime/manifest-cache.ts";

const team = { name: "t", description: "", source: "test", filePath: "t", roles: [{ name: "r", agent: "a" }] };
const workflow = { name: "w", description: "", source: "test", filePath: "w", steps: [{ id: "s", role: "r", task: "x" }] };

test("HeartbeatWatcher uses lastActivityAt fallback - task NOT dead when heartbeat stale but activity recent", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lastactivity-at-"));
	try {
		fs.writeFileSync(path.join(cwd, "package.json"), "{}", "utf-8");
		const created = createRunManifest({ cwd, team, workflow, goal: "hb" });
		const manifest = updateRunStatus(created.manifest, "running", "running");
		
		// Create task with STALE heartbeat (old lastSeenAt) but RECENT lastActivityAt
		// Heartbeat is from Jan 1, 2026 (stale - 10 minutes old)
		// lastActivityAt is from Jan 1, 2026 00:08:00 (2 minutes old - within dead threshold of 5 minutes)
		const tasksWithHeartbeat = created.tasks.map((task) => ({
			...task,
			status: "running",
			heartbeat: { workerId: task.id, lastSeenAt: "2026-01-01T00:00:00.000Z", alive: true },
			// Agent is still active - lastActivityAt is recent (within dead threshold)
			agentProgress: { 
				lastActivityAt: "2026-01-01T00:08:00.000Z",  // 2 minutes ago
				currentTool: "working",
				toolCount: 5,
				tokens: 1000,
				turns: 2
			}
		}));
		
		saveRunTasks(manifest, tasksWithHeartbeat);
		const cache = createManifestCache(cwd, { watch: false, debounceMs: 0 });
		const notifications = [];
		let deadletters = 0;
		const watcher = new HeartbeatWatcher({ 
			cwd, 
			manifestCache: cache, 
			registry: createMetricRegistry(), 
			router: { enqueue: (n) => { notifications.push(n.id ?? ""); return true; } }, 
			deadletterTickThreshold: 3, 
			onDeadletterTrigger: () => { deadletters += 1; } 
		});
		
		// Simulate time at 00:10:00 - 10 minutes after heartbeat, 2 minutes after activity
		// With fallback: activity age = 2 minutes < dead threshold (5 minutes) -> should be warn/stale, not dead
		watcher.tick(Date.parse("2026-01-01T00:10:00.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:05.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:10.000Z"));
		
		// Should NOT have any dead notifications because lastActivityAt is recent
		assert.equal(notifications.length, 0, "Should NOT mark task dead when lastActivityAt is recent (within dead threshold)");
		assert.equal(deadletters, 0, "Should NOT trigger deadletter when lastActivityAt is recent");
		
		watcher.dispose();
		cache.dispose();
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("HeartbeatWatcher marks task dead when BOTH heartbeat and lastActivityAt are stale", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-both-stale-"));
	try {
		fs.writeFileSync(path.join(cwd, "package.json"), "{}", "utf-8");
		const created = createRunManifest({ cwd, team, workflow, goal: "hb" });
		const manifest = updateRunStatus(created.manifest, "running", "running");
		
		// Create task with BOTH stale heartbeat AND stale lastActivityAt
		// Heartbeat is from Jan 1, 2026 00:00:00 (10 minutes old)
		// lastActivityAt is also from Jan 1, 2026 00:00:00 (also 10 minutes old - beyond dead threshold)
		const tasksWithHeartbeat = created.tasks.map((task) => ({
			...task,
			status: "running",
			heartbeat: { workerId: task.id, lastSeenAt: "2026-01-01T00:00:00.000Z", alive: true },
			agentProgress: { 
				lastActivityAt: "2026-01-01T00:00:00.000Z",  // 10 minutes old - beyond dead threshold
				currentTool: "done",
				toolCount: 5,
				tokens: 1000,
				turns: 2
			}
		}));
		
		saveRunTasks(manifest, tasksWithHeartbeat);
		const cache = createManifestCache(cwd, { watch: false, debounceMs: 0 });
		const notifications = [];
		let deadletters = 0;
		const watcher = new HeartbeatWatcher({ 
			cwd, 
			manifestCache: cache, 
			registry: createMetricRegistry(), 
			router: { enqueue: (n) => { notifications.push(n.id ?? ""); return true; } }, 
			deadletterTickThreshold: 3, 
			onDeadletterTrigger: () => { deadletters += 1; } 
		});
		
		// Simulate time at 00:10:00 - both heartbeat and activity are 10 minutes old
		watcher.tick(Date.parse("2026-01-01T00:10:00.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:05.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:10.000Z"));
		
		// SHOULD have dead notifications because BOTH are stale (> 5 minutes)
		assert.ok(notifications.length > 0, "Should mark task dead when BOTH heartbeat and lastActivityAt are stale");
		assert.ok(deadletters > 0, "Should trigger deadletter when BOTH are stale");
		
		watcher.dispose();
		cache.dispose();
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("HeartbeatWatcher without lastActivityAt still marks stale heartbeat as dead", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-no-activity-"));
	try {
		fs.writeFileSync(path.join(cwd, "package.json"), "{}", "utf-8");
		const created = createRunManifest({ cwd, team, workflow, goal: "hb" });
		const manifest = updateRunStatus(created.manifest, "running", "running");
		
		// Create task with stale heartbeat but NO lastActivityAt
		const tasksWithHeartbeat = created.tasks.map((task) => ({
			...task,
			status: "running",
			heartbeat: { workerId: task.id, lastSeenAt: "2026-01-01T00:00:00.000Z", alive: true },
			// No agentProgress at all
		}));
		
		saveRunTasks(manifest, tasksWithHeartbeat);
		const cache = createManifestCache(cwd, { watch: false, debounceMs: 0 });
		const notifications = [];
		let deadletters = 0;
		const watcher = new HeartbeatWatcher({ 
			cwd, 
			manifestCache: cache, 
			registry: createMetricRegistry(), 
			router: { enqueue: (n) => { notifications.push(n.id ?? ""); return true; } }, 
			deadletterTickThreshold: 3, 
			onDeadletterTrigger: () => { deadletters += 1; } 
		});
		
		// Simulate time at 00:10:00 - heartbeat is 10 minutes old
		watcher.tick(Date.parse("2026-01-01T00:10:00.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:05.000Z"));
		watcher.tick(Date.parse("2026-01-01T00:10:10.000Z"));
		
		// SHOULD have dead notifications because heartbeat is stale and no fallback
		assert.ok(notifications.length > 0, "Should mark task dead when heartbeat stale and no lastActivityAt");
		assert.ok(deadletters > 0, "Should trigger deadletter when no fallback available");
		
		watcher.dispose();
		cache.dispose();
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
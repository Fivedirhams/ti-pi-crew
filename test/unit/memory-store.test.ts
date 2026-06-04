import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
	computeCurrentStrength,
	accessMemory,
	createMemory,
	MemoryStore,
	type Memory,
	type MemoryConfig,
} from "../../src/state/memory-store.ts";
import { createTrackedTempDir, removeTrackedTempDir } from "../fixtures/test-tempdir.ts";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
	return {
		id: `mem-test-${Math.random().toString(36).slice(2, 8)}`,
		tier: "working",
		content: "test memory content",
		strength: 0.5,
		accessCount: 0,
		lastAccessed: Date.now(),
		createdAt: Date.now(),
		tags: [],
		...overrides,
	};
}

describe("computeCurrentStrength", () => {
	it("returns strength near original for recently accessed memory", () => {
		const mem = makeMemory({ strength: 0.8, lastAccessed: Date.now() });
		const strength = computeCurrentStrength(mem);
		assert.ok(Math.abs(strength - 0.8) < 0.01, `Expected ~0.8, got ${strength}`);
	});

	it("decays strength for old memory", () => {
		const oneDayAgo = Date.now() - 86400000;
		const mem = makeMemory({ strength: 1.0, lastAccessed: oneDayAgo });
		const strength = computeCurrentStrength(mem, { decayRate: 0.0001, workingCapacity: 50, episodicCapacity: 200, semanticCapacity: 1000, proceduralCapacity: 100, tokenBudget: 2000 });
		assert.ok(strength < 1.0, `Expected decayed strength, got ${strength}`);
	});

	it("respects custom decay rate", () => {
		const old = Date.now() - 86400000;
		const mem = makeMemory({ strength: 1.0, lastAccessed: old });
		const slow = computeCurrentStrength(mem, { decayRate: 0.000001, workingCapacity: 50, episodicCapacity: 200, semanticCapacity: 1000, proceduralCapacity: 100, tokenBudget: 2000 });
		const fast = computeCurrentStrength(mem, { decayRate: 0.001, workingCapacity: 50, episodicCapacity: 200, semanticCapacity: 1000, proceduralCapacity: 100, tokenBudget: 2000 });
		assert.ok(slow > fast, `Slow decay (${slow}) should preserve more than fast (${fast})`);
	});
});

describe("accessMemory", () => {
	it("increments access count", () => {
		const mem = makeMemory({ accessCount: 0 });
		const updated = accessMemory(mem);
		assert.equal(updated.accessCount, 1);
	});

	it("increases strength by 0.1 capped at 1.0", () => {
		const mem = makeMemory({ strength: 0.5 });
		const updated = accessMemory(mem);
		assert.ok(updated.strength > 0.5);
		assert.ok(updated.strength <= 1.0);
	});

	it("caps strength at 1.0", () => {
		const mem = makeMemory({ strength: 0.95 });
		const updated = accessMemory(mem);
		assert.equal(updated.strength, 1.0);
	});

	it("promotes from working to episodic at 10 accesses", () => {
		const mem = makeMemory({ tier: "working", accessCount: 9 });
		const updated = accessMemory(mem);
		assert.equal(updated.tier, "episodic");
	});

	it("promotes from episodic to semantic at 20 accesses", () => {
		const mem = makeMemory({ tier: "episodic", accessCount: 19 });
		const updated = accessMemory(mem);
		assert.equal(updated.tier, "semantic");
	});

	it("promotes from semantic to procedural at 30 accesses", () => {
		const mem = makeMemory({ tier: "semantic", accessCount: 29 });
		const updated = accessMemory(mem);
		assert.equal(updated.tier, "procedural");
	});

	it("does not promote procedural further", () => {
		const mem = makeMemory({ tier: "procedural", accessCount: 50 });
		const updated = accessMemory(mem);
		assert.equal(updated.tier, "procedural");
	});

	it("updates lastAccessed", () => {
		const old = Date.now() - 10000;
		const mem = makeMemory({ lastAccessed: old });
		const updated = accessMemory(mem);
		assert.ok(updated.lastAccessed > old);
	});
});

describe("createMemory", () => {
	it("creates a working memory with defaults", () => {
		const mem = createMemory("test content");
		assert.equal(mem.tier, "working");
		assert.equal(mem.content, "test content");
		assert.equal(mem.strength, 0.5);
		assert.equal(mem.accessCount, 0);
		assert.deepEqual(mem.tags, []);
		assert.ok(mem.id.startsWith("mem-"));
	});

	it("accepts custom tags", () => {
		const mem = createMemory("content", ["tag1", "tag2"]);
		assert.deepEqual(mem.tags, ["tag1", "tag2"]);
	});

	it("accepts source run ID", () => {
		const mem = createMemory("content", [], "run-123");
		assert.equal(mem.sourceRunId, "run-123");
	});

	it("generates unique IDs", () => {
		const m1 = createMemory("a");
		const m2 = createMemory("b");
		assert.notEqual(m1.id, m2.id);
	});
});

describe("MemoryStore", () => {
	it("adds and retrieves memories via search", () => {
		const store = new MemoryStore();
		const mem = createMemory("task runner logic", ["task"]);
		store.add(mem);
		const results = store.search("task runner");
		assert.ok(results.length > 0);
		assert.equal(results[0]!.content, "task runner logic");
	});

	it("enforces capacity limits by evicting weakest", () => {
		const store = new MemoryStore({ workingCapacity: 2 });
		store.add(makeMemory({ id: "m1", tier: "working", strength: 0.3, content: "weak" }));
		store.add(makeMemory({ id: "m2", tier: "working", strength: 0.9, content: "strong" }));
		store.add(makeMemory({ id: "m3", tier: "working", strength: 0.5, content: "medium" }));

		const results = store.search("", [], 10);
		const ids = results.map((r) => r.id);
		// weakest (m1) should have been evicted
		assert.ok(!ids.includes("m1"), `m1 should be evicted, got: ${ids.join(",")}`);
	});

	it("filters out low-strength memories in search", () => {
		const store = new MemoryStore({ decayRate: 0 }); // no decay
		// Create a very old memory with low effective strength
		const old = Date.now() - 100000000000;
		store.add(makeMemory({ id: "old", strength: 0.05, lastAccessed: old, content: "old" }));
		// With high decay, this should be filtered
		const store2 = new MemoryStore({ decayRate: 1 });
		store2.add(makeMemory({ id: "old2", strength: 0.05, lastAccessed: Date.now() - 86400000, content: "old2" }));
		const results = store2.search("old");
		// strength after decay should be < 0.1, so filtered
		assert.equal(results.length, 0);
	});

	it("search filters by tags", () => {
		const store = new MemoryStore();
		store.add(makeMemory({ id: "m1", content: "python code", tags: ["python"] }));
		store.add(makeMemory({ id: "m2", content: "typescript code", tags: ["typescript"] }));
		const results = store.search("code", ["python"]);
		assert.ok(results.length > 0);
		assert.ok(results.some((r) => r.id === "m1"));
	});

	it("inject formats memories within token budget", () => {
		const store = new MemoryStore({ tokenBudget: 200 });
		store.add(makeMemory({ id: "m1", content: "short", tier: "episodic", tags: [] }));
		store.add(makeMemory({ id: "m2", content: "also short", tier: "semantic", tags: [] }));
		const text = store.inject("short");
		assert.ok(text.includes("## Relevant Context from Previous Runs"));
		assert.ok(text.includes("short"));
	});

	it("inject returns empty string when no memories match", () => {
		const store = new MemoryStore();
		assert.equal(store.inject("nonexistent"), "");
	});

	it("stats reports correct counts per tier", () => {
		const store = new MemoryStore();
		store.add(makeMemory({ id: "w1", tier: "working" }));
		store.add(makeMemory({ id: "w2", tier: "working" }));
		store.add(makeMemory({ id: "e1", tier: "episodic" }));
		const stats = store.stats;
		assert.equal(stats.working, 2);
		assert.equal(stats.episodic, 1);
		assert.equal(stats.semantic, 0);
		assert.equal(stats.procedural, 0);
	});

	it("persists and loads from disk", () => {
		const tmp = createTrackedTempDir("pi-crew-mem-");
		try {
			const storePath = path.join(tmp, "memories.json");
			const store = new MemoryStore({}, storePath);
			store.add(makeMemory({ id: "m1", content: "persisted" }));
			store.save();

			const store2 = new MemoryStore({}, storePath);
			const results = store2.search("persisted");
			assert.ok(results.length > 0, "Should load memories from disk");
			assert.equal(results[0]!.content, "persisted");
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("save is no-op without storePath", () => {
		const store = new MemoryStore();
		store.add(makeMemory({ id: "m1" }));
		// Should not throw
		store.save();
	});
});

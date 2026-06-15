import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	suggestRunIds,
	suggestTeams,
	suggestTaskIds,
} from "../../src/extension/command-completions.ts";
import { createRunManifest } from "../../src/state/state-store.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

// MAX_RUN_SUGGESTIONS constant in command-completions.ts is 15.
const EXPECTED_MAX = 15;

const realTmp = fs.realpathSync(os.tmpdir());

const team: TeamConfig = { name: "test-team", description: "test team", source: "builtin", filePath: "test.team.md", roles: [{ name: "explorer", agent: "explorer" }] };
const workflow: WorkflowConfig = { name: "test-wf", description: "test workflow", source: "builtin", filePath: "test.workflow.md", steps: [{ id: "explore", role: "explorer", task: "Explore" }] };
const emptyWorkflow: WorkflowConfig = { name: "empty-wf", description: "empty workflow", source: "builtin", filePath: "empty.workflow.md", steps: [] };

let tmpCwd: string;
let previousHome: string | undefined;

function beforeEachFn() {
	tmpCwd = fs.mkdtempSync(path.join(realTmp, "pi-crew-comp-extra-"));
	// Isolate the home dir so user-config team discovery doesn't leak in.
	previousHome = process.env.PI_TEAMS_HOME;
	const home = fs.mkdtempSync(path.join(realTmp, "pi-crew-comp-extra-home-"));
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	process.env.PI_TEAMS_HOME = home;
	process.chdir(tmpCwd);
}

function afterEachFn() {
	if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
	else process.env.PI_TEAMS_HOME = previousHome;
	try { fs.rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Create N runs with createRunManifest. Returns the array of created manifests.
function createNRuns(n: number, wf: WorkflowConfig = workflow) {
	const created: { manifest: ReturnType<typeof createRunManifest>["manifest"]; tasks: ReturnType<typeof createRunManifest>["tasks"] }[] = [];
	for (let i = 0; i < n; i++) {
		const result = createRunManifest({ cwd: tmpCwd, team, workflow: wf, goal: `run ${i}` });
		created.push(result);
	}
	return created;
}

describe("suggestRunIds — MAX_RUN_SUGGESTIONS limit", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("respects the max suggestions limit (create > 15 runs, verify only 15 returned)", () => {
		// Create more runs than MAX_RUN_SUGGESTIONS
		createNRuns(EXPECTED_MAX + 5);

		const result = suggestRunIds("");
		assert.ok(result, "expected run-id suggestions");
		assert.equal(result.length, EXPECTED_MAX,
			`should return exactly ${EXPECTED_MAX} suggestions, got ${result.length}`);
	});

	it("returns all runs when fewer than the limit exist", () => {
		const count = 5;
		createNRuns(count);

		const result = suggestRunIds("");
		assert.ok(result, "expected run-id suggestions");
		assert.equal(result.length, count);
	});
});

describe("suggestRunIds — prefix filtering", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("filters by partial runId prefix", () => {
		const created = createNRuns(3);

		// Use a prefix from the first run
		const prefix = created[0].manifest.runId.slice(0, 15);
		const result = suggestRunIds(prefix);
		assert.ok(result, "expected filtered suggestions");
		// All returned items should start with the prefix (or have matching label)
		for (const item of result) {
			assert.ok(
				item.value.startsWith(prefix) || item.label.toLowerCase().includes(prefix.toLowerCase()),
				`item ${item.value} should match prefix ${prefix}`,
			);
		}
	});

	it("returns null for a non-matching prefix", () => {
		createNRuns(3);

		assert.equal(suggestRunIds("zzz_nonexistent_prefix_zzz"), null);
	});

	it("returns null when no runs exist at all", () => {
		assert.equal(suggestRunIds(""), null);
		assert.equal(suggestRunIds("team_"), null);
	});
});

describe("suggestTeams — prefix filtering", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("filters by team name prefix when teams exist in project .crew/teams/", () => {
		// Create discoverable team files in the project crew root
		const teamsDir = path.join(tmpCwd, ".crew", "teams");
		fs.mkdirSync(teamsDir, { recursive: true });

		fs.writeFileSync(path.join(teamsDir, "alpha-squad.team.md"),
			"---\nname: alpha-squad\ndescription: Alpha team\n---\n- explorer: agent=explorer\n");
		fs.writeFileSync(path.join(teamsDir, "beta-team.team.md"),
			"---\nname: beta-team\ndescription: Beta team\n---\n- explorer: agent=explorer\n");
		fs.writeFileSync(path.join(teamsDir, "gamma-crew.team.md"),
			"---\nname: gamma-crew\ndescription: Gamma team\n---\n- explorer: agent=explorer\n");

		// Prefix "alpha" should only return alpha-squad
		const result = suggestTeams("alpha");
		assert.ok(result, "expected team suggestions for prefix 'alpha'");
		assert.equal(result.length, 1);
		assert.equal(result[0].value, "alpha-squad");
	});

	it("returns all teams for empty prefix", () => {
		const teamsDir = path.join(tmpCwd, ".crew", "teams");
		fs.mkdirSync(teamsDir, { recursive: true });

		fs.writeFileSync(path.join(teamsDir, "alpha.team.md"),
			"---\nname: alpha\ndescription: Alpha\n---\n- explorer: agent=explorer\n");
		fs.writeFileSync(path.join(teamsDir, "beta.team.md"),
			"---\nname: beta\ndescription: Beta\n---\n- explorer: agent=explorer\n");

		const result = suggestTeams("");
		assert.ok(result, "expected all teams");
		assert.ok(result.length >= 2, `should find at least 2 teams, got ${result.length}`);
	});

	it("returns null for a non-matching prefix", () => {
		const teamsDir = path.join(tmpCwd, ".crew", "teams");
		fs.mkdirSync(teamsDir, { recursive: true });

		fs.writeFileSync(path.join(teamsDir, "alpha.team.md"),
			"---\nname: alpha\ndescription: Alpha\n---\n- explorer: agent=explorer\n");

		assert.equal(suggestTeams("zzz_nonexistent"), null);
	});
});

describe("suggestTaskIds — edge cases", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("returns null for a run that exists but has no tasks (workflow with empty steps)", async () => {
		// Create a run with a workflow that has zero steps → zero tasks
		const created = createRunManifest({ cwd: tmpCwd, team, workflow: emptyWorkflow, goal: "empty" });

		const result = await suggestTaskIds(created.manifest.runId, "");
		// With no tasks, filterByPrefix returns null
		assert.equal(result, null);
	});

	it("returns null for a run created without any workflow (no tasks)", async () => {
		// Pass workflow: undefined → tasks will be empty
		const created = createRunManifest({ cwd: tmpCwd, team, goal: "no workflow" });

		const result = await suggestTaskIds(created.manifest.runId, "");
		assert.equal(result, null);
	});

	it("returns null for a completely non-existent run", async () => {
		const result = await suggestTaskIds("team_nonexistent_run", "");
		assert.equal(result, null);
	});

	it("returns task IDs for a run with tasks", async () => {
		const created = createRunManifest({ cwd: tmpCwd, team, workflow, goal: "with tasks" });

		const result = await suggestTaskIds(created.manifest.runId, "");
		assert.ok(result, "expected task-id suggestions");
		assert.ok(result.length > 0, "workflow has at least one task");
		for (const item of result) {
			assert.ok(item.value.length > 0, "each task ID should be non-empty");
			assert.ok(item.description, "each task should have a description");
		}
	});
});

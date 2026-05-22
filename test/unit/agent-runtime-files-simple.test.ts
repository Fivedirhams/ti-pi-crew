import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { unregisterActiveRun } from "../../src/state/active-run-registry.ts";

test("basic agent files", async () => {
	const previousMock = process.env.PI_TEAMS_MOCK_CHILD_PI;
	const previousExecute = process.env.PI_TEAMS_EXECUTE_WORKERS;
	process.env.PI_TEAMS_MOCK_CHILD_PI = "json-success";
	process.env.PI_TEAMS_EXECUTE_WORKERS = "1";
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-agent-files-"));
	let runId: string | undefined;
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: "test" }, { cwd });
		assert.equal(run.isError, false);
		runId = run.details.runId;
		console.log("Test passed, runId:", runId);
	} finally {
		if (runId) unregisterActiveRun(runId);
		if (previousMock === undefined) delete process.env.PI_TEAMS_MOCK_CHILD_PI;
		else process.env.PI_TEAMS_MOCK_CHILD_PI = previousMock;
		if (previousExecute === undefined) delete process.env.PI_TEAMS_EXECUTE_WORKERS;
		else process.env.PI_TEAMS_EXECUTE_WORKERS = previousExecute;
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

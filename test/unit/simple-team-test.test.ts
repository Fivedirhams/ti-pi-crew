import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { unregisterActiveRun } from "../../src/state/active-run-registry.ts";

test("simple team run", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-simple-test-"));
  fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
  let runId: string | undefined;
  try {
    process.env.PI_TEAMS_MOCK_CHILD_PI = "json-success";
    process.env.PI_TEAMS_EXECUTE_WORKERS = "1";
    const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: "test" }, { cwd });
    assert.equal(run.isError, false);
    runId = run.details.runId;
    console.log("Run completed, runId:", runId);
  } finally {
    if (runId) unregisterActiveRun(runId);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

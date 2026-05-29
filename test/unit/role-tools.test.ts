import test from "node:test";
import assert from "node:assert/strict";
import { 
	getToolConfig, 
	hasToolRestrictions,
	getRestrictedRoles,
	type RoleToolConfig 
} from "../../src/config/role-tools.ts";

test("getToolConfig returns config for known roles", () => {
	const explorer = getToolConfig("explorer");
	assert.ok(explorer.tools !== undefined);
	assert.ok(explorer.tools!.includes("read"));
	assert.ok(explorer.tools!.includes("grep"));
	assert.ok(explorer.excludeTools!.includes("bash"));

	const executor = getToolConfig("executor");
	assert.equal(executor.tools, undefined);
	assert.equal(executor.excludeTools, undefined);
});

test("getToolConfig returns empty config for unknown roles", () => {
	const unknown = getToolConfig("unknown_role");
	assert.equal(unknown.tools, undefined);
	assert.equal(unknown.excludeTools, undefined);
});

test("hasToolRestrictions returns true for restricted roles", () => {
	assert.equal(hasToolRestrictions("explorer"), true);
	assert.equal(hasToolRestrictions("security_reviewer"), true);
	assert.equal(hasToolRestrictions("writer"), true);
});

test("hasToolRestrictions returns false for executor", () => {
	assert.equal(hasToolRestrictions("executor"), false);
});

test("getRestrictedRoles returns all restricted roles", () => {
	const restricted = getRestrictedRoles();
	assert.ok(restricted.includes("explorer"));
	assert.ok(restricted.includes("security_reviewer"));
	assert.ok(!restricted.includes("executor"));
});

test("security_reviewer has strictest restrictions", () => {
	const security = getToolConfig("security_reviewer");
	assert.ok(security.tools!.length <= 3);
	assert.ok(security.excludeTools!.includes("bash"));
	assert.ok(security.excludeTools!.includes("edit"));
	assert.ok(security.excludeTools!.includes("write"));
});

test("explorer has read-only tools", () => {
	const explorer = getToolConfig("explorer");
	assert.ok(explorer.tools!.includes("read"));
	assert.ok(explorer.tools!.includes("grep"));
	assert.ok(explorer.tools!.includes("find"));
	assert.ok(explorer.tools!.includes("ls"));
	assert.ok(explorer.tools!.includes("glob"));
	assert.ok(!explorer.tools!.includes("bash"));
	assert.ok(!explorer.tools!.includes("edit"));
	assert.ok(!explorer.tools!.includes("write"));
});

test("reviewer can use bash but not edit/write", () => {
	const reviewer = getToolConfig("reviewer");
	assert.ok(reviewer.tools!.includes("bash"));
	assert.ok(reviewer.excludeTools!.includes("edit"));
	assert.ok(reviewer.excludeTools!.includes("write"));
});

test("writer has edit and write but no bash", () => {
	const writer = getToolConfig("writer");
	assert.ok(writer.tools!.includes("edit"));
	assert.ok(writer.tools!.includes("write"));
	assert.ok(!writer.tools!.includes("bash"));
});

test("test_engineer has bash but no web", () => {
	const testEngineer = getToolConfig("test_engineer");
	assert.ok(testEngineer.tools!.includes("bash"));
	assert.ok(!testEngineer.tools!.includes("web"));
});
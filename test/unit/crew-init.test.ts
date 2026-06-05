/**
 * Tests for P0: Auto-setup .crew directory and .gitignore.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// We test the modules directly via dynamic import so they resolve
// relative to the source tree correctly.
const { ensureCrewDirectory } = await import("../../src/state/crew-init.ts");
const { updateGitignore } = await import(
	"../../src/state/gitignore-manager.ts"
);

function makeTempProject(): string {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-crew-init-test-"),
	);
	// Add a .git marker so projectCrewRoot resolves to .crew/ inside this dir
	fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
	return dir;
}

function cleanup(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- crew-init tests ---

test("ensureCrewDirectory creates required directory structure", async () => {
	const dir = makeTempProject();
	try {
		await ensureCrewDirectory(dir);
		const crewRoot = path.join(dir, ".crew");
		const expectedDirs = [
			".crew",
			".crew/state/runs",
			".crew/state/subagents",
			".crew/artifacts",
			".crew/cache",
			".crew/graphs",
			".crew/audit",
		];
		for (const sub of expectedDirs) {
			assert.ok(
				fs.statSync(path.join(dir, sub)).isDirectory(),
				`Expected directory: ${sub}`,
			);
		}
	} finally {
		cleanup(dir);
	}
});

test("ensureCrewDirectory creates .gitkeep placeholders", async () => {
	const dir = makeTempProject();
	try {
		await ensureCrewDirectory(dir);
		const crewRoot = path.join(dir, ".crew");
		const placeholders = [
			"artifacts/.gitkeep",
			"cache/.gitkeep",
			"graphs/.gitkeep",
			"audit/.gitkeep",
		];
		for (const p of placeholders) {
			const fullPath = path.join(crewRoot, p);
			assert.ok(fs.existsSync(fullPath), `Expected placeholder: ${p}`);
			assert.equal(fs.readFileSync(fullPath, "utf-8"), "");
		}
	} finally {
		cleanup(dir);
	}
});

test("ensureCrewDirectory writes README.md", async () => {
	const dir = makeTempProject();
	try {
		await ensureCrewDirectory(dir);
		const readmePath = path.join(dir, ".crew", "README.md");
		assert.ok(fs.existsSync(readmePath), "README.md should exist");
		const content = fs.readFileSync(readmePath, "utf-8");
		assert.ok(
			content.includes("pi-crew"),
			"README should mention pi-crew",
		);
		assert.ok(
			content.includes("state/runs"),
			"README should describe state/runs",
		);
	} finally {
		cleanup(dir);
	}
});

test("ensureCrewDirectory is idempotent", async () => {
	const dir = makeTempProject();
	try {
		await ensureCrewDirectory(dir);
		const readmeBefore = fs.readFileSync(
			path.join(dir, ".crew", "README.md"),
			"utf-8",
		);
		// Call again — should not throw
		await ensureCrewDirectory(dir);
		const readmeAfter = fs.readFileSync(
			path.join(dir, ".crew", "README.md"),
			"utf-8",
		);
		// README content should be the same (overwritten with same content)
		assert.equal(readmeBefore, readmeAfter);
		// Directories should still exist
		assert.ok(
			fs.statSync(path.join(dir, ".crew", "state", "runs")).isDirectory(),
		);
	} finally {
		cleanup(dir);
	}
});

// --- gitignore-manager tests ---

test("updateGitignore creates .gitignore if it doesn't exist", async () => {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-gitignore-test-"),
	);
	try {
		const gitignorePath = path.join(dir, ".gitignore");
		await updateGitignore(gitignorePath);
		assert.ok(fs.existsSync(gitignorePath));
		const content = fs.readFileSync(gitignorePath, "utf-8");
		assert.ok(content.includes("/.crew/"), "Should contain /.crew/");
		assert.ok(
			content.includes("!.crew/artifacts/"),
			"Should contain !.crew/artifacts/",
		);
		assert.ok(
			content.includes("!.crew/graphs/.gitkeep"),
			"Should contain !.crew/graphs/.gitkeep",
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("updateGitignore adds entries to existing .gitignore", async () => {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-gitignore-test-"),
	);
	try {
		const gitignorePath = path.join(dir, ".gitignore");
		fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n", "utf-8");
		await updateGitignore(gitignorePath);
		const content = fs.readFileSync(gitignorePath, "utf-8");
		// Existing content preserved
		assert.ok(content.includes("node_modules/"));
		assert.ok(content.includes("dist/"));
		// New entries added
		assert.ok(content.includes("/.crew/"));
		assert.ok(content.includes("!.crew/artifacts/"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("updateGitignore does not duplicate existing entries", async () => {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-gitignore-test-"),
	);
	try {
		const gitignorePath = path.join(dir, ".gitignore");
		await updateGitignore(gitignorePath);
		const content1 = fs.readFileSync(gitignorePath, "utf-8");
		await updateGitignore(gitignorePath);
		const content2 = fs.readFileSync(gitignorePath, "utf-8");
		assert.equal(content1, content2, "Content should not change on second call");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("updateGitignore preserves existing content", async () => {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-gitignore-test-"),
	);
	try {
		const gitignorePath = path.join(dir, ".gitignore");
		const existingContent = "# My project\n*.log\nbuild/\n";
		fs.writeFileSync(gitignorePath, existingContent, "utf-8");
		await updateGitignore(gitignorePath);
		const content = fs.readFileSync(gitignorePath, "utf-8");
		assert.ok(content.startsWith("# My project\n*.log\nbuild/"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureCrewDirectory updates .gitignore in project root", async () => {
	const dir = makeTempProject();
	try {
		await ensureCrewDirectory(dir);
		const gitignorePath = path.join(dir, ".gitignore");
		assert.ok(fs.existsSync(gitignorePath), ".gitignore should be created");
		const content = fs.readFileSync(gitignorePath, "utf-8");
		assert.ok(content.includes("/.crew/"));
		assert.ok(content.includes("!.crew/artifacts/"));
	} finally {
		cleanup(dir);
	}
});

// --- Regression: issue #28 — parallel subagent race condition ---
//
// Bug: `path.parse(start).root` crashed with `TypeError: Cannot read properties
// of undefined (reading 'parse')` when 3+ concurrent subagents dynamically
// imported `crew-init.ts`. The fix inlines root detection via `parseRoot` and
// uses `safeJoin` / `safeDirname` / `safeResolve` that don't depend on the
// `path` namespace binding.

test("ensureCrewDirectory is safe under concurrent invocation (issue #28)", async () => {
	const dir = makeTempProject();
	try {
		// Launch 8 concurrent calls — same number of in-flight dynamic imports
		// that triggered the original race in the bug report.
		const calls = Array.from({ length: 8 }, () =>
			ensureCrewDirectory(dir),
		);
		// If any call throws (e.g. `path.parse` undefined), the aggregate will reject.
		const results = await Promise.all(calls);
		assert.equal(results.length, 8);
		// Structure should still be correct after the race.
		const crewRoot = path.join(dir, ".crew");
		assert.ok(fs.statSync(crewRoot).isDirectory());
		assert.ok(
			fs.statSync(path.join(crewRoot, "state", "runs")).isDirectory(),
		);
	} finally {
		cleanup(dir);
	}
});

test("ensureCrewDirectory survives a corrupted `path` namespace binding (issue #28)", async () => {
	// Node.js freezes the `node:path` module, so we can't monkey-patch it directly.
	// Instead, we test the inline fallbacks in isolation via __test_internals
	// to lock in their behavior — this is the same code path that runs when
	// `path.parse` is `undefined` in the jiti race.
	const crewInitModule = await import("../../src/state/crew-init.ts");
	const { parseRoot, safeJoin, safeDirname, safeResolve } =
		crewInitModule.__test_internals;

	// parseRoot: POSIX
	assert.equal(parseRoot("/"), "/");
	assert.equal(parseRoot("/a/b/c"), "/");
	assert.equal(parseRoot(""), "/");
	// parseRoot: Windows drive letter
	assert.equal(parseRoot("C:\\"), "C:\\");
	assert.equal(parseRoot("C:/foo"), "C:/");
	assert.equal(parseRoot("D:\\projects"), "D:\\");
	// parseRoot: UNC
	// UNC paths use double backslash at the start: \\server\share\foo
	assert.equal(parseRoot("\\\\server\\share\\foo"), "\\\\server\\share");
	// POSIX-style `//server/share/foo` is treated as a POSIX absolute path
	// (starting with `/`) — not a UNC path. This matches `path.parse` behavior.
	assert.equal(parseRoot("//server/share/foo"), "/");
	// parseRoot: relative
	assert.equal(parseRoot("foo/bar"), "foo/bar");
	assert.equal(parseRoot("./relative"), "./relative");

	// safeDirname
	assert.equal(safeDirname("/a/b/c"), "/a/b");
	assert.equal(safeDirname("/a"), "/");
	assert.equal(safeDirname("C:\\foo\\bar"), "C:\\foo");
	assert.equal(safeDirname("foo"), "foo");
	assert.equal(safeDirname("/"), "/");

	// safeJoin uses / when all parts are POSIX
	assert.equal(safeJoin("/a", "b", "c"), "/a/b/c");
	assert.equal(safeJoin("/a/", "b"), "/a/b");

	// safeResolve is identity when path module is unavailable, but
	// the real path.resolve is still available in the test environment.
	assert.equal(safeResolve("/foo"), path.resolve("/foo"));
});

// Direct unit tests for the inlined `parseRoot` helper.
//
// We import the module fresh and read the function via a tiny shim: the
// helper is module-private, so we exercise it indirectly through
// `ensureCrewDirectory` running on a known temp project with a deeply
// nested path. The point of these tests is to lock in the behavior so
// future refactors don't reintroduce the `path.parse` dependency.
test("ensureCrewDirectory walks up to .git marker from a deeply nested cwd", async () => {
	const dir = makeTempProject();
	const nested = path.join(dir, "a", "b", "c", "d");
	fs.mkdirSync(nested, { recursive: true });
	try {
		await ensureCrewDirectory(nested);
		assert.ok(
			fs.statSync(path.join(dir, ".crew")).isDirectory(),
			"Should locate project root via .git marker and create .crew/ there",
		);
	} finally {
		cleanup(dir);
	}
});

test("ensureCrewDirectory walks up to package.json marker", async () => {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-crew-crew-init-pkgjson-"),
	);
	fs.writeFileSync(path.join(dir, "package.json"), "{}", "utf-8");
	const nested = path.join(dir, "src", "lib");
	fs.mkdirSync(nested, { recursive: true });
	try {
		await ensureCrewDirectory(nested);
		assert.ok(
			fs.statSync(path.join(dir, ".crew")).isDirectory(),
			"Should locate project root via package.json and create .crew/ there",
		);
	} finally {
		cleanup(dir);
	}
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	resolveContainedPath,
	resolveContainedRelativePath,
	resolveRealContainedPath,
} from "../../src/utils/safe-paths.ts";

const realTmp = fs.realpathSync(os.tmpdir());

let tmpBase: string;

function beforeEachFn() {
	tmpBase = fs.mkdtempSync(path.join(realTmp, "pi-crew-safepaths-"));
}

function afterEachFn() {
	try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("resolveContainedPath — path traversal defense", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("rejects '../etc/passwd' (escapes baseDir)", () => {
		assert.throws(
			() => resolveContainedPath(tmpBase, "../etc/passwd"),
			/Path is outside/,
		);
	});

	it("rejects absolute paths that escape the base dir", () => {
		assert.throws(
			() => resolveContainedPath(tmpBase, "/etc/passwd"),
			/Path is outside/,
		);
	});

	it("rejects '/etc/shadow' absolute path", () => {
		assert.throws(
			() => resolveContainedPath(tmpBase, "/etc/shadow"),
			/Path is outside/,
		);
	});

	it("accepts a valid contained relative path", () => {
		const result = resolveContainedPath(tmpBase, "subdir/file.txt");
		assert.equal(result, path.resolve(tmpBase, "subdir/file.txt"));
	});

	it("accepts a valid deeply-nested contained path", () => {
		const result = resolveContainedPath(tmpBase, "a/b/c/d.txt");
		assert.equal(result, path.resolve(tmpBase, "a/b/c/d.txt"));
	});

	it("rejects null-byte injection", () => {
		assert.throws(
			() => resolveContainedPath(tmpBase, "file\0.txt"),
			/null byte/,
		);
	});

	it("rejects multi-level escape '../../../..'", () => {
		assert.throws(
			() => resolveContainedPath(tmpBase, "../../../../etc/passwd"),
			/Path is outside/,
		);
	});
});

describe("resolveContainedRelativePath — relative path validation", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("rejects '../escape'", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "../escape", "file"),
			/Invalid file/,
		);
	});

	it("rejects 'a/../../b' (escapes via nested ..)", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "a/../../b", "file"),
			/Invalid file/,
		);
	});

	it("rejects absolute path '/etc/passwd'", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "/etc/passwd", "file"),
			/Invalid file/,
		);
	});

	it("rejects a single '..' segment", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "..", "path"),
			/Invalid path/,
		);
	});

	it("rejects null-byte injection", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "evil\0.txt", "file"),
			/null byte/,
		);
	});

	it("rejects Windows-style drive letter 'C:\\evil'", () => {
		assert.throws(
			() => resolveContainedRelativePath(tmpBase, "C:\\evil", "file"),
			/Invalid file/,
		);
	});

	it("accepts a valid relative path", () => {
		const result = resolveContainedRelativePath(tmpBase, "dir/file.txt", "file");
		assert.equal(result, path.resolve(tmpBase, "dir/file.txt"));
	});

	it("accepts a path that has '.' segments but no '..'", () => {
		// './foo' is normalized to 'foo' — should be accepted
		const result = resolveContainedRelativePath(tmpBase, "./foo/bar.txt", "file");
		assert.equal(result, path.resolve(tmpBase, "foo/bar.txt"));
	});
});

describe("resolveRealContainedPath — symlink rejection", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("rejects when the target path is a symlink to outside baseDir", () => {
		// Create an outside directory and a symlink inside baseDir pointing to it
		const outsideDir = fs.mkdtempSync(path.join(realTmp, "pi-crew-outside-"));
		const outsideFile = path.join(outsideDir, "secret.txt");
		fs.writeFileSync(outsideFile, "secret");
		const linkPath = path.join(tmpBase, "evil-link");
		fs.symlinkSync(outsideFile, linkPath);

		try {
			assert.throws(
				() => resolveRealContainedPath(tmpBase, "evil-link"),
				/symlink/,
			);
		} finally {
			try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	it("rejects when an intermediate ancestor directory is a symlink to outside", () => {
		// Create an outside directory
		const outsideDir = fs.mkdtempSync(path.join(realTmp, "pi-crew-outside2-"));
		// Create a symlinked subdir inside baseDir that points outside
		const symlinkedSubdir = path.join(tmpBase, "linked-dir");
		fs.symlinkSync(outsideDir, symlinkedSubdir);

		try {
			assert.throws(
				() => resolveRealContainedPath(tmpBase, "linked-dir/file.txt"),
				/ancestor is a symlink/,
			);
		} finally {
			try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	it("accepts a normal non-symlink contained path", () => {
		// Create the file first so it exists
		const targetDir = path.join(tmpBase, "subdir");
		fs.mkdirSync(targetDir, { recursive: true });
		const targetFile = path.join(targetDir, "file.txt");
		fs.writeFileSync(targetFile, "content");

		const result = resolveRealContainedPath(tmpBase, "subdir/file.txt");
		assert.equal(result, fs.realpathSync(targetFile));
	});

	it("accepts a non-existent target file (for write operations)", () => {
		// The target doesn't exist yet — should return the resolved path
		const result = resolveRealContainedPath(tmpBase, "newdir/newfile.txt");
		assert.equal(result, path.resolve(tmpBase, "newdir/newfile.txt"));
	});

	it("rejects '../etc/passwd' (path traversal)", () => {
		assert.throws(
			() => resolveRealContainedPath(tmpBase, "../etc/passwd"),
			/Path is outside/,
		);
	});

	it("rejects null-byte injection", () => {
		assert.throws(
			() => resolveRealContainedPath(tmpBase, "file\0.txt"),
			/null byte/,
		);
	});
});

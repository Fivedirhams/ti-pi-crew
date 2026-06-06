import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveContainedPath, resolveContainedRelativePath } from "../../src/utils/safe-paths.ts";

describe("safe-paths null byte rejection", () => {
	it("resolveContainedPath rejects null bytes", () => {
		assert.throws(
			() => resolveContainedPath("/tmp", "foo\0bar"),
			/Security: path contains null byte/,
		);
	});

	it("resolveContainedPath rejects null bytes at start", () => {
		assert.throws(
			() => resolveContainedPath("/tmp", "\0etc/passwd"),
			/Security: path contains null byte/,
		);
	});

	it("resolveContainedRelativePath rejects null bytes", () => {
		assert.throws(
			() => resolveContainedRelativePath("/tmp", "sub\0dir", "test"),
			/Security: path contains null byte: test/,
		);
	});

	it("resolveContainedPath allows safe paths", () => {
		const result = resolveContainedPath("/tmp", "foo/bar");
		assert.ok(result.includes("foo/bar"));
	});

	it("resolveContainedRelativePath allows safe paths", () => {
		const result = resolveContainedRelativePath("/tmp", "sub/dir", "test");
		assert.ok(result.includes("sub/dir"));
	});
});

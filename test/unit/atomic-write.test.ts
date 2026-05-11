import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWriteJson, atomicWriteFile, readJsonFile, __test__renameWithRetry } from "../../src/state/atomic-write.ts";

describe("atomicWriteJson", () => {
	const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-atomic-"));

	it("writes valid JSON to file", () => {
		const dir = tmpDir();
		const filePath = path.join(dir, "test.json");
		atomicWriteJson(filePath, { hello: "world" });
		const content = fs.readFileSync(filePath, "utf-8");
		assert.equal(JSON.parse(content).hello, "world");
		fs.rmSync(dir, { recursive: true });
	});

	it("overwrites existing file atomically", () => {
		const dir = tmpDir();
		const filePath = path.join(dir, "test.json");
		atomicWriteJson(filePath, { v: 1 });
		atomicWriteJson(filePath, { v: 2 });
		const data = readJsonFile<{ v: number }>(filePath);
		assert.equal(data?.v, 2);
		fs.rmSync(dir, { recursive: true });
	});

	it("does not leave .tmp files on success", () => {
		const dir = tmpDir();
		const filePath = path.join(dir, "test.json");
		atomicWriteJson(filePath, { ok: true });
		const entries = fs.readdirSync(dir);
		assert.ok(!entries.some((e) => e.endsWith(".tmp")));
		fs.rmSync(dir, { recursive: true });
	});
});

describe("atomicWriteFile", () => {
	const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-file-"));

	it("writes string content to file", () => {
		const dir = tmpDir();
		const filePath = path.join(dir, "test.txt");
		atomicWriteFile(filePath, "hello world");
		assert.equal(fs.readFileSync(filePath, "utf-8"), "hello world");
		fs.rmSync(dir, { recursive: true });
	});

	it("overwrites existing content", () => {
		const dir = tmpDir();
		const filePath = path.join(dir, "test.txt");
		atomicWriteFile(filePath, "first");
		atomicWriteFile(filePath, "second");
		assert.equal(fs.readFileSync(filePath, "utf-8"), "second");
		fs.rmSync(dir, { recursive: true });
	});
});

describe("readJsonFile", () => {
	it("returns parsed JSON for valid file", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-read-"));
		const filePath = path.join(dir, "test.json");
		fs.writeFileSync(filePath, '{"key":"value"}');
		const data = readJsonFile<{ key: string }>(filePath);
		assert.equal(data?.key, "value");
		fs.rmSync(dir, { recursive: true });
	});

	it("returns undefined for missing file", () => {
		assert.equal(readJsonFile("/nonexistent/file.json"), undefined);
	});

	it("returns undefined for invalid JSON", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-read-"));
		const filePath = path.join(dir, "bad.json");
		fs.writeFileSync(filePath, "not json");
		assert.equal(readJsonFile(filePath), undefined);
		fs.rmSync(dir, { recursive: true });
	});
});

describe("__test__renameWithRetry", () => {
	it("retries on EPERM error", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-retry-"));
		const src = path.join(dir, "src.txt");
		const dst = path.join(dir, "dst.txt");
		fs.writeFileSync(src, "data");
		let attempts = 0;
		__test__renameWithRetry(src, dst, 3, () => {
			attempts++;
			if (attempts < 2) {
				const err = new Error("EPERM") as NodeJS.ErrnoException;
				err.code = "EPERM";
				throw err;
			}
			fs.renameSync(src, dst);
		});
		assert.equal(attempts, 2);
		assert.ok(fs.existsSync(dst));
		fs.rmSync(dir, { recursive: true });
	});
});

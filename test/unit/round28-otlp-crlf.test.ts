/**
 * Round 28 (BUG 1, CRLF injection): OTLP header VALUE validation missed CR.
 *
 * The CRLF-blocking regex /[^\x00-\x08\x0b\x0c\x0e-\x1f]/ left CR (0x0D) AND
 * LF (0x0A) unblocked in header VALUES. The comment claimed to "prevent header
 * injection via CR/LF" but CR was never matched, and LF was explicitly allowed
 * — both are CRLF injection vectors that can split HTTP headers. Fix: block
 * 0x00-0x08 and 0x0A-0x1F, allowing only tab (0x09).
 *
 * Note: header KEYS were already regex-validated; this is about VALUES.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configPath, loadConfig } from "../../src/config/config.ts";

interface OtlpConfig {
	otlp?: { endpoint?: string; headers?: Record<string, string> };
}

function withTempHome<T>(fn: () => T): T {
	const previousHome = process.env.PI_TEAMS_HOME;
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-crlf-"));
	const home = path.join(root, "home");
	fs.mkdirSync(path.dirname(configPath()), { recursive: true });
	process.env.PI_TEAMS_HOME = home;
	try {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		return fn();
	} finally {
		process.env.PI_TEAMS_HOME = previousHome;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function writeAndLoad(headers: Record<string, string>): OtlpConfig {
	fs.writeFileSync(
		configPath(),
		JSON.stringify({ otlp: { endpoint: "https://collector.example.com", headers } }),
		"utf-8",
	);
	return loadConfig("/nonexistent-project-cwd").config as OtlpConfig;
}

test("CRLF in OTLP header VALUE is blocked (CR \\r)", () => {
	withTempHome(() => {
		const loaded = writeAndLoad({ "X-Inject": "good\rEvil-Header: injected" });
		// The malicious header value must be rejected → headers stripped entirely.
		const headers = loaded.otlp?.headers;
		// Either headers is undefined, or the offending key is absent.
		assert.ok(
			!headers || !("X-Inject" in headers),
			`CRLF-laced header value must be blocked, got: ${JSON.stringify(headers)}`,
		);
	});
});

test("LF in OTLP header VALUE is blocked (\\n)", () => {
	withTempHome(() => {
		const loaded = writeAndLoad({ "X-Inject": "good\nEvil-Header: injected" });
		const headers = loaded.otlp?.headers;
		assert.ok(
			!headers || !("X-Inject" in headers),
			`LF-laced header value must be blocked, got: ${JSON.stringify(headers)}`,
		);
	});
});

test("legitimate header value with tab is still allowed (tab=0x09)", () => {
	withTempHome(() => {
		const loaded = writeAndLoad({ "X-Tab": "value\twith\ttab" });
		assert.equal(loaded.otlp?.headers?.["X-Tab"], "value\twith\ttab");
	});
});

test("plain legitimate headers are unaffected", () => {
	withTempHome(() => {
		const loaded = writeAndLoad({
			Authorization: "Bearer abc123",
			"X-Api-Key": "key-XYZ",
		});
		assert.equal(loaded.otlp?.headers?.Authorization, "Bearer abc123");
		assert.equal(loaded.otlp?.headers?.["X-Api-Key"], "key-XYZ");
	});
});

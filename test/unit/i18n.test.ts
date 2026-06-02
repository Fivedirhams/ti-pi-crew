import test from "node:test";
import assert from "node:assert/strict";
import {
	t,
	addTranslations,
	listLocales,
	__test__resetI18n,
} from "../../src/i18n.ts";

/**
 * Round 26 (test coverage gaps): `i18n.ts` provides internationalization
 * for pi-crew agent messages with template parameters and locale fallback.
 *
 * Tests cover the pure-function surface: t(), addTranslations(), listLocales().
 * initI18n() requires a Pi ExtensionAPI mock and is not tested here.
 */

// Reset i18n state between tests
test("i18n: setup — reset state", () => {
	__test__resetI18n();
});

// ─── t() — English fallback ────────────────────────────────────────────────

test("t(): returns English fallback with params", () => {
	__test__resetI18n();
	assert.equal(t("agent.started", { state: "running" }), "Agent running.");
});

test("t(): returns English fallback without params", () => {
	__test__resetI18n();
	assert.equal(t("agent.noOutput"), "No output.");
});

test("t(): preserves unsubstituted template params", () => {
	__test__resetI18n();
	// If no params passed, template vars remain as {key}
	const result = t("agent.id");
	assert.match(result, /\{id\}/);
});

test("t(): substitutes multiple params", () => {
	__test__resetI18n();
	assert.equal(t("agent.id", { id: "abc-123" }), "Agent ID: abc-123");
});

test("t(): numeric params are converted to string", () => {
	__test__resetI18n();
	assert.equal(t("agent.id", { id: 42 }), "Agent ID: 42");
});

// ─── listLocales ───────────────────────────────────────────────────────────

test("listLocales(): returns built-in locales", () => {
	__test__resetI18n();
	const locales = listLocales();
	assert.ok(locales.includes("es"), "should include Spanish");
	assert.ok(locales.includes("fr"), "should include French");
	assert.ok(locales.includes("pt-BR"), "should include Brazilian Portuguese");
});

// ─── addTranslations ──────────────────────────────────────────────────────

test("addTranslations(): adds a new locale", () => {
	__test__resetI18n();
	addTranslations("vi", { "agent.requiresPrompt": "Agent cần prompt." });
	assert.ok(listLocales().includes("vi"));
});

test("addTranslations(): extends existing locale", () => {
	__test__resetI18n();
	const originalCount = Object.keys(listLocales()).length;
	addTranslations("es", { "agent.noOutput": "Ninguna salida (modificada)." });
	// Should still have the same number of locales
	assert.equal(listLocales().length, originalCount);
});

test("addTranslations(): ignores empty locale string", () => {
	__test__resetI18n();
	const before = listLocales().length;
	addTranslations("", { "agent.noOutput": "test" });
	assert.equal(listLocales().length, before);
});

// ─── __test__resetI18n ────────────────────────────────────────────────────

test("__test__resetI18n(): removes runtime-added translations", () => {
	__test__resetI18n();
	addTranslations("xx", { "agent.noOutput": "XX test" });
	assert.ok(listLocales().includes("xx"));
	__test__resetI18n();
	assert.ok(!listLocales().includes("xx"), "should remove runtime-added locale");
});

test("__test__resetI18n(): preserves built-in locales", () => {
	__test__resetI18n();
	assert.ok(listLocales().includes("es"));
	assert.ok(listLocales().includes("fr"));
	assert.ok(listLocales().includes("pt-BR"));
});

// ─── Template edge cases ──────────────────────────────────────────────────

test("t(): handles params with no matching template vars gracefully", () => {
	__test__resetI18n();
	// agent.noOutput has no template vars, so extra params are ignored
	assert.equal(t("agent.noOutput", { extra: "ignored" }), "No output.");
});

test("t(): all fallback keys have valid templates", () => {
	__test__resetI18n();
	// Spot-check several keys
	assert.equal(t("result.notFound", { id: "xyz" }), "Agent not found: xyz");
	assert.equal(t("result.waitTimeout"), "Timed out waiting for subagent result.");
	assert.equal(t("steer.noted", { id: "agent-1" }), "Steering request noted for agent-1.");
	assert.equal(t("steer.cancelHint", { runId: "run-123" }), "Use team cancel runId=run-123 if the agent must be interrupted.");
});

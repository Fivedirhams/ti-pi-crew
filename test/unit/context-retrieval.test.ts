import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	scoreRelevance,
	hasConverged,
	refineQuery,
	shouldContinue,
	type RetrievalQuery,
	type RelevanceEvaluation,
} from "../../src/runtime/task-runner/context-retrieval.ts";

describe("scoreRelevance", () => {
	it("returns 0 when keywords array is empty", () => {
		const score = scoreRelevance("src/foo.ts", "content here", []);
		assert.equal(score, 0);
	});

	it("scores higher when path matches keywords", () => {
		const score = scoreRelevance("src/task-runner.ts", "some content", ["task"]);
		assert.ok(score > 0, `Expected score > 0, got ${score}`);
	});

	it("scores higher when content matches keywords", () => {
		const score = scoreRelevance("src/foo.ts", "task runner implementation", ["task"]);
		assert.ok(score > 0, `Expected score > 0, got ${score}`);
	});

	it("returns 0 when no keywords match", () => {
		const score = scoreRelevance("src/foo.ts", "unrelated content", ["missing"]);
		assert.equal(score, 0);
	});

	it("path match contributes more than content match", () => {
		const pathOnly = scoreRelevance("task-manager.ts", "xyz", ["task"]);
		const contentOnly = scoreRelevance("xyz.ts", "task manager", ["task"]);
		assert.ok(
			pathOnly >= contentOnly,
			`Path match (${pathOnly}) should be >= content match (${contentOnly})`,
		);
	});

	it("score is clamped between 0 and 1", () => {
		const score = scoreRelevance(
			"task-runner.ts",
			"task task task task task task task task task",
			["task", "runner", "test"],
		);
		assert.ok(score >= 0 && score <= 1, `Score ${score} out of range [0,1]`);
	});

	it("multiple keyword matches increase score", () => {
		const single = scoreRelevance("src/task.ts", "some content here", ["task"]);
		const multi = scoreRelevance("src/task-runner.ts", "some content here", ["task", "runner"]);
		assert.ok(multi >= single, `Multi-keyword (${multi}) should be >= single (${single})`);
	});
});

describe("hasConverged", () => {
	it("returns false when fewer than 3 high-relevance evaluations", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.9, reason: "good", missingContext: [] },
			{ path: "b.ts", relevance: 0.8, reason: "good", missingContext: [] },
		];
		assert.equal(hasConverged(evals), false);
	});

	it("returns true when 3+ high-relevance and no critical gaps", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.9, reason: "good", missingContext: [] },
			{ path: "b.ts", relevance: 0.8, reason: "good", missingContext: [] },
			{ path: "c.ts", relevance: 0.75, reason: "good", missingContext: [] },
		];
		assert.equal(hasConverged(evals), true);
	});

	it("returns false when a critical gap exists (low relevance with missing context)", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.9, reason: "good", missingContext: [] },
			{ path: "b.ts", relevance: 0.8, reason: "good", missingContext: [] },
			{ path: "c.ts", relevance: 0.75, reason: "good", missingContext: [] },
			{ path: "d.ts", relevance: 0.2, reason: "gap", missingContext: ["critical-config"] },
		];
		assert.equal(hasConverged(evals), false);
	});

	it("returns true with high-relevance files even if some have missingContext", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.9, reason: "good", missingContext: ["extra"] },
			{ path: "b.ts", relevance: 0.8, reason: "good", missingContext: [] },
			{ path: "c.ts", relevance: 0.75, reason: "good", missingContext: [] },
		];
		// No low-relevance evaluation with missingContext => converged
		assert.equal(hasConverged(evals), true);
	});

	it("returns false for empty evaluations", () => {
		assert.equal(hasConverged([]), false);
	});
});

describe("refineQuery", () => {
	it("extracts keywords from high-relevance file paths", () => {
		const query: RetrievalQuery = {
			patterns: ["**/*.ts"],
			keywords: ["task"],
			excludes: [],
		};
		const evals: RelevanceEvaluation[] = [
			{
				path: "src/task-manager.ts",
				relevance: 0.9,
				reason: "good",
				missingContext: [],
			},
		];
		const refined = refineQuery(query, evals);
		assert.ok(refined.keywords.includes("task"), "Should keep original keyword 'task'");
		assert.ok(refined.keywords.includes("manager"), "Should extract 'manager' from path");
	});

	it("excludes low-relevance paths", () => {
		const query: RetrievalQuery = {
			patterns: ["**/*.ts"],
			keywords: ["task"],
			excludes: [],
		};
		const evals: RelevanceEvaluation[] = [
			{
				path: "src/unrelated-junk.ts",
				relevance: 0.1,
				reason: "irrelevant",
				missingContext: [],
			},
		];
		const refined = refineQuery(query, evals);
		assert.ok(refined.excludes.includes("src/unrelated-junk.ts"));
	});

	it("adds missing context as focus areas", () => {
		const query: RetrievalQuery = {
			patterns: ["**/*.ts"],
			keywords: ["task"],
			excludes: [],
		};
		const evals: RelevanceEvaluation[] = [
			{
				path: "src/partial.ts",
				relevance: 0.5,
				reason: "partial",
				missingContext: ["config-schema", "types"],
			},
		];
		const refined = refineQuery(query, evals);
		assert.deepEqual(refined.focusAreas, ["config-schema", "types"]);
	});

	it("preserves original patterns unchanged", () => {
		const query: RetrievalQuery = {
			patterns: ["**/*.ts", "**/*.js"],
			keywords: ["task"],
			excludes: [],
		};
		const refined = refineQuery(query, []);
		assert.deepEqual(refined.patterns, ["**/*.ts", "**/*.js"]);
	});

	it("skips non-informative path segments when extracting keywords", () => {
		const query: RetrievalQuery = {
			patterns: ["**/*.ts"],
			keywords: [],
			excludes: [],
		};
		const evals: RelevanceEvaluation[] = [
			{
				path: "src/lib/test/dist/node_modules/task.ts",
				relevance: 0.9,
				reason: "good",
				missingContext: [],
			},
		];
		const refined = refineQuery(query, evals);
		// "task" should be extracted from the filename stem
		assert.ok(refined.keywords.includes("task"), `Expected 'task' in keywords, got ${JSON.stringify(refined.keywords)}`);
		// "src", "lib", "test", "dist", "node_modules" should NOT be keywords
		for (const skip of ["src", "lib", "test", "dist"]) {
			assert.ok(!refined.keywords.includes(skip), `Should not include '${skip}' as keyword`);
		}
	});
});

describe("shouldContinue", () => {
	it("returns true when cycle < 3 and not converged", () => {
		const evals: RelevanceEvaluation[] = [];
		assert.equal(shouldContinue(evals, 0), true);
		assert.equal(shouldContinue(evals, 1), true);
		assert.equal(shouldContinue(evals, 2), true);
	});

	it("returns false when cycle >= 3", () => {
		const evals: RelevanceEvaluation[] = [];
		assert.equal(shouldContinue(evals, 3), false);
		assert.equal(shouldContinue(evals, 4), false);
	});

	it("returns false when converged (3+ high relevance, no gaps)", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.9, reason: "good", missingContext: [] },
			{ path: "b.ts", relevance: 0.8, reason: "good", missingContext: [] },
			{ path: "c.ts", relevance: 0.75, reason: "good", missingContext: [] },
		];
		assert.equal(shouldContinue(evals, 0), false);
	});

	it("returns true when not converged and cycle < 3", () => {
		const evals: RelevanceEvaluation[] = [
			{ path: "a.ts", relevance: 0.4, reason: "partial", missingContext: ["gap"] },
		];
		assert.equal(shouldContinue(evals, 1), true);
	});
});

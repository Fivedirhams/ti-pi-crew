/**
 * run-not-found.ts — Centralized "Run not found" error helper (DX: F2).
 *
 * Round 16 DX audit found that a stale/typo'd runId hits a blank
 * "Run '<id>' not found." wall in 8+ handlers (status, resume, steer, export,
 * forget, cleanup, invalidate, worktrees, events, artifacts). The run IDs are
 * long (`team_20260615173318_b9c8fe49a74e0760`), so typos/truncation are
 * near-certain for new users — yet `team list` (which shows recent runs) is
 * never suggested.
 *
 * This module centralizes the message + recovery hint so every handler stays
 * consistent and the hint never drifts.
 */

import { result, type TeamContext } from "./context.ts";
import type { TeamToolDetails } from "../team-tool-types.ts";

/** Recovery hint appended to every "Run not found" message. */
export const RUN_NOT_FOUND_HINT =
	"\n\nTip: run action='list' to see recent runs and their IDs.";

/**
 * Build the standard "Run not found" error result with a recovery hint.
 *
 * @param runId  the (missing/typo'd) run id the caller passed
 * @param action the action that was attempted (for the details.action field)
 */
export function runNotFound(runId: string, action: string): ReturnType<typeof result> {
	return result(
		`Run '${runId}' not found.${RUN_NOT_FOUND_HINT}`,
		{ action, status: "error" } satisfies TeamToolDetails,
		true,
	);
}

/**
 * Helper: resolve a runId to its cwd, returning a runNotFound() result when
 * missing. Reduces the boilerplate `locateRunCwd → if (!runCwd) return ...`
 * duplicated across handlers.
 */
export function resolveRunOrNotFound(
	runId: string,
	action: string,
	cwd: string,
	locate: (runId: string, cwd: string) => string | undefined,
): { kind: "found"; runCwd: string } | { kind: "notfound"; result: ReturnType<typeof result> } {
	const runCwd = locate(runId, cwd);
	if (!runCwd) return { kind: "notfound", result: runNotFound(runId, action) };
	return { kind: "found", runCwd };
}

// Re-export TeamContext so callers importing this helper don't need a second
// import line — keeps the diff in each handler to a single import swap.
export type { TeamContext };

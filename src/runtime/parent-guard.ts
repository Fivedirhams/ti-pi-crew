/**
 * Parent liveness guard for pi-crew worker processes.
 *
 * Workers call `startParentGuard(parentPid)` at startup. A lightweight
 * interval checks if the parent PID is still alive. When the parent dies
 * (SIGKILL, crash, power loss, terminal close), the worker self-terminates
 * immediately — no sentinel process needed.
 *
 * Note: `process.kill(pid, 0)` works on both Unix and Windows in Node.js
 * for checking process existence. On Windows, it may throw for processes
 * owned by other users (permission error), but correctly detects dead PIDs.
 *
 * Usage in worker entry points:
 * ```ts
 * const parentPid = Number(process.env.PI_CREW_PARENT_PID);
 * if (parentPid > 0) startParentGuard(parentPid);
 * ```
 */

const POLL_INTERVAL_MS = 3_000;

let guardInterval: ReturnType<typeof setInterval> | undefined;

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function selfTerminate(parentPid: number): never {
	// Best-effort: try to log why we're dying
	try {
		if (typeof process.stderr?.write === "function") {
			process.stderr.write(`[pi-crew] Parent process ${parentPid} is dead — self-terminating worker ${process.pid}\n`);
		}
	} catch {
		// Ignore
	}
	process.exit(124); // 124 = "parent died" exit code
}

/**
 * Start a lightweight poll that checks if the parent process is still alive.
 * If the parent dies, this worker exits immediately with code 124.
 *
 * The interval is `unref()`'d so it doesn't keep the event loop alive
 * on its own — but if the worker has other work (LLM calls, tool execution),
 * the check continues running in the background.
 */
export function startParentGuard(parentPid: number): void {
	if (!parentPid || !Number.isFinite(parentPid) || parentPid <= 0) return;

	// Immediate check — if parent is already dead, don't even start
	if (!isPidAlive(parentPid)) {
		selfTerminate(parentPid);
	}

	guardInterval = setInterval(() => {
		if (!isPidAlive(parentPid)) {
			if (guardInterval) clearInterval(guardInterval);
			selfTerminate(parentPid);
		}
	}, POLL_INTERVAL_MS);

	guardInterval.unref();
}

/**
 * Stop the parent guard. Called when the worker finishes normally
 * and doesn't need to watch the parent anymore.
 */
export function stopParentGuard(): void {
	if (guardInterval) {
		clearInterval(guardInterval);
		guardInterval = undefined;
	}
}

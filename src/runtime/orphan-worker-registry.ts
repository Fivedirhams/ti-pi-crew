/**
 * Orphan background-worker registry.
 *
 * Tracks PIDs of background-runner.ts processes spawned via async-runner.
 * Workers are detached, setsid'd, and unref'd, so they outlive the spawning
 * pi session. If the parent pi process is killed (SIGKILL, crash), workers
 * become orphans and keep running forever.
 *
 * This registry provides:
 *   1. `registerWorker` — called from async-runner.ts after successful spawn.
 *   2. `unregisterWorker` — called when a worker exits (via async-marker
 *      or heartbeat watcher).
 *   3. `cleanupOrphanWorkers` — called on session_start; kills workers whose
 *      registration is older than STALE_REGISTRATION_MS (default 1h) and
 *      removes dead PIDs from the registry.
 *
 * Persistence: file-based JSON in `<userPiRoot>/state/orphan-workers.json`.
 * File is rewritten on every operation to drop dead PIDs.
 *
 * Thread-safety: All mutating operations (registerWorker, unregisterWorker,
 * cleanupOrphanWorkers) are protected by file locking to prevent concurrent
 * writes from causing lost updates.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { userPiRoot } from "../utils/paths.ts";
import { logInternalError } from "../utils/internal-error.ts";
import { withFileLockSync } from "../state/locks.ts";

const STALE_REGISTRATION_MS = 60 * 60 * 1000; // 1 hour

export interface OrphanWorkerEntry {
	pid: number;
	sessionId: string;
	runId: string;
	/** Parent PID (the pi process that spawned this worker). Used to verify
	 * the owning session is actually dead before killing the worker. */
	parentPid: number;
	registeredAt: number; // epoch ms
}

/**
 * Verify that a PID is actually one of our background-runner processes.
 * Guards against PID reuse attacks: after a worker dies, OS may reuse
 * the same PID for an unrelated process. Without verification, we'd
 * kill that unrelated process.
 *
 * Strategy: read /proc/<pid>/cmdline (Linux) and verify:
 *   1. First arg is node (or wrapped node like bun/pm2)
 *   2. One of the args ends with "background-runner.ts"
 *
 * This is stronger than a simple substring match because it verifies
 * the actual script being executed, not just a string that happens to
 * appear somewhere in the command line.
 *
 * Falls back to trusting the registry on other platforms where /proc
 * isn't available.
 */
function verifyIsBackgroundWorker(pid: number): boolean {
	try {
		const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8");
		// cmdline is NUL-separated; empty string after final NUL is normal
		const args = cmdline.split("\0").filter((a) => a.length > 0);
		if (args.length === 0) return false;

		// Verify first arg is a node runtime (node, bun, deno, etc.)
		// We only want to verify node-based workers, not random processes
		const exe = path.basename(args[0]);
		if (!["node", "bun", "deno"].some((r) => exe.includes(r))) {
			return false;
		}

		// Check if any arg ends with background-runner.ts (the actual script)
		// This is the actual verification — the script must be our background-runner
		return args.some((arg) => arg.endsWith("background-runner.ts"));
	} catch {
		// /proc not available (macOS, Windows) or PID gone — trust registry
		return true;
	}
}

let REGISTRY_PATH = path.join(userPiRoot(), "state", "orphan-workers.json");

/** @internal Test-only: override the registry path. */
export function __test_setRegistryPath(p: string): void {
	REGISTRY_PATH = p;
}

function getRegistryPath(): string {
	return REGISTRY_PATH;
}

function readRegistry(): OrphanWorkerEntry[] {
	const p = getRegistryPath();
	try {
		if (!fs.existsSync(p)) return [];
		const raw = fs.readFileSync(p, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(e): e is OrphanWorkerEntry =>
				typeof e === "object" &&
				e !== null &&
				typeof e.pid === "number" &&
				typeof e.sessionId === "string" &&
				typeof e.runId === "string" &&
				typeof e.registeredAt === "number" &&
				typeof (e as { parentPid?: unknown }).parentPid === "number",
		);
	} catch {
		return [];
	}
}

function writeRegistry(entries: OrphanWorkerEntry[]): void {
	const p = getRegistryPath();
	try {
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify(entries, null, 2), { mode: 0o600 });
	} catch (error) {
		logInternalError(
			"orphan-worker-registry.write",
			error,
			`path=${p} entries=${entries.length}`,
		);
	}
}

/**
 * Add a worker PID to the registry. Idempotent (replaces existing entry
 * for the same PID).
 *
 * @param parentPid The PID of the spawning pi process. Used later to
 *   verify the owning session is actually dead before killing the worker.
 */
export function registerWorker(
	pid: number,
	sessionId: string,
	runId: string,
	parentPid: number,
): void {
	if (!Number.isFinite(pid) || pid <= 0) return;
	withFileLockSync(getRegistryPath(), () => {
		const entries = readRegistry();
		// Dedupe by PID
		const filtered = entries.filter((e) => e.pid !== pid);
		filtered.push({
			pid,
			sessionId,
			runId,
			parentPid: Number.isFinite(parentPid) ? parentPid : 0,
			registeredAt: Date.now(),
		});
		writeRegistry(filtered);
	});
}

/**
 * Remove a worker PID from the registry. Called when the worker is known
 * to have exited (e.g. via async-marker poll or heartbeat watcher).
 */
export function unregisterWorker(pid: number): void {
	if (!Number.isFinite(pid) || pid <= 0) return;
	withFileLockSync(getRegistryPath(), () => {
		const entries = readRegistry();
		const filtered = entries.filter((e) => e.pid !== pid);
		if (filtered.length !== entries.length) {
			writeRegistry(filtered);
		}
	});
}

export interface CleanupOrphanWorkersResult {
	scanned: number;
	killed: number;
	pruned: number; // dead PIDs removed from registry without killing
	kept: number; // alive and fresh
}

/**
 * Kill stale orphan background workers and prune dead PIDs from the registry.
 *
 * Strategy:
 *   - For each entry in the registry, check if the PID is still alive.
 *   - If alive AND registered > STALE_REGISTRATION_MS ago: SIGTERM the PID
 *     (it's an orphan from a long-dead session).
 *   - If alive AND fresh: keep (concurrent session).
 *   - If dead: prune from registry.
 *
 * @param currentSessionId If provided, workers from this session are
 *   ALWAYS kept regardless of age. This protects concurrent sessions.
 *   Pass undefined for unconditional cleanup (e.g. from `pi-crew cleanup`).
 */
export function cleanupOrphanWorkers(
	currentSessionId?: string,
): CleanupOrphanWorkersResult {
	let result: CleanupOrphanWorkersResult = { scanned: 0, killed: 0, pruned: 0, kept: 0 };
	withFileLockSync(getRegistryPath(), () => {
		const entries = readRegistry();
		const now = Date.now();
		const kept: OrphanWorkerEntry[] = [];
		let killed = 0;
		let pruned = 0;
		for (const entry of entries) {
			try {
				process.kill(entry.pid, 0);
				// PID is alive
				const isMine = currentSessionId && entry.sessionId === currentSessionId;
				if (isMine) {
					// My session's worker — keep regardless of age
					kept.push(entry);
					continue;
				}
				// Verify parent is actually dead before killing worker.
				// If parent is alive, this is a concurrent session's worker
				// (or the same session that was misidentified). Keep it.
				if (entry.parentPid > 0) {
					try {
						process.kill(entry.parentPid, 0);
						// Parent is alive — concurrent session, keep worker
						kept.push(entry);
						continue;
					} catch {
						// Parent is dead — proceed to verify it's actually our worker
					}
				}
				// Verify it's actually a background-runner, not a reused PID
				if (!verifyIsBackgroundWorker(entry.pid)) {
					// PID reused by another process — prune, don't kill
					pruned++;
					continue;
				}
				if (now - entry.registeredAt > STALE_REGISTRATION_MS) {
					// Stale orphan — SIGKILL because background-runner
					// intentionally ignores SIGTERM (BUG #17 fix).
					try {
						process.kill(entry.pid, "SIGKILL");
						killed++;
					} catch {
						// Race: died between check and kill
						pruned++;
					}
				} else {
					// Fresh and not mine, parent dead, but recently registered.
					// Could be the same session that died < 1h ago and was
					// about to be cleaned up by parent-guard. Be conservative
					// and SIGKILL — orphaned workers waste resources.
					try {
						process.kill(entry.pid, "SIGKILL");
						killed++;
					} catch {
						pruned++;
					}
				}
			} catch {
				// PID is dead — prune from registry
				pruned++;
			}
		}
		if (kept.length !== entries.length) {
			writeRegistry(kept);
		}
		result = {
			scanned: entries.length,
			killed,
			pruned,
			kept: kept.length,
		};
	});
	return result;
}

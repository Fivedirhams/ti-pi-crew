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
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { userPiRoot } from "../utils/paths.ts";
import { logInternalError } from "../utils/internal-error.ts";

const STALE_REGISTRATION_MS = 60 * 60 * 1000; // 1 hour

export interface OrphanWorkerEntry {
	pid: number;
	sessionId: string;
	runId: string;
	registeredAt: number; // epoch ms
}

function getRegistryPath(): string {
	return path.join(userPiRoot(), "state", "orphan-workers.json");
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
				typeof e.registeredAt === "number",
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
 */
export function registerWorker(
	pid: number,
	sessionId: string,
	runId: string,
): void {
	if (!Number.isFinite(pid) || pid <= 0) return;
	const entries = readRegistry();
	// Dedupe by PID
	const filtered = entries.filter((e) => e.pid !== pid);
	filtered.push({ pid, sessionId, runId, registeredAt: Date.now() });
	writeRegistry(filtered);
}

/**
 * Remove a worker PID from the registry. Called when the worker is known
 * to have exited (e.g. via async-marker poll or heartbeat watcher).
 */
export function unregisterWorker(pid: number): void {
	if (!Number.isFinite(pid) || pid <= 0) return;
	const entries = readRegistry();
	const filtered = entries.filter((e) => e.pid !== pid);
	if (filtered.length !== entries.length) {
		writeRegistry(filtered);
	}
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
			if (now - entry.registeredAt > STALE_REGISTRATION_MS) {
				// Stale orphan — kill it
				try {
					process.kill(entry.pid, "SIGTERM");
					killed++;
				} catch {
					// Race: died between check and kill
					pruned++;
				}
			} else {
				// Fresh and not mine — could be concurrent session, keep
				kept.push(entry);
			}
		} catch {
			// PID is dead — prune from registry
			pruned++;
		}
	}
	if (kept.length !== entries.length) {
		writeRegistry(kept);
	}
	return {
		scanned: entries.length,
		killed,
		pruned,
		kept: kept.length,
	};
}

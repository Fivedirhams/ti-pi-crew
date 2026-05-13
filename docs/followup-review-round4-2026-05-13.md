# Follow-up Review Round 4 — 2026-05-13

Review of commits `c7bd455` through `5f47e92` (7 commits on top of `faa81e4`).

## Summary

These commits harden live-session runtime cleanup, async runner lifecycle, crew-agent persistence, and Windows test flakiness. Overall quality is high and the fixes address real production issues. However, one commit introduces a **regression** that breaks the resume/follow-up capability for completed live-session agents. Two other issues could cause crashes or races in edge cases.

---

## Critical

### BUG-014: `removeLiveAgentHandle` on normal completion destroys resume capability

**File:** `src/runtime/live-session-runtime.ts` (finally block, line ~610)  
**Commit:** `7a25644`

The finally block calls `removeLiveAgentHandle(agentId)` for non-aborted completions. This **deletes the live-agent handle from the registry entirely**, including its terminal status. The existing test `listActiveLiveAgents excludes terminal handles kept for resume` expects terminal handles to remain in the registry (excluded from `listActiveLiveAgents` but present in `listLiveAgents`).

**Impact:** After a live-session task completes normally, `steerLiveAgent`, `followUpLiveAgent`, and `resumeLiveAgent` all fail with "Live agent '...' is not registered in this process." The dashboard/API cannot resume or follow up with completed agents.

**Fix:** Dispose the session to free resources, but keep the handle in the registry. Add a new exported function in `live-agent-manager.ts`:

```ts
export function disposeLiveAgentSession(agentIdOrTaskId: string): void {
    const handle = getLiveAgent(agentIdOrTaskId);
    if (!handle) return;
    safeDisposeLiveSession(handle);
}
```

Then replace `removeLiveAgentHandle(agentId)` with `disposeLiveAgentSession(agentId)` in `live-session-runtime.ts`.

---

## High

### BUG-015: `withAgentsLock` crashes on `EISDIR` from corrupted lock path

**File:** `src/runtime/crew-agent-records.ts`  
**Commit:** `c7bd455`

`withAgentsLock` uses `fs.openSync(filePath, O_WRONLY | O_CREAT | O_EXCL)` and only catches `EEXIST`:

```ts
if (code !== "EEXIST") throw error;
```

If the lock path exists as a directory (e.g., from corrupted state or manual manipulation), `fs.openSync` throws `EISDIR`, which is not caught. The process crashes with an uncaught exception.

**Fix:** Handle `EISDIR` by removing the directory and retrying:

```ts
if (code !== "EEXIST" && code !== "EISDIR") throw error;
if (code === "EISDIR") {
    try { fs.rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
    continue;
}
```

---

## Medium

### BUG-016: `markActiveTasksAndAgentsFailed` lacks run-level lock, races with crash recovery

**File:** `src/extension/async-notifier.ts`  
**Commit:** `d6d466d`

`markActiveTasksAndAgentsFailed` calls `saveRunTasks` and `saveCrewAgents` without acquiring the run lock (`withRunLockSync`). Crash recovery (`cancelOrphanedRuns`) also updates the same run's tasks and agents, but it uses `withRunLockSync`. If both execute concurrently on the same run, the async notifier's unprotected write can race with crash recovery's locked write, causing lost updates or inconsistent state.

**Fix:** Wrap `markActiveTasksAndAgentsFailed` inside `withRunLockSync` in `markDeadAsyncRunIfNeeded`, or refactor `markActiveTasksAndAgentsFailed` to accept a locked manifest and only be called from within a lock.

---

## Low

### BUG-017: `safeDisposeLiveSession` catches all errors silently

**File:** `src/runtime/live-agent-manager.ts`  
**Commit:** `7a25644`

```ts
function safeDisposeLiveSession(handle: LiveAgentHandle): void {
    try { handle.session.dispose?.(); } catch { /* best-effort cleanup */ }
}
```

Any exception from `dispose()` is swallowed without logging. If the Pi SDK's `dispose` throws due to a real bug, this hides it completely.

**Fix:** Log disposal errors via `logInternalError`:

```ts
function safeDisposeLiveSession(handle: LiveAgentHandle): void {
    try { handle.session.dispose?.(); } catch (error) {
        logInternalError("live-agent-manager.dispose", error, `agentId=${handle.agentId}`);
    }
}
```

### BUG-018: `effectiveRuntime` in `run.ts` is manually constructed

**File:** `src/extension/team-tool/run.ts`  
**Commit:** `2486051`

The async fallback runtime is manually built:

```ts
effectiveRuntime = { kind: "child-process", requestedMode: runtime.requestedMode, available: true, steer: false, resume: false, liveToolActivity: false, transcript: true, safety: "trusted" as const, fallback: "child-process", reason: "..." };
```

If `CrewRuntimeCapabilities` gains a new required field in the future, this site won't inherit it automatically.

**Fix:** Use a spread of the original runtime with overrides:

```ts
effectiveRuntime = { ...runtime, kind: "child-process", steer: false, resume: false, liveToolActivity: false, fallback: "child-process", reason: "Background runner cannot use live-session; falling back to child-process." };
```

### NIT-007: `removeStaleAgentsLock` reads unlimited file size

**File:** `src/runtime/crew-agent-records.ts`  
**Commit:** `c7bd455`

`fs.readFileSync(lockPath, "utf-8")` reads the entire lock file into memory. If the lock file is corrupted into a multi-megabyte file, this could cause memory pressure. The lock file should only ever be a small JSON object, but a size cap would be safer.

**Fix:** Check `fs.statSync(lockPath).size` before reading, and skip stale removal if the file is unreasonably large (> 1KB).

### NIT-008: `maxCollectedJsonEvents` cap is not configurable

**File:** `src/runtime/live-session-runtime.ts`  
**Commit:** `c7bd455`

The 200-event cap is hardcoded. Long-running live-session agents that generate many JSON events (e.g., tool calls) might drop older events needed for debugging or yield detection.

**Fix:** Make `maxCollectedJsonEvents` configurable via `runtimeConfig` or at least increase it to 1000.

---

## Verification

- `npm run typecheck` passes.
- Targeted tests (`async-notifier`, `isolation-policy`, `live-agent-manager`, `live-session-runtime`, `team-tool-dispatch`) pass.
- Full unit test suite not run due to time constraints; no new failures observed in targeted runs.

## Recommended Action Order

1. **P0** — Fix BUG-014 (resume regression). This breaks a documented capability.
2. **P1** — Fix BUG-015 (EISDIR crash). Edge case but hard crash.
3. **P2** — Fix BUG-016 (race in async notifier). Low probability but data-loss risk.
4. **P3** — Fix BUG-017, BUG-018, NIT-007, NIT-008 in a follow-up batch.

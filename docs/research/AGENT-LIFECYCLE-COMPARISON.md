# Agent Lifecycle: pi-crew vs oh-my-pi

## Architecture Fundamental Difference

| Aspect | oh-my-pi | pi-crew |
|--------|----------|---------|
| **Execution model** | In-process (`createAgentSession()`) | Child process (`child_process.spawn()`) |
| **Agent tracking** | In-memory `Map<string, AgentRef>` | File-based `active-run-index.json` |
| **Lifetime** = Process lifetime | ✅ Yes (GC + process exit cleans everything) | ❌ No (files persist after process exit) |
| **Abort mechanism** | `AbortController` → `session.abort()` | File-based status + process kill |

## Edge Case Matrix

### Case 1: Normal session exit (user types /exit or Pi quits normally)

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | `shutdown()` → `dispose()` → `session_shutdown` event | Same — Pi calls `session_shutdown` → `cleanupRuntime()` |
| **Subagents** | `session.dispose()` kills all in-process agents | `stopSessionBoundSubagents()` → `terminateActiveChildPiProcesses()` kills child procs |
| **State cleanup** | In-memory Map → auto-clean by GC | **❌ `cleanupRuntime()` does NOT call `unregisterActiveRun()`** |
| **Result** | ✅ Clean | ⚠️ Child procs killed, but active-run-index.json still has entries pointing to cancelled manifests |

### Case 2: SIGTERM (kill <pid>)

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | Signal handler → `shutdown()` → `dispose()` | Same — Pi calls `session_shutdown` |
| **Result** | ✅ Clean | ⚠️ Same as Case 1 — child procs killed, index stale |

### Case 3: SIGINT (Ctrl+C)

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | Pi's Ctrl+C handler (not SIGINT signal) — asks confirm, then `shutdown()` | Same |
| **Result** | ✅ Clean (if user confirms) | ⚠️ Same as Case 1 |

### Case 4: SIGKILL / kill -9 / taskkill /f

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | Process dies instantly. No handlers fire. | Same |
| **Child processes** | In-process → die with parent ✅ | **❌ Child Pi processes become ORPHANS** |
| **State** | In-memory → gone ✅ | **❌ active-run-index.json has zombie entries, manifests stuck at "running"** |
| **Recovery** | Not needed | **Session start `purgeStaleActiveRunIndex()` + `cancelOrphanedRuns()`** — NOW implemented ✅ |

### Case 5: Terminal closed (SIGHUP / window X button)

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | `emergencyTerminalExit()` → `killTrackedDetachedChildren()` → `process.exit(129)` | Same |
| **Extension events** | **❌ `session_shutdown` NOT fired** | **❌ `cleanupRuntime()` NOT called** |
| **Child processes** | In-process → die ✅ | **❌ Child procs NOT killed** (only `killTrackedDetachedChildren()` which is Pi's own tracked children, not pi-crew's) |
| **Result** | ✅ Clean (in-process) | **❌ Total zombie — child procs alive, index stale, manifests stuck** |

### Case 6: Computer crash / power loss

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Result** | ✅ Clean (everything in-memory) | **❌ File-based state corrupted/inconsistent** |

### Case 7: Out of Memory (OOM kill)

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Result** | Same as SIGKILL | Same as SIGKILL |

### Case 8: Node.js uncaught exception

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **Path** | Depends on Pi's uncaughtException handler | Same |
| **Result** | In-process agents may leak | **❌ Child procs may survive as orphans** |

### Case 9: Test runs that create state

| | oh-my-pi | pi-crew |
|--|----------|---------|
| **State creation** | No persistent state | `createRunManifest()` + `registerActiveRun()` |
| **Cleanup** | Automatic (in-process) | **❌ Many tests don't call `unregisterActiveRun()`** |
| **Result** | ✅ Clean | **❌ active-run-index.json accumulates test garbage** |

## Summary: What's Fixed and What's Not

### Fixed in this session:
1. ✅ `purgeStaleActiveRunIndex()` — scans global active-run-index at session_start AND cleanupRuntime
2. ✅ Removes entries with: missing manifest, missing cwd, terminal status, dead PID + stale
3. ✅ `cancelOrphanedRuns()` — cancels project-scoped orphaned runs
4. ✅ **`parent-guard.ts`** — workers self-monitor parent PID, auto-exit if parent dies
5. ✅ **`PI_CREW_PARENT_PID`** env var injected into all child spawns (child-pi + async-runner)
6. ✅ **`background-runner.ts`** calls `startParentGuard()` at startup
7. ✅ **`cleanupRuntime()`** now calls `purgeStaleActiveRunIndex()` on session end
8. ✅ **`executeTeamRun`** wrapped in try/catch — unhandled errors set manifest to "failed"

### What oh-my-pi does that pi-crew can never match:
- oh-my-pi agents are **in-process** → process death = guaranteed cleanup
- pi-crew agents are **child processes** → parent-guard + stale purge covers all cases

## The parent-guard solution

```
Parent Pi process (PID 100)
├── background-runner.ts (PID 200) ← env PI_CREW_PARENT_PID=100
│   ├── startParentGuard(100)  ← polls every 3s: is PID 100 alive?
│   ├── ... runs workflow ...
│   └── if PID 100 dies → process.exit(124) ← SELF-TERMINATE
└── child-pi.ts worker (PID 300) ← env PI_CREW_PARENT_PID=100
    └── (Pi itself checks PI_CREW_PARENT_PID in its own entry point)
```

**Key**: Workers check parent liveness THEMSELVES. No external sentinel needed.
If parent dies (SIGKILL, crash, power loss) → workers detect within 3s and exit.

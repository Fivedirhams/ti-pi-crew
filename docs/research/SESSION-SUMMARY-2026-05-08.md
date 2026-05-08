# pi-crew Session Summary — 2026-05-08

## What Was Done

### 1. Full Code Review → 10 Bug Fixes
- **Verdict: FAIL** (2 CRITICAL + 1 HIGH)
- All 10 bugs fixed: C1, C2, H1-H4, M1, M2, L1, L3
- Verified: `npm run typecheck` ✅, `npm test` 991/994 pass

### 2. Deep Research on oh-my-pi (v14.7.6)
- `git pull` → 55 files changed, +906/-249 lines
- **CRITICAL DISCOVERY**: oh-my-pi uses IN-PROCESS execution (subagent runs in same process as parent)
- pi-crew uses CHILD-PROCESS execution (extension-based architecture)
- This explains WHY pi-crew needs `parent-guard.ts` and oh-my-pi doesn't

### 3. Live-Session Production-Ready Upgrade
- **9 phases implemented** (Phase 0-8): experimental flag removal, yield enforcement, AJV schema validation, AbortSignal, MCP proxy, extension runner, semaphore, IRC, health monitoring
- **All verified** with typecheck + tests

### 4. Parity Gaps G1-G6 Closed
| Gap | Feature | Status |
|-----|---------|--------|
| G1 | Custom Tool Injection (submit_result + irc) | ✅ Done |
| G2 | MCP Proxy (functional) | ✅ Done |
| G3 | AJV Schema Validation | ✅ Done |
| G4 | respondAsBackground | ✅ Done |
| G5 | Extension Runner | ✅ Done |
| G6 | toolChoice Workaround | ✅ Done |

### 5. Orphaned Run Cleanup
- `cancelOrphanedRuns()` — cancels orphaned project-level runs
- `purgeStaleActiveRunIndex()` — scans active-run-index.json for stale entries
- Integrated into: `cleanupRuntime()` + `session_start` event

### 6. Parent Guard (OS-Level Child Cleanup)
- **`parent-guard.ts`** — workers self-monitor parent PID, auto-exit if parent dies
- **`PI_CREW_PARENT_PID`** env var injected into all child spawns
- **Why**: pi-crew uses child processes (unlike oh-my-pi's in-process), so parent death doesn't auto-kill children

### 7. P1 Action Items from New Research
- ✅ **`scrubProcessEnv()`** — Added to `background-runner.ts` (macOS malloc fix)
- ⚠️ **Fetch URL syntax** — pi-crew doesn't have a fetch tool (low priority)
- ⚠️ **rewriteStaticImports** — pi-crew doesn't have JS code eval (low priority)

---

## Files Changed (This Session)

### Modified (23 files)
```
src/config/defaults.ts           — Phase 0: DEFAULT_LIVE_SESSION = true
src/extension/register.ts        — P0: purgeStaleActiveRunIndex + cleanupRuntime
src/runtime/async-runner.ts     — P1: PI_CREW_PARENT_PID + sentinel
src/runtime/background-runner.ts — P1: scrubProcessEnv + parent-guard
src/runtime/child-pi.ts         — P1: PI_CREW_PARENT_PID injection
src/runtime/crash-recovery.ts   — P0: cancelOrphanedRuns + purgeStaleActiveRunIndex
src/runtime/live-agent-manager.ts — G4: non-blocking IRC
src/runtime/live-session-runtime.ts — Phases 0-8, G1, G6
src/runtime/parallel-utils.ts   — Phase 6: mapConcurrentWithSignal
src/runtime/runtime-resolver.ts — Phase 0: removed experimental flag
src/runtime/subprocess-tool-registry.ts — H3: emit for error results
src/runtime/task-runner.ts      — H4: try/catch
src/runtime/task-runner/live-executor.ts — Phase 2: outputSchema passthrough
src/runtime/team-runner.ts      — P1: executeTeamRunCore try/catch
src/runtime/yield-handler.ts    — Phase 2 + G3: AJV validation
src/state/event-log-rotation.ts — C2, M1, L3: compaction + rotation
src/ui/run-event-bus.ts          — M2: non-blocking emit
src/utils/sse-parser.ts         — L1: non-greedy event parsing
src/extension/team-tool/parallel-dispatch.ts — C1, H1, H2: error handling
```

### Created (14 files)
```
src/runtime/custom-tools/submit-result-tool.ts  — G1: submit_result tool
src/runtime/custom-tools/irc-tool.ts             — G1: irc DM/broadcast tool
src/runtime/live-extension-bridge.ts            — G5: SDK-verified extension bridge
src/runtime/live-irc.ts                          — Phase 7: IRC routing
src/runtime/live-session-health.ts               — Phase 8: health monitoring
src/runtime/mcp-proxy.ts                         — G2: functional MCP proxy
src/runtime/orphan-sentinel.ts                   — (deprecated, parent-guard.ts used instead)
src/runtime/parent-guard.ts                      — P1: parent PID watchdog
src/runtime/semaphore.ts                         — Phase 6: Semaphore + fail-fast
docs/research/AGENT-LIFECYCLE-COMPARISON.md     — Edge case analysis
docs/research/LIVE-SESSION-PRODUCTION-READY-PLAN.md — 9-phase plan
docs/research/OH-MY-PI-DEEP-RESEARCH-v14.7.6.md — v14.7.6 deep research
docs/research/REMAINING-GAPS-PLAN.md            — G1-G6 plan + status
```

---

## Architecture Insights

### Why pi-crew needs parent-guard (vs oh-my-pi)
```
oh-my-pi: Agent objects in-process → process.exit() = all dead (OS guarantee)
pi-crew:  Worker processes separate → parent dies → workers live forever
         → parent-guard.ts: worker polls parent PID, self-terminates on death
```

### pi-crew's Extension-Based Architecture
- **pi-crew is a Pi extension** (not built-in)
- Cannot embed in Pi's process → must use child processes
- Child process isolation is actually a FEATURE (fault tolerance)
- But needs explicit cleanup mechanisms (parent-guard, stale index purge)

### Parent-guard Design (Final)
```typescript
// Workers check parent liveness THEMSELVES
startParentGuard(parentPid: number): void {
  const interval = setInterval(() => {
    if (!isPidAlive(parentPid)) {
      clearInterval(interval);
      process.exit(124);  // self-terminate
    }
  }, 3000);
}
```

---

## Test Results
- `npm run typecheck` — ✅ pass
- `npm test` — 991/994 pass, 3 skipped, 0 failures
- P0/P1 tests (crash-recovery, active-run-registry, stale-reconciler, team-runner): **19/19 pass**

---

## Next Steps (Not Done — Low Priority)
1. **Loop limit** — `/loop 10` iteration limits (oh-my-pi feature)
2. **rewriteStaticImports** — ESM imports in JS code eval
3. **Fetch URL syntax** — pi-crew doesn't have fetch tool
4. **hideThinkingSummary** — model config option

---

## Commit Message Suggestion
```
feat: live-session production-ready + orphaned run cleanup + parent guard

- Live-session: Phase 0-8 (yield, AJV, AbortSignal, MCP, extension, semaphore, IRC, health)
- Parity: G1-G6 (custom tools, MCP proxy, schema validation, async IRC, extension bridge, toolChoice)
- Orphan cleanup: purgeStaleActiveRunIndex() + cancelOrphanedRuns()
- Parent guard: workers self-terminate when parent dies (PI_CREW_PARENT_PID)
- scrubProcessEnv: macOS malloc fix for child shells
- Bug fixes: C1, C2, H1-H4, M1, M2, L1, L3 (from code review)
```
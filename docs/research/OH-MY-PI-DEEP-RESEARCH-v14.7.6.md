# oh-my-pi Deep Research — v14.7.6 (2026-05-08)

**Pull**: `df07e8a5a..7632117de` (55 files, +906/-249 lines)
**Scope**: Phân tích toàn diện tất cả modules, đặc biệt new features

---

## 🔴 CRITICAL: oh-my-pi là IN-PROCESS, không phải child process

```typescript
// executor.ts line 961
const { session } = await createAgentSession({ ... });
await session.prompt(task, { attribution: "agent" });
// → Subagent chạy TRONG CÙNG PROCESS với parent!
// → Parent chết → child chết ngay lập tức (OS guarantee)
// → KHÔNG cần sentinel, watchdog, hay parent-guard gì cả
```

**Đây là lý do oh-my-pi không cần orphan cleanup:**
- oh-my-pi: `Agent` objects in-process → process.exit() = all dead
- pi-crew: Worker processes separate → need parent-guard

**pi-crew KHÔNG THỂ** đổi sang in-process vì:
- Extension-based architecture (cannot embed in Pi's process)
- pi-crew is a Pi extension, not a built-in
- Must remain child-process for isolation

→ **parent-guard.ts là giải pháp ĐÚNG cho pi-crew**

---

## 📦 New Features trong v14.7.x

### 1. `agentsMdSearch` + `workspaceTree` Passthrough
```typescript
// sdk.ts - Subagents inherit pre-scanned workspace data
createAgentSession({
  agentsMdSearch: resolvedAgentsMdSearch,  // skip re-scan
  workspaceTree: resolvedWorkspaceTree,     // skip re-scan
});
```
- **Lợi ích**: Subagent startup nhanh hơn (không scan lại filesystem)
- **pi-crew cần**: Pass `AGENTS.md` content + workspace tree qua env/args

### 2. `loop-limit.ts` — Iteration/Duration Limits
```typescript
// /loop 10 hoặc /loop 10m
parseLoopLimitArgs("10m")  // → { kind: "duration", durationMs: 600_000 }
parseLoopLimitArgs("3")    // → { kind: "iterations", iterations: 3 }

consumeLoopLimitIteration(limit);  // returns false when exhausted
isLoopDurationExpired(limit);     // checks duration deadline
```
- **Auto-submit**: 800ms delay after each turn, Esc cancels iteration
- **pi-crew có thể dùng**: Giới hạn số lần agent auto-repeat

### 3. `hideThinkingSummary` trong provider config
```typescript
// sdk.ts line 1655
hideThinkingSummary: settings.get("hideThinkingBlock"),
```
- **pi-crew cần**: Pass qua `modelConfig.hideThinkingSummary`

### 4. `rewriteStaticImports()` — ESM trong Code Eval
```typescript
// context-manager.ts - Tự động rewrite:
import { foo } from "bar";  // → const { foo } = await import("bar");
import * as ns from "x";    // → const ns = await import("x");
import default from "y";   // → const default = (await import("y")).default;
```
- User có thể paste ESM imports verbatim trong code eval
- **pi-crew chưa có**: JS executor cần integrate

### 5. `openai-completions-compat.ts` — 30+ Provider Handling
- Handles: Cerebras, Zai, Kilo, DeepSeek V4, Alibaba, Qwen, GitHub Copilot, Zenmux
- `detectOpenAICompat()` — auto-detect strict mode support
- `detectStrictModeSupport()` — provider + URL matching
- **pi-crew nên**: Học cách detect model capabilities từ provider

### 6. `scrubProcessEnv()` — macOS malloc fix
```typescript
// procmgr.ts
export function scrubProcessEnv(): void {
  delete process.env.MallocStackLogging;
  delete process.env.MallocStackLoggingNoCompact;
}
```
- Fixes stderr spam từ macOS debug-attach shells
- **pi-crew nên**: Add vào `child-pi.ts` hoặc `background-runner.ts`

### 7. Fetch URL line selector syntax change
```
# TRƯỚC: https://example.com:L50
# SAU:  https://example.com/:50
# hoặc:  https://example.com/:50-100
# hoặc:  https://example.com/:raw
```
- **pi-crew nên**: Cập nhật fetch tool để hỗ trợ `:50` thay vì `L50`

### 8. Abort race optimization
```typescript
// agent-loop.ts - Single abort race per event
const abortRacePromise = new Promise<void>(resolve => {
  abortSignal.addEventListener("abort", () => resolve(), { once: true });
});
await Promise.race([iterator.next(), abortRacePromise]);
```
- Thay vì add/remove listener cho mỗi event → dùng 1 race promise
- **pi-crew nên**: Học pattern này cho AbortSignal handling

---

## 🎯 Architecture Patterns từ oh-my-pi

### 1. Async Job Delivery (pi-crew đang làm G4)
```typescript
// sdk.ts line 938
await session.sendCustomMessage(
  { customType: "async-result", content: message, ... },
  { deliverAs: "followUp", triggerTurn: true }
);
```
- ✅ pi-crew đã làm tương tự trong G4 (`sendCustomMessage` với `deliverAs: "followUp"`)

### 2. Yield Enforcement
```typescript
// executor.ts - toolChoice to force yield
await session.prompt(reminder, {
  toolChoice: buildNamedToolChoice(["yield"])
});
```
- ✅ pi-crew đã làm trong G6 (setActiveToolsByName trước reminder)

### 3. Semaphore Pattern
```typescript
// parallel.ts
const semaphore = new Semaphore(maxConcurrency);
await semaphore.acquire();
// ... do work
semaphore.release();
```
- ✅ pi-crew đã implement trong Phase 6

### 4. mapWithConcurrencyLimit Fail-Fast
```typescript
// parallel.ts
mapWithConcurrencyLimit(tasks, max, runTask, signal);
```
- On first error → abort all workers via internal AbortController
- ✅ pi-crew đã implement fail-fast trong Phase 6

### 5. Session Disposal Timeout
```typescript
// executor.ts
untilAborted(AbortSignal.timeout(5000), () => session.dispose());
```
- Drain with timeout → force dispose
- **pi-crew cần**: Thêm timeout cho session disposal

---

## 📊 Parity Update

| Feature | oh-my-pi | pi-crew | Status |
|---------|----------|---------|--------|
| In-process execution | ✅ | ❌ (child processes) | pi-crew cần parent-guard |
| agentsMdSearch passthrough | ✅ | ❌ | Ghi nhớ |
| workspaceTree passthrough | ✅ | ❌ | Ghi nhớ |
| Loop limit (/loop) | ✅ | ❌ | Low priority |
| rewriteStaticImports | ✅ | ❌ | JS executor |
| hideThinkingSummary | ✅ | ❌ | Model config |
| Async job delivery | ✅ | ✅ | Done (G4) |
| Yield enforcement | ✅ | ✅ | Done (G6) |
| Semaphore fail-fast | ✅ | ✅ | Done (Phase 6) |
| scrubProcessEnv | ✅ | ❌ | Nice to have |
| Abort race optimization | ✅ | Partial | Low priority |

---

## 🎯 Action Items từ Research Mới

### P0 (Highest Priority)
1. ✅ **parent-guard.ts** — ĐÃ LÀM, đúng design
2. ✅ **purgeStaleActiveRunIndex** — ĐÃ LÀM, đúng design

### P1 (High Value)
3. **scrubProcessEnv()** — Add vào background-runner.ts
   ```typescript
   // Remove macOS malloc vars
   delete process.env.MallocStackLogging;
   delete process.env.MallocStackLoggingNoCompact;
   ```

### P2 (Medium Value)
4. **Fetch URL syntax** — Cập nhật `:50` thay vì `L50`
5. **rewriteStaticImports** — JS executor enhancement

### P3 (Nice to Have)
6. **Abort race optimization** — Đã có trong abort-controller
7. **Loop limit** — Low priority cho pi-crew

---

## 🔍 Chi Tiết Kỹ Thuật

### oh-my-pi's Session Architecture (7500-line class!)
- `#handleAgentEvent` — single handler for all events
- TTSR (Time-Traveling Stream Rules) — pattern abort + inject
- Auto-compaction on `agent_end` when context > threshold
- Auto-retry với exponential backoff + model fallback
- Streaming edit abort for auto-generated files
- `#cancelPostPromptTasks()` — cleanup background tasks

### TaskTool Dispatch Flow
```
TaskTool.execute(tasks, signal, onUpdate)
  → discoverAgents(cwd, scope)
  → resolveIsolationBackend(worktree/fuse/projfs)
  → for each task:
     → ensureWorktree/ensureFuseOverlay/ensureProjfsOverlay
     → createAgentSession()
     → session.prompt(task, { attribution: "agent" })
     → waitForIdle()
     → check yieldCalled → retry up to 3x
     → finalization (truncation, schema validation)
     → cleanup isolation dir (finally block)
```

### Async Job Lifecycle
```
register(type, label, run, options)
  → AbortController + Job ID
  → run() with signal + reportProgress
  → on complete: job.status = "completed"
  → delivery: sendCustomMessage({ deliverAs: "followUp" })
  → eviction timer after retentionMs
```

---

## 📝 Files Changed trong v14.7.x (New)

| File | Description |
|------|-------------|
| `modes/loop-limit.ts` | NEW — iteration/duration limits |
| `eval/js/context-manager.ts` | rewriteStaticImports, buildRequire |
| `tools/fetch.ts` | URL line range syntax change |
| `sdk.ts` | agentsMdSearch + workspaceTree passthrough |
| `agent.ts` | hideThinkingSummary |
| `providers/openai-completions-compat.ts` | 30+ provider compatibility |
| `providers/openai-completions.ts` | tool strict mode handling |
| `system-prompt.ts` | ordered systemPrompt arrays |
| `procmgr.ts` | scrubProcessEnv() |
| `interactive-mode.ts` | loop mode integration |

---

## ✅ Confirmation: pi-crew Design đúng

1. **parent-guard.ts**: ĐÚNG — vì pi-crew dùng child processes, không thể in-process
2. **purgeStaleActiveRunIndex**: ĐÚNG — cleanup file-level state
3. **G4 Async IRC**: ĐÚNG — sendCustomMessage deliverAs pattern
4. **G6 Yield Enforcement**: ĐÚNG — toolChoice workaround
5. **Phase 6 Semaphore**: ĐÚNG — fail-fast pattern

**Không có gì phải thay đổi trong design hiện tại.**
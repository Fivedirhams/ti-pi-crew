# Plan: Live-Session Production-Ready

**Ngày**: 2026-05-08  
**Mục tiêu**: Đưa live-session từ **experimental** → **production-ready**, học hỏi tối ưu từ oh-my-pi, giữ cốt lõi pi-crew (fault isolation, file-based state, extension-based architecture).

---

## Tình trạng hiện tại

### pi-crew live-session (hiện tại)
- **Status**: `PI_CREW_ENABLE_EXPERIMENTAL_LIVE_SESSION=1` → experimental
- **Code**: `live-session-runtime.ts` (~300 dòng), `live-executor.ts` (~100 dòng)
- **Đã có**: `createAgentSession()` in-process, event subscription, sidechain output, turn limits, steer/abort qua polling, `LiveAgentHandle` manager
- **Thiếu**: Yield enforcement, output schema validation, MCP proxy, fail-fast, AbortSignal, schema-based yield tool, extension runner

### oh-my-pi executor (tham chiếu)
- **Code**: `executor.ts` (~1291 dòng), `parallel.ts` (~110 dòng), `yield.ts` (~170 dòng)
- **Đã có**: Yield enforcement (while loop + 3 reminders + `toolChoice`), output schema validation (AJV), MCP proxy tools, IRC inter-agent, fail-fast + AbortSignal, extension runner, subprocess tool registry with `renderInline`/`renderFinal`

---

## Nguyên tắc thiết kế

1. **Giữ pi-crew core**: File-based state, child-process isolation, event log, manifest-based lifecycle
2. **Học oh-my-pi patterns**: Yield enforcement, schema validation, fail-fast — nhưng adapt cho extension-based architecture
3. **Incremental**: Mỗi phase tự stand-alone, không cần phase sau để hoạt động
4. **Backward compatible**: child-process mode không bị ảnh hưởng, live-session là opt-in
5. **Test coverage**: Mỗi phase thêm test cho live-session path

---

## Phases

### Phase 0: Foundation — Loại bỏ experimental flag (2-3 ngày)

**Mục tiêu**: Live-session hoạt động ổn định không cần flag, graceful fallback khi SDK không có.

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/runtime-resolver.ts` | Bỏ yêu cầu `PI_CREW_ENABLE_EXPERIMENTAL_LIVE_SESSION=1`, chỉ check SDK export |
| `src/runtime/live-session-runtime.ts` | Hardening error messages, thêm `reason` chi tiết hơn |
| `src/config/defaults.ts` | Thêm `liveSession` defaults (probe timeout, session options) |

**Chi tiết**:
```
resolveCrewRuntime():
  - "auto" mode: thử probe live-session SDK, fallback child-process
  - "live-session" mode: probe SDK, fail gracefully nếu không có
  - KHÔNG cần env flag nữa
  - Giữ PI_CREW_MOCK_LIVE_SESSION cho test
```

**Acceptance**:
- [ ] `runtime.mode=live-session` hoạt động không cần env flag
- [ ] Fallback sang child-process khi SDK không có + log rõ ràng
- [ ] `runtime.mode=auto` ưu tiên child-process (không breaking change)
- [ ] Typecheck pass, existing tests pass

---

### Phase 1: Yield Enforcement (3-5 ngày) 🔥 QUICK WIN

**Mục tiêu**: Live-session worker PHẢI gọi `submit_result` để hoàn thành, giống oh-my-pi.

**Học từ oh-my-pi**:
```typescript
// oh-my-pi executor.ts — pattern cốt lõi
const MAX_YIELD_RETRIES = 3;
while (!yieldCalled && retryCount < MAX_YIELD_RETRIES && !abortSignal.aborted) {
    const reminder = prompt.render(submitReminderTemplate, { retryCount, maxRetries: MAX_YIELD_RETRIES });
    await session.prompt(reminder, { toolChoice: buildNamedToolChoice("yield", session.model) });
    await session.waitForIdle();
}
```

**pi-crew adaptation**: pi-crew không có `toolChoice` API, nên dùng prompt-based reminder.

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-session-runtime.ts` | Thêm yield enforcement loop sau `session.prompt()` |
| `src/runtime/yield-handler.ts` | Export `extractYieldFromLiveEvents()` helper |
| `src/runtime/task-runner/live-executor.ts` | Pass `collectedJsonEvents` cho yield check |

**Code sketch** — `live-session-runtime.ts`:
```typescript
// Sau session.prompt() + session idle

// --- Yield enforcement ---
const yieldConfig = input.runtimeConfig?.yield ?? DEFAULT_YIELD_CONFIG;
let yieldResult: YieldResult | undefined;
let yieldAttempts = 0;

// Check if yield already happened during initial prompt
const collectedEvents: Record<string, unknown>[] = [];
// (populated during session.subscribe callback)

if (yieldConfig.enabled) {
    yieldResult = checkYieldInEvents(collectedEvents);
    
    while (!yieldResult && yieldAttempts < yieldConfig.maxReminders && !input.signal?.aborted) {
        yieldAttempts++;
        const reminder = buildYieldReminder(yieldAttempts, yieldConfig.maxReminders, yieldConfig.reminderPrompt);
        await session.prompt?.(reminder, { source: "api", expandPromptTemplates: false });
        // Wait for session to process (poll-based)
        await new Promise(resolve => setTimeout(resolve, 1000));
        yieldResult = checkYieldInNewEvents(/* incremental events */);
    }
    
    if (!yieldResult && !input.signal?.aborted) {
        // Emit attention event — worker didn't yield
        input.onEvent?.({ type: "task.attention", reason: "no_yield", attempts: yieldAttempts });
    }
}
```

**Acceptance**:
- [ ] Live-session worker gọi `submit_result` → task completed
- [ ] Worker KHÔNG gọi `submit_result` → nhận reminder → gọi → completed
- [ ] Worker gọi sau 3 reminders → task.attention event + status needs_attention
- [ ] Child-process mode không bị ảnh hưởng
- [ ] Test: mock live-session + yield scenarios

---

### Phase 2: Output Schema Validation (2-3 ngày)

**Mục tiêu**: Worker submit result phải match output schema (nếu có), giống oh-my-pi YieldTool.

**Học từ oh-my-pi**:
- `YieldTool` nhận `outputSchema` từ session config
- Validate data bằng AJV (JTD → JSON Schema conversion)
- Schema validation failure → throw error, model tự retry
- After 2 failures → override, accept anyway

**pi-crew adaptation**: pi-crew dùng `structuredData` trong `submit_result`, không có dedicated YieldTool class.

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/yield-handler.ts` | Thêm `validateYieldData()` với optional schema |
| `src/runtime/live-session-runtime.ts` | Pass schema từ agent config, validate trước khi accept |
| `src/agents/agent-config.ts` | Thêm `outputSchema?: unknown` field |
| `src/config/config.ts` | Thêm `yield.schemaValidation` config |

**Code sketch**:
```typescript
// yield-handler.ts
export function validateYieldData(data: unknown, schema: unknown): { valid: boolean; error?: string } {
    if (!schema) return { valid: true };
    // Convert JTD → JSON Schema if needed
    // Validate with AJV (or lightweight alternative)
    // Return validation result
}
```

**Acceptance**:
- [ ] Agent có `outputSchema` → submit_result data phải match
- [ ] Validation fail → reminder prompt với error details
- [ ] Sau 2 failures → accept anyway + warning
- [ ] Không có schema → không validate (backward compatible)

---

### Phase 3: AbortSignal & Graceful Cancellation (2-3 ngày)

**Mục tiêu**: Live-session hỗ trợ AbortSignal, cancellation, timeout — giống child-process mode.

**Học từ oh-my-pi**:
```typescript
// executor.ts
const abortController = new AbortController();
const abortSignal = abortController.signal;
signal.addEventListener("abort", onAbort, { once: true, signal: listenerSignal });
// Session abort → cleanup → return partial results
```

**pi-crew hiện tại**: Đã có signal propagation (`input.signal → session.abort()`) nhưng:
- Không có timeout cho individual session operations
- Không return partial results
- Không có graceful cleanup sequence

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-session-runtime.ts` | Thêm session timeout, partial results, cleanup sequence |
| `src/runtime/task-runner/live-executor.ts` | Handle partial results |
| `src/config/defaults.ts` | Thêm `liveSession.responseTimeoutMs` |

**Code sketch**:
```typescript
// live-session-runtime.ts
const SESSION_TIMEOUT_MS = runtimeConfig?.liveSession?.responseTimeoutMs ?? 300_000; // 5 min

// Wrap session.prompt with timeout
const promptPromise = session.prompt?.(effectivePrompt, ...);
const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Session timeout")), SESSION_TIMEOUT_MS)
);

try {
    await Promise.race([promptPromise, timeoutPromise]);
} catch (error) {
    if (error.message === "Session timeout") {
        await session.abort?.();
        return { available: true, exitCode: 1, stdout, stderr: "Session timeout", jsonEvents, 
                 error: "Session timeout", partialOutput: stdout };
    }
    throw error;
}
```

**Acceptance**:
- [ ] Signal abort → session.abort() → partial results → clean exit
- [ ] Session timeout → abort → return partial results
- [ ] No zombie sessions sau abort
- [ ] Cleanup: unsubscribe, clearInterval, updateLiveAgentStatus

---

### Phase 4: MCP Proxy cho Live-Session (3-5 ngày)

**Mục tiêu**: Live-session worker dùng parent's MCP connections, không tự discover.

**Học từ oh-my-pi**:
```typescript
// executor.ts — createMCPProxyTools()
function createMCPProxyTools(mcpManager: MCPManager): CustomTool<TSchema>[] {
    return mcpManager.getTools().map(tool => ({
        name: tool.name,
        execute: async (_id, params, _onUpdate, _ctx, signal) => {
            const connection = await mcpManager.waitForConnection(serverName);
            return callTool(connection, mcpToolName, params, { signal });
        },
    }));
}
```

**pi-crew challenge**: Pi SDK's `createAgentSession` không nhận `customTools`. Cần tìm API đúng.

**Approach**:
1. Probe SDK cho `bindExtensions` hoặc tool injection API
2. Nếu có: inject MCP proxy tools qua SDK API
3. Nếu không: dùng `setActiveToolsByName` + event interception

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-session-runtime.ts` | Thêm MCP proxy tool injection |
| `src/runtime/mcp-proxy.ts` | NEW — Tạo MCP proxy tools từ parent's MCP config |
| `src/config/config.ts` | Thêm `runtime.liveSession.shareMcp: boolean` |

**Acceptance**:
- [ ] Live-session worker thấy parent's MCP tools
- [ ] MCP calls đi qua parent's connections
- [ ] MCP call failure → graceful error, không crash session
- [ ] Child-process mode không bị ảnh hưởng

---

### Phase 5: Extension Runner cho Live-Session (5-7 ngày) 🏗️

**Mục tiêu**: Live-session worker có đầy đủ extension lifecycle giống oh-my-pi.

**Học từ oh-my-pi**:
```typescript
// executor.ts — extension initialization
const extensionRunner = session.extensionRunner;
if (extensionRunner) {
    extensionRunner.initialize({
        sendMessage: (message, options) => session.sendCustomMessage(message, options),
        sendUserMessage: (content, options) => session.sendUserMessage(content, options),
        setActiveTools: (toolNames) => session.setActiveToolsByName(toolNames),
        setModel: (model) => runExtensionSetModel(session, model),
        // ... more APIs
    }, { /* host API */ });
    await extensionRunner.emit({ type: "session_start" });
}
```

**pi-crew adaptation**: Pi SDK có `bindExtensions()` — cần probe capabilities.

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-session-runtime.ts` | Thêm extension runner initialization |
| `src/runtime/live-extension-bridge.ts` | NEW — Bridge giữa pi-crew extension lifecycle và Pi SDK session |

**Acceptance**:
- [ ] Extensions load trong live-session worker
- [ ] Extension hooks fire đúng lifecycle
- [ ] Extension errors không crash session

---

### Phase 6: Semaphore + Fail-Fast cho Parallel Execution (2-3 ngày)

**Mục tiêu**: `mapConcurrent` trong live-session có fail-fast + AbortSignal, giống oh-my-pi.

**Học từ oh-my-pi**:
```typescript
// parallel.ts
const abortController = new AbortController();
const workerSignal = AbortSignal.any([signal, abortController.signal]);
const firstErrorPromise = new Promise<never>((_, reject) => { rejectFirst = reject; });
await Promise.race([Promise.all(workers), firstErrorPromise]);
// → fail-fast on first error
// → partial results on abort
```

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/parallel-utils.ts` | Thêm `AbortSignal` support, fail-fast, partial results |
| `src/runtime/semaphore.ts` | NEW — Semaphore class (copy oh-my-pi pattern) |
| `src/runtime/team-runner.ts` | Pass AbortSignal cho parallel dispatch |

**Code sketch** — `semaphore.ts`:
```typescript
export class Semaphore {
    #max: number;
    #current = 0;
    #queue: Array<() => void> = [];

    constructor(max: number) { this.#max = Math.max(1, max); }

    async acquire(): Promise<void> {
        if (this.#current < this.#max) { this.#current++; return; }
        const { promise, resolve } = Promise.withResolvers<void>();
        this.#queue.push(resolve);
        return promise;
    }

    release(): void {
        const next = this.#queue.shift();
        if (next) next();
        else this.#current--;
    }
}
```

**Acceptance**:
- [ ] `mapConcurrent` nhận optional `AbortSignal`
- [ ] First error → cancel remaining → throw
- [ ] External abort → return partial results
- [ ] Semaphore pattern cho cross-batch concurrency control

---

### Phase 7: Inter-Agent Communication (5-7 ngày) 🏗️

**Mục tiêu**: Live-session workers có thể communicate real-time (DM + broadcast), học từ oh-my-pi IRC.

**Học từ oh-my-pi**:
- `IrcTool` với `op: send/list`, `to: "agent-id" | "all"`
- `AgentRegistry` quản lý live agents
- `respondAsBackground()` — side-channel call không block recipient

**pi-crew adaptation**: pi-crew đã có `LiveAgentHandle` manager + `followUpLiveAgent()`. Cần:
1. Thêm `irc` tool vào live-session (via `setActiveToolsByName` hoặc custom tool)
2. Message routing qua `LiveAgentHandle.pendingFollowUps`
3. Broadcast qua `listLiveAgents()` → loop

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-agent-manager.ts` | Thêm message routing, broadcast |
| `src/runtime/live-irc-tool.ts` | NEW — IRC tool cho live-session workers |
| `src/runtime/live-session-runtime.ts` | Inject IRC tool vào session |

**Acceptance**:
- [ ] Worker A gửi DM cho Worker B → B nhận message
- [ ] Broadcast → tất cả live workers nhận
- [ ] `respondAsBackground` → không block recipient
- [ ] Child-process workers dùng mailbox (không IRC)

---

### Phase 8: Monitoring & Observability (2-3 ngày)

**Mục tiêu**: Live-session có đầy đủ observability — health check, metrics, diagnostics.

**Files thay đổi**:
| File | Thay đổi |
|------|----------|
| `src/runtime/live-session-runtime.ts` | Thêm health metrics, session stats |
| `src/runtime/live-agent-manager.ts` | Thêm `getHealth()` method |
| `src/runtime/task-runner/live-executor.ts` | Emit observability events |

**Acceptance**:
- [ ] Session health endpoint: active/idle/error count
- [ ] Usage metrics: tokens per session, duration
- [ ] Heartbeat cho live-session workers
- [ ] Dashboard hiển thị live-session status

---

## Roadmap tổng quan

```
Phase 0: Remove Experimental Flag     [2-3d]  ← START HERE
Phase 1: Yield Enforcement            [3-5d]  ← QUICK WIN
Phase 2: Output Schema Validation     [2-3d]
Phase 3: AbortSignal & Cancellation   [2-3d]
───────────────────────────────────────────── ~3 weeks
Phase 4: MCP Proxy                    [3-5d]
Phase 5: Extension Runner             [5-7d]
Phase 6: Semaphore + Fail-Fast        [2-3d]
───────────────────────────────────────────── ~5 weeks
Phase 7: Inter-Agent Communication    [5-7d]
Phase 8: Monitoring & Observability   [2-3d]
───────────────────────────────────────────── ~7 weeks total
```

### Quick Wins (Phase 0-1, ~1 tuần)
- Loại bỏ experimental flag
- Yield enforcement
- → Live-session đã usable cho production workloads

### Medium-term (Phase 2-3, ~2 tuần thêm)
- Schema validation
- AbortSignal + graceful cancellation
- → Live-session đáng tin cậy như child-process

### Long-term (Phase 4-8, ~4 tuần thêm)
- MCP proxy, extension runner
- Semaphore + fail-fast
- IRC messaging, monitoring
- → Live-session **vượt** child-process cho trusted workloads

---

## Priority Matrix

| Phase | Impact | Effort | Risk | Priority |
|-------|--------|--------|------|----------|
| 0: Remove experimental | 🔴 High | 🟢 Low | 🟢 Low | **P0 — Now** |
| 1: Yield enforcement | 🔴 High | 🟢 Low | 🟢 Low | **P0 — Now** |
| 3: AbortSignal | 🟡 Medium | 🟢 Low | 🟢 Low | **P1** |
| 2: Schema validation | 🟡 Medium | 🟡 Medium | 🟢 Low | **P1** |
| 6: Semaphore | 🟡 Medium | 🟢 Low | 🟢 Low | **P1** |
| 4: MCP proxy | 🔴 High | 🔴 High | 🟡 Medium | **P2** |
| 5: Extension runner | 🟡 Medium | 🔴 High | 🟡 Medium | **P2** |
| 7: IRC messaging | 🟡 Medium | 🟡 Medium | 🟡 Medium | **P3** |
| 8: Monitoring | 🟢 Low | 🟢 Low | 🟢 Low | **P3** |

---

## Rủi ro & Mitigation

| Rủi ro | Xác suất | Tác động | Mitigation |
|--------|----------|----------|------------|
| Pi SDK API thiếu (`toolChoice`, `customTools`, `extensionRunner`) | 🟡 Medium | 🔴 High | Probe SDK trước mỗi phase, fallback to prompt-based |
| Live-session crash cascade (no fault isolation) | 🟡 Medium | 🔴 High | Try-catch wrapper, session isolation, process-level guard |
| Performance regression (in-process memory pressure) | 🟢 Low | 🟡 Medium | Monitor memory, add session count limits |
| Breaking child-process mode | 🟢 Low | 🔴 High | Separate code paths, shared interfaces, test both |

---

## Testing Strategy

Mỗi phase thêm test theo pattern:

```typescript
// Test pattern cho live-session
describe(`Phase N: Feature Name`, () => {
    // Unit: mock session
    test("yield enforcement loop triggers reminders", async () => {
        const mockSession = { prompt: mock.fn(), subscribe: mock.fn(), ... };
        // ... setup ...
        const result = await runLiveSessionTask({ ... mockSession ... });
        assert.equal(mockSession.prompt.callCount, 4); // 1 initial + 3 reminders
    });

    // Integration: mock SDK probe
    test("schema validation rejects invalid data", async () => {
        process.env.PI_CREW_MOCK_LIVE_SESSION = "success";
        // ... test with schema ...
    });

    // E2E: full pipeline (if SDK available)
    test.skip("full live-session pipeline with real SDK", async () => {
        // Requires PI_CREW_ENABLE_EXPERIMENTAL_LIVE_SESSION=1
    });
});
```

---

## Success Criteria — "Production Ready"

- [ ] **No experimental flag** — live-session works out of the box
- [ ] **Yield enforcement** — 100% tasks có structured output
- [ ] **Graceful degradation** — fallback sang child-process khi SDK không có
- [ ] **Cancellation** — abort signal dừng session trong <5s
- [ ] **No zombie sessions** — cleanup luôn chạy trong finally
- [ ] **Observability** — health check, usage metrics, diagnostics
- [ ] **Typecheck pass** — strict types, no `any`
- [ ] **Test coverage** — ≥80% cho live-session code paths
- [ ] **Performance** — live-session startup <100ms (vs child-process 2-5s)
- [ ] **Documentation** — README section cho live-session config

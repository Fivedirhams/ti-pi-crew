# Remaining Gaps Plan — pi-crew Live-Session → Production Parity

> **Ngày tạo**: 2026-05-08
> **Prerequisite**: Phases 0-8 đã hoàn thành (991/994 tests pass, typecheck clean)
> **Mục tiêu**: Đóng 6 gap còn lại để đạt **≥90% parity** với oh-my-pi

---

## Gap Analysis Summary

| # | Gap | Parity | Effort | Priority | Status |
|---|-----|--------|--------|----------|--------|
| G1 | Custom Tool Injection (Yield + IRC) | **100%** | 3-4d | P0 | ✅ Done |
| G2 | MCP Proxy (functional) | **70%** | 3-5d | P1 | ✅ Done |
| G3 | AJV Schema Validation | **100%** | 2d | P2 | ✅ Done |
| G4 | respondAsBackground (non-blocking IRC) | **70%** | 5-7d | P3 | ✅ Done |
| G5 | Extension Runner Integration Test | **90%** | 2-3d | P2 | ✅ Done |
| G6 | toolChoice enforcement for yield | **80%** | 1-2d | P3 | ✅ Done |

---

## G1: Custom Tool Injection (Yield + IRC as real tools)

### Vấn đề
- Workers chạy live-session **không thấy** `submit_result` tool hay `irc` tool
- oh-my-pi inject các tools này qua `createAgentSession({ customTools: [...] })`
- Pi SDK **có hỗ trợ**: `createAgentSession({ customTools: ToolDefinition[] })`

### Pi SDK API đã xác nhận
```typescript
// node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts
interface ToolDefinition<TParams, TDetails, TState> {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;  // TypeBox schema
    execute(toolCallId: string, params, signal, onUpdate, ctx): Promise<AgentToolResult>;
    promptSnippet?: string;
    promptGuidelines?: string[];
}

// Usage:
const session = await createAgentSession({
    cwd,
    customTools: [yieldTool, ircTool],  // ← This is what oh-my-pi does
});
```

### Implementation Plan

#### Bước 1: Tạo `src/runtime/custom-tools/submit-result-tool.ts`
- Dùng `defineTool()` từ Pi SDK để tạo `submit_result` tool
- `parameters`: TypeBox schema `{ summary: string, artifacts?: Record<string,string>, structuredData?: object }`
- `execute()`: Lưu result vào callback/store, return success
- `promptSnippet`: "Submit your final result using submit_result"
- `promptGuidelines`: ["Always call submit_result when your task is complete"]

```typescript
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";  // already in SDK

export function createSubmitResultTool(onYield: (result: YieldResult) => void) {
    return defineTool({
        name: "submit_result",
        label: "Submit Result",
        description: "Submit your final result...",
        parameters: Type.Object({
            summary: Type.String({ description: "Summary of your work" }),
            artifacts: Type.Optional(Type.Record(Type.String(), Type.String())),
            structuredData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }),
        async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
            onYield({ summary: params.summary, artifacts: params.artifacts, structuredData: params.structuredData, toolCallId });
            return { content: [{ type: "text", text: "Result submitted successfully." }] };
        },
        promptSnippet: "Submit your task result when done",
        promptGuidelines: ["Always call submit_result when your task is complete"],
    });
}
```

#### Bước 2: Tạo `src/runtime/custom-tools/irc-tool.ts`
- `parameters`: TypeBox schema `{ op: "send"|"list", to?: string, message?: string, awaitReply?: boolean }`
- `execute()`:
  - `op=list` → trả về danh sách live agents (từ `listLiveAgents()`)
  - `op=send` → route qua `sendIrcMessage()` / `broadcastIrcMessage()`
- `promptSnippet`: "Send messages to other live agents"

#### Bước 3: Update `live-session-runtime.ts`
- Import custom tools, inject qua `createAgentSession({ customTools: [...] })`
- Khi `submit_result` execute → set `yieldResult` + resolve promise
- Giảm yield enforcement loop vì `submit_result` là tool thật → model sẽ gọi nó

#### Bước 4: Update yield enforcement
- Thay vì detect `isYieldEvent()` từ JSON events → dùng callback từ `submit_result` tool
- Vẫn giữ reminder loop như fallback

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/custom-tools/submit-result-tool.ts` | **NEW** |
| `src/runtime/custom-tools/irc-tool.ts` | **NEW** |
| `src/runtime/live-session-runtime.ts` | Update: inject customTools |
| `src/runtime/yield-handler.ts` | Update: callback-based yield detection |

### Test strategy
- Unit test `createSubmitResultTool` → verify onYield callback
- Unit test `createIrcTool` → verify routing
- Integration test: `PI_CREW_MOCK_LIVE_SESSION` mock phải work với custom tools

---

## G2: MCP Proxy (Functional)

### Vấn đề
- `mcp-proxy.ts` hiện tại chỉ là placeholder → `discoverMcpToolsForProxy()` return `[]`
- oh-my-pi dùng `mcpManager.getTools()` + `createMCPProxyTools()` → inject as custom tools
- Pi SDK **không expose** `MCPManager` trực tiếp, nhưng có MCP tools trong session

### Probe cần làm
1. Kiểm tra xem Pi SDK session có MCP tools sau `bindExtensions()` không
2. Nếu có → dùng `session.getActiveToolNames()` + `getToolDefinition()` để discover
3. Nếu không → cần tạo proxy tools với connection sharing

### Implementation Plan

#### Bước 1: Probe MCP availability
```typescript
// Sau session.bindExtensions()
const activeTools = session.getActiveToolNames();
const mcpTools = activeTools.filter(n => n.startsWith("mcp__") || n.includes("__"));
```

#### Bước 2: Nếu MCP tools đã available
- Chỉ cần `enableMCP: true` (hoặc không set) trong `createAgentSession`
- MCP proxy không cần thiết → session tự discover

#### Bước 3: Nếu MCP tools không available
- Tạo proxy tools dùng `session.sendCustomMessage()` hoặc direct MCP call
- Inject qua `customTools` array

#### Bước 4: Connection sharing (nếu cần)
- Parse parent's `.pi/mcp.json` config
- Tạo MCP client connections trong parent process
- Share qua custom tool wrappers

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/mcp-proxy.ts` | **REWRITE** — functional discovery |
| `src/runtime/live-session-runtime.ts` | Update: use real MCP proxy |

---

## G3: AJV Schema Validation

### Vấn đề
- `validateYieldData()` hiện tại chỉ check basic types + required fields
- oh-my-pi dùng AJV (`ajv = new Ajv({ allErrors: true, strict: false })`) + `jtdToJsonSchema()`
- Thiếu: nested properties, pattern, enum, min/max, additionalProperties

### Implementation Plan

#### Bước 1: Thêm AJV dependency
```bash
cd pi-crew && npm install ajv
```

#### Bước 2: Update `validateYieldData()` trong `yield-handler.ts`
```typescript
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false, logger: false });

export function validateYieldData(data: unknown, schema: unknown): SchemaValidationResult {
    if (!schema) return { valid: true };
    try {
        const validate = ajv.compile(schema as object);
        const valid = validate(data);
        if (!valid) {
            return { valid: false, error: ajv.errorsText(validate.errors) };
        }
        return { valid: true };
    } catch {
        // Fallback to lightweight validation
        return lightweightValidate(data, schema);
    }
}
```

#### Bước 3: JTD → JSON Schema conversion (optional)
- Port `jtdToJsonSchema()` từ oh-my-pi nếu output schema dùng JTD format
- Hoặc yêu cầu caller pass JSON Schema trực tiếp

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/yield-handler.ts` | Update: AJV validation |
| `package.json` | Add: ajv dependency |

---

## G4: respondAsBackground (Non-blocking IRC)

### Vấn đề
- oh-my-pi dùng `session.respondAsBackground()` → gửi tin nhắn mà **không block** recipient
- pi-crew hiện tại dùng `session.prompt()` → **có thể block** nếu recipient đang streaming
- Pi SDK có `sendCustomMessage({ deliverAs: "followUp" })` và `sendUserMessage({ deliverAs: "steer" })`

### Pi SDK API đã xác nhận
```typescript
// ExtensionContext
sendMessage(message, options?: { triggerTurn?, deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
sendUserMessage(content, options?: { deliverAs?: "steer" | "followUp" }): void;
```

### Implementation Plan

#### Bước 1: Thử `deliverAs` option
```typescript
// Non-blocking message injection
session.sendCustomMessage?.(
    { customType: "irc", content: `[DM from ${from}] ${message}` },
    { deliverAs: "followUp", triggerTurn: false }
);
```

#### Bước 2: Fallback chain
1. `sendCustomMessage({ deliverAs: "followUp" })` — ideal
2. `sendUserMessage({ deliverAs: "steer" })` — less ideal, interrupts streaming
3. `session.steer(message)` — basic, waits for current turn
4. `session.prompt(message)` — blocking, last resort

#### Bước 3: Reply-waiting
- Nếu `awaitReply=true`:
  - Inject message (non-blocking)
  - Subscribe to events, filter for reply from target
  - Timeout after configurable period

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/live-agent-manager.ts` | Update: non-blocking delivery |
| `src/runtime/live-irc.ts` | Update: reply-waiting logic |

---

## G5: Extension Runner Integration Verification

### Vấn đề
- `live-extension-bridge.ts` đã build API bridge nhưng chưa test với SDK thật
- Cần verify: `extensionRunner.initialize(apis, host)` có hoạt động không
- Cần verify: event emission lifecycle

### Implementation Plan

#### Bước 1: Tạo integration test
```typescript
// test/integration/live-extension-bridge.test.ts
import { createAgentSession } from "@mariozechner/pi-coding-agent";

test("extension bridge initializes with real session", async () => {
    const session = await createAgentSession({ cwd: tmpdir() });
    // Probe extensionRunner
    const runner = (session as any).extensionRunner;
    // Verify bridge APIs match
});
```

#### Bước 2: Fix bridge APIs based on actual SDK shape
- `session.sessionManager` → check methods
- `session.model` → check getter
- `session.getContextUsage()` → check return type

#### Bước 3: Add extension lifecycle tests
- `session_start` event
- Tool registration via extension
- `session_shutdown` event

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/live-extension-bridge.ts` | Fix: match actual SDK API |
| `test/integration/` | **NEW**: integration tests |

---

## G6: toolChoice Enforcement for Yield

### Vấn đề
- oh-my-pi dùng `buildNamedToolChoice("yield")` → ép model gọi yield tool
- Pi SDK `prompt()` **không có** `toolChoice` option
- Giải pháp thay thế: sử dụng system prompt + reminder

### Probe cần làm
1. Check nếu Pi SDK thêm `toolChoice` trong tương lai
2. Check `session.setActiveToolsByName(["submit_result"])` trước reminder prompt

### Implementation Plan

#### Workaround: Constrained tool set
```typescript
// Trước khi gửi yield reminder:
const prevTools = session.getActiveToolNames();
session.setActiveToolsByName(["submit_result"]);  // Chỉ cho tool này
await session.prompt(reminder, { source: "api" });
session.setActiveToolsByName(prevTools);  // Restore
```

#### Future: Khi SDK hỗ trợ toolChoice
```typescript
await session.prompt(reminder, {
    source: "api",
    toolChoice: { type: "tool", name: "submit_result" }
});
```

### Files cần thay đổi
| File | Action |
|------|--------|
| `src/runtime/live-session-runtime.ts` | Update: constrained tool set before reminder |

---

## Execution Order

```
Week 1: G1 (Custom Tool Injection)     ← P0, unblocks G2+G4+G6
Week 1: G3 (AJV Schema Validation)     ← P2, independent, quick
Week 2: G2 (MCP Proxy)                 ← P1, depends on G1's customTools pattern
Week 2: G6 (toolChoice Workaround)     ← P3, depends on G1's submit_result tool
Week 2: G5 (Extension Runner Verify)   ← P2, independent
Week 3: G4 (respondAsBackground)       ← P3, depends on G1's IRC tool + G5's bridge
```

### Dependency Graph
```
G1 ──► G2 (customTools pattern)
G1 ──► G4 (IRC tool delivery)
G1 ──► G6 (submit_result constraining)
G3 ──► (independent)
G5 ──► G4 (bridge APIs for sendCustomMessage)
```

### Expected Outcome After All Gaps
- **Parity**: ~90-95% với oh-my-pi
- **Yield**: 100% (real tool + AJV validation + toolChoice workaround)
- **IRC**: ~85% (real tool, delivery qua sendCustomMessage, reply-waiting)
- **MCP**: ~80% (proxy injection, connection sharing needs upstream)
- **Extensions**: ~90% (verified bridge, lifecycle tested)
- **Core unique**: 100% (fault isolation, file state, health monitoring, workflow DAG)

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Pi SDK `customTools` TypeBox import không compatible | Medium | High | Test ngay bước đầu; fallback: inline schema object |
| AJV bundle size | Low | Low | Tree-shake; AJV ~30KB gzipped |
| `sendCustomMessage` không hoạt động ở background | Medium | Medium | Fallback sang `steer()` |
| ExtensionRunner không expose cho live-session | Medium | Medium | Graceful degradation, keep bridge as framework |
| `defineTool` signature thay đổi trong SDK update | Low | High | Pin SDK version, test trước khi upgrade |

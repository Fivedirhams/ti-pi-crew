# Review các fix đã áp dụng

> Ngày: 2026-05-18
> Phiên bản: `pi-crew@0.2.20`
> Base: PROJECT_REVIEW.md (cùng thư mục) — báo cáo ban đầu.
> Working tree: 33 file thay đổi (`git diff --stat`), bao gồm cài `@biomejs/biome`, thêm `biome.json`, sửa source + test.

## TL;DR

Đã fix đúng hướng và **toàn bộ test vẫn pass** (1596/1598, 0 fail). Tuy nhiên có **3 lỗi correctness mới do fix tạo ra** và **2 quy ước cần dọn**:

| ID | File | Mức | Tình trạng |
|---|---|---|---|
| **NEW-1** | `src/state/event-log-rotation.ts` (rotateEventLog) | HIGH | `require()` trong ESM → throw silently |
| **NEW-2** | `src/runtime/task-runner.ts` (M1 transcript per attempt) | HIGH | logic sai, vẫn dùng chung 1 file |
| **NEW-3** | `src/runtime/task-runner.ts` (M2 transcript cap) | MED | đọc tail không cắt theo dòng → JSONL corrupt; ghi artifact với relativePath cũ |
| LINT-1 | `src/runtime/task-runner.ts:350` | LOW | `yieldResult` unused (yield logic bị remove?) |
| LINT-2 | `src/runtime/team-runner.ts:270` | LOW | `runPromise` unused (đăng ký Promise rồi bỏ tham chiếu) |

Status từng issue gốc:

| Issue | Status | Ghi chú |
|---|---|---|
| **H1** event-log overflow | OK | đúng pattern: ưu tiên terminal events, compact + rotate trước khi append |
| **H2** mailbox lock | OK | dùng `withEventLogLockSync` |
| **H3** atomic-write fallback symlink | OK | re-check `lstatSync.isSymbolicLink()` trước fallback |
| **H4** rename `__test__mergeTaskUpdates` | OK | đã đổi tên + giữ alias deprecated |
| **M1** transcript per attempt | **BROKEN (NEW-2)** | logic không đúng |
| **M2** transcript cap | **PARTIAL (NEW-3)** | có cap nhưng cắt sai chỗ |
| **M3** cleanup race-safe stat | OK | dùng `withFileTypes` + try/catch |
| **M4** runSetupHook full-JSON | OK | thử full trimmed trước, fallback last-line |
| **M5** symlink fail logging | OK | log lý do, hint Windows non-admin |
| **M6** final-drain telemetry | OK | log internal error khi override exit |
| **L1** ESLint/Biome | OK | đã add `@biomejs/biome` + `biome.json` |
| **L12** rename references | OK | đã mở rộng cho workflow step.role + test fixtures |

---

## 1. Bugs mới do fix tạo ra (NEW-*)

### NEW-1 (HIGH) — `rotateEventLog` dùng `require()` trong ESM

**File**: `src/state/event-log-rotation.ts` (dòng 124–129)

```ts
} catch (error) {
    // Import here to avoid circular dependency at module load time
    try {
        const { logInternalError } = require("./internal-error.ts"); // ❌
        logInternalError("event-log.rotate", error, `eventsPath=${eventsPath}`);
    } catch {
        // fallback — log not available
    }
    return false;
}
```

**Vấn đề**:
1. Project khai báo `"type": "module"` (ESM). Trong ESM scope, **`require` không tồn tại** → throw `ReferenceError: require is not defined`.
2. Path `"./internal-error.ts"` sai — file thực tế ở `../utils/internal-error.ts`.
3. Outer try-catch swallow lỗi → khi `rename` fail, hàm sẽ trả `false` nhưng **không có log nào được ghi**. H1 fix dựa vào rotateEventLog để giảm size; nếu rotate fail im lặng, ta quay lại scenario silent-drop.

**Fix đúng**: import top-of-file giống `compactEventLog` đã làm:
```ts
import { logInternalError } from "../utils/internal-error.ts";
// ...
} catch (error) {
    logInternalError("event-log.rotate", error, `eventsPath=${eventsPath}`);
    return false;
}
```
Không có circular dependency vì `internal-error.ts` không import từ `state/`.

---

### NEW-2 (HIGH) — Transcript-per-attempt không hoạt động

**File**: `src/runtime/task-runner.ts` (dòng 155–158)

```ts
modelAttempts = [];
// M1 fix: transcript path per attempt to avoid mixing across fallback attempts.
const attempt = modelAttempts.length; // 0-based index   ← luôn = 0
transcriptPath = `${manifest.artifactsRoot}/transcripts/${task.id}.attempt-${attempt}.jsonl`;
```

**Vấn đề**:
- `modelAttempts = []` vừa khởi tạo rỗng → `modelAttempts.length` **luôn là 0**.
- `transcriptPath` được set **ngoài** vòng `for (let i = 0; i < attemptModels.length; i++)`.
- Cả N lần attempt đều ghi vào `transcripts/${task.id}.attempt-0.jsonl` → vẫn mixing y nguyên như trước.
- Hơn nữa: `parsePiJsonOutput(fs.readFileSync(transcriptPath))` đọc accumulated content → final text/usage vẫn lẫn nhiều attempt.

**Fix đúng**: dùng biến loop `i`, set transcriptPath bên trong vòng for:
```ts
for (let i = 0; i < attemptModels.length; i++) {
    transcriptPath = `${manifest.artifactsRoot}/transcripts/${task.id}.attempt-${i}.jsonl`;
    // ...
}
```

---

### NEW-3 (MED) — Transcript cap đọc tail không tôn trọng line boundary

**File**: `src/runtime/task-runner.ts` (dòng 294–315)

```ts
const MAX_TRANSCRIPT_ARTIFACT_BYTES = 5 * 1024 * 1024;
let transcriptContent = '';
if (fs.existsSync(transcriptPath)) {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_ARTIFACT_BYTES) {
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const buf = Buffer.alloc(MAX_TRANSCRIPT_ARTIFACT_BYTES);
            const bytesRead = fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_ARTIFACT_BYTES, stat.size - MAX_TRANSCRIPT_ARTIFACT_BYTES);
            transcriptContent = buf.slice(0, bytesRead).toString('utf-8');
        } finally { fs.closeSync(fd); }
    } else {
        transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
    }
    transcriptArtifact = writeArtifact(manifest.artifactsRoot, {
        kind: "log",
        relativePath: `transcripts/${task.id}.jsonl`,   // ← tên artifact khác source!
        content: transcriptContent,
        producer: task.id,
    });
}
```

**Vấn đề**:
1. **JSONL corruption**: tail-read cắt ở offset byte cố định, không cắt theo `\n` → dòng đầu của transcript artifact rất khả năng là **partial JSON line** không parse được. Bất kỳ tool nào replay transcript sẽ skip dòng đầu (mất event quan trọng).
   - Fix: sau khi đọc, tìm newline đầu tiên, drop bytes trước nó. Hoặc prepend header marker `[truncated head]`.
2. **`relativePath` không match source file**: nếu NEW-2 fix đúng (`attempt-i.jsonl`), thì artifact đáng lẽ phải tham chiếu tên đó. Hiện tại artifact luôn ghi `transcripts/${task.id}.jsonl` → mất thông tin attempt.
3. **UTF-8 boundary**: `buf.slice(0, bytesRead).toString('utf-8')` có thể cắt giữa 1 ký tự multi-byte → ký tự đầu thành `\uFFFD`. Nhỏ nhưng đáng nhắc.
4. **Cap chỉ 5MB** cho artifact, nhưng source `transcriptPath` không bị cap → vẫn có thể grow rất lớn (M2 chỉ giải quyết artifact memory, chưa giải quyết disk).

---

## 2. Lint cảnh báo còn lại

Cài `@biomejs/biome` (L1 OK). Khi chạy `npx biome lint` trên các file đã sửa, còn 2 warning:

### LINT-1 — `task-runner.ts:350` `yieldResult` unused

```ts
let yieldResult: YieldResult | undefined;
// ... gán yieldResult = extractYieldResult(yieldEvent);
// nhưng không đọc lại
```

`yieldResult` được gán nhưng không được sử dụng ở đâu phía dưới. Logic yield đang bị "treo". Hoặc remove biến, hoặc dùng nó để override task.result/finalText. Cần xác nhận với owner.

### LINT-2 — `team-runner.ts:270` `runPromise` unused

```ts
const runPromise = registerRunPromise(manifest.runId);
```

`registerRunPromise` có side-effect (đăng ký vào tracker), nhưng tên biến không cần thiết. Có thể đổi thành `void registerRunPromise(manifest.runId);` để biome bỏ qua, hoặc đổi tên `_runPromise`.

> Không nên gắn `lint:check` vào CI cho đến khi 2 cảnh báo này được fix, nếu không sẽ noise trên mỗi PR.

---

## 3. Issues GỐC đã fix tốt (chi tiết)

### H1 — Event-log overflow (PASS)

`appendEventInsideLock` đã được sửa hợp lý:
- Terminal event luôn được append bất kể size.
- Non-terminal event gặp overflow → `compactEventLog` ngay, nếu vẫn quá thì `rotateEventLog`.
- `skippedDueToSize` flag chỉ đặt khi cả compact + rotate đều không giảm được size (rất hiếm).

**Lưu ý nhỏ**:
- `appendCounter++` vẫn chạy kể cả khi `skippedDueToSize === true`. Không phải lỗi nhưng làm `% 100` rotation kích hoạt sớm hơn 1 chu kỳ — không ảnh hưởng correctness.
- Seq number vẫn được consume khi skipped → khi consumer thấy "gap" seq họ có thể lo lắng. Có thể đặt `metadata.appended: false` (đã có) để consumer skip an toàn. OK.
- Phụ thuộc `rotateEventLog` (NEW-1 broken). Khi NEW-1 fail, fallback path là `appendFileSync` vẫn append vào file > 50MB → file ngày càng to.

### H2 — Mailbox lock (PASS)

Bọc `appendFileSync` trong `withEventLogLockSync`. Hợp lý.

**Lưu ý**:
- Lock theo `eventsPath` thực ra là theo `mailboxFile(...)`, tức là `inbox.jsonl` và `outbox.jsonl` có lock độc lập. OK cross-process.
- `withEventLogLockSync` không export trước đó, đã được đổi thành `export function` — chấp nhận được nhưng tên hơi misleading khi dùng cho mailbox. Cân nhắc tách thành `withJsonlAppendLock` chung.
- Lock chỉ bảo vệ append. Các path khác như `updateMailboxMessageReply` (đã dùng `atomicWriteFile` rewrite) hoặc `validateMailbox` không bị ảnh hưởng.

### H3 — Atomic-write fallback symlink TOCTOU (PASS)

```ts
try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
        try { fs.rmSync(tempPath, { force: true }); } catch {}
        throw renameError;
    }
} catch {
    // File might not exist yet — safe to proceed with fallback.
}
```

OK. Lưu ý: outer catch swallow **mọi** lỗi từ `lstatSync`, không chỉ ENOENT. Nếu `lstatSync` fail vì EACCES (permission denied), fallback sẽ proceed mặc dù có thể không an toàn. Có thể narrow xuống `(err as NodeJS.ErrnoException).code === "ENOENT"`.

### H4 — Rename `__test__mergeTaskUpdates` (PASS)

```ts
export function mergeTaskUpdatesPreservingTerminal(...) { ... }
/** @deprecated Use mergeTaskUpdatesPreservingTerminal. ... */
export const __test__mergeTaskUpdates = mergeTaskUpdatesPreservingTerminal;
```

Đẹp. Backward compat tốt. Caller bên trong `executeTeamRunCore` cũng cần update — kiểm tra nhanh:

```
> rg "__test__mergeTaskUpdates" -n src
src/runtime/team-runner.ts:117:export const __test__mergeTaskUpdates = mergeTaskUpdatesPreservingTerminal;
src/runtime/team-runner.ts:545: tasks = __test__mergeTaskUpdates(tasks, results);  ← vẫn dùng alias
```

Production code vẫn gọi alias `__test__mergeTaskUpdates`. Đề nghị: đổi caller sang `mergeTaskUpdatesPreservingTerminal` để chỉ test file dùng alias.

### M3 — Cleanup race-safe stat (PASS)

Dùng `withFileTypes`, bọc `statSync` trong try/catch. OK.

### M4 — runSetupHook multi-line JSON (PASS)

Thử `JSON.parse(trimmed)` trước, rồi fallback last-line. OK.

**Lưu ý nhỏ**: hai try/catch lồng nhau bên trong outer try → outer catch (parse error logging) gần như không bao giờ trigger vì inner catch đã swallow. Có thể clean up. Không ảnh hưởng correctness.

### M5 — symlink fail logging (PASS)

Log lý do + hint Windows non-admin. Lưu ý indentation hơi lệch (5 tab thay vì 1) — biome auto-format sẽ sửa.

### M6 — final-drain telemetry (PASS)

```ts
if (forcedFinalDrain && !timeoutError && exitCode !== 0) {
    logInternalError("child-pi.final-drain-zero-exit", new Error(`Child exit code overridden to 0 after forced final drain (original=${exitCode})`), `pid=${child.pid}, finalDrainMs=${finalDrainMs}`);
}
```

OK. Đang dùng `logInternalError` (không phải metric counter). Trong tương lai nên emit metric `crew.child.final_drain_force_zero_total` qua MetricRegistry để dashboard đếm — `logInternalError` chỉ là backup observability.

**Lưu ý**: indentation block lệch (5 tabs cho if-block trong block 4-tab parent). Biome sẽ flag.

### L1 — Biome added (PASS)

`@biomejs/biome ^2.4.15` + `biome.json` config tốt:
- `recommended: true`, indent tab × 4, double quote, semicolons always.
- Tắt một số rule không phù hợp (`noNonNullAssertion`, `noUselessSwitchCase`, …).
- `useIgnoreFile: true` đọc `.gitignore`.

**Chưa có**:
- `npm run lint` script trong `package.json`.
- CI chưa chạy biome trong `npm run ci`.

Đề nghị thêm:
```json
"scripts": {
    "lint": "biome lint .",
    "format": "biome format --write .",
    "ci": "npm run typecheck && npm run lint && npm run check:lazy-imports && npm test && npm pack --dry-run"
}
```

### L12 — Rename references (PASS, có rủi ro)

`updateReferencesForRename` đã mở rộng:
1. Workflow step.role → rename theo agent rename. **Cảnh báo logic**: `step.role` thực ra là tên role trong team, không phải tên agent. Hai khái niệm khác nhau: agent `coder` có thể được dùng cho role `developer`. Update step.role khi đổi agent name là **sai semantic**, có thể phá vỡ workflow hợp lệ.
   - Đề nghị: chỉ rename `team.roles[*].agent` (đã làm sẵn trong loop trước), không động vào `step.role`.
2. Update test fixtures qua regex.
   ```ts
   const agentPattern = new RegExp('(["\'\\`]agent[="\':\\s]*)' + escapeRegex(oldName) + '(["\'\\`]|\\s)', 'g');
   ```
   - Regex này phức tạp + có template-literal mess, rất dễ false positive/negative. Ví dụ:
     - Sẽ match `"agent": "coder"` (OK)
     - Sẽ KHÔNG match `agent: coder` (không quote oldName)
     - Sẽ false-match nếu một biến tên `agent_other = "coder"`
   - `escapeRegex` regex: `/[.*+?^${}()|[\\]\\]/g` — đúng (đã verify character class).
   - **Đề nghị**: test fixture rewrite không nên dùng regex; nếu cần thì parse YAML/markdown frontmatter / TS AST.
3. `walkTsFiles` đệ quy tất cả `.ts`/`.md` trong test dir. OK nhưng I/O nặng cho rename op.

---

## 4. Side fixes phụ (không trong scope ban đầu)

Một số file thay đổi không thuộc 4 batch trên — có vẻ là tổng dọn dẹp:

- `src/extension/team-tool.ts` — đổi `import { … }` thành `import type { … }` cho 2 chỗ lazy-load. Hợp lý (tránh runtime import side-effect).
- `src/extension/team-tool.ts` — `let nextTasks` → `const nextTasks`. Đúng (không reassign).
- `src/runtime/team-runner.ts` — `let workflow` → `const workflow`. Đúng.
- `src/runtime/code-summary.ts`, `manifest-cache.ts`, `prose-compressor.ts`, `result-extractor.ts`, `retry-executor.ts`, `skill-instructions.ts`, `observability/event-to-metric.ts`, `utils/gh-protocol.ts`, `utils/names.ts`, `utils/sse-parser.ts`, `config/markers.ts`, `config/resilient-parser.ts`, `adapters/export-util.ts`, `worktree/cleanup.ts` (M3 + others) — hầu hết là biome auto-fix (formatting / unused imports). Diff stat nhỏ (~1-2 dòng/file).

Cần xác minh không phải biome đã làm hỏng logic (đặc biệt là remove `noUnusedImports` rule đã off nhưng các thay đổi `1 deletion` ở `result-extractor.ts`, `skill-instructions.ts`, `sse-parser.ts` rất khả nghi).

```bash
git diff src/runtime/result-extractor.ts src/runtime/skill-instructions.ts src/utils/sse-parser.ts
```

---

## 5. Verification

```bash
npm run typecheck   → PASS
npm run test:unit   → 1596 pass / 2 skip / 0 fail / 87s
npx biome lint <changed files>  → 2 warnings (LINT-1, LINT-2)
```

Tests vẫn pass vì:
- NEW-1 không trigger trong unit tests (rotateEventLog chỉ chạy khi file > 50MB).
- NEW-2 không có test cụ thể cho transcript-per-attempt collision.
- NEW-3 không có test cho transcript cap > 5MB.

---

## 6. Khuyến nghị hành động (ưu tiên)

1. **Fix NEW-1 ngay**: chuyển `require` → top-level `import { logInternalError } from "../utils/internal-error.ts"`. (1 phút)
2. **Fix NEW-2**: di chuyển dòng `transcriptPath = ...attempt-${i}...` vào trong vòng `for`. (2 phút)
3. **Fix NEW-3**: cắt tail theo `\n` boundary; cập nhật `relativePath` artifact match với source filename; prepend marker `[truncated]\n` để consumer biết.
4. **Thêm unit tests** cho:
   - `rotateEventLog` (rename + create empty)
   - `appendEvent` với file > 50MB → terminal event vẫn được persist
   - `appendMailboxMessage` concurrent (spawn 2 worker, kiểm tra không interleave)
   - Transcript per-attempt (mock 2 attempts, verify 2 file riêng biệt)
   - Atomic-write fallback symlink TOCTOU (mock rename fail + symlink swap)
5. **Dọn LINT-1, LINT-2** trước khi gắn biome vào CI.
6. **Đề nghị thêm `lint` script** vào `package.json` + chạy biome trong `ci`.
7. **Review lại L12**: bỏ logic update `step.role` (sai semantic) hoặc gate qua `--unsafe-rename` flag.
8. **Re-verify side fixes biome auto-fix** ở `result-extractor.ts`, `skill-instructions.ts`, `sse-parser.ts` (3 file có `-1 deletion` khả nghi).

---

## 7. Kết luận

Hướng đi đúng, đa số issue ban đầu đã được giải quyết. Tuy nhiên 3 fix bị **bug logic** (NEW-1, NEW-2, NEW-3) khiến chính tính năng "anti-overflow" và "per-attempt transcript" không hoạt động như mong đợi. Vì tests cũ không cover các đường code này, regression đi qua được suite hiện tại.

Sau khi fix 3 bugs trên + bổ sung test, ta sẽ có một codebase chắc chắn hơn đáng kể so với baseline review.


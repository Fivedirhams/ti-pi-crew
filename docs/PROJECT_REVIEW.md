# pi-crew — Project Review

> Ngày review: 2026-05-18
> Phiên bản: `pi-crew@0.2.19`
> Phạm vi: toàn bộ source (`index.ts`, `src/**`), config, test, tài liệu, scripts.
> Method: đọc trực tiếp source, đối chiếu `AGENTS.md`/`docs/architecture.md`, chạy `npm run typecheck` + `npm run test:unit`.

## Tổng quan

`pi-crew` là một Pi extension điều phối multi-agent (teams + workflows + worktrees + async background runs), với **mô hình durable-first**: mọi run/task/event được persist xuống ổ đĩa (JSONL + JSON atomic write) để foreground, async background, dashboard và crash recovery đều đọc cùng một nguồn sự thật.

Codebase trưởng thành, có **TypeScript strict mode** (`noImplicitAny`, `strict: true`), bộ test rộng (1596 tests pass, 2 skipped, 0 fail), kiến trúc phân tầng rõ (extension / runtime / state / worktree / utils), và rất nhiều ghi chú phòng-thân ("3.1 backpressure", "2.10 cache", "P1 catch unhandled errors") cho thấy đã được iterate qua nhiều round review.

### Kết quả health-check nhanh

| Hạng mục | Kết quả |
|---|---|
| `npm run typecheck` (`tsc --noEmit` + strip-types import) | PASS |
| `npm run test:unit` (1598 tests / 128 suites) | 1596 pass · 2 skip · 0 fail (~90s) |
| `npm pack --dry-run` (qua `npm run ci`) | Không kiểm tra trong session này |
| Linter (ESLint) | Không có script `lint`; dựa vào `tsc strict` |
| Số file `.ts` trong `src/` | ~190 modules |

---

## 1. Điểm mạnh đáng ghi nhận

1. **Path-safety nhất quán**: `utils/safe-paths.ts` (`assertSafePathId`, `resolveContainedPath`, `resolveRealContainedPath`) được dùng đồng đều ở `state-store.ts`, `artifact-store.ts`, `mailbox.ts`. Có cả hai lớp: containment check theo string và real-path check (chống symlink escape sau khi mkdir).
2. **Atomic write nhiều lớp phòng thân** (`state/atomic-write.ts`):
   - `O_EXCL | O_CREAT | O_NOFOLLOW` khi mở temp file.
   - `fstatSync` post-open để verify regular-file (chống TOCTOU trên Windows nơi `O_NOFOLLOW = 0`).
   - Rename retry với exponential backoff + jitter (chống lockstep starvation).
   - Coalesced variant `atomicWriteJsonCoalesced` cho high-frequency state writes; flush trên `exit`/`SIGTERM`/`SIGINT`.
3. **Redaction (`utils/redaction.ts`)** xử lý nhiều pattern: PEM private key, Authorization headers, Bearer tokens, inline secret patterns, key-name match (`apiKey`, `password`, `secret`, ...). Áp dụng cả ở `appendEvent`, `appendMailboxMessage`, `writeArtifact`, `appendTranscript`.
4. **Env sanitization (`utils/env-filter.ts`)**: secret-pattern deny-list mặc định, allow-list mode cho `worktree.setupHook` để chỉ pass `PATH`, `HOME`, `PI_*`.
5. **Process kill tree** (`runtime/child-pi.ts`):
   - Windows: `taskkill /T /F` + verify-after-2s + retry nếu PID còn sống.
   - POSIX: `process.kill(-pid, "SIGTERM")` (process group) với fallback absolute pid; SIGKILL escalation sau `HARD_KILL_MS`; fast-cancel SIGKILL sau 200ms khi user cancel.
   - Lifecycle events có structured shape `{ type, pid, exitCode?, error?, ts }`.
6. **Backpressure**: pause child stdout khi vượt 256KB chưa drain.
7. **Lazy imports được đánh dấu `// LAZY:`** với lý do cụ thể (giảm ~1.4s import cost ở registration), kèm script `check:lazy-imports` để bảo vệ.
8. **Run / task contract guards**: `shouldMergeTaskUpdate` (không cho stale snapshot regress terminal state), monotonic finishedAt, `canTransitionRunStatus`, plan-approval-gating cho mutating tasks.
9. **Crash & cancellation paths**: `executeTeamRun` catch-all đảm bảo manifest/tasks chuyển sang terminal khi unhandled error (tránh "running mãi mãi"); `background-runner` có `unhandledRejection` guard ghi `async.failed` trước exit; `parent-guard` để background runner tự chết khi parent chết.
10. **Test coverage rất rộng** cho cả happy path và edge cases (yield, atomic-write retry, mergeTaskUpdates, mailbox validation, cancellation, model fallback...).
11. **Config**:
    - Schema validate qua TypeBox với fuzzy suggestions cho key sai chính tả.
    - **Sanitize project-level config** (`sanitizeProjectConfig`): loại bỏ những key nhạy cảm (`executeWorkers`, `runtime.mode`, `worktree.setupHook`, `otlp.headers`, `agents.overrides`, …) ra khỏi project config, chỉ chấp nhận từ user config. Đây là phòng thân thiết yếu cho repo bị inject.

---

## 2. Bugs / Issues phát hiện

> Phân loại: **HIGH** (có thể gây mất dữ liệu / sai correctness), **MED** (correctness corner case / DX), **LOW** (cải thiện).

### HIGH

**H1. `event-log.ts` — silent loss khi vượt `MAX_EVENTS_BYTES` (50MB)**
```ts
// src/state/event-log.ts ~ appendEventInsideLock
if (fs.existsSync(eventsPath) && fs.statSync(eventsPath).size > MAX_EVENTS_BYTES) {
    logInternalError(...);
    return { ...fullEvent, metadata: { ...(fullEvent.metadata ?? {seq:0,...}), appended: false } };
}
```
- Vấn đề: event bị bỏ ngay (kể cả terminal event như `run.failed`, `task.completed`) nhưng `appendCounter` cũng không tăng → `compactEventLog` (chỉ chạy mỗi 100 append) không được kích hoạt khi cần nhất. Hậu quả: một khi vượt ngưỡng, log bị "khoá" silently cho đến khi 100 append tiếp theo trigger rotation.
- Đề xuất: khi gặp ngưỡng, gọi `compactEventLog(eventsPath)` ngay hoặc rotate trước rồi append; đồng thời ưu tiên cho phép terminal event (TERMINAL_EVENT_TYPES) đi qua, vì những event đó là durable contract.

**H2. `mailbox.ts` — `appendMailboxMessage` không có lock cross-process**
```ts
fs.appendFileSync(mailboxFile(manifest, complete.direction, complete.taskId), `${JSON.stringify(...)}\n`, "utf-8");
```
- Vấn đề: `appendFileSync` không nguyên tử trên Windows giữa các process. Hai background runners + foreground steer cùng lúc có thể interleave JSON lines → `parseMailboxMessage` skip, message bị mất silently (lỗi report sau qua `validateMailbox`).
- Đề xuất: dùng pattern `withEventLogLockSync` (đã có sẵn) cho mailbox, hoặc dùng `atomicWriteFile` để rewrite (chậm hơn nhưng nguyên tử). Tối thiểu nên thêm `O_APPEND` nguyên tử trên POSIX (chỉ guarantee tới PIPE_BUF) và lock trên Windows.

**H3. `atomic-write.ts` — fallback `writeFileSync` không có symlink guard**
```ts
try { renameWithRetry(tempPath, filePath); }
catch (renameError) {
    try { fs.writeFileSync(filePath, content, "utf-8"); } // BYPASS symlink guard
    catch { throw renameError; }
}
```
- Vấn đề: nếu rename fail với EPERM trên Windows, fallback đi trực tiếp `writeFileSync(filePath)` — nếu `filePath` được tạo thành symlink giữa `isSymlinkSafePath` check (top of function) và fallback, write sẽ follow link. Time window nhỏ nhưng có thể bị adversary trên multi-user host.
- Đề xuất: trước fallback, re-check `fs.lstatSync(filePath).isSymbolicLink()`. Hoặc mở fd với `O_NOFOLLOW` và `O_TRUNC` rồi write.

**H4. `team-runner.ts` — Tên hàm `__test__mergeTaskUpdates` bị dùng trong production**
```ts
// Re-export documented as test-only:
export function __test__mergeTaskUpdates(...) { ... }
// nhưng được gọi trong executeTeamRunCore:
tasks = __test__mergeTaskUpdates(tasks, results);
```
- Vấn đề: convention `__test__` ngụ ý chỉ test mới import; thực ra đây là core merge logic của runner. Một dev khác có thể "dọn" helper này hoặc thay đổi behavior nghĩ rằng chỉ ảnh hưởng test → silent regression.
- Đề xuất: đổi tên `mergeTaskUpdatesPreservingTerminal()` (hoặc tương tự), giữ `__test__mergeTaskUpdates` làm alias export-only cho test, ghi comment.

### MED

**M1. `task-runner.ts` — `transcriptPath` reused across model fallback attempts**
- Mỗi attempt append vào cùng file transcript. `parsePiJsonOutput(fs.readFileSync(transcriptPath, "utf-8"))` parse toàn bộ → final text/usage có thể mixed giữa attempts. `resultArtifact.content` lấy `parsedOutput?.finalText` có thể là final của attempt 1 (đã fail) nếu attempt 2 không có message_end hợp lệ.
- Đề xuất: hoặc dùng `transcripts/${task.id}.attempt-${i}.jsonl` per attempt, hoặc clear file đầu mỗi attempt nếu chính sách là "last attempt wins".

**M2. `task-runner.ts` — read toàn bộ transcript vào memory cho `transcriptArtifact`**
```ts
content: fs.readFileSync(transcriptPath, "utf-8"),
```
- Với task chạy lâu, transcript có thể vài chục MB. Cộng với việc compactChildPiEvent đã giảm size, nhưng vẫn unbounded. `MAX_CAPTURE_BYTES` chỉ áp dụng cho `stdout/stderr` in-memory, không cho transcript on-disk.
- Đề xuất: cap transcript file size (rotate khi vượt ngưỡng) hoặc artifact dùng reference (đường dẫn) thay vì copy nội dung.

**M3. `cleanup.ts` — `fs.statSync(worktreePath).isDirectory()` không guard race**
```ts
for (const entry of fs.readdirSync(worktreeRoot)) {
    const worktreePath = path.join(worktreeRoot, entry);
    if (!fs.statSync(worktreePath).isDirectory()) continue;
```
- Nếu entry bị xóa giữa `readdirSync` và `statSync`, throw uncaught.
- Đề xuất: bọc `try { fs.statSync... } catch { continue; }` hoặc dùng `fs.readdirSync(worktreeRoot, { withFileTypes: true })` rồi `entry.isDirectory()`.

**M4. `worktree-manager.ts` — `runSetupHook` parse JSON chỉ từ dòng cuối**
```ts
const lastLine = lines[lines.length - 1] ?? trimmed;
const parsed = JSON.parse(lastLine);
```
- Nếu hook xuất multi-line JSON (pretty-print) thì chỉ parse được dòng cuối → silently mất `syntheticPaths`. Đã có log warning, nhưng silent về phía caller.
- Đề xuất: thử parse `trimmed` trước, fallback last-line. Hoặc đặt protocol rõ ràng (one-line JSON, terminator marker).

**M5. `worktree-manager.ts` — `linkNodeModulesIfPresent` không cảnh báo khi `symlinkSync` fail**
```ts
try { fs.symlinkSync(...); return true; } catch { return false; }
```
- Trên Windows không có quyền tạo symlink (yêu cầu SeCreateSymbolicLinkPrivilege), fail im lặng, agent chạy mà thiếu `node_modules` — có thể fail moduleResolution nhưng caller không biết.
- Đề xuất: log lý do fail (đặc biệt cho Windows non-admin) qua `logInternalError`, hoặc trả về `{ linked, reason }`.

**M6. `child-pi.ts` — `forcedFinalDrain` ép `exitCode: 0`**
```ts
const finalExitCode = forcedFinalDrain && !timeoutError ? 0 : exitCode;
```
- Logic này (đã comment giải thích) chuyển một số exit ≠ 0 thành 0 sau khi child gửi final assistant event. Edge case: child crash trong cleanup sau final event → vẫn report success. Có thể che giấu memory leak hoặc crash trong child Pi.
- Đề xuất: thêm telemetry/metric đếm số lần `forcedFinalDrain → 0` để phát hiện regression. Hiện tại chỉ có lifecycle event "final_drain" nhưng không có metric đếm conversion.

**M7. `background-runner.ts` — `process.exit(130)` trong interrupt guard không await flush**
```ts
if (last?.type === "interrupt" && last?.acknowledged !== true) {
    appendEvent(...);
    process.exit(130);
}
```
- `process.exit` chạy `'exit'` handler nhưng không await async ops (e.g., `appendEventBuffered` Promise đang chờ). `flushEventLogBuffer` đăng ký trên `'exit'` là sync nên OK, nhưng `terminateLiveAgentsForRun` thì không. Có thể leak live agent.
- Đề xuất: `await terminateLiveAgentsForRun(...)` rồi mới exit, hoặc dùng `process.exitCode = 130` + return để cleanup chạy bình thường.

**M8. `state-store.ts` — manifest cache TTL invariant**
- Cache key là `stateRoot`, TTL 5 phút. Path validation phòng trường hợp manifest paths đổi. Nhưng nếu file mtime + size không đổi (extremely rare nhưng có thể với atomic-write coalesced khi same size & content), cache phục vụ stale content.
- Đề xuất: thêm `contentHash` (cheap để stat → fingerprint kiểu first 32 bytes) trong cache key, hoặc invalidate cache trong `atomicWriteJsonCoalesced` flush callback.

**M9. `event-log.ts` — `sequenceCache` không invalidated khi file truncate ngoài**
- Nếu external tool truncate `events.jsonl` (rotate manual), cached `seq` vẫn cao, làm `nextSequence` sinh seq sai (đã có fallback: `cached.size === stat.size`). OK với same-size race, nhưng nếu truncate xảy ra giữa `statSync` và `appendFileSync`, hai append sẽ có cùng seq.
- Đề xuất: persistSequence hiện đã dùng atomic write, có thể trust nó trong race. Test integration cho external truncate.

**M10. `runtime-resolver` / config — `executeWorkers=false` default fallback path**
- `handleResume` có logic phức tạp re-evaluate `runtime.mode` khi resume scaffold runs. Logic 3-cách (`resumeManifest.runtimeResolution?.safety === "explicit_dry_run"` + env var checks) dễ dẫn đến edge case nơi user expect actual workers nhưng resume vẫn scaffold. Khó test.
- Đề xuất: refactor thành state machine rõ ràng `resolveResumeRuntime({ original, override, env })` với unit test full truth table.

### LOW

- **L1. `package.json` thiếu `lint` script**; `AGENTS.md` global có quy ước `eslint --max-warnings=0`. Hiện chỉ dựa vào `tsc strict`. Cân nhắc thêm ESLint hoặc Biome.
- **L2. Many `JSON.stringify(value, null, 2)` cho metadata artifact**. Pretty-printing 50+ artifact/task tốn I/O. Cân nhắc minified JSON cho metadata, pretty chỉ cho summary/progress mà user đọc.
- **L3. `task-runner.ts` tạo ~13 artifacts cho mỗi task** (prompt, result, inputs, coordination, skill, packet, verification, startup, permission, capability, prompt-pipeline, log, transcript, diff, diff-stat, output-validation). Mỗi cái là một `atomicWriteFile` syscall. Trong run lớn (50+ tasks), giảm xuống sub-artifacts hợp nhất sẽ giúp giảm I/O đáng kể.
- **L4. `registerYieldTool()` chạy ở module top-level** (`task-runner.ts` dòng 35). Side-effect khi import — nếu module bị import 2 lần (e.g., jiti vs strip-types), `subprocessToolRegistry` có thể duplicate. Kiểm tra `subprocess-tool-registry.ts` xem có idempotent không.
- **L5. `atomic-write.ts` `atomicWriteJsonCoalesced`** — API có caveat đáng kể (read-after-write trong buffer window đọc stale content). Risk surface lớn nếu future dev quên gọi `flushPendingAtomicWrites()`. Cân nhắc thêm read API riêng `readJsonFileWithCoalesceFlush()`.
- **L6. Cancellation paths không có metric đếm**. Đã có observability events nhưng không có gauge số task cancelled per run.
- **L7. `management.ts` `handleUpdate` rename+write** sequence không có rollback nếu writeFileSync fail sau rename (backup tồn tại, nhưng user phải manually restore). Có thể wrap trong try/catch + auto-restore from backup.
- **L8. `child-pi.ts` mock paths đọc env `PI_TEAMS_MOCK_CHILD_PI`** — nên có guard không cho prod accidentally bật (kiểm tra `process.env.NODE_ENV === "test"` hoặc test-flag rõ ràng).
- **L9. `worktree-manager.ts` `findGitRoot` throws** nếu cwd không phải git repo. `prepareTaskWorkspace` gọi nó trước khi check workspaceMode; thực ra check workspaceMode đầu hàm rồi, OK. Nhưng error message từ git ("not a git repository") sẽ propagate lên user — không user-friendly.
- **L10. Naming `crewRoot` vs `.crew/` vs `.pi/teams/`** đã có doc nhưng dễ confuse. `projectCrewRoot` có cả ba branch (existing `.crew` → `.crew`; existing `.pi` → `.pi/teams`; else → `.crew`). Test có cover nhưng dev mới khi xem code dễ nghĩ nhầm.
- **L11. Một số `let task: TeamTaskState = ...` rồi reassign nhiều lần trong `task-runner.ts`**. Hard to reason. Cân nhắc refactor thành reducer pattern.
- **L12. `update-references-for-rename` chỉ cập nhật team→agent và team.defaultWorkflow**, không cover workflow→step.role hay agent references trong test fixtures. Comment đã ghi nhận. Vẫn nên fix để rename an toàn.

---

## 3. Security review

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| Path traversal | OK | `assertSafePathId`, `resolveContainedPath`, `resolveRealContainedPath` phủ khá đầy đủ. |
| Symlink escape | OK (corner case H3) | `O_NOFOLLOW`, `lstatSync`, post-open `fstatSync`. Có 1 fallback path bỏ check (H3). |
| Secret leak | OK | Redaction áp dụng đầu vào event log, transcript, mailbox, artifact. Env sanitization trước khi spawn child. |
| Code injection via setup hook | Mitigated | `runSetupHook` validate file tồn tại, dùng `shell: false`, allow-list env, timeout 30s. Nhưng vẫn execute user-provided code. Phải tin user. |
| Untrusted project config | OK | `sanitizeProjectConfig` strip key nhạy cảm trước khi merge. |
| Process tree leak (zombie child Pi) | OK | `terminateActiveChildPiProcesses` + `parent-guard` + Windows `taskkill /T /F`. |
| DoS qua concurrency | OK | Default hard-cap; `allowUnboundedConcurrency=true` cần explicit opt-in + emit event. |
| Event log injection | Mitigated | JSON.stringify mỗi line; readEvents skip parse error. Có rủi ro JSON-line corrupted vì `appendFileSync` race (H2 trong mailbox, nhưng event log có lock). |
| Dependency surface | Nhỏ | Chỉ runtime deps: typebox, cli-highlight, diff, jiti. |

Tóm lại: security posture **tốt**. Vấn đề lớn nhất là H2 (mailbox không lock) — có thể bị stale state nếu nhiều process race.

---

## 4. Performance review

- **Atomic write coalescer** (50ms window) đã giảm I/O cho high-frequency state writes.
- **Manifest cache** với mtime+size key tránh re-parse khi không đổi.
- **Lazy import boundaries** giảm import cost ~1.4s.
- **`projectRootCache` TTL 30s** giảm 14 `existsSync` × ancestor levels mỗi render tick.

Nóng còn tiềm năng tối ưu:
1. Mỗi task hoàn thành sinh ~13 artifacts (L3). 50 tasks = 650 atomic writes cho metadata. Cân nhắc batch.
2. `progress.md` và `summary.md` được write lại nhiều lần per batch (writeProgress trong loop). Coalesce ổn nhưng có thể dùng `atomicWriteJsonCoalesced`.
3. `parsePiJsonOutput(fs.readFileSync(transcriptPath))` chạy mỗi attempt, parse full transcript. Stream parsing rẻ hơn cho transcript lớn.
4. `aggregateUsage(tasks)` chạy O(n) trên tasks mỗi summary write.

---

## 5. DX / Maintainability

| Aspect | Note |
|---|---|
| TS strict | OK, `noImplicitAny` enforced. |
| Naming `__test__*` | Có lẫn lộn giữa pure test util và production helper (H4). |
| File size | `team-runner.ts` (694 dòng), `task-runner.ts` (440+ dòng), `register.ts` (1k+ dòng), `live-session-runtime.ts` (~750 dòng) đều > 500 dòng. AGENTS.md đã nhắc "prefer small modules". |
| Comment quality | Tốt — có "WHY" markers, version tags (`// 2.10`, `// H4`, `// 3.1`). |
| Test layout | `test/unit/*.test.ts` + `test/integration/*.test.ts`. Concurrency hợp lý. |
| Hard-coded magic numbers | Đã centralize vào `config/defaults.ts` cho phần lớn. |
| Error reporting | `logInternalError` consistent — best-effort, không throw. |
| Docs sync | `docs/architecture.md` khớp với code (trừ một số next-upgrade-roadmap chưa implement). |

---

## 6. Test-matrix gap (ứng viên thêm test)

- Cross-process race trên mailbox append (H2).
- Event log overflow recovery (H1) — đảm bảo terminal event vẫn được persist khi vượt 50MB.
- `forcedFinalDrain` không che giấu real child crash (M6).
- Resume with mixed `runtime.mode` overrides (M10).
- Atomic-write coalesced + read-after-write within window — đảm bảo doc behavior matches reality.
- `linkNodeModulesIfPresent` Windows non-admin fallback (M5).
- `runSetupHook` multi-line JSON output (M4).

---

## 7. Đề xuất ưu tiên (sorted)

1. **Fix H1** (event-log overflow): rotate ngay khi vượt ngưỡng + ưu tiên terminal events.
2. **Fix H2** (mailbox lock): áp dụng `withEventLogLockSync` pattern cho mailbox append.
3. **Fix H3** (atomic-write symlink TOCTOU): re-check lstat trước fallback `writeFileSync`.
4. **Fix H4** (rename `__test__mergeTaskUpdates` → `mergeTaskUpdates`, giữ alias).
5. **M1/M2** transcript per-attempt + cap size.
6. **M3** race-safe `statSync` trong cleanup.
7. **M6** thêm metric `crew.child.final_drain_force_zero_total`.
8. **L1** thêm ESLint hoặc Biome cho consistency (AGENTS.md global yêu cầu).
9. **L3** batch artifact writes cho metadata.
10. **L12** mở rộng `updateReferencesForRename` cho workflow→step + agent references.

---

## 8. Verification

```
npx tsc --noEmit                                  → PASS
node --experimental-strip-types -e "..."         → PASS (strip-types import ok)
node --test test/unit/*.test.ts                  → 1596 pass / 2 skip / 0 fail / 90s
```

Không có lint command trong project (chỉ `tsc strict`), không tìm thấy file `.eslintrc*`.

---

## 9. Kết luận

`pi-crew` là một codebase **trưởng thành, kỷ luật cao**, có nhiều lớp phòng thân chống TOCTOU, race, và crash mid-write. Test coverage rộng, architecture rõ ràng. Các vấn đề tìm thấy chủ yếu là edge-case correctness và hardening, không có lỗ hổng nghiêm trọng nào ở mức "broken core flow".

**Khuyến nghị**: ưu tiên fix H1–H4 và mở rộng test cho cross-process race (mailbox + event-log overflow). Tiếp theo là cân nhắc thêm linter, batch metadata artifact writes, và refactor một số orchestrator file lớn (`register.ts`, `team-runner.ts`, `live-session-runtime.ts`) thành sub-modules.


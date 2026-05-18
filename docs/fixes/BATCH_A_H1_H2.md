# Batch A: H1 + H2 Fixes

Date: 2026-05-18

## H1: Event-log silent loss khi vượt MAX_EVENTS_BYTES (50MB)

### File
`src/state/event-log.ts`

### Vấn đề
Khi file event log vượt 50MB, event bị bỏ ngay (kể cả terminal event) nhưng `appendCounter` không tăng → compact không được kích hoạt.

### Fix đã áp dụng
Trong `appendEventInsideLock`:

1. **Ưu tiên terminal events**: kiểm tra `isTerminal = TERMINAL_EVENT_TYPES.has(fullEvent.type)` trước
2. **Non-terminal events vượt limit** → gọi `compactEventLog()` ngay (không đợi counter % 100)
3. **Sau compact vẫn vượt limit** → gọi `rotateEventLog()`
4. **Chỉ bỏ qua event** khi non-terminal event còn vượt limit sau compact+rotate
5. **Terminal events luôn được persist** bất kể size

```ts
const isTerminal = TERMINAL_EVENT_TYPES.has(fullEvent.type);
let skippedDueToSize = false;
if (!isTerminal && fs.existsSync(eventsPath)) {
    const stat = fs.statSync(eventsPath);
    if (stat.size > MAX_EVENTS_BYTES) {
        try {
            compactEventLog(eventsPath);
        } catch (error) {
            logInternalError("event-log.immediate-compact", error, `eventsPath=${eventsPath}`);
        }
        if (fs.existsSync(eventsPath)) {
            const afterCompact = fs.statSync(eventsPath);
            if (afterCompact.size > MAX_EVENTS_BYTES) {
                rotateEventLog(eventsPath);
            }
        }
    }
}
```

### Verification
```bash
npm run typecheck  # PASSED
```

---

## H2: Mailbox appendFileSync không lock cross-process

### File
`src/state/mailbox.ts`

### Vấn đề
`appendMailboxMessage` dùng `fs.appendFileSync` không nguyên tử trên Windows.

### Fix đã áp dụng
Import và bọc append trong `withEventLogLockSync`:

```ts
import { withEventLogLockSync } from "./event-log.ts";

// Trong appendMailboxMessage:
withEventLogLockSync(mailboxFile(manifest, complete.direction, complete.taskId), () => {
    fs.appendFileSync(mailboxFile(manifest, complete.direction, complete.taskId), `${JSON.stringify(redactSecrets(complete))}\n`, "utf-8");
});
```

### Verification
```bash
npm run typecheck  # PASSED
```

---

## Changed Files
- `src/state/event-log.ts`
- `src/state/mailbox.ts`

## Verification Evidence
```
> npm run typecheck
> tsc --noEmit && node --experimental-strip-types -e "await import('./index.ts'); console.log('strip-types import ok')"
strip-types import ok
```
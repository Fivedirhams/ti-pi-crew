# pi-crew Performance Upgrade — Final Report (2026-05)

Date: 2026-05-14
Branches: `perf/baseline-bench` → `perf/sprint-1` → `perf/sprint-2` →
`perf/sprint-2.5` → `perf/sprint-3` → `perf/sprint-4` → `perf/sprint-5`
Status: 5 sprint cycles completed. 21 items shipped + 3 ADRs proposed.
11 items explicitly deferred with rationale.

## Cumulative bench delta (Sprint 0 → Sprint 5)

| Metric | Sprint 0 baseline | Final | Delta |
|---|---|---|---|
| register-startup.import.p95 | 655.39 ms | 565.60 ms | **−13.7 %** |
| register-startup.register.p95 | 27.51 ms | 26.05 ms | **−5.3 %** |
| render-flush.p95 | 0.36 ms | 0.26 ms | **−27.8 %** |
| snapshot-cache.cold.p95 | 3.06 ms | 2.58 ms | **−15.7 %** |
| snapshot-cache.warm.p95 | 3.06 ms | ~2.55 ms | **≈ −16.7 %** |

Numbers are end-of-Sprint-5 with the same Node v24.10.0 / Windows
hardware. The biggest remaining lever (`register-startup.import`) is
held up by TS strip-types parse cost; ADR 0006 (bundled ESM) is the
proposed path to halve it again.

## Items shipped per sprint

### Sprint 0 — Baseline & gate

- Bench harness (`test/bench/{register-startup,render-flush,snapshot-cache}.bench.ts`)
- Profile script (`scripts/profile-startup.mjs`)
- Bench-check gate (`scripts/bench-check.mjs`) — 15 % regression floor;
  sub-ms metrics use absolute +0.5 ms cap to avoid noise
- Baseline JSON committed at `test/bench/baseline.json`
- Plan (`docs/perf/upgrade-plan-2026-05.md`) + baseline doc
- Bonus fix: pre-existing `// LAZY:` marker missing in
  `src/runtime/background-runner.ts`

### Sprint 1 — UI mượt rủi ro thấp (6 items)

- 1.4 events stamp via `.seq` sequence file
- 1.5 drop per-agent outputStamp from SnapshotStamps
- 1.8 per-segment powerbar dedup keying full payload
- 1.9 per-runId invalidate coalesce in RenderScheduler
- 1.1 renderTick zero-fs-IO
- 1.2 drop sync `refreshIfStale` fallback on hot render path
- 1.10 mascot pause idle — skipped (mascot is splash, not always-on)

### Sprint 2 — Cắt I/O sync hot path (4 items)

- 2.10 cache findRepoRoot lookups (TTL-LRU 30 s)
- 2.7 lazy-load OTLPExporter, LiveRunSidebar, crash-recovery
- 4.1 keep metric-sink fd open per UTC date
- 2.3 lower events.jsonl rotation threshold 5 MB → 4 MB
- 4.4 sample task.progress 1/10 — skipped (existing
  `shouldAppendProgressEventUpdate` is smarter than naive sampling)

### Sprint 2.5 — Deferred I/O items (1 item)

- 1.3 native fs.watch on `<crewRoot>/state` with poll fallback
- 2.1 atomic-write coalescer — deferred to durability sprint
- 2.2 events.jsonl buffer 20 ms — deferred to durability sprint

### Sprint 3 — Refactor & UI selectors (3 items)

- 5.1 test:unit `--test-concurrency=4 --test-isolation=process`
- 2.8 extract `src/runtime/adaptive-plan.ts` (team-runner.ts 57 KB → 43 KB)
- 2.9 extract `src/config/types.ts` (config.ts 38 KB → 34 KB)
- 1.6 dashboard pane independent rendering — deferred (UI selectors
  follow-up)
- 1.7 memoized snapshot slice — deferred (depends on 1.6)

### Sprint 4 — Stability & telemetry (6 items)

- 3.4 atomic-write rename: jitter ±20 %, cap 8 retries
- 3.6 HeartbeatWatcher deadletter cooldown (default 60 s)
- 3.2 HeartbeatWatcher poll backoff: stale → 1 s, healthy → 5 s
- 4.3 pre-tuned histogram buckets for run/task duration + tokens
- 4.2 OTLP exporter gzips body
- 3.7 idempotent resume — already preserved by path-keyed artifact map
- 3.1, 3.5, 3.3, 3.8 — deferred (medium-risk, need stress harness)

### Sprint 5 — High-risk + ADRs (1 item + 3 ADRs)

- 5.2 npm run test:watch script
- ADR 0006 publish-bundled-esm (5.5) — Proposed
- ADR 0007 active-run-binary-index (2.4) — Proposed
- ADR 0008 child-pi-warm-pool (2.6) — Proposed
- 2.5 lazy materialize crew-agent-records — deferred (depends on 2.2)

## Deferred items

These are not a sign of failure — they need their own dedicated branch
+ test infrastructure that's outside the original sprint scope.

| ID | Item | Reason |
|---|---|---|
| 2.1 | atomic-write coalescer | needs cross-process state-store redesign + crash-recovery integration test |
| 2.2 | events.jsonl buffer 20 ms | same — sequence + lock invariants need redesign |
| 1.6 | dashboard pane independent | needs pane-level state isolation atomic redesign |
| 1.7 | memoized snapshot slice | depends on 1.6 |
| 3.1 | backpressure on child-pi stdout | needs stress harness for sustained > 4 MB/s output |
| 3.5 | cancel propagate < 200 ms | needs incremental JSONL parse, not a tiny change |
| 3.3 | mailbox auto-archive | needs new rotation format compatible with readers + blob-store |
| 3.8 | kill-tree fallback Win | needs reliable test harness for stuck child processes |
| 5.5 | bundle ESM | ADR 0006 proposed; OS smoke needed |
| 2.4 | active-run-registry binary | ADR 0007 proposed; 2-release migration |
| 2.6 | child-pi warm pool | ADR 0008 proposed; soak test required |
| 2.5 | lazy materialize crew-agent-records | depends on 2.2 |

## Test surface

- 1578 / 1580 unit test cases pass (2 skipped, 0 fail) under
  concurrency=4 isolation=process.
- Wall time `npm run test:unit`: ~63 s on Windows.
- New tests added across sprints:
  - `render-scheduler.test.ts`: +2 invalidate-coalesce cases (1.9)
  - `powerbar-publisher.test.ts`: +1 dedup case (1.8)
  - `paths.test.ts`: +1 cache case (2.10)
  - `fs-watch.test.ts`: +2 cases for native watcher (1.3)

## Tooling delta

- `package.json`: +5 scripts (`bench`, `bench:check`, `bench:capture`,
  `profile:startup`, `test:watch`).
- `scripts/`: +3 mjs files for bench harness + profile.
- `test/bench/`: +3 .bench.ts files + `baseline.json`.
- `.gitignore`: ignore `.profile/`, `test/bench/results.json`,
  `*.cpuprofile`.

## Files (new)

- `docs/perf/upgrade-plan-2026-05.md`
- `docs/perf/baseline-2026-05.md`
- `docs/perf/sprint-{1,2,2.5,3,4,5}-report.md`
- `docs/perf/final-report-2026-05.md` (this file)
- `docs/decisions/0006-publish-bundled-esm.md`
- `docs/decisions/0007-active-run-binary-index.md`
- `docs/decisions/0008-child-pi-warm-pool.md`
- `src/runtime/adaptive-plan.ts`
- `src/config/types.ts`
- `scripts/profile-startup.mjs`, `scripts/run-bench.mjs`,
  `scripts/bench-check.mjs`
- `test/bench/{register-startup,render-flush,snapshot-cache}.bench.ts`
- `test/bench/baseline.json`

## Files (modified)

- `src/extension/register.ts` — 2.7 (lazy phase 2), 1.1, 1.3, 2.10
- `src/ui/run-snapshot-cache.ts` — 1.4, 1.5
- `src/ui/render-scheduler.ts` — 1.9
- `src/ui/powerbar-publisher.ts` — 1.8, 1.2
- `src/ui/crew-widget.ts` — 1.2
- `src/utils/paths.ts` — 2.10
- `src/utils/fs-watch.ts` — 1.3
- `src/observability/metric-sink.ts` — 4.1
- `src/observability/event-to-metric.ts` — 4.3
- `src/observability/exporters/otlp-exporter.ts` — 4.2
- `src/state/atomic-write.ts` — 3.4
- `src/state/event-log-rotation.ts` — 2.3
- `src/runtime/heartbeat-watcher.ts` — 3.2, 3.6
- `src/runtime/team-runner.ts` — 2.8 (extracted adaptive-plan)
- `src/runtime/background-runner.ts` — fix LAZY marker
- `src/config/config.ts` — 2.9 (extracted types)
- `package.json` — bench scripts + test concurrency
- `.gitignore` — bench artifacts
- `scripts/bench-check.mjs` — sub-ms gate

## Recommended follow-ups (in priority order)

1. Implement ADR 0006 (bundle ESM) on a dedicated branch — biggest
   remaining lever for cold start.
2. Land 1.6 + 1.7 (UI selectors) for dashboard FPS improvement.
3. Land 3.1 + 3.5 (backpressure + cancel) for run-stability under load.
4. Land 2.1 + 2.2 (durability coalescers) once recovery test harness exists.
5. Implement ADR 0007, 0008 in subsequent maintenance windows.

# pi-mono Review: Relevance to pi-crew

**Date:** 2026-05-28  
**Reviewed commits:** `origin/main~15..origin/main` (recent 2 weeks)  
**Focus:** Breaking changes, new APIs, and architectural patterns that affect pi-crew

---

## 1. High Impact — Immediate Consideration

### No high-impact breaking changes found

The recent 15 commits in pi-mono are **all incremental refinements** to the `AgentHarness` internal refactor (in progress since several releases). None introduce breaking changes to public APIs pi-crew already relies on.

---

## 2. Medium Impact — Aligned Direction

### A. `AgentHarness` Phase & Lifecycle Model

pi-mono formalized the agent lifecycle with explicit phases:

```ts
type AgentHarnessPhase = "idle" | "turn" | "compaction" | "branch_summary" | "retry";
```

Structural operations require `phase === "idle"`. Turn snapshots are snapshotted per-turn for model/thinking-level/stream-options changes mid-run.

pi-crew's hook system already covers the major lifecycle events (`before_run`, `after_run`, etc.). **Opportunity:** align hook names with harness phases if pi-crew eventually uses `AgentHarness` directly:
- Consider `before_turn`, `after_turn` hooks
- Consider `before_compaction`, `after_compaction` hooks

**Recommendation:** Keep current hooks, add `before_turn` / `after_turn` as new hooks emerge.

### B. `prepareNextTurn` + Turn Snapshots

pi-mono added `AgentLoopConfig.prepareNextTurn` — called after each `turn_end`, allows dynamic model/thinking-level changes between rounds.

pi-crew delegates turn execution to fresh Pi processes (via `pi-spawn.ts` / `child-pi.ts`) — each new task is already a new process. **Recommendation:** No change needed. pi-crew's process-per-task model is intentional.

### C. Together AI Provider

pi-mono added first-class Together AI provider (`@earendil-works/pi-ai`). pi-crew doesn't directly configure providers — relies on pi's config. **Recommendation:** No change needed.

### D. Stream Options (Transport, Timeout, Retries, Headers, Metadata)

pi-mono formalized `AgentHarnessStreamOptions` as a curated config surface (not raw provider options). Stream options are snapshotted per-turn and can be patched by `before_provider_request` hooks.

pi-crew's `runtime/policy-engine.ts` handles model routing but doesn't expose transport/timeout/retry config to users.

**Recommendation:** Consider adding `--stream-timeout`, `--max-retries` options to `team action='run'`. Low priority.

### D. Generic Resource Loading (`loadSourcedSkills`, `loadSourcedPromptTemplates`)

pi-mono added `mapSkill` / `mapPromptTemplate` callbacks to typed resource loading — allows applications to transform skills/prompts with source-attached metadata (e.g., tagging skills with workspace scope).

pi-crew's skill discovery (`src/skills/discover-skills.ts`) uses simpler approach — just loads and returns skill arrays.

**Recommendation:** For efficiency, consider map callbacks if pi-crew adds source-aware skill metadata (e.g., skill scope tracking).

---

## 3. Low Impact — No Action

### A. Compaction Token Clamping (Already N/A)

```ts
// pi-mono clamp
const maxTokens = Math.min(
  Math.floor(0.8 * reserveTokens),
  model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
);
```

pi-crew doesn't have its own compaction logic — it relies on pi's transcript management. No action needed.

### B. AgentHarness Resources Generics

The generic `AgentHarnessResources<TSkill, TPromptTemplate>` is harness-internal. Not relevant to pi-crew's skill loading approach.

### C. System Prompt Skill Instructions

Minor language refinement (`"Use the read tool to load"` → `"Read the full skill file"`) — pi-crew's skill instructions are independent.

**Recommendation:** Consider mirroring the updated phrasing in pi-crew skill templates.

### D. Factory Removal

`packages/agent/src/harness/factory.ts` was removed (13 lines changed). pi-crew doesn't use factory pattern — no impact.

---

## 4. Opportunities for pi-crew Enhancement

> **Full implementation plans with code examples:** [`docs/pi-mono-opportunities.md`](./pi-mono-opportunities.md)

**Priority 1 (HIGH):** BM25 Semantic Reranking — integrate existing BM25 search into `team action='recommend'` to fix keyword-matching failures for nuanced goals.

**Priority 2 (MEDIUM):** Extended Hook Phases — add `before_turn` / `after_turn` hooks using existing `turn_end` event tracking in `child-pi.ts`.

**Priority 3 (MEDIUM):** Hook Lifecycle Tests — expand test coverage for `task_result`, `before_retry`, `before_publish`, `session_before_switch`, `run_recovery` hooks.

**Priority 4 (LOW):** Phase Tracking + Hook Documentation — task phase states and `docs/hooks.md` developer guide.

**Not a priority:** ExecutionEnv alignment, harness event chaining — pi-crew's approach is appropriate for its trust model.

---

## 5. Development Support Suggestions

> **See [`docs/pi-mono-opportunities.md`](./pi-mono-opportunities.md) for detailed test plans and documentation outlines.**

- **Hook test suite** — cover `task_result`, `before_retry`, `before_publish`, `session_before_switch`, `run_recovery`
- **Hook documentation** — `docs/hooks.md` with full registry, mode explanations, and 3+ examples
- **Phase tracking** — task-level phase states surfaced in `team action='status'`
- **Harness awareness** — monitor `AgentHarness` stabilization for future migration opportunities (not near-term)

---

## 6. Summary: No Breaking Changes

| Check | Result |
|-------|--------|
| Breaking API changes in pi-mono recent commits | **None** |
| Changes requiring pi-crew updates | **None** |
| Opportunities for alignment | 5 (see below) |
| Development support gaps identified | 4 |
| Urgent migrations needed | **None** |

## 7. Detailed Opportunity Plans

**See [`docs/pi-mono-opportunities.md`](./pi-mono-opportunities.md) for full implementation details.**

| # | Opportunity | Priority | Effort | Key Impact |
|---|-------------|----------|--------|-----------|
| 1 | **BM25 Semantic Reranking** for `team action='recommend'` | HIGH | Medium | Fixes keyword-matching failures for nuanced goals |
| 2 | **Extended Hook Phases** (`before_turn` / `after_turn`) | MEDIUM | Medium | Enables per-turn observability and early abort |
| 3 | **Hook Lifecycle Test Suite** | MEDIUM | Small | Coverage for untested hooks (task_result, before_retry, etc.) |
| 4A | **Task Phase Tracking** | LOW | Small | Richer `team action='status'` output |
| 4B | **Hook Documentation** (`docs/hooks.md`) | LOW | Small | Developer experience for extension API |

**Conclusion:** pi-crew v0.5.2 is fully compatible with the latest pi-mono. The harness changes are strengthening the foundation that pi-crew relies on. Maintain the current process-per-task architecture; watch for `AgentHarness` stabilization milestones before considering migration.

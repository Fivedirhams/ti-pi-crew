---
name: implementation
description: Adaptive implementation workflow with mandatory context compaction between phases
---

## assess
role: planner
output: adaptive-plan.json

Assess this task and decide how many subagents are actually needed for: {goal}

You are the orchestration planner. Inspect the repository enough to choose an efficient crew; do not use a fixed template. Small/simple tasks may need one executor plus one verifier. Risky or broad tasks may need parallel explorers, specialists, implementers, reviewers, security reviewers, or test engineers.

Return a concise rationale, then include exactly one JSON block between these markers:

ADAPTIVE_PLAN_JSON_START
{
  "phases": [
    {
      "name": "short-phase-name",
      "tasks": [
        {
          "role": "explorer|analyst|planner|critic|executor|reviewer|security-reviewer|test-engineer|verifier|writer",
          "title": "short task title",
          "task": "specific autonomous task prompt for this subagent"
        }
      ]
    }
  ]
}
ADAPTIVE_PLAN_JSON_END

Rules:
- **MAXIMIZE PARALLELISM**: Put independent tasks in the SAME phase so they run concurrently.
  For example, if a task needs exploration + implementation + review, use 3 phases:
  Phase 1: explorers (2-3 in parallel), Phase 2: executors (2-3 in parallel), Phase 3: reviewers (2 in parallel).
  NEVER create sequential phases when tasks are independent.
- Choose the smallest effective number of subagents per phase.
- Tasks within the same phase run in parallel; phases run sequentially.
- Include verification/review tasks when implementation is requested.
- Do not include more than 12 total subagents; split or summarize oversized plans instead.
- A good plan for a complex task has 2-4 phases with 2-4 parallel tasks each.
- A simple task may have just 1-2 phases with 1-2 tasks.

## compact
role: planner
input: previous-phase-results
output: compacted-context.json

**MANDATORY**: Before proceeding to next phase, compact context SMARTLY.

Tiered summary approach (DO NOT lose critical details):

### TIER 1 - Essential Summary (500 tokens max):
- High-level findings
- Key decisions made
- Blockers if any

### TIER 2 - Detailed Reference (3000 tokens max):
- File:Line references for issues found
- Key code snippets (max 5 most important)
- Specific test failures with error messages

### TIER 3 - Access Points (unlimited):
- List of files modified/read
- Commands to run (tests, builds)
- Agent should READ FILES DIRECTLY, not rely on embedded content

CRITICAL: Do NOT strip line numbers, error messages, or specific code references. Agents need these to fix issues.

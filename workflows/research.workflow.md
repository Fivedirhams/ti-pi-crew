---
name: research
description: Research workflow with context compaction
---

## explore
role: explorer

Gather relevant facts for: {goal}. Return concise findings (max 2000 tokens).

## analyze
role: analyst
dependsOn: explore

**MANDATORY**: Compact exploration findings (max 1500 tokens) before analysis.

Analyze and organize the findings into structured recommendations.

## write
role: writer
dependsOn: analyze
output: research-summary.md

Write a concise final summary with evidence and open questions (max 1500 tokens).

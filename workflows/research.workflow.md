---
name: research
description: Research workflow with context compaction
---

## explore
role: explorer

Gather relevant facts for: {goal}.

Output using tiered format:
### TIER 1 - Key Facts (500 tokens):
- 3-5 most important findings
- Quick answers to main questions

### TIER 2 - Supporting Evidence (2000 tokens):
- File:Line references
- Code snippets
- Test results
- Data points

### TIER 3 - Raw Data (no limit):
- File lists
- Command outputs
- Links to documentation

## analyze
role: analyst
dependsOn: explore

Use tier 2 and tier 3 from explore to build analysis.

**MANDATORY**: Read original files directly when analyzing, not just summaries.

Structure output:
### Executive Summary (300 tokens):
- What we learned
- Key recommendations

### Detailed Analysis (2000 tokens):
- Evidence-backed findings
- Trade-offs considered
- Risks identified

### References (no limit):
- Files analyzed
- Data sources

## write
role: writer
dependsOn: analyze
output: research-summary.md

Write a concise final summary with evidence and open questions (max 1500 tokens).

---
name: review
description: Review workflow with mandatory context compaction
---

## explore
role: explorer

Identify changed or relevant areas for review: {goal}. Return a concise summary (max 500 tokens) of files to review.

## code-review
role: reviewer
dependsOn: explore
parallelGroup: review

Review correctness, maintainability, tests, and regressions.

Output using tiered format:
### TIER 1 - Summary (500 tokens):
- Overall code quality assessment
- Key issues found (by severity)

### TIER 2 - Details (2000 tokens):
- File:Line for each issue
- Specific code snippets showing problems
- Suggested fix approach

### TIER 3 - Evidence (no limit):
- Test output excerpts
- Error messages
- Files needing changes

## security-review
role: security-reviewer
dependsOn: explore
parallelGroup: review

Review security risks and trust boundaries.

Output using tiered format:
### TIER 1 - Summary (500 tokens):
- Overall security posture
- Critical/High vulnerabilities found

### TIER 2 - Details (2000 tokens):
- File:Line for each vulnerability
- Attack vector description
- Impact assessment

### TIER 3 - Exploit Details (no limit):
- Proof of concept if applicable
- CVSS-style scoring
- Remediation steps

## verify
role: verifier
dependsOn: code-review, security-review

**MANDATORY**: Use tiered context to avoid losing critical details.

Run the project test suite ONCE (cache to .crew/cache/).

Cross-reference test results with reviewer findings:
- For each issue in TIER 2, verify against actual test output
- Confirm File:Line references exist in real code
- Check if suggested fixes actually resolve issues

Give PASS/FAIL per issue, not just overall.

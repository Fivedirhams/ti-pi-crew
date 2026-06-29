---
name: review
description: Code review и безопасность
defaultWorkflow: review
workspaceMode: single
maxConcurrency: 2
---

- reviewer: agent=reviewer ревью кода
- security-reviewer: agent=security-reviewer безопасность
- verifier: agent=verifier верификация

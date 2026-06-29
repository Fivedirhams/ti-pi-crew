---
name: cycle
description: Цикл анализ → реализация → ревью → критика (повторяется)
defaultWorkflow: pipeline
workspaceMode: single
maxConcurrency: 2
---

- analyst: agent=analyst analyze requirements
- executor: agent=coder implement changes
- reviewer: agent=reviewer review code
- critic: agent=critic critique and improve

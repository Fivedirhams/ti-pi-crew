---
name: default
description: Обычная реализация - планирование, выполнение, проверка
defaultWorkflow: default
workspaceMode: single
maxConcurrency: 2
---

- explorer: agent=explorer быстрое исследование
- planner: agent=planner создать план
- coder: agent=coder реализовать
- verifier: agent=verifier проверить

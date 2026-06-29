---
name: fast-fix
description: Быстрое исправление багов
defaultWorkflow: fast-fix
workspaceMode: single
maxConcurrency: 1
---

- explorer: agent=explorer найти проблему
- coder: agent=coder исправить
- verifier: agent=verifier проверить

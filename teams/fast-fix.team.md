---
name: fast-fix
description: Быстрое исправление багов
defaultWorkflow: fast-fix
workspaceMode: single
maxConcurrency: 1
---

- explorer: agent=explorer исследовать проблему
- coder: agent=coder исправить баг
- verifier: agent=verifier проверить

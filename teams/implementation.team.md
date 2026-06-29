---
name: implementation
description: Реализация: implement + review + critique
defaultWorkflow: implementation
workspaceMode: single
maxConcurrency: 2
---

- coder: agent=coder реализовать
- reviewer: agent=reviewer проверить качество
- critic: agent=critic критический анализ

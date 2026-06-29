---
name: parallel-research
description: Параллельное исследование с шардами
defaultWorkflow: parallel-research
workspaceMode: single
maxConcurrency: 3
---

- explorer: agent=explorer исследование
- analyst: agent=analyst анализ
- writer: agent=writer документация

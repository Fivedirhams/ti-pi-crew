---
name: implementation
description: Полная реализация с параллельными специалистами, критикой и верификацией
defaultWorkflow: implementation
workspaceMode: single
maxConcurrency: 3
---

- explorer: agent=explorer исследовать код
- analyst: agent=analyst уточнить требования
- planner: agent=planner создать план
- critic: agent=critic критический анализ
- coder: agent=coder реализовать план
- reviewer: agent=reviewer ревью кода
- sec: agent=sec безопасность
- tester: agent=tester тесты
- verifier: agent=verifier верификация
- writer: agent=writer документация

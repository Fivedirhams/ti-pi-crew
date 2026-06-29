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
- executor: agent=executor реализовать план
- reviewer: agent=reviewer ревью кода
- security-reviewer: agent=security-reviewer безопасность
- tester: agent=tester тесты
- verifier: agent=verifier верификация
- writer: agent=writer документация

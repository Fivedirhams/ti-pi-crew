---
name: specify
description: Создание и утверждение спецификации
defaultWorkflow: specify
workspaceMode: single
maxConcurrency: 1
---

- analyst: agent=analyst анализ и драфт
- critic: agent=critic ревью спеки
- analyst: agent=analyst финализация

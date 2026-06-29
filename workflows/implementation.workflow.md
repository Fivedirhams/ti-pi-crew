---
name: implementation
description: Реализация: implement + review + critique
---

## implement
role: coder
output: implementation-result.md

Реализуй: {goal}

Создай ветку: feature/task-{taskId}
Внеси изменения
Зафиксируй коммитом

artifact output: implementation-result.md

## review
role: reviewer
dependsOn: implement

Проверь качество кода:
- Читаемость и понятность
- Тесты и покрытие
- Архитектура
- Regression риски

artifact output: review-result.md

## critique
role: critic
dependsOn: review

Критический анализ результатов:
- Полнота реализации
- Проблемы и риски
- Рекомендации по улучшению

artifact output: critique-result.md

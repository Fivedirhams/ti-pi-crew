---
name: planning
description: Планирование - анализ требований, архитектура, создание плана
---

## analyze
role: analyst
output: requirements.md

Проанализируй требования: {goal}

Выяви:
- Функциональные требования
- Нефункциональные требования
- Ограничения
- Зависимости
- Критерии приёмки

Создай документ requirements.md с анализом.

## architect
role: architect
dependsOn: analyze
output: architecture.md

На основе требований спроектируй архитектуру:

Выбери:
- Структуру компонентов
- Схему данных
- API контракты
- Интеграции
- Технологический стек

Создай документ architecture.md.

## plan
role: planner
dependsOn: architect
output: plan.md

Создай план реализации на основе requirements.md и architecture.md:

Включи:
- Список задач с оценкой
- Зависимости между задачами
- Приоритеты
- Риски и mitigation

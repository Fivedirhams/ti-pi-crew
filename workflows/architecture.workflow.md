---
name: architecture
description: Создание и развитие архитектуры проекта
---

## analyze
role: architect
output: architecture-analysis.md

На основе docs/goals.md:
1. Определи Functional Components проекта
2. Заполни таблицу Functional Components в docs/architecture.md:
   - ID (C1, C2, C3...)
   - Компонент
   - Назначение
   - Status
3. Определи технические компоненты и связи
4. Заполни секции: Платформа, Tech Stack, NFR

artifact output: architecture-analysis.md

## research
role: researcher
dependsOn: analyze
output: tech-research.md

Исследуй технологии для реализации Functional Components:
- Выбор языка/фреймворка
- Базы данных и хранилища
- Инфраструктура
- Инструменты разработки

Запиши результаты в секцию Research Notes файла docs/architecture.md

## finalize
role: architect
dependsOn: research
output: architecture-final.md

Финализируй архитектуру:
1. Учти результаты research
2. Обнови Functional Components
3. Зафиксируй версию v1.0
4. Добавь запись в History секцию

Выведи итоговую структуру Functional Components.

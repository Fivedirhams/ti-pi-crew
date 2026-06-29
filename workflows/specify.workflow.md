---
name: specify
description: Создание и утверждение спецификации
---

## analyze
role: analyst
output: spec-draft.md

Создай драфт спецификации: {goal}

Включи:
- Название и описание
- Scope (что входит/не входит)
- Функциональные требования
- Non-functional требования
- Критерии приёмки
- Timeline

Создай spec-draft.md

## review
role: critic
dependsOn: analyze
output: spec-review.md

Проверь спецификацию:

- Полнота требований
- Реализуемость
- Противоречия
- Неоднозначности
- Риски

Создай spec-review.md с комментариями и рекомендациями.

## finalize
role: analyst
dependsOn: review
output: spec-final.md

Учти замечания из review и создай финальную версию spec-final.md

---
name: research
description: Исследование технологий и решений - привязка к документу
---

## explore
role: researcher

Пойми контекст из {goal}:
- Какой документ нужно исследовать (spec, task, architecture)
- Какие вопросы нужно закрыть
- Какие есть открытые проблемы

## search
role: researcher
dependsOn: explore

Проведи исследование:
- Используй web_search для поиска решений
- Сравни варианты по критериям
- Проверь актуальность информации

## analyze
role: researcher
dependsOn: search
output: research-notes.md

Синтезируй результаты:
- Определи рекомендации
- Выяви риски и открытые вопросы
- Подготовь структурированные заметки

## write
role: researcher
dependsOn: analyze

Запиши результаты в целевой документ:
- Если goal содержит specId → docs/specs/{specId}.md (секция Research Notes)
- Если goal содержит taskId → docs/tasks/{taskId}.md (секция Research Notes)
- Если goal указывает на architecture → docs/architecture.md (секция Research Notes)
- Иначе → создай research-summary.md как временный artifact

Формат записи:
```markdown
## Research: {topic}

**Дата:** {YYYY-MM-DD}

**Вопрос:** {что исследовали}

**Найденные варианты:**
| Вариант | Плюсы | Минусы | Рекомендация |
|---------|-------|--------|--------------|
| | | | |

**Вывод:** 
**Открытые вопросы:**
-
```

Обнови версию документа (v1.0 → v1.1) и добавь запись в History.

---
name: planning
description: Декомпозиция SPEC на гранулярные задачи в index.json
---

## plan
role: planner

На основе SPEC (spec_id) и project analysis:
1. Проанализируй требования спеки
2. Изучи структуру проекта (какие файлы, зависимости)
3. Создай гранулярные задачи для РЕАЛИЗАЦИИ этой спеки

Для каждой задачи вызови team tool с action='run' и параметрами:
- goal: описание что делать
- specId: {specId}
- team: какая команда нужна (implementation, testing, review)
- workflow: какой workflow использовать

Пример создания задачи:
```
team({
  action: 'run',
  goal: 'Реализовать модель данных Payment',
  specId: '{specId}',
  team: 'implementation',
  workflow: 'implementation'
})
```

Создай 3-7 задач максимально гранулярных и тестируемых.

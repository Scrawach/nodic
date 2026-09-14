import json
import subprocess
from pathlib import Path

gh = 'C:/Users/Alastar/AppData/Local/Programs/GitHub CLI/bin/gh.exe'
git = ['git', '-c', 'safe.directory=E:/Projects/nodic']
def run(args):
    return subprocess.check_output(args, text=True, encoding='utf-8').strip()

run(git + ['add', '--', '.gitignore', 'AGENTS.md', 'CONTEXT.md', 'docs', '.agents/skills'])
run(git + ['diff', '--cached', '--check'])
run(git + ['commit', '-m', 'Document Nodic v1 architecture and collaboration findings'])
run(git + ['push', '-u', 'origin', 'master'])
info = json.loads(run([gh, 'repo', 'view', 'Scrawach/nodic', '--json', 'defaultBranchRef']))
if info['defaultBranchRef']['name'] == 'prototype/collaboration-model':
    run([gh, 'repo', 'edit', 'Scrawach/nodic', '--default-branch', 'master'])
issue = json.loads(run([gh, 'issue', 'view', '1', '--repo', 'Scrawach/nodic', '--json', 'body']))
heading = '## Архитектура и технический прототип'
if heading not in issue['body']:
    body = issue['body'] + '''

## Архитектура и технический прототип

- [Архитектура первого рабочего среза](https://github.com/Scrawach/nodic/blob/master/docs/architecture.md).
- [Результаты и ограничения проверки](https://github.com/Scrawach/nodic/blob/master/docs/research/collaboration-prototype.md).
- [Автономный прототип и исходники](https://github.com/Scrawach/nodic/tree/prototype/collaboration-model/prototypes/collaboration), коммит baf9435e2282b7e2ab6f503c9f60b6c129743812.

Выбран React + TypeScript + React Flow, Yjs 13 для текста, Node.js/Fastify/WebSocket и PostgreSQL. Структурные команды проверяются последовательно на сервере, чтобы конкурентные связи не нарушали правила графа.

В браузерном стенде пройдены объединение текста, персональная отмена/повтор, удаление при тексте в пути, конфликт связей, отмена после чужого перемещения и переподключение. Yjs настоящий; доставка и сервер моделируются в памяти. Настоящая сеть, БД, составная история отмены и нагрузка 1 000 нод / 10 авторов ещё не проверены. Спецификация остаётся открытой: приложение ещё не реализовано.
'''
    path = Path('.scratch/issue-1-architecture.md')
    path.write_text(body, encoding='utf-8')
    print(run([gh, 'issue', 'edit', '1', '--repo', 'Scrawach/nodic', '--body-file', str(path)]))
print(run(git + ['status', '--short']))
print(run([gh, 'repo', 'view', 'Scrawach/nodic', '--json', 'defaultBranchRef']))

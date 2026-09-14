import json
import subprocess
from pathlib import Path

repo = Path('E:/Projects/nodic')
for path in ('docs/architecture.md', 'docs/research/collaboration-prototype.md', 'docs/adr/0001-collaboration-and-storage.md', 'CONTEXT.md', 'prototypes/collaboration/collaboration.html'):
    text = (repo / path).read_text(encoding='utf-8')
    print(path, ':', len(text), 'characters')
    assert text.strip()
git = ['git', '-c', 'safe.directory=E:/Projects/nodic']
subprocess.run(git + ['status', '--short'], check=True)
subprocess.run(git + ['show-ref'], check=True)

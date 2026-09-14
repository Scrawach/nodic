import os
import subprocess
import tempfile
from pathlib import Path

repo = Path('E:/Projects/nodic')
git = ['git', '-c', 'safe.directory=E:/Projects/nodic']
def run(args, env=None, input=None):
    return subprocess.check_output(git + args, cwd=repo, env=env, input=input, text=True, encoding='utf-8').strip()

# An alternate index keeps the user's current branch, staging area and files intact.
index = Path(tempfile.gettempdir()) / ('nodic-prototype-index-' + os.urandom(8).hex())
env = dict(os.environ, GIT_INDEX_FILE=str(index))
try:
    run(['read-tree', '--empty'], env)
    run(['add', '-f', '--', 'prototypes/collaboration'], env)
    tree = run(['write-tree'], env)
    commit = run(['commit-tree', tree, '-m', 'Prototype collaboration model: Yjs text and validated graph commands'], env)
    run(['update-ref', 'refs/heads/prototype/collaboration-model', commit, '0' * 40])
    print('Captured prototype:', commit)
finally:
    index.unlink(missing_ok=True)

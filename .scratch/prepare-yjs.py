import json
import urllib.request
from pathlib import Path

root = Path('prototypes/collaboration')
root.mkdir(parents=True, exist_ok=True)
def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()
metadata = json.loads(fetch('https://registry.npmjs.org/yjs/latest'))
version = metadata['version']
print('Yjs:', version)
source = fetch(f'https://esm.sh/yjs@{version}/es2022/yjs.bundle.mjs').decode()
print('Bundle header:', source[:500])
(root / 'yjs.vendor.mjs').write_text(source, encoding='utf-8')
(root / 'vendor-version.txt').write_text(version, encoding='utf-8')

import hashlib
import urllib.request
from pathlib import Path

root = Path('prototypes/collaboration')
parts = ['# Third-party notices\n\nThe standalone prototype embeds Yjs and lib0, distributed under the MIT license.\n']
for repo in ('yjs/yjs', 'dmonad/lib0'):
    request = urllib.request.Request(f'https://raw.githubusercontent.com/{repo}/main/LICENSE', headers={'User-Agent':'Nodic-prototype'})
    with urllib.request.urlopen(request, timeout=30) as response:
        parts.append(f'\n## {repo}\n\n' + response.read().decode())
(root / 'THIRD-PARTY-NOTICES.md').write_text('\n'.join(parts), encoding='utf-8')
vendor = root / 'yjs.vendor.mjs'
(root / 'README.md').write_text('''# Throwaway collaboration prototype

Open `collaboration.html` directly in a browser. No server, installation, or network connection is needed.

The two Yjs replicas are real. Network delivery and graph authority are simulated in memory. This is not the Nodic editor and it does not measure network throughput or database durability.

To recreate the single HTML file, run `python assemble.py`. No build tool or package installation is required.

`model.mjs` is the isolated state model. `shell.html` is the presentation. `observations.json` records the guided walkthrough results from Edge. The raw vendor module is input to assembly and is not a standalone Node entry point.

Third-party code: Yjs 13.6.32 prebuilt ESM bundle from https://esm.sh/yjs@13.6.32/es2022/yjs.bundle.mjs (includes lib0). Assembly supplies the browser environment fields used by that bundle and inlines its exports. See THIRD-PARTY-NOTICES.md.

Vendor SHA-256: ''' + hashlib.sha256(vendor.read_bytes()).hexdigest() + '\n', encoding='utf-8')

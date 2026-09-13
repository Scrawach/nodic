"""Inline the prebuilt Yjs distribution and demo into a portable HTML file."""
import re
from pathlib import Path

root = Path(__file__).parent
vendor = (root / 'yjs.vendor.mjs').read_text(encoding='utf-8')
print('Process references:', sorted(set(re.findall(r'__Process\$\.[\w.]+', vendor))))
vendor = vendor.replace('import __Process$ from "/node/process.mjs";', 'const __Process$ = {env: {}, argv: [], browser: true};')
vendor = re.sub(r'//# sourceMappingURL=.*', '', vendor)
match = re.search(r'export\s*\{([^}]+)\}', vendor)
assert match
exports = []
for entry in match.group(1).split(','):
    names = re.split(r'\s+as\s+', entry.strip())
    exports.append(f'{names[-1]}: {names[0]}')
vendor = vendor[:match.start()] + 'return {' + ','.join(exports) + '};' + vendor[match.end():]
vendor = 'const Y = (() => {\n' + vendor + '\n})();'
assert not re.search(r'^import ', vendor, re.M)
model = (root / 'model.mjs').read_text(encoding='utf-8')
model = model.replace("import * as Y from './yjs.vendor.mjs';", '').replace('export class ', 'class ').replace('export const ', 'const ')
html = (root / 'shell.html').read_text(encoding='utf-8')
html = html.replace('/* __VENDOR__ */', vendor).replace('/* __MODEL__ */', model)
html = html.replace('__VERSION__', (root / 'vendor-version.txt').read_text().strip())
(root / 'collaboration.html').write_text(html, encoding='utf-8')
print('Standalone HTML:', len(html.encode('utf-8')), 'bytes')

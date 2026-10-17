"""Create reviewable source and static-PWA packages from explicit allowlists."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
out = root / 'release'
out.mkdir(exist_ok=True)
roots = ['src', 'server', 'public', 'scripts', 'tests', 'docs']
files = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
         'playwright.config.ts', 'index.html', 'README.md', '.env.example',
         '.gitignore', '.dockerignore', '.prettierrc.json', 'Dockerfile',
         'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'README.en.md', 'CHANGELOG.md',
         'ROADMAP.md', '.gitattributes']
source_files = [root / f for f in files]
for folder in roots:
    source_files.extend(p for p in (root / folder).rglob('*') if p.is_file())

for name, items, base in [
    ('gleanbook-source.zip', source_files, root),
    ('gleanbook-pwa-static.zip', [p for p in (root / 'dist').rglob('*') if p.is_file()], root / 'dist'),
]:
    if '--source-only' in sys.argv and name != 'gleanbook-source.zip':
        continue
    target = out / name
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for file in sorted(items):
            rel = file.relative_to(base)
            if file.name == '.env' or 'node_modules' in rel.parts or '__pycache__' in rel.parts:
                raise RuntimeError('Unexpected private or generated path in package')
            archive.write(file, rel.as_posix())
    with ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Archive integrity check failed')
    print(json.dumps({'file':str(target),'bytes':target.stat().st_size,
                      'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))

import json
from pathlib import Path

p = Path('config.json')
print('exists:', p.exists())
print('size:', p.stat().st_size)
try:
    d = json.loads(p.read_text(encoding='utf-8'))
    print('first_run:', d.get('first_run'))
    print('parse: OK')
except Exception as e:
    print('parse ERROR:', e)

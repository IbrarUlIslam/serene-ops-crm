"""Add the connector navigation script to the existing bundled template."""
import json
import pathlib
import re

path = pathlib.Path(__file__).parent.parent / 'index.html'
text = path.read_text(encoding='utf-8')
pattern = r'(<script type="__bundler/template">\s*)(.*?)(\s*</script>)'
match = re.search(pattern, text, re.S)
if not match:
    raise SystemExit('Bundled template not found')
template = json.loads(match.group(2))
tag = '<script src="/audit-connectors-nav.js" defer></script>'
if tag not in template:
    if '</body>' not in template:
        raise SystemExit('Body end not found')
    template = template.replace('</body>', tag + '\n</body>', 1)
    encoded = json.dumps(template, ensure_ascii=False).replace('</', '<\\/')
    text = text[:match.start(2)] + encoded + text[match.end(2):]
    path.write_text(text, encoding='utf-8')
print('Connector navigation present')

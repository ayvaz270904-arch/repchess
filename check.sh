#!/bin/bash
# Синтаксис-проверка inline-JS всех приложений (node на этой машине нет).
# Параметр — конкретный файл; без параметра проверяются все три.
cd "$(dirname "$0")"
files=${1:-"trainer.html index.html client.html"}
for f in $files; do
  python3 - "$f" <<'EOF'
import re, sys
fname = sys.argv[1]
html = open(fname, encoding='utf-8').read()
scripts = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', html, re.S)
js = '\n;\n'.join(scripts)
open('/tmp/_repchess_check.js', 'w', encoding='utf-8').write(js)
print(f'{fname}: {len(js)} chars', end='  ')
EOF
  res=$(osascript -l JavaScript /tmp/_repchess_check.js 2>&1 | head -1)
  # Парсер прошёл весь файл = синтаксис ок; ошибки среды (console/window undefined) — норма
  if echo "$res" | grep -q "SyntaxError"; then
    echo "❌ SYNTAX ERROR: $res"
    exit 1
  else
    echo "✅ OK"
  fi
done

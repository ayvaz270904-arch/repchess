# Перевод векторной части страницы PDF (пути, заливки, обводки) в SVG-фрагменты по областям.
import re, sys, json
from pypdf import PdfReader
fn = sys.argv[1]
page = PdfReader(fn).pages[0]
H = float(page.mediabox.height); W = float(page.mediabox.width)
data = page.get_contents().get_data().decode('latin-1')
tok_re = re.compile(r'\((?:\\.|[^\\)])*\)|<<|>>|\[|\]|<[0-9A-Fa-f\s]*>|/[^\s/\[\]()<>{}%]*|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z\'"*]+|%[^\n]*')
toks = tok_re.findall(data)
def mul(a, b):  # PDF-матрицы [a b c d e f]: a × b
    return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
            a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]]
def tp(m, x, y): return (m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5])
ctm = [1, 0, 0, 1, 0, 0]; stack = []; fill = (0, 0, 0); stroke = (0, 0, 0); lw = 1.0
path = []; pts = []; st = []; intext = 0; shapes = []
f2 = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')
def emit(kind):
    global path, pts
    if path and pts:
        g = [tp(ctm, x, y) for x, y in pts]
        xs = [p[0] for p in g]; ys = [p[1] for p in g]
        d = ' '.join(path)
        shapes.append({'kind': kind, 'd': d, 'm': list(ctm), 'fill': fill, 'stroke': stroke, 'lw': lw,
                       'bb': [min(xs), min(ys), max(xs), max(ys)]})
    path = []; pts = []
for t in toks:
    if t[0] in '(<[]/%' or t in ('<<', '>>'):
        if t not in ('[', ']'): st.append(t)
        continue
    if re.match(r'^[-+]?\d*\.?\d+', t): st.append(float(t)); continue
    op = t
    if op == 'BT': intext = 1
    elif op == 'ET': intext = 0
    elif intext: pass
    elif op == 'q': stack.append((list(ctm), fill, stroke, lw))
    elif op == 'Q': ctm, fill, stroke, lw = stack.pop()
    elif op == 'cm': ctm = mul([float(x) for x in st[-6:]], ctm)
    elif op in ('scn', 'sc', 'rg'):
        n = [x for x in st if isinstance(x, float)]
        if len(n) >= 3: fill = tuple(n[-3:])
    elif op in ('SCN', 'SC', 'RG'):
        n = [x for x in st if isinstance(x, float)]
        if len(n) >= 3: stroke = tuple(n[-3:])
    elif op == 'w': lw = st[-1]
    elif op == 'm': path.append('M%s %s' % (f2(st[-2]), f2(st[-1]))); pts.append((st[-2], st[-1]))
    elif op == 'l': path.append('L%s %s' % (f2(st[-2]), f2(st[-1]))); pts.append((st[-2], st[-1]))
    elif op == 'c':
        a = st[-6:]; path.append('C' + ' '.join(f2(v) for v in a)); pts += [(a[0], a[1]), (a[2], a[3]), (a[4], a[5])]
    elif op == 'v':
        a = st[-4:]; path.append('S' + ' '.join(f2(v) for v in a)); pts += [(a[0], a[1]), (a[2], a[3])]
    elif op == 'y':
        a = st[-4:]; path.append('C%s %s %s %s %s %s' % tuple(f2(v) for v in (a[0], a[1], a[2], a[3], a[2], a[3]))); pts += [(a[0], a[1]), (a[2], a[3])]
    elif op == 'h': path.append('Z')
    elif op == 're':
        x, y, w, h = st[-4:]; path.append('M%s %s h%s v%s h%s Z' % (f2(x), f2(y), f2(w), f2(h), f2(-w))); pts += [(x, y), (x + w, y + h)]
    elif op in ('f', 'F'): emit('fill')
    elif op == 'f*': emit('fill-evenodd')
    elif op in ('S', 's'): emit('stroke')
    elif op in ('B', 'B*', 'b', 'b*'): emit('fill')
    elif op == 'n': path = []; pts = []
    st = []
print(json.dumps({'W': W, 'H': H, 'shapes': shapes}))

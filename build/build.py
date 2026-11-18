import sys, os, re, hashlib
sys.path.insert(0, os.path.dirname(__file__))
from pages import PAGES, HEAD, SCRIPTS
import pages2  # noqa: F401 registers remaining pages

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
local = "--local" in sys.argv
target = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else OUT

PAGES["admin.html"] = dict(
    title="Admin | GifToyz Nepal", desc="GifToyz shop admin.",
    extra_head='<meta name="robots" content="noindex, nofollow">\n<link rel="stylesheet" href="admin.css">\n<script>window.GT_ADMIN=true</script>\n', body_class="",
    body='<div id="admin"></div>', script=None, after='<script src="admin.js"></script>')

def versioned(html):
    def tag(m):
        path = os.path.join(OUT, m.group(2))
        if not os.path.isfile(path):
            return m.group(0)
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:10]
        return f'{m.group(1)}="{m.group(2)}?v={digest}"'
    return re.sub(r'\b(src|href)="([a-z0-9-]+\.(?:js|css))"', tag, html)


for name, pg in PAGES.items():
    head = HEAD.format(title=pg["title"], desc=pg["desc"], extra_head=pg["extra_head"])
    tail = SCRIPTS + "\n" + (f"<script>\n{pg['script']}\n</script>" if pg.get("script") else "") + pg.get("after", "")
    body_open = f'<body class="{pg["body_class"]}">' if pg["body_class"] else "<body>"
    if name == "index.html" and not local:
        html = f"{head}\n{pg['body']}\n{tail}\n"
        if pg["body_class"]:
            raise SystemExit("index body class unsupported")
    else:
        html = f'<!doctype html>\n<html lang="en">\n<head>\n{head}\n</head>\n{body_open}\n{pg["body"]}\n{tail}\n</body>\n</html>\n'
    with open(os.path.join(target, name), "w") as f:
        f.write(versioned(html))
print("built", len(PAGES), "pages into", target)

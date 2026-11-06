#!/usr/bin/env python3
"""
compress.py - turn the editable dash-parkour.html into the small Khan Academy file.

    python3 compress.py dash-parkour.html                  -> dash-parkour.ka.html
    python3 compress.py dash-parkour.html -o game.html     (choose the output name)
    python3 compress.py dash-parkour.html --page page.html (also write the plain
                                                            compressed page, no launcher)
    python3 compress.py dash-parkour.html --no-strip       (keep comments/indentation)

What it does:
  1. reads the save code from `var savecodeversion1point1` at the top of
     dash-parkour.html and puts it at the top of the output file;
  2. takes the four <script class="dash-src"> program blocks, removes their
     comments and indentation (strings, regexes and line breaks are kept
     exactly, so the program does not change);
  3. packs them with raw DEFLATE (level 9) + base64 into one payload that the
     page's loader unpacks when it opens;
  4. wraps the page in the "Open fullscreen" launcher used on Khan Academy;
  5. checks the result unpacks back to the same programs and reports the size.

Only the Python standard library is needed.
"""
import argparse
import base64
import html as htmlmod
import json
import re
import sys
import zlib

KA_LIMIT = 750_000  # roughly what Khan Academy will save
NAMES = ["promise", "renderer", "adapter", "game"]
PLACEHOLDER = 'var saveCode = "";'


# ---------------------------------------------------------------------------
# JavaScript comment / indentation stripper
# ---------------------------------------------------------------------------
WORD = re.compile(r"[A-Za-z0-9_$\\\u0080-\uffff]+")
SPACE = re.compile(r"[ \t\r\n\f\v\u00a0\ufeff\u2028\u2029]+")
LINE_COMMENT = re.compile(r"//[^\n\r\u2028\u2029]*")
BLOCK_COMMENT = re.compile(r"/\*[\s\S]*?\*/")
# after these words a "/" starts a regex, not a division
REGEX_AFTER_WORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
                     "throw", "case", "do", "else", "yield", "await"}
# a space next to one of these is never needed
TIGHT = set("{}()[];,:=<>!&|*%^~")


def _string_end(s, i):
    q = s[i]
    j = i + 1
    n = len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == q:
            return j + 1
        if c == "\n" and q != "`":
            raise ValueError("unterminated string at %d" % i)
        if q == "`" and c == "$" and j + 1 < n and s[j + 1] == "{":
            j = _code_end(s, j + 2)
            continue
        j += 1
    raise ValueError("unterminated string at %d" % i)


def _code_end(s, i):
    # inside ${ ... } of a template: find the matching }
    depth = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in "'\"`":
            i = _string_end(s, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            if depth == 0:
                return i + 1
            depth -= 1
        i += 1
    raise ValueError("unterminated template expression")


def _regex_end(s, i):
    j = i + 1
    n = len(s)
    in_class = False
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "\n":
            raise ValueError("unterminated regex at %d" % i)
        if in_class:
            if c == "]":
                in_class = False
        elif c == "[":
            in_class = True
        elif c == "/":
            j += 1
            m = WORD.match(s, j)  # flags
            return m.end() if m else j
        j += 1
    raise ValueError("unterminated regex at %d" % i)


def strip_js(s):
    out = []
    n = len(s)
    i = 0
    prev = ""        # last significant token
    prev_kind = ""   # "word", "punct", "string", "regex"
    gap = ""         # whitespace seen since the last token: "", " " or "\n"

    def emit(tok, kind):
        nonlocal prev, prev_kind, gap
        if out:
            if gap == "\n":
                out.append("\n")
            elif gap == " ":
                a = prev[-1]
                b = tok[0]
                if not (a in TIGHT or b in TIGHT) or (a in "+-" and b in "+-"):
                    out.append(" ")
        out.append(tok)
        prev = tok
        prev_kind = kind
        gap = ""

    while i < n:
        c = s[i]
        m = SPACE.match(s, i)
        if m:
            ws = m.group(0)
            if "\n" in ws or "\r" in ws or "\u2028" in ws or "\u2029" in ws:
                gap = "\n"
            elif gap != "\n":
                gap = " "
            i = m.end()
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            i = LINE_COMMENT.match(s, i).end()
            if gap != "\n":
                gap = " "
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            m = BLOCK_COMMENT.match(s, i)
            if not m:
                raise ValueError("unterminated comment at %d" % i)
            if "\n" in m.group(0):
                gap = "\n"
            elif gap != "\n":
                gap = " "
            i = m.end()
            continue
        if c in "'\"`":
            j = _string_end(s, i)
            emit(s[i:j], "string")
            i = j
            continue
        if c == "/":
            is_regex = (prev_kind == "" or
                        (prev_kind == "punct" and prev not in (")", "]", "}")) or
                        (prev_kind == "word" and prev in REGEX_AFTER_WORDS))
            if is_regex:
                j = _regex_end(s, i)
                emit(s[i:j], "regex")
                i = j
                continue
        m = WORD.match(s, i)
        if m:
            emit(m.group(0), "word")
            i = m.end()
            continue
        emit(c, "punct")
        i += 1
    return "".join(out)


# ---------------------------------------------------------------------------
# page pieces
# ---------------------------------------------------------------------------
SRC_BLOCK = re.compile(
    r'(?:<!-- =+ [^\n]* =+ -->\n)?<script type="text/plain" class="dash-src" id="dash-src-(\w+)">\n?([\s\S]*?)\n?</script>\n?')
SAVE_LINE = re.compile(r'var\s+savecodeversion1point1\s*=\s*(?:window\.\w+\s*\|\|\s*)*("(?:\\.|[^"\\])*")\s*;')
HEADER_COMMENT = re.compile(r"(<!DOCTYPE html>\n)<!--[\s\S]*?-->\n", re.I)
INLINE_SCRIPT = re.compile(r'(<script(?: id="[\w-]+")?>)([\s\S]*?)(</script>)')


def read_page(path):
    with open(path, encoding="utf-8") as f:
        page = f.read()
    blocks = list(SRC_BLOCK.finditer(page))
    names = [m.group(1) for m in blocks]
    if names != NAMES:
        sys.exit("Expected the program blocks %s in that order, found %s." % (NAMES, names))
    m = SAVE_LINE.search(page)
    save = json.loads(m.group(1)) if m else ""
    return page, blocks, save


def build_page(page, blocks, sources_out, strip):
    for name, src in zip(NAMES, sources_out):
        if "<!--" in src or re.search(r"</script", src, re.I):
            sys.exit("The %s program contains <!-- or </script, which would break the page." % name)
    data = [src.encode("utf-8") for src in sources_out]
    raw = b"".join(data)
    comp = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    packed = comp.compress(raw) + comp.flush()
    # self-check: unpack it again
    if zlib.decompress(packed, -15) != raw:
        sys.exit("Self-check failed: the payload did not unpack to the same programs.")
    b64 = base64.b64encode(packed).decode("ascii")
    b64 = "\n".join(b64[k:k + 4096] for k in range(0, len(b64), 4096))
    payload = ('<script type="application/x-deflate" id="game-payload" data-lengths="%s">\n%s\n</script>\n'
               % (",".join(str(len(d)) for d in data), b64))
    start, end = blocks[0].start(), blocks[-1].end()
    out = page[:start] + payload + page[end:]
    out = HEADER_COMMENT.sub(r"\1", out, count=1)
    out = out.replace('<p id="boot-kicker">EDITABLE BUILD</p>', '<p id="boot-kicker">OFFLINE BUILD</p>')
    if strip:
        # the loader, sound and DashNet scripts get the same treatment
        def shrink(m):
            body = m.group(2)
            if "savecodeversion1point1" in body and len(body) < 2000:
                return m.group(0)  # keep the save-code script at the top readable
            return m.group(1) + strip_js(body) + m.group(3)
        out = INLINE_SCRIPT.sub(shrink, out)
    return out, len(raw), len(packed)


# ---------------------------------------------------------------------------
# Khan Academy launcher (opens the game in its own tab)
# ---------------------------------------------------------------------------
LAUNCHER_TOP = r'''<!DOCTYPE html>
<html lang="en">
<head>
<script>
// ===== SAVE CODE =====
// Paste a DASH Parkour save code between the quotes to load it automatically.
// Older save codes (1.0, and the 1.1 test codes) work too: they are converted to 1.1.
// (Press P while playing to print your current code.)
var savecodeversion1point1 = %s;
</script>
'''
LAUNCHER_BODY = r'''<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DASH Parkour</title>
<style>
html,body{margin:0;height:100%;background:#e0ffff;overflow:hidden;font-family:"Trebuchet MS",Arial,sans-serif}
body{display:grid;place-items:center;
  background-image:linear-gradient(100deg,transparent 48%,#00c8ff 49%,#00c8ff 51%,transparent 52%),linear-gradient(-8deg,transparent 47%,#00c8ff 48%,#00c8ff 52%,transparent 53%);
  background-size:64px 64px,64px 64px}
#card{background:#fff;border:6px solid #000;border-radius:28px;padding:28px 34px 24px;text-align:center;box-shadow:10px 10px 0 #0003;max-width:min(440px,86vw)}
#logo{font-size:64px;font-weight:900;color:#f00;letter-spacing:4px;line-height:1;margin:0}
#sub{font-size:22px;letter-spacing:10px;margin:6px 0 18px;color:#000}
#dash{width:70px;height:70px;background:#f00;border-radius:16px;margin:0 auto 18px;position:relative;transform:rotate(-12deg)}
#dash:before,#dash:after{content:"";position:absolute;top:18px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:inset -4px 0 0 6px #000}
#dash:before{left:14px}#dash:after{right:14px}
button{font:inherit;font-weight:800;font-size:22px;border:5px solid #000;border-radius:18px;background:#f00;color:#fff;padding:12px 26px;cursor:pointer;box-shadow:0 6px 0 #000}
button:hover{background:#ff3b3b}button:active{transform:translateY(4px);box-shadow:0 2px 0 #000}
#here{display:block;margin:16px auto 0;background:none;border:0;box-shadow:none;color:#0064dc;font-size:15px;padding:4px;text-decoration:underline}
#msg{min-height:1.3em;margin:12px 0 0;font-size:14px;color:#a40000}
.small{font-size:13px;color:#555;margin:12px 0 0}
</style>
</head>
<body>
<div id="card">
  <div id="dash"></div>
  <p id="logo">DASH</p>
  <p id="sub">PARKOUR</p>
  <button id="open" type="button">Open fullscreen</button>
  <p id="msg" role="status"></p>
  <button id="here" type="button">Play in this page instead</button>
  <p class="small">Opens the game in its own tab so it can use your whole screen. Press F11 there for true fullscreen.</p>
</div>
<script type="text/plain" id="dash-game">'''
LAUNCHER_END = r'''</script>
<script>
(function () {
  "use strict";
  function gameHtml() {
    var h = document.getElementById("dash-game").textContent
      .replace(/<\\\/script/gi, function (m) { return "</" + m.slice(3); })
      .replace(/<\\!--/g, "<!--");
    var sc = window.savecodeversion1point1 || window.savecode1dot1 || window.saveCode;
    if (sc) {
      // hand the save code from the top of this file to the game
      h = h.replace("<head>", "<head><" + "script>window.savecodeversion1point1 = " + JSON.stringify(String(sc)).replace(/</g, "\\u003c") + ";<" + "/script>");
    }
    return h;
  }
  function msg(t) { document.getElementById("msg").textContent = t; }
  document.getElementById("open").onclick = function () {
    var w = null;
    try { w = window.open("about:blank", "_blank"); } catch (e) { w = null; }
    if (!w) { msg("Your browser blocked the new tab. Allow pop-ups for this page, or play in this page."); return; }
    try {
      w.document.open();
      w.document.write(gameHtml());
      w.document.close();
      try { w.focus(); } catch (e) {}
      msg("The game is running in the new tab.");
    } catch (e) {
      // Sandboxed pages may not reach into the new tab: hand it the game as a
      // blob: URL instead (no access to its document needed).
      try {
        var url = URL.createObjectURL(new Blob([gameHtml()], { type: "text/html" }));
        w.location.href = url;
        msg("The game is running in the new tab.");
      } catch (e2) {
        try { w.close(); } catch (e3) {}
        msg("Could not start the game in a new tab here (" + (e && e.message ? e.message : e) + "). Try playing in this page.");
      }
    }
  };
  document.getElementById("here").onclick = function () {
    var h = gameHtml();
    document.open();
    document.write(h);
    document.close();
  };
}());
</script>
</body>
</html>
'''


def wrap(page, save):
    # the game page inside the launcher starts with an empty save code;
    # the launcher hands over its own one when it opens the game
    page = SAVE_LINE.sub(lambda m: m.group(0).replace(m.group(1), '""'), page, count=1)
    emb = page.replace("</script", "<\\/script").replace("</SCRIPT", "<\\/SCRIPT").replace("<!--", "<\\!--")
    if "</script" in emb.lower():
        sys.exit("The page still contains </script after escaping.")
    return LAUNCHER_TOP % json.dumps(save) + LAUNCHER_BODY + emb + LAUNCHER_END


def main():
    ap = argparse.ArgumentParser(description="Compress dash-parkour.html into the small Khan Academy file.")
    ap.add_argument("input", nargs="?", default="dash-parkour.html")
    ap.add_argument("-o", "--output", default="dash-parkour.ka.html", help="the Khan Academy file to write")
    ap.add_argument("--page", help="also write the compressed game page without the launcher")
    ap.add_argument("--no-strip", action="store_true", help="keep comments and indentation")
    args = ap.parse_args()

    page, blocks, save = read_page(args.input)
    strip = not args.no_strip
    sources = []
    for m in blocks:
        src = m.group(2)
        if strip:
            try:
                src = strip_js(src)
            except ValueError as e:
                sys.exit("Could not read the %s program: %s" % (m.group(1), e))
        sources.append(src)
    # the loader looks for this exact text to put the save code in
    game = sources[3]
    if PLACEHOLDER not in game:
        tight = PLACEHOLDER.replace(" = ", "=")
        if tight in game:
            game = game.replace(tight, PLACEHOLDER, 1)
        else:
            sys.exit('The game program must contain  %s  (the save code goes there).' % PLACEHOLDER)
    sources[3] = game

    out_page, raw_len, packed_len = build_page(page, blocks, sources, strip)
    if args.page:
        with open(args.page, "w", encoding="utf-8") as f:
            f.write(out_page)
    final = wrap(out_page, save)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(final)

    size = len(final.encode("utf-8"))
    print("programs  %9d bytes%s" % (sum(len(m.group(2).encode("utf-8")) for m in blocks), ""))
    if strip:
        print("stripped  %9d bytes" % raw_len)
    print("deflated  %9d bytes" % packed_len)
    print("output    %9d bytes  -> %s" % (size, args.output))
    print("save code %s" % ("kept at the top (%d characters)" % len(save) if save else "empty"))
    if size > KA_LIMIT:
        print("WARNING: that is over about %d bytes, Khan Academy may refuse to save it." % KA_LIMIT)


if __name__ == "__main__":
    main()

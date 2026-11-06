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
LAUNCHER_TOP = r"""<!DOCTYPE html>
<html lang="en">
<head>
<script>
// ===== SAVE CODE =====
// Paste a DASH Parkour save code between the quotes to load it automatically.
// Older save codes (1.0, and the 1.1 test codes) work too: they are converted to 1.1.
// (Press P while playing, or Settings > General > Save Code > COPY.)
var savecodeversion1point1 = %s;

// ===== SERVER MODE (party lists) =====
// on: "auto" = on when the game is played on the server's own website,
//     true = always on, false = always off (Khan Academy can't reach it anyway).
var dashServerMode = %s;
</script>
"""
LAUNCHER_BODY = r"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>DASH Parkour</title>
<style>
html,body{margin:0;height:100%%;overflow:hidden;font-family:"Trebuchet MS",Arial,sans-serif;background:#fdffff}
body{background-color:#fdffff;background-position:center;background-size:cover;background-repeat:no-repeat;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
#panel{margin:0 16px 13vh;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
button{font:inherit;font-weight:800;font-size:clamp(16px,3.2vmin,24px);border:5px solid #000;border-radius:18px;background:#f00;color:#fff;padding:12px 26px;cursor:pointer;box-shadow:0 6px 0 #000}
button:hover{background:#ff3b3b}button:active{transform:translateY(4px);box-shadow:0 2px 0 #000}
button.alt{background:#fff;color:#000}button.alt:hover{background:#eaffff}
#msg{min-height:1.3em;margin:0;font-size:14px;color:#a40000;background:#fffc;border-radius:8px;padding:2px 8px}
#msg:empty{background:none}
#art{position:fixed;left:0;top:0;width:100%%;height:100%%;object-fit:cover;z-index:0}
#panel{position:relative;z-index:1}
</style>
</head>
<body>
<canvas id="art" width="2" height="2"></canvas>
<div id="panel">
  <div class="row">
    <button id="open" type="button">Open fullscreen</button>
    <button id="here" class="alt" type="button">Play here</button>
  </div>
  <p id="msg" role="status"></p>
</div>
<script type="text/plain" id="dash-art">%s</script>
<script type="text/plain" id="dash-game">"""
LAUNCHER_END = r"""</script>
<script>
(function () {
  "use strict";
  function gameHtml() {
    var h = document.getElementById("dash-game").textContent
      .replace(/<\\\/script/gi, function (m) { return "</" + m.slice(3); })
      .replace(/<\\!--/g, "<!--");
    var sc = window.savecodeversion1point1 || window.savecode1dot1 || window.saveCode;
    var set = "";
    if (sc) set += "window.savecodeversion1point1 = " + JSON.stringify(String(sc)) + ";";
    if (window.dashServerMode) set += "window.dashServerMode = " + JSON.stringify(window.dashServerMode) + ";";
    // hand the settings from the top of this file to the game
    if (set) h = h.replace("<head>", "<head><" + "script>" + set.replace(/</g, "\\u003c") + "<" + "/script>");
    return h;
  }
  function msg(t) { document.getElementById("msg").textContent = t; }
  // the title art (kept out of the CSS: Khan Academy's checker reads the ";" in
  // "data:image/webp;base64" as the end of a CSS line)
  // drawn pixel by pixel on a canvas, because Khan Academy blocks data: images
  // Raw DEFLATE decoder (RFC 1951), used when the browser has no DecompressionStream.
  function dashInflate(src) {
    var out = new Uint8Array(Math.max(1024, src.length * 6)), op = 0;
    var bitBuf = 0, bitCnt = 0, ip = 0;
    function grow(n) {
      if (op + n <= out.length) return;
      var size = out.length * 2;
      while (size < op + n) size *= 2;
      var bigger = new Uint8Array(size);
      bigger.set(out.subarray(0, op));
      out = bigger;
    }
    function bits(n) {
      while (bitCnt < n) {
        if (ip >= src.length) throw new Error("Compressed data ended unexpectedly.");
        bitBuf |= src[ip++] << bitCnt;
        bitCnt += 8;
      }
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    // canonical Huffman table: counts per length + symbols sorted by code
    function build(lengths, n) {
      var counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(n), i;
      for (i = 0; i < n; i++) counts[lengths[i]]++;
      counts[0] = 0;
      for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
      for (i = 0; i < n; i++) if (lengths[i]) syms[offs[lengths[i]]++] = i;
      return { counts: counts, syms: syms };
    }
    function decode(t) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= bits(1);
        var count = t.counts[len];
        if (code - first < count) return t.syms[index + code - first];
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
      }
      throw new Error("Bad compressed data.");
    }
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    var fixedL = null, fixedD = null, last, type, i;
    do {
      last = bits(1);
      type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        if (ip + 4 > src.length) throw new Error("Compressed data ended unexpectedly.");
        var len = src[ip] | (src[ip + 1] << 8), nlen = src[ip + 2] | (src[ip + 3] << 8);
        ip += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error("Bad stored block.");
        if (ip + len > src.length) throw new Error("Compressed data ended unexpectedly.");
        grow(len);
        out.set(src.subarray(ip, ip + len), op);
        op += len;
        ip += len;
        continue;
      }
      var lt, dt;
      if (type === 1) {
        if (!fixedL) {
          var fl = new Uint8Array(288);
          for (i = 0; i < 144; i++) fl[i] = 8;
          for (; i < 256; i++) fl[i] = 9;
          for (; i < 280; i++) fl[i] = 7;
          for (; i < 288; i++) fl[i] = 8;
          fixedL = build(fl, 288);
          var fd = new Uint8Array(30);
          for (i = 0; i < 30; i++) fd[i] = 5;
          fixedD = build(fd, 30);
        }
        lt = fixedL;
        dt = fixedD;
      } else if (type === 2) {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var cl = new Uint8Array(19);
        for (i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
        var ct = build(cl, 19);
        var lens = new Uint8Array(hlit + hdist);
        for (i = 0; i < hlit + hdist;) {
          var sym = decode(ct);
          if (sym < 16) {
            lens[i++] = sym;
          } else {
            var rep = 0, val = 0;
            if (sym === 16) {
              if (!i) throw new Error("Bad compressed data.");
              val = lens[i - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) {
              rep = 3 + bits(3);
            } else {
              rep = 11 + bits(7);
            }
            if (i + rep > hlit + hdist) throw new Error("Bad compressed data.");
            while (rep--) lens[i++] = val;
          }
        }
        lt = build(lens.subarray(0, hlit), hlit);
        dt = build(lens.subarray(hlit), hdist);
      } else {
        throw new Error("Bad compressed data.");
      }
      for (;;) {
        var s = decode(lt);
        if (s < 256) {
          grow(1);
          out[op++] = s;
        } else if (s === 256) {
          break;
        } else {
          s -= 257;
          if (s >= 29) throw new Error("Bad compressed data.");
          var length = LBASE[s] + bits(LEXT[s]);
          var ds = decode(dt);
          if (ds >= 30) throw new Error("Bad compressed data.");
          var dist = DBASE[ds] + bits(DEXT[ds]);
          if (dist > op) throw new Error("Bad compressed data.");
          grow(length);
          for (i = 0; i < length; i++, op++) out[op] = out[op - dist];
        }
      }
    } while (!last);
    return out.subarray(0, op);
  }

  try {
    var t = document.getElementById("dash-art").textContent;
    if (/\S/.test(t)) {
      var a = JSON.parse(t.replace(/\s+/g, ""));
      var bin = atob(a.px), src = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i);
      var px = dashInflate(src);
      var cv = document.getElementById("art");
      cv.width = a.w; cv.height = a.h;
      var cx = cv.getContext("2d"), img = cx.createImageData(a.w, a.h), d = img.data;
      for (var j = 0; j < px.length; j++) {
        var c = px[j] * 3;
        d[j * 4] = a.pal[c]; d[j * 4 + 1] = a.pal[c + 1]; d[j * 4 + 2] = a.pal[c + 2]; d[j * 4 + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
    }
  } catch (e) {}
  function playHere() {
    var h = gameHtml();
    document.open();
    document.write(h);
    document.close();
  }
  document.getElementById("open").onclick = function () {
    var w = null;
    try { w = window.open("about:blank", "_blank"); } catch (e) { w = null; }
    if (!w) { msg("Your browser blocked the new tab. Allow pop-ups for this page, or press Play here."); return; }
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
        msg("Could not start the game in a new tab here (" + (e && e.message ? e.message : e) + "). Try Play here.");
      }
    }
  };
  document.getElementById("here").onclick = playHere;
  // Only a page shown inside another page (the Khan Academy editor, an
  // embed) needs the buttons: opened by itself (the file, or a website)
  // it already has the whole window, so the game just starts.
  var framed = true;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  if (!framed) playHere();
}());
</script>
</body>
</html>
"""
SERVER_LINE = re.compile(r'var\s+dashServerMode\s*=\s*window\.dashServerMode\s*\|\|\s*(\{[^;\n]*\})\s*;')
ART_BLOCK = re.compile(r'(?:<!-- =+ Title art[^\n]*-->\n)?<script type="text/plain" id="dash-launch-art">\s*(\{[\s\S]*?\})\s*</script>\n?')


def wrap(page, save):
    # the title art is only for the launcher (the game draws its own)
    art = ""
    m = ART_BLOCK.search(page)
    if m:
        art = re.sub(r"\s+", "", m.group(1))
        page = page[:m.start()] + page[m.end():]
    sm = SERVER_LINE.search(page)
    server = sm.group(1) if sm else '{ on: false, url: "" }'
    # the game page inside the launcher starts with an empty save code;
    # the launcher hands over its own one when it opens the game
    page = SAVE_LINE.sub(lambda m: m.group(0).replace(m.group(1), '""'), page, count=1)
    emb = page.replace("</script", "<\\/script").replace("</SCRIPT", "<\\/SCRIPT").replace("<!--", "<\\!--")
    if "</script" in emb.lower():
        sys.exit("The page still contains </script after escaping.")
    return LAUNCHER_TOP % (json.dumps(save), server) + LAUNCHER_BODY % art + emb + LAUNCHER_END


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

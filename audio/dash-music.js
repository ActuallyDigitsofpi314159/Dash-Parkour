/* =====================================================================
   DASH Parkour soundtrack: composition helpers + every song.
   Original music by DK Digital, built on the Dash motif
   (dash-parkour/Dash Main Motif.mid) and the Guards' motif
   (dash-parkour/Boss battle motif.mid).

   Notation used below (all lengths are in 16th notes = "steps"):
     mel(key, '1:2 2 3:3 .:2 5:2 ...')   scale degrees of the key's mode
         "5,"  one octave down   "1'"  one octave up   "b3" "#4" altered
         ".:3" a rest of 3 steps  ":n" length (default 2)  "!" accent  "?" soft
         "C5:2" absolute note names also work, "[1,3,5]:4" a chord
         "|" marks a bar line (checked: a warning if a bar is not 16 steps)
     prog('C:2 G/B:2 | Am:2 G:2')        chords, lengths in beats (default 4)
     pad / arp / bass / comp / drum     accompaniment from a progression
   ===================================================================== */
(function () {
  'use strict';
  var SONGS = window.DASH_SONGS = window.DASH_SONGS || {};
  var WARN = window.DASH_MUSIC_WARNINGS = [];
  var where = '';
  function warn(msg) { WARN.push(where + ': ' + msg); }

  /* ------------------------------------------------------------ pitch */
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nm(s) {
    var m = /^([A-G])([#b]*)(-?\d)$/.exec(s);
    if (!m) { warn('bad note ' + s); return 60; }
    var acc = 0;
    for (var i = 0; i < m[2].length; i++) acc += m[2][i] === '#' ? 1 : -1;
    return 12 * (parseInt(m[3], 10) + 1) + NOTE[m[1]] + acc;
  }
  var MODES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], hminor: [0, 2, 3, 5, 7, 8, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], phrygdom: [0, 1, 4, 5, 7, 8, 10]
  };
  function K(tonic, mode) { return { t: typeof tonic === 'string' ? nm(tonic) : tonic, mode: MODES[mode || 'major'], name: mode || 'major' }; }
  function parseDeg(tok) {
    var m = /^([#b]?)(\d+)(['+,]*)$/.exec(tok);
    if (!m) return null;
    var marks = 0;
    for (var i = 0; i < m[3].length; i++) marks += m[3][i] === ',' ? -1 : 1;
    return { acc: m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0, d: parseInt(m[2], 10), marks: marks };
  }
  function pitch(k, tok) {
    if (/^[A-G]/.test(tok)) return nm(tok);
    var p = parseDeg(tok);
    if (!p || !k) { warn('bad degree ' + tok); return 60; }
    var idx = (p.d - 1) % 7, o = Math.floor((p.d - 1) / 7);
    return k.t + k.mode[idx] + 12 * o + p.acc + 12 * p.marks;
  }
  // move every scale degree in a melody string by n steps of the scale (sequences, harmonies)
  function shiftDeg(str, n) {
    return str.replace(/(^|\s|\[|,)([#b]?)(\d+)(['+,]*)(?=[:\s\],!?]|$)/g, function (all, pre, acc, d, mk) {
      var marks = 0;
      for (var i = 0; i < mk.length; i++) marks += mk[i] === ',' ? -1 : 1;
      var abs = parseInt(d, 10) - 1 + 7 * marks + n;
      var oct = Math.floor(abs / 7), deg = abs - 7 * oct + 1;
      var s = oct > 0 ? new Array(oct + 1).join("'") : oct < 0 ? new Array(-oct + 1).join(',') : '';
      return pre + acc + deg + s;
    });
  }

  /* ------------------------------------------------------------ melodies */
  function mel(k, str, o) {
    o = o || {};
    var at = o.at || 0, d0 = o.d || 2, v0 = o.v === undefined ? 0.8 : o.v;
    var sh = (o.oct || 0) * 12 + (o.tr || 0), st = o.st || 1;
    var evs = [], pos = at;
    var toks = str.trim().split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok === '|') { if ((pos - at) % 16) warn('bar length off at token ' + i + ' (' + (pos - at) + ') in "' + str.slice(0, 40) + '..."'); continue; }
      var mm = /^(.*?)(?::(\d+(?:\.\d+)?))?([!?]*)$/.exec(tok);
      var p = mm[1], dur = mm[2] ? parseFloat(mm[2]) : d0, ac = mm[3] || '';
      var vel = v0 * (ac.indexOf('!') >= 0 ? 1.25 : 1) * (ac.indexOf('?') >= 0 ? 0.55 : 1);
      if (p === '.' || p === 'r') { pos += dur; continue; }
      var ps = p.charAt(0) === '[' ? p.slice(1, -1).split(',') : [p];
      for (var j = 0; j < ps.length; j++) evs.push([pos, dur * st, pitch(k, ps[j]) + sh, vel]);
      pos += dur;
    }
    evs.len = pos - at;
    return evs;
  }
  function bars() { return Array.prototype.slice.call(arguments).join(' | '); }

  /* ------------------------------------------------------------ chords */
  var QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6],
    dim7: [0, 3, 6, 9], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
    '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
    m7b5: [0, 3, 6, 10], '7sus4': [0, 5, 7, 10], '5': [0, 7], mmaj7: [0, 3, 7, 11], '7b9': [0, 4, 7, 10, 13], '69': [0, 4, 7, 9, 14]
  };
  function pc(s) { return (NOTE[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12; }
  function chord(sym) {
    var m = /^([A-G][#b]?)([a-z0-9#]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m || QUAL[m[2]] === undefined) { warn('bad chord ' + sym); return { root: 0, bass: 0, ivs: [0, 4, 7], pcs: [0, 4, 7], sym: sym }; }
    var root = pc(m[1]), ivs = QUAL[m[2]];
    return { root: root, bass: m[3] ? pc(m[3]) : root, ivs: ivs, pcs: ivs.map(function (i) { return (root + i) % 12; }), sym: sym };
  }
  function prog(str) {
    var out = [], pos = 0;
    var toks = str.trim().split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok === '|') { if (pos % 16) warn('progression bar off: ' + str.slice(0, 40)); continue; }
      var mm = /^([^:]+)(?::(\d+(?:\.\d+)?))?$/.exec(tok);
      var c = chord(mm[1]);
      c.at = pos; c.len = Math.round((mm[2] ? parseFloat(mm[2]) : 4) * 4);
      out.push(c); pos += c.len;
    }
    out.len = pos;
    return out;
  }
  function chordAt(P, step) {
    var s = ((step % P.len) + P.len) % P.len;
    for (var i = 0; i < P.length; i++) if (s >= P[i].at && s < P[i].at + P[i].len) return P[i];
    return P[P.length - 1];
  }
  function nextChord(P, step) {
    var c = chordAt(P, step), i = P.indexOf(c);
    return P[(i + 1) % P.length];
  }
  function voicing(c, lo, hi, n, prev) {
    var cands = [];
    for (var s = lo; s < lo + 12; s++) {
      if (c.pcs.indexOf(s % 12) < 0) continue;
      var v = [s], x = s;
      while (v.length < n) { x++; var g = 0; while (c.pcs.indexOf(x % 12) < 0 && g++ < 24) x++; v.push(x); }
      if (v[v.length - 1] <= hi + 2) cands.push(v);
    }
    if (!cands.length) { var b = lo; while (c.pcs.indexOf(b % 12) < 0) b++; cands.push([b]); }
    var best = cands[0], bs = 1e9, mid = (lo + hi) / 2;
    cands.forEach(function (v) {
      var sc = 0;
      if (prev && prev.length === v.length) for (var i = 0; i < v.length; i++) sc += Math.abs(v[i] - prev[i]);
      else sc = Math.abs((v[0] + v[v.length - 1]) / 2 - mid) * 2;
      if (v[v.length - 1] > hi) sc += 6;
      if (sc < bs) { bs = sc; best = v; }
    });
    return best;
  }
  function voiceAll(P, o) {
    var prev = null;
    return P.map(function (c) { prev = voicing(c, o.lo || 55, o.hi || 74, o.n || 4, prev); return prev; });
  }
  // sustained chords (optionally re-struck on a rhythm)
  function pad(P, o) {
    o = o || {};
    var V = voiceAll(P, o), evs = [];
    P.forEach(function (c, i) {
      V[i].forEach(function (m) { evs.push([c.at, c.len - (o.cut || 0), m, o.v || 0.7]); });
      if (o.bassNote) evs.push([c.at, c.len, bassPitch(c, o.bassNote), o.v || 0.7]);
    });
    evs.len = P.len;
    return evs;
  }
  // arpeggio: pattern tokens are voicing indexes (0 = lowest), "." rest; unit o.u steps
  function arp(P, pat, o) {
    o = o || {};
    var V = voiceAll(P, o), toks = pat.trim().split(/\s+/), u = o.u || 2, evs = [];
    for (var pos = 0, i = 0; pos < P.len; pos += u, i++) {
      var tk = toks[i % toks.length];
      if (tk === '.') continue;
      var c = chordAt(P, pos), v = V[P.indexOf(c)];
      var up = 0; while (tk.slice(-1) === "'") { up += 12; tk = tk.slice(0, -1); }
      var k = parseInt(tk, 10);
      evs.push([pos, u * (o.hold || 1), v[k % v.length] + 12 * Math.floor(k / v.length) + up, (o.v || 0.7) * (i % (o.accEvery || 1e9) === 0 ? 1.15 : 1)]);
    }
    evs.len = P.len;
    return evs;
  }
  function bassPitch(c, lo) {
    var b = c.bass; var m = lo; while (m % 12 !== b) m++;
    return m;
  }
  // bass: per-unit tokens R root(bass) 5 fifth 8 octave 3 third 7 seventh L low root,
  // a/A chromatic approach from below/above to the next chord, s whole step below next, - hold, . rest
  function bass(P, pat, o) {
    o = o || {};
    var lo = o.lo || 36, u = o.u || 1, toks = pat.replace(/\|/g, '').replace(/\s+/g, '').split(''), evs = [];
    var last = null;
    for (var pos = 0, i = 0; pos < P.len; pos += u, i++) {
      var tk = toks[i % toks.length];
      if (tk === '-') { if (last) last[1] += u; continue; }
      last = null;
      if (tk === '.') continue;
      var c = chordAt(P, pos), r = bassPitch(c, lo), m;
      var third = c.ivs.indexOf(3) >= 0 ? 3 : c.ivs.indexOf(2) >= 0 ? 2 : c.ivs.indexOf(5) >= 0 ? 5 : 4;
      var sev = c.ivs.indexOf(10) >= 0 ? 10 : c.ivs.indexOf(11) >= 0 ? 11 : 10;
      var fifth = c.ivs.indexOf(6) >= 0 ? 6 : c.ivs.indexOf(8) >= 0 ? 8 : 7;
      var root = r - ((c.bass - c.root + 12) % 12);
      if (root < lo) root += 12;
      switch (tk) {
        case 'R': m = r; break;
        case '5': m = root + fifth; break;
        case '8': m = r + 12; break;
        case '3': m = root + third; break;
        case '7': m = root + sev; break;
        case 'L': m = r - 12; break;
        case 'a': m = bassPitch(nextChord(P, pos), lo) - 1; break;
        case 'A': m = bassPitch(nextChord(P, pos), lo) + 1; break;
        case 's': m = bassPitch(nextChord(P, pos), lo) - 2; break;
        default: continue;
      }
      last = [pos, u, m, (o.v || 0.8) * (tk === 'R' && pos % 16 === 0 ? 1.1 : 1)];
      evs.push(last);
    }
    evs.len = P.len;
    return evs;
  }
  // chord stabs on a per-bar rhythm: x hit, X accent, - hold, . rest
  function comp(P, rhythm, o) {
    o = o || {};
    var V = voiceAll(P, o), toks = rhythm.replace(/[\s|]+/g, '').split(''), u = o.u || 1, evs = [], cur = [];
    for (var pos = 0, i = 0; pos < P.len; pos += u, i++) {
      var tk = toks[i % toks.length];
      if (tk === '-') { cur.forEach(function (e) { e[1] += u; }); continue; }
      cur = [];
      if (tk === '.') continue;
      var c = chordAt(P, pos), v = V[P.indexOf(c)];
      for (var j = 0; j < v.length; j++) { var e = [pos, u * (o.st || 1), v[j], (o.v || 0.7) * (tk === 'X' ? 1.25 : 1)]; evs.push(e); cur.push(e); }
    }
    evs.len = P.len;
    return evs;
  }
  // drums: x hit, X accent, o ghost, . rest (unit o.u steps). o.m = pitch for tuned drums (toms)
  function drum(pat, o) {
    o = o || {};
    var toks = pat.replace(/[\s|]+/g, '').split(''), u = o.u || 1, evs = [];
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (tk === '.') continue;
      var v = (o.v || 0.8) * (tk === 'X' ? 1.25 : tk === 'o' ? 0.4 : 1);
      var m = o.m || 0;
      if (o.ms) m = o.ms[i % o.ms.length];
      evs.push([i * u, u, m, v]);
    }
    evs.len = toks.length * u;
    return evs;
  }
  // repeat / join event lists
  function rep(evs, times) {
    var out = [], L = evs.len;
    for (var t = 0; t < times; t++) evs.forEach(function (e) { out.push([e[0] + t * L, e[1], e[2], e[3]]); });
    out.len = L * times;
    return out;
  }
  function cat() {
    var out = [], pos = 0;
    for (var i = 0; i < arguments.length; i++) {
      var evs = arguments[i];
      evs.forEach(function (e) { out.push([e[0] + pos, e[1], e[2], e[3]]); });
      pos += evs.len;
    }
    out.len = pos;
    return out;
  }
  function rest(steps) { var e = []; e.len = steps; return e; }
  function tr(evs, semis) { var out = evs.map(function (e) { return [e[0], e[1], e[2] + semis, e[3]]; }); out.len = evs.len; return out; }
  function vel(evs, f) { var out = evs.map(function (e) { return [e[0], e[1], e[2], e[3] * f]; }); out.len = evs.len; return out; }
  function crescendo(evs, from, to) {
    var L = evs.len || 1;
    var out = evs.map(function (e) { return [e[0], e[1], e[2], e[3] * (from + (to - from) * e[0] / L)]; }); out.len = evs.len; return out;
  }
  // the boss riff on each chord root: hits at 1, 4, 10, 12, 14 then a chromatic run into the next root
  function bossRiff(P, o) {
    o = o || {};
    var lo = o.lo || 40, evs = [];
    for (var bar = 0; bar < P.len; bar += 16) {
      var c = chordAt(P, bar), r = bassPitch(c, lo), nx = bassPitch(chordAt(P, bar + 16), lo);
      [0, 3, 9, 11, 13].forEach(function (s) { evs.push([bar + s, s === 13 ? 1 : 1.5, r, (o.v || 0.85) * (s === 0 ? 1.15 : 1)]); });
      evs.push([bar + 14, 1, nx - 2, o.v || 0.85]);
      evs.push([bar + 15, 1, nx - 1, o.v || 0.85]);
    }
    evs.len = P.len;
    return evs;
  }
  // riff guitar: the chord root on a rhythm (x hit, X accent), for power chords (part option power: true)
  function chug(P, rhythm, o) {
    o = o || {};
    var toks = rhythm.replace(/[\s|]+/g, '').split(''), evs = [];
    for (var pos = 0; pos < P.len; pos++) {
      var tk = toks[pos % toks.length];
      if (tk === '.' || tk === '-') continue;
      evs.push([pos, o.st || 0.45, bassPitch(chordAt(P, pos), o.lo || 40), (o.v || 0.6) * (tk === 'X' ? 1.25 : 1)]);
    }
    evs.len = P.len;
    return evs;
  }
  // the boss rhythm as chord stabs
  var BOSS_RHYTHM = 'X..x.....x.x.x..';

  /* ------------------------------------------------------------ songs */
  // part(inst, events, options): vol, pan, rev (reverb send), dly (echo), layer, st, hum
  function part(inst, evs, o) { o = o || {}; o.inst = inst; o.events = evs; return o; }
  function section(barsN, parts, o) { o = o || {}; o.bars = barsN; o.parts = parts.filter(Boolean); return o; }
  function song(name, def) {
    where = name;
    def.spb = def.spb || 4; def.bpb = def.bpb || 4;
    var barSteps = def.spb * def.bpb, n = 0;
    for (var sn in def.sections) {
      var s = def.sections[sn];
      s.len = s.bars * barSteps;
      s.name = sn;
      s.parts.forEach(function (p, i) {
        var L = p.events.len || s.len;
        p.len = L < s.len && s.len % L === 0 ? L : s.len;
        if (L > s.len) warn('part ' + p.inst + ' in ' + sn + ' is longer than the section (' + L + ' > ' + s.len + ')');
        if (p.len < s.len && p.len < 8 && !p.loop) warn('part ' + p.inst + ' in ' + sn + ' repeats every ' + p.len + ' steps (pad it to the section)');
        p.key = p.inst + ':' + (p.layer || 'base') + ':' + (p.name || i) + ':' + sn;
        if (p.shareKey) p.key = p.shareKey;
        p.byStep = [];
        p.events.forEach(function (e) {
          var st = Math.round(e[0]);
          if (st >= p.len) return;
          (p.byStep[st] = p.byStep[st] || []).push(e);
        });
        n += p.events.length;
      });
    }
    def.noteCount = n;
    def.name = name;
    SONGS[name] = def;
    return def;
  }

  /* ================================================================
     THE MOTIFS (scale degrees, so they work in any key or mode)
     ================================================================ */
  // Dash motif, exactly as in Dash Main Motif.mid (C major: C D E | F E D E D || C C A A | D C D E D)
  var DASH1 = '1:2 2:1 3:2 .:3 4:2 3:1 2:1 3:1 2:2 .:1';
  var DASH2 = '1:2 1:1 6,:2 .:1 6,:2 2:1 .:1 1:1 2:1 3:2 .:1 2:1';
  var DASH = DASH1 + ' | ' + DASH2;
  // the Adventure Tune (new; grows out of the motif's "dash" cell 1-2-3). 8 bars.
  var ADV = [
    '1:2 2:1 3:3 5:2 6:2 5:2 3:4',
    '2:3 3:1 2:2 1:2 6,:4 .:4',
    "1:2 2:1 3:3 5:2 1':4 7:2 6:2",
    '5:6 4:1 3:1 2:4 .:4',
    '1:2 2:1 3:3 5:2 6:2 5:2 3:4',
    '2:3 3:1 4:2 5:2 6:4 5:4',
    "1':2 7:1 6:3 5:2 4:2 3:2 2:4",
    '1:6 .:4 5,:2 6,:2 7,:2'
  ];
  var ADV_CHORDS = 'I | vi | I:2 IV:2 | V7 | I | ii7:2 V:2 | IV:2 V:2 | I:3 V:1';
  window.DASH_MOTIFS = { DASH1: DASH1, DASH2: DASH2, ADV: ADV, BOSS: '1:1 .:2 1:1 .:5 1:1 .:1 1:1 .:1 1:1 7,:1 #7,:1' };

  var H = window.DASH_MUSIC_HELPERS = { nm: nm, K: K, mel: mel, bars: bars, prog: prog, pad: pad, arp: arp, bass: bass, comp: comp, drum: drum, rep: rep, cat: cat, rest: rest, tr: tr, vel: vel, crescendo: crescendo, shiftDeg: shiftDeg, part: part, section: section, song: song, bossRiff: bossRiff, chug: chug, chordAt: chordAt, DASH: DASH, DASH1: DASH1, DASH2: DASH2, ADV: ADV, BOSS_RHYTHM: BOSS_RHYTHM, pitch: pitch };

  /* ================================================================
     1. TITLE THEME: C major, 152 BPM. The main Dash theme.
        Brass fanfare on the motif's "dash" cell, the full motif on the
        Dash guitar, then the Adventure Tune makes its first appearance.
     ================================================================ */
  (function () {
    var k = K('C4', 'major');
    // --- intro: fanfare (2 bars) + groove (2 bars)
    var fanTop = mel(k, bars('1:2 2:1 3:5 .:2 3:2 4:1 5:3', "5:2 6:1 7:2 .:1 1':10"), { oct: 1, v: 0.9 });
    var fanLow = mel(k, bars('[1,5]:2 [2,6]:1 [3,1\']:5 .:2 [3,1\']:2 [4,2\']:1 [5,3\']:3', '[5,3]:2 [6,4]:1 [7,5]:2 .:1 [1\',5]:10'), { v: 0.8 });
    var Pfan = prog('C | G:1.5 C:2.5');
    var Pvamp = prog('C:2 G/B:2 | Am:2 G:2');
    var intro = section(4, [
      part('brass', cat(fanTop, rest(32)), { vol: 0.9, rev: 0.35 }),
      part('horn', cat(fanLow, rest(32)), { vol: 0.8, rev: 0.35 }),
      part('strings', cat(pad(Pfan, { lo: 55, hi: 76, n: 4 }), pad(Pvamp, { lo: 55, hi: 74 })), { vol: 0.55, rev: 0.4 }),
      part('pbass', cat(mel(k, bars('1,:16', '5,,:6 1,:10')), bass(Pvamp, 'R-.R-.R.R-.R-.5a', { lo: 36 })), { vol: 0.9 }),
      part('timp', cat(drum('X..x............|......X.........', { m: 36 }), rest(32)), { vol: 0.8, rev: 0.3 }),
      part('crash', cat(drum('x...............|......x.........'), rest(16), drum('x...............')), { vol: 0.6, rev: 0.2 }),
      part('snare', cat(rest(16), crescendo(drum('oooooooooooooooo', { v: 0.6 }), 0.3, 1.1), drum('....x.......x...|....x.......x.xx')), { vol: 0.7, rev: 0.15 }),
      part('kick', cat(rest(32), drum('x..x....x.x.....|x..x....x.x...x.')), { vol: 0.9 }),
      part('hat', cat(rest(32), drum('x.x.x.x.x.x.x.x.|x.x.x.x.x.x.....')), { vol: 0.6 }),
      part('tom', cat(rest(60), drum('xxxx', { ms: [52, 48, 45, 41] })), { vol: 0.7, rev: 0.2 }),
      part('cgtr', cat(rest(32), comp(Pvamp, 'x.x.x.x.x.x.x.x.', { lo: 55, hi: 70, n: 3, st: 0.5 })), { vol: 0.55, pan: -0.3 })
    ], { next: 'A' });

    // --- A: the Dash motif on guitar
    var leadA = bars(DASH,
      '1:2 2:1 3:2 .:1 5:2 6:2 5:1 3:1 5:1 6:2 .:1',
      "1':4 7:2 6:2 5:6 .:2",
      '3:2 4:1 5:2 .:3 6:2 5:1 4:1 5:1 4:2 .:1',
      '3:2 3:1 1:2 .:1 1:2 4:1 .:1 3:1 4:1 5:2 .:1 4:1',
      '6:2 5:1 4:2 .:1 3:2 2:1 1:2 .:1 7,:2 1:1 2:1',
      '2:8 .:4 5,:1 6,:1 7,:2');
    var PA = prog('C:2 G/B:2 | Am:2 G:2 | F:2 G:2 | C/E:2 F:2 | Am:2 Dm7:2 | C/E:2 F:2 | Dm7:2 G:2 | G');
    var groove = function (crash) {
      return [
        part('kick', rep(drum('x..x....x.x.....'), 8), { vol: 0.9 }),
        part('snare', cat(rep(drum('....x.......x...'), 7), drum('....x.......xxxx', { v: 0.75 })), { vol: 0.7, rev: 0.12 }),
        part('hat', rep(drum('x.x.x.x.x.x.x.x.'), 8), { vol: 0.55 }),
        part('ohat', rep(drum('..............x.'), 8), { vol: 0.45 }),
        crash ? part('crash', cat(drum('x'), rest(63), drum('x'), rest(63)), { vol: 0.55, rev: 0.2 }) : null
      ];
    };
    var A = section(8, [
      part('gtr', mel(k, leadA, { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.22, dly: 0.12, name: 'lead' }),
      part('strings', pad(PA, { lo: 55, hi: 74 }), { vol: 0.3, rev: 0.4 }),
      part('cgtr', comp(PA, 'x.x.x.x.x.x.x.x.', { lo: 55, hi: 70, n: 3, st: 0.5 }), { vol: 0.5, pan: -0.3 }),
      part('pbass', bass(PA, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.9 })
    ].concat(groove(true)), { next: 'B' });

    // --- B: the Adventure Tune debuts (flute + glockenspiel), the guitar answers with the dash cell
    var PB = prog('C | Am | C:2 F:2 | G7 | C | Dm7:2 G:2 | F:2 G:2 | C:3 G:1');
    var gtrAns = bars('.:16', '.:12 1:1 2:1 3:2', '.:16', '.:12 5:1 6:1 7:2', '.:16', '.:16', '.:16', '.:6 1:1 2:1 3:2 .:6');
    var B = section(8, [
      part('flute', mel(k, ADV.join(' | '), { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.1 }),
      part('glock', cat(rest(64), mel(k, ADV.slice(4).join(' | '), { oct: 2, v: 0.6 })), { vol: 0.6, rev: 0.35 }),
      part('gtr', mel(k, gtrAns, { oct: 1, v: 0.75 }), { vol: 0.85, rev: 0.25, dly: 0.2, pan: 0.2 }),
      part('strings', pad(PB, { lo: 55, hi: 72 }), { vol: 0.28, rev: 0.45 }),
      part('harp', arp(PB, '0 1 2 3 2 1 2 1', { lo: 60, hi: 79, n: 4, u: 2 }), { vol: 0.45, rev: 0.3, pan: -0.25 }),
      part('pbass', bass(PB, 'R--.5-.R-.R5-.8.', { lo: 36 }), { vol: 0.85 }),
      part('kick', rep(drum('x.......x.x.....'), 8), { vol: 0.85 }),
      part('clap', rep(drum('....x.......x...'), 8), { vol: 0.5, rev: 0.2 }),
      part('shaker', rep(drum('xoxoxoxoxoxoxoxo'), 8), { vol: 0.5 }),
      part('tamb', cat(rep(drum('....x.......x...'), 7), drum('....x...x.x.xxxx')), { vol: 0.35 })
    ], { next: 'bridge' });

    // --- bridge: the motif's "drop" cell climbing down in sequence, building back up
    var PBr = prog('Fmaj7 | Em7 | Dm7 | E7sus4:2 E7:2');
    var leadBr = bars(
      "6:2 6:1 4:2 .:1 4:2 7:1 .:1 6:1 7:1 1':2 .:1 7:1",
      '5:2 5:1 3:2 .:1 3:2 6:1 .:1 5:1 6:1 7:2 .:1 6:1',
      '4:2 4:1 2:2 .:1 2:2 5:1 .:1 4:1 5:1 6:2 .:1 5:1',
      '7:4 6:2 #5:2 3:6 .:2');
    var bridge = section(4, [
      part('gtr', mel(k, leadBr, { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.15, name: 'lead' }),
      part('trem', pad(PBr, { lo: 52, hi: 72 }), { vol: 0.5, rev: 0.4 }),
      part('horn', mel(k, bars('3:16', '2:16', '1:16', '7,:8 #5,:8'), { oct: 0 }), { vol: 0.6, rev: 0.4 }),
      part('pbass', bass(PBr, 'R-------R---5---', { lo: 36 }), { vol: 0.85 }),
      part('kick', drum('x...x...x...x...|x...x...x...x...|x...x...x...x...|x.x.x.x.xxxxxxxx'), { vol: 0.85 }),
      part('snare', cat(rep(drum('....x.......x...'), 3), crescendo(drum('xxxxxxxxxxxxxxxx'), 0.4, 1.2)), { vol: 0.65, rev: 0.15 }),
      part('timp', drum('x.......x.......|x.......x.......|x.......x.......|x...x...x.x.xxxx', { ms: [41] }), { vol: 0.6, rev: 0.3 }),
      part('swell', cat(rest(48), drum('x', { u: 16 })), { vol: 0.6 })
    ], { next: 'A2' });

    // --- A2: the motif again, now harmonised a third below by brass, horns singing a countermelody
    var A2 = section(8, [
      part('gtr', mel(k, leadA, { oct: 1, v: 0.9 }), { vol: 1.0, rev: 0.22, dly: 0.12, name: 'lead' }),
      part('brass', mel(k, shiftDeg(leadA, -2), { oct: 1, v: 0.7 }), { vol: 0.55, rev: 0.3, pan: 0.25 }),
      part('horn', mel(k, bars('3:8 2:8', '1:8 2:8', '1:8 2:8', '3:8 4:8', '3:8 4:8', '5:8 6:8', '6:8 5:8', '5:8 7,:8')), { vol: 0.6, rev: 0.4, pan: -0.2 }),
      part('strings', pad(PA, { lo: 55, hi: 76 }), { vol: 0.3, rev: 0.4 }),
      part('cgtr', comp(PA, 'x.x.x.x.x.x.x.x.', { lo: 55, hi: 70, n: 3, st: 0.5 }), { vol: 0.5, pan: -0.3 }),
      part('glock', arp(PA, "0 . 2 . 1 . 3 .", { lo: 72, hi: 88, n: 4, u: 2 }), { vol: 0.3, rev: 0.3, pan: 0.35 }),
      part('pbass', bass(PA, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.9 }),
      part('kick', rep(drum('x..x....x.x.....'), 8), { vol: 0.9 }),
      part('snare', cat(rep(drum('....x.......x...'), 7), drum('....x...xxxxXXXX', { v: 0.75 })), { vol: 0.72, rev: 0.12 }),
      part('ride', rep(drum('x.x.x.x.x.x.x.x.'), 8), { vol: 0.5 }),
      part('crash', cat(drum('x'), rest(63), drum('x'), rest(63)), { vol: 0.6, rev: 0.2 })
    ], { next: 'A' });

    song('title', { bpm: 152, start: 'intro', sections: { intro: intro, A: A, B: B, bridge: bridge, A2: A2 }, gain: 0.9 });
  })();

  /* ================================================================
     2. AREA 1: F major, 140 BPM. A brand-new adventure.
        The Adventure Tune leads; in the B section the Dash motif is
        tossed back and forth between flute and glockenspiel.
     ================================================================ */
  (function () {
    var k = K('F4', 'major');
    var PI = prog('F | Dm | Bb | C7');
    var lightBeat = function (nBars, fill) {
      return [
        part('kick', rep(drum('x.....x.x.......'), nBars), { vol: 0.8 }),
        part('snare', cat(rep(drum('....x.......x...'), nBars - 1), drum(fill ? '....x.......x.xx' : '....x.......x...')), { vol: 0.55, rev: 0.15 }),
        part('hat', rep(drum('x.x.x.x.x.x.x.x.'), nBars), { vol: 0.6 }),
        part('shaker', rep(drum('oxoxoxoxoxoxoxox'), nBars), { vol: 0.35 })
      ];
    };
    var intro = section(4, [
      part('glock', arp(PI, '0 2 1 3 2 1 2 .', { lo: 72, hi: 90, n: 4, u: 2 }), { vol: 0.5, rev: 0.35 }),
      part('pizz', arp(PI, '0 1 2 1 0 1 2 1', { lo: 53, hi: 72, n: 3, u: 2 }), { vol: 0.6, rev: 0.25 }),
      part('pbass', bass(PI, 'R...5...R...5.a.', { lo: 36 }), { vol: 0.8 }),
      part('flute', mel(k, '.:16 | .:16 | .:16 | .:10 5,:2 6,:2 7,:2', { oct: 1 }), { vol: 0.9, rev: 0.3 }),
      part('kick', cat(rest(32), rep(drum('x.......x.......'), 2)), { vol: 0.7 }),
      part('snare', cat(rest(56), drum('..x.xxxx', { v: 0.5 })), { vol: 0.55 })
    ], { next: 'A' });

    var PA = prog('F | Dm | F:2 Bb:2 | C7 | F | Gm7:2 C:2 | Bb:2 C:2 | F:3 C:1');
    var A = section(8, [
      part('flute', mel(k, ADV.join(' | '), { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.08, name: 'lead' }),
      part('strings', pad(PA, { lo: 53, hi: 72 }), { vol: 0.26, rev: 0.45 }),
      part('cgtr', comp(PA, '..x...x...x...x.', { lo: 57, hi: 72, n: 3, st: 0.6 }), { vol: 0.45, pan: 0.3 }),
      part('pizz', arp(PA, '0 1 2 1 0 1 2 1', { lo: 53, hi: 70, n: 3, u: 2 }), { vol: 0.45, pan: -0.3, rev: 0.2 }),
      part('pbass', bass(PA, 'R-.5-.R.R-.5-.8a', { lo: 36 }), { vol: 1.05 })
    ].concat(lightBeat(8, true)), { next: 'A2' });

    var A2 = section(8, [
      part('flute', mel(k, ADV.join(' | '), { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.08, name: 'lead' }),
      part('glock', mel(k, ADV.join(' | '), { oct: 2, v: 0.55 }), { vol: 0.5, rev: 0.35, pan: 0.2 }),
      part('horn', mel(k, bars('3:16', '3:8 1:8', '3:8 4:8', '5:8 #4:4 5:4', '3:16', '4:8 5:8', '4:8 3:8', '3:12 .:4')), { vol: 0.5, rev: 0.4, pan: -0.2 }),
      part('strings', pad(PA, { lo: 53, hi: 72 }), { vol: 0.26, rev: 0.45 }),
      part('harp', arp(PA, "0 1 2 3 4 3 2 1", { lo: 60, hi: 84, n: 5, u: 1 }), { vol: 0.35, rev: 0.3, pan: -0.3 }),
      part('cgtr', comp(PA, '..x...x...x...x.', { lo: 57, hi: 72, n: 3, st: 0.6 }), { vol: 0.45, pan: 0.3 }),
      part('pbass', bass(PA, 'R-.5-.R.R-.5-.8a', { lo: 36 }), { vol: 1.05 })
    ].concat(lightBeat(8, true), [part('tamb', rep(drum('....x.......x...'), 8), { vol: 0.3 })]), { next: 'B' });

    // B: the Dash motif as call (flute) and response (glockenspiel)
    var PB = prog('F:2 C/E:2 | Dm:2 C:2 | Bb:2 Eb:2 | Gm:2 C:2 | Dm:2 Bb:2 | Gm7:2 C7:2 | Dm:2 Bb:1 C:1 | C7');
    var call = bars(DASH1, '.:16', '4:2 5:1 6:2 .:3 b7:2 6:1 5:1 6:1 5:2 .:1', '.:16',
      '1:2 2:1 3:2 .:1 2:2 3:1 4:2 .:1 3:1 4:1 5:2', '6:2 5:1 4:2 3:1 2:2 3:1 4:1 5:1 6:1 7:2 .:2',
      "1':6 6:2 5:4 4:2 3:2", '2:8 .:6 7,:2');
    var resp = bars('.:16', DASH2, '.:16', shiftDeg(DASH2, 3), '.:16', '.:16', '.:16', '.:16');
    var B = section(8, [
      part('flute', mel(k, call, { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.1, name: 'lead' }),
      part('glock', mel(k, resp, { oct: 2, v: 0.8 }), { vol: 0.75, rev: 0.35, pan: 0.25 }),
      part('marimba', mel(k, resp, { oct: 1, v: 0.6 }), { vol: 0.5, rev: 0.25, pan: 0.25 }),
      part('strings', pad(PB, { lo: 53, hi: 72 }), { vol: 0.28, rev: 0.45 }),
      part('cgtr', comp(PB, 'x.x.x.x.x.x.x.x.', { lo: 57, hi: 72, n: 3, st: 0.5 }), { vol: 0.45, pan: -0.3 }),
      part('pbass', bass(PB, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.85 }),
      part('kick', rep(drum('x..x....x.x.....'), 8), { vol: 0.85 }),
      part('snare', cat(rep(drum('....x.......x...'), 7), drum('....x...x.xxxxxx', { v: 0.7 })), { vol: 0.6, rev: 0.15 }),
      part('hat', rep(drum('x.x.x.x.x.x.x.x.'), 8), { vol: 0.5 }),
      part('crash', cat(drum('x'), rest(127)), { vol: 0.5, rev: 0.2 })
    ], { next: 'C' });

    // C: a gentle interlude in the relative minor, horns singing over marimba
    var PC = prog('Bb | C | Am | Dm | Gm7 | Am7 | Bb:2 C:2 | C7sus4:2 C7:2');
    var C = section(8, [
      part('horn', mel(k, bars('4:6 5:2 6:8', '5:8 3:4 2:4', '3:6 4:2 3:8', '2:6 1:2 6,:8', '4:6 5:2 6:4 5:4', '3:12 .:4', '4:4 5:4 6:4 7:4', "1':8 .:8")), { vol: 0.8, rev: 0.45, name: 'lead' }),
      part('flute', mel(k, bars('.:16', '.:16', '.:16', '.:16', '.:16', '.:12 1:1 2:1 3:2', '.:16', '.:8 1:2 2:1 3:3 2:2')), { vol: 0.7, rev: 0.4, dly: 0.2 }),
      part('marimba', arp(PC, '0 1 2 1 3 2 1 2', { lo: 57, hi: 79, n: 4, u: 2 }), { vol: 0.5, rev: 0.3 }),
      part('strings', pad(PC, { lo: 50, hi: 70 }), { vol: 0.35, rev: 0.5 }),
      part('pbass', bass(PC, 'R---5---R---5-a-', { lo: 36 }), { vol: 0.75 }),
      part('kick', rep(drum('x.......x.......'), 8), { vol: 0.7 }),
      part('rim', rep(drum('....x.......x...'), 8), { vol: 0.5 }),
      part('shaker', rep(drum('oxoxoxoxoxoxoxox'), 8), { vol: 0.35 }),
      part('snare', cat(rest(120), drum('x.xxxxxx', { v: 0.55 })), { vol: 0.55 })
    ], { next: 'A' });

    song('area1', { bpm: 140, start: 'intro', sections: { intro: intro, A: A, A2: A2, B: B, C: C }, gain: 0.95 });
  })();

  /* ================================================================
     6. GUARD BOSS: F# minor. The Guards' motif is the riff; the Dash
        motif (in F# minor) is the hero fighting back. Dynamic layers:
          groove   drums + bass riff       (off while the boss is tired)
          riff     chugging guitar          (off while tired)
          lead     the melody               (off while tired)
          attack   extra drums + brass stabs on the Guards' rhythm
          atk_*    one colour per attack (bullets, bombs, icicles, spikes);
                   the dive gets a riser and a timpani strike
          vuln     the opening: harp/bell playing the dash cell
          emerald / ruby   extra layers for the second and third Guards
     ================================================================ */
  function guardSong(name, tier, bpm) {
    var k = K('F#3', 'minor');
    // intro (the arena rising): tremolo pedal, timpani, snare roll, riser, then a unison blast of the Guards' motif
    var Pped = prog('F#m | F#m | F#m | F#m');
    var intro = section(4, [
      part('trem', mel(k, bars('[1,5]:16', '[1,5]:16', '[1,6]:16', '[1,5]:8 .:8')), { vol: 0.7, rev: 0.4 }),
      part('sub', mel(k, bars('1,:16', '1,:16', '1,:16', '.:16')), { vol: 0.7 }),
      part('timp', cat(crescendo(rep(drum('x.x.x.x.x.x.x.x.', { m: 42 }), 3), 0.35, 1), rest(16)), { vol: 0.7, rev: 0.3 }),
      part('snare', cat(rest(32), crescendo(drum('oooooooooooooooo'), 0.3, 1.1), rest(16)), { vol: 0.6 }),
      part('riser', cat(drum('x', { u: 48, m: 42 }), rest(16)), { vol: 0.55 }),
      part('dbass', cat(rest(48), mel(k, '1,:1 .:2 1,:1 .:5 1,:1 .:1 1,:1 .:1 1,:1 7,,:1 #7,,:1')), { vol: 0.9 }),
      part('gtr', cat(rest(48), mel(k, '[1,5]:1 .:2 [1,5]:1 .:5 [1,5]:1 .:1 [1,5]:1 .:1 [1,5]:1 7,:1 #7,:1', { oct: 0, st: 0.8 })), { vol: 0.8, drive: 4, tone: 2400 }),
      part('brass', cat(rest(48), comp(prog('F#m'), BOSS_RHYTHM, { lo: 61, hi: 78, n: 3, st: 0.8 })), { vol: 0.7, rev: 0.25 }),
      part('crash', cat(rest(48), drum('x')), { vol: 0.6 }),
      part('kick', cat(rest(48), drum('x..x.....x.x.x..')), { vol: 0.9 })
    ], { next: 'introLoop' });
    var PL = prog('F#m | D:2 E:2');
    var introLoop = section(2, [
      part('dbass', H.bossRiff(PL, { lo: 30 }), { vol: 0.85 }),
      part('trem', pad(PL, { lo: 54, hi: 70, n: 3 }), { vol: 0.5, rev: 0.4 }),
      part('kick', rep(drum('x...x...x...x...'), 2), { vol: 0.8 }),
      part('hat', rep(drum('..x...x...x...x.'), 2), { vol: 0.4 }),
      part('timp', rep(drum('x.......x.......', { m: 42 }), 2), { vol: 0.5 })
    ], { next: 'introLoop' });

    function fightParts(P, leadEvs, leadInst, leadOpt, crashBars) {
      var n = P.len / 16;
      var ps = [
        // base: always on (the harmony)
        part('strings', pad(P, { lo: 54, hi: 73 }), { vol: 0.4, rev: 0.4 }),
        // groove
        part('dbass', H.bossRiff(P, { lo: 30 }), { vol: 0.85, layer: 'groove' }),
        part('kick', rep(drum('x..x....x.x..x..'), n), { vol: 0.95, layer: 'groove' }),
        part('snare', cat(rep(drum('....x.......x...'), n - 1), drum('....x.......xxxx')), { vol: 0.75, rev: 0.12, layer: 'groove' }),
        part('hat', rep(drum('x.x.x.x.x.x.x.x.'), n), { vol: 0.5, layer: 'groove' }),
        part('crash', cat.apply(null, crashBars.map(function (c) { return c ? cat(drum('x'), rest(15)) : rest(16); })), { vol: 0.55, rev: 0.2, layer: 'groove' }),
        // riff guitar: palm-muted chugs with the Guards' rhythm accented
        part('gtr', chug(P, 'Xxxx xxxx xXxX xXxx', { lo: 42, st: 0.45, v: 0.5 }), { vol: 0.7, drive: 4.5, tone: 2000, layer: 'riff', pan: -0.35, hum: 0.002, power: true, lite: false }),
        part('gtr', chug(P, BOSS_RHYTHM, { lo: 42, st: 0.9, v: 0.75 }), { vol: 0.85, drive: 4.5, tone: 2200, layer: 'riff', pan: 0.35, name: 'riffR', power: true }),
        // lead
        part(leadInst, leadEvs, Object.assign({ vol: 1.0, rev: 0.25, dly: 0.12, layer: 'lead', name: 'lead' }, leadOpt || {})),
        // attack: extra percussion + brass stabs on the Guards' rhythm
        part('brass', comp(P, BOSS_RHYTHM, { lo: 61, hi: 78, n: 3, st: 0.7, v: 0.8 }), { vol: 0.6, rev: 0.25, layer: 'attack' }),
        part('tom', rep(drum('....xx.x....x.xx', { ms: [45, 45, 41, 41, 38, 45, 41, 38] }), n), { vol: 0.6, rev: 0.15, layer: 'attack' }),
        part('ohat', rep(drum('..x...x...x...x.'), n), { vol: 0.45, layer: 'attack' }),
        // per-attack colours
        part('chip', arp(P, '2 . 1 . 2 . 0 . 2 . 1 . 3 . 1 .', { lo: 66, hi: 85, n: 4, u: 1 }), { vol: 0.5, duty: 0.125, layer: 'atk_bullets', pan: 0.3, gap: 0.04 }),
        part('celesta', arp(P, "0 1 2 3 2 1 3 2", { lo: 78, hi: 96, n: 4, u: 1 }), { vol: 0.5, layer: 'atk_icicles', rev: 0.4 }),
        part('taiko', rep(drum('x.....x...x.....'), n), { vol: 0.8, layer: 'atk_bombs', rev: 0.25 }),
        part('anvil', rep(drum(BOSS_RHYTHM.toLowerCase(), { m: 78 }), n), { vol: 0.6, layer: 'atk_spikes', rev: 0.25 }),
        // the opening while the boss is tired: the dash cell rings out, nothing else moving
        part('bell', rep(mel(k, "1:1 2:1 3:2 .:4 .:8", { oct: 2, v: 0.6 }), n), { vol: 0.6, layer: 'vuln', rev: 0.5 }),
        part('harp', arp(P, "0 1 2 3 . . . . . . . . . . . .", { lo: 66, hi: 84, n: 4, u: 1 }), { vol: 0.55, layer: 'vuln', rev: 0.45 }),
        // second and third Guards
        part('stac', arp(P, '0 1 2 1 0 1 2 1 0 1 2 1 0 1 2 1', { lo: 54, hi: 70, n: 3, u: 1 }), { vol: 0.5, layer: 'emerald', pan: 0.25, lite: false }),
        part('choir', pad(P, { lo: 57, hi: 74, n: 3 }), { vol: 0.55, layer: 'ruby', rev: 0.5 }),
        part('hat', rep(drum('.x.x.x.x.x.x.x.x', { v: 0.5 }), n), { vol: 0.45, layer: 'ruby', name: 'hat16', lite: false })
      ];
      return ps;
    }
    // A: the Dash motif in F# minor against the Guards' riff
    var PA = prog('F#m | D:2 E:2 | F#m | D:2 E:1 F#m:1 | Bm:2 D:2 | E:2 A:2 | Bm:3 C#7:1 | C#7');
    var leadA = bars(DASH1, DASH2, DASH1,
      '1:2 1:1 6,:2 .:1 6,:2 7,:1 .:1 1:1 2:1 3:4',
      "4:2 5:1 6:2 .:1 5:2 6:1 7:2 .:1 6:1 7:1 1':2",
      "1':4 7:2 6:2 5:4 6:2 7:2",
      "1':6 7:2 6:4 5:4",
      '5:6 4:2 3:2 2:2 #7,:4');
    var A = section(8, fightParts(PA, mel(k, leadA, { oct: 1, v: 0.85 }), 'gtr', {}, [1, 0, 0, 0, 1, 0, 0, 0]), { next: 'B' });
    // B: a heroic brass tune: the motif's "dash" cell stretched out (augmented) and climbing
    var PB = prog('D | E | C#m | F#m | D | E | Bm7 | C#7');
    var leadB = bars('6,:4 7,:2 1:10', '7,:4 1:2 2:10', '2:4 3:2 4:10', '3:6 2:2 1:8',
      '6,:4 7,:2 1:4 3:2 5:4', '7,:4 1:2 2:4 4:2 6:4', "1':6 7:2 6:4 4:4", '5:12 .:4');
    var B = section(8, fightParts(PB, mel(k, leadB, { oct: 1, v: 0.9 }), 'brass', { vol: 0.95 }, [1, 0, 0, 0, 1, 0, 0, 0]).concat([
      part('horn', mel(k, shiftDeg(leadB, -2), { oct: 1, v: 0.7 }), { vol: 0.55, rev: 0.3, layer: 'lead', pan: -0.2 })
    ]), { next: 'A' });
    // end: the Guard falls. One big hit, then a ringing F# major chord (the hero's light breaks through)
    var end = section(2, [
      part('hit', cat(drum('x', { m: 54 }), rest(31)), { vol: 0.8 }),
      part('brass', mel(k, '[1,#3,5]:24 .:8', { oct: 1 }), { vol: 0.6, rev: 0.5 }),
      part('strings', mel(k, "[1,5,1',#3']:30 .:2"), { vol: 0.5, rev: 0.5 }),
      part('timp', crescendo(drum('x.x.x.x.xxxxxxxxx.......', { m: 42 }), 1, 0.2), { vol: 0.6, rev: 0.4 }),
      part('sub', mel(k, '1,:28'), { vol: 0.6 })
    ], { next: null });

    return song(name, {
      bpm: bpm, start: 'intro', gain: 0.92,
      sections: { intro: intro, introLoop: introLoop, A: A, B: B, end: end },
      layers: { base: 1, groove: 1, riff: 1, lead: 1, attack: 0, vuln: 0, atk_bullets: 0, atk_icicles: 0, atk_bombs: 0, atk_spikes: 0, emerald: tier >= 2 ? 1 : 0, ruby: tier >= 3 ? 1 : 0 },
      react: bossReact(k)
    });
  }
  // shared by the Guards and the Parkour Master: boss state -> layers
  function bossReact(k, extra) {
    return function (st, old, P) {
      var b = st.boss || '';
      if (b === 'dead') { if (old.boss !== 'dead') P.go('end', 'beat', 0.12); return; }
      if (b && b !== 'intro' && P.secName.indexOf('intro') === 0) P.go(P.song.firstFight || 'A', 'bar');
      var vul = b === 'vulnerable', atk = b === 'attack';
      // (layers come in sharply on the beat and fade out a little more gently)
      P.setLayer('groove', vul ? 0 : 1, 'beat', vul ? 0.12 : 0.02);
      P.setLayer('riff', vul ? 0 : 1, 'beat', vul ? 0.15 : 0.02);
      P.setLayer('lead', vul ? 0 : 1, 'beat', vul ? 0.3 : 0.04);
      P.setLayer('vuln', vul ? 1 : 0, 'beat', vul ? 0.03 : 0.25);
      P.setLayer('attack', atk ? 1 : 0, 'beat', atk ? 0.03 : 0.2);
      ['bullets', 'icicles', 'bombs', 'spikes', 'laser', 'fall', 'decay', 'poison'].forEach(function (a) {
        var on = atk && st.atk === a;
        P.setLayer('atk_' + a, on ? 1 : 0, 'beat', on ? 0.04 : 0.25);
      });
      // coming out of the opening: a crash on the beat as the band slams back in
      if (old.boss === 'vulnerable' && b !== 'vulnerable') { P.hit('crash', 0, 1, 'beat'); P.hit('kick', 0, 1, 'beat'); }
      // dive: a riser through the wind-up, then a timpani + cymbal strike on the dive itself
      if (st.atk === 'dive' && st.atkPhase === 'charge' && old.atkPhase !== 'charge') {
        var secs = Math.max(0.5, (st.chargeLeft || 3.6));
        P.hit('riser', 54, 0.9, '16th', secs / P.sd);
      }
      if (st.atkPhase === 'strike' && old.atkPhase === 'charge') {
        P.hit('timp', 42, 1, '16th'); P.hit('crash', 0, 1, '16th'); P.hit('boom', 0, 0.6, '16th');
      }
      if (extra) extra(st, old, P);
    };
  }
  window.DASH_BOSS_REACT = bossReact;
  guardSong('guard1', 1, 164);
  guardSong('guard2', 2, 168);
  guardSong('guard3', 3, 172);

  H.guardSong = guardSong;

  /* ================================================================
     Shared by the second half of the soundtrack
     ================================================================ */
  // The Area X figure (Master X's motif): C - Db - G - F#. The dash cell's first rising
  // step squeezed into a half step, then the tritone the Guards' motif already hinted at
  // (its F# against C). Always written for a minor or major key (b2 = a half step up).
  var XFIG = '1:4 b2:4 5:4 #4:4';
  window.DASH_MOTIFS.XFIG = XFIG;
  H.XFIG = XFIG;
  // the X figure as a bass ostinato on every chord root: root, +1, +7, +6 (8ths)
  function xOst(P, o) {
    o = o || {};
    var lo = o.lo || 36, u = o.u || 2, evs = [], offs = o.offs || [0, 1, 7, 6];
    for (var pos = 0, i = 0; pos < P.len; pos += u, i++) {
      var r = bassPitch(chordAt(P, pos), lo);
      evs.push([pos, u * (o.hold || 0.9), r + offs[i % offs.length], (o.v || 0.8) * (i % 4 === 0 ? 1.12 : 1)]);
    }
    evs.len = P.len;
    return evs;
  }
  function from(evs, step) { var out = evs.filter(function (e) { return e[0] >= step; }); out.len = evs.len; return out; }
  function upTo(evs, step) { var out = evs.filter(function (e) { return e[0] < step; }); out.len = evs.len; return out; }
  function fit(evs, L, what) { if (evs.len !== L) warn((what || 'a part') + ' is ' + evs.len + ' steps, the scene is ' + L); return evs; }
  H.xOst = xOst; H.from = from; H.upTo = upTo;

  // Cutscene cues. One section per scene of the cutscene, each sized from the scene's
  // frame times (60 frames a second) in whole beats. The game sends the cutscene clock
  // (state.cf, in frames); if the music is behind the picture (it started late, or the
  // game ran ahead) it jumps forward to the right scene on the next beat. It never
  // jumps backwards, and after the last scene it holds a quiet loop.
  function cueSong(name, o) {
    where = name;
    var fpb = 3600 / o.bpm, order = [], secs = {}, at = [];
    o.scenes.forEach(function (sc, i) {
      var nx = o.scenes[i + 1];
      var b0 = Math.round(sc.at / fpb), b1 = nx ? Math.round(nx.at / fpb) : b0 + sc.beats;
      var beatsN = Math.max(1, b1 - b0), L = beatsN * 4;
      var parts = sc.parts(L).filter(Boolean);
      parts.forEach(function (p) { // a scene's parts play once (no looping) unless asked
        if (!p.loop && p.events.len < L) p.events = cat(p.events, rest(L - p.events.len));
      });
      secs[sc.name] = section(beatsN, parts, { next: nx ? nx.name : (o.hold ? 'hold' : null) });
      order.push(sc.name); at.push(sc.at);
    });
    if (o.hold) secs.hold = section(o.holdBeats || 4, o.hold(), { next: 'hold' });
    return song(name, {
      bpm: o.bpm, bpb: 1, start: order[0], sections: secs, gain: o.gain || 0.9, cue: true, sceneAt: at,
      react: function (st, old, P) {
        if (o.cut && st.cut !== o.cut) return;
        var cf = st.cf || 0, want = 0;
        for (var i = 0; i < at.length; i++) if (cf >= at[i]) want = i;
        var cur = P.secName === 'hold' ? order.length : order.indexOf(P.secName);
        var pend = P.pending ? order.indexOf(P.pending.name) : -1;
        if (want > cur && want > pend) P.go(order[want], 'bar', 0.25);
      }
    });
  }
  H.cueSong = cueSong;

  /* ================================================================
     3. AREA 2: B minor -> D major, 150 BPM. More tense: the Adventure
        Tune from Area 1 turns minor over a 16th-note string ostinato,
        then the sun breaks through (the tune back in major). The B
        section throws the Dash motif around in a stretto (canon).
     ================================================================ */
  (function () {
    var k = K('B3', 'minor'), kD = K('D4', 'major');
    var drive = function (n, fill) {
      return [
        part('kick', rep(drum('x..x..x.x.x.....'), n), { vol: 0.85 }),
        part('snare', cat(rep(drum('....x.......x...'), n - 1), drum(fill ? '....x...x.x.xxxx' : '....x.......x...', { v: 0.75 })), { vol: 0.6, rev: 0.14 }),
        part('hat', rep(drum('xoxoxoxoxoxoxoxo'), n), { vol: 0.45 })
      ];
    };
    // intro: the ostinato starts, the dash cell flickers on marimba, drums gather
    var PI = prog('Bm | G | Em | F#');
    var intro = section(4, [
      part('stac', arp(PI, '0 1 2 1', { lo: 54, hi: 71, n: 3, u: 1 }), { vol: 0.4, rev: 0.25 }),
      part('marimba', rep(mel(k, '1:1 2:1 3:2 .:12', { oct: 1, v: 0.7 }), 4), { vol: 0.55, rev: 0.3, pan: 0.3 }),
      part('pbass', bass(PI, 'R.......R...R...', { lo: 35 }), { vol: 0.85 }),
      part('strings', pad(PI, { lo: 54, hi: 71 }), { vol: 0.22, rev: 0.45 }),
      part('kick', cat(rest(32), rep(drum('x...x...x...x...'), 2)), { vol: 0.7 }),
      part('timp', cat(rest(32), drum('x...............x.......x.x.x.x.', { m: 47 })), { vol: 0.5, rev: 0.3 }),
      part('snare', cat(rest(48), crescendo(drum('oooooooooooooooo'), 0.3, 1.1)), { vol: 0.55 }),
      part('flute', mel(k, bars('.:16', '.:16', '.:16', '.:10 5,:2 6,:2 7,:2'), { oct: 1 }), { vol: 0.9, rev: 0.3 })
    ], { next: 'A' });

    // A: the Adventure Tune in B minor (flute, with pizzicato an octave down for bite)
    var PA = prog('Bm | A:2 G:2 | Bm:2 Em:2 | F#7 | Bm | A:2 Em:2 | G:2 A:2 | Bm:2 G:1 A:1');
    var tune = ADV.join(' | ');
    var A = section(8, [
      part('flute', mel(k, tune, { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.28, dly: 0.08, name: 'lead' }),
      part('pizz', mel(k, tune, { oct: 0, v: 0.6 }), { vol: 0.45, rev: 0.2, pan: -0.2 }),
      part('stac', arp(PA, '0 1 2 1', { lo: 54, hi: 71, n: 3, u: 1 }), { vol: 0.38, rev: 0.25, pan: 0.25 }),
      part('strings', pad(PA, { lo: 54, hi: 71 }), { vol: 0.2, rev: 0.45 }),
      part('pbass', bass(PA, 'R.RR.RR.R.RR.R5a', { lo: 35 }), { vol: 0.95 }),
      part('crash', cat(drum('x'), rest(127)), { vol: 0.5, rev: 0.2 })
    ].concat(drive(8, true)), { next: 'A2' });

    // A2: the sun breaks through: the same tune in D major (Area 1's harmony), horns sing
    // Area 1's countermelody, glockenspiel on top
    var PA2 = prog('D | Bm | D:2 G:2 | A7 | D | Em7:2 A:2 | G:2 A:2 | D:2 Bm:1 F#:1');
    var A2 = section(8, [
      part('flute', mel(kD, tune, { oct: 1, v: 0.85 }), { vol: 1.0, rev: 0.3, dly: 0.08, name: 'lead' }),
      part('glock', mel(kD, tune, { oct: 2, v: 0.55 }), { vol: 0.5, rev: 0.35, pan: 0.2 }),
      part('horn', mel(kD, bars('3:16', '3:8 1:8', '3:8 4:8', '5:8 #4:4 5:4', '3:16', '4:8 5:8', '4:8 3:8', '3:12 .:4')), { vol: 0.55, rev: 0.4, pan: -0.2 }),
      part('harp', arp(PA2, '0 1 2 3 4 3 2 1', { lo: 62, hi: 86, n: 5, u: 1 }), { vol: 0.32, rev: 0.3, pan: -0.3 }),
      part('strings', pad(PA2, { lo: 54, hi: 74 }), { vol: 0.24, rev: 0.45 }),
      part('pbass', bass(PA2, 'R-.5-.R.R-.5-.8a', { lo: 38 }), { vol: 0.95 }),
      part('tamb', rep(drum('....x.......x...'), 8), { vol: 0.3 })
    ].concat(drive(8, true)), { next: 'B' });

    // B: the Dash motif in stretto: the Dash guitar leads, the glockenspiel follows a bar behind
    var PB = prog('Bm | G:2 A:2 | Bm | G:2 A:2 | Em | F#7 | G:2 A:2 | F#7');
    var lead = bars(DASH1, DASH2, DASH1, DASH2, shiftDeg(DASH1, 3), '5:4 4:2 3:2 2:4 #7,:4',
      "6:2 5:1 6:2 .:1 7:2 6:1 7:2 .:1 1':4", '#7:8 .:4 5:4');
    var follow = bars('.:16', DASH1, DASH2, DASH1, shiftDeg(DASH2, 3), '.:16', '.:12 1:1 2:1 3:2', '.:16');
    var B = section(8, [
      part('gtr', mel(k, lead, { oct: 1, v: 0.85 }), { vol: 0.95, rev: 0.22, dly: 0.12, name: 'lead' }),
      part('glock', mel(k, follow, { oct: 2, v: 0.6 }), { vol: 0.55, rev: 0.35, pan: 0.3 }),
      part('marimba', mel(k, follow, { oct: 1, v: 0.5 }), { vol: 0.4, rev: 0.25, pan: 0.3 }),
      part('stac', arp(PB, '0 1 2 1', { lo: 54, hi: 71, n: 3, u: 1 }), { vol: 0.36, rev: 0.25, pan: -0.25 }),
      part('strings', pad(PB, { lo: 54, hi: 71 }), { vol: 0.22, rev: 0.45 }),
      part('pbass', bass(PB, 'R-.R-.R.R-.R-.5a', { lo: 35 }), { vol: 0.9 }),
      part('tom', rep(drum('............x.xx', { ms: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 47, 43] }), 8), { vol: 0.5, rev: 0.15 }),
      part('crash', cat(drum('x'), rest(63), drum('x'), rest(63)), { vol: 0.5, rev: 0.2 })
    ].concat(drive(8, false)), { next: 'C' });

    // C: the bass climbs by half steps (G G# A A#) to throw us back into the tune
    var PC = prog('G | G#dim7 | A | A#dim7');
    var C = section(4, [
      part('brass', mel(k, 'D5:16 | D5:16 | C#5:8 E5:8 | E5:8 G5:8'), { vol: 0.75, rev: 0.3 }),
      part('horn', mel(k, 'B4:16 | B4:16 | A4:16 | A#4:8 C#5:8'), { vol: 0.55, rev: 0.35 }),
      part('gtr', rep(mel(k, '1:1 2:1 3:2 .:4 1:1 2:1 3:2 .:4', { oct: 1, v: 0.7 }), 4), { vol: 0.6, rev: 0.25, dly: 0.2, pan: 0.2 }),
      part('stac', arp(PC, '0 1 2 1', { lo: 55, hi: 72, n: 3, u: 1 }), { vol: 0.4 }),
      part('pbass', bass(PC, 'R.R.R.R.R.R.R.R.', { lo: 31 }), { vol: 0.9 }),
      part('timp', cat(drum('x.......x.......', { m: 43 }), drum('x.......x.......', { m: 44 }), drum('x.......x.......', { m: 45 }), drum('x...x...x.x.xxxx', { m: 46 })), { vol: 0.55, rev: 0.3 }),
      part('kick', rep(drum('x...x...x...x...'), 4), { vol: 0.8 }),
      part('snare', cat(rest(32), crescendo(drum('x.x.x.x.x.x.x.x.xxxxxxxxxxxxxxxx'), 0.4, 1.15)), { vol: 0.6 }),
      part('swell', cat(rest(48), drum('x', { u: 16 })), { vol: 0.55 })
    ], { next: 'A' });

    song('area2', { bpm: 150, start: 'intro', sections: { intro: intro, A: A, A2: A2, B: B, C: C }, gain: 0.93 });
  })();

  /* ================================================================
     4. AREA 3: D minor, 128 BPM. Cinematic and dramatic: big drums, a
        string ostinato, the Dash motif on brass. It feels like the end
        of the journey, but every phrase stops on the dominant (A) and
        never comes home. The B section borrows Area X's chords (i bVI
        iv V, the "cold empty halls" progression) and the X figure.
     ================================================================ */
  (function () {
    var k = K('D4', 'minor');
    var beat = function (n, crashes) {
      return [
        part('taiko', rep(drum('x.....x...x.....'), n), { vol: 0.75, rev: 0.25 }),
        part('kick', rep(drum('x.....x.x.......'), n), { vol: 0.8 }),
        part('snare', cat(rep(drum('....x.......x...'), n - 1), drum('....x.......xxxx', { v: 0.7 })), { vol: 0.6, rev: 0.18 }),
        part('hat', rep(drum('x.x.x.x.x.x.x.x.', { v: 0.6 }), n), { vol: 0.4 }),
        crashes ? part('crash', cat(drum('x'), rest(63), drum('x'), rest(63)), { vol: 0.55, rev: 0.25 }) : null
      ];
    };
    // intro: the dash cell stretched to twice its length on horns over a D drone
    var PI = prog('Dm | Dm | Bb | A');
    var intro = section(4, [
      part('horn', mel(k, bars('1:4 2:2 3:4 .:6', '4:4 3:2 2:2 3:2 2:4 .:2', '6:16', '5:16')), { vol: 0.85, rev: 0.45 }),
      part('ooh', pad(PI, { lo: 57, hi: 72, n: 3 }), { vol: 0.4, rev: 0.6 }),
      part('trem', pad(PI, { lo: 50, hi: 62, n: 2 }), { vol: 0.45, rev: 0.4 }),
      part('drone', mel(k, bars('1,,:16', '1,,:16', '6,,,:16', '5,,,:16')), { vol: 0.6 }),
      part('timp', cat(drum('x...............|................', { m: 38 }), crescendo(drum('x.x.x.x.x.x.x.x.xxxxxxxxxxxxxxxx', { m: 38 }), 0.3, 1)), { vol: 0.55, rev: 0.35 }),
      part('taiko', cat(rest(32), drum('x.......x.......x...x...x.x.x.x.')), { vol: 0.7, rev: 0.3 }),
      part('swell', cat(rest(48), drum('x', { u: 16 })), { vol: 0.5 })
    ], { next: 'A' });

    // A: the Dash motif on brass (a third below on horns), soaring to a climax that stops on A
    var PA = prog('Dm | Bb:2 C:2 | F:2 Gm:2 | A7 | Gm:2 Bb:2 | C:2 A7:2 | Bb:2 Gm:2 | A7sus4:2 A7:2');
    var leadA = bars(DASH1, DASH2, shiftDeg(DASH1, 2), '5:4 4:2 3:2 2:6 .:2',
      "5:2 6:1 7:3 1':8 .:2", "2':2 1':1 7:3 6:2 5:4 .:4", '6:2 5:1 4:3 3:2 4:2 5:2 6:4', '5:12 .:4');
    var fullA = function (choirAll) {
      return [
        part('brass', mel(k, leadA, { v: 0.85 }), { vol: 0.95, rev: 0.3, name: 'lead' }),
        part('horn', mel(k, shiftDeg(leadA, -2), { v: 0.65 }), { vol: 0.5, rev: 0.35, pan: -0.2 }),
        part('strings', mel(k, leadA, { oct: 1, v: 0.6 }), { vol: 0.3, rev: 0.4, pan: 0.2 }),
        part('stac', arp(PA, '0 2 1 2', { lo: 50, hi: 69, n: 3, u: 2 }), { vol: 0.45, rev: 0.25 }),
        part('pbass', bass(PA, 'R..R..R.R..R..R.', { lo: 38 }), { vol: 0.95 }),
        part('choir', choirAll ? pad(PA, { lo: 57, hi: 74, n: 3 }) : from(pad(PA, { lo: 57, hi: 74, n: 3 }), 64), { vol: 0.42, rev: 0.55 }),
        choirAll ? part('glock', from(arp(PA, '0 . 2 . 1 . 3 .', { lo: 74, hi: 90, n: 4, u: 2 }), 64), { vol: 0.3, rev: 0.4, pan: 0.35 }) : null,
        part('timp', rep(drum('x...............', { m: 38 }), 8), { vol: 0.45, rev: 0.3 })
      ].concat(beat(8, true));
    };
    var A = section(8, fullA(false), { next: 'B' });
    var A2 = section(8, fullA(true), { next: 'bridge' });

    // B: the dark hall. Area X's chord loop, the X figure in the low strings, cold bells
    // with the dash cell; then the brass take the motif back, louder
    var PB = prog('Dm | Bb:2 C:2 | Gm | A | Dm | Bb:2 C:2 | Gm | A7');
    var B = section(8, [
      part('trem', mel(k, bars(XFIG, '.:16', '.:16', '.:16', XFIG, '.:16', '.:16', '.:16'), { oct: -1 }), { vol: 0.6, rev: 0.4 }),
      part('dpad', pad(PB, { lo: 50, hi: 65, n: 3 }), { vol: 0.4, rev: 0.6 }),
      part('bell', mel(k, bars('.:16', "3':4 2':2 1':10", '.:16', "2':4 1':2 #7:10", '.:16', '.:16', '.:16', '.:16')), { vol: 0.55, rev: 0.6, dly: 0.25 }),
      part('brass', mel(k, bars('.:16', '.:16', '.:16', '.:16', DASH1, DASH2, shiftDeg(DASH1, 4), '#7:4 6:2 5:2 4:2 3:2 2:2 #7,:2')), { vol: 0.9, rev: 0.3, name: 'lead' }),
      part('horn', mel(k, bars('.:16', '.:16', '.:16', '.:16', '1:16', '1:8 3:8', '2:16', '#7,:16')), { vol: 0.5, rev: 0.4 }),
      part('pbass', bass(PB, 'R-------R-------', { lo: 38 }), { vol: 0.8 }),
      part('taiko', cat(rep(drum('x...............'), 4), rep(drum('x.....x...x.....'), 4)), { vol: 0.7, rev: 0.3 }),
      part('kick', cat(rest(64), rep(drum('x.....x.x.......'), 4)), { vol: 0.8 }),
      part('snare', cat(rest(48), crescendo(drum('oooooooooooooooo'), 0.3, 1), rep(drum('....x.......x...'), 3), drum('....x...xxxxxxxx', { v: 0.7 })), { vol: 0.6, rev: 0.18 }),
      part('crash', cat(rest(64), drum('x'), rest(63)), { vol: 0.55, rev: 0.25 })
    ], { next: 'A2' });

    // bridge: Bb, C, then Eb (the flat second, Area X's colour) and the dominant again
    var PBr = prog('Bb | C | Eb | A7');
    var bridge = section(4, [
      part('brass', mel(k, 'F5:16 | G5:16 | G5:8 Bb5:8 | A5:16'), { vol: 0.85, rev: 0.35 }),
      part('horn', mel(k, 'D5:16 | E5:16 | Eb5:16 | C#5:8 E5:8'), { vol: 0.6, rev: 0.4 }),
      part('choir', pad(PBr, { lo: 57, hi: 74, n: 3 }), { vol: 0.5, rev: 0.55 }),
      part('stac', arp(PBr, '0 1 2 1', { lo: 50, hi: 69, n: 3, u: 1 }), { vol: 0.42 }),
      part('pbass', bass(PBr, 'R.R.R.R.R.R.R.R.', { lo: 34 }), { vol: 0.9 }),
      part('timp', cat(drum('x.......x.......', { m: 46 }), drum('x.......x.......', { m: 48 }), drum('x.......x.......', { m: 39 }), drum('x...x...x.x.xxxx', { m: 45 })), { vol: 0.6, rev: 0.3 }),
      part('taiko', rep(drum('x.......x.......'), 4), { vol: 0.75, rev: 0.3 }),
      part('snare', cat(rest(32), crescendo(drum('x.x.x.x.x.x.x.x.xxxxxxxxxxxxxxxx'), 0.4, 1.2)), { vol: 0.6 }),
      part('crash', cat(drum('x'), rest(63)), { vol: 0.55, rev: 0.25 }),
      part('swell', cat(rest(48), drum('x', { u: 16 })), { vol: 0.55 })
    ], { next: 'A' });

    song('area3', { bpm: 128, start: 'intro', sections: { intro: intro, A: A, B: B, A2: A2, bridge: bridge }, gain: 0.92 });
  })();

  /* ================================================================
     5. AREA X: C Phrygian, 72 BPM. Dark and mysterious, built like
        Maze Man 2's "cold empty halls" (a low C drone, a slow minor
        pad, a few cold bells far apart). The bells play the Dash motif
        twice as slow in Phrygian (C Db Eb: the darkest version of it),
        and the choir sings the X figure (C Db G F#).
     ================================================================ */
  (function () {
    var k = K('C4', 'phrygian'), kx = K('C4', 'minor');
    // intro: drone, wind, the X figure on bells one note at a time
    var intro = section(4, [
      part('drone', mel(k, '1,,:64'), { vol: 0.85 }),
      part('bell', mel(kx, bars('1:8 b2:8', '5:8 #4:8', '.:16', '.:16'), { oct: 1, v: 0.7 }), { vol: 0.6, rev: 0.7, dly: 0.3 }),
      part('dpad', mel(k, '.:16 | .:16 | [C3,G3,Eb4]:32'), { vol: 0.5, rev: 0.6 }),
      part('swell', cat(drum('x', { u: 24 }), rest(40)), { vol: 0.35 }),
      part('celesta', mel(k, bars('.:16', '.:16', '.:8 5:4 3:4', '.:16'), { oct: 1, v: 0.45 }), { vol: 0.35, rev: 0.7 })
    ], { next: 'A' });

    // A: the hall. C minor - Ab - F minor - Db; the motif slowed down on bells, in Phrygian
    var PA = prog('Cm | Ab | Fm | Db | Cm | Ab | Fm:2 Db:2 | G');
    var bellA = bars('1:4 2:2 3:4 .:6', '4:4 3:2 2:2 3:2 2:4 .:2', '1:4 1:2 6,:4 .:2 6,:4', '2:2 .:2 1:2 2:2 3:4 .:2 2:2',
      '.:16', '.:16', '.:8 5:2 6:2 5:4', '.:16');
    var A = section(8, [
      part('drone', bass(PA, 'R---------------', { lo: 36 }), { vol: 0.65 }),
      part('dpad', pad(PA, { lo: 51, hi: 67, n: 3 }), { vol: 0.36, rev: 0.6 }),
      part('bell', mel(k, bellA, { oct: 1, v: 0.7 }), { vol: 0.75, rev: 0.7, dly: 0.25, name: 'lead' }),
      part('ooh', mel(kx, bars('.:16', '.:16', '.:16', '.:16', '1:8 b2:8', '5:8 #4:8', '.:16', '#7,:16')), { vol: 0.5, rev: 0.65 }),
      part('pizz', rep(mel(k, '1,:2 .:6 5,,:2 .:6', { v: 0.5 }), 8), { vol: 0.35, rev: 0.4 }),
      part('sub', bass(PA, 'R---------------', { lo: 24 }), { vol: 0.35 })
    ], { next: 'B' });

    // B: deeper in. The drone slides C -> Db (like Maze Man 2's maze), a slow heartbeat,
    // a clock ticking somewhere, and the motif's drop and climb cells on a cold music box
    var PB = prog('Cm | Cm | Db | Db | Bbm | Bbm | Gsus4 | G');
    var A2bell = bellA;
    var B = section(8, [
      part('drone', bass(PB, 'R---------------', { lo: 36 }), { vol: 0.65 }),
      part('dpad', pad(PB, { lo: 51, hi: 67, n: 3 }), { vol: 0.34, rev: 0.6 }),
      part('ooh', mel(k, 'Eb4:32 F4:32 F4:32 D4:32'), { vol: 0.4, rev: 0.65 }),
      part('musicbox', mel(k, bars(".:8 1':2 1':1 6:2 .:3", '.:16', ".:8 2':1 .:1 1':1 2':1 3':2 .:1 2':1", '.:16',
        "4':2 4':1 2':2 .:3 .:8", '.:16', ".:8 5:4 1':4", 'B4:8 .:8'), { v: 0.6 }), { vol: 0.62, rev: 0.65, dly: 0.3, name: 'lead' }),
      part('kick', rep(drum('x..x............', { v: 0.6 }), 8), { vol: 0.5 }),
      part('rim', rep(drum('x...x...x...x...', { v: 0.5 }), 8), { vol: 0.22, rev: 0.5 }),
      part('sub', bass(PB, 'R---------------', { lo: 24 }), { vol: 0.35 })
    ], { next: 'A2' });

    // A2: the hall again, colder: strings tremble, the celesta doubles the bells,
    // a far-away taiko on each bar
    var A2 = section(8, [
      part('drone', bass(PA, 'R---------------', { lo: 36 }), { vol: 0.65 }),
      part('dpad', pad(PA, { lo: 51, hi: 67, n: 3 }), { vol: 0.34, rev: 0.6 }),
      part('trem', pad(PA, { lo: 60, hi: 75, n: 3 }), { vol: 0.25, rev: 0.6 }),
      part('bell', mel(k, A2bell, { oct: 1, v: 0.7 }), { vol: 0.75, rev: 0.7, dly: 0.25, name: 'lead' }),
      part('celesta', mel(k, A2bell, { oct: 2, v: 0.4 }), { vol: 0.3, rev: 0.7 }),
      part('ooh', mel(kx, bars('.:16', '.:16', '.:16', '.:16', '1:8 b2:8', '5:8 #4:8', '.:16', '#7,:16')), { vol: 0.5, rev: 0.65 }),
      part('taiko', rep(drum('x...............', { v: 0.6 }), 8), { vol: 0.5, rev: 0.6 }),
      part('sub', bass(PA, 'R---------------', { lo: 24 }), { vol: 0.35 })
    ], { next: 'A' });

    song('areaX', { bpm: 72, start: 'intro', sections: { intro: intro, A: A, B: B, A2: A2 }, gain: 0.95, fadeIn: 1.5 });
  })();

  /* ================================================================
     5b. ECH0 CHASE (X-3): Area X's music, twice as fast and anxious.
        C Phrygian, 144 BPM (double Area X, so its bell line and chord
        loop come back at a run). A racing double heartbeat, a ticking
        16th clock, the X figure as a pulsing bass ostinato and trembling
        strings. When ECH0 gets close (state.ech0 = 'near') a "close"
        layer adds taiko, snare and a high choir; it fades when you
        pull away.
     ================================================================ */
  (function () {
    var k = K('C4', 'phrygian'), kx = K('C4', 'minor');
    var PA = prog('Cm | Ab | Fm | Db | Cm | Ab | Fm:2 Db:2 | G');
    var PB = prog('Cm | Cm | Db | Db | Bbm | Bbm | Gsus4 | G');
    // Area X's bell line, unchanged: at double tempo it becomes a nervous run
    var bellA = bars('1:4 2:2 3:4 .:6', '4:4 3:2 2:2 3:2 2:4 .:2', '1:4 1:2 6,:4 .:2 6,:4', '2:2 .:2 1:2 2:2 3:4 .:2 2:2',
      '.:16', '.:16', '.:8 5:2 6:2 5:4', '.:16');
    var boxB = bars(".:8 1':2 1':1 6:2 .:3", '.:16', ".:8 2':1 .:1 1':1 2':1 3':2 .:1 2':1", '.:16',
      "4':2 4':1 2':2 .:3 .:8", '.:16', ".:8 5:4 1':4", 'B4:8 .:8');
    var oohX = bars('1:8 b2:8', '5:8 #4:8', '1:8 b2:8', '5:8 #4:8', '1:8 b2:8', '5:8 #4:8', '.:16', '#7,:16');
    function pulse(P, extra) { // the engine of every section
      var n = P.len / 16;
      return [
        part('drone', bass(P, 'R---------------', { lo: 36 }), { vol: 0.55 }),
        part('bass', xOst(P, { lo: 36, u: 2 }), { vol: 0.5, lp: 1400 }),
        part('sub', bass(P, 'R-------R-------', { lo: 24 }), { vol: 0.35 }),
        part('trem', pad(P, { lo: 55, hi: 70, n: 3 }), { vol: 0.28, rev: 0.5 }),
        part('stac', arp(P, '0 1 2 1', { lo: 60, hi: 75, n: 3, u: 1, v: 0.5 }), { vol: 0.22, pan: 0.3, lite: false }),
        part('kick', rep(drum('x..x....x..x....', { v: 0.75 }), n), { vol: 0.6 }),
        part('hat', rep(drum('xoxoxoxoxoxoxoxo', { v: 0.5 }), n), { vol: 0.25 }),
        part('rim', rep(drum('....x.......x...', { v: 0.55 }), n), { vol: 0.25, rev: 0.4 }),
        // close layer: ECH0 is right behind you
        part('taiko', rep(drum('x...x...x...x.x.', { v: 0.7 }), n), { vol: 0.5, rev: 0.4, layer: 'close' }),
        part('snare', rep(drum('....x.......x.xx', { v: 0.6 }), n), { vol: 0.35, layer: 'close' }),
        part('choir', pad(P, { lo: 67, hi: 82, n: 3 }), { vol: 0.25, rev: 0.6, layer: 'close' })
      ].concat(extra || []);
    }
    var intro = section(2, [
      part('drone', mel(k, '1,,:32'), { vol: 0.6 }),
      part('hat', rep(drum('xoxoxoxoxoxoxoxo', { v: 0.5 }), 2), { vol: 0.25 }),
      part('kick', cat(drum('x...............'), drum('x..x....x..x.x.x')), { vol: 0.6 }),
      part('bell', mel(kx, '1:4 b2:4 5:4 #4:4 | 1:4 b2:4 5:4 #4:4', { oct: 1, v: 0.7 }), { vol: 0.55, rev: 0.6, dly: 0.25 }),
      part('riser', drum('x', { u: 32 }), { vol: 0.4 })
    ], { next: 'A' });
    var A = section(8, pulse(PA, [
      part('bell', mel(k, bellA, { oct: 1, v: 0.75 }), { vol: 0.75, rev: 0.55, dly: 0.2, name: 'lead' }),
      part('ooh', mel(kx, oohX), { vol: 0.4, rev: 0.6 })
    ]), { next: 'B' });
    var B = section(8, pulse(PB, [
      part('musicbox', mel(k, boxB, { v: 0.65 }), { vol: 0.62, rev: 0.55, dly: 0.25, name: 'lead' }),
      part('ooh', mel(k, 'Eb4:32 F4:32 F4:32 D4:32'), { vol: 0.4, rev: 0.6 }),
      part('snare', crescendo(cat(rest(96), rep(drum('x.x.x.x.x.x.x.x.'), 1), drum('xxxxxxxxxxxxxxxx')), 0.3, 1.1), { vol: 0.4 })
    ]), { next: 'A2' });
    var A2 = section(8, pulse(PA, [
      part('bell', mel(k, bellA, { oct: 1, v: 0.75 }), { vol: 0.75, rev: 0.55, dly: 0.2, name: 'lead' }),
      part('celesta', mel(k, bellA, { oct: 2, v: 0.45 }), { vol: 0.3, rev: 0.6 }),
      part('ooh', mel(kx, oohX), { vol: 0.45, rev: 0.6 }),
      part('strings', mel(kx, bars('1:16', 'b2:16', '5,:16', '#4,:16', '1:16', 'b2:16', '5,:8 b6,:8', '#7,:16'), { oct: -1, v: 0.6 }), { vol: 0.35, rev: 0.4 }),
      part('crash', cat(drum('x'), rest(127)), { vol: 0.4, rev: 0.3 })
    ]), { next: 'A' });
    song('ech0', {
      bpm: 144, start: 'intro', sections: { intro: intro, A: A, B: B, A2: A2 }, gain: 0.9, fadeIn: 0.4,
      layers: { close: 0 },
      react: function (st, old, P) {
        var near = st.ech0 === 'near';
        if (near !== ((old || {}).ech0 === 'near')) P.setLayer('close', near ? 1 : 0, 'beat', near ? 0.05 : 1.5);
      }
    });
  })();

  /* ================================================================
     10. SHOP: B-flat major, 100 BPM, swung. Chill lounge: electric
         piano, vibraphone, upright bass, brushes. Its own tune; the
         Dash motif only slips in at the end of each phrase (vibes).
     ================================================================ */
  (function () {
    var k = K('Bb3', 'major');
    var kit = function (n) {
      return [
        part('brush', rep(drum('x.x.x.x.x.x.x.x.', { v: 0.7 }), n), { vol: 0.6 }),
        part('ride', rep(drum('x...x.x.x...x.x.', { v: 0.5 }), n), { vol: 0.35 }),
        part('kick', rep(drum('x.......x.......', { v: 0.6 }), n), { vol: 0.65 }),
        part('rim', rep(drum('....x.......x...', { v: 0.45 }), n), { vol: 0.35 })
      ];
    };
    var PI = prog('Bbmaj7 | F7');
    var intro = section(2, [
      part('epiano', comp(PI, 'x...........x...', { lo: 57, hi: 72, n: 4, st: 0.9 }), { vol: 0.6, rev: 0.3 }),
      part('ubass', bass(PI, 'R-------5-------', { lo: 34 }), { vol: 0.75 }),
      part('vibes', mel(k, '.:16 | .:10 3:2 2:2 1:2', { oct: 1, v: 0.6 }), { vol: 0.7, rev: 0.4 })
    ].concat(kit(2)), { next: 'A', swing: 0.33 });

    var PA = prog('Bbmaj7 | Gm7 | Cm7 | F7 | Dm7 | G7 | Cm7:2 F7:2 | Bbmaj7:2 F7:2');
    var tuneA = bars('.:2 3:2 5:2 7:6 6:2 5:2', '3:8 .:4 2:2 3:2', "4:2 6:2 1':6 7:2 6:2 4:2", '5:8 .:4 4:2 3:2',
      '3:2 5:2 7:6 6:2 5:2 3:2', '6:2 5:2 3:2 b2:6 .:4', '2:4 4:2 6:2 5:4 3:2 1:2', '.:16');
    var A = section(8, [
      part('vibes', mel(k, tuneA, { oct: 1, v: 0.75 }), { vol: 0.85, rev: 0.35, name: 'lead' }),
      // the Dash motif, quietly, as the phrase ends (bar 8)
      part('vibes', mel(k, bars('.:16', '.:16', '.:16', '.:16', '.:16', '.:16', '.:16', DASH1), { oct: 1, v: 0.5 }), { vol: 0.7, rev: 0.4, name: 'motif' }),
      part('epiano', comp(PA, 'x..x......x.....', { lo: 55, hi: 70, n: 4, st: 0.9 }), { vol: 0.5, rev: 0.3, pan: -0.25 }),
      part('ubass', bass(PA, 'R---3---5---a---', { lo: 34 }), { vol: 0.8 })
    ].concat(kit(8)), { next: 'B', swing: 0.33 });

    var PB = prog('Ebmaj7 | Ebm6 | Dm7 | Gm7 | Cm7 | F7 | Dm7:2 G7:2 | Cm7:2 F7:2');
    var B = section(8, [
      part('flute', mel(k, bars('5:6 6:2 5:8', 'b6:6 4:2 b6:8', '6:6 5:2 3:8', '3:8 .:4 2:2 3:2', '4:6 5:2 6:8', '7:4 6:4 5:8', '6:4 5:4 b2:8', '2:8 .:8'), { oct: 1, v: 0.6 }), { vol: 0.6, rev: 0.45, dly: 0.15, name: 'lead' }),
      part('vibes', mel(k, bars('.:16', '.:16', '.:16', '.:16', '.:16', '.:16', '.:16', DASH2), { oct: 1, v: 0.5 }), { vol: 0.7, rev: 0.4, name: 'motif' }),
      part('epiano', comp(PB, 'x.....x...x.....', { lo: 55, hi: 70, n: 4, st: 0.9 }), { vol: 0.5, rev: 0.3, pan: -0.25 }),
      part('ubass', bass(PB, 'R---3---5---a---', { lo: 34 }), { vol: 0.8 })
    ].concat(kit(8)), { next: 'A', swing: 0.33 });

    song('shop', { bpm: 100, start: 'intro', swing: 0.33, sections: { intro: intro, A: A, B: B }, gain: 1.0 });
  })();

  /* ================================================================
     7. FINAL BOSS STAGE 1 (the Parkour Master): C minor, 176 BPM.
        The Guards' theme a tritone away (F# -> C) and darker: an organ
        under the band, Area X's drone and bells in the intro, the Dash
        motif in Phrygian. Same dynamic layers as the Guards, with one
        colour per attack (laser, fall, decay, poison), and a "phase2"
        layer (choir, 16th hats, timpani) for waves 4 and 5.
     ================================================================ */
  (function () {
    var k = K('C4', 'minor'), kp = K('C4', 'phrygian');
    var intro = section(4, [
      part('drone', mel(k, bars('1,,:16', '1,,:16', '1,,:16', '.:16')), { vol: 0.8 }),
      part('organ', mel(k, '[C3,G3,C4]:16 | [C3,G3,Db4]:16 | [C3,Ab3,C4]:16 | .:16'), { vol: 0.55, rev: 0.45 }),
      part('bell', mel(k, bars('1:8 b2:8', '5:8 #4:8', '.:16', '.:16'), { oct: 1, v: 0.7 }), { vol: 0.55, rev: 0.6 }),
      part('timp', cat(crescendo(rep(drum('x.x.x.x.x.x.x.x.', { m: 36 }), 3), 0.3, 1), rest(16)), { vol: 0.65, rev: 0.3 }),
      part('snare', cat(rest(32), crescendo(drum('oooooooooooooooo'), 0.3, 1.1), rest(16)), { vol: 0.6 }),
      part('riser', cat(drum('x', { u: 48, m: 36 }), rest(16)), { vol: 0.5 }),
      part('dbass', cat(rest(48), mel(k, '1,:1 .:2 1,:1 .:5 1,:1 .:1 1,:1 .:1 1,:1 7,,:1 #7,,:1')), { vol: 0.9 }),
      part('gtr', cat(rest(48), mel(k, '[1,5]:1 .:2 [1,5]:1 .:5 [1,5]:1 .:1 [1,5]:1 .:1 [1,5]:1 7,:1 #7,:1', { st: 0.8 })), { vol: 0.8, drive: 5, tone: 2300 }),
      part('brass', cat(rest(48), comp(prog('Cm'), BOSS_RHYTHM, { lo: 60, hi: 76, n: 3, st: 0.8 })), { vol: 0.7, rev: 0.25 }),
      part('choir', cat(rest(48), mel(k, '[C4,Eb4,G4]:16')), { vol: 0.5, rev: 0.5 }),
      part('crash', cat(rest(48), drum('x'), rest(15)), { vol: 0.6 }),
      part('kick', cat(rest(48), drum('x..x.....x.x.x..')), { vol: 0.9 })
    ], { next: 'introLoop' });
    var PL = prog('Cm | Ab:2 Bb:2');
    var introLoop = section(2, [
      part('dbass', H.bossRiff(PL, { lo: 36 }), { vol: 0.85 }),
      part('organ', pad(PL, { lo: 55, hi: 70, n: 3 }), { vol: 0.4, rev: 0.4 }),
      part('drone', mel(k, '1,,:32'), { vol: 0.6 }),
      part('kick', rep(drum('x...x...x...x...'), 2), { vol: 0.8 }),
      part('hat', rep(drum('..x...x...x...x.'), 2), { vol: 0.4 }),
      part('timp', rep(drum('x.......x.......', { m: 36 }), 2), { vol: 0.5 })
    ], { next: 'introLoop' });

    function fight(P, leadEvs, leadInst, leadOpt, crashBars, extra) {
      var n = P.len / 16;
      return [
        // base: the organ and strings (always on)
        part('organ', pad(P, { lo: 55, hi: 72 }), { vol: 0.32, rev: 0.4 }),
        part('strings', pad(P, { lo: 55, hi: 74 }), { vol: 0.25, rev: 0.4, lite: false }),
        // groove
        part('dbass', H.bossRiff(P, { lo: 36 }), { vol: 0.85, layer: 'groove' }),
        part('kick', rep(drum('x..x....x.x..x..'), n), { vol: 0.95, layer: 'groove' }),
        part('snare', cat(rep(drum('....x.......x...'), n - 1), drum('....x.......xxxx')), { vol: 0.75, rev: 0.12, layer: 'groove' }),
        part('hat', rep(drum('x.x.x.x.x.x.x.x.'), n), { vol: 0.5, layer: 'groove' }),
        part('crash', cat.apply(null, crashBars.map(function (c) { return c ? cat(drum('x'), rest(15)) : rest(16); })), { vol: 0.55, rev: 0.2, layer: 'groove' }),
        // riff guitar (heavier than the Guards')
        part('gtr', chug(P, 'xxxxxxxxxxxxxxxx', { lo: 36, st: 0.45, v: 0.5 }), { vol: 0.7, drive: 5.5, tone: 1900, layer: 'riff', pan: -0.35, hum: 0.002, power: true, lite: false }),
        part('gtr', chug(P, BOSS_RHYTHM, { lo: 36, st: 0.9, v: 0.75 }), { vol: 0.85, drive: 5.5, tone: 2100, layer: 'riff', pan: 0.35, name: 'riffR', power: true }),
        // lead (doubled by the pipe organ an octave down)
        part(leadInst, leadEvs, Object.assign({ vol: 1.0, rev: 0.25, dly: 0.12, layer: 'lead', name: 'lead' }, leadOpt || {})),
        part('pipe', tr(leadEvs, -12), { vol: 0.32, rev: 0.4, layer: 'lead', name: 'leadPipe', lite: false }),
        // attack: brass stabs on the Guards' rhythm, toms, open hats
        part('brass', comp(P, BOSS_RHYTHM, { lo: 60, hi: 76, n: 3, st: 0.7, v: 0.8 }), { vol: 0.6, rev: 0.25, layer: 'attack' }),
        part('tom', rep(drum('....xx.x....x.xx', { ms: [0, 0, 0, 0, 45, 45, 0, 41, 0, 0, 0, 0, 38, 0, 45, 41] }), n), { vol: 0.6, rev: 0.15, layer: 'attack' }),
        part('ohat', rep(drum('..x...x...x...x.'), n), { vol: 0.45, layer: 'attack' }),
        // one colour per attack
        part('chip', arp(P, '3 2 1 0 3 2 1 0 3 2 1 0 3 2 1 0', { lo: 72, hi: 91, n: 4, u: 1 }), { vol: 0.42, duty: 0.125, tone: 5200, layer: 'atk_laser', pan: 0.3, gap: 0.03 }),
        part('marimba', arp(P, '3 2 1 0', { lo: 70, hi: 90, n: 4, u: 1 }), { vol: 0.5, layer: 'atk_fall', rev: 0.3, pan: -0.3 }),
        part('tom', rep(drum('............xxxx', { ms: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 47, 43, 40] }), n), { vol: 0.55, layer: 'atk_fall', name: 'fallTom' }),
        part('dpad', pad(P, { lo: 48, hi: 62, n: 3 }), { vol: 0.5, layer: 'atk_decay', rev: 0.5 }),
        part('bell', arp(P, '0 . . . . . . . 1 . . . . . . .', { lo: 60, hi: 76, n: 3, u: 1 }), { vol: 0.5, layer: 'atk_decay', rev: 0.6 }),
        part('pipe', rep(mel(k, "5:1 6:1 5:1 6:1 5:1 6:1 5:1 4:1 #4:1 5:1 #4:1 5:1 6:1 5:1 4:1 3:1", { oct: 1, v: 0.6 }), n), { vol: 0.3, layer: 'atk_poison', rev: 0.3, name: 'poison' }),
        // the opening (boss tired): cold Area X sounds, the dash cell in Phrygian
        part('celesta', rep(mel(kp, "1:1 2:1 3:2 .:4 .:8", { oct: 2, v: 0.6 }), n), { vol: 0.55, layer: 'vuln', rev: 0.5 }),
        part('bell', rep(mel(kp, ".:8 1:1 2:1 3:2 .:4", { oct: 1, v: 0.5 }), n), { vol: 0.45, layer: 'vuln', rev: 0.55, name: 'vulnBell' }),
        part('ooh', pad(P, { lo: 57, hi: 72, n: 3 }), { vol: 0.4, layer: 'vuln', rev: 0.6 }),
        // waves 4 and 5: the Parkour Master gets serious
        part('choir', pad(P, { lo: 57, hi: 74, n: 3 }), { vol: 0.5, layer: 'phase2', rev: 0.5 }),
        part('hat', rep(drum('.x.x.x.x.x.x.x.x', { v: 0.5 }), n), { vol: 0.42, layer: 'phase2', name: 'hat16', lite: false }),
        part('timp', bass(P, 'R.......R.......', { lo: 36 }), { vol: 0.55, layer: 'phase2', rev: 0.3 }),
        part('stac', arp(P, '0 1 2 1 0 1 2 1 0 1 2 1 0 1 2 1', { lo: 55, hi: 70, n: 3, u: 1 }), { vol: 0.42, layer: 'phase2', pan: 0.25, lite: false })
      ].concat(extra || []);
    }
    // A: the Dash motif in Phrygian (darker than the Guards' version), then minor
    var PA = prog('Cm | Ab:2 Db:2 | Cm | Ab:2 Bb:1 Cm:1 | Fm:2 Ab:2 | Db:2 G:2 | Fm:3 G7:1 | G7');
    var leadA = cat(mel(kp, bars(DASH1, DASH2, DASH1), { oct: 1, v: 0.85 }),
      mel(k, bars('1:2 1:1 6,:2 .:1 6,:2 7,:1 .:1 1:1 2:1 3:4', "4:2 5:1 6:2 .:1 5:2 6:1 7:2 .:1 6:1 7:1 1':2",
        "1':4 7:2 6:2 5:4 6:2 7:2", "1':6 7:2 6:4 5:4", '5:6 4:2 3:2 2:2 #7,:4'), { oct: 1, v: 0.85 }));
    var A = section(8, fight(PA, leadA, 'gtr', {}, [1, 0, 0, 0, 1, 0, 0, 0]), { next: 'B' });
    // B: the Master's decree: the X figure on brass and choir, the hero's horns underneath
    var PB = prog('Cm:2 Db:2 | G:2 D7/F#:2 | Fm:2 Db:2 | G7 | Cm:2 Db:2 | G:2 D7/F#:2 | Ab:2 Fm:2 | G7');
    var leadB = bars("1':8 b2':8", '5:8 #4:8', '6:6 5:2 4:8', '5:4 4:2 3:2 2:4 #7,:4',
      "1':8 b2':8", '5:8 #4:8', "1':6 7:2 6:8", '5:12 .:4');
    var B = section(8, fight(PB, mel(k, leadB, { v: 0.9 }), 'brass', { vol: 0.95 }, [1, 0, 0, 0, 1, 0, 0, 0], [
      part('choir', mel(k, leadB, { v: 0.7 }), { vol: 0.5, rev: 0.45, layer: 'lead', name: 'leadChoir' }),
      part('horn', mel(k, bars('5:8 6:8', '#7,:8 #6,:8', '1:6 #7,:2 6,:8', '#7,:16', '5:8 6:8', '#7,:8 #6,:8', '6,:8 6,:8', '#7,:16')), { vol: 0.55, rev: 0.35, layer: 'lead', pan: -0.2, name: 'horn' })
    ]), { next: 'A' });
    // end: he falls. A hit, then a ringing C major chord (the challenge is beaten... for now)
    var end = section(2, [
      part('hit', cat(drum('x', { m: 48 }), rest(31)), { vol: 0.8 }),
      part('brass', mel(k, '[1,#3,5]:24 .:8'), { vol: 0.6, rev: 0.5 }),
      part('strings', mel(k, "[1,5,1',#3']:30 .:2"), { vol: 0.5, rev: 0.5 }),
      part('timp', crescendo(drum('x.x.x.x.xxxxxxxxx.......', { m: 36 }), 1, 0.2), { vol: 0.6, rev: 0.4 }),
      part('sub', mel(k, '1,:28'), { vol: 0.6 })
    ], { next: null });

    song('final1', {
      bpm: 176, start: 'intro', gain: 0.85,
      sections: { intro: intro, introLoop: introLoop, A: A, B: B, end: end },
      layers: { base: 1, groove: 1, riff: 1, lead: 1, attack: 0, vuln: 0, atk_laser: 0, atk_fall: 0, atk_decay: 0, atk_poison: 0, phase2: 0 },
      react: bossReact(k, function (st, old, P) {
        P.setLayer('phase2', (st.wave || 1) >= 4 && st.boss !== 'vulnerable' ? 1 : 0, 'bar', 0.3);
      })
    });
  })();

  /* ================================================================
     8. FINAL BOSS STAGE 2 (the vortex): 138 BPM. Epic and sinister,
        and it keeps climbing. The X figure runs under everything as a
        bass ostinato; Master X's theme is on organ (then choir, then
        brass). Every vortex life broken adds layers AND raises the key:
        C minor for lives 5-4, D minor for life 3, E-flat minor for life 2.
        The FINAL stabilisation: the dark music drops away, the dash cell
        rises softly through A-flat and B-flat on bells while the strings
        swell, and then the first half of the Dash motif arrives in C
        major, twice as slow, with the whole orchestra over a low drone:
        grand, warm and safe in the middle of the dark. When the vortex
        breaks (the intoArea1 cutscene) the hero's phrase finishes first,
        then the music follows the cutscene scene by scene into Stage 3.
     ================================================================ */
  (function () {
    var k = K('C4', 'minor'), kM = K('C4', 'major'), kF = K('F4', 'major'), kFm = K('F4', 'minor');
    var secs = {};
    // which key group the vortex is in: '' = C minor (lives 5-4), '3' = D minor, '2' = E-flat minor
    function groupOf(st) { var l = st && st.vortex; return l === 3 ? '3' : l !== undefined && l <= 2 ? '2' : ''; }
    // Master X's theme
    var xTheme = bars('5:6 6:2 5:4 .:2 4:1 3:1', '4:6 3:2 b2:8', '1:6 b2:2 3:4 .:2 1:1 b2:1', '#7,:8 .:4 2:4',
      "5:6 6:2 5:4 .:2 1':1 b2':1", "b2':6 1':2 6:8", '6:4 5:2 4:2 3:4 4:2 3:2', '2:8 #7,:8');
    secs.intro = section(2, [
      part('boom', cat(drum('x'), rest(31)), { vol: 0.7 }),
      part('choir', mel(k, '[C4,Eb4,G4]:16 | [Db4,F4,Ab4]:8 [B3,D4,G4]:8'), { vol: 0.55, rev: 0.55 }),
      part('organ', mel(k, '[C3,G3,C4]:16 | [Db3,Ab3,Db4]:8 [G2,D3,G3]:8'), { vol: 0.5, rev: 0.4 }),
      part('brass', mel(k, XFIG + ' | 1:16', { oct: -1 }), { vol: 0.75, rev: 0.35 }),
      part('drone', mel(k, '1,,:32'), { vol: 0.7 }),
      part('timp', cat(drum('x...............', { m: 36 }), crescendo(drum('x.x.x.x.xxxxxxxx', { m: 43 }), 0.4, 1)), { vol: 0.6, rev: 0.35 }),
      part('riser', cat(rest(16), drum('x', { u: 16, m: 40 })), { vol: 0.45 })
    ], { next: function (P) { return 'V' + groupOf(P.state); } });

    // the layers every vortex section shares
    function vortex(P, leadEvs, heroEvs) {
      var n = P.len / 16;
      return [
        // base (5 lives): drone, dark pad, the X ostinato, Master X's theme, a heartbeat
        part('drone', bass(P, 'R---------------', { lo: 36 }), { vol: 0.38 }),
        part('dpad', pad(P, { lo: 51, hi: 67, n: 3 }), { vol: 0.24, rev: 0.55 }),
        part('dbass', xOst(P, { lo: 36 }), { vol: 0.52 }),
        part('organ', leadEvs, { vol: 0.58, rev: 0.35, name: 'lead' }),
        part('kick', rep(drum('x.......x.......'), n), { vol: 0.55 }),
        part('timp', bass(P, 'R...............', { lo: 36 }), { vol: 0.38, rev: 0.35 }),
        // each life broken adds weight to the low end and the theme as well
        part('dbass', xOst(P, { lo: 36 }), { vol: 0.4, layer: 'l3', name: 'xMore' }),
        part('organ', leadEvs, { vol: 0.3, rev: 0.35, layer: 'l4', name: 'leadMore' }),
        part('kick', rep(drum('....x.......x.x.'), n), { vol: 0.6, layer: 'l3', name: 'kickMore' }),
        // l4 (4 lives): strings in 8ths, taiko, a backbeat
        part('trem', pad(P, { lo: 55, hi: 70, n: 3 }), { vol: 0.28, rev: 0.4, layer: 'l4' }),
        part('stac', arp(P, '0 . 1 . 2 . 1 . 0 . 1 . 2 . 1 .', { lo: 55, hi: 72, n: 3, u: 1 }), { vol: 0.42, layer: 'l4', pan: 0.25 }),
        part('taiko', rep(drum('x.....x...x.....'), n), { vol: 0.7, rev: 0.25, layer: 'l4' }),
        part('snare', cat(rep(drum('....x.......x...'), n - 1), drum('....x.......xxxx')), { vol: 0.55, rev: 0.15, layer: 'l4' }),
        // l3 (3 lives): the choir takes the theme, the hero's horns answer, the strings fill in to 16ths
        part('choir', tr(leadEvs, 12), { vol: 0.52, rev: 0.55, layer: 'l3', name: 'leadChoir', lite: false }),
        part('horn', heroEvs, { vol: 0.72, rev: 0.35, layer: 'l3', pan: -0.2, name: 'hero' }),
        part('stac', arp(P, '. 2 . 1 . 0 . 1 . 2 . 1 . 0 . 1', { lo: 55, hi: 72, n: 3, u: 1 }), { vol: 0.42, layer: 'l3', pan: -0.25, lite: false }),
        part('tom', rep(drum('............x.xx', { ms: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 45, 0, 41, 38] }), n), { vol: 0.5, layer: 'l3' }),
        part('crash', cat(drum('x'), rest(63), drum('x'), rest(63)), { vol: 0.45, rev: 0.2, layer: 'l3' }),
        // l2 (2 lives): everything: brass on the theme, a full choir, riff guitars, 16th hats,
        // a timpani roll and a cymbal swell into every fourth bar
        part('brass', tr(leadEvs, -12), { vol: 0.65, rev: 0.3, layer: 'l2', name: 'leadBrass' }),
        part('choir', pad(P, { lo: 57, hi: 74, n: 3 }), { vol: 0.46, rev: 0.5, layer: 'l2', name: 'choirPad' }),
        part('gtr', chug(P, BOSS_RHYTHM, { lo: 36, st: 0.9, v: 0.75 }), { vol: 0.8, drive: 5, tone: 2100, layer: 'l2', pan: 0.3, power: true }),
        part('gtr', chug(P, 'xxxxxxxxxxxxxxxx', { lo: 36, st: 0.45, v: 0.5 }), { vol: 0.62, drive: 5, tone: 1900, layer: 'l2', pan: -0.3, power: true, lite: false, name: 'chug' }),
        part('brass', comp(P, BOSS_RHYTHM, { lo: 60, hi: 76, n: 3, st: 0.7, v: 0.8 }), { vol: 0.5, rev: 0.25, layer: 'l2', name: 'stabs' }),
        part('hat', rep(drum('xoxoxoxoxoxoxoxo'), n), { vol: 0.42, layer: 'l2' }),
        part('timp', rep(cat(rest(48), crescendo(drum('x.x.x.x.xxxxxxxx', { m: 36 }), 0.3, 1)), n / 4), { vol: 0.5, layer: 'l2', rev: 0.3, name: 'roll' }),
        part('swell', rep(cat(rest(56), drum('x', { u: 8 })), n / 4), { vol: 0.5, layer: 'l2' }),
        // alarm: the vortex is collapsing (C - Db siren, timpani 8ths, snare 16ths)
        part('chip', rep(mel(k, "1'':2 b2'':2", { v: 0.7 }), n * 4), { vol: 0.22, duty: 0.25, tone: 4000, layer: 'alarm', gap: 0.02 }),
        part('timp', rep(drum('x.x.x.x.x.x.x.x.', { m: 36 }), n), { vol: 0.5, layer: 'alarm', rev: 0.3 }),
        part('snare', rep(drum('oooooooooooooooo', { v: 0.6 }), n), { vol: 0.4, layer: 'alarm', name: 'roll' }),
        // danger: the stability is getting low
        part('trem', pad(P, { lo: 72, hi: 86, n: 2 }), { vol: 0.3, layer: 'danger', rev: 0.4 })
      ];
    }
    var PV = prog('Cm | Db | Ab | G | Cm | Db | Fm:2 Ab:2 | G7');
    var heroV = bars('.:16', '.:16', '.:16', '.:12 1:1 2:1 3:2', '.:16', '.:12 1:1 b2:1 3:2', '4:4 3:2 4:2 5:8', '.:16');
    // W: the hero fights back: the Dash motif (minor) on guitar against the X ostinato
    var PW = prog('Fm | Db | Ab | G | Fm | Db | Ab:2 Bb:2 | G7');
    var gtrW = bars(shiftDeg(DASH1, 3), "6:2 6:1 4:2 .:1 4:2 b2':1 .:1 1':1 b2':1 3':2 .:1 b2':1", '3:2 4:1 5:2 .:3 6:2 5:1 4:1 5:1 4:2 .:1', '5:4 4:2 3:2 2:4 #7,:4',
      shiftDeg(DASH1, 3), "6:2 6:1 4:2 .:1 4:2 b2':1 .:1 1':1 b2':1 3':2 .:1 b2':1", '3:2 4:1 5:2 .:3 6:2 5:1 4:1 5:1 4:2 .:1', '2:8 #7,:8');
    var orgW = bars('[F3,Ab3,C4]:16', '[F3,Ab3,Db4]:16', '[Eb3,Ab3,C4]:16', '[D3,G3,B3]:16', '[F3,Ab3,C4]:16', '[F3,Ab3,Db4]:16', '[Eb3,Ab3,C4]:8 [D3,F3,Bb3]:8', '[D3,F3,G3,B3]:16');
    var hornW = bars('1:16', '1:16', '1:16', '#7,:16', '1:16', '1:16', '1:8 2:8', '#7,:16');
    // one pair of sections (V, W) per key group; the key rises a step, then a half step more
    [['', 0], ['3', 2], ['2', 3]].forEach(function (g) {
      var V = section(8, vortex(PV, mel(k, xTheme, { v: 0.85 }), mel(k, heroV)), { next: function (P) { return 'W' + groupOf(P.state); } });
      var W = section(8, vortex(PW, mel(k, orgW), mel(k, hornW)).concat([
        part('gtr', mel(k, gtrW, { oct: 1, v: 0.85 }), { vol: 0.85, rev: 0.25, dly: 0.12, name: 'gtrHero', layer: 'l4' })
      ]), { next: function (P) { return 'V' + groupOf(P.state); } });
      if (g[1]) [V, W].forEach(function (s) { s.parts.forEach(function (p) { p.events = tr(p.events, g[1]); }); });
      secs['V' + g[0]] = V; secs['W' + g[0]] = W;
    });

    // HERO, the final stabilisation. First the introduction (2 bars): the dark music drops
    // away; the dash cell rises softly on bells, in A-flat, then in B-flat, while the strings
    // and horns swell; a timpani roll and a cymbal swell lift into...
    var kAb = K('Ab3', 'major'), kBb = K('Bb3', 'major');
    secs.Hin = section(2, [
      part('boom', cat(drum('x'), rest(31)), { vol: 0.4 }),
      part('ooh', mel(k, '[Ab3,C4,Eb4]:16 | [Bb3,D4,F4]:16'), { vol: 0.5, rev: 0.6 }),
      part('strings', crescendo(mel(k, '[Ab2,Eb3,C4,Eb4]:16 | [Bb2,F3,D4,F4]:16'), 0.35, 1), { vol: 0.45, rev: 0.5 }),
      part('horn', crescendo(mel(k, '.:16 | [D4,F4,Bb4]:16'), 0.5, 1), { vol: 0.5, rev: 0.5 }),
      part('bell', cat(mel(kAb, '1:2 2:1 3:5 .:8', { oct: 1, v: 0.55 }), mel(kBb, '1:2 2:1 3:5 .:8', { oct: 1, v: 0.75 })), { vol: 0.6, rev: 0.6, dly: 0.25 }),
      part('celesta', cat(mel(kAb, '1:2 2:1 3:5 .:8', { oct: 2, v: 0.4 }), mel(kBb, '1:2 2:1 3:5 .:8', { oct: 2, v: 0.55 })), { vol: 0.35, rev: 0.6 }),
      part('drone', mel(k, 'Ab1:16 | Bb1:16'), { vol: 0.5 }),
      part('timp', cat(drum('x.......x.......', { m: 44 }), crescendo(drum('xxxxxxxxxxxxxxxx', { m: 46 }), 0.3, 1.1)), { vol: 0.55, rev: 0.35 }),
      part('riser', cat(rest(16), drum('x', { u: 16, m: 46 })), { vol: 0.45 }),
      part('snare', cat(rest(24), crescendo(drum('xxxxxxxx'), 0.3, 1)), { vol: 0.5 }),
      part('swell', cat(rest(24), drum('x', { u: 8 })), { vol: 0.55 })
    ], { next: 'H' });
    // ...the first half of the Dash motif in C major, twice as slow: C D E, F E D E D.
    // Its shadow answers on E-flat (over A-flat and B-flat, the dark chords), and it lands
    // on high C. Half-time drums, a low drone still underneath.
    var ESC = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], ESC_AT = [0, 190, 320, 500, 600, 700, 800];
    function escFor(cf) { var w = 0; for (var i = 0; i < ESC_AT.length; i++) if ((cf || 0) >= ESC_AT[i]) w = i; return ESC[w]; }
    // after the hero's phrase: the escape scene the picture is in (never skipping the glimpse of Area 1)
    function heroNext(alt) {
      return function (P) {
        if (!P.escAfterHero) return alt;
        var cf = (P.state && P.state.cf) || 0;
        return cf < 190 ? 'e1' : cf < 420 ? 'e2' : escFor(cf);
      };
    }
    var PH = prog('C | F:2 G:2 | Ab:2 Bb:2 | C');
    function heroSection(tune, big, next) {
      return section(4, [
        part('brass', mel(kM, tune, { v: 0.9 }), { vol: 0.95, rev: 0.4, name: 'lead' }),
        part('horn', mel(kM, '[G3,C4]:16 | [A3,C4]:8 [B3,D4]:8 | [Ab3,C4]:8 [Bb3,D4]:8 | [G3,C4,E4]:16'), { vol: 0.55, rev: 0.45, pan: -0.2 }),
        part('strings', mel(kM, tune, { oct: 1, v: 0.7 }), { vol: 0.4, rev: 0.45, pan: 0.2, name: 'melody' }),
        part('strings', pad(PH, { lo: 48, hi: 67, n: 4 }), { vol: 0.42, rev: 0.5, name: 'warm' }),
        part('choir', pad(PH, { lo: 57, hi: 76, n: 4 }), { vol: big ? 0.6 : 0.5, rev: 0.55 }),
        part('harp', arp(PH, '0 1 2 3 4 5 4 3', { lo: 48, hi: 84, n: 6, u: 2 }), { vol: 0.38, rev: 0.45 }),
        part('glock', arp(PH, '3 . . . 4 . . . 5 . . . 4 . . .', { lo: 76, hi: 96, n: 4, u: 1 }), { vol: 0.25, rev: 0.5, pan: 0.35 }),
        part('pbass', bass(PH, 'R-------R-------', { lo: 36 }), { vol: 0.85 }),
        part('sub', bass(PH, 'R---------------', { lo: 24 }), { vol: 0.35 }),
        part('drone', mel(k, '1,,:64'), { vol: 0.3 }),
        part('timp', bass(PH, 'R.......R.......', { lo: 36 }), { vol: 0.55, rev: 0.35 }),
        part('kick', rep(drum('x.........x.....'), 4), { vol: 0.85 }),
        part('snare', rep(drum('........x.......'), 4), { vol: 0.6, rev: 0.3 }),
        part('ride', rep(drum('x...x...x...x...', { v: 0.6 }), 4), { vol: 0.35 }),
        part('crash', cat(drum('x'), rest(31), drum('x'), rest(31)), { vol: 0.38, rev: 0.3 }),
        big ? part('gtr', mel(kM, tune, { oct: 1, v: 0.85 }), { vol: 0.75, rev: 0.3, dly: 0.15, name: 'dash' }) : null,
        big ? part('tom', cat(rest(60), drum('xxxx', { ms: [50, 47, 43, 40] })), { vol: 0.55, rev: 0.2 }) : null
      ], { next: next, enter: function (P) { P.hit('hit', 48, 0.55, '16th'); } });
    }
    secs.H = heroSection(bars('1:4 2:2 3:10', '4:4 3:2 2:2 3:2 2:6', 'b3:4 4:2 5:10', "1':16"), false, heroNext('H2'));
    secs.H2 = heroSection(bars('1:4 2:2 3:10', '4:4 3:2 2:2 3:2 2:6', "b6:4 b7:2 1':10", "1':16"), true, heroNext('H'));

    // ESCAPE (the intoArea1 cutscene, 15 s), one section per scene, following the cutscene
    // clock: the light breaks through (C major), a glimpse of Area 1 (its tune on the harp),
    // Master X gives chase (the X figure), a held breath, Dash turns to face him (the dash
    // cell, in F minor now), he lands, and the drums lead into the race.
    var escScenes = {
      e1: [7, [ // the light breaks through
        part('brass', mel(kM, '[C4,E4,G4,C5]:28'), { vol: 0.8, rev: 0.5 }),
        part('strings', mel(kM, '[C5,E5,G5,C6]:28'), { vol: 0.45, rev: 0.55 }),
        part('crash', cat(drum('x'), rest(27)), { vol: 0.7, rev: 0.3 }),
        part('timp', cat(crescendo(drum('xxxxxxxxxxxxxxxx', { m: 36 }), 1, 0.2), rest(12)), { vol: 0.6, rev: 0.3 }),
        part('glock', mel(kM, "5':2 3':2 1':2 5:2 3':2 1':2 5:2 3:2 1:12", { oct: 1, v: 0.6 }), { vol: 0.45, rev: 0.5 }),
        part('sub', mel(kM, '1,,:28'), { vol: 0.6 })
      ]],
      e2: [5, [ // Area 1, for a moment
        part('strings', mel(kF, '[F4,A4,C5]:20'), { vol: 0.42, rev: 0.55 }),
        part('harp', mel(kF, ADV[0] + ' 2:4', { oct: 1, v: 0.7 }), { vol: 0.6, rev: 0.4 })
      ]],
      e3: [7, [ // Master X gives chase
        part('trem', mel(k, XFIG + ' ' + XFIG.replace(/:4/g, ':3'), { oct: -1 }), { vol: 0.6, rev: 0.35 }),
        part('organ', mel(k, '[C3,G3,C4]:8 [Db3,Ab3,Db4]:8 [C3,G3,C4]:8 [Db3,Ab3,Db4]:4'), { vol: 0.45, rev: 0.4 }),
        part('taiko', drum('x.....x...x.....x.....x...x.'), { vol: 0.65, rev: 0.3 }),
        part('dbass', mel(k, 'C2:8 Db2:8 C2:8 Db2:4'), { vol: 0.6 })
      ]],
      e4: [4, [ // a held breath
        part('ooh', mel(k, '[Db4,F4,Ab4]:16'), { vol: 0.42, rev: 0.6 }),
        part('strings', mel(k, '[Db3,Ab3,F4]:16'), { vol: 0.35, rev: 0.5 }),
        part('timp', cat(drum('x', { m: 37 }), rest(15)), { vol: 0.55, rev: 0.4 }),
        part('sub', mel(k, 'Db2:16'), { vol: 0.55 })
      ]],
      e5: [4, [ // Dash turns to face him: the dash cell in F minor (F G A-flat)
        part('horn', mel(kFm, '1:2 2:1 3:5 .:2 3:2 4:1 5:3', { v: 0.85 }), { vol: 0.8, rev: 0.35 }),
        part('strings', mel(kFm, '[C4,F4,Ab4]:16'), { vol: 0.4, rev: 0.45 }),
        part('snare', crescendo(drum('oooooooooooooooo'), 0.3, 1), { vol: 0.55 })
      ]],
      e6: [4, [ // he lands (the landing itself is a sound effect)
        part('strings', mel(kFm, '[C4,E4,G4,Bb4]:16'), { vol: 0.42, rev: 0.45 }),
        part('snare', drum('x.x.x.x.x.x.x.x.'), { vol: 0.55 }),
        part('timp', crescendo(drum('x.x.x.x.xxxxxxxx', { m: 36 }), 0.4, 1), { vol: 0.55, rev: 0.3 })
      ]],
      e7: [4, [ // the drums pick up
        part('kick', drum('x...x...x...x.x.'), { vol: 0.8 }),
        part('snare', drum('x.x.x.x.xxxxxxxx'), { vol: 0.6 }),
        part('pbass', mel(kFm, 'C2:8 Db2:4 E2:4'), { vol: 0.85 }),
        part('strings', mel(kFm, '[C4,E4,G4,Bb4,Db5]:16'), { vol: 0.4, rev: 0.4 })
      ]]
    };
    ESC.forEach(function (nm, i) {
      var sc = escScenes[nm], L = sc[0] * 4;
      sc[1].forEach(function (p) { if (p.events.len < L) p.events = cat(p.events, rest(L - p.events.len)); });
      secs[nm] = section(sc[0] / 4, sc[1], { next: ESC[i + 1] || 'escHold' });
    });
    secs.escHold = section(1, [
      part('kick', drum('x...x...x...x...'), { vol: 0.8 }),
      part('snare', drum('....x.......x.x.'), { vol: 0.5 }),
      part('pbass', mel(kFm, 'C2:2 C2:2 C2:2 C2:2 C2:2 C2:2 C2:2 C2:2'), { vol: 0.8 }),
      part('strings', mel(kFm, '[C4,E4,G4,Bb4]:16'), { vol: 0.3, rev: 0.4 })
    ], { next: 'escHold' });

    var HERO = ['Hin', 'H', 'H2'];
    song('final2', {
      bpm: 138, start: 'intro', gain: 0.88, sections: secs,
      layers: { base: 1, l4: 0, l3: 0, l2: 0, alarm: 0, danger: 0 },
      react: function (st, old, P) {
        var inHero = HERO.indexOf(P.secName) >= 0 || !!(P.pending && HERO.indexOf(P.pending.name) >= 0);
        if (st.cut === 'intoArea1') {
          ['l4', 'l3', 'l2', 'alarm', 'danger'].forEach(function (l) { P.setLayer(l, 0, 'beat', 0.3); });
          if (inHero) { P.escAfterHero = true; return; } // the hero's phrase finishes first
          // (once in the escape, the music only jumps ahead when it is clearly behind the picture)
          var cur = P.secName === 'escHold' ? ESC.length : ESC.indexOf(P.secName);
          var want = ESC.indexOf(escFor(cur < 0 ? st.cf : (st.cf || 0) - 45));
          var pend = P.pending ? ESC.indexOf(P.pending.name) : -1;
          if (want > cur && want > pend) P.go(ESC[want], 'beat', 0.3);
          return;
        }
        if (st.vortex === undefined) return;
        var lives = st.vortex, stab = st.vstate === 'STABILIZE_VORTEX';
        if (lives >= 5 && inHero) { P.go('V', 'bar', 0.3); inHero = false; } // a fresh vortex after a retry
        P.setLayer('l4', lives <= 4 ? 1 : 0, 'bar', 0.2);
        P.setLayer('l3', lives <= 3 ? 1 : 0, 'bar', 0.2);
        P.setLayer('l2', lives <= 2 ? 1 : 0, 'bar', 0.2);
        P.setLayer('alarm', stab && !inHero ? 1 : 0, 'beat', 0.05);
        P.setLayer('danger', !stab && !inHero && st.stab !== undefined && st.stab <= 50 ? 1 : 0, 'bar', 0.4);
        // the final stabilisation: the hero's theme (on the next bar)
        if (lives === 2 && stab && !inHero) { P.go('Hin', 'bar', 0.35); P.setLayer('alarm', 0, 'bar', 0.1); return; }
        if (inHero) return;
        // a life broken: on the next bar the key rises, with a cymbal, a boom and the timpani
        if (old.vortex !== undefined && lives < old.vortex) { P.hit('crash', 0, 1, 'bar'); P.hit('boom', 0, 0.8, 'bar'); P.hit('timp', 36, 1, 'bar'); }
        var grp = groupOf(st), m = /^([VW])(\d?)$/.exec(P.secName);
        if (m && m[2] !== grp && !(P.pending && /^[VW]/.test(P.pending.name))) P.go(m[1] + grp, 'bar', 0.15);
      }
    });
  })();

  /* ================================================================
     9. FINAL MINI-STAGE 3 (the chase): F minor, 172 BPM. A race, and
        still dark: Area 1's key and its tune, turned minor on brass
        over racing 16th strings and a galloping beat, with Master X's
        figure always in the bass just ahead. Then a duel (the Dash
        motif on the Dash guitar, answered each time by the X figure),
        a climb, and every lap goes up a half step (F, F#, G minor).
     ================================================================ */
  (function () {
    var k = K('F4', 'minor'), secs = {};
    var tune = ADV.join(' | ');
    function race(n, lap) {
      return [
        part('kick', rep(drum('x...x.x.x...x.x.'), n), { vol: 0.9 }),
        part('snare', cat(rep(drum('o...x..o.o..x.o.'), n - 1), drum('o...x..o.o..xxxx', { v: 0.75 })), { vol: 0.62, rev: 0.14 }),
        part('hat', rep(drum('xoxoxoxoxoxoxoxo'), n), { vol: 0.45 }),
        part('taiko', rep(drum('x.....x.........'), n), { vol: 0.65, rev: 0.25 }),
        part('crash', cat(drum('x'), rest(n * 8 - 1), drum('x'), rest(n * 8 - 1)), { vol: 0.5, rev: 0.2 }),
        lap >= 1 ? part('tom', rep(drum('x.xx', { ms: [43, 0, 43, 40] }), n * 4), { vol: 0.32, rev: 0.15, lite: false }) : null
      ];
    }
    function engine(P, lap) { // what never stops: Master X's figure in the bass, racing strings, riff guitars
      return [
        part('dbass', xOst(P, { lo: 29 }), { vol: 0.8 }),
        part('stac', arp(P, '0 1 2 1', { lo: 53, hi: 70, n: 3, u: 1 }), { vol: 0.4, pan: 0.25 }),
        part('gtr', chug(P, 'xxxxxxxxxxxxxxxx', { lo: 41, st: 0.45, v: 0.5 }), { vol: 0.6, drive: 5, tone: 1900, pan: -0.35, power: true, lite: false, hum: 0.002 }),
        part('gtr', chug(P, BOSS_RHYTHM, { lo: 41, st: 0.9, v: 0.75 }), { vol: 0.75, drive: 5, tone: 2100, pan: 0.35, power: true, name: 'riffR' }),
        part('dpad', pad(P, { lo: 53, hi: 67, n: 3 }), { vol: 0.25, rev: 0.5 }),
        lap >= 1 ? part('choir', pad(P, { lo: 57, hi: 74, n: 3 }), { vol: 0.38, rev: 0.5 }) : null
      ];
    }
    secs.intro = section(2, [
      part('hat', rep(drum('xoxoxoxoxoxoxoxo'), 2), { vol: 0.45 }),
      part('rim', rep(drum('x...x...x...x...'), 2), { vol: 0.35 }),
      part('dbass', xOst(prog('Fm | Fm'), { lo: 29 }), { vol: 0.8 }),
      part('riser', drum('x', { u: 32, m: 41 }), { vol: 0.45 }),
      part('timp', cat(drum('x.......x.......', { m: 41 }), crescendo(drum('x.x.x.x.xxxxxxxx', { m: 41 }), 0.4, 1)), { vol: 0.55, rev: 0.3 }),
      part('brass', cat(rest(16), comp(prog('Fm'), BOSS_RHYTHM, { lo: 60, hi: 74, n: 3, st: 0.7 })), { vol: 0.6, rev: 0.25 }),
      part('kick', cat(rest(16), drum('x...x...x...x.x.')), { vol: 0.85 }),
      part('horn', mel(k, '.:16 | .:10 5,:2 6,:2 7,:2'), { vol: 0.7, rev: 0.3 })
    ], { next: 'A0' });

    // A: the Adventure Tune in F minor, on brass (and the pipe organ, Area X's colour)
    var PA = prog('Fm | Eb:2 Db:2 | Fm:2 Bbm:2 | C7 | Fm | Eb:2 Bbm:2 | Db:2 C7:2 | Fm:2 Db:1 Eb:1');
    // B: the duel. The Dash guitar plays the motif; Master X answers with his figure each time
    // (over bare fifths), a little higher each time
    var PB = prog('Fm | F5 | Db:2 Eb:2 | C5 | Ab:2 Db:2 | Db5 | Cm:2 Db:2 | C7');
    var dashB = bars(DASH1, '.:16', DASH2, '.:16', shiftDeg(DASH1, 2), '.:16', shiftDeg(DASH1, 4), '5:4 4:2 3:2 2:4 #7,:4');
    var xB = bars('.:16', 'F3:4 Gb3:4 C4:4 B3:4', '.:16', 'C4:4 Db4:4 G4:4 F#4:4', '.:16', 'Db4:4 D4:4 Ab4:4 G4:4', '.:16', '.:16');
    // C: the climb (Bbm Db Gb), ending on the next lap's dominant
    function climb(lastChord, lastNotes) {
      var PC = prog('Bbm | Db | Gb | ' + lastChord);
      return [
        part('brass', mel(k, 'Db5:16 | F5:16 | Gb5:8 Bb5:8 | ' + lastNotes), { vol: 0.85, rev: 0.3 }),
        part('horn', mel(k, 'F4:16 | Ab4:16 | Bb4:16 | ' + lastNotes.replace(/5:/g, '4:')), { vol: 0.55, rev: 0.35 }),
        part('choir', pad(PC, { lo: 57, hi: 74, n: 3 }), { vol: 0.45, rev: 0.5 }),
        part('stac', arp(PC, '0 1 2 1', { lo: 53, hi: 70, n: 3, u: 1 }), { vol: 0.42 }),
        part('dbass', bass(PC, 'R.R.R.R.R.R.R.R.', { lo: 34 }), { vol: 0.85 }),
        part('gtr', chug(PC, 'xxxxxxxxxxxxxxxx', { lo: 41, st: 0.45, v: 0.55 }), { vol: 0.6, drive: 5, tone: 1900, power: true, lite: false }),
        part('timp', bass(PC, 'R.......R.......', { lo: 36 }), { vol: 0.55, rev: 0.3 }),
        part('kick', rep(drum('x...x...x...x...'), 4), { vol: 0.85 }),
        part('snare', crescendo(cat(rep(drum('x.x.x.x.x.x.x.x.'), 2), rep(drum('xxxxxxxxxxxxxxxx'), 2)), 0.35, 1.2), { vol: 0.6 }),
        part('riser', cat(rest(32), drum('x', { u: 32, m: 41 })), { vol: 0.45 }),
        part('crash', cat(drum('x'), rest(63)), { vol: 0.5, rev: 0.25 })
      ];
    }
    // three laps: F minor, F# minor, G minor (then back to F)
    var laps = [[0, 'C#7', 'F5:8 G#5:8', 'A1'], [1, 'C#7', 'F5:8 G#5:8', 'A2'], [2, 'Bb7', 'D5:8 F5:8', 'A0']];
    laps.forEach(function (L) {
      var lap = L[0];
      var A = section(8, [
        part('brass', mel(k, tune, { v: 0.85 }), { vol: 0.9, rev: 0.3, name: 'lead' }),
        part('horn', mel(k, tune, { oct: -1, v: 0.7 }), { vol: 0.5, rev: 0.3, pan: -0.2 }),
        part('pipe', mel(k, tune, { oct: 1, v: 0.6 }), { vol: 0.28, rev: 0.35, lite: false }),
        lap >= 2 ? part('gtr', mel(k, tune, { oct: 1, v: 0.75 }), { vol: 0.6, rev: 0.25, dly: 0.12, name: 'dash' }) : null
      ].concat(engine(PA, lap), race(8, lap)), { next: 'B' + lap });
      var B = section(8, [
        part('gtr', mel(k, dashB, { oct: 1, v: 0.88 }), { vol: 1.0, rev: 0.25, dly: 0.12, name: 'lead' }),
        part('brass', mel(k, xB), { vol: 0.85, rev: 0.3, name: 'x' }),
        part('organ', mel(k, xB, { oct: 1 }), { vol: 0.4, rev: 0.35 }),
        part('choir', mel(k, bars('.:16', '[F4,C5]:16', '.:16', '[C4,G4]:16', '.:16', '[Db4,Ab4]:16', '.:16', '.:16')), { vol: 0.4, rev: 0.5 })
      ].concat(engine(PB, lap), race(8, lap)), { next: 'C' + lap });
      var C = section(4, climb(L[1], L[2]), { next: L[3] });
      [A, B, C].forEach(function (s) { if (lap) s.parts.forEach(function (p) { p.events = tr(p.events, lap); }); });
      secs['A' + lap] = A; secs['B' + lap] = B; secs['C' + lap] = C;
    });

    song('final3', { bpm: 172, start: 'intro', sections: secs, gain: 0.88 });
  })();

  /* ================================================================
     CUTSCENES. Each cue follows its cutscene scene by scene (see
     cueSong above). Frame numbers are the cutscene's own (60 a second).
     ================================================================ */
  // Prologue (the opening cutscene, ~53 s), 90 BPM: a beat is 40 frames.
  // Mystery -> the Parkour Master -> his challenge -> the three Guards (their motif) ->
  // everyone fails -> Dash (the Dash guitar, the motif) -> an unanswered question,
  // and the Title theme answers it.
  (function () {
    var k = K('C4', 'major'), kf = K('F#3', 'minor'), ka = K('A3', 'minor');
    function stab(sym) { return comp(prog(sym + ':2'), 'X..x....', { lo: 58, hi: 74, n: 3, st: 0.8 }); }
    cueSong('prologue', { bpm: 90, cut: 'intro', scenes: [
      { name: 'oneDay', at: 0, parts: function (L) { return [ // "One day... A legend was made..." (the screen shakes at the end)
        part('strings', fit(mel(k, '[F3,A3,C4,E4]:12 [A3,C4,E4,G4]:12'), L), { vol: 0.32, rev: 0.55 }),
        part('musicbox', mel(k, '1:2 2:1 3:5 .:4 6,:4 5,:4', { oct: 2, v: 0.7 }), { vol: 0.7, rev: 0.6, dly: 0.3 }),
        part('timp', cat(rest(16), crescendo(drum('xxxxxxxx', { m: 36 }), 0.15, 0.8)), { vol: 0.6, rev: 0.4 }),
        part('swell', cat(rest(16), drum('x', { u: 8 })), { vol: 0.5 }),
        part('sub', cat(rest(16), mel(k, '1,,:8')), { vol: 0.6 })
      ]; } },
      { name: 'master', at: 250, parts: function (L) { return [ // the Parkour Master descends (Ab -> Bb: noble, a little ominous)
        part('horn', fit(mel(k, '[Ab3,C4,Eb4]:8 [Bb3,D4,F4]:8'), L), { vol: 0.7, rev: 0.45 }),
        part('ooh', mel(k, '[Eb4,Ab4,C5]:8 [F4,Bb4,D5]:8'), { vol: 0.5, rev: 0.55 }),
        part('trem', mel(k, '[Ab2,Eb3]:8 [Bb2,F3]:8'), { vol: 0.5, rev: 0.4 }),
        part('timp', cat(drum('x.......', { m: 44 }), drum('x.......', { m: 46 })), { vol: 0.65, rev: 0.35 })
      ]; } },
      { name: 'created', at: 405, parts: function (L) { return [ // "The Parkour Master created... the ultimate challenge": the Title's fanfare
        part('horn', fit(mel(k, '1:2 2:1 3:5 .:2 3:2 4:1 5:7 .:4'), L), { vol: 0.85, rev: 0.4 }),
        part('brass', mel(k, '1:2 2:1 3:5 .:2 3:2 4:1 5:7 .:4', { oct: 1, v: 0.6 }), { vol: 0.5, rev: 0.4 }),
        part('strings', mel(k, '[C4,E4,G4,C5]:12 [C4,F4,A4,C5]:6 [B3,D4,G4,D5]:6'), { vol: 0.4, rev: 0.45 }),
        part('sub', mel(k, '1,,:12 4,,:6 5,,:6'), { vol: 0.5 }),
        part('timp', cat(drum('x...........', { m: 36 }), drum('x.....', { m: 41 }), drum('x.....', { m: 43 })), { vol: 0.6, rev: 0.3 }),
        part('crash', drum('x'), { vol: 0.5, rev: 0.3 }),
        part('glock', mel(k, ".:12 5:1 6:1 7:1 1':3", { oct: 1, v: 0.5 }), { vol: 0.5, rev: 0.5 })
      ]; } },
      { name: 'ground', at: 635, parts: function (L) { return [ // the ground and the lava slam into place (the slams are sound effects)
        part('strings', fit(mel(k, '[C3,G3,C4,G4]:12'), L), { vol: 0.45, rev: 0.5 }),
        part('sub', mel(k, '1,,:12'), { vol: 0.5 }),
        part('swell', cat(rest(4), drum('x', { u: 8 })), { vol: 0.6 })
      ]; } },
      { name: 'hardest', at: 750, parts: function (L) { var P = prog('C:4 Am:4 F:1'); return [ // "The hardest parkour course the world had EVER seen"
        part('horn', fit(mel(k, '1:2 2:1 3:3 5:2 6:2 5:2 3:4 2:3 3:1 2:2 1:2 6,:4 .:4 .:4'), L), { vol: 0.8, rev: 0.4 }),
        part('stac', arp(P, '0 1 2 1', { lo: 55, hi: 72, n: 3, u: 2 }), { vol: 0.45, rev: 0.3 }),
        part('strings', pad(P, { lo: 52, hi: 67 }), { vol: 0.3, rev: 0.45 }),
        part('pbass', bass(P, 'R.......R.......', { lo: 36 }), { vol: 0.7 }),
        part('kick', drum('x.......x.......x.......x.......x...'), { vol: 0.6 }),
        part('snare', cat(rest(24), crescendo(drum('oooooooooooo', { v: 0.7 }), 0.3, 1.1)), { vol: 0.55 })
      ]; } },
      { name: 'guards', at: 1125, parts: function (L) { return [ // "And he placed three Guards to defend it": the Guards' motif, F# minor
        part('trem', fit(mel(kf, '[F#2,C#3]:20'), L), { vol: 0.55, rev: 0.4 }),
        part('timp', cat(drum(BOSS_RHYTHM, { m: 42 }), rest(4)), { vol: 0.75, rev: 0.35 }),
        part('dbass', mel(kf, '1,:1 .:2 1,:1 .:5 1,:1 .:1 1,:1 .:1 1,:1 7,,:1 #7,,:1 .:4'), { vol: 0.7 }),
        part('ooh', mel(kf, '[F#3,A3,C#4]:20'), { vol: 0.35, rev: 0.6 })
      ]; } },
      { name: 'three', at: 1325, parts: function (L) { return [ // the camera visits each Guard: Diamond, Emerald, Ruby (a stab each, rising)
        part('brass', fit(cat(rest(8), stab('F#m'), stab('Am'), stab('Cm'), rest(4)), L), { vol: 0.75, rev: 0.35 }),
        part('timp', cat(rest(8), drum('X..x....', { m: 42 }), drum('X..x....', { m: 45 }), drum('X..x....', { m: 48 })), { vol: 0.7, rev: 0.35 }),
        part('trem', mel(k, '[F#2,C#3]:16 [A2,E3]:8 [C3,G3]:12'), { vol: 0.5, rev: 0.4 }),
        part('crash', cat(rest(8), drum('x.......x.......x...')), { vol: 0.45, rev: 0.3 }),
        part('dbass', mel(k, '.:8 F#1:3 .:5 A1:3 .:5 C2:3 .:9'), { vol: 0.7 })
      ]; } },
      { name: 'tried', at: 1685, parts: function (L) { var P = prog('Am:4 G:4 E:1'); return [ // "The world's greatest players tried": the tune, hopeful, in A minor
        part('flute', fit(mel(ka, '1:2 2:1 3:3 5:2 6:2 5:2 3:4 2:3 3:1 2:2 1:2 7,:4 .:4 .:4', { oct: 1 }), L), { vol: 0.85, rev: 0.35 }),
        part('pizz', arp(P, '0 1 2 1', { lo: 57, hi: 72, n: 3, u: 2 }), { vol: 0.55 }),
        part('snare', drum('x..x....x.x.x...x..x....x.x.x...x...'), { vol: 0.4 }),
        part('kick', drum('x.......x.......x.......x.......x...'), { vol: 0.55 }),
        part('pbass', bass(P, 'R...5...', { lo: 33 }), { vol: 0.7 }),
        part('strings', pad(P, { lo: 52, hi: 69 }), { vol: 0.25, rev: 0.4 })
      ]; } },
      { name: 'noOne', at: 2030, parts: function (L) { return [ // "But no one could conquer it"
        part('horn', fit(mel(k, 'b3:4 2:4 1:4 7,:4'), L), { vol: 0.65, rev: 0.5 }),
        part('strings', mel(k, '[F3,Ab3,C4]:8 [F3,Ab3,D4]:4 [G3,B3,D4]:4'), { vol: 0.4, rev: 0.5 }),
        part('boom', drum('x'), { vol: 0.45 }),
        part('timp', drum('x', { m: 41 }), { vol: 0.5, rev: 0.4 }),
        part('sub', mel(k, '4,,:8 4,,:4 5,,:4'), { vol: 0.5 })
      ]; } },
      { name: 'refused', at: 2210, parts: function (L) { return [ // "However... Dash refused to give up": the Dash guitar, alone, then the strings
        part('gtr', fit(mel(k, '.:4 1:2 2:1 3:5 .:4 3:2 4:1 5:9', { oct: 1, v: 0.8 }), L), { vol: 0.9, rev: 0.35, dly: 0.25 }),
        part('strings', crescendo(pad(prog('C:3 G/B:2 Am:2'), { lo: 52, hi: 67 }), 0.4, 1), { vol: 0.35, rev: 0.5 }),
        part('pbass', mel(k, '1,:12 7,,:8 6,,:8'), { vol: 0.6 })
      ]; } },
      { name: 'dash', at: 2470, parts: function (L) { var P = prog('C:2 G/B:2 Am:1'); return [ // close-up of Dash: the Dash motif
        part('gtr', fit(mel(k, DASH1 + ' .:4', { oct: 1, v: 0.9 }), L), { vol: 1.0, rev: 0.25, dly: 0.15 }),
        part('horn', mel(k, DASH1 + ' .:4'), { vol: 0.5, rev: 0.35 }),
        part('strings', pad(P, { lo: 55, hi: 72 }), { vol: 0.35, rev: 0.4 }),
        part('pbass', bass(P, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.8 }),
        part('kick', drum('x..x....x.x.....x...'), { vol: 0.75 }),
        part('snare', drum('....x.......x.......'), { vol: 0.55 }),
        part('crash', drum('x'), { vol: 0.5 })
      ]; } },
      { name: 'champion', at: 2680, parts: function (L) { var P = prog('Am:2 G:2 F:2 G:1'); var m = DASH2 + ' 1:2 2:1 3:2 .:1 5:2 6:4'; return [ // "Can he become the Parkour Champion?"
        part('gtr', fit(mel(k, m, { oct: 1, v: 0.9 }), L), { vol: 1.0, rev: 0.25, dly: 0.15 }),
        part('brass', mel(k, shiftDeg(m, -2), { oct: 1, v: 0.6 }), { vol: 0.45, rev: 0.3 }),
        part('strings', pad(P, { lo: 55, hi: 74 }), { vol: 0.35, rev: 0.4 }),
        part('pbass', bass(P, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.8 }),
        part('kick', drum('x..x....x.x.....x..x....x.x.'), { vol: 0.8 }),
        part('snare', cat(drum('....x.......x...'), rest(4), crescendo(drum('oooooooo'), 0.4, 1.2)), { vol: 0.6 }),
        part('timp', cat(rest(16), drum('x.......x...', { m: 41 })), { vol: 0.5 })
      ]; } },
      { name: 'time', at: 2950, beats: 5, parts: function (L) { return [ // "Only time will tell...": left hanging (the Title answers)
        part('strings', fit(mel(k, '[F3,A3,C4,D4]:10 [G3,C4,D4,F4]:10'), L), { vol: 0.4, rev: 0.6 }),
        part('glock', mel(k, "3':2 .:1 2':17"), { vol: 0.55, rev: 0.6, dly: 0.3 }),
        part('sub', mel(k, '4,,:10 5,,:10'), { vol: 0.45 })
      ]; } }
    ], holdBeats: 4, hold: function () { return [part('strings', mel(k, '[G3,C4,D4,F4]:16'), { vol: 0.3, rev: 0.6 })]; } });
  })();

  // "victory?" (after Area 3's Guard, ~12 s), 128 BPM like Area 3. A false ending in D
  // major, then "the challenge is not over", the portal opens and the X figure arrives.
  (function () {
    var kD = K('D4', 'minor'), kx = K('C4', 'minor');
    cueSong('cutPortal', { bpm: 128, cut: 'victory?', scenes: [
      { name: 'down', at: 0, parts: function (L) { return [
        part('horn', fit(mel(kD, '[Bb3,D4,F4]:8 [C4,E4,G4]:8 [D4,F#4,A4]:4'), L), { vol: 0.75, rev: 0.45 }),
        part('strings', mel(kD, '[Bb4,D5,F5]:8 [C5,E5,G5]:8 [D5,F#5,A5]:4'), { vol: 0.35, rev: 0.45 }),
        part('timp', cat(drum('x.......', { m: 46 }), drum('x.......', { m: 48 }), drum('x...', { m: 50 })), { vol: 0.6, rev: 0.35 }),
        part('sub', mel(kD, 'Bb1:8 C2:8 D2:4'), { vol: 0.5 })
      ]; } },
      { name: 'notOver', at: 130, parts: function (L) { return [ // "Congratulations, but the challenge is not over."
        part('trem', fit(mel(kD, '[D3,A3]:8 [Bb2,F3]:8 [G2,D3]:8 [A2,E3]:4'), L), { vol: 0.5, rev: 0.45 }),
        part('ooh', mel(kD, '[D4,F4,A4]:8 [D4,F4,Bb4]:8 [D4,G4,Bb4]:8 [C#4,E4,A4]:4'), { vol: 0.4, rev: 0.6 }),
        // the Dash motif, in Area 3's D minor, left hanging on the leading note
        part('horn', mel(kD, DASH1 + ' 1:2 1:1 6,:2 .:1 6,:2 #7,:4'), { vol: 0.65, rev: 0.45 }),
        part('taiko', drum('x.......x.......x.......x...'), { vol: 0.5, rev: 0.3 }),
        part('sub', mel(kD, 'D2:8 Bb1:8 G1:8 A1:4'), { vol: 0.5 })
      ]; } },
      { name: 'portal', at: 330, parts: function (L) { return [ // the portal opens
        part('riser', fit(drum('x', { u: 8, m: 36 }), L), { vol: 0.5 }),
        part('drone', mel(kx, '1,,:8'), { vol: 0.6 }),
        part('trem', mel(kD, '[A2,E3]:8'), { vol: 0.4, rev: 0.4 })
      ]; } },
      { name: 'waiting', at: 400, parts: function (L) { return [ // "I will be waiting for you in Area X...": the X figure
        part('bell', fit(mel(kx, XFIG, { oct: 1 }), L), { vol: 0.65, rev: 0.6, dly: 0.25 }),
        part('celesta', mel(kx, XFIG, { oct: 2, v: 0.5 }), { vol: 0.35, rev: 0.6 }),
        part('drone', mel(kx, '1,,:16'), { vol: 0.7 }),
        part('dpad', mel(kx, '[C3,G3,Eb4]:8 [Db3,Ab3,F4]:8'), { vol: 0.5, rev: 0.6 }),
        part('boom', drum('x'), { vol: 0.5 })
      ]; } },
      { name: 'rise', at: 500, beats: 7, parts: function (L) { return [ // he rises away; nothing is resolved
        part('ooh', fit(mel(kx, '[C4,Eb4,G4]:14 [B3,D4,G4]:14'), L), { vol: 0.4, rev: 0.6 }),
        part('bell', mel(kx, '5:8 #4:8', { oct: 1, v: 0.6 }), { vol: 0.55, rev: 0.6 }),
        part('drone', mel(kx, '1,,:28'), { vol: 0.7 }),
        part('dpad', mel(kx, '[C3,G3,Eb4]:14 [B2,G3,D4]:14'), { vol: 0.45, rev: 0.6 })
      ]; } }
    ], hold: function () { return [part('drone', mel(kx, '1,,:16'), { vol: 0.6 }), part('dpad', mel(kx, '[C3,G3,Eb4]:16'), { vol: 0.4, rev: 0.6 })]; } });
  })();

  // "masterX" (after the Parkour Master falls, ~39 s), 120 BPM: a beat is 30 frames.
  // A celebration cut short -> Area X attacks -> Dash and the Master escape together ->
  // the Master is lost -> MASTER X (the X figure, full force) -> his "gift" (the Dash
  // motif corrupted into Phrygian) -> into the portal, straight into Stage 2.
  (function () {
    var k = K('C4', 'major'), km = K('C4', 'minor'), kp = K('C4', 'phrygian');
    cueSong('cutMasterX', { bpm: 120, cut: 'masterX', scenes: [
      { name: 'crown', at: 0, parts: function (L) { return [ // the (almost) end: the fanfare, until the crown falls
        part('brass', fit(mel(k, "1:2 2:1 3:5 .:2 3:2 4:1 5:3 5:2 6:1 7:2 .:1 1':4 .:6", { oct: 1 }), L), { vol: 0.85, rev: 0.35 }),
        part('horn', mel(k, "[1,5]:2 [2,6]:1 [3,1']:5 .:2 [3,1']:2 [4,2']:1 [5,3']:3 [5,3]:2 [6,4]:1 [7,5]:2 .:1 [1',5]:4 .:6"), { vol: 0.6, rev: 0.35 }),
        part('strings', mel(k, '[C4,E4,G4]:8 [B3,D4,G4]:8 [C4,E4,G4,C5]:10 [Db4,F4,Ab4]:6'), { vol: 0.4, rev: 0.4 }),
        part('snare', drum('x.x.x...x.x.x...x.x.x...xx'), { vol: 0.45 }),
        part('kick', drum('x.......x.......x.......x.'), { vol: 0.7 }),
        part('crash', cat(drum('x'), rest(25), drum('x')), { vol: 0.5 }),
        // the crown falls: a hit on Db (Area X's flat second)
        part('hit', cat(rest(26), drum('x', { m: 49 })), { vol: 0.8 }),
        part('boom', cat(rest(26), drum('x')), { vol: 0.6 }),
        part('dbass', cat(rest(26), mel(km, 'Db2:6')), { vol: 0.8 })
      ]; } },
      { name: 'disaster', at: 250, parts: function (L) { var P = prog('Cm:2 Db:2 Cm:1'); return [ // lasers from the portals
        part('dbass', fit(xOst(P, { lo: 36 }), L), { vol: 0.85 }),
        part('trem', mel(km, '[C4,Eb4,G4]:8 [Db4,F4,Ab4]:8 [C4,Eb4,G4]:4'), { vol: 0.5, rev: 0.35 }),
        part('organ', comp(P, 'X..x..x.', { lo: 55, hi: 70, n: 3, st: 0.7 }), { vol: 0.6, rev: 0.3 }),
        part('taiko', drum('x..x..x.x..x..x.x..x'), { vol: 0.7, rev: 0.25 }),
        part('snare', crescendo(drum('xxxxxxxxxxxxxxxxxxxx', { v: 0.5 }), 0.3, 1), { vol: 0.45 }),
        part('crash', drum('x'), { vol: 0.5 })
      ]; } },
      { name: 'dodge', at: 400, parts: function (L) { var P = prog('Cm:2 Ab:2 Fm:2 G:2 G:1'); return [ // Dash and the Master dodge: the Dash motif, in minor
        part('gtr', fit(mel(km, DASH1 + ' ' + DASH2 + ' .:4', { oct: 1, v: 0.85 }), L), { vol: 0.95, rev: 0.2, dly: 0.1 }),
        part('stac', arp(P, '0 1 2 1 0 1 2 1', { lo: 55, hi: 72, n: 3, u: 1 }), { vol: 0.4 }),
        part('dbass', bass(P, 'R.R.R.RR', { lo: 36 }), { vol: 0.8 }),
        part('kick', cat(rep(drum('x..x..x.x.x..x..'), 2), drum('x...')), { vol: 0.85 }),
        part('snare', cat(rep(drum('....x.......x...'), 2), drum('x.xx')), { vol: 0.6 }),
        part('hat', rep(drum('x.x.'), 9), { vol: 0.45 }),
        part('brass', comp(P, BOSS_RHYTHM, { lo: 60, hi: 76, n: 3, st: 0.7 }), { vol: 0.5, rev: 0.25 })
      ]; } },
      { name: 'sneak', at: 650, parts: function (L) { return [ // slowly sneaking
        part('pizz', fit(mel(km, '1:2 .:2 3:2 .:2 #4:2 .:2 5:2 .:2 6:2 5:2 #4:2 .:2', { oct: -1 }), L), { vol: 0.8, rev: 0.25 }),
        part('rim', drum('x...x...x...x...x...x...'), { vol: 0.35 }),
        part('sub', mel(km, '1,,:2 .:6 1,,:2 .:6 1,,:2 .:6'), { vol: 0.5 }),
        part('celesta', mel(kp, '.:12 5:1 6:1 5:2', { oct: 1, v: 0.5 }), { vol: 0.4, rev: 0.5 })
      ]; } },
      { name: 'friend', at: 850, parts: function (L) { return [ // a Master, but a friend (warm horns: Ab - Bb - C)
        part('horn', fit(mel(km, '3:6 4:6 5:4'), L), { vol: 0.8, rev: 0.45 }),
        part('strings', mel(km, '[Ab3,C4,Eb4]:6 [Bb3,D4,F4]:6 [C4,E4,G4]:4'), { vol: 0.4, rev: 0.45 }),
        part('harp', arp(prog('Ab:1.5 Bb:1.5 C:1'), '0 1 2 3', { lo: 60, hi: 79, n: 4, u: 1 }), { vol: 0.45, rev: 0.4 }),
        part('sub', mel(km, 'Ab1:6 Bb1:6 C2:4'), { vol: 0.5 })
      ]; } },
      { name: 'protect', at: 950, parts: function (L) { return [ // the Master steps in front of Dash (the dash cell, held)
        part('brass', fit(mel(k, '1:2 2:1 3:9', { oct: 1 }), L), { vol: 0.8, rev: 0.4 }),
        part('strings', mel(k, '[C4,E4,A4]:6 [B3,D4,G4]:6'), { vol: 0.45, rev: 0.4 }),
        part('timp', cat(drum('x.....', { m: 45 }), drum('x.....', { m: 43 })), { vol: 0.6, rev: 0.3 }),
        part('snare', crescendo(drum('oooooooooooo'), 0.3, 1), { vol: 0.5 })
      ]; } },
      { name: 'sacrifice', at: 1040, parts: function (L) { return [ // the sacrifice (the impact itself is a sound effect)
        part('strings', fit(mel(km, '[Db4,F4,Ab4,C5]:10 [B3,D4,F4,G4]:10'), L), { vol: 0.5, rev: 0.5 }),
        part('choir', mel(km, '[F4,Ab4,C5]:10 [F4,G4,B4]:10'), { vol: 0.45, rev: 0.6 }),
        part('brass', mel(km, '[Db3,Ab3]:10 [G2,D3]:10'), { vol: 0.55, rev: 0.4 }),
        part('timp', crescendo(drum('xxxxxxxxxxxxxxxxxxxx', { m: 37 }), 1, 0.2), { vol: 0.5, rev: 0.4 }),
        part('sub', mel(km, 'Db1:10 G1:10'), { vol: 0.6 })
      ]; } },
      { name: 'realize', at: 1200, parts: function (L) { return [ // a realisation: the dash cell, alone, in minor; Db creeps into the drone
        part('musicbox', fit(mel(km, "1':4 2':2 3':10 .:12", { v: 0.6 }), L), { vol: 0.6, rev: 0.6, dly: 0.3 }),
        part('ooh', mel(km, '[C4,Eb4,G4]:28'), { vol: 0.3, rev: 0.6 }),
        part('drone', mel(km, '1,,:20 b2,,:8'), { vol: 0.55 })
      ]; } },
      { name: 'appear', at: 1400, parts: function (L) { return [ // something huge arrives (C, then Db)
        part('brass', fit(mel(km, '[C3,G3]:6 [Db3,Ab3]:6'), L), { vol: 0.75, rev: 0.4 }),
        part('dbass', mel(km, 'C2:6 Db2:6'), { vol: 0.8 }),
        part('timp', cat(drum('x.....', { m: 36 }), drum('x.....', { m: 37 })), { vol: 0.7 }),
        part('organ', mel(km, '[C4,G4,C5]:6 [Db4,Ab4,Db5]:6'), { vol: 0.45, rev: 0.4 })
      ]; } },
      { name: 'masterX', at: 1500, parts: function (L) { var X5 = XFIG + ' 5:4'; return [ // MASTER X: his figure, full force
        part('brass', fit(mel(km, X5), L), { vol: 0.9, rev: 0.4 }),
        part('choir', mel(km, X5, { oct: 1 }), { vol: 0.6, rev: 0.5 }),
        part('organ', mel(km, '[C3,G3,C4,Eb4]:4 [Db3,Ab3,Db4,F4]:4 [G2,D3,G3,B3]:4 [F#2,D3,A3,C4]:4 [G2,D3,G3,B3]:4'), { vol: 0.6, rev: 0.4 }),
        part('dbass', mel(km, 'C2:4 Db2:4 G1:4 F#1:4 G1:4'), { vol: 0.85 }),
        part('timp', cat(drum('x...', { m: 36 }), drum('x...', { m: 37 }), drum('x...', { m: 43 }), drum('x...', { m: 42 }), drum('xxxx', { m: 43 })), { vol: 0.75, rev: 0.35 }),
        part('crash', drum('x'), { vol: 0.55 }),
        part('taiko', drum('x...x...x...x...x.xx'), { vol: 0.7 })
      ]; } },
      { name: 'portal', at: 1650, parts: function (L) { return [ // the portal to the world
        part('celesta', fit(arp(prog('Cm:2.5 Db:2.5'), '0 1 2 3 2 1', { lo: 72, hi: 91, n: 4, u: 1 }), L), { vol: 0.45, rev: 0.5 }),
        part('dpad', mel(km, '[C3,G3,Eb4]:10 [Db3,Ab3,F4]:10'), { vol: 0.55, rev: 0.6 }),
        part('drone', mel(km, '1,,:20'), { vol: 0.6 }),
        part('bell', mel(km, '1:8 b2:8', { oct: 1 }), { vol: 0.5, rev: 0.6 }),
        part('riser', drum('x', { u: 20, m: 36 }), { vol: 0.35 })
      ]; } },
      { name: 'gift', at: 1800, parts: function (L) { return [ // a "masterful gift": the Dash motif turned Phrygian, on a music box
        part('musicbox', fit(mel(kp, DASH1 + ' .:4', { oct: 1, v: 0.6 }), L), { vol: 0.6, rev: 0.55, dly: 0.25 }),
        part('dpad', mel(km, '[C3,G3,Eb4]:8 [Db3,Ab3,F4]:8 [C3,G3,Eb4]:4'), { vol: 0.5, rev: 0.6 }),
        part('ooh', mel(km, '[Eb4,G4]:8 [F4,Ab4]:8 [Eb4,G4]:4'), { vol: 0.3, rev: 0.6 }),
        part('drone', mel(km, '1,,:20'), { vol: 0.55 })
      ]; } },
      { name: 'unknown', at: 1950, parts: function (L) { return [ // into the unknown: pulled toward the portal, everything rising
        part('strings', fit(mel(km, 'C4:4 Db4:4 D4:3 Eb4:3 E4:3 F4:3 F#4:4 G4:4'), L), { vol: 0.55, rev: 0.4 }),
        part('trem', mel(km, '[C3,G3]:28'), { vol: 0.45 }),
        part('riser', drum('x', { u: 28, m: 36 }), { vol: 0.5 }),
        part('snare', crescendo(drum('xxxxxxxxxxxxxxxxxxxxxxxxxxxx', { v: 0.5 }), 0.15, 1), { vol: 0.5 }),
        part('timp', crescendo(drum('x.x.x.x.x.x.x.x.x.x.x.x.xxxx', { m: 36 }), 0.2, 1), { vol: 0.55 }),
        part('dbass', mel(km, 'C2:28'), { vol: 0.6 })
      ]; } },
      { name: 'showdown', at: 2150, beats: 6, parts: function (L) { var P = prog('Cm:6'); return [ // a showdown in the tunnel: Stage 2 is next
        part('brass', fit(comp(P, BOSS_RHYTHM, { lo: 60, hi: 76, n: 3, st: 0.7 }), L), { vol: 0.65, rev: 0.3 }),
        part('dbass', xOst(P, { lo: 36 }), { vol: 0.85 }),
        part('organ', mel(km, '[C4,G4,C5]:12 [Db4,Ab4,Db5]:12'), { vol: 0.5, rev: 0.4 }),
        part('taiko', drum('x...x...x.x.x...x.x.x.x.'), { vol: 0.8 }),
        part('kick', drum('x..x..x.x..x..x.x.x.xxxx'), { vol: 0.8 }),
        part('snare', cat(rest(16), crescendo(drum('xxxxxxxx'), 0.5, 1.2)), { vol: 0.6 })
      ]; } }
    ], hold: function () { return [part('drone', mel(km, '1,,:16'), { vol: 0.6 }), part('timp', drum('x...........x...', { m: 36 }), { vol: 0.4 })]; } });
  })();

  // "victory" (the ending, ~36 s), 100 BPM: a beat is 36 frames. Dash strikes, the X
  // figure is sealed away (its tritone finally resolves), the Parkour Master returns, the
  // Champion's fanfare, and the Adventure Tune while he thanks Dash. The very last phrase
  // is the Dash motif, and this time it resolves home to C.
  (function () {
    var k = K('C4', 'major'), kx = K('C4', 'minor');
    cueSong('ending', { bpm: 100, cut: 'victory', scenes: [
      { name: 'dash', at: 0, parts: function (L) { return [
        part('riser', fit(drum('x', { u: 4, m: 48 }), L), { vol: 0.5 }),
        part('snare', crescendo(drum('xxxx'), 0.5, 1.1), { vol: 0.5 })
      ]; } },
      { name: 'impact', at: 30, parts: function (L) { return [ // the impact itself is a sound effect
        part('brass', fit(mel(k, '[C4,E4,G4,C5]:12'), L), { vol: 0.8, rev: 0.45 }),
        part('strings', mel(k, '[C4,G4,C5,E5]:12'), { vol: 0.5, rev: 0.5 }),
        part('crash', drum('x'), { vol: 0.6 }),
        part('timp', crescendo(drum('x.xxxxxxxxxx', { m: 36 }), 1, 0.3), { vol: 0.6 })
      ]; } },
      { name: 'sealed', at: 150, parts: function (L) { return [ // sealed away: C Db G F# ... G ... C
        part('bell', fit(mel(kx, "1:2 b2:2 5:2 #4:2 5:4 1':4", { oct: 1 }), L), { vol: 0.65, rev: 0.6 }),
        part('dpad', mel(kx, '[C3,G3,Eb4]:8 [G2,D3,B3]:4 [C3,G3,E4]:4'), { vol: 0.45, rev: 0.6 }),
        part('strings', mel(k, '.:12 [C4,E4,G4]:4'), { vol: 0.4, rev: 0.5 }),
        part('sub', mel(k, 'C2:8 G1:4 C2:4'), { vol: 0.5 })
      ]; } },
      { name: 'regen', at: 300, parts: function (L) { var P = prog('C:4 Am:4 C:2 F:2 G:2'); return [ // the Parkour Master returns: the Adventure Tune, slow and warm
        part('horn', fit(mel(k, ADV[0] + ' ' + ADV[1] + ' ' + ADV[2] + ' .:8'), L), { vol: 0.85, rev: 0.45 }),
        part('strings', crescendo(pad(P, { lo: 52, hi: 69 }), 0.5, 1), { vol: 0.4, rev: 0.5 }),
        part('harp', arp(P, '0 1 2 3 2 1 2 1', { lo: 60, hi: 79, n: 4, u: 2 }), { vol: 0.4, rev: 0.4 }),
        part('pbass', bass(P, 'R-------5-------', { lo: 36 }), { vol: 0.6 }),
        part('glock', mel(k, '.:48 5,:2 6,:2 7,:4', { oct: 2, v: 0.6 }), { vol: 0.5, rev: 0.4 }),
        part('swell', cat(rest(48), drum('x', { u: 8 })), { vol: 0.5 })
      ]; } },
      { name: 'ceremony', at: 800, parts: function (L) { var P = prog('C:4 G:1.5 C:3.5'); return [ // the Champion's ceremony (confetti!): the Title's fanfare
        part('brass', fit(mel(k, "1:2 2:1 3:5 .:2 3:2 4:1 5:3 5:2 6:1 7:2 .:1 1':10 .:4", { oct: 1 }), L), { vol: 0.9, rev: 0.35 }),
        part('horn', mel(k, "[1,5]:2 [2,6]:1 [3,1']:5 .:2 [3,1']:2 [4,2']:1 [5,3']:3 [5,3]:2 [6,4]:1 [7,5]:2 .:1 [1',5]:10 .:4"), { vol: 0.65, rev: 0.35 }),
        part('strings', pad(P, { lo: 55, hi: 76 }), { vol: 0.45, rev: 0.4 }),
        part('pbass', bass(P, 'R-.R-.R.R-.R-.5a', { lo: 36 }), { vol: 0.85 }),
        part('glock', arp(P, '0 . 2 . 1 . 3 .', { lo: 72, hi: 88, n: 4, u: 2 }), { vol: 0.3, rev: 0.35 }),
        part('timp', cat(drum('X..x............', { m: 36 }), drum('......X.........', { m: 43 }), drum('x...', { m: 36 })), { vol: 0.7, rev: 0.3 }),
        part('kick', drum('x..x....x.x.....x..x....x.x.....x...'), { vol: 0.85 }),
        part('snare', drum('....x.......x.......x.......x.xxxx..'), { vol: 0.6 }),
        part('crash', cat(drum('x'), rest(15), drum('x')), { vol: 0.55, rev: 0.25 })
      ]; } },
      { name: 'bluey', at: 1100, parts: function (L) { var P = prog('C:2 G/B:2 Am:1'); return [ // Bluey the Circle: the Dash motif, bouncy
        part('marimba', fit(mel(k, DASH1 + ' .:4', { oct: 1 }), L), { vol: 0.7, rev: 0.3 }),
        part('glock', mel(k, DASH1 + ' .:4', { oct: 2, v: 0.5 }), { vol: 0.45, rev: 0.4 }),
        part('pizz', arp(P, '0 1 2 1', { lo: 55, hi: 72, n: 3, u: 2 }), { vol: 0.5 }),
        part('pbass', bass(P, 'R...5...', { lo: 36 }), { vol: 0.6 }),
        part('kick', drum('x.......x.......x...'), { vol: 0.5 }),
        part('clap', drum('....x.......x.......'), { vol: 0.35 })
      ]; } },
      { name: 'thanks', at: 1300, beats: 24, parts: function (L) { // the Parkour Master thanks Dash
        var P = prog('C | Am | C:2 F:2 | G7 | Am:2 G:2 | F/C:2 C:2');
        var tune = [ADV[0], ADV[1], ADV[2], ADV[3], DASH2, '1:16'].join(' | ');
        return [
          part('flute', fit(mel(k, tune, { oct: 1 }), L), { vol: 0.9, rev: 0.35, dly: 0.12 }),
          part('strings', pad(P, { lo: 53, hi: 72 }), { vol: 0.3, rev: 0.45 }),
          part('harp', arp(P, '0 1 2 3 2 1 2 1', { lo: 60, hi: 79, n: 4, u: 2 }), { vol: 0.4, rev: 0.35 }),
          part('pbass', bass(P, 'R-.5-.R.R-.5-.8a', { lo: 36 }), { vol: 0.75 }),
          part('kick', cat(rep(drum('x.....x.x.......'), 5), drum('x')), { vol: 0.6 }),
          part('snare', rep(drum('....x.......x...'), 5), { vol: 0.4 }),
          part('shaker', rep(drum('oxoxoxoxoxoxoxox'), 5), { vol: 0.35 }),
          // "Let's hear it for Dash Parkour!!"
          part('brass', cat(rest(48), mel(k, "[5,7]:2 [6,1']:1 [7,2']:2 .:1 [7,2']:10")), { vol: 0.6, rev: 0.35 }),
          part('crash', cat(rest(48), drum('x'), rest(31), drum('x')), { vol: 0.5, rev: 0.3 }),
          // the last bar: the motif comes home
          part('timp', cat(rest(76), crescendo(drum('xxxx', { m: 43 }), 0.5, 1), drum('X', { m: 36 })), { vol: 0.6, rev: 0.4 }),
          part('glock', cat(rest(80), mel(k, "1':16", { oct: 1, v: 0.6 })), { vol: 0.45, rev: 0.5 })
        ];
      } }
    ], holdBeats: 2, hold: function () { return [part('strings', mel(k, '[C4,E4,G4,C5]:8'), { vol: 0.22, rev: 0.6 })]; } });
  })();
})();

/* =====================================================================
   DASH Parkour sound effects (all synthesized; see dash-audio.js)
   Each effect: { play(E, t, out, vol, opt), ui, vol, gap, duck }
     ui   true = plays on the menu/music context (keeps going in the
          pause menu); otherwise on the game context (freezes on pause)
     gap  the same effect can't restart sooner than this (seconds)
     duck how much the music dips under it (0..1)
   Effects are pitched into the soundtrack's keys, and several of them
   play pieces of the Dash motif (C D E = its "dash" cell).
   ===================================================================== */
(function () {
  'use strict';
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function semi(n) { return Math.pow(2, n / 12); }

  // --- little building blocks (E = engine, o = output node)
  function tone(E, type, f1, f2, t, len, v, o, a) {
    var h = E.helpers, g = h.gain(0, o), os = h.osc(type, f1, t, g);
    if (f2 && f2 !== f1) os.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + len);
    os.start(t); os.stop(h.perc(g.gain, t, v, a || 0.003, len));
    return os;
  }
  function hiss(E, type, f, q, t, len, v, o, a, f2) {
    var h = E.helpers, g = h.gain(0, o), fl = h.filt(type, f, q, g), s = h.noiseSrc(t, fl);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + len);
    s.stop(h.perc(g.gain, t, v, a || 0.002, len));
  }
  function swell(E, type, f, q, t, len, v, o, f2) { // noise that rises then cuts
    var h = E.helpers, g = h.gain(0, o), fl = h.filt(type, f, q, g), s = h.noiseSrc(t, fl);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.03);
    s.stop(t + len + 0.05);
  }
  function play(E, inst, midi, t, dur, v, o, p) { E.inst[inst](t, dur, midi, v, o, p || {}); }
  function seq(E, inst, notes, gap, dur, v, o, t, p) {
    notes.forEach(function (n, i) { if (n !== null) play(E, inst, n, t + i * gap, dur, v, o, p); });
  }
  function wet(E, o, amt) { // a little hall for big moments
    if (!E.sfxRevIn) return o;
    var g = E.helpers.gain(1, o); g.connect(E.helpers.gain(amt, E.sfxRevIn));
    return g;
  }

  var C4 = 60;
  var SFX = window.DASH_SFX = {
    /* ------------------------------------------------ menus */
    click: { ui: true, gap: 0.04, play: function (E, t, o, v) {
      tone(E, 'sine', 1250, 900, t, 0.05, 0.3 * v, o); tone(E, 'triangle', 2500, 2500, t, 0.015, 0.08 * v, o);
    } },
    hover: { ui: true, gap: 0.06, play: function (E, t, o, v) { tone(E, 'sine', 1700, 1900, t, 0.03, 0.07 * v, o); } },
    toggle: { ui: true, play: function (E, t, o, v, opt) {
      var up = opt.on !== false;
      tone(E, 'triangle', up ? 660 : 880, up ? 990 : 590, t, 0.06, 0.25 * v, o);
      play(E, 'glock', up ? 84 : 79, t + 0.035, 0.1, 0.35 * v, o);
    } },
    slider: { ui: true, gap: 0.03, play: function (E, t, o, v, opt) { tone(E, 'sine', 1000 + (opt.x || 0.5) * 900, 0, t, 0.02, 0.1 * v, o); } },
    sceneWipe: { ui: true, gap: 0.3, play: function (E, t, o, v) {
      swell(E, 'bandpass', 500, 1.2, t, 0.22, 0.22 * v, o, 3200); hiss(E, 'bandpass', 3000, 1, t + 0.22, 0.25, 0.14 * v, o, 0, 800);
    } },
    pauseOpen: { ui: true, play: function (E, t, o, v) { seq(E, 'glock', [79, 84], 0.06, 0.1, 0.4 * v, o, t); } },
    pauseClose: { ui: true, play: function (E, t, o, v) { seq(E, 'glock', [84, 79], 0.06, 0.1, 0.35 * v, o, t); } },
    levelStart: { ui: true, gap: 0.5, play: function (E, t, o, v) { // the dash cell, quick and bright
      var w = wet(E, o, 0.3);
      seq(E, 'chip', [72, 74, 76], 0.065, 0.06, 0.8 * v, w, t, { duty: 0.25 });
      play(E, 'glock', 88, t + 0.2, 0.3, 0.5 * v, w);
      swell(E, 'bandpass', 800, 1, t, 0.2, 0.1 * v, o, 5000);
    } },
    achievement: { ui: true, duck: 0.35, duckFor: 0.9, play: function (E, t, o, v) {
      var w = wet(E, o, 0.4);
      seq(E, 'bell', [76, 79, 84], 0.09, 0.4, 0.7 * v, w, t);
      play(E, 'bell', 88, t + 0.3, 1.2, 0.75 * v, w);
      hiss(E, 'highpass', 7000, 0.6, t + 0.28, 0.9, 0.06 * v, w);
    } },
    /* ------------------------------------------------ shop */
    buy: { ui: true, duck: 0.3, duckFor: 0.6, play: function (E, t, o, v) {
      var w = wet(E, o, 0.25);
      hiss(E, 'highpass', 6000, 0.7, t, 0.08, 0.2 * v, o);
      seq(E, 'vibes', [72, 74, 76, 79, 84], 0.055, 0.25, 0.8 * v, w, t + 0.02);
      play(E, 'glock', 91, t + 0.3, 0.5, 0.45 * v, w);
    } },
    equip: { ui: true, play: function (E, t, o, v) {
      hiss(E, 'bandpass', 1400, 1.3, t, 0.12, 0.2 * v, o, 0, 4000);
      seq(E, 'glock', [79, 84], 0.07, 0.15, 0.45 * v, o, t + 0.04);
    } },
    voucher: { ui: true, duck: 0.3, duckFor: 0.7, play: function (E, t, o, v) { // the motif's dash cell on bells
      var w = wet(E, o, 0.35);
      seq(E, 'bell', [72, 74, 76], 0.08, 0.3, 0.6 * v, w, t);
      play(E, 'bell', 84, t + 0.27, 0.8, 0.65 * v, w);
    } },
    denied: { ui: true, play: function (E, t, o, v) {
      tone(E, 'square', 180, 150, t, 0.09, 0.08 * v, E.helpers.filt('lowpass', 1200, 0.7, o));
      tone(E, 'square', 180, 140, t + 0.11, 0.12, 0.08 * v, E.helpers.filt('lowpass', 1200, 0.7, o));
    } },
    /* ------------------------------------------------ Dash */
    jump: { gap: 0.06, play: function (E, t, o, v) {
      var f = rnd(330, 370);
      tone(E, 'square', f, f * 2.15, t, 0.11, 0.07 * v, E.helpers.filt('lowpass', 2600, 0.7, o));
      tone(E, 'sine', f, f * 2.1, t, 0.1, 0.12 * v, o);
      hiss(E, 'bandpass', 1200, 1, t, 0.06, 0.06 * v, o);
    } },
    land: { gap: 0.08, play: function (E, t, o, v) { // louder for harder landings (opt via vol)
      hiss(E, 'lowpass', rnd(380, 520), 0.8, t, 0.08, 0.4 * v, o);
      tone(E, 'sine', rnd(115, 130), 55, t, 0.09, 0.35 * v, o);
    } },
    trampoline: { gap: 0.08, play: function (E, t, o, v) {
      var h = E.helpers, g = h.gain(0, o), os = h.osc('sine', 200, t, g);
      os.frequency.exponentialRampToValueAtTime(rnd(780, 860), t + 0.22);
      var wob = h.osc('sine', 24, t), wg = h.gain(55); wob.connect(wg); wg.connect(os.frequency);
      var end = h.perc(g.gain, t, 0.3 * v, 0.004, 0.3);
      os.start(t); wob.start(t); os.stop(end); wob.stop(end);
      tone(E, 'triangle', 90, 60, t, 0.1, 0.25 * v, o);
    } },
    launcher: { gap: 0.2, duck: 0.15, play: function (E, t, o, v) {
      hiss(E, 'bandpass', 600, 1, t, 0.5, 0.25 * v, o, 0, 3500);
      tone(E, 'sawtooth', 110, 440, t, 0.4, 0.08 * v, E.helpers.filt('lowpass', 1800, 1, o));
      tone(E, 'sine', 70, 40, t, 0.25, 0.5 * v, o);
      seq(E, 'chip', [67, 72, 76], 0.06, 0.05, 0.5 * v, o, t + 0.05);
    } },
    launchLand: { gap: 0.2, play: function (E, t, o, v) {
      hiss(E, 'lowpass', 700, 0.8, t, 0.18, 0.45 * v, o); tone(E, 'sine', 100, 40, t, 0.2, 0.5 * v, o);
    } },
    hurt: { gap: 0.18, play: function (E, t, o, v, opt) {
      var k = opt.kind || 'hit';
      if (k === 'spike' || k === 'thorn') {
        hiss(E, 'highpass', 3000, 0.8, t, 0.07, 0.35 * v, o);
        tone(E, 'sawtooth', 520, 260, t, 0.14, 0.12 * v, E.helpers.filt('lowpass', 2500, 1, o));
      } else if (k === 'crush') {
        tone(E, 'sine', 90, 35, t, 0.3, 0.6 * v, o); hiss(E, 'lowpass', 600, 0.8, t, 0.25, 0.45 * v, o);
      }
      tone(E, 'square', 440, 220, t, 0.13, 0.09 * v, E.helpers.filt('lowpass', 1800, 0.8, o));
      tone(E, 'square', 415, 207, t + 0.09, 0.13, 0.07 * v, E.helpers.filt('lowpass', 1800, 0.8, o));
    } },
    burn: { gap: 0.25, vol: 0.8, play: function (E, t, o, v) { // lava sizzle (repeats while you're in it)
      hiss(E, 'highpass', rnd(2600, 3400), 0.7, t, 0.28, 0.2 * v, o, 0.04);
      for (var i = 0; i < 5; i++) hiss(E, 'bandpass', rnd(2000, 6000), 6, t + rnd(0, 0.22), 0.02, 0.2 * v, o);
    } },
    poison: { play: function (E, t, o, v) { // falling into poison: a deep gulp and bubbles
      tone(E, 'sine', 300, 90, t, 0.3, 0.4 * v, o);
      for (var i = 0; i < 6; i++) { var f = rnd(300, 700); tone(E, 'sine', f, f * 1.8, t + 0.1 + i * rnd(0.05, 0.09), 0.06, 0.18 * v, o); }
    } },
    zap: { duck: 0.2, play: function (E, t, o, v) { // electrocuted by a Zapp
      var h = E.helpers, g = h.gain(0, o), sh = E.ctx.createWaveShaper(); sh.curve = h.drive(8); sh.connect(g);
      var a = h.osc('sawtooth', 70, t, sh), l = h.osc('square', 31, t), lg = h.gain(60); l.connect(lg); lg.connect(a.frequency);
      var end = h.perc(g.gain, t, 0.22 * v, 0.003, 0.7);
      a.start(t); l.start(t); a.stop(end); l.stop(end);
      for (var i = 0; i < 9; i++) hiss(E, 'highpass', rnd(3000, 8000), 1, t + i * rnd(0.03, 0.07), 0.03, 0.3 * v, o);
    } },
    unzap: { play: function (E, t, o, v) { tone(E, 'triangle', 500, 900, t, 0.12, 0.15 * v, o); } },
    freeze: { duck: 0.15, play: function (E, t, o, v) { // frozen by an icicle
      var w = wet(E, o, 0.5);
      hiss(E, 'highpass', 5000, 1, t, 0.4, 0.25 * v, o, 0.005, 9000);
      seq(E, 'celesta', [96, 91, 88, 84, 79], 0.035, 0.2, 0.55 * v, w, t);
    } },
    thaw: { play: function (E, t, o, v) {
      for (var i = 0; i < 6; i++) hiss(E, 'bandpass', rnd(2500, 6000), 4, t + i * 0.04, 0.04, 0.3 * v, o);
      play(E, 'celesta', 84, t + 0.05, 0.2, 0.35 * v, o);
    } },
    decay: { gap: 0.4, play: function (E, t, o, v) {
      tone(E, 'sawtooth', 160, 90, t, 0.35, 0.1 * v, E.helpers.filt('lowpass', 700, 3, o));
      hiss(E, 'bandpass', 900, 2, t, 0.3, 0.12 * v, o);
    } },
    death: { duck: 0.5, duckFor: 0.8, play: function (E, t, o, v) {
      var w = wet(E, o, 0.3);
      hiss(E, 'lowpass', 1400, 0.8, t, 0.3, 0.55 * v, o);
      tone(E, 'sine', 160, 40, t, 0.4, 0.6 * v, o);
      // the motif's "drop" falling apart: C ... A ... down
      seq(E, 'chip', [72, 69, 65, 60], 0.09, 0.08, 0.55 * v, w, t + 0.05, { duty: 0.5 });
    } },
    respawn: { gap: 0.3, play: function (E, t, o, v) {
      var w = wet(E, o, 0.3);
      swell(E, 'bandpass', 1000, 1.5, t, 0.25, 0.12 * v, o, 6000);
      seq(E, 'glock', [72, 76, 79], 0.05, 0.2, 0.4 * v, w, t + 0.1);
    } },
    /* ------------------------------------------------ [v1.6] skin spawns and deaths */
    skinThud: { gap: 0.08, play: function (E, t, o, v) { // landing after a drop
      tone(E, 'sine', 150, 45, t, 0.2, 0.5 * v, o); hiss(E, 'lowpass', 700, 0.8, t, 0.12, 0.3 * v, o);
    } },
    skinWhoosh: { gap: 0.2, play: function (E, t, o, v) { // falling in / flying past
      swell(E, 'bandpass', 500, 1.2, t, 0.28, 0.2 * v, o, 2800); hiss(E, 'bandpass', 2500, 1, t + 0.28, 0.2, 0.1 * v, o, 0, 700);
    } },
    skinPop: { gap: 0.05, play: function (E, t, o, v) { // popping out (of a hat), a balloon going
      hiss(E, 'bandpass', 1800, 2, t, 0.05, 0.4 * v, o); tone(E, 'sine', 900, 220, t, 0.09, 0.35 * v, o);
    } },
    skinHat: { gap: 0.1, play: function (E, t, o, v) { // the hat flips onto his head: ta-da
      var w = wet(E, o, 0.3); seq(E, 'glock', [79, 84], 0.07, 0.25, 0.45 * v, w, t);
    } },
    skinTick: { gap: 0.025, vol: 0.8, play: function (E, t, o, v, opt) { // one piece (a pixel, a digit) landing
      var n = [72, 74, 76, 79, 81, 84, 86, 88];
      play(E, opt.inst || 'marimba', n[Math.max(0, Math.min(n.length - 1, opt.n | 0))], t, 0.06, 0.3 * v, o);
    } },
    skinGlitch: { gap: 0.06, play: function (E, t, o, v) { // Scary Larry: static and broken blips
      for (var i = 0; i < 5; i++) tone(E, 'square', rnd(150, 1800), 0, t + i * 0.03, 0.025, 0.06 * v, E.helpers.filt('lowpass', 4000, 1, o));
      hiss(E, 'bandpass', rnd(2000, 5000), 1.5, t, 0.15, 0.18 * v, o);
    } },
    skinShort: { gap: 0.1, duck: 0.15, play: function (E, t, o, v) { // Zapp shorting out
      for (var i = 0; i < 6; i++) hiss(E, 'bandpass', rnd(2500, 7000), 6, t + i * 0.05 + rnd(0, 0.03), 0.03, 0.4 * v, o);
      tone(E, 'sawtooth', 120, 60, t, 0.35, 0.08 * v, E.helpers.filt('lowpass', 1200, 2, o));
    } },
    skinPixels: { gap: 0.1, play: function (E, t, o, v) { // bursting into pixels
      seq(E, 'chip', [84, 79, 76, 72, 67, 60], 0.035, 0.04, 0.4 * v, o, t, { duty: 0.25 }); hiss(E, 'highpass', 3000, 1, t, 0.12, 0.12 * v, o);
    } },
    skinChomp: { gap: 0.1, play: function (E, t, o, v) { // the Dino's jaws snapping shut
      tone(E, 'square', 320, 70, t, 0.08, 0.12 * v, E.helpers.filt('lowpass', 1500, 1, o)); hiss(E, 'bandpass', 1200, 2, t, 0.05, 0.35 * v, o);
      tone(E, 'sine', 110, 50, t + 0.02, 0.12, 0.3 * v, o);
    } },
    skinPuff: { gap: 0.1, vol: 0.5, play: function (E, t, o, v) { // the Ninja: a soft puff of smoke
      swell(E, 'bandpass', 900, 0.8, t, 0.1, 0.15 * v, o, 1800); hiss(E, 'lowpass', 1500, 0.7, t + 0.1, 0.2, 0.1 * v, o);
    } },
    skinBoom: { gap: 0.3, duck: 0.4, play: function (E, t, o, v) { // Dash Brainrot going off
      play(E, 'boom', 0, t, 1.4, 0.9 * v, wet(E, o, 0.4)); play(E, 'crash', 0, t, 1, 0.5 * v, o); hiss(E, 'lowpass', 1800, 0.6, t, 0.9, 0.4 * v, o);
    } },
    skinCoins: { gap: 0.1, play: function (E, t, o, v) { // Money Dash: coins everywhere
      for (var i = 0; i < 5; i++) play(E, 'glock', 88 + Math.floor(rnd(0, 5)), t + i * 0.045, 0.15, 0.3 * v, o);
    } },
    skinFlap: { gap: 0.12, vol: 0.7, play: function (E, t, o, v) { // Kineto's wings
      hiss(E, 'lowpass', 900, 1, t, 0.08, 0.3 * v, o); hiss(E, 'lowpass', 700, 1, t + 0.1, 0.07, 0.2 * v, o);
    } },
    skinGrow: { gap: 0.2, play: function (E, t, o, v) { // something swelling into shape
      tone(E, 'sine', 300, 900, t, 0.3, 0.2 * v, o); play(E, 'glock', 84, t + 0.28, 0.3, 0.35 * v, wet(E, o, 0.3));
    } },
    checkpoint: { duck: 0.25, duckFor: 0.6, play: function (E, t, o, v) { // the dash cell C D E, rung out
      var w = wet(E, o, 0.45);
      seq(E, 'bell', [72, 74, 76], 0.07, 0.6, 0.55 * v, w, t);
      play(E, 'glock', 84, t + 0.21, 0.5, 0.45 * v, w);
      swell(E, 'highpass', 4000, 0.7, t, 0.2, 0.06 * v, w);
    } },
    sign: { gap: 1, vol: 0.7, play: function (E, t, o, v) { play(E, 'marimba', 79, t, 0.1, 0.4 * v, o); play(E, 'marimba', 84, t + 0.07, 0.1, 0.35 * v, o); } },
    /* ------------------------------------------------ level flow (jingles play on the music context) */
    levelComplete: { ui: true, duck: 1, duckFor: 3.2, play: function (E, t, o, v) {
      // the whole first bar of the motif as a fanfare, landing (for once) on a bright C major chord
      var w = wet(E, o, 0.35), s = 60 / 152 / 4;
      var mel = [[72, 0, 2], [74, 2, 1], [76, 3, 3], [77, 8, 2], [76, 10, 1], [74, 11, 1], [76, 12, 1], [79, 13, 3]];
      mel.forEach(function (n) { play(E, 'brass', n[0], t + n[1] * s, n[2] * s, 0.8 * v, w); play(E, 'glock', n[0] + 12, t + n[1] * s, n[2] * s, 0.4 * v, w); });
      var end = t + 16 * s;
      [60, 64, 67, 72, 76].forEach(function (m) { play(E, 'brass', m, end, 1.1, 0.7 * v, w); play(E, 'strings', m + 12, end, 1.2, 0.8 * v, w); });
      play(E, 'pbass', 36, end, 1.0, 0.9 * v, o); play(E, 'timp', 36, end, 1, 0.9 * v, w); play(E, 'crash', 0, end, 1, 0.7 * v, w);
      [0, 3, 8, 10].forEach(function (st) { play(E, 'kick', 0, t + st * s, 0.1, 0.7 * v, o); });
      play(E, 'snare', 0, t + 4 * s, 0.1, 0.5 * v, o); play(E, 'snare', 0, t + 12 * s, 0.1, 0.5 * v, o);
    } },
    levelExit: { ui: true, gap: 1, play: function (E, t, o, v) {
      swell(E, 'bandpass', 400, 1.2, t, 0.8, 0.2 * v, o, 4000);
      seq(E, 'harp', [60, 64, 67, 72, 76, 79, 84], 0.06, 0.5, 0.5 * v, wet(E, o, 0.4), t + 0.2);
    } },
    gameOver: { ui: true, duck: 1, duckFor: 4, play: function (E, t, o, v) {
      // the motif's drop in C minor, slow and heavy, ending on a low minor chord
      var w = wet(E, o, 0.5);
      tone(E, 'sine', 110, 30, t, 0.6, 0.8 * v, o); hiss(E, 'lowpass', 800, 0.7, t, 0.5, 0.5 * v, o);
      var s = 0.22;
      [[72, 0], [72, 1], [68, 2], [68, 3], [62, 5], [60, 6]].forEach(function (n) { play(E, 'horn', n[0] - 12, t + 0.5 + n[1] * s, s * 1.6, 0.85 * v, w); });
      [48, 55, 60, 63].forEach(function (m) { play(E, 'strings', m, t + 0.5 + 6 * s, 2.2, 0.8 * v, w); });
      play(E, 'timp', 36, t + 0.5 + 6 * s, 1.5, 0.8 * v, w);
    } },
    /* ------------------------------------------------ enemies (played with distance volume + pan) */
    boingJump: { gap: 0.1, play: function (E, t, o, v) {
      var f = rnd(160, 200), h = E.helpers, g = h.gain(0, o), os = h.osc('sine', f, t, g);
      os.frequency.exponentialRampToValueAtTime(f * 3, t + 0.18);
      os.start(t); os.stop(h.perc(g.gain, t, 0.3 * v, 0.004, 0.2));
    } },
    boingLand: { gap: 0.1, play: function (E, t, o, v) { tone(E, 'sine', 150, 60, t, 0.12, 0.35 * v, o); hiss(E, 'lowpass', 500, 1, t, 0.06, 0.2 * v, o); } },
    zappCrackle: { gap: 0.3, vol: 0.6, play: function (E, t, o, v) { for (var i = 0; i < 4; i++) hiss(E, 'bandpass', rnd(3000, 7000), 5, t + rnd(0, 0.2), 0.02, 0.35 * v, o); } },
    /* ------------------------------------------------ Guards */
    bossRumble: { duck: 0.2, play: function (E, t, o, v) {
      var h = E.helpers, g = h.gain(0, o), lp = h.filt('lowpass', 180, 2, g), s = h.noiseSrc(t, lp, 0.5);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7 * v, t + 1.2); g.gain.setTargetAtTime(0, t + 4, 0.6);
      s.stop(t + 6.5);
      tone(E, 'sine', 45, 38, t, 5, 0.3 * v, o, 1);
    } },
    bossBanner: { ui: true, duck: 0.3, play: function (E, t, o, v) {
      var w = wet(E, o, 0.4); play(E, 'hit', 54, t, 0.3, 0.7 * v, w); play(E, 'boom', 0, t, 1, 0.6 * v, o);
    } },
    bossHop: { gap: 0.12, play: function (E, t, o, v) { tone(E, 'sine', 120, 45, t, 0.22, 0.55 * v, o); hiss(E, 'lowpass', 600, 0.7, t, 0.15, 0.3 * v, o); } },
    bossShoot: { gap: 0.1, play: function (E, t, o, v) {
      tone(E, 'square', rnd(900, 1000), 250, t, 0.14, 0.09 * v, E.helpers.filt('lowpass', 3000, 1, o));
      hiss(E, 'bandpass', 2000, 2, t, 0.08, 0.12 * v, o);
    } },
    bulletPop: { gap: 0.05, vol: 0.7, play: function (E, t, o, v) { hiss(E, 'bandpass', 1500, 1.5, t, 0.12, 0.3 * v, o); tone(E, 'sine', 400, 120, t, 0.1, 0.2 * v, o); } },
    diveCharge: { gap: 1, play: function (E, t, o, v, opt) { // the wind-up before a dive
      var len = opt.len || 3.6;
      swell(E, 'bandpass', 300, 3, t, len, 0.18 * v, o, 2400);
      var h = E.helpers, g = h.gain(0, h.filt('lowpass', 1500, 2, o)), os = h.osc('sawtooth', 80, t, g);
      os.frequency.exponentialRampToValueAtTime(320, t + len);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * v, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.05);
      os.start(t); os.stop(t + len + 0.1);
    } },
    diveSlam: { duck: 0.3, play: function (E, t, o, v) { play(E, 'boom', 0, t, 1, 0.8 * v, o); hiss(E, 'highpass', 2000, 0.7, t, 0.3, 0.25 * v, o); } },
    bombThrow: { gap: 0.1, play: function (E, t, o, v) { hiss(E, 'bandpass', 900, 1.5, t, 0.2, 0.2 * v, o, 0, 2500); tone(E, 'triangle', 300, 600, t, 0.15, 0.1 * v, o); } },
    bombExplode: { gap: 0.06, duck: 0.2, play: function (E, t, o, v) {
      tone(E, 'sine', 95, 30, t, 0.5, 0.75 * v, o); hiss(E, 'lowpass', 1800, 0.6, t, 0.45, 0.6 * v, o, 0.002, 300);
      hiss(E, 'highpass', 3000, 0.6, t, 0.15, 0.25 * v, o);
    } },
    icicleForm: { gap: 0.15, vol: 0.7, play: function (E, t, o, v) { play(E, 'celesta', 91 + Math.floor(rnd(0, 3)) * 2, t, 0.2, 0.3 * v, o); hiss(E, 'highpass', 7000, 1, t, 0.15, 0.06 * v, o); } },
    icicleShatter: { gap: 0.06, play: function (E, t, o, v) {
      for (var i = 0; i < 6; i++) hiss(E, 'bandpass', rnd(3500, 9000), 6, t + i * rnd(0.01, 0.03), 0.05, 0.3 * v, o);
      play(E, 'celesta', 96, t, 0.15, 0.25 * v, o);
    } },
    spikeWave: { gap: 0.2, play: function (E, t, o, v) {
      for (var i = 0; i < 4; i++) { play(E, 'anvil', 72 + i * 2, t + i * 0.035, 0.1, 0.5 * v, o); }
      hiss(E, 'highpass', 2500, 0.8, t, 0.25, 0.25 * v, o);
    } },
    bossTired: { duck: 0.2, play: function (E, t, o, v) { // the opening: a bright "now!" (the dash cell)
      var w = wet(E, o, 0.4);
      seq(E, 'glock', [78, 80, 81], 0.07, 0.3, 0.6 * v, w, t);
      tone(E, 'sine', 300, 140, t, 0.5, 0.12 * v, o);
    } },
    bossRecover: { play: function (E, t, o, v) { tone(E, 'sawtooth', 110, 220, t, 0.35, 0.08 * v, E.helpers.filt('lowpass', 900, 2, o)); } },
    bossHit: { duck: 0.35, duckFor: 0.5, play: function (E, t, o, v) { // Dash dashing into the Guard
      var w = wet(E, o, 0.3);
      tone(E, 'sine', 180, 50, t, 0.3, 0.75 * v, o);
      hiss(E, 'highpass', 1500, 0.7, t, 0.25, 0.45 * v, o);
      play(E, 'anvil', 79, t, 0.2, 0.6 * v, w);
      seq(E, 'chip', [72, 76, 79], 0.04, 0.05, 0.4 * v, w, t + 0.03, { duty: 0.25 });
    } },
    bossDefeat: { duck: 0.4, play: function (E, t, o, v) {
      var w = wet(E, o, 0.5);
      play(E, 'boom', 0, t, 2, 1.0 * v, o);
      hiss(E, 'lowpass', 3000, 0.6, t, 1.2, 0.6 * v, w, 0.003, 200);
      for (var i = 0; i < 8; i++) hiss(E, 'bandpass', rnd(1500, 6000), 3, t + 0.05 + i * rnd(0.04, 0.09), 0.08, 0.3 * v, w);
    } },
    bossFanfare: { ui: true, duck: 1, duckFor: 3.5, play: function (E, t, o, v) {
      // the motif's dash cell climbing three times, then a big chord
      var w = wet(E, o, 0.4), s = 0.1;
      [[0, [72, 74, 76]], [0.42, [76, 77, 79]], [0.84, [79, 81, 83]]].forEach(function (g) {
        g[1].forEach(function (m, i) { play(E, 'brass', m, t + g[0] + i * s, s * (i === 2 ? 2.5 : 1), 0.8 * v, w); });
        play(E, 'timp', 36, t + g[0], 0.4, 0.6 * v, w);
      });
      var e = t + 1.3;
      [60, 64, 67, 72, 76, 84].forEach(function (m) { play(E, 'brass', m, e, 1.5, 0.7 * v, w); play(E, 'strings', m, e, 1.7, 0.7 * v, w); });
      play(E, 'crash', 0, e, 1, 0.8 * v, w); play(E, 'timp', 36, e, 1.4, 0.9 * v, w); play(E, 'pbass', 36, e, 1.3, 0.9 * v, o);
      seq(E, 'glock', [84, 88, 91, 96], 0.07, 0.4, 0.4 * v, w, e + 0.1);
    } },
    /* ------------------------------------------------ the Parkour Master */
    cloneSummon: { play: function (E, t, o, v) {
      var w = wet(E, o, 0.5);
      swell(E, 'bandpass', 900, 4, t, 0.5, 0.18 * v, w, 300);
      seq(E, 'musicbox', [72, 73, 79, 78], 0.09, 0.3, 0.5 * v, w, t + 0.2); // the Area X portal figure
    } },
    cloneVanish: { play: function (E, t, o, v) { hiss(E, 'bandpass', 2000, 3, t, 0.5, 0.15 * v, wet(E, o, 0.5), 0.01, 400); } },
    laserCharge: { gap: 0.8, play: function (E, t, o, v) {
      var h = E.helpers, g = h.gain(0, o), os = h.osc('sawtooth', 200, t, h.filt('lowpass', 2500, 4, g));
      os.frequency.exponentialRampToValueAtTime(1200, t + 1.3);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * v, t + 1.3); g.gain.linearRampToValueAtTime(0, t + 1.35);
      os.start(t); os.stop(t + 1.4);
    } },
    laserFire: { gap: 0.3, duck: 0.25, play: function (E, t, o, v) {
      var h = E.helpers, g = h.gain(0, o), sh = E.ctx.createWaveShaper(); sh.curve = h.drive(5); sh.connect(h.filt('lowpass', 4000, 1, g));
      var a = h.osc('sawtooth', 110, t, sh), b = h.osc('square', 111.5, t, sh);
      var end = h.adsr(g.gain, t, 0.38, 0.18 * v, 0.005, 0.1, 0.8, 0.12);
      a.start(t); b.start(t); a.stop(end); b.stop(end);
      hiss(E, 'highpass', 3000, 0.7, t, 0.4, 0.25 * v, o);
      tone(E, 'sine', 120, 40, t, 0.3, 0.5 * v, o);
    } },
    hazardFall: { gap: 0.25, vol: 0.6, play: function (E, t, o, v) { tone(E, 'sine', rnd(1500, 1800), 500, t, 0.5, 0.06 * v, o, 0.1); } },
    decayZone: { gap: 0.5, play: function (E, t, o, v) {
      var w = wet(E, o, 0.5); tone(E, 'sawtooth', 90, 70, t, 1.0, 0.1 * v, E.helpers.filt('lowpass', 500, 4, w), 0.3); swell(E, 'bandpass', 600, 3, t, 0.8, 0.12 * v, w, 200);
    } },
    poisonWave: { gap: 2, duck: 0.15, play: function (E, t, o, v) {
      var h = E.helpers, g = h.gain(0, o), lp = h.filt('lowpass', 300, 1, g), s = h.noiseSrc(t, lp, 0.6);
      lp.frequency.linearRampToValueAtTime(1100, t + 2.5);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 2); g.gain.setTargetAtTime(0, t + 3.5, 0.5);
      s.stop(t + 5.5);
      for (var i = 0; i < 10; i++) { var f = rnd(200, 500); tone(E, 'sine', f, f * 1.7, t + 0.3 + i * 0.25, 0.08, 0.12 * v, o); }
    } },
    /* ------------------------------------------------ the vortex (Master X) */
    fireball: { gap: 0.12, play: function (E, t, o, v) { hiss(E, 'bandpass', 700, 1, t, 0.45, 0.3 * v, o, 0.02, 2500); tone(E, 'sawtooth', 120, 70, t, 0.4, 0.08 * v, E.helpers.filt('lowpass', 800, 1, o)); } },
    spikeWall: { gap: 0.4, play: function (E, t, o, v) { for (var i = 0; i < 6; i++) play(E, 'anvil', 64 + i, t + i * 0.03, 0.1, 0.4 * v, o); tone(E, 'sine', 80, 40, t, 0.3, 0.4 * v, o); } },
    vortexZap: { duck: 0.25, play: function (E, t, o, v) { SFX.zap.play(E, t, o, v); tone(E, 'sawtooth', 1800, 200, t, 0.3, 0.06 * v, o); } },
    thornShot: { gap: 0.1, play: function (E, t, o, v) { hiss(E, 'bandpass', 3000, 2, t, 0.12, 0.25 * v, o, 0, 900); tone(E, 'triangle', 700, 300, t, 0.1, 0.1 * v, o); } },
    poisonSpray: { gap: 0.3, play: function (E, t, o, v) { hiss(E, 'bandpass', 1800, 0.8, t, 0.6, 0.25 * v, o, 0.05); for (var i = 0; i < 5; i++) { var f = rnd(400, 900); tone(E, 'sine', f, f * 1.5, t + i * 0.09, 0.05, 0.1 * v, o); } } },
    vortexAlarm: { gap: 1, duck: 0.2, play: function (E, t, o, v) { // the vortex is collapsing
      var w = wet(E, o, 0.4);
      for (var i = 0; i < 3; i++) { tone(E, 'square', 660, 640, t + i * 0.28, 0.14, 0.06 * v, E.helpers.filt('lowpass', 2000, 1, w)); tone(E, 'square', 698, 680, t + i * 0.28 + 0.14, 0.12, 0.05 * v, E.helpers.filt('lowpass', 2000, 1, w)); }
    } },
    touchpoint: { gap: 0.05, duck: 0.15, play: function (E, t, o, v, opt) {
      // each touchpoint plays the next note of the Dash motif (C D E F E D ...), so clearing them spells it out
      var notes = [72, 74, 76, 77, 76, 74, 76, 74];
      var m = notes[(opt.n || 0) % notes.length];
      var w = wet(E, o, 0.5);
      play(E, 'bell', m, t, 0.8, 0.7 * v, w); play(E, 'glock', m + 12, t, 0.4, 0.4 * v, w);
      swell(E, 'highpass', 4000, 0.7, t, 0.15, 0.08 * v, w);
    } },
    vortexBreak: { duck: 0.5, duckFor: 1.2, play: function (E, t, o, v) {
      var w = wet(E, o, 0.6);
      play(E, 'boom', 0, t, 2, 1.0 * v, o);
      swell(E, 'bandpass', 300, 1, t, 0.5, 0.3 * v, w, 6000);
      hiss(E, 'highpass', 2000, 0.6, t + 0.5, 1.5, 0.3 * v, w);
      [48, 55, 60, 64, 67].forEach(function (m) { play(E, 'choir', m + 12, t + 0.45, 1.0, 0.5 * v, w); });
    } },
    vortexSwallow: { duck: 0.6, play: function (E, t, o, v) {
      var w = wet(E, o, 0.6); swell(E, 'lowpass', 2000, 1, t, 1.2, 0.4 * v, w, 100); tone(E, 'sine', 300, 30, t, 1.5, 0.5 * v, o, 0.3);
    } },
    /* ------------------------------------------------ cutscenes */
    cutImpact: { ui: true, gap: 0.2, play: function (E, t, o, v) { play(E, 'boom', 0, t, 1.5, 0.9 * v, wet(E, o, 0.5)); hiss(E, 'lowpass', 2000, 0.6, t, 0.6, 0.35 * v, o); } },
    cutWhoosh: { ui: true, gap: 0.2, play: function (E, t, o, v) { swell(E, 'bandpass', 400, 1, t, 0.35, 0.25 * v, o, 3000); hiss(E, 'bandpass', 3000, 1, t + 0.35, 0.3, 0.15 * v, o, 0, 600); } },
    victoryCatch: { ui: true, duck: 0.6, play: function (E, t, o, v) {
      var w = wet(E, o, 0.5); play(E, 'boom', 0, t, 1, 0.7 * v, o); play(E, 'crash', 0, t, 1, 0.8 * v, w);
      seq(E, 'glock', [72, 74, 76, 79, 84, 88], 0.05, 0.4, 0.5 * v, w, t + 0.05);
    } },
    /* ------------------------------------------------ multiplayer */
    playerJoin: { ui: true, play: function (E, t, o, v) { seq(E, 'vibes', [72, 76, 79], 0.07, 0.3, 0.6 * v, o, t); } },
    playerLeave: { ui: true, play: function (E, t, o, v) { seq(E, 'vibes', [79, 76, 72], 0.07, 0.3, 0.5 * v, o, t); } },
    chat: { ui: true, gap: 0.2, play: function (E, t, o, v) { play(E, 'marimba', 84, t, 0.1, 0.4 * v, o); play(E, 'marimba', 88, t + 0.06, 0.1, 0.3 * v, o); } },
    countBeep: { ui: true, gap: 0.3, play: function (E, t, o, v) { play(E, 'chip', 72, t, 0.12, 0.8 * v, o, { duty: 0.5 }); } },
    countGo: { ui: true, gap: 0.3, play: function (E, t, o, v) { play(E, 'chip', 84, t, 0.35, 0.9 * v, o, { duty: 0.5 }); play(E, 'chip', 79, t, 0.35, 0.6 * v, o, { duty: 0.25 }); play(E, 'crash', 0, t, 0.5, 0.4 * v, o); } },
    raceWin: { ui: true, duck: 0.6, play: function (E, t, o, v) { SFX.bossFanfare.play(E, t, o, v * 0.8); } },
    raceLose: { ui: true, play: function (E, t, o, v) { seq(E, 'chip', [67, 66, 65, 64], 0.16, 0.14, 0.6 * v, o, t, { duty: 0.5 }); } },
    /* ------------------------------------------------ admin tools */
    adminToggle: { ui: true, play: function (E, t, o, v) { tone(E, 'square', 500, 1000, t, 0.06, 0.07 * v, E.helpers.filt('lowpass', 3000, 1, o)); } },
    teleportOut: { play: function (E, t, o, v) { tone(E, 'sine', 300, 2400, t, 0.6, 0.2 * v, o); swell(E, 'highpass', 2000, 1, t, 0.5, 0.15 * v, o, 8000); } },
    teleportIn: { play: function (E, t, o, v) { tone(E, 'sine', 2400, 300, t, 0.6, 0.2 * v, o); hiss(E, 'highpass', 6000, 1, t, 0.5, 0.15 * v, o, 0, 2000); } },
    strikeLock: { play: function (E, t, o, v) { for (var i = 0; i < 3; i++) tone(E, 'square', 1500, 1500, t + i * 0.12, 0.05, 0.06 * v, o); } },
    strikeFire: { duck: 0.5, play: function (E, t, o, v) { play(E, 'boom', 0, t, 2, 1.0 * v, o); SFX.laserFire.play(E, t, o, v); hiss(E, 'highpass', 1500, 0.6, t, 1.2, 0.4 * v, o); } },
    strikeRing: { play: function (E, t, o, v) { var h = E.helpers, g = h.gain(0, o), os = h.osc('sine', 3500, t, g); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06 * v, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 3); os.start(t); os.stop(t + 3.1); } },
    skullBurst: { duck: 0.3, play: function (E, t, o, v) { play(E, 'boom', 0, t, 1, 0.7 * v, o); for (var i = 0; i < 8; i++) hiss(E, 'bandpass', rnd(1500, 5000), 3, t + i * 0.03, 0.06, 0.3 * v, o); } }
  };

  // Mix: levels measured against the music (see games/dash-parkour/AUDIO.md).
  // Frequent feedback (jump, hurt) sits a little under the music; big moments
  // sit level with it and dip it (duck); repeated attack sounds stay modest.
  var MIX = {
    jump: 1.7, hurt: 3, bossShoot: 2, bombThrow: 2, bombExplode: 0.55, bossHop: 0.55, zappCrackle: 1.6,
    thornShot: 2, fireball: 2, laserCharge: 1.4, decay: 1.8, vortexAlarm: 2.2, unzap: 1.5, denied: 1.4,
    icicleShatter: 0.7, icicleForm: 0.8, bossDefeat: 0.7, cutImpact: 0.7, vortexBreak: 0.7, diveSlam: 0.7,
    strikeFire: 0.75, skullBurst: 0.75, vortexSwallow: 0.8, click: 1.2, hover: 1.4, cloneVanish: 1.8
  };
  for (var name in MIX) if (SFX[name]) SFX[name].vol = (SFX[name].vol || 1) * MIX[name];
})();

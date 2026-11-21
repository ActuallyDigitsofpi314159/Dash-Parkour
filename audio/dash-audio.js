/* =====================================================================
   DASH Parkour audio engine
   ---------------------------------------------------------------------
   Every song and sound effect in DASH Parkour is synthesized live with
   Web Audio from the note data in dash-music.js and the recipes in
   dash-sfx.js, so the game needs no sound files.

   Files (load in this order):
     audio/dash-audio.js   this engine: instruments, effects, the music
                           player (sections, layers, beat-synced changes)
     audio/dash-music.js   composition helpers + every song (DASH_SONGS)
     audio/dash-sfx.js     every sound effect (DASH_SFX)

   Live use (the game does this through dashMusic / dashSfx):
     DashAudio.music('area1');          start / switch song ('' = silence)
     DashAudio.state({ boss: 'attack' });  tell the song what is happening
     DashAudio.sfx('jump');             play a sound effect
     DashAudio.pause(true);             pause menu: game sounds freeze,
                                        music gets quieter and muffled
   Offline (tests, the sound test page):
     DashAudio.render('title', 60, script) -> Promise<AudioBuffer>
   ===================================================================== */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;

  /* ================================================================
     Small helpers
     ================================================================ */
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ================================================================
     makeEngine(ctx): instruments + effects bound to one AudioContext.
     The live game uses two (music/menus, and game sounds that freeze
     on pause); offline renders use an OfflineAudioContext.
     ================================================================ */
  function makeEngine(ctx, opts) {
    opts = opts || {};
    var E = { ctx: ctx, lite: !!opts.lite };
    var sr = ctx.sampleRate;

    /* ---------- shared buffers ---------- */
    var noiseBuf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    (function () {
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    })();

    var curveCache = {};
    function drive(k) {
      if (curveCache[k]) return curveCache[k];
      var n = 2048, c = new Float32Array(n), t = Math.tanh(k);
      for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / t; }
      return (curveCache[k] = c);
    }

    var waveCache = {};
    function pulseWave(duty) {
      var key = 'p' + duty;
      if (waveCache[key]) return waveCache[key];
      var N = 48, re = new Float32Array(N), im = new Float32Array(N);
      for (var n = 1; n < N; n++) {
        re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
        im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
      }
      return (waveCache[key] = ctx.createPeriodicWave(re, im));
    }
    function organWave(weights) {
      var key = 'o' + weights.join(',');
      if (waveCache[key]) return waveCache[key];
      var N = weights.length + 1, re = new Float32Array(N), im = new Float32Array(N);
      for (var n = 1; n < N; n++) im[n] = weights[n - 1];
      return (waveCache[key] = ctx.createPeriodicWave(re, im));
    }

    // Karplus-Strong plucked string, rendered once per pitch and kept.
    var ksCache = {};
    function ksBuffer(midi, kind) {
      var key = kind + midi;
      if (ksCache[key]) return ksCache[key];
      var P = KS_KINDS[kind];
      var f = mtof(midi), len = Math.floor(sr * P.len);
      var buf = ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
      var b = P.bright, D = sr / f - (1 - b) * 0.5;
      var rho = Math.pow(0.001, 1 / (P.decay * f)); // reach -60 dB after `decay` seconds
      var period = Math.max(2, Math.round(sr / f)), lp = 0;
      for (var i = 0; i < len; i++) {
        var exc = 0;
        if (i < period) { var nz = Math.random() * 2 - 1; lp += P.pick * (nz - lp); exc = lp; }
        var pos = i - D, fb = 0;
        if (pos >= 1) {
          var k = Math.floor(pos), fr = pos - k;
          var a = y[k] * (1 - fr) + y[k + 1 < i ? k + 1 : k] * fr;
          var pv = pos - 1, k2 = Math.floor(pv), fr2 = pv - k2;
          var a2 = y[k2] * (1 - fr2) + y[k2 + 1] * fr2;
          fb = rho * (b * a + (1 - b) * 0.5 * (a + a2));
        }
        y[i] = exc + fb;
      }
      // normalise
      var pk = 0;
      for (i = 0; i < len; i++) pk = Math.max(pk, Math.abs(y[i]));
      if (pk > 0) for (i = 0; i < len; i++) y[i] /= pk;
      return (ksCache[key] = buf);
    }
    var KS_KINDS = {
      gtr: { len: 2.6, bright: 0.55, decay: 2.2, pick: 0.6 },
      harp: { len: 2.6, bright: 0.45, decay: 2.4, pick: 0.45 },
      pizz: { len: 0.7, bright: 0.1, decay: 0.45, pick: 0.35 },
      ubass: { len: 1.6, bright: 0.05, decay: 1.3, pick: 0.25 },
      koto: { len: 1.8, bright: 0.7, decay: 1.6, pick: 0.8 }
    };

    // Reverb: a generated hall (stereo noise that darkens as it fades).
    function makeIR(seconds) {
      var L = Math.floor(sr * seconds), ir = ctx.createBuffer(2, L, sr);
      for (var ch = 0; ch < 2; ch++) {
        var d = ir.getChannelData(ch), lp = 0, pre = Math.floor(sr * 0.012);
        for (var i = pre; i < L; i++) {
          var x = (i - pre) / (L - pre);
          var a = 0.25 + 0.65 * x;
          lp += (1 - a) * ((Math.random() * 2 - 1) - lp);
          d[i] = lp * Math.pow(1 - x, 2.2) * Math.exp(-x * 2.5);
        }
      }
      return ir;
    }

    /* ---------- node helpers ---------- */
    function gain(v, out) { var g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; if (out) g.connect(out); return g; }
    function filt(type, f, q, out) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; if (out) b.connect(out); return b; }
    function osc(type, f, t, out) {
      var o = ctx.createOscillator();
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.setValueAtTime(f, t);
      if (out) o.connect(out);
      return o;
    }
    function noiseSrc(t, out, rate) {
      var s = ctx.createBufferSource();
      s.buffer = noiseBuf; s.loop = true;
      if (rate) s.playbackRate.value = rate;
      s.connect(out);
      s.start(t, Math.random() * 1.5);
      return s;
    }
    function bufSrc(buf, t, out, rate) {
      var s = ctx.createBufferSource();
      s.buffer = buf;
      if (rate) s.playbackRate.setValueAtTime(rate, t);
      s.connect(out);
      s.start(t);
      return s;
    }
    // attack / decay-to-sustain / release. Returns the time it is silent.
    function adsr(p, t, dur, peak, a, d, s, r) {
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(peak, t + a);
      if (d > 0 && s < 1) p.setTargetAtTime(peak * s, t + a, d / 3);
      var rel = Math.max(t + a, t + dur);
      p.setTargetAtTime(0, rel, Math.max(0.005, r / 4));
      return rel + r * 1.6 + 0.02;
    }
    function perc(p, t, peak, a, decay) { // attack then exponential fade
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(peak, t + a);
      p.setTargetAtTime(0, t + a, decay / 4);
      return t + a + decay * 1.6 + 0.02;
    }
    function vibrato(o, t, end, f, rate, depth, delay) {
      var l = osc('sine', rate, t), g = gain(0);
      l.connect(g); g.connect(o.frequency);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(f * depth, t + (delay || 0.2) + 0.15);
      l.start(t); l.stop(end);
    }
    function stopAll(list, end) { for (var i = 0; i < list.length; i++) list[i].stop(end); }

    E.helpers = { gain: gain, filt: filt, osc: osc, noiseSrc: noiseSrc, bufSrc: bufSrc, adsr: adsr, perc: perc, vibrato: vibrato, drive: drive, pulseWave: pulseWave, ksBuffer: ksBuffer, mtof: mtof };

    /* ================================================================
       Instruments. inst(t, dur, midi, vel, out, p)
         t, dur in seconds; vel 0..1; out = the part's input node;
         p = the part's options (tone tweaks).
       ================================================================ */
    var I = {};

    // The Dash guitar: the motif's own electric guitar, overdriven a little.
    I.gtr = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 3200, 0.9, g);
      var pk = filt('peaking', 1400, 1.2, lp); pk.gain.value = 4;
      // (short riff chugs skip the oversampling: it costs a lot and their filter hides the difference)
      var sh = ctx.createWaveShaper(); sh.curve = drive(p.drive || 2.6); sh.oversample = E.lite || dur < 0.2 ? 'none' : '2x'; sh.connect(pk);
      var pre = gain(0.55, sh);
      // p.power: a power chord (root + fifth) through ONE distortion, like a real guitar,
      // instead of one distorted voice per note (a third of the work)
      var a = osc('sawtooth', f, t, pre), b = osc('sawtooth', p.power ? f * 1.4983 : f, t, pre), c = osc(pulseWave(0.3), f / 2, t, gain(p.power ? 0.5 : 0.35, pre));
      a.detune.value = p.power ? -4 : -7; b.detune.value = p.power ? 4 : 7;
      a.start(t); b.start(t); c.start(t);
      // pick attack: a short bright scrape
      var ng = gain(0, g), ns = noiseSrc(t, filt('bandpass', 3000, 1.5, ng));
      perc(ng.gain, t, 0.08 * v, 0.001, 0.03); ns.stop(t + 0.08);
      g.connect(out);
      var end = adsr(g.gain, t, dur, 0.24 * v, 0.004, 0.35, 0.62, p.rel || 0.12);
      if (dur > 0.28) { vibrato(a, t, end, f, 5.6, 0.0045, 0.25); vibrato(b, t, end, f, 5.6, 0.0045, 0.25); }
      if (p.bend) { a.detune.setValueAtTime(-7 - 100, t); a.detune.linearRampToValueAtTime(-7, t + 0.06); b.detune.setValueAtTime(7 - 100, t); b.detune.linearRampToValueAtTime(7, t + 0.06); }
      stopAll([a, b, c], end);
    };
    // Clean plucked guitar (rhythm), harp, pizzicato strings, upright bass, koto
    function ksInst(kind, level, tone) {
      return function (t, dur, m, v, out, p) {
        var g = gain(0, out), lp = filt('lowpass', (p.tone || tone), 0.5, g);
        var s = bufSrc(ksBuffer(m, kind), t, lp);
        var end = adsr(g.gain, t, Math.min(dur, KS_KINDS[kind].len), level * v, 0.002, 0, 1, p.rel || 0.09);
        s.stop(Math.min(end, t + KS_KINDS[kind].len));
      };
    }
    I.cgtr = ksInst('gtr', 0.5, 4200);
    I.harp = ksInst('harp', 0.5, 5000);
    I.pizz = ksInst('pizz', 0.75, 2400);
    I.koto = ksInst('koto', 0.45, 5200);
    I.ubass = function (t, dur, m, v, out, p) { // upright bass: a round, woody pluck (sine + triangle, closing filter)
      var f = mtof(m), g = gain(0, out), lp = filt('lowpass', 1400, 0.7, g);
      lp.frequency.setValueAtTime(1500, t); lp.frequency.setTargetAtTime(420, t, 0.07);
      var a = osc('triangle', f, t, lp), b = osc('sine', f, t, gain(0.9, g)), h = osc('sine', f * 2, t, gain(0.12, lp));
      var end = adsr(g.gain, t, dur * 0.92, 0.5 * v, 0.005, 0.32, 0.5, p.rel || 0.09);
      var ng = gain(0, g), ns = noiseSrc(t, filt('bandpass', 800, 1.2, ng)); // the finger on the string
      perc(ng.gain, t, 0.12 * v, 0.001, 0.035); ns.stop(t + 0.08);
      [a, b, h].forEach(function (o) { o.start(t); o.stop(end); });
    };

    // Flute-like lead
    I.flute = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 3600, 0.5, g); g.connect(out);
      var a = osc('sine', f, t, lp), b = osc('triangle', f, t, gain(0.55, lp)), b2 = osc('sawtooth', f, t, gain(0.08, lp));
      var ng = gain(0, lp), ns = noiseSrc(t, filt('bandpass', f * 2, 2, ng));
      var end = adsr(g.gain, t, dur, 0.33 * v, 0.035, 0.2, 0.85, p.rel || 0.09);
      adsr(ng.gain, t, dur, 0.06 * v, 0.02, 0.08, 0.35, 0.05); ns.stop(end);
      vibrato(a, t, end, f, 5.2, 0.006, 0.18); vibrato(b, t, end, f, 5.2, 0.006, 0.18);
      a.start(t); b.start(t); b2.start(t); stopAll([a, b, b2], end);
    };
    // Square / pulse lead (classic console)
    I.chip = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 4200, 0.6, g); g.connect(out);
      var a = osc(pulseWave(p.duty || 0.25), f, t, lp);
      var end = adsr(g.gain, t, dur, 0.18 * v, 0.004, 0.25, 0.7, p.rel || 0.06);
      if (dur > 0.22) vibrato(a, t, end, f, 6, 0.006, 0.18);
      a.start(t); a.stop(end);
    };
    // Brass section / solo trumpet-ish
    I.brass = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 500, 1.2, g); g.connect(out);
      var top = Math.min(9000, (p.tone || 1800) + f * 2.2);
      lp.frequency.setValueAtTime(350, t);
      lp.frequency.linearRampToValueAtTime(top, t + 0.05);
      lp.frequency.setTargetAtTime(top * 0.6, t + 0.06, 0.2);
      var list = [];
      [-8, 0, 8].forEach(function (dt) {
        var o = osc('sawtooth', f, t, lp); o.detune.setValueAtTime(dt - 25, t); o.detune.linearRampToValueAtTime(dt, t + 0.05); list.push(o);
      });
      var end = adsr(g.gain, t, dur, 0.16 * v, 0.022, 0.3, 0.75, p.rel || 0.13);
      lp.frequency.setTargetAtTime(400, Math.max(t + 0.05, t + dur), 0.05);
      if (dur > 0.3) list.forEach(function (o) { vibrato(o, t, end, f, 5.2, 0.004, 0.3); });
      list.forEach(function (o) { o.start(t); }); stopAll(list, end);
    };
    // Mellow horns (French horn-like)
    I.horn = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 420, 0.8, g); g.connect(out);
      lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime((p.tone || 900) + f, t + 0.09);
      var a = osc('sawtooth', f, t, lp), b = osc('triangle', f, t, gain(0.8, lp)); a.detune.value = -4; b.detune.value = 5;
      var end = adsr(g.gain, t, dur, 0.24 * v, 0.06, 0.4, 0.8, p.rel || 0.22);
      if (dur > 0.4) vibrato(a, t, end, f, 4.8, 0.003, 0.35);
      a.start(t); b.start(t); stopAll([a, b], end);
    };
    // String ensemble: legato, staccato and tremolo flavours
    function stringsInst(kind) {
      return function (t, dur, m, v, out, p) {
        var f = mtof(m), g = gain(0), tg = gain(1, g), lp = filt('lowpass', p.tone || 2800, 0.6, tg), hp = filt('highpass', 110, 0.5, lp); g.connect(out);
        var list = [];
        var dets = E.lite ? [-9, 9] : [-11, 0, 11];
        dets.forEach(function (dt) { var o = osc('sawtooth', f, t, hp); o.detune.value = dt + (Math.random() - 0.5) * 4; list.push(o); });
        var end;
        if (kind === 'stac') end = adsr(g.gain, t, Math.min(dur, 0.12), 0.17 * v, 0.008, 0.08, 0.6, 0.09);
        else end = adsr(g.gain, t, dur, 0.13 * v, p.att || 0.11, 0.5, 0.9, p.rel || 0.32);
        if (kind === 'trem') {
          var l = osc('sine', 13, t), lg = gain(0.45, null); l.connect(lg); tg.gain.value = 0.55; lg.connect(tg.gain); l.start(t); l.stop(end);
        }
        if (kind !== 'stac' && dur > 0.3) list.forEach(function (o) { vibrato(o, t, end, f, 5 + Math.random() * 0.6, 0.0035, 0.3); });
        list.forEach(function (o) { o.start(t); }); stopAll(list, end);
      };
    }
    I.strings = stringsInst('leg');
    I.stac = stringsInst('stac');
    I.trem = stringsInst('trem');
    // Choir ("ah" / "oo")
    function choirInst(formants) {
      return function (t, dur, m, v, out, p) {
        var f = mtof(m), g = gain(0); g.connect(out);
        var mix = gain(1);
        formants.forEach(function (fm) { var b = filt('bandpass', fm[0], fm[2], gain(fm[1], g)); mix.connect(b); });
        var list = [];
        [-9, 9].forEach(function (dt) { var o = osc('sawtooth', f, t, mix); o.detune.value = dt; list.push(o); });
        var end = adsr(g.gain, t, dur, 0.5 * v, p.att || 0.18, 0.4, 0.9, p.rel || 0.45);
        list.forEach(function (o) { vibrato(o, t, end, f, 5.1, 0.0055, 0.25); o.start(t); });
        stopAll(list, end);
      };
    }
    I.choir = choirInst([[730, 1, 6], [1090, 0.55, 7], [2440, 0.22, 8]]);
    I.ooh = choirInst([[350, 1, 5], [800, 0.4, 6], [2400, 0.12, 8]]);
    // Organs: drawbar (Area X / shop) and pipe (final boss)
    I.organ = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 5000, 0.5, g); g.connect(out);
      var o = osc(organWave([1, 0.9, 0.5, 0.45, 0, 0.3, 0, 0.25]), f / 2, t, lp);
      var trem = osc('sine', 6.4, t), tg = gain(0.12 * v); trem.connect(tg); tg.connect(g.gain);
      var end = adsr(g.gain, t, dur, 0.2 * v, 0.008, 0, 1, p.rel || 0.08);
      o.start(t); trem.start(t); o.stop(end); trem.stop(end);
    };
    I.pipe = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 3800, 0.4, g); g.connect(out);
      var w = organWave([1, 0.7, 0.55, 0.35, 0.3, 0.22, 0.18, 0.15, 0.1, 0.08, 0.06, 0.05]);
      var a = osc(w, f, t, lp), b = osc(w, f / 2, t, gain(0.6, lp)), c = osc('sine', f * 2, t, gain(0.25, lp));
      a.detune.value = 3; b.detune.value = -3;
      var end = adsr(g.gain, t, dur, 0.14 * v, 0.06, 0, 1, p.rel || 0.35);
      a.start(t); b.start(t); c.start(t); stopAll([a, b, c], end);
    };
    // Electric piano (FM tine), vibraphone, glockenspiel, celesta, music box, bell
    I.epiano = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0); g.connect(out);
      var car = osc('sine', f, t, g), mod = osc('sine', f, t), mg = gain(0); mod.connect(mg); mg.connect(car.frequency);
      mg.gain.setValueAtTime(f * 2.2 * v, t); mg.gain.setTargetAtTime(f * 0.25, t, 0.3);
      var tine = osc('sine', f * 14, t), tg = gain(0, g); tine.connect(tg);
      perc(tg.gain, t, 0.04 * v, 0.001, 0.06);
      var end = adsr(g.gain, t, dur, 0.3 * v, 0.003, 1.6, 0.35, p.rel || 0.25);
      [car, mod, tine].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.vibes = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0); g.connect(out);
      var a = osc('sine', f, t, g), b = osc('sine', f * 4, t, gain(0.12, g));
      var trem = osc('sine', 5.2, t), tg = gain(0.3 * 0.25 * v); trem.connect(tg); tg.connect(g.gain);
      var end = perc(g.gain, t, 0.25 * v, 0.002, Math.max(0.6, Math.min(2.4, dur + 0.8)));
      [a, b, trem].forEach(function (o) { o.start(t); o.stop(end); });
    };
    function malletInst(partials, decay, level, detuneCents) {
      return function (t, dur, m, v, out, p) {
        var f = mtof(m), list = [], end = t;
        var cents = detuneCents ? (Math.random() - 0.5) * detuneCents : 0;
        partials.forEach(function (pt) {
          var g = gain(0, out), o = osc('sine', f * pt[0], t, g); o.detune.value = cents;
          end = Math.max(end, perc(g.gain, t, level * pt[1] * v, 0.0015, decay * pt[2]));
          list.push(o); o.start(t);
        });
        stopAll(list, end);
      };
    }
    I.glock = malletInst([[1, 1, 1], [2.76, 0.35, 0.35], [5.4, 0.12, 0.15]], 1.3, 0.2);
    I.celesta = malletInst([[1, 1, 1], [2, 0.3, 0.5], [3, 0.12, 0.3]], 0.9, 0.22);
    I.musicbox = malletInst([[1, 1, 1], [3.01, 0.25, 0.4], [5.98, 0.1, 0.2]], 1.4, 0.2, 38);
    I.bell = malletInst([[1, 1, 1], [2, 0.5, 0.8], [2.76, 0.35, 0.6], [5.4, 0.18, 0.3], [0.5, 0.25, 1.2]], 2.6, 0.18);
    I.marimba = malletInst([[1, 1, 1], [4, 0.18, 0.15], [10, 0.05, 0.05]], 0.5, 0.32);

    // Basses
    I.bass = function (t, dur, m, v, out, p) { // synth bass with a quick filter snap
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 300, 3, g); g.connect(out);
      lp.frequency.setValueAtTime(p.snap || 1600, t); lp.frequency.setTargetAtTime(p.tone || 420, t, 0.07);
      var a = osc('sawtooth', f, t, lp), b = osc('square', f / 2, t, gain(0.5, lp)), c = osc('sine', f, t, gain(0.35, g));
      var end = adsr(g.gain, t, dur, 0.34 * v, 0.004, 0.25, 0.7, p.rel || 0.06);
      [a, b, c].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.pbass = function (t, dur, m, v, out, p) { // round picked electric bass
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 900, 0.7, g); g.connect(out);
      var a = osc('triangle', f, t, lp), b = osc('sawtooth', f, t, gain(0.25, lp)), c = osc('sine', f, t, gain(0.4, g));
      var end = adsr(g.gain, t, dur, 0.4 * v, 0.003, 0.5, 0.55, p.rel || 0.06);
      [a, b, c].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.dbass = function (t, dur, m, v, out, p) { // distorted rock bass (boss riffs)
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 1500, 0.9, g); g.connect(out);
      var sh = ctx.createWaveShaper(); sh.curve = drive(3.5); sh.connect(lp);
      var pre = gain(0.6, sh);
      var a = osc('sawtooth', f, t, pre), b = osc('square', f, t, gain(0.5, pre)), c = osc('sine', f, t, gain(0.5, g));
      b.detune.value = 6;
      var end = adsr(g.gain, t, dur, 0.3 * v, 0.003, 0.2, 0.75, p.rel || 0.05);
      [a, b, c].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.sub = function (t, dur, m, v, out, p) { // pure sub sine (cinematic low end)
      var g = gain(0, out), o = osc('sine', mtof(m), t, g);
      o.start(t); o.stop(adsr(g.gain, t, dur, 0.5 * v, 0.02, 0, 1, p.rel || 0.2));
    };
    // Pads and drones
    I.pad = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', p.tone || 1300, 0.6, g); g.connect(out);
      var a = osc('sawtooth', f, t, lp), b = osc('sawtooth', f, t, lp), c = osc('triangle', f / 2, t, gain(0.4, lp));
      a.detune.value = -9; b.detune.value = 9;
      var att = p.att || Math.min(0.6, dur * 0.35);
      var end = adsr(g.gain, t, dur, 0.11 * v, att, 0, 1, p.rel || 0.9);
      [a, b, c].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.dpad = function (t, dur, m, v, out, p) { // dark breathing pad (Area X)
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 500, 2.5, g); g.connect(out);
      var wob = osc('sine', 0.13 + Math.random() * 0.08, t), wg = gain(320); wob.connect(wg); wg.connect(lp.frequency);
      var a = osc('sawtooth', f, t, lp), b = osc('sawtooth', f * 1.003, t, lp), c = osc('sine', f / 2, t, gain(0.5, g));
      var att = p.att || Math.min(1.4, dur * 0.4);
      var end = adsr(g.gain, t, dur, 0.16 * v, att, 0, 1, p.rel || 1.4);
      [a, b, c, wob].forEach(function (o) { o.start(t); o.stop(end); });
    };
    I.drone = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0), lp = filt('lowpass', 380, 2, g); g.connect(out);
      var wob = osc('sine', 0.15, t), wg = gain(160); wob.connect(wg); wg.connect(lp.frequency);
      var a = osc('sawtooth', f, t, lp), b = osc('sine', f / 2, t, gain(0.6, g));
      var att = Math.min(1.2, dur * 0.4);
      var end = adsr(g.gain, t, dur, 0.24 * v, att, 0, 1, p.rel || 1.0);
      [a, b, wob].forEach(function (o) { o.start(t); o.stop(end); });
    };

    // Cinematic percussion
    I.timp = function (t, dur, m, v, out, p) {
      var f = mtof(m), g = gain(0, out), o = osc('sine', f * 1.03, t, g), o2 = osc('sine', f * 1.5, t, gain(0.25, g));
      o.frequency.setTargetAtTime(f, t, 0.03);
      var end = perc(g.gain, t, 0.55 * v, 0.003, p.decay || 1.3);
      var ng = gain(0, out), ns = noiseSrc(t, filt('lowpass', 700, 0.7, ng));
      perc(ng.gain, t, 0.25 * v, 0.002, 0.12); ns.stop(t + 0.3);
      o.start(t); o2.start(t); o.stop(end); o2.stop(end);
    };
    I.taiko = function (t, dur, m, v, out, p) {
      var g = gain(0, out), o = osc('sine', 95, t, g);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
      var end = perc(g.gain, t, 0.9 * v, 0.002, 0.75);
      var ng = gain(0, out), ns = noiseSrc(t, filt('lowpass', 400, 0.8, ng));
      perc(ng.gain, t, 0.5 * v, 0.002, 0.14); ns.stop(t + 0.3);
      o.start(t); o.stop(end);
    };

    // Drum kit
    I.kick = function (t, dur, m, v, out) {
      var g = gain(0, out), o = osc('sine', 160, t, g);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      var end = perc(g.gain, t, 0.78 * v, 0.002, 0.28);
      var cg = gain(0, out), c = osc('triangle', 1400, t, cg); c.frequency.exponentialRampToValueAtTime(300, t + 0.012);
      perc(cg.gain, t, 0.12 * v, 0.0005, 0.012);
      o.start(t); o.stop(end); c.start(t); c.stop(t + 0.05);
    };
    I.snare = function (t, dur, m, v, out, p) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 900, 0.5, filt('peaking', 3500, 1, g)));
      var end = perc(g.gain, t, 0.55 * v, 0.001, p.decay || 0.2);
      var bg = gain(0, out), o = osc('triangle', 200, t, bg); o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
      perc(bg.gain, t, 0.45 * v, 0.001, 0.08);
      ns.stop(end); o.start(t); o.stop(t + 0.2);
    };
    I.clap = function (t, dur, m, v, out) {
      var g = gain(0, out), bp = filt('bandpass', 1300, 1.2, g), ns = noiseSrc(t, bp);
      g.gain.setValueAtTime(0, t);
      [0, 0.011, 0.022].forEach(function (d) { g.gain.setValueAtTime(0.5 * v, t + d); g.gain.setTargetAtTime(0.05 * v, t + d + 0.001, 0.003); });
      g.gain.setValueAtTime(0.4 * v, t + 0.033); g.gain.setTargetAtTime(0, t + 0.034, 0.04);
      ns.stop(t + 0.3);
    };
    I.hat = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 7200, 0.6, g));
      ns.stop(perc(g.gain, t, 0.28 * v, 0.001, 0.045));
    };
    I.ohat = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 6800, 0.6, g));
      ns.stop(perc(g.gain, t, 0.24 * v, 0.002, 0.32));
    };
    I.ride = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('bandpass', 8000, 0.8, g));
      var bg = gain(0, out), o = osc('sine', 3150, t, bg), o2 = osc('sine', 4870, t, bg);
      perc(bg.gain, t, 0.04 * v, 0.001, 0.4);
      ns.stop(perc(g.gain, t, 0.16 * v, 0.001, 0.55)); o.start(t); o2.start(t); o.stop(t + 0.8); o2.stop(t + 0.8);
    };
    I.crash = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 4200, 0.5, g));
      var g2 = gain(0, out), ns2 = noiseSrc(t, filt('bandpass', 2400, 0.6, g2));
      perc(g2.gain, t, 0.1 * v, 0.002, 0.5); ns2.stop(t + 1);
      ns.stop(perc(g.gain, t, 0.32 * v, 0.002, 2.0));
    };
    I.tom = function (t, dur, m, v, out) {
      var f = mtof(m || 50), g = gain(0, out), o = osc('sine', f * 1.6, t, g);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      o.start(t); o.stop(perc(g.gain, t, 0.7 * v, 0.002, 0.38));
      var ng = gain(0, out), ns = noiseSrc(t, filt('lowpass', 1500, 0.7, ng)); perc(ng.gain, t, 0.12 * v, 0.001, 0.05); ns.stop(t + 0.15);
    };
    I.rim = function (t, dur, m, v, out) {
      var g = gain(0, out), o = osc('triangle', 820, t, filt('bandpass', 1700, 3, g));
      o.start(t); o.stop(perc(g.gain, t, 0.5 * v, 0.0005, 0.04));
    };
    I.shaker = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 5500, 0.7, g));
      ns.stop(perc(g.gain, t, 0.12 * v, 0.012, 0.05));
    };
    I.brush = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('bandpass', 3200, 0.7, g));
      ns.stop(perc(g.gain, t, 0.2 * v, 0.015, 0.16));
    };
    I.tamb = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('bandpass', 9000, 1.2, g));
      ns.stop(perc(g.gain, t, 0.22 * v, 0.003, 0.12));
    };
    I.block = function (t, dur, m, v, out) {
      var g = gain(0, out), o = osc('sine', mtof(m || 84), t, g);
      o.start(t); o.stop(perc(g.gain, t, 0.4 * v, 0.0008, 0.06));
    };
    I.anvil = function (t, dur, m, v, out) { // metallic hit
      var f = mtof(m || 76), end = t;
      [[1, 1], [2.71, 0.6], [5.13, 0.4], [8.2, 0.25]].forEach(function (pt) {
        var g = gain(0, out), o = osc('sine', f * pt[0], t, g); o.start(t);
        end = perc(g.gain, t, 0.16 * pt[1] * v, 0.0008, 0.5 / pt[0] + 0.15); o.stop(end);
      });
      var ng = gain(0, out), ns = noiseSrc(t, filt('highpass', 3000, 0.8, ng)); perc(ng.gain, t, 0.2 * v, 0.0008, 0.06); ns.stop(t + 0.2);
    };
    // FX: riser (noise + saw sweeping up over `dur`), reverse cymbal swell, impact boom
    I.riser = function (t, dur, m, v, out) {
      var g = gain(0, out), bp = filt('bandpass', 400, 2.5, g), ns = noiseSrc(t, bp);
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3 * v, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
      var sg = gain(0, filt('lowpass', 3000, 0.7, out)), so = osc('sawtooth', mtof(m || 48), t, sg);
      so.frequency.exponentialRampToValueAtTime(mtof((m || 48) + 24), t + dur);
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.05 * v, t + dur); sg.gain.linearRampToValueAtTime(0, t + dur + 0.03);
      ns.stop(t + dur + 0.05); so.start(t); so.stop(t + dur + 0.05);
    };
    I.swell = function (t, dur, m, v, out) {
      var g = gain(0, out), ns = noiseSrc(t, filt('highpass', 3500, 0.5, g));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28 * v, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
      ns.stop(t + dur + 0.05);
    };
    I.boom = function (t, dur, m, v, out) {
      var g = gain(0, out), o = osc('sine', 80, t, g); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
      o.start(t); o.stop(perc(g.gain, t, 0.95 * v, 0.003, 1.8));
      var ng = gain(0, out), ns = noiseSrc(t, filt('lowpass', 900, 0.6, ng)); ns.stop(perc(ng.gain, t, 0.5 * v, 0.002, 0.9));
    };
    I.hit = function (t, dur, m, v, out) { // orchestra hit: brass + strings + timpani stab
      var base = m || 60;
      [0, 7, 12, 16, 19].forEach(function (iv) { I.brass(t, 0.18, base + iv, v * 0.8, out, {}); I.stac(t, 0.12, base + iv + 12, v * 0.7, out, {}); });
      I.timp(t, 0.5, base - 24, v, out, {});
      I.crash(t, 0.5, 0, v * 0.6, out);
    };

    // Loudness calibration (measured): every instrument at vol 1 sits at a
    // similar level for its role, so part volumes in the songs are real mix choices.
    var TRIM = {gtr: 0.944, cgtr: 1.82, harp: 1.622, pizz: 1.778, koto: 2.163, ubass: 0.37, flute: 0.417, chip: 1.778, brass: 1.135, horn: 0.944, strings: 1.245, stac: 1.603, trem: 1.95, choir: 1.274, ooh: 0.785, organ: 0.989, pipe: 1.429, epiano: 0.708, vibes: 0.881, glock: 1.288, celesta: 1.413, musicbox: 1.274, bell: 0.923, marimba: 1.334, bass: 1.093, pbass: 0.802, dbass: 0.793, sub: 0.462, pad: 1.396, dpad: 0.902, drone: 0.676, timp: 0.631, taiko: 0.562, kick: 0.977, snare: 1.334, clap: 4.571, hat: 2.317, ohat: 1.259, ride: 1.718, crash: 0.708, tom: 0.724, rim: 6.998, shaker: 3.02, brush: 2.317, tamb: 2.455, block: 1.161, anvil: 1.084};
    Object.keys(TRIM).forEach(function (name) { var f = I[name], k = TRIM[name]; if (f) I[name] = function (t, d, m, v, o, p) { return f(t, d, m, v * k, o, p); }; });

    E.inst = I;

    /* ---------- buses ---------- */
    var out = gain(0.6); // [v1.5] (was 0.88: everything was far too loud)
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 14; limiter.attack.value = 0.002; limiter.release.value = 0.18;
    out.connect(limiter); limiter.connect(ctx.destination);
    E.output = out;

    // music bus: glue compressor -> muffle filter (pause) -> level
    var musicIn = gain(1);
    var glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.25;
    var muffle = filt('lowpass', 20000, 0.5);
    var musicLevel = gain(1);
    var duck = gain(1);
    var lowcut = filt('highpass', 32, 0.7); var lowshelf = filt('lowshelf', 140, 0.7); lowshelf.gain.value = -2.5;
    musicIn.connect(lowcut); lowcut.connect(lowshelf); var presence = filt('peaking', 2800, 0.7); presence.gain.value = 2.5; var air = filt('highshelf', 7000, 0.7); air.gain.value = 2;
    lowshelf.connect(presence); presence.connect(air); air.connect(glue); glue.connect(muffle); muffle.connect(duck); duck.connect(musicLevel); musicLevel.connect(out);
    E.musicIn = musicIn; E.musicLevel = musicLevel; E.muffle = muffle; E.duck = duck;

    var sfxIn = gain(1, out);
    E.sfxIn = sfxIn;

    var reverb = null, revIn = null;
    if (!opts.noReverb) {
      reverb = ctx.createConvolver();
      reverb.buffer = makeIR(E.lite ? 1.6 : 2.6);
      revIn = gain(1, reverb);
      reverb.connect(gain(0.9, musicIn));
      var sfxReverb = ctx.createConvolver(); sfxReverb.buffer = makeIR(1.4);
      E.sfxRevIn = gain(1, sfxReverb); sfxReverb.connect(gain(0.7, sfxIn));
    }
    E.revIn = revIn;

    /* ================================================================
       The music player
       ================================================================ */
    var AHEAD = opts.offline ? 1e9 : 0.22;
    // [v1.4] how far ahead to schedule now: grows when the page's timers run late
    // (a slow Chromebook, a busy frame), so notes are never skipped for being late
    E.ahead = function () { return opts.offline ? AHEAD : Math.max(AHEAD, E.lateBy || 0); };

    function Player(song, startAt) {
      var P = this;
      P.song = song;
      P.sd = 60 / song.bpm / song.spb;                // seconds per step
      P.bar = song.spb * song.bpb;                     // steps per bar
      P.t0 = startAt;
      P.g = 0;                                         // next global step to schedule
      P.sec = song.sections[song.start];
      P.secName = song.start;
      P.pos = 0;                                       // step inside the section
      P.pending = null;                                // { name, quant, at }
      P.ended = false;
      P.bus = gain(0, musicIn);
      P.bus.gain.setValueAtTime(0, startAt);
      P.bus.gain.linearRampToValueAtTime(song.gain || 1, startAt + (song.fadeIn || 0.02));
      P.rev = revIn ? gain(1, revIn) : null;
      P.dly = null;
      if (!E.lite) {
        var d = ctx.createDelay(2), fb = gain(0.32), dl = filt('lowpass', 2600, 0.5);
        d.delayTime.value = Math.min(1.9, P.sd * (song.spb * 0.75)); // dotted eighth
        d.connect(dl); dl.connect(fb); fb.connect(d); dl.connect(gain(0.5, P.bus));
        P.dly = d;
      }
      P.layers = {};      // name -> { level (as scheduled), nodes: [gain], changes: [{g, level}] }
      P.parts = {};       // part key -> { gain node, layer }
      P.oneShots = [];
      P.state = {};
      P.listeners = [];
      var L0 = song.layers || {};
      for (var ln in L0) P.layers[ln] = { level: L0[ln], changes: [], nodes: [] };
    }
    Player.prototype.layer = function (name) {
      if (!this.layers[name]) this.layers[name] = { level: name === 'base' ? 1 : 0, changes: [], nodes: [] };
      return this.layers[name];
    };
    Player.prototype.timeOf = function (g) {
      var song = this.song, spb = song.spb;
      var sw = (this.sec && this.sec.swing !== undefined) ? this.sec.swing : (song.swing || 0);
      if (!sw) return this.t0 + g * this.sd;
      var beat = Math.floor(g / spb), frac = (g - beat * spb) / spb;
      var r = 0.5 + sw * 0.5; // swing 0 = straight, 0.33 ~ triplet feel
      var f2 = frac < 0.5 ? frac / 0.5 * r : r + (frac - 0.5) / 0.5 * (1 - r);
      return this.t0 + (beat + f2) * spb * this.sd;
    };
    Player.prototype.partNode = function (part) {
      var key = part.key, pn = this.parts[key];
      if (pn) return pn;
      var lay = this.layer(part.layer || 'base');
      // start at the layer's level NOW (not its level when the song began), then follow any
      // changes already scheduled after this point
      var lg = gain(this.levelAt(lay, this.g), null);
      for (var ci = 0; ci < lay.changes.length; ci++) {
        var ch = lay.changes[ci];
        if (ch.g <= this.g) continue;
        var tc = this.timeOf(ch.g);
        lg.gain.setValueAtTime(ch.from, tc);
        lg.gain.linearRampToValueAtTime(ch.level, tc + ch.fade);
      }
      var vol = gain(part.vol === undefined ? 1 : part.vol, null);
      var node = vol;
      if (part.pan && ctx.createStereoPanner) { var pnr = ctx.createStereoPanner(); pnr.pan.value = part.pan; vol.connect(pnr); node = pnr; }
      node.connect(lg);
      lg.connect(this.bus);
      if (this.rev && part.rev) lg.connect(gain(part.rev, this.rev));
      if (this.dly && part.dly) lg.connect(gain(part.dly, this.dly));
      if (part.lp) { /* optional extra tone filter for the whole part */ var f = filt('lowpass', part.lp, 0.6, vol); pn = { input: f, layerGain: lg }; }
      else pn = { input: vol, layerGain: lg };
      pn.lay = lay;
      lay.nodes.push(lg);
      this.parts[key] = pn;
      return pn;
    };
    Player.prototype.levelAt = function (lay, g) {
      var lv = lay.level;
      for (var i = 0; i < lay.changes.length; i++) if (lay.changes[i].g <= g) lv = lay.changes[i].level;
      return lv;
    };
    // boundary: first global step >= this.g aligned to quant
    Player.prototype.boundary = function (quant) {
      var g = this.g;
      if (quant === 'now' || !quant) return g;
      var q = quant === 'beat' ? this.song.spb : quant === 'half' ? this.song.spb * 2 : quant === '8th' ? Math.max(1, this.song.spb / 2) : quant === '16th' ? 1 : quant === '2bar' ? this.bar * 2 : this.bar;
      // align to the section's own grid (sections are whole bars long)
      var secStart = g - this.pos;
      var rel = g - secStart;
      return secStart + Math.ceil(rel / q) * q;
    };
    Player.prototype.setLayer = function (name, level, quant, fade) {
      var lay = this.layer(name);
      var last = lay.changes.length ? lay.changes[lay.changes.length - 1].level : lay.level;
      if (Math.abs(last - level) < 0.001) return;
      var g = this.boundary(quant || 'beat');
      var t = this.timeOf(g), f = fade === undefined ? 0.04 : fade;
      lay.changes.push({ g: g, level: level, from: last, fade: f });
      for (var i = 0; i < lay.nodes.length; i++) {
        var p = lay.nodes[i].gain;
        p.cancelScheduledValues(t);
        p.setValueAtTime(last, t);
        p.linearRampToValueAtTime(level, t + f);
      }
      this.emit('layer', { name: name, level: level, g: g, t: t });
    };
    // go to a section at the next boundary. release (seconds): fade out whatever the previous
    // section still has ringing when the jump happens (a boss falls, the key changes...)
    Player.prototype.go = function (name, quant, release) {
      if (!this.song.sections[name]) return;
      this.pending = { name: name, quant: quant || 'bar', release: release || 0 };
      this.emit('cue', { name: name, quant: quant || 'bar' });
    };
    Player.prototype.hit = function (inst, midi, vel, quant, dur, opt) {
      var g = this.boundary(quant || '16th');
      this.oneShots.push({ g: g, inst: inst, m: midi, v: vel === undefined ? 1 : vel, d: dur || 1, opt: opt || {} });
    };
    // fade out every part node made so far (the notes still ringing) and forget them, so the
    // parts that play next get fresh nodes at full level
    Player.prototype.releaseParts = function (fade) {
      var t = this.timeOf(this.g), f = fade || 0.2;
      for (var key in this.parts) {
        var pn = this.parts[key], gp = pn.layerGain.gain;
        gp.cancelScheduledValues(t);
        gp.setValueAtTime(this.levelAt(pn.lay, this.g), t);
        gp.linearRampToValueAtTime(0, t + f);
        var i = pn.lay.nodes.indexOf(pn.layerGain);
        if (i >= 0) pn.lay.nodes.splice(i, 1);
        if (!opts.offline) (function (node, ms) { setTimeout(function () { try { node.disconnect(); } catch (e) { /* gone */ } }, ms); })(pn.layerGain, (t - ctx.currentTime + f + 3) * 1000);
      }
      this.parts = {};
    };
    Player.prototype.emit = function (type, info) {
      if (E.onEvent) try { E.onEvent(type, info, this); } catch (e) { /* tests only */ }
    };
    Player.prototype.react = function (st) {
      if (!this.song.react) { this.state = st; return; }
      var old = this.state;
      this.state = st;
      try { this.song.react(st, old, this); } catch (e) { if (window.console) console.error(e); }
    };
    Player.prototype.stepOnce = function () {
      var song = this.song;
      // section boundaries
      if (this.pending) {
        var q = this.pending.quant, ok = false;
        if (q === 'now') ok = true;
        else if (q === 'end') ok = this.pos >= this.sec.len;
        else if (q === 'beat') ok = this.pos % song.spb === 0;
        else if (q === 'half') ok = this.pos % (song.spb * 2) === 0;
        else if (q === '2bar') ok = this.pos % (this.bar * 2) === 0;
        else ok = this.pos % this.bar === 0;
        if (ok) {
          var rel = this.pending.release;
          if (rel) this.releaseParts(rel);
          this.secName = this.pending.name; this.sec = song.sections[this.secName]; this.pos = 0; this.pending = null;
          this.emit('section', { name: this.secName, g: this.g, t: this.timeOf(this.g) });
          if (this.sec.enter) this.sec.enter(this);
        }
      }
      if (this.pos >= this.sec.len) {
        var nx = this.sec.next;
        if (typeof nx === 'function') nx = nx(this);
        if (!nx) { this.ended = true; return false; }
        this.secName = nx; this.sec = song.sections[nx]; this.pos = 0;
        this.emit('section', { name: this.secName, g: this.g, t: this.timeOf(this.g) });
        if (this.sec.enter) this.sec.enter(this);
      }
      var g = this.g, t = this.timeOf(g);
      var parts = this.sec.parts;
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (E.lite && part.lite === false) continue;
        if (E.solo && E.solo.indexOf(part.inst) < 0) continue;
        var evs = part.byStep[this.pos % part.len];
        if (!evs) continue;
        var lay = this.layer(part.layer || 'base');
        if (this.levelAt(lay, g) < 0.001 && !part.always) continue;
        var pn = this.partNode(part), fn = I[part.inst];
        if (!fn) continue;
        for (var k = 0; k < evs.length; k++) {
          var ev = evs[k];
          var tt = t, hum = part.hum === undefined ? 0.004 : part.hum;
          if (hum) tt += (Math.random() - 0.5) * 2 * hum;
          var dur = this.timeOf(g + ev[1]) - t - (part.gap || 0.01);
          var vel = ev[3] * (1 + (Math.random() - 0.5) * (part.velHum === undefined ? 0.08 : part.velHum));
          try { fn(Math.max(tt, t - 0.002), Math.max(0.03, dur), ev[2], vel, pn.input, part); } catch (e) { /* never break the game */ }
        }
      }
      for (var j = this.oneShots.length - 1; j >= 0; j--) {
        var os = this.oneShots[j];
        if (os.g <= g) {
          this.oneShots.splice(j, 1);
          var hitBus = this.hitBus || (this.hitBus = (function (P) { var hb = gain(0.9, P.bus); if (P.rev) hb.connect(gain(0.25, P.rev)); return hb; })(this));
          try { I[os.inst](this.timeOf(os.g), this.sd * os.d, os.m, os.v, hitBus, os.opt); } catch (e) { /* ignore */ }
        }
      }
      this.pos++; this.g++;
      return true;
    };
    Player.prototype.pump = function (until) {
      if (this.ended) return;
      var now = ctx.currentTime;
      // after a long stall, skip ahead instead of firing a burst of notes
      if (!opts.offline && this.timeOf(this.g) < now - 0.1) {
        var skip = Math.ceil((now - this.timeOf(this.g)) / this.sd);
        for (var s = 0; s < skip && !this.ended; s++) this.stepOnceSilent();
      }
      var lim = until === undefined ? now + E.ahead() : until;
      var guard = 0;
      while (!this.ended && this.timeOf(this.g) < lim && guard++ < 100000) {
        if (this.stepOnce() === false) break;
      }
    };
    Player.prototype.stepOnceSilent = function () { // move on one step without playing (after a stall)
      if (this.pending && this.pos % this.bar === 0 && this.pos > 0) {
        this.secName = this.pending.name; this.sec = this.song.sections[this.secName]; this.pos = 0; this.pending = null;
      }
      this.pos++; this.g++;
      if (this.pos >= this.sec.len) {
        var nx = this.pending ? this.pending.name : this.sec.next;
        if (typeof nx === 'function') nx = nx(this);
        this.pending = null;
        if (!nx) { this.ended = true; return; }
        this.secName = nx; this.sec = this.song.sections[nx]; this.pos = 0;
      }
    };
    Player.prototype.stop = function (fade) {
      var now = ctx.currentTime, f = fade === undefined ? 0.6 : fade;
      this.ended = true;
      var p = this.bus.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0, now + f);
      var bus = this.bus, rev = this.rev;
      setTimeout(function () { try { bus.disconnect(); if (rev) rev.disconnect(); } catch (e) { /* gone */ } }, (f + 4) * 1000);
    };

    E.Player = Player;
    E.newPlayer = function (song, at) { return new Player(song, at); };
    return E;
  }

  /* ================================================================
     Live audio: two contexts made inside the player's first tap
     (iOS keeps a context made earlier silent), resumed on every tap.
     ================================================================ */
  var live = { ui: null, game: null, gestured: false };
  var DA = window.DashAudio = {
    makeEngine: makeEngine,
    mtof: mtof,
    lite: false,
    log: null,              // set to a function(type, info) to watch everything (tests)
    current: null,          // the Player of the song that is playing
    wanted: '',             // the song the game asked for
    paused: false
  };
  function logEv(type, info) { if (DA.log) try { DA.log(type, info); } catch (e) { /* tests only */ } }

  // [v1.5] the volume sliders (0..1 each), and the music level they give
  DA.vol = { music: 0.7, sfx: 0.7 };
  function musicLevelFor(paused) { return (paused ? 0.45 : 0.9) * DA.vol.music; }
  function applySfxVolume() {
    if (!live.ui) return;
    live.ui.sfxIn.gain.value = DA.vol.sfx;
    live.game.sfxIn.gain.value = DA.vol.sfx;
  }
  DA.setVolume = function (music, sfx) {
    music = clamp(+music, 0, 1); sfx = clamp(+sfx, 0, 1);
    if (music === DA.vol.music && sfx === DA.vol.sfx) return;
    DA.vol.music = music; DA.vol.sfx = sfx;
    if (!live.ui) return;
    var t = live.ui.ctx.currentTime;
    live.ui.musicLevel.gain.setTargetAtTime(musicLevelFor(DA.paused), t, 0.05);
    applySfxVolume();
  };
  function ensure() {
    if (live.ui || !AC || !live.gestured) return !!live.ui;
    try {
      live.ui = makeEngine(new AC(), { lite: DA.lite });
      live.game = makeEngine(new AC(), { lite: true, noReverb: false });
    } catch (e) { live.ui = live.game = null; return false; }
    live.ui.onEvent = function (type, info) { logEv(type, info); };
    live.ui.musicLevel.gain.value = musicLevelFor(DA.paused);
    applySfxVolume();
    live.ui.ctx.onstatechange = function () { if (live.ui.ctx.state === 'running' && DA.wanted && !DA.current) startSong(DA.wanted); };
    return true;
  }
  function resumeCtx(c) {
    if (!c || c.state === 'running' || document.hidden) return;
    try { var pr = c.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* next tap */ }
    try { var b = c.createBufferSource(); b.buffer = c.createBuffer(1, 1, c.sampleRate); b.connect(c.destination); b.start(0); } catch (e) { /* ignore */ }
  }
  function unlock() {
    live.gestured = true;
    if (!ensure()) return;
    resumeCtx(live.ui.ctx);
    if (!DA.paused) resumeCtx(live.game.ctx);
    if (DA.wanted && !DA.current && live.ui.ctx.state === 'running') startSong(DA.wanted);
  }
  ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'].forEach(function (n) {
    window.addEventListener(n, unlock, { capture: true, passive: true });
  });
  // [v1.4] promise-safe suspend (a rejected promise used to go unhandled)
  function suspendCtx(c) {
    try { var pr = c.suspend(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* ignore */ }
  }
  function wake() {
    if (!live.ui || document.hidden) return;
    resumeCtx(live.ui.ctx);
    if (!DA.paused) resumeCtx(live.game.ctx);
    wd.ct = -1; // the clock was frozen while hidden: don't count that as stuck
  }
  document.addEventListener('visibilitychange', function () {
    if (!live.ui) return;
    if (document.hidden) { suspendCtx(live.ui.ctx); suspendCtx(live.game.ctx); }
    else wake();
  });
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);

  // [v1.4] Throw away both contexts and make new ones, then carry on with the song.
  // Used when the audio clock has stopped moving although the context says it is
  // running (the output device got stuck: "it played one note and then stopped").
  function rebuild(why) {
    logEv('rebuild', { why: why });
    var old = live.ui, oldGame = live.game;
    if (DA.current) { try { DA.current.stop(0); } catch (e) { /* gone */ } DA.current = null; }
    live.ui = live.game = null;
    try { old.ctx.close(); } catch (e) { /* ignore */ }
    try { oldGame.ctx.close(); } catch (e) { /* ignore */ }
    if (!ensure()) return;
    if (DA.paused) { // keep the pause look on the new contexts
      live.ui.musicLevel.gain.value = musicLevelFor(true); live.ui.muffle.frequency.value = 900; suspendCtx(live.game.ctx);
    }
    resumeCtx(live.ui.ctx);
    if (!DA.paused) resumeCtx(live.game.ctx);
    if (DA.wanted && live.ui.ctx.state === 'running') startSong(DA.wanted); // (otherwise onstatechange starts it)
  }

  // [v1.4] The watchdog, on the pump's timer: keeps the contexts running while the
  // page is visible, spots a stuck clock, and measures how late the timer runs.
  var wd = { last: 0, lateMax: 0, check: 0, ct: -1, still: 0, rebuilds: 0, rebuiltAt: 0 };
  function watchdog(nowMs) {
    var gap = wd.last ? (nowMs - wd.last) / 1000 : 0.045;
    wd.last = nowMs;
    if (document.hidden) { wd.ct = -1; return; }
    // [v1.5] a single long gap (a tab switch, a slow frame) used to make it schedule up
    // to 1.2 s of notes in one go, which made the game's frames hitch; now it's capped
    // at 0.5 s and only follows gaps that keep happening
    wd.lateMax = Math.max(Math.min(gap, 0.35), wd.lateMax * 0.99);
    if (live.ui) live.ui.lateBy = live.game.lateBy = Math.min(0.5, wd.lateMax * 1.3 + 0.05);
    if (!live.ui || !live.gestured || nowMs - wd.check < 500) return;
    var dt = wd.check ? (nowMs - wd.check) / 1000 : 0;
    wd.check = nowMs;
    var ui = live.ui.ctx;
    if (ui.state !== 'running' && ui.state !== 'closed') { resumeCtx(ui); wd.ct = -1; }
    if (!DA.paused && live.game.ctx.state !== 'running' && live.game.ctx.state !== 'closed') resumeCtx(live.game.ctx);
    if (ui.state !== 'running') return;
    if (ui.currentTime !== wd.ct) { wd.ct = ui.currentTime; wd.still = 0; return; }
    wd.still += dt;
    // stuck for 2 s: start over (at most 3 times, and not more than once in 10 s)
    if (wd.still > 2 && wd.rebuilds < 3 && nowMs - wd.rebuiltAt > 10000) {
      wd.rebuilds++; wd.rebuiltAt = nowMs; wd.still = 0; wd.ct = -1;
      rebuild('clock stuck');
    }
  }

  function pumpLoop() {
    setTimeout(pumpLoop, 45);
    try { watchdog(Date.now()); } catch (e) { /* never break the music */ }
    var P = DA.current;
    if (P && live.ui) {
      try { P.pump(); P.errs = 0; } catch (e) {
        if (window.console) console.error(e);
        // [v1.5] a song that keeps failing is started again rather than staying silent
        if ((P.errs = (P.errs || 0) + 1) > 20 && DA.current === P) { DA.current = null; try { P.stop(0.1); } catch (e2) { /* gone */ } }
      }
      if (P.ended && DA.current === P) { DA.current = null; DA.finished = P.name; logEv('songEnd', { name: P.name }); if (P.song.then) { DA.wanted = P.song.then; DA.finished = ''; startSong(P.song.then); } }
    } else if (!P && DA.wanted && DA.finished !== DA.wanted && live.ui && live.ui.ctx.state === 'running' && !document.hidden) {
      // [v1.5] music wanted but none playing (it had been stopped while the audio
      // was asleep and nothing started it again): some players got effects but no music
      startSong(DA.wanted);
    }
  }
  setTimeout(pumpLoop, 45);

  function startSong(name) {
    var songs = window.DASH_SONGS || {};
    var song = songs[name];
    var E = live.ui;
    if (!E) return;
    if (!song) { if (DA.current) { DA.current.stop(0.8); DA.current = null; } return; }
    var now = E.ctx.currentTime;
    if (DA.current) DA.current.stop(song.xfade !== undefined ? song.xfade : 0.7);
    var P = E.newPlayer(song, now + 0.06);
    P.name = name;
    DA.current = P;
    if (DA.lastState) P.react(DA.lastState);
    logEv('music', { name: name, t: now });
  }

  DA.music = function (name) {
    name = name || '';
    if (name === DA.wanted) return;
    DA.wanted = name;
    DA.finished = '';
    logEv('want', { name: name });
    if (!name) { if (DA.current) { DA.current.stop(0.9); DA.current = null; } return; }
    if (!ensure()) return;
    if (live.ui.ctx.state !== 'running') { resumeCtx(live.ui.ctx); if (DA.current) { DA.current.stop(0.05); DA.current = null; } return; }
    startSong(name);
  };
  // the game describes what is happening; the song decides what to do with it
  DA.state = function (st) {
    var key = JSON.stringify(st);
    if (key === DA.lastStateKey) return;
    DA.lastStateKey = key;
    DA.lastState = st;
    if (DA.current) DA.current.react(st);
  };
  DA.pause = function (on) {
    on = !!on;
    if (on === DA.paused) return;
    DA.paused = on;
    if (!live.ui) return;
    var E = live.ui, t = E.ctx.currentTime;
    E.musicLevel.gain.setTargetAtTime(musicLevelFor(on), t, 0.12);
    E.muffle.frequency.setTargetAtTime(on ? 900 : 20000, t, 0.12);
    try { if (on) live.game.ctx.suspend(); else live.game.ctx.resume(); } catch (e) { /* ignore */ }
  };
  // sound effects. UI sounds use the context that keeps playing in the pause menu.
  var lastPlay = {};
  DA.sfx = function (name, vol, opt) {
    var defs = window.DASH_SFX || {};
    var def = defs[name];
    if (!def) return false;
    if (!ensure()) return false;
    var E = def.ui ? live.ui : live.game;
    if (!def.ui && DA.paused) return false;
    if (E.ctx.state !== 'running') { resumeCtx(E.ctx); return false; }
    var now = E.ctx.currentTime, gap = def.gap === undefined ? 0.05 : def.gap;
    if (lastPlay[name] && now - lastPlay[name] < gap) return false;
    lastPlay[name] = now;
    try {
      var out = E.sfxIn;
      opt = opt || {};
      if (opt.pan && E.ctx.createStereoPanner) {
        var pn = E.ctx.createStereoPanner(); pn.pan.value = clamp(opt.pan, -1, 1); pn.connect(E.sfxIn); out = pn;
        setTimeout(function () { try { pn.disconnect(); } catch (e) { /* gone */ } }, 6000);
      }
      var v = (vol === undefined ? 1 : vol) * (def.vol || 1);
      def.play(E, now + 0.004, out, v, opt);
      if (def.duck && live.ui) { // big moments dip the music a little
        var dk = live.ui.duck.gain, tt = live.ui.ctx.currentTime;
        dk.cancelScheduledValues(tt); dk.setTargetAtTime(1 - def.duck, tt, 0.02); dk.setTargetAtTime(1, tt + (def.duckFor || 0.4), 0.25);
      }
      logEv('sfx', { name: name, vol: v });
      return true;
    } catch (e) { return false; }
  };
  // a music cue played on top (jingles): optionally silences the song first
  DA.jingle = function (name) { return DA.sfx(name); };
  DA.hit = function (inst, midi, vel, quant) { if (DA.current) DA.current.hit(inst, midi, vel, quant); };
  DA.setLite = function (on) { DA.lite = !!on; if (live.ui) live.ui.lite = DA.lite; }; // (new notes follow at once)
  DA.contexts = function () { return live; };

  /* ================================================================
     Offline rendering for tests and previews.
       script: [{ at: seconds, state: {...} } | { at, go: 'section' } ...]
     ================================================================ */
  DA.render = function (name, seconds, script, o) {
    o = o || {};
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var rate = o.rate || 44100;
    var ctx = new OAC(2, Math.ceil(rate * seconds), rate);
    var E = makeEngine(ctx, { offline: true, lite: !!o.lite });
    if (o.solo) E.solo = o.solo;
    var events = [];
    E.onEvent = function (type, info) { events.push({ type: type, info: info }); };
    if (o.sfx) {
      var t = 0.05;
      (o.sfx instanceof Array ? o.sfx : [o.sfx]).forEach(function (s) {
        var def = window.DASH_SFX[s.name || s];
        def.play(E, s.at !== undefined ? s.at : t, E.sfxIn, (s.vol || 1) * (def.vol || 1), s.opt || {});
      });
      return ctx.startRendering().then(function (buf) { buf.events = events; return buf; });
    }
    var song = window.DASH_SONGS[name];
    var P = E.newPlayer(song, 0.05);
    P.name = name;
    script = (script || []).slice().sort(function (a, b) { return a.at - b.at; });
    var si = 0;
    if (o.state) P.react(o.state);
    // schedule in 2-second chunks (all notes at once makes the renderer crawl)
    function scheduleUntil(lim) {
      while (!P.ended && P.timeOf(P.g) < Math.min(lim, seconds)) {
        var tNow = P.timeOf(P.g);
        while (si < script.length && script[si].at <= tNow) {
          var sc = script[si++];
          if (sc.state) P.react(sc.state);
          if (sc.go) P.go(sc.go, sc.quant);
          if (sc.layer) P.setLayer(sc.layer, sc.level, sc.quant, sc.fade);
          if (sc.sfx && window.DASH_SFX[sc.sfx]) window.DASH_SFX[sc.sfx].play(E, sc.at, E.sfxIn, sc.vol || 1, sc.opt || {});
        }
        if (P.stepOnce() === false) break;
      }
    }
    var CH = 2;
    scheduleUntil(CH + 0.5);
    if (ctx.suspend) {
      for (var c = CH; c < seconds; c += CH) (function (at) {
        ctx.suspend(at).then(function () { scheduleUntil(at + CH + 0.5); ctx.resume(); });
      })(c);
    } else scheduleUntil(seconds);
    return ctx.startRendering().then(function (buf) { buf.events = events; return buf; });
  };
  // AudioBuffer -> 16-bit WAV Blob
  DA.toWav = function (buf) {
    var ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
    var data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    function str(o, s) { for (var i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
    str(36, 'data'); data.setUint32(40, len * ch * 2, true);
    var chans = []; for (var c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    var off = 44;
    for (var i = 0; i < len; i++) for (c = 0; c < ch; c++) { var s = clamp(chans[c][i], -1, 1); data.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
    return new Blob([data.buffer], { type: 'audio/wav' });
  };
})();

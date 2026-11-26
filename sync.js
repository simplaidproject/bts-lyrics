/* ═══════════════════════════════════════════════════════════════
   SYNC ENGINE — keeps the lyrics locked to the song.

   Three ways to stay in time, in order of confidence:

   1. TIMED  — LRCLIB line/word timings drive the cursor. Works
               out of the box for 88 of 92 songs.
   2. LISTEN — the phone microphone watches the room, detects
               onsets, and cross-correlates them against the
               timing grid to find where you are and to follow
               the band if they play faster or slower than the
               studio cut.
   3. TAP    — you stamp the lines by hand. For the songs with no
               timings, and for live versions that drift.

   Everything degrades gracefully: no mic, no signal, no timings
   — the app still works as a plain lyric book.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var HOP_MS = 25;              // onset-envelope resolution
  var VOCAL_LO = 180;           // Hz — vocal band we trust for onsets
  var VOCAL_HI = 4200;          // Hz
  var WIN_SEC = 45;           // rolling analysis window
  var TEMPLATE_PAD = 6;       // seconds of template kept around the window
  var TOLERANCE_MS = 125;     // how late an onset may be and still count
  var MIN_LOCK_ONSETS = 16;   // onsets needed before we trust a lock

  /* how long a lock stays usable without a fresh alignment — a mic
     that has gone quiet must not keep dragging the clock */
  var LOCK_TTL_MS = 4000;
  /* the onset detector samples the spectrum on its own timer: tied to
     requestAnimationFrame it starves on a busy screen (a concert view
     can drop to a handful of frames per second) and the vocal
     transients are missed entirely */
  var MIC_POLL_MS = 10;
  /* silence kept after the last tapped line when the user timed a
     track by hand */
  var TAP_TAIL_MS = 4000;
  /* assumed pace for a song that has no timing data at all */
  var UNTIMED_LINE_MS = 3500;

  /* ── timing store ──────────────────────────────────────────── */
  var OFFICIAL = window.__BTS_TIMINGS__ || {};
  var custom = {};             // user-made timings, per device
  try { custom = JSON.parse(localStorage.getItem('bts.customTimings') || '{}'); } catch (e) {}

  function saveCustom() {
    try { localStorage.setItem('bts.customTimings', JSON.stringify(custom)); } catch (e) {}
  }

  function getTimings(songId) {
    var c = custom[songId];
    if (c && c.L && c.L.length) {
      // keep the official word timings when the user re-timed the same
      // lines: shift them onto the user's anchor so karaoke still works
      var o = OFFICIAL[songId];
      if (!c.W && o && o.W && o.L && c.L.length === o.L.length) {
        var shift = c.L[0] - o.L[0];
        c.W = o.W.map(function (w) { return [w[0] + shift, w[1]]; });
      }
      return c;
    }
    var off = OFFICIAL[songId];
    if (off && off.L && off.L.length) return off;
    return null;
  }

  function hasTimings(songId) { return !!getTimings(songId); }

  /* ── template ──────────────────────────────────────────────
     A score in [0,1] over song time: 1.0 at every vocal line
     start, 0.55 at every word start, smooth Gaussian skirts so
     a real onset that lands 80ms late still scores well. */
  function buildTemplate(t, durationMs) {
    var n = Math.ceil((durationMs / 1000 + TEMPLATE_PAD * 2) * (1000 / HOP_MS));
    var tpl = new Float32Array(n);
    function stamp(timeMs, peak, sigmaMs) {
      var c = Math.round(timeMs / HOP_MS);
      var sig = sigmaMs / HOP_MS;
      var reach = Math.ceil(sig * 2.5);
      for (var p = Math.max(0, c - reach); p <= Math.min(n - 1, c + reach); p++) {
        var d = p - c;
        var v = peak * Math.exp(-(d * d) / (2 * sig * sig));
        if (v > tpl[p]) tpl[p] = v;
      }
    }
    var i;
    for (i = 0; i < t.L.length; i++) stamp(t.L[i], 1.0, 60);
    if (t.W && t.W.length) {
      for (i = 0; i < t.W.length; i++) stamp(t.W[i][0], 0.55, 60);
    }
    // dilate: an onset up to TOLERANCE_MS late still counts as a hit
    var tol = Math.round(TOLERANCE_MS / HOP_MS);
    var out = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var m = 0;
      var a = Math.max(0, i - tol), b = Math.min(n - 1, i + tol);
      for (var k = a; k <= b; k++) if (tpl[k] > m) m = tpl[k];
      out[i] = m;
    }
    return out;
  }

  /* ── microphone onset detector ──────────────────────────────── */
  function Mic(onState) {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.bins = null;
    this.prev = null;
    this.env = [];             // [{t, v}] rolling flux envelope
    this.fluxTimes = [];
    this.fluxVals = [];
    /* A second envelope over the WHOLE band. The vocal-weighted one is
       right for finding syllables; the beat lives in the kick and the
       snare, so the two must not be mixed. */
    this.beatTimes = [];
    this.beatVals = [];
    /* A second envelope over the WHOLE band. The vocal-weighted one is
       right for finding syllables; the beat lives in the kick and the
       snare, so the two must not be mixed. */
    this.beatTimes = [];
    this.beatVals = [];
    this.startedAt = 0;
    this.baseStart = 0;         // the capture's clock when it opened
    this.running = false;
    this.onState = onState || function () {};
    this.level = 0;
    this.pollTimer = null;
  }

  /**
   * The capture's own clock.
   *
   * A frame of spectrum must be stamped with the time of the AUDIO it
   * was made from, not with the time the main thread happened to read
   * it: when the phone is busy the audio thread falls behind the
   * system clock by a fraction of a second that keeps changing, and
   * wall-clock stamps smear every onset. The audio context's clock
   * advances with the rendering, so it stays glued to the samples.
   */
  Mic.prototype.clock = function () {
    if (this.ctx) return this.ctx.currentTime * 1000;
    return Date.now();
  };

  Mic.prototype.start = function () {
    var self = this;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('no-mic-api'));
    }
    this.cancelled = false;
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      /* The browser can take a moment to open the microphone. If the
         user walked away in the meantime — closed concert mode, turned
         sync off — the device has to go straight back, or it stays live
         on the next screen. */
      if (self.cancelled) {
        try {
          stream.getTracks().forEach(function (t) { t.stop(); });
        } catch (e) {}
        throw new Error('mic-cancelled');
      }
      self.stream = stream;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        self.ctx = new AC();
        // a context that starts suspended would never deliver a frame
        if (self.ctx.state === 'suspended' && self.ctx.resume) {
          try { self.ctx.resume(); } catch (e) {}
        }
        var src = self.ctx.createMediaStreamSource(stream);
        var an = self.ctx.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.0;
        src.connect(an);
        self.analyser = an;
        // float data keeps the real dynamic range: the byte API pins
        // everything above -30dBFS to 255 and destroys the onset spikes
        self.fbuf = new Float32Array(an.frequencyBinCount);
        self.prev = new Float32Array(an.frequencyBinCount);
        // prev holds LINEAR magnitudes — seeding it with dB values
        // turned the very first frame into a fake 30000-wide onset
        for (var i = 0; i < self.prev.length; i++) self.prev[i] = 0;
        self.running = true;
        self.startedAt = Date.now();
        self.baseStart = self.clock();
        self.onState('listening');
        self.loop();
        return true;
      } catch (err) {
        // the device opened but the analysis could not start: hand the
        // device back instead of leaving half a microphone behind
        self.stop();
        throw err;
      }
    }, function (err) {
      // permission denied, no device, whatever: nothing was opened, so
      // there is nothing to keep — the caller can try again later
      self.stop();
      throw err;
    });
  };

  Mic.prototype.loop = function () {
    var self = this;
    if (!this.running) return;
    this.analyser.getFloatFrequencyData(this.fbuf);
    var binHz = this.ctx.sampleRate / this.analyser.fftSize;
    var flux = 0;
    var fluxAll = 0;
    for (var i = 0; i < this.fbuf.length; i++) {
      var cur = this.fbuf[i];
      // silent bins come back as -Infinity; clamp so the difference
      // stays finite (a -Inf -> finite jump reads as +Infinity)
      if (!isFinite(cur)) cur = -160;
      // work in linear magnitude: dB differences squash the range
      var mag = Math.pow(10, cur / 20);
      var d = mag - this.prev[i];
      if (d > 0) {
        // favour the vocal band: drums and bass are not in the template
        var hz = i * binHz;
        var w = (hz >= VOCAL_LO && hz <= VOCAL_HI) ? 1 : 0.25;
        flux += d * w;
        /* the beat band: the kick below 200 Hz, the snare and the
           toms in the middle, a little of the cymbals on top */
        var wb = (hz < 200) ? 1.0 : (hz < 2500 ? 0.7 : (hz < 8000 ? 0.45 : 0.12));
        fluxAll += d * wb;
        /* the beat band: the kick below 200 Hz, the snare and the
           toms in the middle, a little of the cymbals on top */
        var wb = (hz < 200) ? 1.0 : (hz < 2500 ? 0.7 : (hz < 8000 ? 0.45 : 0.12));
      }
      this.prev[i] = mag;
    }
    this.level = flux;
    var now = this.clock() - this.baseStart;   // ms inside the capture
    this.fluxTimes.push(now);
    this.fluxVals.push(flux);
    this.beatTimes.push(now);
    this.beatVals.push(fluxAll);
    var cutoff = now - (WIN_SEC * 1000);
    while (this.fluxTimes.length && this.fluxTimes[0] < cutoff) {
      this.fluxTimes.shift();
      this.fluxVals.shift();
    }
    while (this.beatTimes.length && this.beatTimes[0] < cutoff) {
      this.beatTimes.shift();
      this.beatVals.shift();
    }
    this.onState('level', this.level);
    // own timer, not requestAnimationFrame: the detector must keep
    // sampling even when the screen is busy repainting
    this.pollTimer = setTimeout(function () { self.loop(); }, MIC_POLL_MS);
  };

  Mic.prototype.stop = function () {
    this.running = false;
    /* any request that is still on its way to the browser must not
       open the device behind our back */
    this.cancelled = true;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.stream) {
      try { this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      this.stream = null;
    }
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; }
    this.analyser = null;
    this.fluxTimes.length = 0;
    this.fluxVals.length = 0;
    this.beatTimes.length = 0;
    this.beatVals.length = 0;
    this.level = 0;
  };

  /** true when a capture is really open */
  Mic.prototype.isLive = function () {
    return !!(this.running && this.stream && this.stream.getAudioTracks &&
               this.stream.getAudioTracks().length);
  };

  /**
   * Peak-pick the flux envelope into discrete onset times.
   * Returns [{t, v}] where t is ms since the mic started.
   */
  Mic.prototype.onsets = function () {
    var times = this.fluxTimes, vals = this.fluxVals, n = times.length;
    if (n < 24) return [];
    var step = times[1] - times[0] || 16;
    var half = Math.max(6, Math.round(800 / step));
    var out = [], lastT = -1e9, i;
    for (i = 2; i < n - 2; i++) {
      if (!(vals[i] > vals[i - 1] && vals[i] >= vals[i + 1])) continue;
      // robust local baseline: median of the surrounding window
      var lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      var win = Array.prototype.slice.call(vals, lo, hi).sort(function (a, b) { return a - b; });
      var base = win[win.length >> 1];
      if (vals[i] < base * 3 || vals[i] <= 0) continue;
      if (times[i] - lastT < 160) continue;
      lastT = times[i];
      out.push({ t: times[i], v: vals[i] });
    }
    return out;
  };

  /**
   * The tempo and the beat grid, straight out of the room.
   * Returns null when there is no beat to be had (silence, noise).
   */
  Mic.prototype.beatAnalysis = function () {
    if (!window.BTSBeat || !window.BTSBeat.BeatTracker) return null;
    if (!this._tracker) this._tracker = new window.BTSBeat.BeatTracker({ hopMs: 5 });
    return this._tracker.analyse(this.beatTimes, this.beatVals, WIN_SEC * 1000);
  };

  /**
   * Align the BEAT grid with the song.
   *
   * The live beats are placed on the song's lyric grid: for every
   * candidate offset P the beats are mapped into the song and we count
   * how many of them land on a syllable. The winner is the position.
   *
   * Two things make this different from the word tier:
   *
   *   - the probe is the beat grid, not the raw onsets. A beat is
   *     unambiguous where a syllable is not, so the peak is sharper and
   *     a false vocal onset cannot drag the lock away.
   *   - the lock is corroborated. The song's own syllables have to fall
   *     ON the beat grid that the room is playing; that agreement is
   *     half of the confidence.
   */
  Mic.prototype.alignBeats = function (tpl, durationMs, prevP, prevPhase, timings) {
    var an = this.beatAnalysis();
    if (!an || !an.beats || an.beats.length < 6 || an.confidence < 0.12) return null;
    var beats = an.beats;
    var now = this.clock() - this.baseStart;
    var period = an.periodMs;

    /* the window slides, so the phase can land on a different beat of
       the same grid — fold it back onto the grid we already trust */
    var phase = an.phaseMs;
    if (typeof prevPhase === 'number' && period > 0) {
      phase = prevPhase + Math.round((phase - prevPhase) / period) * period;
    }

    var oi = new Int32Array(beats.length);
    var t0 = Infinity;
    for (var i = 0; i < beats.length; i++) {
      var t = beats[i].t;
      if (t < 0) t = 0;
      oi[i] = Math.round(t / HOP_MS);
      if (t < t0) t0 = t;
    }

    var n = tpl.length;
    var lo = -Math.floor(t0 / HOP_MS);
    var hi = Math.floor(durationMs / HOP_MS);
    if (hi <= lo) return null;

    var base = new Float32Array(hi - lo + 1);
    var best = -1, bestP = lo;
    for (var p = lo; p <= hi; p++) {
      var s = 0;
      for (i = 0; i < oi.length; i++) {
        var j = p + oi[i];
        if (j >= 0 && j < n) s += tpl[j];
      }
      base[p - lo] = s;
      if (s > best) { best = s; bestP = p; }
    }
    if (best <= 0) return null;

    /* the same soft continuity prior the word tier uses: the song keeps
       playing forward, but a much better match elsewhere can still win */
    var total = base;
    if (prevP != null) {
      var amp = best * 0.6;
      var sig = 5000 / HOP_MS;
      var cP = Math.round(prevP / HOP_MS);
      var a = Math.max(lo, cP - Math.round(sig * 3));
      var b = Math.min(hi, cP + Math.round(sig * 3));
      total = new Float32Array(hi - lo + 1);
      for (p = lo; p <= hi; p++) total[p - lo] = base[p - lo];
      for (p = a; p <= b; p++) {
        var d = (p - cP);
        total[p - lo] += amp * Math.exp(-(d * d) / (2 * sig * sig));
      }
      best = -1;
      for (p = lo; p <= hi; p++) if (total[p - lo] > best) { best = total[p - lo]; bestP = p; }
    }

    var P = bestP * HOP_MS;

    /* corroboration: do the song's own syllables fall on the beat grid
       the room is playing? */
    var consistency = 0;
    var words = (timings && timings.W) || null;
    if (words && words.length && period > 0) {
      var gridSong = P + phase;
      var hits = 0;
      for (i = 0; i < words.length; i++) {
        var dw = words[i][0] - gridSong;
        var k = Math.round(dw / period);
        if (Math.abs(dw - k * period) <= 90) hits++;
      }
      consistency = hits / words.length;
    }

    var hitRate = base[bestP - lo] / beats.length;
    var confidence = Math.max(0, Math.min(1, hitRate)) * 0.55 +
                     Math.max(0, Math.min(1, consistency)) * 0.45;

    /* the peak has to stand apart from the rest of the field */
    var runner = 0;
    var far = Math.round(2000 / HOP_MS);
    for (var q = lo; q <= hi; q++) {
      if (Math.abs(q - bestP) >= far && base[q - lo] > runner) runner = base[q - lo];
    }
    var sharp = 0;
    var win = Math.round(600 / HOP_MS);
    for (q = Math.max(lo, bestP - win); q <= Math.min(hi, bestP + win); q++) {
      if (Math.abs(q - bestP) >= Math.round(400 / HOP_MS) && base[q - lo] > sharp) sharp = base[q - lo];
    }
    var distinct = base[bestP - lo] > runner * 1.12 && base[bestP - lo] > sharp * 1.25;

    return {
      songMs: Math.max(0, P + now),
      P: P,
      confidence: confidence,
      distinct: distinct,
      onsets: beats.length,
      bpm: an.bpm,
      periodMs: period,
      phaseMs: phase,
      hitRate: hitRate,
      consistency: consistency,
      runnerUp: runner / beats.length
    };
  };

  /**
   * Match the detected onsets against the timing grid.
   *
   * P is the song position that corresponds to "the moment the mic
   * opened" — it is negative when the song was already playing.
   * For every candidate P we ask how many detected onsets land on a
   * word/line pulse of the template. The candidate with the most hits
   * wins; hits-per-onset is the confidence.
   */
  Mic.prototype.align = function (tpl, durationMs, prevP) {
    var ons = this.onsets();
    if (ons.length < 8) return null;

    var now = this.clock() - this.baseStart;     // ms inside the capture
    var i;
    var oi = new Int32Array(ons.length);
    var t0 = Infinity;
    for (i = 0; i < ons.length; i++) {
      var t = ons[i].t;                          // already relative to the capture
      if (t < 0) t = 0;
      oi[i] = Math.round(t / HOP_MS);
      if (t < t0) t0 = t;
    }

    var n = tpl.length;
    var lo = -Math.floor(t0 / HOP_MS);          // the song may predate the mic
    var hi = Math.floor(durationMs / HOP_MS);
    var count = hi - lo + 1;
    if (count <= 0) return null;

    // base score: how many onsets land on a template pulse
    var base = new Float32Array(count);
    var best = -1, bestP = lo;
    for (var p = lo; p <= hi; p++) {
      var s = 0;
      for (i = 0; i < oi.length; i++) {
        var j = p + oi[i];
        if (j >= 0 && j < n) s += tpl[j];
      }
      base[p - lo] = s;
      if (s > best) { best = s; bestP = p; }
    }
    if (best <= 0) return null;

    // soft continuity prior: the song keeps playing forward from where
    // we were, but a much better match elsewhere can still win
    var total = base;
    if (prevP != null) {
      var amp = best * 0.6;
      var sig = 5000 / HOP_MS;
      var cP = Math.round(prevP / HOP_MS);
      var a = Math.max(lo, cP - Math.round(sig * 3));
      var b = Math.min(hi, cP + Math.round(sig * 3));
      total = new Float32Array(count);
      for (p = lo; p <= hi; p++) total[p - lo] = base[p - lo];
      for (p = a; p <= b; p++) {
        var d = (p - cP);
        total[p - lo] += amp * Math.exp(-(d * d) / (2 * sig * sig));
      }
      best = -1;
      for (p = lo; p <= hi; p++) if (total[p - lo] > best) { best = total[p - lo]; bestP = p; }
    }

    // confidence = share of onsets that found a pulse (ignoring the prior)
    var confidence = base[bestP - lo] / ons.length;

    // the peak has to stand apart from other candidates
    var runner = 0;
    var far = Math.round(2000 / HOP_MS);
    for (var q = lo; q <= hi; q++) {
      if (Math.abs(q - bestP) >= far && base[q - lo] > runner) runner = base[q - lo];
    }
    // ...and it has to be a sharp peak, not a flat plateau
    var sharp = 0;
    var win = Math.round(600 / HOP_MS);
    for (q = Math.max(lo, bestP - win); q <= Math.min(hi, bestP + win); q++) {
      if (Math.abs(q - bestP) >= Math.round(400 / HOP_MS) && base[q - lo] > sharp) sharp = base[q - lo];
    }
    var distinct = base[bestP - lo] > runner * 1.15 && base[bestP - lo] > sharp * 1.35;

    var P = bestP * HOP_MS;
    return {
      songMs: Math.max(0, P + now),
      P: P,
      confidence: confidence,
      distinct: distinct,
      onsets: ons.length,
      runnerUp: runner / ons.length
    };
  };

  /* ── the engine that drives the concert view ───────────────── */
  function SyncEngine(opts) {
    this.onTick = opts.onTick || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.timings = null;
    this.songId = null;
    this.duration = 0;
    this.startedAt = 0;         // wall clock when position 0 was reached
    this.positionMs = 0;
    this.playing = false;
    this.finished = false;      // the track ran to its end
    this.mic = null;
    this.micTimer = null;
    this.lock = null;           // last mic alignment
    this.lockConfidence = 0;
    this.lockMiss = 0;          // consecutive failed alignments
    this.lockAt = 0;            // when the mic last refreshed the lock
    this.anchorMs = null;       // song position the lock reported ...
    this.anchorAt = 0;          // ... at that wall-clock moment
    this.timer = null;
    this.drift = 0;
    this.lines = [];
    this.words = null;
    this.tpl = null;
    this.synthetic = false;     // true when the timeline is made up
    this.micMode = 'word';     // 'word' | 'beat' — how the mic locks on
    this.beat = null;           // the live beat grid, once we have one
  }

  SyncEngine.prototype.load = function (songId, lines) {
    var t = getTimings(songId);
    var raw = lines || [];
    this.songId = songId;
    this.timings = t;
    this.positionMs = 0;
    this.finished = false;
    this.lock = null;
    this.lockConfidence = 0;
    this.lockMiss = 0;
    this.lockAt = 0;
    this.anchorMs = null;
    this.anchorAt = 0;
    this.synthetic = false;

    if (t && t.L && t.L.length && t.T && t.T.length) {
      this.duration = t.d || 0;
      // the track has to be at least as long as its content, otherwise
      // the cursor would run off the end of the grid
      var last = 0;
      for (var i = 0; i < t.L.length; i++) {
        if (typeof t.L[i] === 'number' && t.L[i] > last) last = t.L[i];
      }
      if (this.duration < last) this.duration = last;
      this.tpl = buildTemplate(t, this.duration);
      this.lines = t.T.map(function (txt, i) { return { t: t.L[i], text: txt }; });
      this.words = t.W || null;
    } else {
      // no timing data: keep the words and lay them on an even, made-up
      // timeline so the engine still has a clock, a grid and no NaNs
      this.duration = 0;
      this.tpl = null;
      this.words = null;
      this.lines = raw.map(function (l, i) {
        var txt = (typeof l === 'string') ? l : ((l && l.text) || '');
        return { t: i * UNTIMED_LINE_MS, text: txt };
      });
      if (this.lines.length) {
        this.duration = this.lines.length * UNTIMED_LINE_MS;
        this.synthetic = true;
      }
    }
    return !!t;
  };

  SyncEngine.prototype.start = function (fromMs) {
    this.positionMs = fromMs || 0;
    this.startedAt = Date.now() - this.positionMs;
    this.playing = true;
    this.finished = false;
    var self = this;
    clearInterval(this.timer);
    this.timer = setInterval(function () { self.tick(); }, 60);
    this.tick();
  };

  SyncEngine.prototype.pause = function () {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.tick();
  };

  SyncEngine.prototype.seek = function (ms) {
    var target = (typeof ms === 'number' && isFinite(ms)) ? ms : 0;
    target = Math.max(0, this.duration ? Math.min(this.duration, target) : 0);
    this.positionMs = target;
    this.startedAt = Date.now() - this.positionMs;
    this.finished = false;
    // a seek moves the clock under the lock's feet: re-anchor the lock
    // on the new spot instead of letting it drag us back
    this.anchorMs = this.positionMs;
    this.anchorAt = Date.now();
    this.tick();
  };

  /**
   * Remember where the lock's song position was when we saw it. The
   * reference has to move, otherwise the correction pins the clock to
   * one spot instead of letting it run.
   */
  SyncEngine.prototype.anchor = function (now) {
    var L = this.lock;
    if (!L) { this.anchorMs = null; this.anchorAt = 0; return; }
    var ms = L.songMs;
    if (typeof ms !== 'number' || !isFinite(ms)) { this.anchorMs = null; return; }
    if (this.anchorMs === null || ms !== this.anchorMs) {
      this.anchorMs = ms;
      this.anchorAt = now;
    }
  };

  SyncEngine.prototype.tick = function () {
    var now = Date.now();
    var pos = this.positionMs;
    var done = false;
    if (this.playing) {
      pos = now - this.startedAt;

      // a lock nobody refreshes is a stale lock: the mic may have gone
      // quiet. Drop it instead of correcting against a frozen number.
      if (this.lock) {
        var since = this.lockAt || this.anchorAt || 0;
        if (since && (now - since) > LOCK_TTL_MS) {
          this.lock = null;
          this.lockConfidence = 0;
          this.lockAt = 0;
          this.anchorMs = null;
          this.onStatus('mic-lost');
        }
      }

      // if the mic has a confident lock, follow it instead of free-running
      if (this.lock && this.lockConfidence >= 0.42) {
        this.anchor(now);
        if (this.anchorMs !== null) {
          // where the mic says the song is right now
          var heard = this.anchorMs + (now - this.anchorAt);
          var drift = heard - pos;
          this.drift = drift;
          if (Math.abs(drift) > 900) {
            // hard resync: re-base the clock on the mic, never on a
            // frozen timestamp (that would freeze the position too)
            this.startedAt = now - heard;
            pos = heard;
          } else if (Math.abs(drift) > 150) {
            // gentle pull: a fraction of the error per tick, so the
            // correction converges and then lets the clock run free
            this.startedAt -= drift * 0.12;
            pos = now - this.startedAt;
          }
        }
      }

      // the end of the track: report it, never wind back to 0:00
      if (this.duration && pos >= this.duration) {
        pos = this.duration;
        done = true;
      }
    }

    this.positionMs = pos;
    if (done) {
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      this.onTick(pos, this);
      if (!this.finished) {
        this.finished = true;
        this.onStatus('finished');
      }
      return;
    }
    this.onTick(pos, this);
  };

  SyncEngine.prototype.currentLine = function (pos) {
    var lines = this.lines;
    if (!lines || !lines.length) return -1;
    if (typeof pos !== 'number' || !isFinite(pos)) pos = this.positionMs;
    if (this.micMode === 'beat') pos = this.beatQuantize(pos);
    if (this.micMode === 'beat') pos = this.beatQuantize(pos);
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].t;
      if (typeof t !== 'number' || !isFinite(t)) continue;
      if (t <= pos) idx = i; else break;
    }
    // at (or past) the end of the track the cursor belongs on the last
    // line, not nowhere
    if (this.duration && pos >= this.duration) return lines.length - 1;
    return idx;
  };

  SyncEngine.prototype.wordsIn = function (lineIdx) {
    if (!this.words || !this.words.length) return null;
    if (!this.lines || lineIdx == null || lineIdx < 0 || lineIdx >= this.lines.length) return null;
    var out = [];
    for (var i = 0; i < this.words.length; i++) {
      if (this.words[i][0] >= this.lines[lineIdx].t) {
        var next = (lineIdx + 1 < this.lines.length) ? this.lines[lineIdx + 1].t : Infinity;
        if (this.words[i][0] < next) out.push(this.words[i]);
        else break;
      }
    }
    return out.length ? out : null;
  };

  /** ms since the microphone opened, in the microphone's own clock */
  SyncEngine.prototype.micElapsed = function () {
    if (this.mic && this.mic.baseStart != null && this.mic.clock) {
      return this.mic.clock() - this.mic.baseStart;
    }
    return 0;
  };

  /**
   * The user tapped a line: treat it as ground truth.
   *
   * The clock is re-based on that spot and the lock is anchored to it,
   * so the correction moves the lyrics once and then lets the clock run
   * — it must never pin the position to a fixed timestamp.
   */
  SyncEngine.prototype.correctTo = function (songMs) {
    if (typeof songMs !== 'number' || !isFinite(songMs)) return false;
    var now = Date.now();
    this.positionMs = Math.max(0, songMs);
    this.startedAt = now - this.positionMs;
    this.finished = false;
    var L = this.lock || {};
    L.songMs = songMs;
    L.P = songMs - this.micElapsed();
    this.lock = L;
    this.lockConfidence = 1;
    this.anchorMs = songMs;
    this.anchorAt = now;
    return true;
  };

  SyncEngine.prototype.startMic = function (mode) {
    var self = this;
    if (mode) this.micMode = (mode === 'beat') ? 'beat' : 'word';
    if (this.mic && this.mic.isLive && this.mic.isLive()) return Promise.resolve(true);
    // a previous attempt that failed must never be reused: the browser
    // asks for the microphone only once, so the way back in is a FRESH
    // request on a FRESH object
    if (this.mic) { try { this.mic.stop(); } catch (e) {} this.mic = null; }
    var mic = new Mic(function (state, level) { self.onStatus(state, level); });
    this.mic = mic;
    return mic.start().then(function () {
      /* A newer attempt took the slot while this one was still opening.
         Let go of this capture only — the live one belongs to the other
         attempt now. */
      if (self.mic !== mic) {
        try { mic.stop(); } catch (e) {}
        throw new Error('mic-cancelled');
      }
      self.onStatus('listening');
      clearInterval(self.micTimer);
      self.micTimer = setInterval(function () { self.alignTick(); }, 1100);
      return true;
    }, function (err) {
      // the microphone never opened: report the failure, throw the
      // instance away and let the next tap ask the browser again
      var cancelled = /cancelled/i.test(String((err && err.message) || err));
      /* Only the attempt that owns the slot may clear the shared timer
         and the lock — clearing them here would switch off a microphone
         that a later tap has already opened. */
      if (self.mic === mic) {
        clearInterval(self.micTimer);
        self.micTimer = null;
        self.mic = null;
        self.lock = null;
        self.lockConfidence = 0;
        self.lockAt = 0;
        self.anchorMs = null;
        /* a cancellation is not a failure: the user asked for the mic to
           be let go of, so the UI must not claim the microphone failed */
        if (!cancelled) self.onStatus('mic-error', (err && err.name) || 'error');
      }
      try { mic.stop(); } catch (e) {}
      throw err;
    });
  };

  /** one alignment round against the template */
  SyncEngine.prototype.alignTick = function () {
    var self = this;
    if (!self.mic || !self.tpl) return;
    var prev = self.lock ? self.lock.P : null;
    var res;
    if (self.micMode === 'beat') {
      var prevPhase = self.lock ? self.lock.phaseMs : null;
      res = self.mic.alignBeats(self.tpl, self.duration, prev, prevPhase, self.timings);
      /* the tempo is worth showing even when the lock has not settled:
         "120 BPM, still looking for the song" tells the user that the
         room is being heard, even when the song is not identified yet */
      if (!res) {
        var an = self.mic.beatAnalysis ? self.mic.beatAnalysis() : null;
        self.beat = an ? { bpm: an.bpm, periodMs: an.periodMs, phaseMs: an.phaseMs,
                           confidence: an.confidence, beats: an.beats.length } : null;
        self.onStatus('searching', 0, self.beat);
        return;
      }
      self.beat = {
        bpm: res.bpm, periodMs: res.periodMs, phaseMs: res.phaseMs,
        confidence: res.confidence, beats: res.onsets
      };
    } else {
      res = self.mic.align(self.tpl, self.duration, prev);
    }
    if (!res) {
      // no fresh alignment: the lock ages out on its own
      self.lockMiss = (self.lockMiss || 0) + 1;
      self.onStatus('searching', 0);
      return;
    }
    var ok = res.confidence >= 0.42 && res.distinct && res.onsets >= MIN_LOCK_ONSETS;
    if (ok) {
      self.lock = res;
      self.lockConfidence = res.confidence;
      self.lockMiss = 0;
      self.lockAt = Date.now();
    } else {
      // hysteresis: one bad alignment does not throw the lock away
      self.lockMiss = (self.lockMiss || 0) + 1;
      if (self.lockMiss >= 4 && self.lock) {
        self.lock = null;
        self.lockConfidence = 0;
        self.lockAt = 0;
        self.anchorMs = null;
      }
      ok = !!(self.lock && self.lockConfidence >= 0.42);
    }
    self.onStatus(ok ? 'locked' : 'searching', res.confidence, self.beat);
  };

  /**
   * The cursor, snapped to the beat.
   *
   * In beat mode the position still runs on the clock, but the line
   * that is highlighted only changes on a beat — so the words turn over
   * with the music instead of wherever the last syllable happened to
   * land.
   */
  SyncEngine.prototype.beatQuantize = function (pos) {
    var L = this.lock;
    if (this.micMode !== 'beat' || !L || !L.periodMs || !L.phaseMs) return pos;
    var period = L.periodMs;
    var origin = L.P + L.phaseMs;         // the song time of a beat
    if (!isFinite(origin) || period <= 0) return pos;
    var k = Math.floor((pos - origin) / period);
    var q = origin + k * period;
    return (q < 0 || !isFinite(q)) ? pos : q;
  };

  SyncEngine.prototype.stopMic = function () {
    clearInterval(this.micTimer);
    this.micTimer = null;
    if (this.mic) { try { this.mic.stop(); } catch (e) {} this.mic = null; }
    this.lock = null;
    this.lockConfidence = 0;
    this.lockMiss = 0;
    this.lockAt = 0;
    this.anchorMs = null;
    this.onStatus('off');
  };

  SyncEngine.prototype.destroy = function () {
    this.pause();
    this.stopMic();
  };

  /* ── tap-to-sync recorder ──────────────────────────────────── */
  function TapSync(songId, lines, onDone) {
    this.songId = songId;
    this.lines = lines || [];
    this.onDone = onDone || function () {};
    this.running = false;
    this.startedAt = 0;
    this.times = [];
    this.idx = 0;
  }

  TapSync.prototype.begin = function () {
    this.running = true;
    this.startedAt = Date.now();
    this.times = [];
    this.idx = 0;
  };

  TapSync.prototype.tap = function () {
    if (!this.running) return null;
    var t = Date.now() - this.startedAt;
    if (this.idx < this.lines.length) {
      this.times.push(t);           // the user owns these times
      this.idx++;
    }
    return { nextIndex: this.idx, at: t };
  };

  TapSync.prototype.finish = function () {
    this.running = false;
    var t = getTimings(this.songId);
    var L = this.times.slice();
    var T = this.lines.map(function (l) {
      return (typeof l === 'string') ? l : ((l && l.text) || '');
    });

    // The tapped times live on the user's own clock: they start when
    // the user pressed START. The official timing lives on the song's
    // clock. Mixing the two is what used to produce tracks whose lines
    // fell outside their own duration.
    var userEnd = L.length ? L[L.length - 1] : 0;
    var minDur = userEnd + TAP_TAIL_MS;      // the track must outlive its last line
    var d;
    if (t && t.d && t.d >= minDur) {
      // the official track is longer and consistent with the taps: keep it
      d = t.d;
    } else {
      // no usable official duration: derive one from the taps
      d = minDur;
    }

    // Lines the user did not reach still need a slot, otherwise the
    // cursor would run off the end of the grid. But they must not be
    // crammed into the last few seconds either: a partial save used to
    // pack every unstamped line into the four seconds after the last
    // tap, so the cursor was at line 26 by 0:04. Unstamped lines get
    // the same even spacing the app uses for a song with no timing at
    // all, so the song still walks through at a sane pace.
    var i;
    if (L.length < T.length) {
      var need = T.length - L.length;          // compute before growing L
      var from = L.length ? L[L.length - 1] : 0;
      for (i = 0; i < need; i++) L.push(from + UNTIMED_LINE_MS * (i + 1));
    }
    // the duration always covers the content
    var maxL = 0;
    for (i = 0; i < L.length; i++) {
      if (typeof L[i] !== 'number' || !isFinite(L[i])) L[i] = maxL;
      if (L[i] > maxL) maxL = L[i];
    }
    d = Math.max(d, maxL + TAP_TAIL_MS);
    return { d: d, L: L, T: T };
  };

  window.BTSSync = {
    getTimings: getTimings,
    hasTimings: hasTimings,
    saveCustom: saveCustom,
    setCustom: function (id, data) { custom[id] = data; saveCustom(); },
    clearCustom: function (id) { delete custom[id]; saveCustom(); },
    hasCustom: function (id) { return !!custom[id]; },
    officialCount: function () { return Object.keys(OFFICIAL).length; },
    SyncEngine: SyncEngine,
    TapSync: TapSync,
    Mic: Mic,
    HOP_MS: HOP_MS
  };
})();

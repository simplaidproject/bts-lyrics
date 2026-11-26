/* ═══════════════════════════════════════════════════════════════
   Beat recognition.

   The word-sync tier asks "which syllable is that?" and matches the
   answer against the lyric grid. This one asks a different question:
   "where is the downbeat?" — the drum pattern is far more regular
   than a vocal line, so it is the better anchor in a loud room.

   The pipeline is the classic one:

     1. an onset-strength envelope (full band — the beat lives in the
        kick and the snare, not in the voice)
     2. autocorrelation for the tempo, weighted by a log-normal prior
        around 120 BPM so the estimate does not wander into a
        half-time or double-time reading
     3. a comb filter over the winning period to find the phase
     4. the beats themselves: the local maxima that sit on the grid

   The tracker is deliberately independent of the app: it takes a
   time/value envelope and returns a tempo, a phase and a list of
   beats, so it can be tested on its own.
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BTSBeat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    hopMs: 5,           // envelope resolution we resample onto
    bpmMin: 60,         // the slowest beat we are willing to call a beat
    bpmMax: 200,        // ...and the fastest
    priorBpm: 120,      // where most pop/hip-hop sits
    priorWidth: 1.05,   // octaves of slack around the prior
    minBeats: 6,        // fewer beats than this and we say nothing
    minConfidence: 0.18 // how far the comb score must stand out
  };

  function BeatTracker(opts) {
    var o = opts || {};
    this.hopMs = o.hopMs || DEFAULTS.hopMs;
    this.bpmMin = o.bpmMin || DEFAULTS.bpmMin;
    this.bpmMax = o.bpmMax || DEFAULTS.bpmMax;
    this.priorBpm = o.priorBpm || DEFAULTS.priorBpm;
    this.priorWidth = o.priorWidth || DEFAULTS.priorWidth;
    this.minBeats = o.minBeats || DEFAULTS.minBeats;
    this.minConfidence = o.minConfidence != null ? o.minConfidence : DEFAULTS.minConfidence;
  }

  /* ── resample an irregular envelope onto a uniform grid ─────────── */
  function toGrid(times, vals, hopMs, spanMs) {
    if (!times || !times.length) return null;
    var start = times[0];
    var end = times[times.length - 1];
    if (spanMs) end = Math.max(end, start + spanMs);
    var n = Math.max(2, Math.floor((end - start) / hopMs) + 1);
    var grid = new Float32Array(n);
    /* linear interpolation: the envelope arrives every ~10 ms and the
       grid is finer than that, so an empty bin would be a hole rather
       than a value */
    var j = 0;
    for (var i = 0; i < n; i++) {
      var t = start + i * hopMs;
      while (j < times.length - 2 && times[j + 1] < t) j++;
      var t0 = times[j], t1 = times[j + 1];
      if (t1 === t0) { grid[i] = vals[j]; continue; }
      var f = (t - t0) / (t1 - t0);
      if (f < 0) f = 0; else if (f > 1) f = 1;
      grid[i] = vals[j] * (1 - f) + vals[j + 1] * f;
    }
    return { grid: grid, start: start, hopMs: hopMs, n: n };
  }

  function meanOf(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : 0;
  }

  /* half-wave rectify: only the RISES carry the beat */
  function rectify(a) {
    var m = meanOf(a);
    var out = new Float32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = Math.max(0, a[i] - m);
    return out;
  }

  function autocorr(env, lag) {
    var n = env.length - lag;
    if (n <= 0) return 0;
    var s = 0;
    for (var i = 0; i < n; i++) s += env[i] * env[i + lag];
    return s / n;
  }

  /* ── the comb: how much energy sits on a grid of period p ──────── */
  function combScore(env, period, phase) {
    var n = env.length;
    var s = 0, count = 0;
    for (var p = phase; p < n; p += period) {
      /* take the loudest bin in a small window: a beat that is a few
         milliseconds off the grid must still count, otherwise the
         phase search punishes itself for the resolution it chose */
      var i = Math.round(p);
      var v = 0;
      for (var k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) {
        if (env[k] > v) v = env[k];
      }
      s += v;
      count++;
    }
    return count ? s / count : 0;
  }

  /**
   * analyse(times, vals, spanMs) -> null | {
   *   bpm, periodMs, phaseMs, beats:[{t,v}], confidence, strength
   * }
   *
   * times/vals: the onset envelope, t in ms.
   * phaseMs: the time of the first beat of the grid, relative to the
   * first sample.
   */
  BeatTracker.prototype.analyse = function (times, vals, spanMs) {
    var g = toGrid(times, vals, this.hopMs, spanMs);
    if (!g || g.n < 64) return null;

    var env = rectify(g.grid);
    var energy = meanOf(env);
    if (energy <= 0) return null;

    var minLag = Math.max(2, Math.round(60000 / this.bpmMax / this.hopMs));  // 200 BPM
    var maxLag = Math.min(g.n - 2, Math.round(60000 / this.bpmMin / this.hopMs)); // 60 BPM
    if (maxLag <= minLag) return null;

    // ── tempo: autocorrelation with a log-normal prior ──────────────
    var bestLag = 0, bestScore = -1;
    var scores = {};
    for (var lag = minLag; lag <= maxLag; lag++) {
      var r = autocorr(env, lag);
      var bpm = 60000 / (lag * this.hopMs);
      // a log-normal prior around 120 BPM: real songs sit near it, and
      // without it the estimate likes to halve or double
      var prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / this.priorBpm) / Math.LN2 / this.priorWidth, 2));
      var s = r * prior;
      scores[lag] = { raw: r, prior: prior, score: s };
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    if (!bestLag || bestScore <= 0) return null;

    // ── octave check: compare the winner with its half and double ───
    var cands = [bestLag, bestLag * 2, Math.round(bestLag / 2)];
    var list = [];
    for (var c = 0; c < cands.length; c++) {
      var L = cands[c];
      if (L < minLag || L > maxLag) continue;
      var period = L;
      // the phase search wants a fine step, but not 4000 of them
      var step = Math.max(1, Math.round(period / 96));
      var bestPhase = 0, bestComb = -1;
      for (var ph = 0; ph < period; ph += step) {
        var cs = combScore(env, period, ph);
        if (cs > bestComb) { bestComb = cs; bestPhase = ph; }
      }
      var bpmHere = 60000 / (period * this.hopMs);
      var priorHere = Math.exp(-0.5 * Math.pow(Math.log(bpmHere / this.priorBpm) / Math.LN2 / this.priorWidth, 2));
      var combNorm = bestComb / (energy || 1);
      list.push({
        period: period, phase: bestPhase, comb: bestComb, combNorm: combNorm,
        prior: priorHere, bpm: bpmHere,
        combined: combNorm * priorHere
      });
    }
    if (!list.length) return null;

    var best = list[0];
    for (c = 1; c < list.length; c++) if (list[c].combined > best.combined) best = list[c];

    /* A fast beat and a slow one can both comb well when the music has
       strong off-beats: a 160 BPM song also looks like 80 BPM. When a
       faster reading is nearly as good, believe the faster one — the
       prior already keeps the estimate out of the silly places. */
    for (c = 0; c < list.length; c++) {
      var cand = list[c];
      if (cand.bpm <= best.bpm) continue;
      if (cand.combNorm >= best.combNorm * 0.72 && cand.prior >= best.prior * 0.55) {
        best = cand;
      }
    }

    var periodMs = best.period * this.hopMs;
    var bpm = 60000 / periodMs;

    // ── the beats: local maxima that sit on the grid ────────────────
    var beats = [];
    var tol = Math.max(1, Math.round(best.period * 0.22));
    for (var p = best.phase; p < g.n; p += best.period) {
      var pi = Math.round(p);
      var bi = -1, bv = 0;
      for (var k = Math.max(0, pi - tol); k <= Math.min(g.n - 1, pi + tol); k++) {
        if (env[k] > bv) { bv = env[k]; bi = k; }
      }
      if (bi < 0) continue;
      beats.push({ t: g.start + bi * this.hopMs, v: bv, grid: bi });
    }
    if (beats.length < this.minBeats) return null;

    // how far the best phase stands out from a random one
    var randomPhase = 0;
    var step2 = Math.max(1, Math.round(best.period / 32));
    var total = 0, samples = 0;
    for (var rp = 0; rp < best.period; rp += step2) {
      total += combScore(env, best.period, rp);
      samples++;
    }
    randomPhase = samples ? total / samples : 0;
    var peakiness = randomPhase > 0 ? best.comb / randomPhase : 0;

    /* Confidence has to answer "is this really a beat?" and not "is
       there a number?". combNorm is the energy on the grid over the
       energy of the envelope: 1 means an arbitrary phase would score
       the same (noise), 10 means the grid is ten times louder than
       the background. peakiness asks how much better the best phase
       is than a random one. */
    var lift = Math.max(0, (best.combNorm - 1.2) / 3);
    var sharp = Math.max(0, (peakiness - 1) / 1.5);
    var confidence = Math.min(1, lift) * Math.min(1, sharp);
    if (confidence < this.minConfidence) {
      return {
        bpm: bpm, periodMs: periodMs, phaseMs: g.start + best.phase * this.hopMs,
        beats: beats, confidence: confidence, strength: best.combNorm, weak: true
      };
    }

    return {
      bpm: bpm,
      periodMs: periodMs,
      phaseMs: g.start + best.phase * this.hopMs,
      beats: beats,
      confidence: confidence,
      strength: best.combNorm,
      peakiness: peakiness
    };
  };

  return {
    BeatTracker: BeatTracker,
    defaults: DEFAULTS
  };
});

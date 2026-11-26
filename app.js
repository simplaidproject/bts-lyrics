/* ═══════════════════════════════════════════════════════════════
   보라해 · Borahae — offline BTS lyric book
   No framework. No network calls at runtime: the lyric pack is a
   plain script (data/lyrics.js) and the service worker precaches
   every asset, so the app works with the radio off.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── state ─────────────────────────────────────────────── */
  var S = {
    data: null,
    byId: {},
    songs: [],
    releases: [],
    view: 'library',
    query: '',
    currentId: null,
    setlist: [],
    stars: {},
    offlineFilter: false,
    settings: { scale: 1, autoSpeed: 3500, lang: 'roman' },
    installed: false,
    libraryBuilt: false,
    libraryMarkup: null,       // pristine copy of the library section
    pendingSearchFocus: false,  // focus the search field once the library is up
    offlineReady: false
  };

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }

  /* ── toast ─────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2300);
  }


  /* the light stick: purple, and it pulses on the beat.
     Three modes: 'beat' follows the measured beat, 'pulse' breathes on
     its own, 'on' is a flat colour with nothing moving. */
  var STICK = { open: false, songId: null, timer: null, phase: 0, mode: 'beat' };
  var STICK_MODES = [
    { id: 'beat', label: 'BEAT', title: 'Flash on the beat — needs the microphone' },
    { id: 'pulse', label: 'PULSE', title: 'Breathe on its own' },
    { id: 'on', label: 'ON', title: 'A flat colour, nothing moving' }
  ];

  /* ── the light stick ──────────────────────────────────────────────
     A full-screen ARMY purple. When the microphone is listening for the
     beat, the flash follows the beat grid the app has measured — the
     same grid the karaoke cursor rides on, so the light and the words
     land together. Without a beat to follow it breathes gently. */
  function openStick(songId) {
    STICK.open = true;
    STICK.songId = songId || null;
    STICK.mode = LS.get('bts.stickMode', 'beat');
    STICK.since = Date.now();
    var el = $('#stickLight');
    el.hidden = false;
    el.classList.remove('is-auto');
    var song = songId ? S.byId[songId] : null;
    $('#stickLabel').textContent = song ? song.title : 'Light stick';
    document.body.classList.add('is-locked');
    updateStickBar();
    requestFullscreen();
  }

  /* Leaving fullscreen and hiding the light are two different
     moments. Hide the light only once the browser is out of
     fullscreen — doing it the other way round flashes the black
     backdrop, and on a phone that black can stick. */
  function closeStick() {
    STICK.open = false;
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && document.exitFullscreen) {
      try { document.exitFullscreen().catch(function () {}); } catch (e) {}
      setTimeout(hideStick, 500);      // in case the browser never reports back
      return;
    }
    hideStick();
  }

  function hideStick() {
    var el = $('#stickLight');
    if (el) {
      el.hidden = true;
      el.classList.remove('is-auto');
      el.style.setProperty('--pulse', '0');
    }
    if (!C.open) document.body.classList.remove('is-locked');
  }

  /* the bar of the light: the song, the tempo, the mode and — when the
     mode needs the microphone and does not have it — the button that
     asks for it */
  function updateStickBar() {
    var mode = STICK.mode;
    var btn = $('#stickMode');
    if (btn) {
      var def = STICK_MODES.filter(function (m) { return m.id === mode; })[0] || STICK_MODES[0];
      btn.textContent = def.label;
      btn.title = def.title;
    }
    var mic = $('#stickMic');
    var engine = C.engine;
    var live = !!(engine && engine.mic && engine.mic.isLive && engine.mic.isLive());
    if (mic) mic.hidden = !(mode === 'beat' && !live);
    var label = $('#stickLabel');
    if (label) {
      var song = STICK.songId ? S.byId[STICK.songId] : null;
      var bpm = engine && engine.beat && engine.beat.bpm ? Math.round(engine.beat.bpm) : 0;
      var extra = '';
      if (mode === 'beat') extra = live ? (bpm ? '  ·  ♩' + bpm : '  ·  listening…') : '  ·  no mic';
      else if (bpm) extra = '  ·  ♩' + bpm;
      label.textContent = (song ? song.title : 'Light stick') + extra;
    }
  }

  function cycleStickMode() {
    var i = 0;
    for (var k = 0; k < STICK_MODES.length; k++) if (STICK_MODES[k].id === STICK.mode) i = k;
    STICK.mode = STICK_MODES[(i + 1) % STICK_MODES.length].id;
    LS.set('bts.stickMode', STICK.mode);
    updateStickBar();
    toast(STICK_MODES.filter(function (m) { return m.id === STICK.mode; })[0].title);
  }

  /* the light stick wants to follow the beat, so it asks for the mic */
  function startStickMic() {
    if (!C.engine) { toast('Turn on synced mode first'); return; }
    C.engine.micMode = 'beat';
    var token = ++C.micToken;
    C.micOn = true;
    C.engine.startMic('beat').then(function () {
      if (token !== C.micToken) return;
      var m = C.engine && C.engine.mic;
      if (m && m.stream) C.micStream = m.stream;
      updateStickBar();
      toast('Listening for the beat');
    }).catch(function (err) {
      if (token !== C.micToken) return;
      C.micOn = false;
      updateStickBar();
      if (!/cancelled/i.test(String((err && err.message) || err))) toast('Microphone permission denied');
    });
  }

  /* the flash: 1 right on the beat, gone by the next one */
  function stickPulse(pos, engine) {
    if (!STICK.open) return;
    var el = $('#stickLight');
    if (!el) return;
    var mode = STICK.mode;

    /* ON: a flat colour, nothing moving */
    if (mode === 'on') {
      el.classList.remove('is-auto');
      el.style.setProperty('--pulse', '0');
      return;
    }

    var phase = null;
    var bpm = 0;

    /* PULSE: breathes on its own — at the tempo it knows, if it knows
       one, and slowly if it does not */
    if (mode === 'pulse') {
      var known = engine && engine.beat && engine.beat.bpm;
      var period = known ? (60000 / known) : 1400;
      var since = (engine && engine.mic && engine.mic.isLive && engine.mic.isLive())
        ? engine.micElapsed() : (Date.now() - (STICK.since || Date.now()));
      phase = ((since % period) + period) % period / period;
      el.classList.remove('is-auto');
      el.style.setProperty('--pulse', (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2))).toFixed(3));
      return;
    }

    /* The flash follows the beat the ROOM is playing — a light stick does
       not need to know which song it is. If the app has locked onto the
       song, the song's own beat grid is used instead, so the flash and
       the words land together. */
    if (engine && engine.beat && engine.beat.periodMs && engine.mic &&
        engine.mic.isLive && engine.mic.isLive()) {
      var period = engine.beat.periodMs;
      var elapsed = engine.micElapsed();
      var raw = ((elapsed - (engine.beat.phaseMs || 0)) % period + period) % period;
      phase = raw / period;
      bpm = engine.beat.bpm ? Math.round(engine.beat.bpm) : 0;
    } else if (engine && engine.lock && engine.lock.periodMs) {
      var p2 = engine.lock.periodMs;
      var origin = engine.lock.P + engine.lock.phaseMs;
      phase = ((pos - origin) % p2 + p2) % p2 / p2;
      bpm = engine.beat && engine.beat.bpm ? Math.round(engine.beat.bpm) : 0;
    }

    if (phase === null) {
      el.classList.add('is-auto');
      return;
    }
    el.classList.remove('is-auto');
    /* a fast attack, a slow decay — the way a stick is actually moved */
    var flash = Math.exp(-phase * 4.2);
    el.style.setProperty('--pulse', flash.toFixed(3));
    var label = $('#stickLabel');
    if (label) {
      var song = STICK.songId ? S.byId[STICK.songId] : null;
      label.textContent = (song ? song.title : 'Light stick') + (bpm ? '  ·  ♩' + bpm : '');
    }
  }

  /* ── the light stick ──────────────────────────────────────────────
     A full-screen ARMY purple. When the microphone is listening for the
     beat, the flash follows the beat grid the app has measured — the
     same grid the karaoke cursor rides on, so the light and the words
     land together. Without a beat to follow it breathes gently. */


  /* the flash: 1 right on the beat, gone by the next one */

  /* ── what is on this device ───────────────────────────────────
     The whole lyric book is one cached file and the synced tracks are
     another, so the honest answer is: every song once lyrics.js is on
     the device, and the timed ones once timings.js is there too. */
  function packState() {
    return window.__BTS_PACK__ || null;
  }
  function packHas(file) {
    var p = packState();
    return !!(p && p.known && p.files && p.files.indexOf(file) > -1);
  }
  function lyricsOffline() { return packHas('./data/lyrics.js'); }
  function timingsOffline() { return packHas('./data/timings.js'); }
  function songOffline(song) {
    if (!song) return false;
    return lyricsOffline();
  }
  function songSyncedOffline(song) {
    if (!song || !timingsOffline()) return false;
    return !!(window.BTSSync && window.BTSSync.getTimings(song.id));
  }
  function offlineSongCount() {
    return lyricsOffline() ? S.songs.length : 0;
  }

  /* the small tick that marks a song you can open with no signal */
  function offlineTick(song) {
    if (!lyricsOffline() || !songOffline(song)) return '';
    return '<span class="songrow__off" title="available offline" aria-label="available offline">' +
           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" ' +
           'stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.4l4.9 4.9L19.5 7.2"/></svg>' +
           '</span>';
  }

  function visibleSongs() {
    var list = S.songs;
    if (S.offlineFilter) list = list.filter(function (s) { return songOffline(s); });
    return list;
  }

  /* ── lyric display language ─────────────────────────────────
     Three states: the Korean original alone, the original plus a
     romanization, and the original plus the English translation. */
  var LANGS = [
    { id: 'roman', label: '로마',  title: 'Romanization first, Korean underneath' },
    { id: 'ko',    label: '한글',  title: 'Korean first, romanization underneath' },
    { id: 'en',    label: 'EN',    title: 'Romanization, Korean and English' }
  ];
  function langMode() {
    var id = (S.settings && S.settings.lang) || 'roman';
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === id) return id;
    return 'roman';
  }
  function langIndex() {
    var id = langMode();
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === id) return i;
    return 1;
  }
  function langLabel() { return LANGS[langIndex()].label; }
  function langTitle() { return LANGS[langIndex()].title; }

  /* How one lyric line is laid out: the big text, the line under it and
     the English reading aid. The romanization is the default big text;
     the Hangul original is never more than one tap away. */
  function lyricParts(song, i, mode) {
    var ko = (song && song.lines && song.lines[i]) || '';
    var r = (song && song.romanLines && song.romanLines[i]) || '';
    var e = (song && song.transLines && song.transLines[i]) || '';
    var parts = { main: ko, sub: '', subClass: 'lyric__sub lyric__sub--roman', en: '' };
    if (mode === 'ko') {
      parts.main = ko;
      parts.sub = r;
      parts.subClass = 'lyric__sub lyric__sub--roman';
    } else {
      parts.main = r || ko;
      parts.sub = (r && r !== ko) ? ko : '';
      parts.subClass = 'lyric__sub lyric__sub--ko';
      if (mode === 'en') parts.en = e;
    }
    return parts;
  }

  function formatFanchants(text) {
    return esc(text).replace(/\(([^()]{2,48})\)/g, '<span class="fanchant">($1)</span>');
  }

  function partsHtml(song, i, mode) {
    var p = lyricParts(song, i, mode);
    var out = '';
    if (p.sub) out += '<span class="' + p.subClass + '">' + esc(p.sub) + '</span>';
    if (p.en) out += '<span class="lyric__en">' + esc(p.en) + '</span>';
    return out;
  }

  /* the writer credits: each name is a link into the search, so a
     songwriter can be found across the whole book */
  function writerLinks(writers) {
    var names = String(writers).split(/\s\/\s*|,\s*/).map(function (n) { return n.trim(); })
      .filter(function (n) { return n && n !== '-' && n !== '—'; });
    if (!names.length) return '';
    return names.map(function (n) {
      return '<a class="writelink" href="#/songs?q=' + encodeURIComponent(n) + '">' + esc(n) + '</a>';
    }).join('<span class="writesep"> · </span>');
  }

  /* ── search ────────────────────────────────────────────── */
  function tokenize(q) {
    return String(q || '').toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });
  }

  function highlight(text, tokens) {
    var out = esc(text);
    tokens.forEach(function (t) {
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '$1');
    });
    return out.replace(//g, '<mark>').replace(//g, '</mark>');
  }

  /* ── fuzzy matching ──────────────────────────────────────────────
     Typing on a phone keyboard produces typos, and a mistyped title
     used to return nothing at all: a token that did not match the
     title was only looked for in the lyric lines. Now a token within a
     couple of edits of the title — or of any word in it — still finds
     the song, so "helnena", "helna" and "helana" all land on Helena. */
  function editDistance(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = [], prev = [], cur = [];
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur = [i];
      var rowMin = i;
      for (var k = 1; k <= lb; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        var v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        /* a swapped pair ("helnena") counts as one slip, not two */
        if (i > 1 && k > 1 &&
            a.charCodeAt(i - 1) === b.charCodeAt(k - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(k - 1)) {
          v = Math.min(v, prev2[k - 2] + 1);
        }
        cur[k] = v;
        if (v < rowMin) rowMin = v;
      }
      prev2 = prev; prev = cur;
      if (rowMin > max) return max + 1;
    }
    return prev[lb];
  }

  /* how many slips we forgive, by how much has been typed

     A Hangul syllable says more than a letter does — 봄날 is three
     syllables of meaning — so a Korean word can take a slip sooner than
     an English one of the same length. */
  function fuzzyLimit(len, token) {
    if (token && /[\u3131-\uD79D]/.test(token)) {
      /* one slip is a mistyped key; two is a different word, and that
         belongs in the suggestion, not in the results */
      return Math.min(3, Math.max(1, Math.floor((len - 1) / 3)));
    }
    if (len <= 2) return 0;      /* too short to guess at */
    if (len <= 5) return 1;
    if (len <= 8) return 2;
    return 3;
  }

  /* how far the token is from the text (or from any word in it) */
  function fuzzyDistance(token, text) {
    var lim = fuzzyLimit(token.length, token);
    if (!lim || !text) return 99;
    var best = editDistance(token, text, lim);
    var words = text.split(/[^a-z0-9'가-힣]+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i].length < 3) continue;
      var d = editDistance(token, words[i], lim);
      if (d < best) best = d;
    }
    return best;
  }

  /* a near miss still scores — but the closer it is, the higher it sits */
  function fuzzyScore(token, text) {
    var d = fuzzyDistance(token, text);
    if (d > fuzzyLimit(token.length, token)) return 0;
    return d === 1 ? 380 : (d === 2 ? 280 : 190);
  }

  /* the closest song to what was typed, for "did you mean?"

     The English title is only one of the ways a BTS song can be typed:
     the Hangul title and the romanisation are just as likely, and a
     typo can sit inside a lyric line rather than in the title at all.

     The answer is scored on the SAME scale the search uses, so the two
     can be compared: a title match is worth a lot, a match inside a
     lyric line much less, and a long title that merely contains a
     close word is worth less again. */
  function suggestSong(query) {
    var tokens = tokenize(query);
    if (!tokens.length) return null;
    var best = null, bestD = 1e9, bestField = '', bestWorst = 99;
    var tokenLen = tokens[0].length;
    S.songs.forEach(function (song) {
      var fields = [
        { text: song.title, label: 'title', penalty: 0, tier: 'title' },
        { text: song.ko, label: 'korean title', penalty: 0, tier: 'title' },
        { text: song.roman, label: 'romanization', penalty: 0, tier: 'title' },
        { text: (song.lines || []).join(' '), label: 'lyrics', penalty: 3, tier: 'line' },
        { text: (song.romanLines || []).join(' '), label: 'romanized lyrics', penalty: 3, tier: 'line' }
      ];
      fields.forEach(function (f) {
        var text = String(f.text || '').toLowerCase();
        if (!text) return;
        var words = text.split(/[^a-z0-9'\u3131-\uD79D]+/);
        var worst = 0;
        tokens.forEach(function (t) {
          /* a Hangul query never matches a Latin title and the other
             way round — that is a different song, not a typo */
          if (scriptOf(t) !== scriptOf(text) && scriptOf(text) !== 'mixed') {
            worst = 99;
            return;
          }
          var lim = Math.min(4, fuzzyLimit(t.length, t) + 1);
          /* look a little further than we would accept, so the suggestion
             can still point at a title that is one slip too many */
          var d = editDistance(t, text, lim + 2);
          for (var i = 0; i < words.length; i++) {
            if (words[i].length < 3) continue;
            var dw = editDistance(t, words[i], lim + 2);
            if (dw < d) d = dw;
          }
          if (d > worst) worst = d;
        });
        if (worst > 8) return;
        /* a long title that merely CONTAINS a close word is a weaker
           answer than a short title that is close all the way through */
        var score = worst + f.penalty + Math.max(0, (text.length - tokenLen) * 0.12);
        if (score < bestD) { bestD = score; best = song; bestField = f.label; bestWorst = worst; }
      });
    });
    if (!best) return null;
    /* the same tiers the search uses, so a suggestion can be compared
       with what the search already found */
    var tier = (bestField === 'lyrics' || bestField === 'romanized lyrics')
      ? (bestWorst <= 1 ? 88 : 86)
      : (bestWorst === 1 ? 380 : bestWorst === 2 ? 280 : bestWorst === 3 ? 190 : 0);
    if (!tier) return null;
    return { song: best, field: bestField, tier: tier, distance: bestWorst };
  }

  /* which alphabet a string is written in */
  function scriptOf(text) {
    var t = String(text || '');
    var ko = /[\u3131-\uD79D]/.test(t);
    var la = /[a-z]/i.test(t);
    if (ko && la) return 'mixed';
    if (ko) return 'hangul';
    if (la) return 'latin';
    return 'other';
  }


  /* "Did you mean …?" — the suggestion names what was typed and what was
     found, so a Korean or romanised query still points somewhere. */
  function didYouMean(guess) {
    var song = guess.song;
    var extra = '';
    if (guess.field === 'korean title' && song.title) extra = ' (' + esc(song.title) + ')';
    else if (guess.field === 'title' && song.ko) extra = ' (' + esc(song.ko) + ')';
    return '<p class="mono" style="margin-top:10px">Did you mean ' +
      '<a href="#/song/' + song.id + '"><strong>' + esc(song.title) + '</strong></a>' + extra +
      '?</p>';
  }

  function searchSongs(query) {
    var tokens = tokenize(query);
    if (!tokens.length) return [];
    var hits = [];
    visibleSongs().forEach(function (song) {
      var title = song.title.toLowerCase();
      var ko = (song.ko || '').toLowerCase();
      var roman = (song.roman || '').toLowerCase();
      var rel = song.release.toLowerCase();
      var yr = String(song.year);
      var wr = (song.writers || '').toLowerCase();
      var score = 0, all = true, snippets = [], fuzzy = false;

      tokens.forEach(function (t) {
        var s = 0;
        if (title === t) s = 1200;
        else if (ko && ko === t) s = 1150;
        else if (title.indexOf(t) === 0) s = 800;
        else if (title.indexOf(t) > -1) s = 520;
        else if (ko && ko.indexOf(t) === 0) s = 700;
        else if (ko && ko.indexOf(t) > -1) s = 520;
        else if (roman && roman.indexOf(t) > -1) s = 460;
        else if (fuzzyScore(t, title)) { s = fuzzyScore(t, title); fuzzy = true; }
        else if (ko && fuzzyScore(t, ko)) { s = Math.min(fuzzyScore(t, ko), 300); fuzzy = true; }
        else if (rel.indexOf(t) > -1) s = 240;
        else if (yr.indexOf(t) > -1) s = 200;
        else if (wr.indexOf(t) > -1) s = 170;
        else if (fuzzyScore(t, rel)) s = Math.min(fuzzyScore(t, rel), 190);
        else if (fuzzyScore(t, wr)) s = Math.min(fuzzyScore(t, wr), 150);
        else {
          var found = false;
          for (var i = 0; i < song.lines.length; i++) {
            if (song.lines[i].toLowerCase().indexOf(t) > -1) {
              found = true;
              if (snippets.length < 3) snippets.push(song.lines[i]);
              break;
            }
          }
          if (!found && song.romanLines) {
            for (var j = 0; j < song.romanLines.length; j++) {
              if (song.romanLines[j] && song.romanLines[j].toLowerCase().indexOf(t) > -1) {
                found = true;
                if (snippets.length < 3) snippets.push(song.romanLines[j]);
                break;
              }
            }
          }
          /* a slip inside a line is still the line: "bombnal" for
             "bomnal". Only worth trying when there is room to be wrong. */
          if (!found && fuzzyLimit(t.length, t) > 0) {
            /* an exact line always beats a near miss inside a line */
            for (var k = 0; k < song.lines.length; k++) {
              if (fuzzyScore(t, song.lines[k].toLowerCase())) {
                found = true;
                fuzzy = true;
                s = 86;
                if (snippets.length < 3) snippets.push(song.lines[k]);
                break;
              }
            }
            if (!found && song.romanLines) {
              for (var m = 0; m < song.romanLines.length; m++) {
                if (song.romanLines[m] && fuzzyScore(t, song.romanLines[m].toLowerCase())) {
                  found = true;
                  fuzzy = true;
                  s = 88;
                  if (snippets.length < 3) snippets.push(song.romanLines[m]);
                  break;
                }
              }
            }
          }
          if (found && !s) s = 90; else if (!found) { all = false; }
        }
        score += s;
      });
      if (all && score > 0) hits.push({ song: song, score: score, snippets: snippets, fuzzy: fuzzy });
    });
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* the same score: prefer the track from an album over a live
         bonus track — "the black parade" means the album */
      var ka = (a.song.kind === 'album') ? 1 : 0;
      var kb = (b.song.kind === 'album') ? 1 : 0;
      if (ka !== kb) return kb - ka;
      return a.song.title.localeCompare(b.song.title);
    });
    return hits;
  }

  /* ── song view ─────────────────────────────────────────── */
  function renderSong(id) {
    var song = S.byId[id];
    if (!song) { location.hash = '#/'; return; }
    var view = $('#view-song');
    var starred = !!S.stars[id];
    var inSet = S.setlist.indexOf(id) > -1;
    var hasTimings = !!(window.BTSSync && window.BTSSync.getTimings(id));
    var customTiming = !!(window.BTSSync && window.BTSSync.hasCustom(id));

    var html =
      '<div class="songhead">' +
        '<a class="songhead__back" href="#/" style="position:relative;z-index:2">‹ Back to library</a>' +
        '<h1 class="songhead__title">' + esc(song.title) + '</h1>' +
        (song.ko ? '<div class="songhead__ko">' + esc(song.ko) +
          (song.roman && song.roman.toLowerCase() !== song.title.toLowerCase() ?
            ' <span class="songhead__koroman">' + esc(song.roman) + '</span>' : '') +
          '</div>' : '') +
        '<div class="songhead__meta">' +
          '<span class="mono">' + esc(song.release) + '</span>' +
          '<span class="tag">' + song.year + '</span>' +
          '<span class="tag tag--blood">' + esc(song.kindLabel) + '</span>' +
          (song.cover ? '<span class="tag tag--gold">Cover · ' + esc(song.coverArtist || 'various') + '</span>' : '') +
          (song.hasLyrics ? '' : '<span class="tag tag--gold">No lyrics available</span>') +
          offlineTag(song) +
        '</div>' +
        (song.writers ?
          '<div class="songhead__credit"><span class="songhead__creditlabel">Written by</span> ' +
          writerLinks(song.writers) + '</div>' : '') +
        '<div class="songhead__actions">' +
          '<button class="btn btn--primary" data-act="concert">▶ Concert mode</button>' +
          '<button class="btn' + (hasTimings ? ' btn--gold' : '') + '" data-act="sync">' +
            (hasTimings ? '◷ Synced ' + (customTiming ? '· custom' : '') : '◷ Tap to sync') + '</button>' +
          '<button class="btn btn--lang" data-act="lang" title="' + esc(langTitle()) + '">' +
            esc(langLabel()) + '</button>' +
          '<button class="btn' + (starred ? ' btn--gold' : '') + '" data-act="star">' + (starred ? '★ Starred' : '☆ Star') + '</button>' +
          '<button class="btn' + (inSet ? ' is-on' : '') + '" data-act="set">' + (inSet ? '✓ In setlist' : '+ Setlist') + '</button>' +
          '<button class="btn" data-act="smaller">A−</button>' +
          '<button class="btn" data-act="bigger">A+</button>' +
        '</div>' +
      '</div>' +
      '<div class="lyric" id="lyricCol" style="--lyric-scale:' + S.settings.scale + '">';

    if (!song.hasLyrics) {
      html += '<p class="lyric__none">Lyrics for this track are not published in the offline pack.</p>';
    } else if (hasTimings) {
      html += '<p class="lyric__note">Synced mode scrolls the word-level timing track, ' +
              'so its line breaks can differ slightly from the lyrics below.</p>';
    }
    if (song.hasLyrics) {
      var mode = langMode();
      song.lines.forEach(function (ln, i) {
        if (!ln.trim()) { html += '<p class="is-blank" data-i="' + i + '">&nbsp;</p>'; return; }
        var p = lyricParts(song, i, mode);
        html += '<p data-i="' + i + '">' + formatFanchants(p.main) + partsHtml(song, i, mode) + '</p>';
      });
    }
    html += '</div>';

    view.innerHTML = html;
    view.hidden = false;
    $$('#view-library, #view-songs, #view-setlist, #view-about').forEach(function (v) { v.hidden = true; });

    var starBtn = $('[data-act="star"]', view);
    starBtn.classList.toggle('btn--gold', starred);

    $('[data-act="concert"]', view).addEventListener('click', function () { openConcert([id], 0); });
    $('[data-act="sync"]', view).addEventListener('click', function () {
      openEditor(id);
    });
    $('[data-act="lang"]', view).addEventListener('click', function () {
      var next = LANGS[(langIndex() + 1) % LANGS.length];
      S.settings.lang = next.id;
      LS.set('bts.settings', S.settings);
      renderSong(id);
      toast(next.title);
    });
    starBtn.addEventListener('click', function () {
      if (S.stars[id]) delete S.stars[id]; else S.stars[id] = Date.now();
      LS.set('bts.stars', S.stars);
      renderSong(id);
      toast(S.stars[id] ? 'Starred' : 'Unstarred');
    });
    $('[data-act="set"]', view).addEventListener('click', function () {
      var i = S.setlist.indexOf(id);
      if (i > -1) { S.setlist.splice(i, 1); toast('Removed from setlist'); }
      else { S.setlist.push(id); toast('Added to setlist'); }
      LS.set('bts.setlist', S.setlist);
      renderSong(id);
      updateSetCount();
    });
    $('[data-act="smaller"]', view).addEventListener('click', function () { changeScale(-0.1); });
    $('[data-act="bigger"]', view).addEventListener('click', function () { changeScale(0.1); });

    view.scrollIntoView({ block: 'start' });
    toTop();
  }

  function changeScale(delta) {
    S.settings.scale = Math.min(2.2, Math.max(0.75, +(S.settings.scale + delta).toFixed(2)));
    LS.set('bts.settings', S.settings);
    document.documentElement.style.setProperty('--lyric-scale', S.settings.scale);
    var col = $('#lyricCol');
    if (col) col.style.setProperty('--lyric-scale', S.settings.scale);
    var sc = $('#concertScroll');
    if (sc) sc.style.setProperty('--lyric-scale', S.settings.scale);
    toast('Text size ' + Math.round(S.settings.scale * 100) + '%');
  }

  /* ── library ───────────────────────────────────────────── */
  /* The library section is a fixed piece of markup: the hero, the
     search bar, the quick chips, the release grid and the song list.
     The release page used to be painted straight over it, which
     destroyed all of that — "Back to library" then showed a dead
     page and threw on the missing search field. The release page
     now has a view of its own, and the library markup is
     snapshotted so it can always be put back together. */
  function captureLibraryMarkup() {
    if (S.libraryMarkup !== null) return;
    var view = $('#view-library');
    S.libraryMarkup = view ? view.innerHTML : '';
  }

  function libraryIntact() {
    var view = $('#view-library');
    if (!view) return false;
    return !!$('#searchInput', view) && !!$('#quickChips', view) &&
           !!$('#releaseGrid', view) && !!$('#songList', view);
  }

  function restoreLibrary() {
    var view = $('#view-library');
    if (!view) return false;
    if (libraryIntact()) return false;
    captureLibraryMarkup();
    view.innerHTML = S.libraryMarkup;
    bindLibraryUI();
    if (S.data) {
      $('#heroStats').textContent = S.data.songs.length + ' songs · ' + S.data.releases.length + ' releases';
    }
    S.libraryBuilt = false;
    return true;
  }

  /* The album art is drawn in code (build/make_covers.py) and shipped as
     one tiny SVG per release. The slug must match the file name exactly. */
  function coverSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function coverFor(rel) {
    return 'covers/' + coverSlug(rel.name) + '.svg';
  }

  function renderLibrary() {
    $('#releasesBlock').hidden = false;
    var grid = $('#releaseGrid');
    grid.innerHTML = '';
    S.releases.forEach(function (rel, i) {
      var card = el(
        '<a class="rcard" href="#/release/' + i + '" style="animation-delay:' + (i * 28) + 'ms">' +
          '<span class="rcard__artwrap"><img class="rcard__art" src="' + coverFor(rel) +
            '" alt="" width="600" height="600" loading="lazy" decoding="async"></span>' +
          '<span class="rcard__year">' + rel.year + '</span>' +
          '<span class="rcard__name">' + esc(rel.name) + '</span>' +
          '<span class="rcard__foot"><span>' + rel.count + (rel.count === 1 ? ' song' : ' songs') + '</span>' +
          '<span>Open ›</span></span>' +
        '</a>'
      );
      grid.appendChild(card);
    });
    $('#relCount').textContent = S.releases.length + ' releases';
    renderSongList($('#songList'));
  }

  function renderSongList(container) {
    if (!container) return;
    container.innerHTML = '';
    var list = visibleSongs();
    if (S.offlineFilter && !list.length) {
      container.innerHTML = '<div class="empty"><strong>Nothing is cached yet</strong>' +
        'Connect once so the app can save the lyric book to this device — then every song ' +
        'here opens with no signal at all.</div>';
      $('#songCount').textContent = '0 of ' + S.songs.length + ' songs';
      return;
    }
    var showTicks = lyricsOffline();
    list.forEach(function (song, i) {
      var starred = !!S.stars[song.id];
      var row = el(
        '<div class="songrow' + (starred ? ' is-starred' : '') + '" style="animation-delay:' + Math.min(i * 9, 420) + 'ms">' +
          '<span class="songrow__n">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<a class="songrow__main" href="#/song/' + song.id + '">' +
            '<span class="songrow__title">' + esc(song.title) + '</span>' +
            '<span class="songrow__meta">' + esc(song.release) + ' · ' + song.year + ' · ' + esc(song.kindLabel) + '</span>' +
          '</a>' +
          (showTicks ? offlineTick(song) : '') +
          '<button class="songrow__star' + (starred ? ' is-on' : '') + '" data-star="' + song.id + '" aria-label="Star ' + esc(song.title) + '">' + (starred ? '★' : '☆') + '</button>' +
        '</div>'
      );
      container.appendChild(row);
    });
    var filtered = S.offlineFilter;
    $('#songCount').textContent = list.length + (filtered ? ' of ' + S.songs.length : '') + ' songs';
  }

  function renderAlpha() {
    var rail = $('#alphaRail');
    var box = $('#songListAlpha');
    var groups = {};
    S.songs.forEach(function (song) {
      var c = song.title.trim().charAt(0).toUpperCase();
      if (!/[A-Z]/.test(c)) c = '#';
      (groups[c] = groups[c] || []).push(song);
    });
    var letters = Object.keys(groups).sort();
    letters.forEach(function (c) { groups[c].sort(function (a, b) { return a.title.localeCompare(b.title); }); });
    rail.innerHTML = letters.map(function (c) {
      return '<button data-letter="' + c + '">' + c + '</button>';
    }).join('');
    box.innerHTML = letters.map(function (c) {
      return '<div class="lettergroup" id="letter-' + encodeURIComponent(c) + '">' +
        '<div class="lettergroup__head">' + c + '</div>' +
        groups[c].map(function (song, i) {
          var starred = !!S.stars[song.id];
          return '<div class="songrow' + (starred ? ' is-starred' : '') + '">' +
            '<span class="songrow__n">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<a class="songrow__main" href="#/song/' + song.id + '">' +
              '<span class="songrow__title">' + esc(song.title) + '</span>' +
              '<span class="songrow__meta">' + esc(song.release) + ' · ' + song.year + '</span>' +
            '</a>' +
            offlineTick(song) +
            '<button class="songrow__star' + (starred ? ' is-on' : '') + '" data-star="' + song.id + '" aria-label="Star">' + (starred ? '★' : '☆') + '</button>' +
          '</div>';
        }).join('') + '</div>';
    }).join('');
    $('#songListAlpha').dataset.count = S.songs.length;
  }

  /* ── release view ─────────────────────────────────────────
     A release gets a view of its own so the library markup is
     never overwritten: going back to "#/" always brings the
     search bar, the chips, the release grid and the song list
     back, without a reload. */
  function releaseView() {
    var view = $('#view-release');
    if (view) return view;
    view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-release';
    view.hidden = true;
    var lib = $('#view-library');
    if (lib && lib.parentNode) lib.parentNode.insertBefore(view, lib.nextSibling);
    else document.body.appendChild(view);
    return view;
  }

  function hideReleaseView() {
    var view = $('#view-release');
    if (view) view.hidden = true;
  }

  function renderRelease(index) {
    var rel = S.releases[index];
    if (!rel) { location.hash = '#/'; return; }
    var view = releaseView();
    var songs = rel.ids.map(function (id) { return S.byId[id]; });
    view.innerHTML =
      '<div class="pagehead">' +
        '<a class="songhead__back" href="#/" style="position:relative;z-index:2">‹ Back to library</a>' +
        '<div class="relhero"><img class="relhero__art" src="' + coverFor(rel) +
          '" alt="Album art for ' + esc(rel.name) + '" width="600" height="600"></div>' +
        '<h1 class="pagehead__title">' + esc(rel.name) + '</h1>' +
        '<p class="pagehead__sub">' + rel.year + ' · ' + rel.count + ' songs</p>' +
      '</div>' +
      '<div class="songlist">' + songs.map(function (song, i) {
        var starred = !!S.stars[song.id];
        return '<div class="songrow' + (starred ? ' is-starred' : '') + '">' +
          '<span class="songrow__n">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<a class="songrow__main" href="#/song/' + song.id + '">' +
            '<span class="songrow__title">' + esc(song.title) + '</span>' +
            '<span class="songrow__meta">' + esc(song.kindLabel) + (song.cover ? ' · cover of ' + esc(song.coverArtist) : '') + '</span>' +
          '</a>' +
          '<button class="songrow__star' + (starred ? ' is-on' : '') + '" data-star="' + song.id + '" aria-label="Star">' + (starred ? '★' : '☆') + '</button>' +
        '</div>';
      }).join('') + '</div>';
    view.hidden = false;
    $('#view-library').hidden = true;
    $('#view-songs').hidden = true;
    $('#view-setlist').hidden = true;
    $('#view-about').hidden = true;
    $('#view-song').hidden = true;
    toTop();
  }

  /* ── setlist ───────────────────────────────────────────── */
  function renderSetlist() {
    var box = $('#setlistBox');
    if (!S.setlist.length) {
      box.innerHTML =
        '<div class="empty"><strong>No songs queued</strong>' +
        'Open any song and tap <em>+ Setlist</em> to build a running order. ' +
        'It is saved on this device and works with no signal.</div>';
      return;
    }
    var total = S.setlist.reduce(function (n, id) {
      var s = S.byId[id];
      return n + (s && s.lines.length ? s.lines.length : 0);
    }, 0);
    box.innerHTML =
      '<div class="songhead__actions" style="padding:0 0 18px">' +
        '<button class="btn btn--primary" data-act="play">▶ Play setlist</button>' +
        '<button class="btn" data-act="clear">Clear all</button>' +
        '<span class="mono" style="margin-left:auto;align-self:center">' +
          S.setlist.length + (S.setlist.length === 1 ? ' song' : ' songs') +
          ' · ~' + total + (total === 1 ? ' line' : ' lines') + '</span>' +
      '</div>' +
      S.setlist.map(function (id, i) {
        var song = S.byId[id];
        if (!song) return '';
        return '<div class="setrow" data-id="' + id + '">' +
          '<span class="setrow__n">' + (i + 1) + '</span>' +
          '<a href="#/song/' + id + '"><span class="setrow__title">' + esc(song.title) + '</span>' +
          '<span class="setrow__meta">' + esc(song.release) + ' · ' + song.year + '</span></a>' +
          '<span class="setrow__ops">' +
            '<button class="iconbtn" data-op="up" aria-label="Move up">↑</button>' +
            '<button class="iconbtn" data-op="down" aria-label="Move down">↓</button>' +
            '<button class="iconbtn" data-op="del" aria-label="Remove">×</button>' +
          '</span>' +
        '</div>';
      }).join('');
  }

  function updateSetCount() {
    var c = $('#setCount');
    if (S.setlist.length) { c.textContent = S.setlist.length; c.hidden = false; }
    else c.hidden = true;
  }

  /* ── offline state, kept in step with the badge ────────────── */
  function offlineTag(song) {
    if (songOffline(song)) {
      return '<span class="tag tag--gold" data-offline-tag="1">✓ On device</span>';
    }
    return '<span class="tag" data-offline-tag="1">Not saved yet</span>';
  }

  function updateOfflineUi() {
    var chip = $('#offlineChipCount');
    if (chip) chip.textContent = String(offlineSongCount());
    var tag = document.querySelector('[data-offline-tag]');
    if (tag && S.currentId && S.byId[S.currentId]) {
      var song = S.byId[S.currentId];
      var want = songOffline(song);
      if (want) {
        tag.className = 'tag tag--gold';
        tag.textContent = '✓ On device';
      } else {
        tag.className = 'tag';
        tag.textContent = 'Not saved yet';
      }
    }
  }

  /* The worker tells the page when the pack changed; the library and
     the song page follow it. */
  function onPackChange() {
    updateOfflineUi();
    if (S.libraryBuilt) renderSongList($('#songList'));
  }

  /* ── search UI ─────────────────────────────────────────── */
  function runSearch(q) {
    S.query = q;
    var box = $('#searchResults');
    $('#searchClear').hidden = !q;
    if (!q.trim()) {
      box.hidden = true;
      box.innerHTML = '';
      $('#releasesBlock').hidden = false;
      return;
    }
    $('#releasesBlock').hidden = true;
    var hits = searchSongs(q);
    var tokens = tokenize(q);
    var html = '<div class="srhead"><h2>' + hits.length + (hits.length === 1 ? ' result' : ' results') +
      '</h2><span class="mono">for “' + esc(q) + '”</span></div>';
    if (!hits.length) {
      html += '<div class="empty" style="margin-top:14px">Nothing matched. Try a word from the chorus.</div>';
      var guess = suggestSong(q);
      if (guess) html += didYouMean(guess);
    } else if (hits[0].fuzzy) {
      /* the top hit was a near miss — say so, or the typo goes unnoticed.
         The suggestion looks further and prefers titles over lyric lines,
         so it is the better answer when there is one. */
      var near = suggestSong(q);
      /* the suggestion and the top hit are scored on the same scale,
         so the better answer simply wins */
      var best = (near && near.tier > hits[0].score) ? near.song : hits[0].song;
      html += '<p class="mono" style="margin-top:10px">Closest match: <a href="#/song/' +
        best.id + '"><strong>' + esc(best.title) + '</strong></a>' +
        (best.ko ? ' <span class="dim">(' + esc(best.ko) + ')</span>' : '') + '</p>';
    }
    hits.forEach(function (h) {
      var s = h.song;
      html += '<div class="sresult">' +
        '<a class="sresult__head" href="#/song/' + s.id + '">' +
          '<span class="sresult__title">' + highlight(s.title, tokens) + '</span>' +
          '<span class="sresult__meta">' + highlight(s.release, tokens) + ' · ' + highlight(String(s.year), tokens) + '</span>' +
        '</a>';
      if (h.snippets.length) {
        html += '<ul class="sresult__snips">' + h.snippets.map(function (sn) {
          return '<li class="sresult__snip">' + highlight(sn, tokens) + '</li>';
        }).join('') + '</ul>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
    box.hidden = false;
  }

  /* ── library search UI ────────────────────────────────────
     The search field, the clear button and the quick chips live
     inside the library section. They are wired up here so the
     library can be rebuilt (and the field re-bound) whenever the
     markup has to be restored. */
  function bindLibraryUI() {
    var input = $('#searchInput');
    if (!input) return;
    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var v = input.value;
      t = setTimeout(function () {
        runSearch(v);
        if (v && location.hash.indexOf('#/') !== 0) history.replaceState(null, '', '#/');
        if (v) { $('#view-library').hidden = false; $('#view-songs').hidden = true; $('#view-setlist').hidden = true; $('#view-about').hidden = true; $('#view-song').hidden = true; }
      }, 110);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; runSearch(''); input.blur(); }
    });
    var clear = $('#searchClear');
    if (clear) clear.addEventListener('click', function () { input.value = ''; runSearch(''); input.focus(); });
    var chips = $('#quickChips');
    if (chips) chips.addEventListener('click', function (e) {
      var of = e.target.closest('[data-offlinefilter]');
      if (of) {
        S.offlineFilter = !S.offlineFilter;
        of.classList.toggle('is-on', S.offlineFilter);
        renderSongList($('#songList'));
        if (S.query) runSearch(S.query);
        var n = offlineSongCount();
        toast(S.offlineFilter
          ? (n ? n + ' songs saved on this device' : 'Nothing is saved on this device yet')
          : 'Showing all songs');
        return;
      }
      var b = e.target.closest('.chip');
      if (!b) return;
      input.value = b.getAttribute('data-q');
      runSearch(input.value);
      // on a phone a chip shows results — it should not pop the keyboard
      // up over them (or scroll the page under the top bar)
      if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) input.focus();
    });
  }

  /* The search field only exists inside the library, so the header
     button has to bring the library up before it can focus it. */
  function focusSearch() {
    var input = $('#searchInput');
    if (!input) return false;
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    if (document.activeElement !== input) input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  function goLibrary(focus) {
    var hash = location.hash.replace(/^#/, '');
    var lib = $('#view-library');
    var onLibrary = (hash === '' || hash === '/') && lib && !lib.hidden;
    if (onLibrary) {
      if (focus) focusSearch();
      return;
    }
    S.pendingSearchFocus = !!focus;
    if (hash === '' || hash === '/') route();
    else location.hash = '#/';
  }

  /* ── A–Z index ─────────────────────────────────────────────
     The letter rail is sticky, so a jump has to land the group
     underneath it (and underneath the top bar) instead of behind. */
  function alphaRailOffset() {
    var bar = document.querySelector('.topbar');
    var top = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
    var rail = $('#alphaRail');
    var railH = rail ? Math.round(rail.getBoundingClientRect().height) : 0;
    return top + railH + 10;
  }

  function jumpToLetter(letter) {
    var group = document.getElementById('letter-' + encodeURIComponent(letter));
    if (!group) return false;
    var offset = alphaRailOffset();
    group.style.scrollMarginTop = offset + 'px';
    // an instant jump: the index is a shortcut, not a slow animation
    group.scrollIntoView({ block: 'start' });
    return true;
  }

  /* ── synced lyrics ──────────────────────────────────────────
     The engine can drive the cursor from official LRC timings,
     from the microphone, or from timings the user taps in. */
  var C = {
    open: false, queue: [], qi: 0, idx: 0, lines: [], visible: [],
    playing: false, timer: null, wake: null, speedIdx: 1,
    engine: null, synced: false, micOn: false,
    songId: null, micStream: null, finished: false, micToken: 0
  };
  var SPEEDS = [4500, 3500, 2200];

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function engineReady() { return !!(window.BTSSync && window.BTSSync.SyncEngine); }

  /* ── microphone lifecycle ─────────────────────────────────────
     The microphone must never outlive the thing that asked for it.
     Every path that ends mic use goes through releaseMic(): the
     tracks are stopped, dropped from the stream and the audio
     context is closed — otherwise the phone keeps listening after
     the user believes it stopped. */
  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    var tracks = stream.getTracks();
    for (var i = 0; i < tracks.length; i++) {
      try { tracks[i].stop(); } catch (e) {}
      // dropping the track empties the stream, so nothing is left live
      try { if (typeof stream.removeTrack === 'function') stream.removeTrack(tracks[i]); } catch (e) {}
    }
  }

  function releaseMic() {
    var engine = C.engine;
    var mic = engine ? engine.mic : null;
    var stream = (mic && mic.stream) || C.micStream || null;
    /* every release invalidates a capture that is still on its way */
    C.micToken++;
    if (engine && typeof engine.stopMic === 'function') {
      try { engine.stopMic(); } catch (e) {}
    }
    stopStream(stream);
    if (mic && mic.ctx) { try { mic.ctx.close(); } catch (e) {} }
    C.micOn = false;
    var btn = $('#concertMic');
    if (btn) btn.classList.remove('is-on');
    var chip = $('#syncMode');
    if (chip) {
      chip.textContent = C.synced ? 'synced' : 'manual';
      chip.className = 'concert__mode' + (C.synced ? ' is-sync' : '');
    }
  }

  function openConcert(queue, qi) {
    releaseMic();
    C.queue = queue && queue.length ? queue.slice() : [S.currentId];
    C.qi = qi || 0;
    C.open = true;
    C.speedIdx = 1;
    document.body.classList.add('is-locked');
    $('#concert').hidden = false;
    loadConcertSong();
    requestWake();
    requestFullscreen();
    stopAuto();
    setConcertHint();
  }

  function setConcertHint() {
    var h = $('#concertHint');
    if (!h) return;
    if (!C.visible.length) { h.textContent = 'instrumental — no lyrics to show'; return; }
    if (C.synced) { h.textContent = C.micOn ? 'synced · listening' : 'synced · timeline'; return; }
    h.textContent = C.playing ? ('auto · ' + (SPEEDS[C.speedIdx] / 1000) + 's/line ›')
                              : 'tap right to advance';
    // on a phone the hint is only shown while auto scroll runs, as the
    // speed control (tap it to step slow → medium → fast)
    $('#concert').classList.toggle('is-auto', !!C.playing && !C.synced);
  }

  /* ── sync mode ─────────────────────────────────────────────── */
  function toggleSync() {
    if (!engineReady()) { toast('Sync engine unavailable'); return; }
    if (C.synced) {
      C.synced = false;
      releaseMic();                       // the mic must not outlive the engine
      if (C.engine) { C.engine.destroy(); C.engine = null; }
      $('#concertSeek').hidden = true;
      $('#concertSync').classList.remove('is-on');
      $('#syncMode').textContent = 'manual';
      $('#syncMode').className = 'concert__mode';
      loadConcertSong();
      toast('Synced mode off');
      return;
    }
    var id = C.queue[C.qi];
    var t = window.BTSSync.getTimings(id);
    if (!t) { toast('No timing for this song — use Tap Sync'); return; }
    C.engine = new window.BTSSync.SyncEngine({
      onTick: onSyncTick,
      onStatus: onSyncStatus
    });
    C.synced = true;
    $('#concertSync').classList.add('is-on');
    // rebuild the view from the timing grid so the cursor and the
    // rendered lines always share one index space
    loadConcertSong();
    toast('Synced — tap the clock again to go manual');
  }

  function onSyncTick(pos, engine) {
    // the song ran out: the setlist moves on to the next one
    if (C.synced && engine.playing && engine.duration && !C.finished) {
      var elapsed = Date.now() - (engine.startedAt || 0);
      if (elapsed >= engine.duration) { songFinished(); return; }
    }
    var idx = engine.currentLine(pos);
    if (idx < 0) idx = 0;
    // the engine counts every timed line; the view only shows the
    // ones with text, so map across
    var vis = 0;
    for (var v = 0; v < C.visible.length; v++) {
      if (C.visible[v] <= idx) vis = v; else break;
    }
    C.idx = vis;
    paintConcert();
    stickPulse(pos, engine);
    if (STICK.open) updateStickBar();
    $('#seekRange').value = String(engine.duration ? Math.round(pos / engine.duration * 1000) : 0);
    $('#seekLabel').textContent = fmtTime(pos);
  }

  function onSyncStatus(state, extra, beat) {
    var chip = $('#syncMode');
    if (!chip) return;
    if (state === 'level') return;             // raw mic level, informational only
    var bpm = beat && beat.bpm ? (' · \u2669' + Math.round(beat.bpm)) : '';
    if (state === 'finished') {
      // the engine reached the end of the track: hand over to the next
      // song of the setlist instead of looping the same one
      chip.textContent = 'finished';
      chip.className = 'concert__mode is-sync';
      songFinished();
      return;
    }
    if (state === 'mic-error') {
      // the microphone never opened (permission denied, no device)
      chip.textContent = 'mic blocked';
      chip.className = 'concert__mode';
      C.micOn = false;
      var mb = $('#concertMic');
      if (mb) mb.classList.remove('is-on');
      return;
    }
    if (state === 'mic-lost') {
      // the lock went stale: the mic stopped hearing the song
      chip.textContent = 'mic lost';
      chip.className = 'concert__mode is-sync';
      return;
    }
    if (state === 'locked') {
      chip.textContent = 'locked' + bpm;
      chip.className = 'concert__mode is-locked';
    } else if (state === 'searching') {
      chip.textContent = 'searching…' + bpm;
      chip.className = 'concert__mode is-sync';
    } else if (state === 'listening') {
      chip.textContent = 'listening…' + bpm;
      chip.className = 'concert__mode is-sync';
    }
  }

  /* Which way the microphone listens: the syllables of the song, or
     the beat of the room. The beat is steadier in a loud venue, so it
     is worth having both. */
  function micMode() {
    return C.beatMode ? 'beat' : 'word';
  }

  function toggleBeatMode() {
    C.beatMode = !C.beatMode;
    var btn = $('#concertBeat');
    if (btn) {
      btn.classList.toggle('is-on', C.beatMode);
      btn.setAttribute('title', C.beatMode ? 'Listening for the beat' : 'Listening for the words');
    }
    var chip = $('#syncMode');
    if (chip && !C.micOn) chip.textContent = C.beatMode ? 'beat mode' : 'word mode';
    /* the capture has to be reopened with the other envelope */
    if (C.micOn && C.engine) {
      releaseMic();
      C.micOn = false;
      var mb = $('#concertMic');
      if (mb) mb.classList.remove('is-on');
      setTimeout(function () { toggleMic(); }, 60);
    }
    toast(C.beatMode ? 'Beat sync — the cursor follows the beat' : 'Word sync — the cursor follows the lyrics');
  }

  /* Which way the microphone listens: the syllables of the song, or
     the beat of the room. The beat is steadier in a loud venue, so it
     is worth having both. */
  function micMode() {
    return C.beatMode ? 'beat' : 'word';
  }

  function toggleMic() {
    if (!engineReady() || !C.engine) { toast('Turn on synced mode first'); return; }
    var btn = $('#concertMic');
    if (C.micOn) {
      releaseMic();
      toast('Microphone off');
      return;
    }
    btn.classList.add('is-on');
    C.micOn = true;
    /* The browser may take a moment to open the microphone. If the user
       closes concert mode in the meantime, this token is stale and the
       capture that arrives late is handed straight back. */
    var token = ++C.micToken;
    C.engine.startMic(micMode()).then(function () {
      if (token !== C.micToken) {
        /* A later tap owns the microphone now. This capture already let
           itself go in sync.js — releasing here would switch off the
           microphone the user just turned on. */
        return;
      }
      var m = C.engine && C.engine.mic;
      if (m && m.stream) C.micStream = m.stream;
      toast('Listening — leave the phone near the speaker');
    }).catch(function (err) {
      /* Only the attempt that is still current may release the
         microphone — a stale failure must not switch off a newer one. */
      if (token !== C.micToken) return;
      releaseMic();                    // the mic failed to start: let go of it
      if (/cancelled/i.test(String((err && err.message) || err))) return;
      toast('Microphone permission denied');
    });
  }

  /* ── tap-to-sync editor ────────────────────────────────────── */
  var EDIT = null;

  function openEditor(songId) {
    var song = S.byId[songId];
    if (!song) return;
    var lines = song.lines.filter(function (l) { return l.trim(); });
    EDIT = new window.BTSSync.TapSync(songId, lines);
    $('#editorSong').textContent = song.title;
    $('#editorSub').textContent = song.release + ' · ' + song.year +
      (window.BTSSync.hasCustom(songId) ? ' · custom timing saved' : '');
    $('#editorNow').innerHTML = '<span class="dim">Press START when the song begins</span>';
    $('#editorHelp').innerHTML = 'Press <strong>Start</strong> the instant the song begins, then tap once every time a ' +
      'new line starts. The app remembers the timing on this device.';
    $('#editorTap').textContent = 'START';
    $('#editorTap').classList.remove('is-live');
    $('#editorSave').disabled = true;
    $('#editorCount').textContent = '0 / ' + lines.length + ' lines';
    $('#editorReset').hidden = !window.BTSSync.hasCustom(songId);
    $('#syncEditor').hidden = false;
  }

  function closeEditor() {
    EDIT = null;
    $('#syncEditor').hidden = true;
  }

  function editorTap() {
    if (!EDIT) return;
    if (!EDIT.running) {
      EDIT.begin();
      $('#editorTap').textContent = 'TAP';
      $('#editorTap').classList.add('is-live');
      $('#editorHelp').innerHTML = 'Tap once every time a <strong>new line starts</strong>. You can stop early and save what you have.';
      updateEditorNow();
      return;
    }
    var r = EDIT.tap();
    if (!r) return;
    updateEditorNow();
    $('#editorCount').textContent = EDIT.idx + ' / ' + EDIT.lines.length + ' lines';
    if (EDIT.idx > 0) $('#editorSave').disabled = false;
    if (EDIT.idx >= EDIT.lines.length) {
      $('#editorTap').textContent = 'DONE';
      $('#editorHelp').innerHTML = 'All lines stamped. <strong>Save timing</strong> to keep it on this device.';
    }
  }

  function updateEditorNow() {
    if (!EDIT) return;
    var lines = EDIT.lines;
    var done = EDIT.idx;
    var next = lines[done];
    var html = '';
    if (done > 0) {
      html += '<span class="dim">' + esc(lines[done - 1]) + '</span><br>';
    }
    html += next ? esc(next) : '—';
    $('#editorNow').innerHTML = html;
  }

  function editorSave() {
    if (!EDIT) return;
    var data = EDIT.finish();
    if (!data || !data.L.length) { toast('Nothing to save'); return; }
    window.BTSSync.setCustom(EDIT.songId, data);
    /* the song page has to say so straight away — it still read
       "Tap to sync" until the page was reloaded */
    var btn = document.querySelector('#view-song [data-act="sync"]');
    if (btn) {
      btn.classList.add('btn--gold');
      btn.textContent = '◷ Synced · custom';
    }
    var lines = (data.T || []).length;
    var total = (S.byId[EDIT.songId] ? S.byId[EDIT.songId].lines : []).filter(function (l) {
      return l.trim();
    }).length;
    closeEditor();
    toast(lines < total
      ? 'Timing saved — ' + lines + ' of ' + total + ' lines timed'
      : 'Timing saved on this device');
  }


  /* a timing grid holds {t, text}; a song without timings holds plain
     strings — both have to end up as strings in the view */
  function lineText(l) {
    if (l === null || l === undefined) return '';
    if (typeof l === 'object') {
      return (l.text === null || l.text === undefined) ? '' : String(l.text);
    }
    return String(l);
  }

  function loadConcertSong() {
    var id = C.queue[C.qi];
    var song = S.byId[id];
    if (!song) { closeConcert(); return; }
    // a different song means the old mic has nothing to say about it
    if (C.songId !== id) releaseMic();
    C.songId = id;
    C.finished = false;
    var timed = false;
    if (C.engine) {
      // synced mode: the timing grid defines the lines
      timed = C.engine.load(id, song.lines || []);
      C.lines = C.engine.lines.map(lineText);
    } else {
      C.lines = (song.lines || []).map(lineText);
    }
    C.visible = [];
    C.lines.forEach(function (l, i) { if (l && l.trim()) C.visible.push(i); });
    C.idx = 0;
    $('#concertTitle').textContent = song.title;
    $('#concertSub').textContent = song.release + ' · ' + song.year;
    renderConcertLines();
    paintConcert();
    applySyncMode(timed);
  }

  /* synced mode needs a timing grid: a song without one falls back to
     the manual / auto advance instead of freezing on the first line */
  function applySyncMode(timed) {
    if (!C.synced || !C.engine) return;
    if (timed) {
      C.engine.start(0);
      $('#concertSeek').hidden = false;
      $('#seekTotal').textContent = fmtTime(C.engine.duration);
      $('#syncMode').textContent = 'synced';
      $('#syncMode').className = 'concert__mode is-sync';
      return;
    }
    C.engine.pause();
    $('#concertSeek').hidden = true;
    $('#syncMode').textContent = 'manual';
    $('#syncMode').className = 'concert__mode';
  }

  /* Concert lines: the romanization is the big text, the Korean line
     underneath it. The Korean span keeps its own class so the karaoke
     word highlight can rewrite just that one. */
  function renderConcertLines() {
    var sc = $('#concertScroll');
    var song = C.songId ? S.byId[C.songId] : null;
    var mode = langMode();
    var html = C.lines.map(function (ln, i) {
      if (!ln || !ln.trim()) return '<p class="is-blank" data-i="' + i + '">&nbsp;</p>';
      var p = lyricParts(song, i, mode);
      var ko = (mode === 'ko') ? '' : '<span class="cline__ko">' + esc(p.sub) + '</span>';
      var en = p.en ? '<span class="lyric__en">' + esc(p.en) + '</span>' : '';
      return '<p data-i="' + i + '"><span class="cline__main">' + esc(p.main) + '</span>' +
             ko + en + '</p>';
    }).join('');
    sc.innerHTML = html;
    sc.style.setProperty('--lyric-scale', S.settings.scale);
  }

  function paintConcert() {
    var cur = C.visible[C.idx];
    var next = C.visible[C.idx + 1];
    $$('#concertScroll p').forEach(function (p) {
      var i = +p.getAttribute('data-i');
      p.classList.remove('is-cur', 'is-next', 'is-past');
      if (i === cur) p.classList.add('is-cur');
      else if (i === next) p.classList.add('is-next');
      else if (cur !== undefined && i < cur) p.classList.add('is-past');
    });
    // karaoke-style word highlight inside the current line
    if (C.engine && C.engine.words && cur !== undefined) {
      var words = C.engine.wordsIn(cur);
      var el = $('#concertScroll p.is-cur');
      if (el && words && words.length) {
        var pos = C.engine.positionMs;
        var text = C.lines[cur];
        var lower = text.toLowerCase();
        var html = '';
        var last = 0;
        for (var w = 0; w < words.length; w++) {
          var t = words[w][0], txt = words[w][1];
          if (!txt) continue;
          var at = text.indexOf(txt, last);
          if (at === -1) at = lower.indexOf(txt.toLowerCase(), last);
          if (at === -1) continue;
          html += esc(text.slice(last, at));
          html += '<span class="w' + (t <= pos ? ' on' : '') + '">' +
                  esc(text.slice(at, at + txt.length)) + '</span>';
          last = at + txt.length;
        }
        html += esc(text.slice(last));
        /* the word timings are aligned to the Hangul, so the highlight
           belongs on the Korean line — never on the romanization */
        var koEl = el.querySelector('.cline__ko');
        if (koEl) koEl.innerHTML = html;
        else el.innerHTML = html;
      }
    }
    var pct = C.visible.length ? (C.idx / (C.visible.length - 1)) * 100 : 100;
    $('#concertBar').style.width = pct + '%';
    // an instrumental has no lines at all: "0 / 0", never "1 / 0"
    var label = C.visible.length ? (C.idx + 1) + ' / ' + C.visible.length : '0 / 0';
    if (C.queue.length > 1) label += '  ·  song ' + (C.qi + 1) + '/' + C.queue.length;
    var posEl = $('#concertPos');
    if (posEl) {
      posEl.textContent = label;
      posEl.classList.toggle('is-instrumental', !C.visible.length);
    }
    var curEl = $('#concertScroll p.is-cur');
    if (curEl) {
      var sc = $('#concertScroll');
      var target = curEl.offsetTop - sc.clientHeight * 0.34;
      sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

  function advance(step) {
    var nextIdx = C.idx + step;
    if (nextIdx < 0) return;
    if (nextIdx >= C.visible.length) {
      nextSong();
      return;
    }
    C.idx = nextIdx;
    paintConcert();
    // in synced mode the engine owns the clock, so a manual tap has to
    // re-anchor it — otherwise the next tick drags the cursor straight
    // back to wherever the engine thinks the song is
    if (C.synced && C.engine && C.engine.playing && C.engine.lines) {
      var tapped = C.engine.lines[C.visible[C.idx]];
      if (tapped && typeof tapped.t === 'number' && C.engine.seek) {
        C.engine.seek(tapped.t);
        C.engine.positionMs = tapped.t;
      }
    }
    // while the mic is listening, a manual tap is the user's correction:
    // treat this line as ground truth so the lock realigns around it
    if (C.micOn && C.engine && C.engine.lines) {
      var line = C.engine.lines[C.visible[C.idx]];
      if (line && typeof line === 'object' && typeof line.t === 'number') {
        if (typeof C.engine.correctTo === 'function') {
          // the engine re-bases the clock and anchors the lock itself
          C.engine.correctTo(line.t);
        } else {
          C.engine.lock = C.engine.lock || {};
          C.engine.lock.P = line.t - (Date.now() - (C.engine.mic ? C.engine.mic.startedAt : Date.now()));
          C.engine.lock.songMs = line.t;
          C.engine.lockConfidence = 1;
          if (C.engine.startedAt) C.engine.startedAt = Date.now() - line.t;
          C.engine.positionMs = line.t;
        }
        toast('Re-aligned here');
      }
    }
  }

  /* the setlist moves on: the next queued song takes over */
  function nextSong() {
    if (C.qi >= C.queue.length - 1) {
      C.finished = true;
      toast('End of set');
      if (C.playing) stopAuto();
      if (C.engine) C.engine.pause();
      return false;
    }
    C.qi++;
    loadConcertSong();
    /* loadConcertSong() starts the engine only for a song that has its
       own timing. Starting it again here used to run the clock for a
       song with no grid at all, so the cursor walked on by itself while
       the hint still said "tap right to advance". */
    var song = S.byId[C.queue[C.qi]];
    toast('Next: ' + (song ? song.title : ''));
    return true;
  }

  /* the current song ran out — same as tapping past its last line */
  function songFinished() {
    nextSong();
  }

  function startAuto() {
    stopAuto();
    C.playing = true;
    $('#concertPlayBtn').textContent = '❚❚';
    $('#concertAuto').classList.add('is-on');
    C.timer = setInterval(function () { advance(1); }, SPEEDS[C.speedIdx]);
    setConcertHint();
  }
  function stopAuto() {
    C.playing = false;
    clearInterval(C.timer);
    C.timer = null;
    $('#concertPlayBtn').textContent = '▶';
    $('#concertAuto').classList.remove('is-on');
    setConcertHint();
  }
  function toggleAuto() {
    if (C.playing) stopAuto(); else startAuto();
  }

  function closeConcert() {
    stopAuto();
    releaseMic();                       // the mic dies with the concert
    if (C.engine) { C.engine.destroy(); C.engine = null; }
    C.synced = false;
    C.micOn = false;
    C.songId = null;
    $('#concertSeek').hidden = true;
    $('#concertSync').classList.remove('is-on');
    $('#concertMic').classList.remove('is-on');
    C.open = false;
    $('#concert').hidden = true;
    closeBrightPane();
    document.body.classList.remove('is-locked');
    releaseWake();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  /* ── brightness pane ─────────────────────────────────────────
     The white pane is a full-screen overlay: it must swallow the
     tap that dismisses it, or that tap would land on the tap
     zones underneath and skip a line. */
  function brightPane() { return $('#concertBrightPane'); }

  function brightPaneOpen() {
    var con = $('#concert');
    return !!(con && con.classList.contains('is-bright'));
  }

  function closeBrightPane() {
    var con = $('#concert');
    if (con) con.classList.remove('is-bright');
    var pane = brightPane();
    if (pane) pane.hidden = true;
    var btn = $('#concertBright');
    if (btn) btn.classList.remove('is-on');
  }

  function toggleBrightPane() {
    var con = $('#concert');
    if (!con) return;
    var open = !con.classList.contains('is-bright');
    con.classList.toggle('is-bright', open);
    var btn = $('#concertBright');
    if (btn) btn.classList.toggle('is-on', open);
  }

  /* a visible dismiss control, so the pane is not a dead end */
  function ensureBrightDismiss() {
    var pane = brightPane();
    if (!pane) return;
    if ($('#concertBrightClose', pane)) return;
    var btn = el('<button class="iconbtn iconbtn--sm" id="concertBrightClose" type="button" ' +
                 'aria-label="Dismiss brightness boost">✕</button>');
    btn.style.cssText = 'position:absolute;top:14px;right:14px;z-index:2;width:42px;height:42px;' +
      'border-radius:50%;background:rgba(24,18,16,.55);color:#fff;border:1px solid rgba(255,255,255,.4);' +
      'font:600 1rem/1 var(--font-mono,monospace);';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeBrightPane();
    });
    pane.appendChild(btn);
  }

  function requestFullscreen() {
    var el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(function () {});
    }
  }

  function requestWake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      C.wake = lock;
      lock.addEventListener('release', function () { C.wake = null; });
    }).catch(function () {});
  }
  function releaseWake() {
    if (C.wake) { try { C.wake.release(); } catch (e) {} C.wake = null; }
  }

  /* ── concert lifecycle ──────────────────────────────────────
     Anything that takes the app out of concert mode (a route change,
     the page going into the background, the tab being closed) has to
     let go of the microphone on the way out. */
  function wireConcertLifecycle() {
    // a phone that locks its screen must not leave the mic hot
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') releaseMic();
    });
    window.addEventListener('pagehide', function () { releaseMic(); });
    // any route change leaves concert mode (and the mic) behind
    window.addEventListener('hashchange', function () {
      if (C.open) closeConcert();
    });
    // the browser's own Escape leaves fullscreen: the light stick goes too
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && STICK.open) closeStick();
    });
  }

  /* ── about ─────────────────────────────────────────────── */
  /* The build stamp is written by the build (rebuild_all.py) into a meta
     tag, so everyone can see at a glance whether their phone picked up
     the latest build. */
  function buildStamp() {
    var el = document.querySelector('meta[name="bts-build"]');
    var v = el ? el.getAttribute('content') : '';
    return v ? ' · <strong>' + v + '</strong>' : '';
  }

  /* The build tag in the lockup: a stale deployment is supposed to be
     obvious at a glance, not something you have to go and look for. */
  function paintBuildTag() {
    var el = document.querySelector('meta[name="bts-build"]');
    var tag = document.getElementById('buildTag');
    if (!el || !tag) return;
    var v = (el.getAttribute('content') || '').split('·')[0].trim();
    if (v) {
      tag.textContent = v;
      tag.title = 'build ' + el.getAttribute('content');
    }
  }

  function renderAbout() {
    var m = S.data.meta;
    $('#aboutBody').innerHTML =
      '<h3>Offline, for real</h3>' +
      '<p>The entire lyric book — ' + m.songCount + ' songs, ' + m.releaseCount + ' releases — is bundled into this page. ' +
      'A service worker caches every file the first time you open the app, so after that you can fly mode, ' +
      'put the phone in your pocket, and still read the words.</p>' +
      '<p>Open it once on wifi at the venue. Wait for the badge in the top right to read <strong>offline ready</strong>. ' +
      'Then it does not matter how many thousand people are on the same network.</p>' +
      '<h3>Finding a song</h3>' +
      '<p>The search box forgives typos. It matches the English title, the Korean title and the ' +
      'romanization, so <em>봄날</em>, <em>Spring Day</em> and <em>bomnal</em> all land on the same song — ' +
      'and a slip in the middle of a word does not lose the line either. When what you typed is only ' +
      'near a song, the result says <strong>Closest match</strong>; when nothing matched at all it ' +
      'offers a <strong>Did you mean…?</strong> link.</p>' +
      '<h3>Concert mode</h3>' +
      '<ul>' +
        '<li><strong>Tap the right side</strong> of the screen to move to the next line, the left side to go back.</li>' +
        '<li><strong>▶ Concert mode</strong> goes fullscreen, asks the browser to keep the screen awake, and starts an automatic advance you can pause.</li>' +
        '<li><strong>◷ Synced lyrics</strong> move the cursor by themselves using word-level timings. Tap <strong>🎤</strong> in concert mode and the phone listens to the room and locks on — or tap <strong>◷ Tap to sync</strong> on any song and time it by hand. The microphone is analysed on the device; nothing is uploaded.</li>' +
        '<li><strong>Beat sync</strong> — the metronome button next to the microphone switches the phone from listening for the <em>syllables</em> to listening for the <em>beat</em>. It works out the tempo of the room (the readout shows the BPM it hears) and locks the song to the drum pattern; the words then turn over <em>on the beat</em> instead of wherever the last syllable landed. In a loud venue the beat is the steadier anchor, because a drum pattern is far more regular than a voice.</li>' +
        '<li><strong>Tap the sun</strong> for a bright white pane — useful if the venue is genuinely black.</li>' +
        '<li>Keyboard: <code>→</code> or <code>space</code> next line, <code>←</code> back, <code>esc</code> exit.</li>' +
      '</ul>' +
      '<h3>Light stick</h3>' +
      '<p>The purple button fills the screen with <code>#4a1a8c</code> — the colour of the light stick ' +
      'in every hand at a BTS concert. Three modes, on the bar of the light itself: ' +
      '<strong>BEAT</strong> flashes on the beat the phone has actually measured (tap ' +
      '<strong>Start mic</strong> and it will ask for the microphone and listen for the beat — the ' +
      'pulse rides the same grid as the karaoke cursor, so the light and the words land together), ' +
      '<strong>PULSE</strong> breathes on its own at whatever tempo it knows, and <strong>ON</strong> ' +
      'is a flat colour with nothing moving at all.</p>' +
      '<h3>Korean, romanization, English</h3>' +
      '<p>Every line is the Korean original. The <code>로마</code> button on a song page adds a ' +
      'romanization underneath, and <code>EN</code> adds the machine translation as well — a reading ' +
      'aid, not a lyric sheet. The setting is remembered on the device.</p>' +
      '<p>The Japanese albums are in the book too. Where LRCLIB only has the Korean or English ' +
      'version of a song, that is what ships, and the song page says which language its lyrics are in.</p>' +
      '<h3>Add it to your home screen</h3>' +
      '<p>On Android or desktop Chrome there is an install button below. On iPhone: tap <strong>Share</strong>, ' +
      'then <strong>Add to Home Screen</strong>. After that it opens like a native app, fullscreen, with no browser chrome.</p>' +
      '<p><button class="btn btn--primary" id="installBtn">Install this app</button></p>' +
      '<h3>Setlist</h3>' +
      '<p>Build a running order from any song page with <code>+ Setlist</code>. It is kept in this browser only — ' +
      'nothing is uploaded, nothing is tracked, and it survives a reload.</p>' +
      '<h3>The album art</h3>' +
      '<p>The covers are the <strong>real album artwork</strong>, vectorised into flat-colour ' +
      'SVG posters — one path per colour, traced from the original picture and simplified. ' +
      'Recognisable, not identical: fine line work and small lettering are smoothed away, and ' +
      'photographs of the members become graphic interpretations.</p>' +
      '<h3>Where the words came from</h3>' +
      '<ul>' +
        '<li>Tracklists, release metadata and writer credits: <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>.</li>' +
        '<li>Timed lyrics: <a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a>.</li>' +
        '<li>Romanization is transliterated from the Hangul; the English line is a machine translation and is there as a reading aid, not as a lyric sheet.</li>' +
      '</ul>' +
      '<h3>Credits</h3>' +
      '<ul>' +
        '<li><strong>Tracklists, release dates and writer credits</strong> — ' +
        '<a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>, from the ' +
        'album articles\' track listings and the song articles.</li>' +
        '<li><strong>Lyrics and word-level timings</strong> — ' +
        '<a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a>. ' +
        'The Korean and Japanese lyrics, and the timings that drive the karaoke cursor.</li>' +
        '<li><strong>Album artwork</strong> — the covers on the official store, vectorised into ' +
        'flat-colour SVG posters for this book. The artwork itself belongs to ' +
        '<strong>HYBE</strong> and its artists; this is a non-commercial fan project and no ' +
        'claim is made to it.</li>' +
        '<li><strong>Romanization</strong> — Revised Romanization, written for this project ' +
        '(build/romanize.py). The English line is a machine translation, there as a reading aid.</li>' +
        '<li><strong>Type</strong> — Big Shoulders Display, Spectral and Space Mono, all under the ' +
        'SIL Open Font License.</li>' +
        '<li><strong>Everything else</strong> — the app itself: written for this project, ' +
        'no account, no tracking, no network calls but the ones you make yourself.</li>' +
        '</ul>' +
        '<h3>Signature</h3>' +
      '<div class="signature">' +
        '<span class="signature__mark" aria-hidden="true">✦</span>' +
        '<span class="signature__line">Created by <strong>Roey</strong></span>' +
        '<span class="signature__rule" aria-hidden="true"></span>' +
        '<span class="signature__date"><time datetime="2026-11-26">26 November 2026</time></span>' +
      '</div>' +
      '<p class="mono">Built ' + m.generated + ' · ' + m.withLyrics + ' of ' + m.songCount + ' songs with lyrics' +
      buildStamp() + '</p>' +
      '<p class="mono" style="opacity:.7">Lyrics are reproduced here for personal, non-commercial reference. ' +
      'All words and music belong to their respective rights holders.</p>';
    var ib = $('#installBtn');
    if (ib) ib.addEventListener('click', promptInstall);
  }

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    S.installed = false;
  });
  function promptInstall() {
    if (!deferredPrompt) {
      toast('Use your browser menu → “Add to Home Screen”');
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (r) {
      if (r.outcome === 'accepted') toast('Installing…');
      deferredPrompt = null;
    });
  }

  /* ── routing ───────────────────────────────────────────── */
  /* Start every page at the top. On iOS a focused search field keeps the
     page scrolled by the keyboard's offset: a plain scrollTo(0,0) runs
     while the keyboard is still closing and is undone, and the next
     page opens with its title tucked under the sticky top bar. So let go
     of the field first, and look again once the keyboard has gone —
     unless a field was focused on purpose in the meantime. */
  function toTop() {
    var a = document.activeElement;
    if (a && a !== document.body && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur();
    window.scrollTo(0, 0);
    var again = function () {
      var f = document.activeElement;
      if (f && /^(INPUT|TEXTAREA)$/.test(f.tagName)) return;
      if (window.scrollY >= 160) return;      // the reader has moved on
      // iOS can report scrollY 0 while still painting the old keyboard
      // offset; a 1px nudge forces the repaint
      // (in two frames, so the move is not coalesced into a no-op)
      window.scrollTo(0, 2);
      requestAnimationFrame(function () { window.scrollTo(0, 0); });
    };
    requestAnimationFrame(again);
    setTimeout(again, 350);
    setTimeout(again, 800);
    setTimeout(again, 1400);
    // iOS puts its own offset back when the keyboard has finished
    // closing — that shows up as a visual-viewport resize
    var vv = window.visualViewport;
    if (vv) {
      var onVv = function () { again(); };
      vv.addEventListener('resize', onVv);
      setTimeout(function () { vv.removeEventListener('resize', onVv); }, 1200);
    }
  }

  function route() {
    var hash = location.hash.replace(/^#/, '') || '/';

    // "#/songs?q=Pdogg" — the writer links on a song page. Run that search
    // in the library and drop the query from the address, so Back and a
    // reload land on the library rather than repeating the search.
    var qm = hash.match(/^\/songs\?q=(.*)$/);
    if (qm) {
      var q = '';
      try { q = decodeURIComponent(qm[1].replace(/\+/g, ' ')); } catch (e) { q = qm[1]; }
      S.query = q;
      history.replaceState(null, '', '#/');
      hash = '/';
    }

    var parts = hash.split('/').filter(Boolean);

    // a route change always tears down concert mode — the overlay must
    // never survive a navigation away from it (browser Back included)
    if (C.open) closeConcert();

    $$('.navitem, .tabitem').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === parts[0] || (!parts.length && a.getAttribute('data-nav') === 'library'));
    });

    if (parts[0] === 'song' && parts[1]) {
      S.currentId = parts[1];
      renderSong(parts[1]);
      hideReleaseView();
      return;
    }
    if (parts[0] === 'release' && parts[1] !== undefined) {
      renderRelease(+parts[1]);
      return;
    }
    $('#view-song').hidden = true;
    $('#view-song').innerHTML = '';

    if (parts[0] === 'songs') {
      $('#view-library').hidden = true;
      $('#view-songs').hidden = false;
      $('#view-setlist').hidden = true;
      $('#view-about').hidden = true;
      hideReleaseView();
      renderAlpha();
      toTop();
      return;
    }
    if (parts[0] === 'setlist') {
      $('#view-library').hidden = true;
      $('#view-songs').hidden = true;
      $('#view-about').hidden = true;
      $('#view-setlist').hidden = false;
      hideReleaseView();
      renderSetlist();
      toTop();
      return;
    }
    if (parts[0] === 'about') {
      $('#view-library').hidden = true;
      $('#view-songs').hidden = true;
      $('#view-setlist').hidden = true;
      $('#view-about').hidden = false;
      hideReleaseView();
      renderAbout();
      toTop();
      return;
    }

    // library
    $('#view-library').hidden = false;
    $('#view-songs').hidden = true;
    $('#view-setlist').hidden = true;
    $('#view-about').hidden = true;
    hideReleaseView();
    // the library may have been wiped by something else — put the
    // search bar, the chips, the release grid and the song list back
    restoreLibrary();
    if (!S.libraryBuilt) { renderLibrary(); S.libraryBuilt = true; }
    else renderSongList($('#songList'));
    var si = $('#searchInput');
    if (si && si.value !== (S.query || '')) si.value = S.query || '';
    if (S.query) runSearch(S.query);
    else { runSearch(''); }
    toTop();
    if (S.pendingSearchFocus) { S.pendingSearchFocus = false; focusSearch(); }
  }

  /* ── network badge ─────────────────────────────────────── */
  function updateNet() {
    var badge = $('#netBadge');
    var label = $('#netLabel');
    var offline = !navigator.onLine;
    var ready = !!S.offlineReady;
    badge.classList.toggle('is-offline', offline);
    badge.classList.toggle('is-ready', ready && !offline);
    label.textContent = offline ? 'offline' : (ready ? 'offline ready' : 'online');
    badge.title = offline
      ? 'No signal — everything below still works.'
      : (ready ? 'All lyrics are cached on this device. You can go offline.' : 'Caching lyrics for offline use…');
  }

  /* ── boot ──────────────────────────────────────────────── */
  function loadData() {
    // The lyric pack ships as a plain script so it also works from a
    // file:// download (no fetch, no CORS) and loads before first paint.
    if (window.__BTS_LYRICS__) return Promise.resolve(ingest(window.__BTS_LYRICS__));
    return Promise.reject(new Error('lyric pack missing'));
  }

  function ingest(data) {
    S.data = data;
    S.songs = data.songs;
    S.releases = data.releases;
    data.songs.forEach(function (s) { S.byId[s.id] = s; });
    $('#heroStats').textContent = data.songs.length + ' songs · ' + data.releases.length + ' releases';
    $('#songCount').textContent = data.songs.length + ' songs';
  }

  function boot() {
    captureLibraryMarkup();
    S.setlist = LS.get('bts.setlist', []);
    S.stars = LS.get('bts.stars', {});
    S.settings = Object.assign({ scale: 1, autoSpeed: 3500, lang: 'roman' }, LS.get('bts.settings', {}));
    paintBuildTag();
    document.documentElement.style.setProperty('--lyric-scale', S.settings.scale);

    loadData().then(function () {
      updateSetCount();
      updateOfflineUi();
      route();
      window.addEventListener('hashchange', route);
    }).catch(function (err) {
      $('#heroStats').textContent = 'offline pack missing';
      toast('Could not load the lyric pack');
      console.error(err);
    });

    /* the badge knows what is on the device — the library follows it */
    document.addEventListener('bts:pack', onPackChange);

    /* search */
    bindLibraryUI();
    $('#searchJump').addEventListener('click', function () {
      // the search field lives inside the library — go there first
      goLibrary(true);
    });

    /* A–Z jump */
    $('#alphaRail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-letter]');
      if (!b) return;
      jumpToLetter(b.getAttribute('data-letter'));
    });

    $('#stickBtn').addEventListener('click', function () { openStick(null); });
    $('#concertStick').addEventListener('click', function () {
      openStick(C.queue[C.qi] || null);
    });
    $('#stickBtn').addEventListener('click', function () { openStick(null); });
    $('#stickExit').addEventListener('click', function (e) {
      e.stopPropagation();
      closeStick();
    });
    $('#stickMode').addEventListener('click', function (e) {
      e.stopPropagation();
      cycleStickMode();
    });
    $('#stickMic').addEventListener('click', function (e) {
      e.stopPropagation();
      startStickMic();
    });
    $('#stickExit').addEventListener('click', function (e) {
      e.stopPropagation();
      closeStick();
    });

    /* star buttons (delegated) */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-star]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var id = b.getAttribute('data-star');
      if (S.stars[id]) delete S.stars[id]; else S.stars[id] = Date.now();
      LS.set('bts.stars', S.stars);
      b.classList.toggle('is-on', !!S.stars[id]);
      b.textContent = S.stars[id] ? '★' : '☆';
      var row = b.closest('.songrow');
      if (row) row.classList.toggle('is-starred', !!S.stars[id]);
      toast(S.stars[id] ? 'Starred' : 'Unstarred');
    });

    /* setlist view ops */
    $('#setlistBox').addEventListener('click', function (e) {
      var op = e.target.closest('[data-op]');
      var act = e.target.closest('[data-act]');
      if (act) {
        if (act.getAttribute('data-act') === 'play') {
          if (!S.setlist.length) { toast('Setlist is empty'); return; }
          openConcert(S.setlist.slice(), 0);
        } else if (act.getAttribute('data-act') === 'clear') {
          // one stray tap must not wipe the running order for the night
          var n = S.setlist.length;
          if (n > 1 && !window.confirm('Clear all ' + n + ' songs from the setlist?')) return;
          S.setlist = [];
          LS.set('bts.setlist', S.setlist);
          renderSetlist(); updateSetCount();
          toast('Setlist cleared');
        }
        return;
      }
      if (!op) return;
      var row = op.closest('.setrow');
      var id = row.getAttribute('data-id');
      var i = S.setlist.indexOf(id);
      var kind = op.getAttribute('data-op');
      if (kind === 'up' && i > 0) { S.setlist.splice(i, 1); S.setlist.splice(i - 1, 0, id); }
      else if (kind === 'down' && i < S.setlist.length - 1) { S.setlist.splice(i, 1); S.setlist.splice(i + 1, 0, id); }
      else if (kind === 'del') { S.setlist.splice(i, 1); toast('Removed'); }
      LS.set('bts.setlist', S.setlist);
      renderSetlist(); updateSetCount();
    });

    /* concert controls */
    $('#tapNext').addEventListener('click', function (e) {
      e.stopPropagation();
      advance(1);
    });
    $('#tapPrev').addEventListener('click', function (e) {
      e.stopPropagation();
      advance(-1);
    });
    $('#concertNextBtn').addEventListener('click', function () { advance(1); });
    $('#concertPrevBtn').addEventListener('click', function () { advance(-1); });
    $('#concertPlayBtn').addEventListener('click', toggleAuto);
    /* ↓ is a plain on/off switch: tap to start, tap again to stop.
       The speed lives on the footer hint ("auto · 3.5s per line"):
       tap it while auto scroll runs to step slow → medium → fast. */
    $('#concertAuto').addEventListener('click', function () {
      toggleAuto();
      toast(C.playing
        ? 'Auto scroll on · ' + (SPEEDS[C.speedIdx] / 1000) + 's per line — tap the speed to change it'
        : 'Auto scroll off');
    });
    $('#concertHint').addEventListener('click', function () {
      if (!C.playing || C.synced) return;
      C.speedIdx = (C.speedIdx + 1) % SPEEDS.length;
      startAuto();
      toast('Auto speed: ' + (SPEEDS[C.speedIdx] / 1000) + 's per line');
    });
    $('#concertSize').addEventListener('click', function () { changeScale(0.12); });
    $('#concertBright').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleBrightPane();
      if (brightPaneOpen()) ensureBrightDismiss();
    });
    $('#concertClose').addEventListener('click', closeConcert);

    /* the brightness pane swallows the tap that dismisses it, so the
       tap never reaches the tap zones underneath */
    var brightPaneEl = $('#concertBrightPane');
    if (brightPaneEl) {
      brightPaneEl.addEventListener('touchstart', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeBrightPane();
      }, { passive: false });
      brightPaneEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeBrightPane();
      });
    }

    /* sync mode */
    $('#concertSync').addEventListener('click', toggleSync);
    $('#concertMic').addEventListener('click', toggleMic);
    $('#concertBeat').addEventListener('click', toggleBeatMode);
    $('#concertBeat').addEventListener('click', toggleBeatMode);
    $('#seekRange').addEventListener('input', function () {
      if (!C.engine || !C.engine.duration) return;
      C.engine.seek(Math.round(this.value / 1000 * C.engine.duration));
    });

    /* tap-to-sync editor */
    $('#editorTap').addEventListener('click', editorTap);
    $('#editorSave').addEventListener('click', editorSave);
    $('#editorClose').addEventListener('click', closeEditor);
    $('#editorCancel').addEventListener('click', closeEditor);
    $('#editorReset').addEventListener('click', function () {
      if (!EDIT) return;
      window.BTSSync.clearCustom(EDIT.songId);
      toast('Custom timing removed');
      closeEditor();
    });

    document.addEventListener('keydown', function (e) {
      if (STICK.open) {
        if (e.key === 'Escape') { closeStick(); }
        return;
      }
      if (STICK.open) {
        if (e.key === 'Escape') { closeStick(); }
        return;
      }
      if (!C.open) return;
      if (e.key === 'Escape') { closeConcert(); return; }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); advance(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); advance(-1); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && C.open && !C.wake) requestWake();
    });

    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    updateNet();

    /* service worker */
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').then(function (reg) {
          /* Never on a timer: the worker knows exactly how many files are
             in the pack. "offline ready" requires an active worker, a
             controlling worker AND a whole pack. */
          var done = function () {
            if (!navigator.serviceWorker.controller) return;
            askPackStatus().then(function (status) {
              if (!status || !status.complete) {
                S.offlineReady = false;
                updateNet();
                return;
              }
              S.offlineReady = true;
              updateNet();
            });
          };
          if (reg.active && navigator.serviceWorker.controller) done();
          else {
            navigator.serviceWorker.addEventListener('controllerchange', done);
            reg.addEventListener('updatefound', function () {
              var w = reg.installing;
              if (!w) return;
              w.addEventListener('statechange', function () {
                if (w.state === 'activated') done();
                if (w.state === 'redundant') { S.offlineReady = false; updateNet(); }
              });
            });
          }
        }).catch(function (err) { console.warn('SW registration failed', err); });
      });
      /* the worker broadcasts when the pack changes */
      navigator.serviceWorker.addEventListener('message', function (ev) {
        if (ev.data && ev.data.type === 'bts:pack-status') {
          S.offlineReady = !!ev.data.complete && !!navigator.serviceWorker.controller;
          updateNet();
        }
      });
    }
  }

  /* ask the service worker how much of the offline pack is really there */
  function askPackStatus() {
    var sw = navigator.serviceWorker;
    if (!sw || !sw.controller) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      var settled = false;
      function finish(v) { if (settled) return; settled = true; resolve(v); }
      channel.port1.onmessage = function (ev) { finish(ev.data || null); };
      setTimeout(function () { finish(null); }, 2000);
      try { sw.controller.postMessage({ type: 'bts:status' }, [channel.port2]); }
      catch (e) { finish(null); }
    });
  }

  /* small read-only hook so the sync state can be inspected/verified */
  window.__BTS_ENGINE__ = function () { return C.engine; };
  window.__BTS_MIC__ = function () {
    var s = C.micStream;
    return {
      on: !!C.micOn,
      stream: s,
      trackCount: s ? s.getTracks().length : 0,
      states: s ? s.getTracks().map(function (t) { return t.readyState; }) : []
    };
  };
  window.__BTS_STATE__ = function () {
    return {
      synced: C.synced,
      micOn: C.micOn,
      pos: C.engine ? Math.round(C.engine.positionMs) : 0,
      duration: C.engine ? C.engine.duration : 0,
      lock: C.engine && C.engine.lock ? Math.round(C.engine.lock.songMs) : null,
      confidence: C.engine ? +C.engine.lockConfidence.toFixed(2) : 0,
      onsets: C.engine && C.engine.lock ? C.engine.lock.onsets : 0,
      line: C.visible.length ? C.visible[C.idx] : -1,
      mode: $('#syncMode') ? $('#syncMode').textContent : ''
    };
  };

  wireConcertLifecycle();


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

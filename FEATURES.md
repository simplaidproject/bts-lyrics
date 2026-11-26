# The BTS lyric book — features, and the things that can go wrong

A guide to what the app does, and what to do when it doesn't behave. Written
for the person holding the phone at a concert, not for a developer.

**281 songs · 27 releases · 274 with lyrics and word-level timings · 8.3 MB,
3.1 MB zipped**

---

## 1. The features

### Offline, for real
The whole book — every lyric, every timing, every cover — is bundled into the
page and cached by a service worker the first time you open it. After that it
works in airplane mode, on a dead network, on a plane.

The badge in the top right tells you the truth:

| badge | meaning |
|---|---|
| **offline ready** | everything is on the device — you can go offline now |
| **installing** | the pack is downloading; it will say *offline ready* when it is whole |
| **warn / incomplete** | some files are missing; open the app on wifi once more |

The pack is **atomic**: it is either complete or it is not. A half-downloaded
pack never claims to be offline-ready and never replaces a good one.

### Finding a song
The search box matches **English titles, Korean titles, romanizations, releases,
writers and the lyric text** — and it forgives typos.

| you type | you get |
|---|---|
| `Spring Day` | the song |
| `봄날` | the same song |
| `bomnal` | the same song |
| `sprng day` | the same song, with **Closest match** above the results |
| `bombnal` | the same song — the slip was inside a lyric line |
| `asdfghjkl` | nothing, and *no* silly suggestion |

When a query matches nothing but something is close, you get a
**Did you mean…?** link. When it matches something only fuzzily, the result
says **Closest match** — so a typo never passes silently.

The **alpha rail** down the side of the library jumps to a letter.

### Reading a song
- the English title, with the **Korean title and its romanization** underneath
- **Written by** — every songwriter, each name a link into the search, so you
  can pull up everything Pdogg or RM touched
- the lyrics in **three forms**, switched with one button:
  - **로마** — the romanization is the big text, the Hangul sits under it
  - **한글** — the Hangul is the big text, the romanization under it
  - **EN** — romanization, Hangul and the English translation together

### Concert mode
Fullscreen, screen kept awake, huge type.
- **tap the right side** of the screen → next line; **left side** → back
- **↓** auto-scroll on and off (or **▶ / ❚❚**); while it runs, tap the speed
  at the bottom right to step 4.5s → 3.5s → 2.2s per line — or let the synced
  cursor drive it
- **Aa** → bigger or smaller text, remembered per device
- **☀** → the **bright mode**: cream background, dark text — the one to use
  when the phone screen is washed out by daylight
- text in parentheses — the **fanchant** moments — is highlighted, so you can
  see where the crowd answers

### Synced lyrics, three ways
| tier | how | when |
|---|---|---|
| **◷ Synced** | word-level timings from LRCLIB; the cursor moves by itself, word by word | 274 of the 281 songs |
| **🎤 Listen** | the phone listens to the room and works out where you are | when the built-in timing is wrong, or you want to follow the actual performance |
| **◷ Tap to sync** | you tap each line as you hear it | always works, no microphone needed |

The mic has **two ways of listening**:
- **words** — matches vocal onsets against the lyric grid
- **beat** — measures the tempo and the downbeat of the room, and rides that
  grid; the readout shows the BPM it is hearing (`♩120`)

### The light stick
A full-screen ARMY purple (`#4a1a8c`) with a glow in the middle — the
colour of the bang! stick in every hand. Three modes on its own bar:

| mode | what it does |
|---|---|
| **BEAT** | flashes on the beat the phone measured. Tap **🎤** and it asks for the microphone and listens for it. The pulse rides the same grid as the karaoke cursor, so light and words land together |
| **PULSE** | breathes on its own, at the tempo it knows if it has one |
| **ON** | a flat colour, nothing moving |

The mode is remembered on the device.

### Setlist, stars, install
- **+ Setlist** on any song builds a running order for the night; **★** marks
  a favourite. Both live on the device only.
- **Add to Home Screen** makes it a real app: fullscreen, no browser chrome.

### Privacy
No account, no cookies, no tracking, no server. The content security policy
closes every outbound connection, so nothing — not even an analytics beacon —
can leave the page. The microphone is analysed on the device and nothing is
uploaded — ever.

---

## 2. Things that can go wrong

### The first load is big
The pack is **8.3 MB**. Open it once on **wifi**, in the parking lot, before
the show. On a venue's overloaded network this is the difference between a
lyric book and a spinning wheel.

### The install can fail on a bad network
The worker fetches four files at a time, three attempts each, twenty seconds
per file, with a two-minute ceiling for the whole install. If it fails, the
app retries by itself the moment the network comes back — so you do not have
to reload, but you should open the app once more on wifi to be sure.

### An update may not arrive
The worker caches the pack under a key that includes its version number. A
new build only reaches your phone if that version changed. If the app looks
frozen, **close it completely and open it again** — that is what triggers the
check. If the build tag next to the logo still shows the old number, you are
looking at the old build.

### The microphone can be refused
If you tap **🎤** and the browser says no, the light stick cannot follow the
beat and the *Listen* tier cannot lock on. Everything else still works:
timed lyrics, tap-sync, the light stick in PULSE or ON mode.

Permission is per browser, per site — if you said no once, you have to say yes
again in the browser's site settings.

### In a loud venue the mic hears the crowd
Screaming, clapping and the PA system can swamp the vocals. The lock then
sits at **searching…** and never settles. Two ways out:
- switch the mic to **beat** — a drum pattern is far more regular than a voice
- use **tap-sync** and tap the lines yourself

### The mic locks onto the wrong moment
The *Listen* tier matches vocal onsets against the lyric grid. A loud
instrumental intro, a rap verse that is spoken over the beat, or a crowd
chant can all pull it off by a few seconds. When that happens, **tap the line
you are actually on** — a tap is treated as ground truth and the lock
re-aligns around it.

### The screen may still dim
The app asks the browser to keep the screen awake, but the OS can take that
back (a call, a low-battery saver, some Android skins). Wake it with a tap;
the position is kept.

### Seven songs have no lyrics
These are interludes, hidden tracks and one instrumental:
`いいね!` (Wake Up), `Track 10` (The Most Beautiful Moment in Life, Pt. 1),
`Track 8/9/10` (Map of the Soul: Persona), `Outro: The Journey` (Map of the
Soul: 7 – The Journey) and `No. 29` (Arirang). Everything else opens.

### Sixty-one songs have no writer credits
The Japanese albums and a few track listings publish none — You Never Walk
Alone (18), BTS, the Best (12), Skool Luv Affair Special Addition (11) and
scattered singles. The rest carry their credits.

### The Japanese albums are in Japanese
Where LRCLIB has the Japanese version, that is what ships — so the Japanese
albums read in Japanese, not Korean. Where only the Korean version exists,
that is what ships and the song page says which language it is.

### The English is machine-made
The translation is a reading aid, not a lyric sheet. It is serviceable for
meaning and occasionally clumsy with the phrasing — the Korean original and
the romanization are the reliable text.

### The romanization is Revised Romanization
`joayo`, `hakgyo`, `haengbok` — the standard used by Wikipedia and most
lyric sites. Some fans prefer the "official" K-pop romanization, which
spells things differently (`joha-yo`, `hak-gyo`). If yours looks unfamiliar,
it is not a bug.

v12 fixed the w-vowels, which earlier builds spelled wrong in about 5,000
lines: 뭐 is `mwo` (not `mueo`), 원 `won`, 와 `wa`, 왜 `wae`, 위 `wi`, 의 `ui`,
and a double ㄹ is `ll` (불러 → `bulleo`).

### Some Korean songs have no Hangul
About 37 songs came from LRCLIB as romanized text only — Blood Sweat & Tears
(Wings), Dope, Whalien 52, Blanket Kick, Make It Right, Blue & Grey and
others. They read fine in romanization, but the **한글** view has nothing to
show and there is no English line. Fixing them needs the Korean lyric text
from the source; the app cannot invent it.

### The cover art is a poster, not the photograph
The album art was vectorised into flat-colour SVG: recognisable, but fine
line work and small lettering are smoothed away, and photographs of the
members become graphic interpretations. The artwork belongs to HYBE and its
artists; this is a non-commercial fan project and claims nothing.

### The search can surprise you
Searching a word from a chorus finds the song that contains it — which may
not be the song you meant. Look at the release and year next to the result.

### A song can appear twice
The same recording sits on several releases (*Spring Day* on You Never Walk
Alone and on Proof; *Boy With Luv* on Skool Luv Affair and on Persona). The
song page shows the release it came from.

### iOS has no fullscreen API
The browser cannot force fullscreen on an iPhone, so the light stick fills
the window but does not hide the status bar. Installed to the home screen it
covers everything anyway.

### The address is https://simplaidproject.github.io/bts-lyrics/
The app lives on GitHub Pages and updates in place: push a new build to the
`main` branch of `simplaidproject/bts-lyrics` and the same address serves it a minute
later. The old MiniMax addresses (`…space.mcode.io`) still serve their own
frozen v11 — do not use them. Check the build tag next to the logo (`v12`
today).

---

## 3. If something is wrong, in order

1. **Close the app completely and open it again** — forces the service
   worker to check for a new build.
2. **Look at the build tag** next to the logo. If it is not the number you
   expect, you are on an old address.
3. **Open the app on wifi once** and wait for **offline ready**.
4. **Switch the mic to beat mode** in a loud room, or use **tap-sync**.
5. **Check the About page** — it names every source, so you can see whether
   a missing lyric is missing from the source or from the app.

---

*Built by Roey · lyrics for personal, non-commercial reference · all words and
music belong to their rights holders*

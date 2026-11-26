# Test checklist — the BTS lyric book

Everything you need to check before it goes in your pocket for the night.
Work down the page; each item says **what to do** and **what you should see**.

Mark: ✅ works · ❌ broken · ➖ known, see the note

---

## 0. The five-minute smoke test

If you only do five things, do these.

| # | do this | expect |
|---|---|---|
| 1 | open the app on **wifi** | the badge goes *installing* → **offline ready** within a minute or two |
| 2 | tap the badge | it says how many of the 52 files are cached |
| 3 | search `봄날` | Spring Day, with **봄날** and **BOMNAL** under the title |
| 4 | open Spring Day → **▶ Concert mode** → tap the right side | the next line appears |
| 5 | tap **☀** | the screen turns cream with dark text — the bright mode |

---

## 1. Install and first run

| # | do this | expect |
|---|---|---|
| 1.1 | add the site to your home screen, open it from there | fullscreen, no browser bar |
| 1.2 | open it on wifi and wait | the badge says **offline ready**; the whole pack is on the device |
| 1.3 | watch the badge during the first load | *installing* → *offline ready*; it never says ready while files are missing |
| 1.6 | open the app with **no** network | the library still opens, all 281 songs are listed |
| 1.7 | open a song with no network | the lyrics, the credits and the cover are all there |
| 1.8 | check the cover art offline | the release grid still shows all 27 covers |
| 1.9 | close the app and reopen it offline | it opens straight away, no spinner |

## 2. Finding a song

| # | do this | expect |
|---|---|---|
| 2.1 | search `spring day` | Spring Day first |
| 2.2 | search `봄날` | the same song |
| 2.3 | search `bomnal` | the same song (it is in the romanized lyrics) |
| 2.4 | search `sprng day` | the same song, with **Closest match** above the results |
| 2.5 | search `bombnal` | the same song — the slip was inside a lyric line |
| 2.6 | search `봄나` | 봄날 / Spring Day |
| 2.7 | search `asdfghjkl` | "Nothing matched" and **no** silly suggestion |
| 2.8 | search `봄네일` | no match, but a **Did you mean 봄날?** link |
| 2.9 | search a word from a chorus | the song that contains it; check the release and year before you tap |
| 2.10 | search `Pdogg` | the songs he wrote — the writers are searchable too |
| 2.11 | search `2016` | the songs from that year |
| 2.12 | search `Wings` | the album's songs |
| 2.13 | tap the **Did you mean…?** link | it opens that song |
| 2.14 | use the **alpha rail** on the left | it jumps to a letter, and each letter is sorted by title |
| 2.15 | clear the box | the library comes back, release grid and all |

## 3. Reading a song

| # | do this | expect |
|---|---|---|
| 3.1 | open any song | the English title, the Korean title and its romanization under it |
| 3.2 | look for **Written by** | the songwriters, each one a link; tap one and it searches for them |
| 3.3 | tap **로마** | the romanization becomes the big text, the Hangul sits under it |
| 3.4 | tap again → **한글** | the Hangul becomes the big text, the romanization under it |
| 3.5 | tap again → **EN** | romanization, Hangul **and** the English translation |
| 3.6 | tap **A+** / **A−** | the text grows and shrinks; it stays put when you come back |
| 3.7 | look at a line with brackets in it | the bracketed words are highlighted — those are the fan chants |
| 3.8 | tap **★** | it stars, and stays starred after a reload |
| 3.9 | tap **+ Setlist** | it joins the setlist; tap again to take it out |
| 3.10 | tap a name under **Written by** | the library opens with that name searched (e.g. Pdogg → 141 songs) |
| 3.11 | read a line with 뭐, 원, 와, 왜 or 위 in it | the romanization reads `mwo`, `won`, `wa`, `wae`, `wi` — never `mueo`, `ueon`, `oa` |
| 3.12 | open 피 땀 눈물 on You Never Walk Alone | the title reads **Blood Sweat & Tears**, with 피 땀 눈물 · PI TTAM NUNMUL under it |

## 4. Concert mode

| # | do this | expect |
|---|---|---|
| 4.1 | tap **▶ Concert mode** on the song page | it goes fullscreen, the lyrics fill the screen |
| 4.2 | tap the **right** side | the next line; tap the **left** side | the previous line |
| 4.3 | use **→** / **space** / **←** | same as tapping |
| 4.4 | tap the **auto-scroll** button (↓ arrow) | the lines advance on their own; tap ↓ again to stop |
| 4.4b | while it runs, tap the speed at the bottom right (`auto · 3.5s/line ›`) | it steps 4.5s → 3.5s → 2.2s per line |
| 4.5 | tap **Aa** in the concert bar | the text grows and shrinks |
| 4.6 | tap the **sun** (brightness boost) button | the concert turns cream with dark text — the mode to use in daylight |
| 4.7 | leave the phone for a minute and come back | the screen has not dimmed (if it has, wake it — see 5.6) |
| 4.8 | let a song run out | it moves on to the next song of the setlist |
| 4.9 | press **Escape** | it leaves concert mode |

## 5. Synced lyrics

| # | do this | expect |
|---|---|---|
| 5.1 | open a song, tap **◷ Synced** | it turns on the synced cursor |
| 5.2 | enter concert mode and tap the **clock** | the cursor moves by itself, word by word |
| 5.3 | tap **🎤** | it asks for the microphone; the badge says *listening* |
| 5.4 | with the song playing, wait | it locks on; the chip reads **locked** (or shows a BPM) |
| 5.5 | tap **♩** (the metronome) | the mic now measures the **beat** instead of the words; the readout shows the BPM, e.g. `♩120` |
| 5.6 | the screen dims anyway | tap it once — the position is kept, but the OS took the wake lock back |
| 5.7 | open a song with **◷ Tap to sync** and tap each line as you hear it | the cursor follows your taps |
| 5.8 | in *Listen* mode, tap a line that is wrong | it jumps to that line and stays there — your tap is the truth |
| 5.9 | a song with no lyrics (see §9) | the page says the lyrics are not published, and does not hang |

## 6. The light stick

| # | do this | expect |
|---|---|---|
| 6.1 | in concert mode, tap the **light stick** button (the purple stick) | the screen goes ARMY purple with a glow |
| 6.2 | look at the bar | the song title, the mode (**BEAT**), the **🎤** button and **EXIT** |
| 6.3 | tap **🎤** | it asks for the microphone; the button disappears once it is listening |
| 6.4 | with the music playing, watch the glow | it **flashes on the beat**, and the bar shows the BPM |
| 6.5 | tap **BEAT** once | it becomes **PULSE** — a slow breathing, no microphone needed |
| 6.6 | tap again | **ON** — a flat colour, nothing moving |
| 6.7 | tap again | back to **BEAT** |
| 6.8 | close the app and reopen it | the mode you chose is still there |
| 6.9 | tap **EXIT** | it closes **without a black screen** — the concert mode is still there underneath |
| 6.10 | press **Escape** | it closes the same way |
| 6.11 | exit the light stick while the music is playing | the beat lock is gone, but the timed lyrics still work |

## 7. Setlist and stars

| # | do this | expect |
|---|---|---|
| 7.1 | build a setlist of five songs | they are listed in order |
| 7.2 | reload the app | the setlist survived |
| 7.3 | enter concert mode with a setlist | the songs run one after another |
| 7.4 | clear the setlist | with two or more songs it asks first; then it empties and says so |

## 8. Installing an update

| # | do this | expect |
|---|---|---|
| 8.1 | bump `VERSION` in `sw.js` and the `bts-build` tag in `index.html`, then push to `main` on `simplaidproject/bts-lyrics` | GitHub Pages rebuilds in a minute or two (Actions tab shows *pages build and deployment*) |
| 8.2 | **close the app completely** and open it again | the new build arrives |
| 8.3 | look at the tag next to the logo | it shows the new number (today: **v12**) |
| 8.4 | if the tag has not changed | the update has not arrived — try step 8.2 once more |
| 8.5 | open the old MiniMax address (`…space.mcode.io`) | it still serves the frozen v11 — only use **https://simplaidproject.github.io/bts-lyrics/** |

## 9. Known results that are *not* bugs

Check these so you do not go hunting for a fix that isn't there.

| # | what you will see | why |
|---|---|---|
| 9.1 | 7 songs open with no lyrics: `いいね!`, `Track 10`, `Track 8/9/10`, `Outro: The Journey`, `No. 29` | interludes and hidden tracks; the source has no lyrics for them |
| 9.2 | 61 songs have no **Written by** line (You Never Walk Alone 18, BTS, the Best 12, Skool Luv Affair Special Addition 11, and scattered singles) | those track listings publish no writer credits |
| 9.3 | the Japanese albums read in Japanese | that is the version LRCLIB has; where only Korean exists, the song page says so |
| 9.4 | the English line is clumsy in places | it is a machine translation — a reading aid, not a lyric sheet |
| 9.5 | the romanization looks unfamiliar (`joayo`, `hakgyo`) | it is Revised Romanization, not the K-pop spelling some fans expect |
| 9.6 | the cover art is a poster, not the photograph | the artwork was vectorised into flat colours |
| 9.7 | the same song appears on two releases | it really is on two (*Spring Day* on YNWA and on Proof) |
| 9.8 | on an iPhone the light stick leaves the status bar visible | iOS has no fullscreen API; installed to the home screen it covers everything |
| 9.9 | the app never asks for an account, never phones home | by design — the policy closes every outbound connection |
| 9.10 | about 37 Korean songs (Blood Sweat & Tears on Wings, Dope, Whalien 52, …) show romanization only — no Hangul, no English | the source shipped them romanized; the 한글 view has nothing to show |

## 10. Reporting a problem

Please include:

- the **build tag** next to the logo (it says v12 today)
- the phone and browser (e.g. iPhone 15, Safari 17; Pixel 8, Chrome 120)
- whether you were **online or offline**
- what you tapped, in order, and what you saw instead

---

*Checklist for build v12 · 281 songs · 27 releases · 8.3 MB*

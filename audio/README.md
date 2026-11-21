# DASH Parkour audio

The DASH Parkour soundtrack and sound effects are original and fully
synthesized: no audio files. The full asset list (every song and effect,
and when it plays) is in [`games/dash-parkour/AUDIO.md`](../../games/dash-parkour/AUDIO.md).

| File | What it is |
|---|---|
| `dash-audio.js` | The engine: synth instruments, mixer, music player, `window.DashAudio` |
| `dash-music.js` | The songs, and the composing helpers they're written with |
| `dash-sfx.js` | The sound effects |

## The motifs

Four ideas tie the whole soundtrack together.

- **The Dash motif.** This comes from `Dash Main Motif.mid` and appears in every song. It is two bars long:
  - **Bar 1:** `C D E . | F E D E D`. Its opening `C D E` is the **dash cell**, three quick rising notes with a push on the third. The bar continues with the "turn".
  - **Bar 2:** `C C A A | D C D E D`. This bar holds the **drop** (1 1 6 6) and the **climb**.

  The motif is written as scale degrees, so it can sit in any key or mode. In major it sounds heroic. In minor it's the hero under pressure. In Phrygian (`C Db Eb`) it's the darkest version, used in Area X and by Master X.
- **The Guards' motif.** This comes from `Boss battle motif.mid`. It is a hammered note on the rhythm `X..x.....x.x.x..`, with a half-step run leading back to it. In C, that note is F♯, a tritone from the hero's C. It becomes every boss riff, and brass stabs play its rhythm.
- **The Adventure Tune.** This is a new 8-bar melody that grows out of the dash cell. It is Area 1's tune, and it comes back in the Title, Area 2, the final chase and the ending.
- **The X figure.** `C Db G F#` belongs to Master X and Area X. It is the dash cell's first step squeezed to a half step, then the Guards' tritone. It appears as a melody and as a bass ostinato.

## The songs

| Song | Key, tempo | Themes and motifs |
|---|---|---|
| **Title** (`title`) | C major, 152 | The intro is a brass fanfare built from the dash cell. **A** is the Dash motif exactly as written, on the "Dash guitar". **B** is the Adventure Tune's first appearance (flute, glockenspiel), with the guitar answering with the dash cell. The **bridge** sends the drop cell falling in sequence. **A2** has the motif with brass a third below. |
| **Area 1** (`area1`) | F major, 140 | The Adventure Tune on flute (A), then with glockenspiel and a horn countermelody (A2). **B** is the full motif as call and response (flute, then glockenspiel). **C** is a gentle relative-minor interlude. |
| **Area 2** (`area2`) | B minor to D major, 150 | Area 1's tune turned minor over a 16th-note string ostinato. In **A2** the tune returns in D major with Area 1's horn line. **B** is the motif in stretto (guitar, with the glockenspiel a bar behind). **C** climbs by half steps back into the tune. |
| **Area 3** (`area3`) | D minor, 128 | The intro plays the dash cell at half speed on horns. **A** is the motif on brass, and every phrase stops on the dominant, so it never comes home. **B** borrows Area X's chord loop (i, ♭VI, iv, V) and the X figure in the low strings. The **bridge** passes through E♭ (Area X's flat second). |
| **Area X** (`areaX`) | C Phrygian, 72 | Built like Maze Man 2's "cold empty halls": a low drone, a slow minor pad and a few cold bells far apart. The bells play the motif twice as slow in Phrygian, and the choir sings the X figure. In **B** the drone slides from C to D♭ over a slow heartbeat. |
| **ECH0 Chase** (`ech0`) | C Phrygian, 144 | Area X at double speed for the X-3 race: the same chord loop and bell line, now a nervous run. A racing double heartbeat, a ticking 16th clock, the X figure as a pulsing bass, and trembling strings. When ECH0 gets close, taiko, snare and a high choir come in, and they fade away as Dash pulls ahead. |
| **Shop** (`shop`) | B♭ major, 100, swung | Its own lounge tune on vibraphone, electric piano, upright bass and brushes. The motif only slips in at the end of each phrase (bar 1 after A, bar 2 after B). |
| **Guard Boss** (`guard1`, `guard2`, `guard3`) | F♯ minor, 164 / 168 / 172 | The Guards' motif is the riff (bass and power-chord guitars). **A** is the Dash motif in F♯ minor on guitar, the hero fighting back. **B** is a heroic brass tune from the dash cell, stretched out. When the Guard tires, the band drops out and bells play the dash cell. Emerald adds a string ostinato; Ruby adds choir and 16th hats. The defeat rings out on an F♯ major chord. |
| **Final Stage 1** (`final1`) | C minor, 176 | The Guard theme moved a tritone (F♯ to C) and darkened with an organ. The intro uses Area X's drone, bells and X figure. **A** has the Dash motif in Phrygian. **B** has the X figure on brass and choir. Waves 4 and 5 add choir, timpani and 16th strings. |
| **Final Stage 2** (`final2`) | C, D, then E♭ minor, 138 | The X figure runs as a bass ostinato under Master X's theme (organ, then choir, then brass). The Dash guitar duels with the motif in minor. Each vortex life broken adds layers and raises the key. At the final stabilization the music drops away and the dash cell rises on bells (A♭, then B♭). Then the first half of the Dash motif arrives in C major, twice as slow, with the whole orchestra. During the escape cutscene, Area 1's tune glimmers on the harp, and the dash cell sounds again in F minor. |
| **Final Stage 3** (`final3`) | F minor (then F♯, G), 172 | The race: the Adventure Tune turned dark on brass over racing strings and a galloping beat, with the X figure always in the bass just ahead. **B** is a duel, the Dash motif on guitar answered by the X figure. Each lap goes up a half step. |

**How the songs connect.**
- **Title and Area 1:** the Adventure Tune links them.
- **Area 1, Area 2, Stage 3:** Area 2 and Stage 3 turn Area 1's tune minor.
- **Area X and ECH0 Chase:** the same song, the chase twice as fast.
- **Area 3 and Area X:** they share a chord loop and the X figure.
- **Guards and Stage 1:** Stage 1 is the same theme a tritone away.
- **Area X and Stages 1–2:** both stages use the X figure, the drone and Phrygian.

The cutscene cues reuse all of these.

## How the music works

- **Songs are text.** In `dash-music.js`, melodies are written as scale degrees (`'1:2 2:1 3:5'` means degree, then length in 16ths). Chords are written as symbols (`'Fm | Db:2 Eb:2'`). Helpers like `arp`, `bass`, `pad` and `drum` build the accompaniment. A song is a set of **sections**, each a few bars of **parts** (an instrument plus its notes). Each section names the one that comes `next`, so songs loop with no gaps.
- **The player** in `dash-audio.js` schedules notes about 0.2 s ahead on the Web Audio clock, so timing is sample-accurate.
- **The game picks the song.** `dashMusicTrack()` in `index.html` chooses the song for the current screen, level, boss or cutscene. `DashAudio.music(name)` crossfades to it, and asking for the song that's already playing does nothing.
- **Dynamic songs react to the game.** Every frame, `dashMusicTick()` sends a small state object to `DashAudio.state()`: boss state, attack and wave; vortex lives, state and stability; the cutscene clock. Each song's `react()` turns that into musical changes:
  - **Layers:** switched on or off on the beat. They come in sharply and fade out gently.
  - **Sections:** changed at the next bar, or the next beat for urgent moments.
  - **One-shots:** short hits such as a riser for a dive.

  When the music jumps, notes still ringing from the old section fade out.
- **Cutscene cues** have one section per scene, sized from the scene's frame times. They follow the cutscene clock and jump ahead if they fall behind the picture.
- **Two audio contexts.** Music and menu sounds run in one context; game sounds run in the other, which freezes when the game is paused. Pausing muffles the music.
- **Lite mode.** The game's "Low graphics" setting also switches on lite mode, which drops the heaviest extra parts for slower devices.
- **Testing.** The sound-test page (`_sound-test/`, run a local server from the repo root) plays every song, section, boss state and effect, and can save any song as a WAV. `export-music.py` there exports the whole soundtrack as WAV/MP3. Jekyll skips underscore folders, so it isn't published on the site.

**To add or change a song:**
1. Write it in `dash-music.js` with `song(name, {...})`.
2. Route it in `dashMusicTrack()`.
3. Add its slot to `DASH_MUSIC` in `index.html`.
4. Add it to `SONGS` in the sound-test page.

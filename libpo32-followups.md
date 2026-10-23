# libpo32 follow-ups

Issues found while testing libpo32 v0.3.0 (`3b3a0a7`) against a real PO-32 Tonic. Each one could become an upstream issue or PR at https://github.com/ericlewis/libpo32.

As of 10.22, none of these are filed upstream, and the repo has no issues at all. `3b3a0a7` is the latest main (0.3.0 plus a README change). Open PR [#20](https://github.com/ericlewis/libpo32/pull/20) corrects the synth's attack, pitch modulation, and EQ gain maps against Microtonic, which matters for browser playback accuracy. Worth picking up if it merges.

## Rendered transfers end too early for the Tonic

The Tonic shows err at the end of every transfer rendered by `po32_render_dpsk_f32` with `po32_render_sample_count` samples. The packets do arrive: a lone pattern packet briefly shows its slot (p08) before the err.

- The rendered audio stops on the last bit of the final tail. libpo32's own decoder handles that since 0.3.0 by resolving the pending symbol at end of audio, but the Tonic's receiver doesn't.
- The Tonic's own transfers keep the carrier running for about 25 ms (roughly 30 symbols) after the tail.
- Appending 4 bytes of `0x55` to the frame after the final tail, before rendering, fixes it. A lone pattern packet, with no state packet, is then accepted.
- Ruled out along the way: packet contents (the Tonic's own pattern packet, re-rendered, still errored), preamble length (padding to the Tonic's ~256 bytes made no difference), and the playback path (a recorded Tonic backup played the same way restored fine).

Repro: `phase0/build/frame` with `TRAIL=0` errors, and with the default `TRAIL=4` works. Test setup was a MacBook headphone out at 75% volume, a plain stereo cable, and the Tonic in receive mode (acc + sound).

Likely fix: have `po32_builder_finish` or `po32_render_sample_count` add a short carrier postamble, or document that callers need one.

## Sounds need a pattern and a state packet

Not a libpo32 bug, but worth documenting there. The Tonic shows err for a transfer of patch packets alone, patches + state, or patches + pattern. Patches + pattern + state works. A lone pattern packet works.

## Chains longer than 16 are rejected

The state packet's chain holds up to 64 entries (the guide allows chaining 64 patterns), but the typed state decode rejects `pattern_count` over 16 (`PO32_PATTERN_STEP_COUNT`). TE's full backup WAV has a 22-entry chain that hits this.

## Reserved pattern bytes hold effects

The 16 bytes libpo32 writes as zeros near the end of the pattern payload carry recorded effects. A pattern with effect 12 (beat-repeat faster) recorded had `02 02 02 02 00 00 00 72` followed by zeros there. It's one byte per step, and zero means no effect. Until it's decoded, an encoder that zeroes these bytes drops a pattern's effects.

Effects recorded live (hold FX + key in rec mode) on the downbeats of one pattern, captured from the Tonic:

| Step | Effect | Byte |
| --- | --- | --- |
| 1 | 1 half rate | `04` |
| 1 | 4 echo fade | `0e` |
| 1 | 8 pitch bend up | `05` |
| 1–4 | 12 beat-repeat faster (and `72` on step 8) | `02` |
| 5 | 2 distortion | `4a` |
| 5 | 6 eq sweep | `4d` |
| 5 | 9 punch | `48` |
| 9 | 3 squash | `89` |
| 9 | 7 mega morph | `85` |
| 9 | 10 6/8 quantize | `10` |
| 13 | 5 pitch lfo | `c6` |
| 13 | 11 beat-repeat | `c1` |

The top 2 bits usually match the step's beat (0–3), but not always (`10` on step 9), and effects 7 and 8 share a low value of 5. So the byte carries more than the effect number, possibly timing or a parameter. Effect 8 on step 13 recorded as `00` in one pass. Live recording makes it hard to be sure exactly what landed where.

## Step morph values in the pattern editor

For each active step, the Tonic stores the sound's own morph pair (for example `36 04` for the factory kick). `po32_pattern_editor` writes a fixed `80 01`. The Tonic accepts it, but the hit may not sound like the Tonic's own entry would.

The pair's first byte is called `flag` in `po32_morph_pair_t`, but in Tonic captures both bytes vary over the full 0–255 range, as two knobs would (pitch and morph is the likely pair). Worth confirming, then renaming the field.

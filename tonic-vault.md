# Tonic vault handoff brief

A browser app for pulling patterns and sounds off a Teenage Engineering PO-32 Tonic, keeping them as a named, tagged library, playing them back on a phone, and sending a composed set of patterns back to the device. "Tonic vault" is a working name.

Mobile-first UI mock (5 screens): https://claude.ai/artifact/CJmNnTwcJKDoKu27wvA2zb. `tonic-vault-mock.zip` is a snapshot of the same files.

## Foundation

[ericlewis/libpo32](https://github.com/ericlewis/libpo32) (MIT, freestanding C99) already implements the transfer protocol. It's a submodule at `vendor/libpo32`, pinned to `ad6bc7a`: v0.3.0 plus open PR [#20](https://github.com/ericlewis/libpo32/pull/20), whose synth fixes turn the factory kicks from a pitch sweep back into kicks. Move back to a release once it merges.

- Packet build and parse for patch, pattern, state, knob, and reset packets. An erase tag (`0xB892`, 1-byte payload) is known but has no typed helper yet.
- A DPSK modem renderer and decoder.
- The 21-parameter drum synth.
- `po32_decode_capture <in.wav> <out-dir>` dumps packets from a transfer WAV. It takes any sample rate and mixes stereo down to mono.

Plan: compile it to WASM and use it for decode, encode, and in-browser playback. Read `core/docs/PROTOCOL.md` and `PATCH_PARAMETERS.md` first.

## Device model (what we store)

- **Sounds:** the 16 sounds on the device. Only one set of 16 is on the Tonic at a time. The vault saves each distinct set of 16 as a sound set. Each sound has left/right patch endpoints, and the morph knob blends between them.
- **Pattern:** 16 steps × 4 lanes, plus per-step morph pairs (parameter locks) and an accent bitmask. Each pattern packet carries its own slot number.
  - Every hit stores the two knob bytes it was recorded with, not only locked ones. The app reads them as pitch then morph, following libpo32's name for the second byte; that order hasn't been checked by ear yet. A hit whose bytes differ from that sound's most common bytes in the pattern shows as a parameter lock.
  - Lanes are channel columns: sounds 1/5/9/13, 2/6/10/14, 3/7/11/15, and 4/8/12/16. Only one sound per lane can fire on a step.
  - Each trigger byte's low nibble is the step multiplier (hold step + m), stored as the number the Tonic shows: t-01, t-02, t-03, t-04, t-06, and t-08 are 1, 2, 3, 4, 6, and 8. libpo32 calls it `fill_rate`.
  - There are 16 reserved bytes that libpo32 writes as zeros.
- **State:** tempo (one byte), swing (0–18; the Tonic shows S00–S18; libpo32 calls it `swing_times_12`), morph defaults, and the chain as a list of zero-based pattern numbers, repeats included. libpo32's typed decode rejects lists longer than 16, so longer chains need a fix there or raw parsing. **Tempo and swing are global on the device.** In the vault they're per-pattern fields the user sets in pattern detail. Import fills them from the state packet as a starting value.

## Data model (initial)

The vault is a single JSON document. It lives in localStorage and can be downloaded and loaded as a `.json` file. Transfer audio is never persisted by the app.

```json
{
	"version": 1,
	"soundSets": [ { "id": "<hash>", "name": "factory", "sounds": [ /* base64 patch payloads */ ], "soundNames": [ "kick 1", /* 16 in all, "" when unknown */ ], "knobs": "<base64 morph pairs from the last state packet>", "firstSeen": "", "lastSeen": "" } ],
	"patterns": [ { "id": "<hash>", "name": "", "tags": [], "bpm": 120, "swing": 6, "soundSetId": "<hash>", "slot": 9, "firstSeen": "", "lastSeen": "", "raw": "<base64 payload>" } ],
	"tonic": { "seen": "", "soundSetId": "<hash>", "slots": [ /* 16 pattern ids or null */ ], "tempo": 120, "swing": 6, "chain": [ 1, 2 ] },
	"export": { "slots": [ /* 16 pattern ids or null */ ], "pending": [ /* ids waiting for a slot */ ], "soundSetId": null, "sendState": false }
}
```

- A pattern's `id` is a hash of its normalized pattern bytes, excluding the slot number. A sound set's `id` is a hash of its 16 normalized patches.
- On import:
  - An unknown hash becomes a new entry.
  - A known hash in a different slot only updates `slot` and `lastSeen`.
- `soundSetId` records which sounds were loaded at capture time. There is no per-pattern sound tracking beyond that.
- The app only knows what was on the Tonic as of the last import, so the UI says "last on tonic" rather than "on tonic".
- Store the raw payload so the format can evolve without re-importing.

## UX requirements (see mock)

Import and export are named from the app's side. On import the Tonic sends ("transfer data") and the app listens. On export the app sends and the Tonic receives ("receive data").

- **Import** (Tonic: write + sound):
  - Choose cable (Tonic line out → mic in) or over the air.
  - Choose the input device.
  - Ask for the Tonic's volume at 16 (hold bpm, press 16), the most reliable level. It resets whenever a cable is plugged in or the Tonic restarts.
  - Tap listen in the app first, then start the transfer on the Tonic.
  - Show live level, stage progress, and errors.
  - On the results screen, show new / known / sounds match and prompt to name only new patterns.
- **Export** (Tonic: acc + sound):
  - Compose the patterns to send on a 4×4 slot grid. The user picks the slot for each pattern. Gaps are fine, and nothing is auto-stacked from slot 1. Empty slots aren't sent, and the Tonic keeps what's in them.
  - Slots that won't be sent show, dimmed, what was last on the Tonic there. Filled slots show what they'll replace.
  - Optionally include the sounds. The Tonic only accepts sounds followed by at least one pattern and a state packet, so including sounds also sends tempo, swing, and the chain.
  - Tempo, swing, and chain are one optional toggle, since a lone pattern lands fine without them and sending them replaces the Tonic's chain. Tempo and swing come from slot 1's pattern, and the chain defaults to the sent slots in order. The toggle is forced on when sounds are included.
  - Choose cable or speaker.
  - Put the Tonic in receive mode first, then tap send in the app.
  - Show progress with a stop button.
  - Offer a "download backup .wav" for later restore from any recording device. It's generated on demand and not stored.
- **Library:**
  - Pattern list with a 16-step mini strip, bpm/swing, new badge, and play button. Filter by new or by tag.
  - Multi-select to delete or add to export. Adding several puts each in its original slot, and asks for a slot only when that one is already taken in the export.
  - Saved sound sets below the patterns, with rename, delete, and a 4×4 grid to audition any one set (the set last seen on the Tonic at first).
  - Save/load `.json` at the top. Links to TE's PO-32 guide and sound packs.
- **Pattern detail:** a sound-rows × 16-step grid showing hits, parameter locks, multipliers (the number on the hit), an accent row, an effects row, and the playhead. Name, tags, editable bpm/swing, delete.
  - Effects show only which steps have one, until the effect bytes are decoded. Playback doesn't reproduce effects, and the screen says so.
  - "Add to export" opens a slot picker with the pattern's last slot preselected and slots already taken in the export marked.
- **Style:** follow TE's PO-32 guide aesthetic: ochre ground, light hairlines, and thin lowercase type. Text and icons are cream instead of the guide's grey for contrast. Use the guide's own held key, pressed key, mic, and jack artwork, since it matches the device's buttons.
- **Terms:** use the PO-32 guide's words for everything on the device: sounds, pattern, slot, accent, tempo, swing, multiplier, parameter lock, chain, transfer data, receive data, receive mode, backup, and restore. Button combos are written as the guide writes them ("press write + sound"). Each sound set stores its own 16 sound names. A factory set (recognized by its sound set id, which matches the test fixture's) starts with the guide's names, such as "shaker / zap" and "close / open hi-hat". Sound packs publish no names, so their sounds go by number (1–16) until named. Editing the names could come later.

## Phases

0. **Prove the protocol on the device.** Short, throwaway experiments against a real Tonic, run before building anything, to answer what the docs can't. Not done until each question has a recorded answer.
   - Record the Tonic's own transfer and decode it, over the air first, then over a cable. Run `phase0/capture.sh <name> [seconds]`, then press write + sound on the Tonic. It records a fixed window (30s by default) and decodes into `phase0/captures/<name>/`. A full transfer takes about 35s, so use 90 when starting it by hand. `phase0/build/diag` shows where the demodulator syncs and loses lock, and `HEX=1` prints each packet's payload, which recovers packets from a capture that lost lock partway.
     - Over the air into a MacBook mic (10.22): the preamble demodulated cleanly but the data didn't, so no packets. The same mic decoded libpo32's own render from the Mac's speakers.
     - TE's downloadable transfer WAVs decode with libpo32 (12 of 13), and their preamble is the same length as the Tonic's (about 256 bytes, versus libpo32's 124), so the format matches. The capture failed on signal quality.
     - Over a cable into the MacBook combo jack (10.22): all 49 packets decoded on the first try. See Connecting the Tonic for the cable.
   - What one send contains: 32 patch packets (16 sounds × left/right), all 16 patterns (empty ones included), and one state packet. Confirmed on the Tonic, and TE's full backup WAV matches. TE's sound pack WAVs carry 16 patch packets, one pattern for slot 1, and a state packet that sets tempo.
   - Sending to the Tonic works over a plain stereo cable from the Mac's headphone out, at 75% Mac volume. Playing a captured backup WAV restores it.
     - libpo32's rendered audio stops on the final tail's last bit, and the Tonic shows err at the end of the transfer. The Tonic's own transfers keep the carrier going for about 25 ms after the tail. Appending 4 bytes of `0x55` after the tail fixes it. The preamble length doesn't matter.
     - A single pattern packet, with no sounds or state packet, is accepted. The Tonic shows "end" on success and "err" on failure.
     - Sounds need a pattern and a state packet after them. Sounds alone, sounds + state, and sounds + pattern all show err. Sounds + pattern + state works, which is also the shape of TE's sound packs.
   - Slots that aren't sent are left untouched. Sending only pattern 8 changed pattern 8 and nothing else, including the sounds.
   - `fill_rate` is the multiplier (see Device model). Confirmed with steps set to each value.
   - Find out whether recorded effects appear in the 16 reserved bytes. In the first Tonic capture only slot 9's are nonzero (`02 02 02 02 00 00 00 72`, then zeros), Slot 9 has effect 12 (beat-repeat faster) recorded, so this is effect data. It's one byte per step, and zero means no effect. The value doesn't map cleanly to the effect number; see `libpo32-followups.md` for the captured data. This doesn't block Phase 1. The vault stores the raw payload and resends these bytes unchanged, and pattern detail can already show which steps have an effect.
   - Chains are transferred, in the state packet (see Device model). The first Tonic capture's chain was a single pattern (6).
1. **Import.** WASM build of libpo32, then browser capture → decode → dedupe → vault JSON. Working: a full Tonic transfer imported in Chrome on 10.22 (`web/`, served at https://tonic-vault.test).
2. **Library and playback.** The screens from the mock, with playback through the WASM synth. Installable as a PWA so it works on a phone.
   - Working: the library (`index.html`) and pattern detail (`pattern.html`), with sounds you can audition and patterns that loop through libpo32's synth. Morph, accents, multipliers, and the four channels cutting off their own hits all play. Pitch locks, effects, and add to export don't yet.
   - The library asks the browser to keep its storage (`navigator.storage.persist()`) and, once a pattern has gone a week without a .json save, says how many patterns aren't backed up. Saving records `savedAt` in the vault and the file, and loading a file counts as saved.
   - Swing and multiplier timing were measured from line-out recordings on 10.25. Swing delays odd steps by swing/24 of a step (ticks of a 96 ppqn clock). A multiplier's repeats stay a straight step/multiplier apart from the swung hit, and the next hit on the channel cuts off the rest.
   - Still to do: checking playback against the Tonic by ear (slot 2 has a new pattern from 10.23 to compare after the next import).
3. **Export.** Compose the patterns to send, render the transfer audio, play it into the Tonic, and download it as a WAV.
   - Built (`export.html`): the slot grid, sounds and tempo/swing/chain options, send with progress and stop, and the backup .wav. "Add to export" in the library and pattern detail puts patterns in their last slot, or queues them for the export screen to place when that slot is taken. A test renders an export and decodes it back to the same packets.
   - Worked on the Tonic on 10.24: three patterns sent over the cable to its line in. Not built: editing the chain (it's the sent slots in order).
   - Sending the state packet also sets the Tonic's knob positions. They come from the sound set's last state packet, which the vault only stores from imports made after 10.23; without one, libpo32's defaults are sent.
4. **MIDI and sharing.** Next after hosting, in this order:
   - Done: download or share a pattern's .mid from the pattern page. It's one bar at 480 ticks per quarter note on channel 1, ending exactly on the bar so a DAW loops it at one bar. Sounds 1 to 16 play notes 36 to 51 (C1 up, the drum pad layout), accents set velocity, multipliers become repeated hits, and swing is baked into note timing. Parameter locks and effects are left out so the file stays plain.
   - Done: measure the Tonic's swing from a line-out recording, so playback and MIDI use its real timing.
   - Done: render four bars of a pattern to .wav, to download or share.
   - Done: share links. The pattern page's link button, below the pattern, copies (or on a phone, shares) `pattern.html#<fragment>`. The fragment carries the pattern payload, name, bpm, and swing as length-prefixed bytes in base64url, about 300 characters. Links always play with the factory sound set, which ships in `factory.js` (taken from the fixture), and a pattern on other sounds says so under the button. Opening a link plays the pattern and offers its .mid and .wav without touching the vault until "save to my vault", which imports it like a transfer so it keeps the pattern id it has in the sender's vault. Sharing a sound set is a separate feature for later.
5. **Later.** Editing the chain on export, decoding the effect bytes, naming a sound pack's sounds, playing pitch locks in the browser, and rendering a pattern's sounds as one-shot .wav files to load into a DAW's drum pads.
6. **Someday.** Sync to a WordPress plugin over the REST API, served to a logged-in user with cookie + nonce auth so no secrets end up in the bundle.

## Development

- `make -C phase0` builds libpo32's decoder, demo, and pattern editor natively with clang. cmake isn't needed.
- `phase0/build/frame <tag-hex>:<payload.bin> ...` builds a transfer from raw packet payloads (such as the `payload.bin` files `po32_decode_capture` writes) and prints 48 kHz f32 audio. Pipe it through `sox -t f32 -r 48000 -c 1 - -b 16 out.wav gain -3`, then `play out.wav` with the Tonic in receive mode.
- The pinned libpo32 commit is only on the PR, so a fresh clone needs `git -C vendor/libpo32 fetch origin pull/20/head` before `git submodule update`.
- `make -C web` builds `po32.wasm` (decoder, synth, and encoder), and `make -C web test` runs the node tests against the fixture below. The app is static files in `web/`: `index.html` (library), `import.html`, `export.html`, `pattern.html`, and `about.html`.
- Pushes to `main` run `.github/workflows/pages.yml`, which builds and tests `po32.wasm` with Ubuntu's clang and lld (`CLANG` and `WASM_LD` override the Homebrew paths) and deploys `web/` to https://ironprogrammer.com/tonic-vault/. `web/sw.js` serves from the network first and falls back to its cache offline.
- `tests/fixtures/tonic-backup-2026-10-22.wav` is a real Tonic backup (cable, 48 kHz mono, 49 packets) so decode work doesn't need a fresh transfer each time. New captures land in the gitignored `phase0/captures/`.

## Connecting the Tonic

The Tonic has 3.5mm stereo line in and line out. It also has a built-in speaker and microphone for over-the-air transfers.

- **Import (Tonic line out → device input):** a plain stereo cable into a combo headphone/mic jack only registers as headphones, so the device gets no input. Use one of these:
  - A TRRS headset splitter, plugging the Tonic's cable into the splitter's mic side. Works with a MacBook's combo jack, and with an iPhone through Apple's USB-C (or Lightning) to 3.5mm adapter, which accepts headset mics.
  - A 4-pole headphone cable (the kind with an inline mic, 4-pole plugs on both ends) from the Tonic's line out into a MacBook combo jack. macOS shows it as "External Microphone". Transfers decoded at Tonic volume 12 to 16 (peaks around 15% and up). At 8% peak the decoder lost lock partway, and at volume 4 the signal was close to silent.
  - A USB audio interface with a line input, on a computer or on an iPhone over USB-C. This is the most reliable option.
- **Export (device output → Tonic line in):** a plain 3.5mm stereo cable from the headphone output. On an iPhone, add the USB-C (or Lightning) to 3.5mm adapter.
- **Volume:** the Tonic resets its volume whenever a cable is plugged in or it restarts, so check it before every transfer.
- **Sync mode:** leave the Tonic in SY0, the default. Other sync modes use one channel of line in or out for a sync pulse.

## Footguns

- **Browser audio processing:** browsers apply echo cancellation, noise suppression, and auto gain to mic input by default. Request input with all three off, or the modem signal gets mangled.
- **Sample rate:** the decoder takes the rate as a parameter. A 44.1 kHz demo frame resampled to 48 kHz stereo decoded to identical bytes, so pass the AudioContext rate through rather than resampling.
- **Sounds need company:** a transfer with sounds must also carry a pattern and a state packet, or the Tonic shows err.
- **Trailing carrier:** append about 4 bytes of carrier after the final tail when rendering, or the Tonic rejects the transfer at the very end (see Phase 0).
- **Untested inputs:** the over-the-air path and phone capture are less reliable. Get the cable path working first.

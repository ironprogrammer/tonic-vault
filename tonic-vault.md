# Tonic vault handoff brief

A browser app for pulling patterns and sounds off a Teenage Engineering PO-32 Tonic, keeping them as a named, tagged library, playing them back on a phone, and sending a composed set of patterns back to the device. "Tonic vault" is a working name.

Mobile-first UI mock (5 screens): https://claude.ai/artifact/CJmNnTwcJKDoKu27wvA2zb. `tonic-vault-mock.zip` is a snapshot of the same files.

## Foundation

[ericlewis/libpo32](https://github.com/ericlewis/libpo32) (MIT, freestanding C99) already implements the transfer protocol. It's a submodule at `vendor/libpo32`, pinned to v0.3.0.

- Packet build and parse for patch, pattern, state, knob, and reset packets. An erase tag (`0xB892`, 1-byte payload) is known but has no typed helper yet.
- A DPSK modem renderer and decoder.
- The 21-parameter drum synth.
- `po32_decode_capture <in.wav> <out-dir>` dumps packets from a transfer WAV. It takes any sample rate and mixes stereo down to mono.

Plan: compile it to WASM and use it for decode, encode, and in-browser playback. Read `core/docs/PROTOCOL.md` and `PATCH_PARAMETERS.md` first.

## Device model (what we store)

- **Sounds:** the 16 sounds on the device. Only one set of 16 is on the Tonic at a time. The code calls a saved set a "kit"; the UI always says "sounds". Each sound has left/right patch endpoints, and the morph knob blends between them.
- **Pattern:** 16 steps × 4 lanes, plus per-step morph pairs (parameter locks) and an accent bitmask. Each pattern packet carries its own slot number.
  - Lanes are channel columns: sounds 1/5/9/13, 2/6/10/14, 3/7/11/15, and 4/8/12/16. Only one sound per lane can fire on a step.
  - Each trigger byte has a 1–15 `fill_rate` in its low nibble, most likely the guide's step multiplier (hold step + m). Phase 0 confirms it.
  - There are 16 reserved bytes that libpo32 writes as zeros.
- **State:** tempo (one byte), swing (stored as swing × 12), morph defaults, and a list of up to 16 pattern numbers. Chains can hold up to 64 patterns, so that list probably isn't the chain. **Tempo and swing are global on the device.** At import, the current value is saved onto each new pattern's metadata so browser playback is accurate. The user can edit it per pattern. There's no "intended tempo" concept.

## Data model (initial)

The vault is a single JSON document. It lives in localStorage and can be downloaded and loaded as a `.json` file. Transfer audio is never persisted by the app.

```json
{
	"version": 1,
	"kits": [ { "id": "<hash>", "name": "factory", "sounds": [ /* 16 decoded patches + raw bytes */ ], "firstSeen": "", "lastSeen": "" } ],
	"patterns": [ { "id": "<hash>", "name": "", "tags": [], "bpm": 120, "swing": 20, "kitId": "<hash>", "slot": 9, "firstSeen": "", "lastSeen": "", "raw": "<base64 payload>" } ]
}
```

- A pattern's `id` is a hash of its normalized pattern bytes, excluding the slot number. A kit's `id` is a hash of its 16 normalized patches.
- On import:
  - An unknown hash becomes a new entry.
  - A known hash in a different slot only updates `slot` and `lastSeen`.
- `kitId` records which kit was loaded at capture time. There is no per-pattern kit tracking beyond that.
- The app only knows what was on the Tonic as of the last import, so the UI says "last on tonic" rather than "on tonic".
- Store the raw payload so the format can evolve without re-importing.

## UX requirements (see mock)

Import and export are named from the app's side. On import the Tonic sends ("transfer data") and the app listens. On export the app sends and the Tonic receives ("receive data").

- **Import** (Tonic: write + sound):
  - Choose cable (Tonic line out → mic in) or over the air.
  - Choose the input device.
  - Tap listen in the app first, then start the transfer on the Tonic.
  - Show live level, stage progress, and errors.
  - On the results screen, show new / known / sounds match and prompt to name only new patterns.
- **Export** (Tonic: acc + sound):
  - Compose the patterns to send on a 4×4 slot grid. The user picks the slot for each pattern. Gaps are fine, and nothing is auto-stacked from slot 1. Empty slots aren't sent.
  - Optionally include the sounds.
  - Send tempo/swing taken from slot 1's pattern.
  - Choose cable or speaker.
  - Put the Tonic in receive mode first, then tap send in the app.
  - Show progress with a stop button.
  - Offer a "download backup .wav" for later restore from any recording device. It's generated on demand and not stored.
- **Library:**
  - The sounds last seen on the Tonic shown in a 4×4 grid, with sounds you can audition.
  - Pattern list with a 16-step mini strip, bpm/swing, new badge, and play button.
  - Multi-select to delete or add to export.
  - Saved sounds list with delete.
  - Save/load `.json`.
- **Pattern detail:** a sound-rows × 16-step grid showing hits, parameter locks, accent row, and playhead. Name, tags, editable bpm/swing, delete.
- **Style:** follow TE's PO-32 guide aesthetic: ochre ground, light hairlines, and thin lowercase type. Text and icons are cream instead of the guide's grey for contrast. Use the guide's own held key, pressed key, mic, and jack artwork, since it matches the device's buttons.
- **Terms:** use the PO-32 guide's words for everything on the device: sounds, pattern, slot, accent, tempo, swing, multiplier, parameter lock, chain, transfer data, receive data, receive mode, backup, and restore. Button combos are written as the guide writes them ("press write + sound"). Factory sound names are the guide's, such as "shaker / zap" and "close / open hi-hat".

## Phases

0. **Prove the protocol on the device.** Short, throwaway experiments against a real Tonic, run before building anything, to answer what the docs can't. Not done until each question has a recorded answer.
   - Record the Tonic's own transfer over line in and decode it. Run `phase0/capture.sh <name>`, then press write + sound on the Tonic. It records until 2s of silence and decodes into `phase0/captures/<name>/`.
   - Confirm what one send contains: all 16 patterns? the sounds? state?
   - Re-render one pattern and send it back.
   - Find out whether slots that aren't sent are left untouched. Packets are addressed by slot, so this is likely. If not, the erase packet may be needed to clear slots on purpose.
   - Confirm `fill_rate` is the multiplier, and find out whether recorded effects appear anywhere, such as the reserved bytes.
   - Find out whether chains are transferred at all.
1. **Import.** WASM build of libpo32, then browser capture → decode → dedupe → vault JSON.
2. **Library and playback.** The screens from the mock, with playback through the WASM synth. Installable as a PWA so it works on a phone.
3. **Export.** Compose the patterns to send, render the transfer audio, play it into the Tonic, and download it as a WAV.
4. **MIDI.** Map slots to drum notes (GM by default, editable), accents to velocity, and parameter locks to CC.
5. **Later.** Sync to a WordPress plugin over the REST API, served to a logged-in user with cookie + nonce auth so no secrets end up in the bundle.

## Development

- `make -C phase0` builds libpo32's decoder, demo, and pattern editor natively with clang. cmake isn't needed.
- Keep one real Tonic capture as a test fixture so decode work doesn't need a fresh transfer from the device each time. Captures land in the gitignored `phase0/captures/`. Copy the chosen one to `tests/fixtures/` when the test suite exists.

## Footguns

- **Browser audio processing:** browsers apply echo cancellation, noise suppression, and auto gain to mic input by default. Request input with all three off, or the modem signal gets mangled.
- **Sample rate:** the decoder takes the rate as a parameter. A 44.1 kHz demo frame resampled to 48 kHz stereo decoded to identical bytes, so pass the AudioContext rate through rather than resampling.
- **Laptop input:** a plain stereo cable into a MacBook's headphone jack shows up as headphones only, with no input. Line capture needs a TRRS adapter or a USB audio interface, plus a careful input level.
- **Untested inputs:** the over-the-air path and phone capture are less reliable. Get the cable path working first.

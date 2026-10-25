# tonic vault

A browser app for the Teenage Engineering PO-32 Tonic. It imports patterns and sounds from the Tonic's transfer audio into a named, tagged library, plays patterns back through [libpo32](https://github.com/ericlewis/libpo32)'s synth, and sends a chosen set of patterns back to the device. A pattern also saves as a .mid or .wav, or goes out as a link that anyone can play or save to their own vault.

Open it at https://ironprogrammer.com/tonic-vault/ and add it to your home screen to use it offline. The library lives in your browser. Use save and load to back it up or move it to another device.

## Connecting the Tonic

To import, run a 4-pole (TRRS) cable from the Tonic's line out to a headset jack, or hold the Tonic near the mic. Set its volume to 16, start listening, and press write + sound.

To export, run a stereo cable from the computer's headphone out to the Tonic's line in, or hold the computer's speaker near the Tonic. Press acc + sound on the Tonic, then send.

Sound packs from [teenage.engineering](https://teenage.engineering/downloads/po-32) import from their .wav files.

## Development

The app is static files in `web/`, served locally by Valet at https://tonic-vault.test.

```sh
git submodule init
git clone https://github.com/ericlewis/libpo32 vendor/libpo32
git -C vendor/libpo32 fetch origin pull/20/head
git submodule update
make -C web test
```

Building `po32.wasm` needs Homebrew's `llvm` and `lld`. Pushes to `main` build, test, and deploy to GitHub Pages.

MIT licensed. PO-32 Tonic is a trademark of Teenage Engineering. This is an unofficial tool, not made or endorsed by them.

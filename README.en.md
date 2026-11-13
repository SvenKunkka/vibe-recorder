# Vibe Recorder

A small browser recorder: record a take, save it locally, play it back, and download a WAV file.

[中文](README.md) · [Download the standalone HTML](https://github.com/SvenKunkka/vibe-recorder/releases/latest/download/Vibe-Recorder.html) · [MIT License](LICENSE)

The application interface is currently **Chinese only**. No account, cloud service, or npm dependencies are required.

## Features

- Records from the browser's default microphone and displays the actual input device label.
- Produces **16-bit PCM, mono WAV** files at the sample rate of the browser's audio context.
- Preserves pauses and silence, without automatic trimming, normalization, or transcription.
- Automatically saves completed takes to a local browser library, with click-to-play history and individual WAV downloads.
- Displays elapsed time, input level, and a waveform; click the waveform to seek during playback.
- Keeps the current take available for download and retry if automatic saving fails; attempts to retain received audio when input or audio processing is interrupted.
- Stops automatically at approximately **30 minutes** per take. Takes under 10 minutes are recommended for everyday use.

## Quick start

### Standalone HTML

[Download Vibe-Recorder.html from the latest release](https://github.com/SvenKunkka/vibe-recorder/releases/latest/download/Vibe-Recorder.html) and open it in a recent Chrome or Edge browser. It includes the page, styles, and recording code; Python and Node.js are not required for this file.

When opened directly through `file://`, microphone permissions, AudioWorklet, and local storage behavior vary by browser. The complete recording flow has not been directly tested in this mode. Use the local web entry below if it does not work in your browser.

### Run the source locally

With Python 3 installed, run this from the repository root:

```sh
python3 web/server.py
```

Open **[http://127.0.0.1:8771](http://127.0.0.1:8771)**. The server binds only to the local loopback address and serves static files; it does not accept audio uploads. Keep its window running while using the application. Press `Ctrl+C` to stop the server.

The repository also includes `启动自用录音库.command` for macOS and `启动自用录音库-Windows.bat` for Windows. These launchers also require Python 3.

## Record and play back

1. Select your default microphone in system and browser settings.
2. Click 「允许麦克风」 (Allow microphone) or 「开始录音」 (Start recording), grant permission, and check the displayed input label.
3. Click 「停止并生成 WAV」 (Stop and generate WAV), then wait for 「已保存到录音库」 (Saved to library).
4. Click a take under 「我的录音」 (My recordings) to play it, or use 「下载 WAV」 (Download WAV) to save a separate file.

The page has no device picker. After changing your default microphone, click 「重新连接」 (Reconnect) and check the label again. Reconnecting releases the previous stream before requesting the browser's current default input. After a normal stop, the authorized input can be reused; click 「断开麦克风」 (Disconnect microphone) to release it while idle.

Keep the computer awake and the page open during recording. A take enters the library only after recording stops and saving succeeds; an ongoing recording is not continuously persisted.

## Where recordings are stored

Audio and metadata are stored in the current browser's **IndexedDB**. The application has no audio upload, transcription, account, or cloud synchronization feature. The local web server does not receive recordings.

- Accessing an existing library requires the same browser, browser profile, and page origin. An origin consists of the scheme, hostname, and port.
- When using the local server, keep using the exact same address. For example, `http://127.0.0.1:8771`, `http://localhost:8771`, another port, and an HTTPS address have separate storage.
- Switching browsers, opening a private window or downloaded HTML file, or copying the HTML to another computer does not migrate an existing library.
- **The HTML file contains no recordings.** Sharing or backing up the application file does not share or back up the library.
- Clearing site data, deleting a browser profile, or browser storage eviction can remove recordings. Private browsing generally does not retain data long term.
- Automatic saving can fail when browser storage is full. Download the current WAV first, then retry saving as appropriate. A new take does not replace existing takes.

**Download and separately back up important WAV files.** The browser library is convenient for playback but does not replace an independent file backup. Existing recordings made through the local server remain accessible using their original browser, profile, and exact URL.

## Audio and compatibility

The application requests that echo cancellation, noise suppression, and automatic gain control be disabled, then converts the received mono audio to PCM16. The browser, operating system, driver, or device may still process or resample audio. Device-native, bit-perfect capture and a fixed sample rate are not guaranteed.

| Scope | Verification |
| --- | --- |
| Chrome on macOS, using the local web entry | Recording, automatic saving, and library playback were tested in practice |
| Windows, Edge, other browsers, or mobile devices | Actual recording has not been tested in those environments |
| Downloaded HTML opened directly through `file://` | Complete flow not directly tested; permissions and storage depend on the browser |
| Automated tests | Use synthetic audio and simulated browser objects; they do not establish platform recording compatibility |

The browser needs `getUserMedia`, AudioWorklet, IndexedDB, and microphone permission. A local loopback address or HTTPS is the recommended entry point.

## Development and build

No npm installation step is needed:

```text
web/                     Page, styles, recording, and local storage modules
Tests/library-flow.mjs   Default input, reconnect, saving, and playback tests
Tests/web-audio.mjs      PCM conversion, silence preservation, and WAV tests
build-web.py            Standalone HTML builder
```

Build the standalone file with Python 3:

```sh
python3 build-web.py
```

The output is `dist/Vibe-Recorder.html`, suitable for distribution as a GitHub Release asset. Building bundles application resources only; it does not read or embed browser recordings.

Tests require Node.js 22 or later:

```sh
node Tests/library-flow.mjs
node Tests/web-audio.mjs
python3 build-web.py
node Tests/check-bundle.mjs
```

The audio test generates a synthetic WAV verification file in `outputs/`. Test outputs are not included in release assets.

## License

Released under the [MIT License](LICENSE). Report problems through [Issues](https://github.com/SvenKunkka/vibe-recorder/issues), including the browser, operating system, entry method, and reproduction steps. Please avoid attaching private recordings or sensitive device information.

# YapSkippr

YapSkippr is a YouTube-focused browser extension prototype for detecting likely in-video sponsorship and ad-read segments.

V1 is detection-only. It samples local video frames, crawls available YouTube caption tracks, fuses evidence into candidate segments, logs progress to the page console, and shows a compact status block near the YouTube player. It does not auto-skip.

## Development

```bash
npm install
npm run dev
```

Build Chrome/Chromium:

```bash
npm run build
```

Build Firefox:

```bash
npm run build:firefox
```

Build local install artifacts for Chrome/Chromium and Firefox:

```bash
npm run build:installable
```

This creates:

- Chrome/Chromium unpacked extension: `.output/chrome-mv3`
- Chrome/Chromium upload ZIP: `.output/installable/yapskippr-chrome.zip`
- Firefox temporary add-on folder: `.output/firefox-mv2`
- Firefox ZIP and XPI-style archive: `.output/installable/yapskippr-firefox.zip` and `.output/installable/yapskippr-firefox.xpi`

Chrome/Chromium local install:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select `.output/chrome-mv3`.
4. Open the YapSkippr extension popup, click "Grant frame capture access" if shown, then reload the YouTube video tab.

Firefox local install:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on...".
3. Select `.output/firefox-mv2/manifest.json`.

Run unit tests:

```bash
npm test
```

## Privacy

Frame samples, transcript cues, and detection results stay inside the browser. The extension has no backend and does not upload video data.

YapSkippr declares the broad `<all_urls>` host permission because browser APIs require it for automatic `tabs.captureVisibleTab()` frame sampling. The content script is still scoped to YouTube URLs, and captured frames are processed locally.

If Chrome reports `Either the '<all_urls>' or 'activeTab' permission is required`, the extension has not been granted runtime host access yet. Open the YapSkippr popup, grant frame capture access, and reload the YouTube tab.

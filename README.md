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

Run unit tests:

```bash
npm test
```

## Privacy

Frame samples, transcript cues, and detection results stay inside the browser. The extension has no backend and does not upload video data.

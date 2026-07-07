<p align="center">
  <img src="public/icon-128.png" alt="YapSkippr logo" width="96" height="96">
</p>

<h1 align="center">YapSkippr</h1>

<p align="center">
  A local-first browser extension for detecting likely in-video sponsorship and ad-read segments on YouTube.
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome%20%2F%20Chromium-MV3-1f6feb">
  <img alt="Firefox MV2" src="https://img.shields.io/badge/Firefox-MV2-ff7139">
  <img alt="Status" src="https://img.shields.io/badge/status-v1%20detection--only-2da44e">
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local--first-6f42c1">
</p>

---

## Overview

YapSkippr analyzes the YouTube video you are currently watching and surfaces candidate ad-read segments. V1 is intentionally detection-only: it finds likely sponsorship windows, logs progress, and gives you jump actions, but it does not auto-skip or modify playback on its own.

The extension combines frame analysis and transcript signals so future versions can evolve toward more accurate, service-aware ad-read detection without tying the core logic to YouTube forever.

## What It Detects

| Signal | Source | Purpose |
| --- | --- | --- |
| Progress bars | Sampled video frames | Catches creator-made sponsor timers, overlays, and visual ad-read UI. |
| QR codes | Sampled video frames | Flags common sponsor call-to-action visuals. |
| Visible HTTP(S) links | Sampled video frames | Uses native browser text detection when available to find displayed sponsor links. |
| Transcript cues | YouTube caption tracks | Looks for spoken phrases that suggest an ad-read starts or ends. |

When evidence is found, YapSkippr fuses the signals into candidate segments and shows the result in the extension popup and near the YouTube player.

## Current Experience

- Live popup dashboard with scan phase, sampled frame count, video timing, evidence counts, candidate segments, and recent activity.
- Fast pre-scan mode that keeps analyzing the current YouTube tab every 1-5 seconds after the popup closes.
- Candidate jump actions for quickly seeking to detected segment start times.
- Lightweight status block mounted near the YouTube player.
- Console logging for lower-level debugging while the detector is still evolving.
- Chrome and Chromium support first, with a Firefox build available for local testing.

## How It Works

```text
YouTube page
  -> content script mounts scan UI and reads page metadata
  -> transcript provider loads available caption tracks
  -> frame sampler captures visible video frames
  -> detectors extract transcript, progress-bar, QR, and visible-link evidence
  -> evidence fusion creates candidate ad-read segments
  -> popup and page UI receive live status snapshots from extension storage
```

The code is split so new streaming services can be added through platform adapters instead of rewriting the detection pipeline.

## Install From Source

Install dependencies:

```bash
npm install
```

Build ready-to-install browser artifacts:

```bash
npm run build:installable
```

This creates:

| Browser | Local install target | Packaged artifact |
| --- | --- | --- |
| Chrome / Chromium | `.output/chrome-mv3` | `.output/installable/yapskippr-chrome.zip` |
| Firefox | `.output/firefox-mv2/manifest.json` | `.output/installable/yapskippr-firefox.zip` and `.output/installable/yapskippr-firefox.xpi` |

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `.output/chrome-mv3`.
5. Open a YouTube video, click the YapSkippr extension icon, grant frame capture access if prompted, then reload the YouTube tab.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select `.output/firefox-mv2/manifest.json`.

## Development

Start the Chrome development build:

```bash
npm run dev
```

Start the Firefox development build:

```bash
npm run dev:firefox
```

Build production bundles:

```bash
npm run build
npm run build:firefox
```

Run checks:

```bash
npm test
npm run typecheck
npm run test:e2e
```

## Project Structure

```text
src/
  core/analysis/        Detector logic for frames, QR codes, links, transcripts, and fusion.
  core/scan-status.ts   Shared scan status model used by the page UI and popup.
  entrypoints/          WXT extension entrypoints for background, popup, and YouTube content script.
  platform/youtube/     YouTube-specific routing, metadata, and transcript integration.
  ui/                   Popup, page status, badge, logging, and candidate presentation helpers.
tests/
  unit/                 Detector, parser, status, and UI-model coverage.
  e2e/                  Build-output smoke coverage.
scripts/
  build-installable.mjs Local packaging helper for Chrome and Firefox artifacts.
```

## Privacy And Permissions

YapSkippr is local-first. Frame samples, transcript cues, and detection results stay inside your browser. The extension has no backend and does not upload video data.

The extension declares broad `<all_urls>` host access because browser APIs require either `<all_urls>` or `activeTab` for automatic `tabs.captureVisibleTab()` frame sampling. The content script itself is scoped to YouTube pages, and captured frames are processed locally.

If Chrome reports `Either the '<all_urls>' or 'activeTab' permission is required`, open the YapSkippr popup, grant frame capture access, and reload the YouTube tab.

## Limitations

- V1 only detects likely ad-read segments; it does not auto-skip.
- YouTube is the only supported video platform right now.
- Visible-link detection depends on the browser's native text detection API. Browsers without that API simply skip the visible-link cue.
- Firefox builds are available, but Chrome and Chromium are the primary target for the first implementation pass.

## Roadmap

- Improve candidate scoring with more real-world sample videos.
- Add richer on-player visualization for candidate windows.
- Add optional skip controls once detection quality is high enough.
- Introduce more platform adapters for additional streaming services.
- Add persisted scan history and user feedback controls for tuning detection.

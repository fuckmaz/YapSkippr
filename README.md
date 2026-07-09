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
  <img alt="Status" src="https://img.shields.io/badge/status-feedback--trained%20v1-2da44e">
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local--first-6f42c1">
</p>

---

## Overview

YapSkippr analyzes the YouTube video you are currently watching and surfaces candidate ad-read segments. V1 remains detection-only: it finds likely sponsorship windows, logs progress, gives you jump actions, and accepts feedback, but it does not auto-skip or modify playback on its own.

The extension combines frame analysis and transcript signals so future versions can evolve toward more accurate, service-aware ad-read detection without tying the core logic to YouTube forever.

YapSkippr now also includes a self-improving, non-LLM recognition loop. The extension still generates evidence with deterministic detectors, then optionally applies a promoted JSON logistic model fetched from your own server. Admin-reviewed feedback produces training examples; trained models are promoted manually before browser clients use them.

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
- Basic and detailed popup modes. Detailed mode shows raw evidence history, source-specific activity, and feedback controls.
- Fast pre-scan mode that keeps analyzing the current YouTube tab every 1-5 seconds after the popup closes.
- Candidate jump actions for quickly seeking to detected segment start times.
- Lightweight status block mounted near the YouTube player with evidence counts and clickable candidate timecodes.
- Console logging for lower-level debugging while the detector is still evolving.
- Optional feedback API integration with v2 payloads that include candidate features, evidence snapshots, transcript context, and model metadata.
- Admin-only server dashboard for reviewing feedback, training models, inspecting metrics, and promoting or rolling back model artifacts.
- Chrome and Chromium support first, with a Firefox build available for local testing.

## How It Works

```text
YouTube page
  -> content script mounts scan UI and reads page metadata
  -> transcript provider loads available caption tracks
  -> frame sampler captures visible video frames
  -> detectors extract transcript, progress-bar, QR, and visible-link evidence
  -> evidence fusion creates candidate ad-read segments
  -> optional promoted model recalibrates candidate confidence
  -> popup and page UI receive live status snapshots from extension storage
  -> reviewed feedback trains the next JSON model artifact on your server
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
npm run test:server
npm run test:dashboard
npm run typecheck:server
```

### Transcript Phrase Tuning

Transcript ad-read cues are configured in `DEFAULT_TRANSCRIPT_PHRASE_GROUPS` inside `src/core/analysis/transcript-analyzer.ts`. Each group defines:

- `kind`: whether a match is an ad-read start, presence cue, or end cue.
- `confidence`: how strongly the match contributes to candidate scoring.
- `phrases`: the editable strings to look for in YouTube caption text.

Supplying a custom `phraseGroups` list to `analyzeTranscriptCues()` replaces the defaults, which keeps future developer-mode UI or stored settings straightforward.

## Feedback Server And Admin Dashboard

The server package lives in `server/` and provides:

- `POST /api/v1/feedback` for extension feedback payload v2.
- `GET /api/v1/model/latest` for the currently promoted model artifact.
- Admin-only review, training, promotion, rollback, and evaluation routes.
- A React/Vite admin dashboard at `/admin`, protected by a server-side admin session created from `ADMIN_TOKEN`.
- PostgreSQL persistence when `DATABASE_URL` is set, with an in-memory fallback for local development and tests.

Local development:

```bash
npm run server:dev
```

Docker with Postgres:

```bash
export ADMIN_TOKEN="$(openssl rand -hex 32)"
docker compose up --build
```

Then open `http://localhost:8787/admin`, enter the admin token, review submitted feedback, train a model, and promote it. The server sets an HTTP-only admin session cookie; admin APIs also accept `x-admin-token` for scripted workflows. Configure the extension popup feedback endpoint as:

```text
http://localhost:8787/api/v1/feedback
```

The content script derives `GET /api/v1/model/latest` from that endpoint, validates the model schema, caches compatible models, and falls back to heuristic confidence if the server is unavailable.

Production deployment files for a Debian 12/Plesk host live in `server/deploy/README.md`. That guide includes the loopback-only production compose stack, required environment template, TLS reverse-proxy notes, and the `backup-postgres.sh` Postgres backup helper.

Set `ALLOWED_EXTENSION_ORIGINS` as a comma-separated allow list for browser-extension requests. Wildcards are supported, for example:

```text
ALLOWED_EXTENSION_ORIGINS=chrome-extension://*,moz-extension://*,https://admin.example.com
```

Production hardening settings:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `SERVER_BODY_LIMIT_BYTES` | `262144` | Caps JSON request size before validation. |
| `FEEDBACK_RATE_LIMIT_MAX` | `60` | Max public feedback submissions per rate-limit window and client IP. |
| `FEEDBACK_RATE_LIMIT_WINDOW_MS` | `60000` | Feedback rate-limit window length. |
| `ADMIN_SESSION_RATE_LIMIT_MAX` | `10` | Max admin login/session attempts per window and client IP. |
| `ADMIN_SESSION_RATE_LIMIT_WINDOW_MS` | `60000` | Admin session rate-limit window length. |

Rate-limited responses return HTTP `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. The Docker image and compose service also include a `/healthz` healthcheck for reverse proxies and host monitoring.

## Project Structure

```text
src/
  core/analysis/        Detector logic for frames, QR codes, links, transcripts, and fusion.
  core/model/           Candidate feature extraction and JSON logistic model scoring.
  core/scan-status.ts   Shared scan status model used by the page UI and popup.
  entrypoints/          WXT extension entrypoints for background, popup, and YouTube content script.
  platform/youtube/     YouTube-specific routing, metadata, and transcript integration.
  ui/                   Popup, page status, badge, logging, and candidate presentation helpers.
tests/
  unit/                 Detector, parser, status, and UI-model coverage.
  e2e/                  Build-output smoke coverage.
scripts/
  build-installable.mjs Local packaging helper for Chrome and Firefox artifacts.
server/
  src/                  Fastify API, storage adapters, migrations, and trainer.
  admin/                React/Vite admin dashboard.
  tests/                Server API and trainer coverage.
```

## Privacy And Permissions

YapSkippr is local-first by default. Frame samples and video screenshots are not uploaded. If you configure the feedback endpoint, the extension sends structured feedback payloads containing the video URL, timecode, occurrence summary, candidate features, evidence metadata, transcript context, and model metadata.

The extension declares broad `<all_urls>` host access because browser APIs require either `<all_urls>` or `activeTab` for automatic `tabs.captureVisibleTab()` frame sampling. The content script itself is scoped to YouTube pages, and captured frames are processed locally.

If Chrome reports `Either the '<all_urls>' or 'activeTab' permission is required`, open the YapSkippr popup, grant frame capture access, and reload the YouTube tab.

## Limitations

- V1 only detects likely ad-read segments; it does not auto-skip.
- YouTube is the only supported video platform right now.
- Visible-link detection depends on the browser's native text detection API. Browsers without that API simply skip the visible-link cue.
- Firefox builds are available, but Chrome and Chromium are the primary target for the first implementation pass.

## Roadmap

- Improve candidate scoring with reviewed feedback from more real-world sample videos.
- Add richer on-player visualization for candidate windows.
- Add optional skip controls once detection quality is high enough.
- Introduce more platform adapters for additional streaming services.
- Expand model training beyond candidate ranking into boundary-specific timing improvements.

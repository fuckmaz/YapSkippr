<p align="center">
  <img src="public/icon-128.png" alt="YapSkippr logo" width="96" height="96">
</p>

<h1 align="center">YapSkippr</h1>

<p align="center">
  A local-first browser extension for detecting and safely skipping likely in-video sponsorship and ad-read segments on YouTube.
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome%20%2F%20Chromium-MV3-1f6feb">
  <img alt="Firefox MV2" src="https://img.shields.io/badge/Firefox-MV2-ff7139">
  <img alt="Status" src="https://img.shields.io/badge/status-feedback--trained%20v1-2da44e">
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local--first-6f42c1">
</p>

---

## Overview

YapSkippr analyzes the YouTube video you are currently watching and surfaces candidate ad-read segments. Playback remains unchanged by default. If you explicitly enable Auto-skip, YapSkippr skips only high-confidence candidates that have a detected end boundary, handles each segment once per video, and exposes an immediate Undo action beside the player.

The extension combines frame analysis and transcript signals so future versions can evolve toward more accurate, service-aware ad-read detection without tying the core logic to YouTube forever.

YapSkippr now also includes a self-improving, non-LLM recognition loop. The extension still generates evidence with deterministic detectors, then optionally applies a promoted JSON logistic model fetched from your own server. Admin-reviewed feedback produces training examples; validation data calibrates precision-first display and recall-first review thresholds, structured timing corrections learn holdout-proven segment offsets, and promotion safety gates run before browser clients can use a model.

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
- Basic and detailed popup modes. Candidate feedback stays compact with correct, wrong, and wrong-timing actions; a dedicated missed-ad reporter accepts editable start/end timecodes.
- Fast pre-scan mode that keeps analyzing the current YouTube tab every 1-5 seconds after the popup closes.
- Default-off safe Auto-skip for high-confidence segments with detected endings, with per-skip Undo and replay suppression.
- Candidate jump actions for quickly seeking to detected segment start times.
- Lightweight status block mounted near the YouTube player with evidence counts and clickable candidate timecodes.
- Console logging for lower-level debugging while the detector is still evolving.
- Optional feedback API integration with v2 payloads that include an anonymous client ID, candidate features, evidence snapshots, transcript context, and model metadata.
- Admin-only server dashboard for reviewing feedback, training models, inspecting calibrated thresholds and metrics, and safely promoting or rolling back model artifacts.
- Structured wrong-timing review with corrected start/end boundaries, distinct-video holdout evaluation, source-specific offsets, and automatic rejection when calibration does not reduce boundary error.
- First-class missed-segment feedback that snapshots live detector evidence and nearby transcript context. Zero-evidence reports remain reviewable but are intentionally excluded from confidence training.
- Idempotent feedback ingestion keyed by anonymous client, video occurrence, boundaries, and judgment. Transport retries return the original feedback ID instead of inflating review and training counts.
- Admin overview reporting for merged retry attempts, making duplicate protection visible in production.
- Chrome and Chromium support first, with a Firefox build available for local testing.

## How It Works

```text
YouTube page
  -> content script mounts scan UI and reads page metadata
  -> transcript provider loads available caption tracks
  -> frame sampler captures visible video frames
  -> detectors extract transcript, progress-bar, QR, and visible-link evidence
  -> evidence fusion creates a structurally safe candidate pool
  -> optional promoted model scores the pool, applies its calibrated display threshold,
     and adjusts segment boundaries only when a distinct-video holdout proves lower error
  -> default-off skip controller may seek past a qualified bounded segment and offers Undo
  -> popup and page UI receive live status snapshots from extension storage
  -> viewer-reported missed segments capture exact boundaries plus live detector context
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
npm run typecheck:admin
npm run typecheck:server
```

`npm run test:e2e` rebuilds the installable Chrome and Firefox artifacts before checking generated manifests, bundled entrypoints, packaged zip/xpi contents, and the Chrome MV3 content script in a deterministic YouTube-style playback fixture. The runtime test covers opt-in behavior, pause safety, automatic seeking, Undo replay suppression, and video-element replacement.

### Transcript Phrase Tuning

Transcript ad-read cues are configured by default in `DEFAULT_TRANSCRIPT_PHRASE_GROUPS` inside `src/core/analysis/transcript-analyzer.ts`. For local testing, open the extension popup, switch to Detailed mode, edit the Transcript phrase groups JSON, save it, and reload the YouTube tab. Each group defines:

- `kind`: whether a match is an ad-read start, presence cue, or end cue.
- `confidence`: how strongly the match contributes to candidate scoring.
- `phrases`: the editable strings to look for in YouTube caption text.

Supplying a custom `phraseGroups` list to `analyzeTranscriptCues()` replaces the defaults. The popup stores edited phrase groups in `chrome.storage.local` under `yapskippr.transcriptPhraseGroups`; resetting the editor removes that override and restores the defaults.

## Feedback Server And Admin Dashboard

The server package lives in `server/` and provides:

- `POST /api/v1/feedback` for extension feedback payload v2.
- `GET /api/v1/model/latest` for the currently promoted model artifact.
- Admin-only review, training, promotion, rollback, and evaluation routes.
- A React/Vite admin dashboard at `/admin`; the dashboard HTML and built `/admin/assets/*` files are protected by admin auth from `ADMIN_TOKEN`.
- PostgreSQL persistence when `DATABASE_URL` is set, with an in-memory fallback for local development and tests.

Feedback payload model metadata uses the closed `modelSource` values `bundled`, `downloaded`, or `fallback`; unknown values are rejected so admin analytics and training data stay consistent. Candidate reports include both start and end boundaries. A `wrong_timing` admin review must provide a corrected start and optional end; those corrections remain separate from confidence labels and are visible in dataset exports.

Successful new feedback returns HTTP `201` with `deduplicated: false`. A semantic retry from the same anonymous client returns HTTP `200`, the original `feedbackId`, and `deduplicated: true`. Different labels or segment boundaries remain independent judgments.

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

The content script derives `GET /api/v1/model/latest` from that endpoint, validates the model schema and ordered positive/review thresholds, caches compatible models, and falls back to heuristic confidence if the server is unavailable. A trained model cannot be promoted unless its leakage-safe holdout has at least 20 examples, at least five examples from each class, and at least five video groups; its display precision/recall and review recall must also clear conservative minimums, its AUC must be acceptable, and it must not materially regress from the currently promoted model.

After saving a valid feedback endpoint in Detailed mode, the popup also shows an `Open admin dashboard` shortcut for the same server origin.

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
  e2e/                  Build-output plus packaged Chrome MV3 playback/model-threshold coverage.
scripts/
  build-installable.mjs Local packaging helper for Chrome and Firefox artifacts.
server/
  src/                  Fastify API, storage adapters, migrations, and trainer.
  admin/                React/Vite admin dashboard.
  tests/                Server API and trainer coverage.
```

## Privacy And Permissions

YapSkippr is local-first by default. Frame samples and video screenshots are not uploaded. If you configure the feedback endpoint, the extension sends structured feedback payloads containing an anonymous locally generated client ID, the video URL, timecode, occurrence summary, candidate features, evidence metadata, transcript context, and model metadata.

The extension requires host access only for YouTube. Broad `<all_urls>` access is optional and requested from the popup when you enable cross-origin frame capture; feedback endpoint setup separately requests access only to that endpoint's origin. Captured frames are processed locally.

If Chrome reports `Either the '<all_urls>' or 'activeTab' permission is required`, open the YapSkippr popup, grant frame capture access, and reload the YouTube tab.

## Limitations

- Auto-skip deliberately ignores open-ended, low-confidence, inferred-end, excessively short, and excessively long candidates. Manual jump actions remain available for every displayed candidate.
- YouTube is the only supported video platform right now.
- Visible-link detection depends on the browser's native text detection API. Browsers without that API simply skip the visible-link cue.
- Firefox builds are available, but Chrome and Chromium are the primary target for the first implementation pass.

## Roadmap

- Improve candidate scoring with reviewed feedback from more real-world sample videos.
- Calibrate skip confidence and boundary quality against a reviewed real-world holdout corpus.
- Add richer but still minimal on-player visualization for candidate windows and skip history.
- Add per-channel skip preferences after enough reviewed feedback exists to support them safely.
- Introduce more platform adapters for additional streaming services.
- Grow the distinct-video boundary-correction corpus so more detector sources can earn their own holdout-proven timing profiles.

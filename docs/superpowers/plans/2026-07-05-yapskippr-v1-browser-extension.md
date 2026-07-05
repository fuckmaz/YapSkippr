# YapSkippr V1 Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild YapSkippr from scratch as a modular Chrome/Chromium-first browser extension that detects likely YouTube in-video ad reads from sampled video frames and transcript cues, then logs progress and shows a minimal player-adjacent status UI.

**Architecture:** Use WXT + TypeScript to build an MV3 extension with a YouTube content script, a small background entrypoint, and platform-neutral detection modules. Keep video-service specifics behind a `VideoPlatformAdapter` so later services can be added without rewriting frame analysis, transcript analysis, fusion, logging, or UI.

**Tech Stack:** WXT, TypeScript, Vitest, Playwright for extension smoke tests, Canvas/ImageData APIs, `BarcodeDetector` when available, `jsqr` fallback for QR detection, no backend, no remote scripts.

---

## Current Repo Findings

Preserve only these existing values/assets:

- Extension name: `YapSkippr`
- Extension description: `In-Video Sponsorship- and Ad-Skipper`
- Existing icon assets:
  - `icons/arrow_16.png`
  - `icons/arrow_32.png`
  - `icons/arrow_64.png`
  - `icons/arrow_128.png`
  - `icons/arrow_512.png`
  - `icons/next_32.png`
  - `icons/next_64.png`
  - `icons/next_512.png`
  - `icons/yapskippr_icon.png`

Delete/rebuild these during implementation:

- `manifest.json`
- `service-worker.js`
- `popup.html`
- `popup.js`
- `css/popup.css`
- Any other non-icon generated starter code

## Scope For V1

V1 should detect and explain candidate ad-read segments. It should not auto-skip yet unless that is explicitly enabled in a later task. This makes debugging much easier and avoids users being jumped around by uncertain detections.

V1 includes:

- YouTube watch-page detection.
- YouTube SPA route-change handling.
- Video element discovery.
- Frame sampling at a low, configurable rate.
- Progress-bar-like visual cue detection.
- QR-code visual cue detection.
- Transcript/caption crawl from YouTube page data and caption tracks.
- Transcript phrase heuristics for ad-read starts/ends.
- Evidence fusion into candidate ad-read segments.
- Console logging for scan status, evidence, and candidates.
- Minimal Shadow DOM UI mounted below or adjacent to the YouTube player with scan progress and candidate count.

V1 excludes:

- Automatic skipping.
- Server-side analysis.
- Uploading frames/transcripts anywhere.
- Full OCR of frame text. Keep frame OCR as a later module because browser OCR adds large dependencies and performance risk.
- Support for non-YouTube services.

## Target File Structure

Create this structure after reset:

```text
/Users/maz/github/YapSkippr/
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
  wxt.config.ts
  README.md
  public/
    icon-16.png
    icon-32.png
    icon-48.png
    icon-64.png
    icon-128.png
    icon-512.png
  src/
    entrypoints/
      background.ts
      popup/
        index.html
        main.ts
        style.css
      youtube.content/
        index.ts
        style.css
    core/
      analysis/
        evidence-fusion.ts
        frame-sampler.ts
        progress-bar-detector.ts
        qr-detector.ts
        transcript-analyzer.ts
      types.ts
    platform/
      adapter.ts
      youtube/
        caption-track-parser.ts
        page-data-extractor.ts
        route-observer.ts
        transcript-provider.ts
        youtube-adapter.ts
    ui/
      logger.ts
      player-status-ui.ts
    utils/
      image-data.ts
      time-ranges.ts
  tests/
    fixtures/
      youtube-watch-page.html
      youtube-caption-track.json
    unit/
      evidence-fusion.test.ts
      progress-bar-detector.test.ts
      qr-detector.test.ts
      transcript-analyzer.test.ts
      youtube-caption-track-parser.test.ts
      youtube-page-data-extractor.test.ts
    e2e/
      youtube-extension-smoke.test.ts
```

## Core Interfaces

Use these boundaries early so later streaming-service support is additive:

```ts
// src/core/types.ts
export type EvidenceSource = 'frame-progress-bar' | 'frame-qr-code' | 'transcript';

export type EvidenceKind = 'ad-read-start' | 'ad-read-end' | 'ad-read-presence';

export interface TimedEvidence {
  source: EvidenceSource;
  kind: EvidenceKind;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  reason: string;
  raw?: unknown;
}

export interface SegmentCandidate {
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  evidence: TimedEvidence[];
}

export interface TranscriptCue {
  startSeconds: number;
  durationSeconds: number;
  text: string;
}
```

```ts
// src/platform/adapter.ts
import type { TranscriptCue } from '../core/types';

export interface VideoPlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  getVideoId(): string | null;
  getVideoElement(): HTMLVideoElement | null;
  getCurrentTimeSeconds(): number;
  observeVideoChanges(onChange: () => void): () => void;
  loadTranscript(): Promise<TranscriptCue[]>;
  mountStatusUi(): Promise<StatusUiHandle>;
}

export interface StatusUiHandle {
  setStatus(message: string): void;
  setProgress(value: number): void;
  setCandidates(count: number): void;
  destroy(): void;
}
```

## Implementation Tasks

### Task 1: Preserve Branding And Reset The Repo

**Files:**
- Preserve: `/Users/maz/github/YapSkippr/icons/*`
- Delete/recreate: all non-`.git` project files

- [ ] **Step 1: Verify the working tree is clean before destructive reset**

Run:

```bash
git status --short
```

Expected: no output. If there is output, stop and review it before deleting anything.

- [ ] **Step 2: Back up the existing icon assets inside the repo**

Run:

```bash
mkdir -p .yapskippr-preserve/icons
cp icons/*.png .yapskippr-preserve/icons/
```

Expected: `.yapskippr-preserve/icons/` contains all existing PNG assets.

- [ ] **Step 3: Delete everything except git metadata and the temporary icon backup**

Run:

```bash
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .yapskippr-preserve -exec rm -rf {} +
```

Expected: only `.git/` and `.yapskippr-preserve/` remain.

- [ ] **Step 4: Commit reset boundary only after the new scaffold is in place**

Do not commit an empty/deleted repo. Commit after Task 2 creates the replacement scaffold.

### Task 2: Scaffold WXT TypeScript Extension

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `src/entrypoints/background.ts`
- Create: `src/entrypoints/popup/index.html`
- Create: `src/entrypoints/popup/main.ts`
- Create: `src/entrypoints/popup/style.css`
- Create: `public/icon-*.png`
- Create: `README.md`

- [ ] **Step 1: Initialize a WXT project from scratch**

Run:

```bash
npm init -y
npm install -D wxt typescript vitest @vitest/coverage-v8 playwright
npm install jsqr
```

Expected: `package.json` and `package-lock.json` exist.

- [ ] **Step 2: Add package scripts**

`package.json` should include:

```json
{
  "name": "yapskippr",
  "version": "0.1.0",
  "description": "In-Video Sponsorship- and Ad-Skipper",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "jsqr": "latest"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "latest",
    "playwright": "latest",
    "typescript": "latest",
    "vitest": "latest",
    "wxt": "latest"
  }
}
```

- [ ] **Step 3: Configure WXT manifest generation**

`wxt.config.ts` should use `srcDir: 'src'`, the preserved name/description, YouTube host permissions, `storage`, and content script matches for YouTube only:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'YapSkippr',
    description: 'In-Video Sponsorship- and Ad-Skipper',
    permissions: ['storage'],
    host_permissions: [
      'https://youtube.com/*',
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*'
    ],
    action: {
      default_title: 'YapSkippr'
    }
  }
});
```

- [ ] **Step 4: Restore icons into WXT public names**

Run:

```bash
mkdir -p public
cp .yapskippr-preserve/icons/arrow_16.png public/icon-16.png
cp .yapskippr-preserve/icons/arrow_32.png public/icon-32.png
cp .yapskippr-preserve/icons/arrow_64.png public/icon-64.png
cp .yapskippr-preserve/icons/arrow_128.png public/icon-128.png
cp .yapskippr-preserve/icons/arrow_512.png public/icon-512.png
sips -z 48 48 .yapskippr-preserve/icons/arrow_512.png --out public/icon-48.png
```

Expected: `public/icon-16.png`, `public/icon-32.png`, `public/icon-48.png`, `public/icon-64.png`, `public/icon-128.png`, and `public/icon-512.png` exist.

- [ ] **Step 5: Add minimal entrypoints**

`src/entrypoints/background.ts`:

```ts
export default defineBackground(() => {
  console.log('[YapSkippr] background ready');
});
```

`src/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YapSkippr</title>
    <script type="module" src="./main.ts"></script>
  </head>
  <body>
    <main>
      <h1>YapSkippr</h1>
      <p id="status">Open a YouTube video to scan for ad-read cues.</p>
    </main>
  </body>
</html>
```

`src/entrypoints/popup/main.ts`:

```ts
import './style.css';

document.querySelector('#status')?.replaceChildren(
  document.createTextNode('Detection logs are shown in the YouTube tab console for V1.')
);
```

`src/entrypoints/popup/style.css`:

```css
body {
  min-width: 220px;
  margin: 0;
  background: #101010;
  color: #f5f5f5;
  font: 13px system-ui, sans-serif;
}

main {
  padding: 12px;
}

h1 {
  margin: 0 0 8px;
  font-size: 16px;
}

p {
  margin: 0;
  line-height: 1.4;
}
```

- [ ] **Step 6: Verify scaffold**

Run:

```bash
npm install
npm run build
```

Expected: WXT builds a Chrome extension into `.output/chrome-mv3/`.

- [ ] **Step 7: Commit scaffold**

Run:

```bash
git add .
git commit -m "chore: rebuild extension scaffold"
```

### Task 3: Add Core Types, Logger, And Time Utilities

**Files:**
- Create: `src/core/types.ts`
- Create: `src/ui/logger.ts`
- Create: `src/utils/time-ranges.ts`
- Test: `tests/unit/evidence-fusion.test.ts` starts later in Task 9

- [ ] **Step 1: Add the shared detection types**

Create `src/core/types.ts` using the interfaces from "Core Interfaces" above plus:

```ts
export interface ScanProgress {
  phase: 'idle' | 'frames' | 'transcript' | 'fusion' | 'done' | 'error';
  message: string;
  completed: number;
  total: number;
}
```

- [ ] **Step 2: Add a prefixed logger**

Create `src/ui/logger.ts`:

```ts
export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[YapSkippr:${scope}]`;
  return {
    debug: (message, data) => console.debug(prefix, message, data ?? ''),
    info: (message, data) => console.info(prefix, message, data ?? ''),
    warn: (message, data) => console.warn(prefix, message, data ?? ''),
    error: (message, data) => console.error(prefix, message, data ?? '')
  };
}
```

- [ ] **Step 3: Add time range helpers**

Create `src/utils/time-ranges.ts` with pure functions:

```ts
export function clampSeconds(value: number, min = 0): number {
  return Number.isFinite(value) ? Math.max(min, value) : min;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  toleranceSeconds = 0
): boolean {
  return aStart <= bEnd + toleranceSeconds && bStart <= aEnd + toleranceSeconds;
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

### Task 4: Implement YouTube Adapter And Route Handling

**Files:**
- Create: `src/platform/adapter.ts`
- Create: `src/platform/youtube/youtube-adapter.ts`
- Create: `src/platform/youtube/route-observer.ts`
- Create: `src/entrypoints/youtube.content/index.ts`
- Create: `src/entrypoints/youtube.content/style.css`

- [ ] **Step 1: Add the platform adapter interface**

Create `src/platform/adapter.ts` using the interface from "Core Interfaces".

- [ ] **Step 2: Add route observer**

`src/platform/youtube/route-observer.ts` should expose:

```ts
export function observeLocationChanges(onChange: (url: URL) => void): () => void {
  let current = location.href;
  const interval = window.setInterval(() => {
    if (location.href === current) return;
    current = location.href;
    onChange(new URL(current));
  }, 500);

  window.addEventListener('yt-navigate-finish', handleYouTubeNavigate);

  function handleYouTubeNavigate(): void {
    if (location.href === current) return;
    current = location.href;
    onChange(new URL(current));
  }

  return () => {
    window.clearInterval(interval);
    window.removeEventListener('yt-navigate-finish', handleYouTubeNavigate);
  };
}
```

- [ ] **Step 3: Add YouTube adapter skeleton**

`src/platform/youtube/youtube-adapter.ts` should:

- Match `youtube.com/watch`, `m.youtube.com/watch`, and `youtu.be/*`.
- Extract `v` from query params or pathname for `youtu.be`.
- Locate `video.html5-main-video`.
- Return current `video.currentTime`.
- Provide a no-op transcript loader until Task 8.
- Delegate UI mounting to Task 9.

- [ ] **Step 4: Add YouTube content script entrypoint**

`src/entrypoints/youtube.content/index.ts`:

```ts
import './style.css';
import { createLogger } from '../../ui/logger';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';

const logger = createLogger('youtube-content');

export default defineContentScript({
  matches: ['https://*.youtube.com/*', 'https://youtu.be/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    logger.info('content script loaded');
    let stopCurrentScan: (() => void) | undefined;

    async function bootForUrl(url: URL): Promise<void> {
      stopCurrentScan?.();
      const adapter = createYouTubeAdapter();
      if (!adapter.matches(url)) {
        logger.debug('url ignored', url.href);
        return;
      }
      logger.info('watch page detected', { videoId: adapter.getVideoId() });
      stopCurrentScan = () => logger.info('scan stopped for route change');
    }

    await bootForUrl(new URL(location.href));
    const stopRoutes = observeLocationChanges((url) => void bootForUrl(url));
    ctx.addEventListener(window, 'pagehide', () => {
      stopCurrentScan?.();
      stopRoutes();
    });
  }
});
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: PASS and generated manifest contains a YouTube content script.

### Task 5: Implement Frame Sampling

**Files:**
- Create: `src/core/analysis/frame-sampler.ts`
- Create: `src/utils/image-data.ts`
- Test: `tests/unit/progress-bar-detector.test.ts` uses generated `ImageData`

- [ ] **Step 1: Add image helper**

`src/utils/image-data.ts`:

```ts
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
```

- [ ] **Step 2: Add frame sampler**

`src/core/analysis/frame-sampler.ts` should:

- Accept an `HTMLVideoElement`.
- Sample at `sampleIntervalMs`, default `1000`.
- Draw a scaled frame to a canvas using `video.videoWidth` and `video.videoHeight`.
- Emit `{ currentTimeSeconds, imageData, width, height }`.
- Stop when route changes, video disappears, or content script context invalidates.

Core shape:

```ts
export interface SampledFrame {
  currentTimeSeconds: number;
  imageData: ImageData;
  width: number;
  height: number;
}

export interface FrameSamplerOptions {
  width: number;
  sampleIntervalMs: number;
  onFrame(frame: SampledFrame): void | Promise<void>;
}
```

- [ ] **Step 3: Integrate sampler into the YouTube boot flow**

When a watch page starts, find the video element, wait until `video.readyState >= 2`, then sample frames. Log each sampled second:

```ts
logger.debug('frame sampled', { time: frame.currentTimeSeconds, width: frame.width, height: frame.height });
```

- [ ] **Step 4: Build and manually smoke test**

Run:

```bash
npm run dev
```

Expected: WXT opens Chrome/Chromium. Open a YouTube video and see `[YapSkippr:...] frame sampled` logs about once per second while the video is loaded.

### Task 6: Implement Progress-Bar Frame Detector

**Files:**
- Create: `src/core/analysis/progress-bar-detector.ts`
- Test: `tests/unit/progress-bar-detector.test.ts`

- [ ] **Step 1: Write failing tests for synthetic bars**

Tests should cover:

- Detects a bright horizontal bar across 20-90 percent of frame width.
- Ignores tiny lines shorter than 20 percent of frame width.
- Ignores the bottom 7 percent of the frame when `ignoreBottomControls` is true.
- Returns confidence higher when the bar persists across neighboring rows.

- [ ] **Step 2: Implement detector**

Detector strategy:

- Convert each pixel row to brightness and saturation-ish contrast.
- Search regions except ignored YouTube control area.
- Find long horizontal runs whose brightness/contrast differs from nearby background.
- Return `TimedEvidence` with `kind: 'ad-read-presence'`, `source: 'frame-progress-bar'`, and confidence from `0.2` to `0.75`.

Export:

```ts
export interface ProgressBarDetectionOptions {
  ignoreBottomRatio: number;
  minWidthRatio: number;
  minContrast: number;
}

export function detectProgressBarCue(
  imageData: ImageData,
  currentTimeSeconds: number,
  options?: Partial<ProgressBarDetectionOptions>
): TimedEvidence[];
```

- [ ] **Step 3: Wire detector into frame sampler**

For each sampled frame:

- Run `detectProgressBarCue`.
- Log detections.
- Store evidence in the scan session.

- [ ] **Step 4: Test and build**

Run:

```bash
npm test -- tests/unit/progress-bar-detector.test.ts
npm run build
```

Expected: tests PASS and build PASS.

### Task 7: Implement QR-Code Frame Detector

**Files:**
- Create: `src/core/analysis/qr-detector.ts`
- Test: `tests/unit/qr-detector.test.ts`

- [ ] **Step 1: Add detector wrapper**

`src/core/analysis/qr-detector.ts` should:

- Use `globalThis.BarcodeDetector` when available and it supports `qr_code`.
- Fall back to `jsqr(imageData.data, width, height)`.
- Return strong `TimedEvidence` because QR codes in creator content often indicate sponsor/ad-read CTAs.

Export:

```ts
export async function detectQrCue(
  imageData: ImageData,
  currentTimeSeconds: number
): Promise<TimedEvidence[]>;
```

- [ ] **Step 2: Write tests around fallback path**

Use a mocked `jsqr` import or a small generated fixture. At minimum, verify:

- No QR result returns `[]`.
- A QR result returns one `frame-qr-code` evidence item.
- Evidence includes decoded text in `raw`.

- [ ] **Step 3: Wire detector into frame sampler**

Run QR detection less frequently than progress-bar detection, default every `2000ms`, because QR decoding is more expensive.

- [ ] **Step 4: Test and build**

Run:

```bash
npm test -- tests/unit/qr-detector.test.ts
npm run build
```

Expected: tests PASS and build PASS.

### Task 8: Implement YouTube Transcript Crawl And Transcript Analyzer

**Files:**
- Create: `src/platform/youtube/page-data-extractor.ts`
- Create: `src/platform/youtube/caption-track-parser.ts`
- Create: `src/platform/youtube/transcript-provider.ts`
- Create: `src/core/analysis/transcript-analyzer.ts`
- Test: `tests/unit/youtube-page-data-extractor.test.ts`
- Test: `tests/unit/youtube-caption-track-parser.test.ts`
- Test: `tests/unit/transcript-analyzer.test.ts`
- Fixture: `tests/fixtures/youtube-watch-page.html`
- Fixture: `tests/fixtures/youtube-caption-track.json`

- [ ] **Step 1: Parse `ytInitialPlayerResponse` from page HTML**

`page-data-extractor.ts` should scan script text for `ytInitialPlayerResponse = { ... };`, parse the JSON safely, and return caption tracks. Because content scripts cannot rely on page JavaScript variables from the isolated world, parse DOM script text first.

- [ ] **Step 2: Fetch and parse caption tracks**

`transcript-provider.ts` should:

- Choose English manual captions first.
- Fall back to English auto captions.
- Fall back to the first available caption track.
- Fetch the caption track URL with `fmt=json3`.
- Parse `events[].segs[].utf8` into `TranscriptCue[]`.

- [ ] **Step 3: Implement transcript cue analyzer**

`transcript-analyzer.ts` should detect start/end/presence cues.

Start/presence cue examples:

- `sponsor`
- `sponsored by`
- `thanks to`
- `today's sponsor`
- `partnered with`
- `use code`
- `promo code`
- `link in the description`
- `check out`
- `limited time`

End cue examples:

- `now back to`
- `back to the video`
- `with that out of the way`
- `anyway`
- `let's get back`
- `back into`

Rules:

- Cue text matching is case-insensitive.
- A start cue creates `ad-read-start` evidence.
- An end cue creates `ad-read-end` evidence.
- Strong sponsor phrases get confidence `0.75-0.9`.
- Weak CTA phrases get confidence `0.35-0.55`.

- [ ] **Step 4: Wire transcript loading into YouTube adapter**

When a video is detected:

- Log transcript phase start.
- Load transcript.
- Analyze cues.
- Store evidence.
- Log cue count and selected caption language.

- [ ] **Step 5: Test and build**

Run:

```bash
npm test -- tests/unit/youtube-page-data-extractor.test.ts tests/unit/youtube-caption-track-parser.test.ts tests/unit/transcript-analyzer.test.ts
npm run build
```

Expected: tests PASS and build PASS.

### Task 9: Fuse Evidence Into Candidate Segments

**Files:**
- Create: `src/core/analysis/evidence-fusion.ts`
- Test: `tests/unit/evidence-fusion.test.ts`

- [ ] **Step 1: Write fusion tests**

Tests should cover:

- Transcript start + transcript end creates a bounded candidate.
- QR evidence near a transcript start increases confidence.
- Progress-bar evidence without transcript creates a low-confidence open candidate.
- End defaults to `start + 120s` only when no end cue exists and confidence is high enough.
- Candidates below `0.4` confidence are not shown by default.

- [ ] **Step 2: Implement fusion**

Fusion rules:

- Sort evidence by time.
- Build candidates from start evidence.
- Attach nearby presence evidence within `+/- 20s`.
- Attach end evidence after start and before `start + 240s`.
- Confidence = capped weighted score of evidence sources.
- QR and strong transcript evidence carry more weight than progress bars.

Export:

```ts
export function buildSegmentCandidates(evidence: TimedEvidence[]): SegmentCandidate[];
```

- [ ] **Step 3: Wire fusion into scan session**

Run fusion after transcript load and after each new frame evidence batch. Log candidate changes:

```ts
logger.info('segment candidates updated', candidates);
```

- [ ] **Step 4: Test and build**

Run:

```bash
npm test -- tests/unit/evidence-fusion.test.ts
npm run build
```

Expected: tests PASS and build PASS.

### Task 10: Add Player-Adjacent Status UI

**Files:**
- Create: `src/ui/player-status-ui.ts`
- Modify: `src/entrypoints/youtube.content/index.ts`
- Modify: `src/entrypoints/youtube.content/style.css`

- [ ] **Step 1: Add Shadow DOM status UI**

Use WXT `createShadowRootUi` from the YouTube content script. Anchor near the YouTube player area:

- Preferred anchor: `#player`
- Fallback anchor: `#primary`
- Final fallback anchor: `body`

UI elements:

- Status text: current scan phase.
- Thin progress bar.
- Candidate count.
- No controls yet, except maybe hidden debug data in `data-*` attributes.

- [ ] **Step 2: Keep console logging as source of truth**

Every UI state change should also log:

```ts
logger.info('scan progress', progress);
```

- [ ] **Step 3: Style it compactly**

Use neutral styling that does not look like a YouTube control and does not overlap the video:

```css
.yapskippr-status {
  box-sizing: border-box;
  width: 100%;
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: #111;
  color: #f5f5f5;
  font: 12px system-ui, sans-serif;
}

.yapskippr-meter {
  height: 4px;
  margin-top: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}

.yapskippr-meter > span {
  display: block;
  height: 100%;
  width: var(--yapskippr-progress, 0%);
  background: #33c481;
}
```

- [ ] **Step 4: Manual smoke test**

Run:

```bash
npm run dev
```

Expected:

- Open YouTube watch page.
- A compact YapSkippr status block appears below/near the player.
- Console logs show scan phases and evidence.
- UI does not cover the video.

### Task 11: Add End-To-End Smoke Test

**Files:**
- Create: `tests/e2e/youtube-extension-smoke.test.ts`
- Create: `tests/fixtures/youtube-watch-page.html`

- [ ] **Step 1: Add a static YouTube-like fixture**

Fixture needs:

- `video.html5-main-video`
- `#player`
- `#primary`
- A script containing a minimal `ytInitialPlayerResponse` with one caption track.

- [ ] **Step 2: Add Playwright test**

The smoke test should:

- Build the extension.
- Launch Chromium with the unpacked extension.
- Load the fixture page or a controlled test page.
- Assert the content script mounts the UI.
- Assert logs include `content script loaded`.

- [ ] **Step 3: Add e2e script**

Add to `package.json`:

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 4: Run all verification**

Run:

```bash
npm test
npm run build
npm run test:e2e
```

Expected: all PASS.

### Task 12: Firefox Readiness Pass

**Files:**
- Modify: `wxt.config.ts`
- Modify: `README.md`

- [ ] **Step 1: Build Firefox target**

Run:

```bash
npm run build:firefox
```

Expected: WXT emits a Firefox build, or fails with a concrete browser-compat issue.

- [ ] **Step 2: Gate nonportable APIs**

Verify:

- `BarcodeDetector` usage is feature-detected.
- No Chrome-only `world: 'MAIN'` content script is required for V1.
- Any future offscreen-document work is behind a Chrome-only capability check.

- [ ] **Step 3: Document support**

`README.md` should state:

- Chrome/Chromium is the primary V1 target.
- Firefox is expected but not guaranteed until a Firefox manual test is completed.
- Detection is heuristic and local-only.
- V1 logs and displays candidates, it does not auto-skip.

### Task 13: Final Verification And Cleanup

**Files:**
- Modify: `README.md`
- Remove: `.yapskippr-preserve/` after public icons are verified

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
npm run build:firefox
```

Expected: all PASS or documented Firefox-only compatibility issue.

- [ ] **Step 2: Remove temporary icon backup**

Run:

```bash
rm -rf .yapskippr-preserve
```

- [ ] **Step 3: Commit**

Run:

```bash
git add .
git commit -m "feat: add YouTube ad-read detection prototype"
```

## Acceptance Criteria

V1 is done when:

- Chrome/Chromium build installs as an unpacked extension.
- On YouTube watch pages, the content script starts on full page load and SPA navigation.
- Frame sampling logs progress at a controlled interval.
- Progress-bar detector can emit evidence from synthetic and live sampled frames.
- QR detector emits evidence when QR codes appear in sampled frames, with graceful fallback when native detection is unavailable.
- Transcript crawl returns cues for videos with captions and fails gracefully for videos without captions.
- Transcript analyzer emits start/end evidence from sponsor-like phrases.
- Fusion produces candidate sponsor/ad-read segments with confidence and source evidence.
- The YouTube player page shows a compact YapSkippr status UI and console logs all phases.
- No frames, transcripts, or user data leave the browser.

## Questions To Confirm Before Implementation

1. Should V1 remain detection-only, or should we add an experimental "skip candidate" button after candidates are displayed?
2. Should English be the only transcript heuristic language for V1, or should German be included immediately as a second phrase dictionary?
3. Should the first UI live below the player only, or is a small overlay inside the player acceptable once the detection logs are stable?

## References

- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome web accessible resources: https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
- MDN cross-browser WebExtensions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension
- WXT installation: https://wxt.dev/guide/installation.html
- WXT content scripts: https://wxt.dev/guide/essentials/content-scripts.html
- MDN Canvas `drawImage`: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
- MDN BarcodeDetector: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector

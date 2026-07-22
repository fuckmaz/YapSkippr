import { expect, test, chromium, type BrowserContext, type Page, type Route, type Worker } from '@playwright/test';
import { resolve } from 'node:path';

const AUTO_SKIP_ENABLED_STORAGE_KEY = 'yapskippr.autoSkipEnabled';
const WATCH_URL = 'https://www.youtube.com/watch?v=yapskippr-runtime-fixture';
const VIDEO_URL = 'https://www.youtube.com/yapskippr-runtime-fixture.webm';
const CAPTION_URL = 'https://www.youtube.com/api/timedtext?v=yapskippr-runtime-fixture&lang=en';
const VIDEO_BASE64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAATnEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggPU7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEDNTAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYj7FqMj79mIn5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhDuaygDgkLCBELqBEJqBAlW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiPsWoyPv2YifZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MTUuMDAwMDAwMDAwAB9DtnVA1eeBAKOhgQAAgIJJg0IAAPAA9gA4JBwYQgAAMGAAABC///2LKgAAo6GBA+iAgkmDQgAA8AD2ADgkHBhCAAAwYAAAEL///YsqAACjoYEH0ICCSYNCAADwAPYAOCQcGEIAADBgAAAQv//9iyoAAKOhgQu4gIJJg0IAAPAA9gA4JBwYQgAAMGAAABC///2LKgAAo6GBD6CAgkmDQgAA8AD2ADgkHBhCAAAwYAAAEL///YsqAACjoYETiICCSYNCAADwAPYAOCQcGEIAADBgAAAQv//9iyoAAB9DtnVA1ueCF3CjoYEAAICCSYNCAADwAPYAOCQcGEIAADBgAAAQv//9iyoAAKOhgQPogIJJg0IAAPAA9gA4JBwYQgAAMGAAABC///2LKgAAo6GBB9CAgkmDQgAA8AD2ADgkHBhCAAAwYAAAEL///YsqAACjoYELuICCSYNCAADwAPYAOCQcGEIAADBgAAAQv//9iyoAAKOhgQ+ggIJJg0IAAPAA9gA4JBwYQgAAMGAAABC///2LKgAAo6GBE4iAgkmDQgAA8AD2ADgkHBhCAAAwYAAAEL///YsqAAAfQ7Z17eeCLuCjoYEAAICCSYNCAADwAPYAOCQcGEIAADBgAAAQv//9iyoAAKOhgQPogIJJg0IAAPAA9gA4JBwYQgAAMGAAABC///2LKgAAo6GBB9CAgkmDQgAA8AD2ADgkHBhCAAAwYAAAEL///YsqAAAcU7trQQ27j7OBALeK94EB8YIBq/CBA7uQs4ID6LeK94EB8YIBq/CBJruQs4IH0LeK94EB8YIBq/CBSbuQs4ILuLeK94EB8YIBq/CBbLuQs4IPoLeK94EB8YIBq/CBj7uQs4ITiLeK94EB8YIBq/CBsruQs4IXcLeK94EB8YIChvCBBLuQs4IbWLeK94EB8YIChvCBJ7uQs4IfQLeK94EB8YIChvCBSruQs4IjKLeK94EB8YIChvCBbbuQs4InELeK94EB8YIChvCBkLuQs4Iq+LeK94EB8YIChvCBs7uQs4Iu4LeK94EB8YIDYvCBBLuQs4IyyLeK94EB8YIDYvCBJ7uQs4I2sLeK94EB8YIDYvCBSg=';

test('runs safe auto-skip, Undo, and video replacement through the packaged extension', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  try {
    const serviceWorker = await getExtensionServiceWorker(context);
    await serviceWorker.evaluate(async (storageKey) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ [storageKey]: false });
    }, AUTO_SKIP_ENABLED_STORAGE_KEY);

    await installYouTubeFixtureRoutes(context);
    const page = await context.newPage();
    await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded' });

    const statusHost = page.locator('#yapskippr-status-host');
    const candidateCount = statusHost.locator('[data-role="candidates"]');
    const skipNotice = statusHost.locator('[data-role="skip-notice"]');
    await expect(candidateCount).toHaveText('1 candidate', { timeout: 15_000 });

    await page.locator('video.html5-main-video').evaluate((video: HTMLVideoElement) => video.pause());
    const pausedAt = await videoCurrentTime(page);
    await setAutoSkipPreference(serviceWorker, true);
    await page.locator('video.html5-main-video').evaluate((video: HTMLVideoElement) => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(500);

    expect(await videoCurrentTime(page)).toBeCloseTo(pausedAt, 1);
    await expect(skipNotice).toBeHidden();

    await page.locator('video.html5-main-video').evaluate(async (video: HTMLVideoElement) => video.play());
    await expect(skipNotice).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => videoCurrentTime(page)).toBeGreaterThanOrEqual(8);

    await skipNotice.getByRole('button', { name: 'Undo' }).click();
    await expect(skipNotice).toBeHidden();
    const undoTime = await videoCurrentTime(page);
    expect(undoTime).toBeLessThan(3);
    await page.waitForTimeout(750);
    expect(await videoCurrentTime(page)).toBeLessThan(8);

    await replaceFixtureVideo(page);
    await expect(page.locator('#yapskippr-status-host')).toHaveCount(1);
    await expect(page.locator('#yapskippr-status-host [data-role="skip-notice"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => videoCurrentTime(page)).toBeGreaterThanOrEqual(8);
  } finally {
    await context.close();
  }
});

async function getExtensionServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function setAutoSkipPreference(serviceWorker: Worker, enabled: boolean): Promise<void> {
  await serviceWorker.evaluate(async ({ storageKey, enabled: nextEnabled }) => {
    await chrome.storage.local.set({ [storageKey]: nextEnabled });
  }, { storageKey: AUTO_SKIP_ENABLED_STORAGE_KEY, enabled });
}

async function installYouTubeFixtureRoutes(context: BrowserContext): Promise<void> {
  const videoBody = Buffer.from(VIDEO_BASE64, 'base64');
  await context.route('https://www.youtube.com/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/watch') {
      await route.fulfill({
        contentType: 'text/html',
        body: createYouTubeFixtureHtml()
      });
      return;
    }

    if (url.pathname === '/api/timedtext') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: "Today's sponsor is Acme." }] },
            { tStartMs: 1_000, dDurationMs: 1_000, segs: [{ utf8: 'Use code YAPSKIPPR for a free trial.' }] },
            { tStartMs: 8_000, dDurationMs: 1_000, segs: [{ utf8: 'Anyway, now back to the video.' }] }
          ]
        })
      });
      return;
    }

    if (url.pathname === '/yapskippr-runtime-fixture.webm') {
      await fulfillVideoRequest(route, videoBody);
      return;
    }

    await route.fulfill({ status: 404, body: '' });
  });
}

async function fulfillVideoRequest(route: Route, videoBody: Buffer): Promise<void> {
  const rangeHeader = route.request().headers().range;
  const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? '');
  if (!range) {
    await route.fulfill({
      contentType: 'video/webm',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(videoBody.length)
      },
      body: videoBody
    });
    return;
  }

  const start = Number(range[1]);
  const requestedEnd = range[2] ? Number(range[2]) : videoBody.length - 1;
  const end = Math.min(requestedEnd, videoBody.length - 1);
  const body = videoBody.subarray(start, end + 1);
  await route.fulfill({
    status: 206,
    contentType: 'video/webm',
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(body.length),
      'Content-Range': `bytes ${start}-${end}/${videoBody.length}`
    },
    body
  });
}

function createYouTubeFixtureHtml(): string {
  const playerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl: CAPTION_URL,
          languageCode: 'en',
          name: { simpleText: 'English' }
        }]
      }
    }
  };

  return `<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>YapSkippr runtime fixture</title></head>
      <body>
        <div id="player">
          <video class="html5-main-video" data-generation="1" muted autoplay src="${VIDEO_URL}"></video>
        </div>
        <script>window.ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>
      </body>
    </html>`;
}

async function videoCurrentTime(page: Page): Promise<number> {
  return page.locator('video.html5-main-video').evaluate((video: HTMLVideoElement) => video.currentTime);
}

async function replaceFixtureVideo(page: Page): Promise<void> {
  await page.locator('video.html5-main-video').evaluate(async (video: HTMLVideoElement) => {
    const replacement = document.createElement('video');
    replacement.className = 'html5-main-video';
    replacement.dataset.generation = '2';
    replacement.muted = true;
    replacement.autoplay = true;
    replacement.src = video.currentSrc || video.src;
    video.replaceWith(replacement);
    await replacement.play();
  });
}

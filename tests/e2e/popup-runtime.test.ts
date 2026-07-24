import { expect, test, chromium, type BrowserContext, type Locator, type Worker } from '@playwright/test';
import { resolve } from 'node:path';

const POPUP_VIEWPORT = { width: 390, height: 600 };
const WATCH_URL = 'https://www.youtube.com/watch?v=popup-layout';
const SHORT_WATCH_URL = 'https://youtu.be/popup-short';
const UNSUPPORTED_URL = 'https://www.youtube.com/feed/subscriptions';

test('keeps supported packaged popup views, actions, permission flow, and contrast explicit', async () => {
  const context = await launchExtension();
  await installDeterministicFramePermission(context);

  try {
    const serviceWorker = await getExtensionServiceWorker(context);
    const targetPage = await context.newPage();
    await targetPage.route(WATCH_URL, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Popup layout fixture</title>'
    }));
    await targetPage.goto(WATCH_URL);
    await targetPage.bringToFront();

    const tabId = await activeTabId(serviceWorker);
    await setPopupStatus(serviceWorker, tabId, createPopupStatus());

    // BrowserContext request events cover every request Playwright exposes for the
    // popup and extension context, including service-worker requests when Chromium
    // surfaces them. This is intentionally broader than page-scoped request events.
    const startupRequests: string[] = [];
    context.on('request', (request) => startupRequests.push(request.url()));

    const popupPage = await openPopup(context, serviceWorker, tabId);
    await setPopupStatus(serviceWorker, tabId, createPopupStatus());
    await expect(popupPage.locator('#scan-phase')).toHaveText('Idle');
    await expect(popupPage.locator('#status')).toHaveText('Watching this YouTube video for ad reads.');
    await expect(popupPage.locator('#permission-panel')).toBeVisible();
    await popupPage.waitForTimeout(250);
    expect(startupRequests.length).toBeGreaterThan(0);
    expect(startupRequests.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    await expect(popupPage.locator('#candidate-results')).toBeHidden();
    await expect(popupPage.locator('.activity-panel')).toBeHidden();
    await expect(popupPage.locator('#candidate-results-label')).toBeHidden();
    await expect(popupPage.locator('#activity-label')).toBeHidden();
    await expect(popupPage.locator('#developer-panel')).toBeHidden();
    await expect(popupPage.getByText('Detection signals', { exact: true })).toBeHidden();
    await expect(popupPage.getByText('Scan activity', { exact: true })).toBeHidden();

    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      phase: 'starting',
      message: 'Loading active recognition model...'
    }));
    await expect(popupPage.locator('#scan-phase')).toHaveText('Starting');
    await expect(popupPage.locator('#scan-message')).toHaveText('Getting detection ready...');

    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      phase: 'error',
      message: 'Recognition model failed after analyzing frames: HTTP 503.'
    }));
    await expect(popupPage.locator('#scan-phase')).toHaveText('Error');
    await expect(popupPage.locator('#scan-message')).toHaveText('detector failed after checking the video: HTTP 503.');
    await expectAboveFold(popupPage.locator('#grant-access'));

    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      phase: 'done',
      message: 'Raw detector completion message.',
      progress: 1,
      sampleCount: 18,
      videoCurrentTimeSeconds: 95,
      videoDurationSeconds: 600,
      candidateCount: 1,
      evidenceCounts: {
        transcript: 2,
        progressBar: 1,
        qrCode: 1,
        visibleLink: 0,
        total: 4
      },
      candidates: [{
        id: 'candidate-popup-layout',
        startSeconds: 72,
        endSeconds: 132,
        confidence: 0.86,
        heuristicConfidence: 0.72,
        modelConfidence: 0.86,
        modelId: 'popup-layout-model',
        modelVersion: '2026.07.24',
        modelSource: 'downloaded',
        featureSchemaVersion: 2,
        summary: '1:12-2:12 · 86% · transcript + QR',
        sources: ['transcript', 'QR']
      }],
      recentEvents: [{
        id: 'event-popup-layout',
        level: 'info',
        message: 'Possible ad read found',
        timestamp: Date.now(),
        detail: 'Transcript and QR signals overlap'
      }]
    }));

    await expect(popupPage.locator('#scan-phase')).toHaveText('Done');
    await expect(popupPage.locator('#scan-message')).toHaveText('Found 1 possible ad read.');
    await expect(popupPage.locator('#candidate-results')).toBeVisible();
    await expect(popupPage.getByRole('button', { name: 'Jump to 1:12' })).toBeVisible();
    await expect(popupPage.getByRole('button', { name: 'Correct' })).toBeVisible();
    await expect(popupPage.getByRole('button', { name: 'Not an ad' })).toBeVisible();
    await expect(popupPage.getByRole('button', { name: 'Wrong times' })).toBeVisible();
    await expectAboveFold(popupPage.getByRole('button', { name: 'Jump to 1:12' }));
    await expectAboveFold(popupPage.locator('#grant-access'));

    const correctFeedback = popupPage.locator('button[data-feedback="accurate"]').first();
    await expect(correctFeedback).toHaveAttribute('data-summary', '1:12-2:12 · 86% · transcript + QR');
    await expect(correctFeedback).toHaveAttribute(
      'data-reason',
      '86% model · 72% heuristic · transcript + QR'
    );

    await popupPage.getByRole('button', { name: 'Basic' }).hover();
    await popupPage.waitForTimeout(180);
    await expectReadableContrast(popupPage.getByRole('button', { name: 'Basic' }));
    await correctFeedback.hover();
    await popupPage.waitForTimeout(180);
    await expectReadableContrast(correctFeedback);

    const advancedToggle = popupPage.getByRole('button', { name: 'Advanced' });
    await advancedToggle.click();
    await expect(advancedToggle).toBeFocused();
    await expect(popupPage.locator('#basic-view')).toBeHidden();
    await expect(popupPage.locator('#developer-panel')).toBeVisible();
    await expectIntersectsViewport(popupPage.locator('#developer-panel'));
    await expect(popupPage.getByText('Detection signals', { exact: true })).toBeVisible();
    await expect(popupPage.getByText('Recent activity', { exact: true })).toBeVisible();
    await expect(popupPage.locator('#signal-details-panel')).toBeHidden();
    await expect(popupPage.locator('#fast-scan-toggle')).toBeDisabled();

    const basicToggle = popupPage.getByRole('button', { name: 'Basic' });
    await basicToggle.click();
    await expect(basicToggle).toBeFocused();
    await expect(popupPage.locator('#basic-view')).toBeVisible();
    await expect(popupPage.locator('#developer-panel')).toBeHidden();
    await expect(popupPage.locator('#candidate-results')).toBeVisible();

    await popupPage.locator('body').click({ position: { x: 1, y: 1 } });
    await popupPage.keyboard.press('Tab');
    await expect(basicToggle).toBeFocused();
    const focusStyle = await basicToggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' });

    const focusOrder: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      focusOrder.push(await popupPage.evaluate(() => (
        document.activeElement?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
      )));
      await popupPage.keyboard.press('Tab');
    }
    expect(focusOrder).toEqual([
      'Basic',
      'Advanced',
      'Allow on all websites',
      'Jump to 1:12',
      'Correct',
      'Not an ad',
      'Wrong times',
      'Turn on',
      'Report'
    ]);

    await popupPage.locator('#grant-access').click();
    await expect(popupPage.locator('#permission-panel')).toBeVisible();
    await expect(popupPage.locator('#permission-title')).toHaveText('Visual checks enabled');
    await expect(popupPage.locator('#permission-status')).toContainText('Reload the YouTube tab');
    await expect(popupPage.locator('#grant-access')).toBeHidden();
    await expect(popupPage.locator('#permission-status')).toBeFocused();

    const reopenedPopup = await openPopup(context, serviceWorker, tabId);
    await expect(reopenedPopup.locator('#permission-panel')).toBeHidden();
    await reopenedPopup.close();

    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({
        __yapskipprTestFrameAccessGranted: false,
        __yapskipprTestFrameAccessRequestResult: false
      });
    });
    const deniedPopup = await openPopup(context, serviceWorker, tabId);
    await expect(deniedPopup.locator('#permission-panel')).toBeVisible();
    await deniedPopup.locator('#grant-access').click();
    await expect(deniedPopup.locator('#permission-status')).toHaveText(
      'Access was not granted. Visual checks remain off; you can continue without them.'
    );
    await expect(deniedPopup.locator('#grant-access')).toBeVisible();
    await expect(deniedPopup.locator('#grant-access')).toBeFocused();
    await deniedPopup.close();

  } finally {
    await context.close();
  }
});

test('supports youtu.be video links and keeps visual-access gating available', async () => {
  const context = await launchExtension();

  try {
    const serviceWorker = await getExtensionServiceWorker(context);
    const targetPage = await context.newPage();
    await targetPage.route(SHORT_WATCH_URL, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Short YouTube link fixture</title>'
    }));
    await targetPage.goto(SHORT_WATCH_URL);
    await targetPage.bringToFront();
    const tabId = await activeTabId(serviceWorker);
    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      videoId: 'popup-short',
      pageUrl: SHORT_WATCH_URL,
      phase: 'transcript',
      message: 'Loading transcript cues...',
      progress: 0.2
    }));

    const popupPage = await openPopup(context, serviceWorker, tabId);
    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      videoId: 'popup-short',
      pageUrl: SHORT_WATCH_URL,
      phase: 'transcript',
      message: 'Loading transcript cues...',
      progress: 0.2
    }));

    await expect(popupPage.locator('#status')).toHaveText('Watching this YouTube video for ad reads.');
    await expect(popupPage.locator('#scan-title')).toHaveText('YouTube video');
    await expect(popupPage.locator('#scan-phase')).toHaveText('Captions');
    await expect(popupPage.locator('#scan-message')).toHaveText('Checking the video captions for ad reads...');
    await expect(popupPage.locator('#permission-panel')).toBeVisible();
    await expect(popupPage.locator('#grant-access')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('does not claim YouTube activity or solicit all-site access on unsupported tabs', async () => {
  const context = await launchExtension();

  try {
    const serviceWorker = await getExtensionServiceWorker(context);
    const targetPage = await context.newPage();
    await targetPage.route(UNSUPPORTED_URL, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Unsupported popup fixture</title>'
    }));
    await targetPage.goto(UNSUPPORTED_URL);
    await targetPage.bringToFront();
    const tabId = await activeTabId(serviceWorker);
    await setPopupStatus(serviceWorker, tabId, createPopupStatus({
      candidateCount: 1,
      candidates: [{
        id: 'stale-candidate',
        startSeconds: 10,
        endSeconds: 20,
        confidence: 0.9,
        summary: 'stale',
        sources: ['transcript']
      }]
    }));

    const popupPage = await openPopup(context, serviceWorker, tabId);
    await expect(popupPage.locator('#status')).toHaveText('Open a YouTube video to use YapSkippr.');
    await expect(popupPage.locator('#status')).not.toContainText('Watching');
    await expect(popupPage.locator('#permission-panel')).toBeHidden();
    await expect(popupPage.locator('#grant-access')).toBeHidden();
    await expect(popupPage.locator('#candidate-results')).toBeHidden();
    await expect(popupPage.locator('#scan-phase')).toHaveText('Idle');
  } finally {
    await context.close();
  }
});

async function launchExtension(): Promise<BrowserContext> {
  const extensionPath = resolve('.output/chrome-mv3');
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
}

async function installDeterministicFramePermission(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:' || !chrome.permissions) return;
    const grantedKey = '__yapskipprTestFrameAccessGranted';
    const requestResultKey = '__yapskipprTestFrameAccessRequestResult';
    const originalContains = chrome.permissions.contains.bind(chrome.permissions);
    const originalRequest = chrome.permissions.request.bind(chrome.permissions);
    const isFrameAccess = (permissions: chrome.permissions.Permissions) =>
      permissions.origins?.includes('<all_urls>') === true;

    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value(permissions: chrome.permissions.Permissions, callback: (granted: boolean) => void) {
        if (!isFrameAccess(permissions)) {
          originalContains(permissions, callback);
          return;
        }
        chrome.storage.local.get(grantedKey, (items) => callback(items[grantedKey] === true));
      }
    });
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value(permissions: chrome.permissions.Permissions, callback: (granted: boolean) => void) {
        if (!isFrameAccess(permissions)) {
          originalRequest(permissions, callback);
          return;
        }
        chrome.storage.local.get(requestResultKey, (items) => {
          const granted = items[requestResultKey] !== false;
          if (!granted) {
            callback(false);
            return;
          }
          chrome.storage.local.set({ [grantedKey]: true }, () => callback(true));
        });
      }
    });
  });
}

async function getExtensionServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function activeTabId(serviceWorker: Worker): Promise<number> {
  return serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (typeof tab?.id !== 'number') throw new Error('No active fixture tab.');
    return tab.id;
  });
}

async function openPopup(context: BrowserContext, serviceWorker: Worker, tabId: number) {
  const popupPage = await context.newPage();
  await popupPage.setViewportSize(POPUP_VIEWPORT);
  await serviceWorker.evaluate((activeTabId) => chrome.tabs.update(activeTabId, { active: true }), tabId);
  await popupPage.goto(new URL('/popup.html', serviceWorker.url()).toString(), { waitUntil: 'domcontentloaded' });
  return popupPage;
}

async function setPopupStatus(
  serviceWorker: Worker,
  tabId: number,
  status: Record<string, unknown>
): Promise<void> {
  await serviceWorker.evaluate(async ({ activeTabId, nextStatus }) => {
    await chrome.storage.session.set({ [`yapskippr.scanStatus.${activeTabId}`]: nextStatus });
  }, { activeTabId: tabId, nextStatus: status });
}

function createPopupStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platformId: 'youtube',
    videoId: 'popup-layout',
    pageUrl: WATCH_URL,
    phase: 'idle',
    message: 'No active scan.',
    progress: 0,
    sampleCount: 0,
    videoCurrentTimeSeconds: null,
    videoDurationSeconds: null,
    fastScanEnabled: false,
    fastScanIntervalSeconds: 2,
    model: {
      modelId: null,
      modelVersion: null,
      modelSource: 'fallback',
      featureSchemaVersion: null,
      status: 'fallback',
      message: 'Heuristic confidence only.'
    },
    candidateCount: 0,
    evidenceCounts: {
      transcript: 0,
      progressBar: 0,
      qrCode: 0,
      visibleLink: 0,
      total: 0
    },
    candidates: [],
    recentEvidence: [],
    recentEvents: [],
    updatedAt: Date.now(),
    ...overrides
  };
}

async function expectAboveFold(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? Infinity) + (box?.height ?? Infinity)).toBeLessThanOrEqual(POPUP_VIEWPORT.height);
}

async function expectIntersectsViewport(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y ?? Infinity).toBeLessThan(POPUP_VIEWPORT.height);
  expect((box?.y ?? -Infinity) + (box?.height ?? -Infinity)).toBeGreaterThan(0);
}

async function expectReadableContrast(locator: Locator): Promise<void> {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(value: string): [number, number, number] {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  return [red, green, blue]
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

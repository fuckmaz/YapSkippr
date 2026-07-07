import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../src/app.js';
import { feedbackFixture } from './fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('YapSkippr admin dashboard browser workflow', () => {
  let app: FastifyInstance;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildServer({ adminToken: 'secret' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Could not bind test server.');
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });

    await seedFeedback(app, 'candidate-positive', 'video-a', 'transcript');
    await seedFeedback(app, 'candidate-link', 'video-b', 'frame-visible-link', {
      transcriptStartCount: 0,
      sponsorPhraseHitCount: 0,
      modelConfidence: 0.24
    });
  });

  afterAll(async () => {
    await browser?.close();
    await app?.close();
  });

  test('logs in, renders overview metrics, toggles theme, and advances review queue', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/admin`);

    await expectVisible(page, page.getByRole('heading', { name: 'Admin access required' }));
    await page.getByPlaceholder('Admin token').fill('secret');
    await page.getByRole('button', { name: 'Unlock dashboard' }).click();

    await expectVisible(page, page.getByRole('heading', { name: 'Overview' }));
    await expectVisible(page, page.getByText('Total Feedback'));
    await expectVisible(page, page.getByText('2', { exact: true }).first());
    await expectVisible(page, page.getByRole('heading', { name: 'Review Queue' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Detector Source Distribution' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Model Performance' }));
    await expectVisible(page, page.getByRole('heading', { name: 'All Data Available' }));

    expect(await page.evaluate(() => localStorage.getItem('yapskippr.adminToken'))).toBeNull();
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole('button', { name: /system|dark|light/i }).click();
    const switchedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(switchedTheme).not.toBe(initialTheme);
    expect(await page.evaluate(() => localStorage.getItem('yapskippr.adminTheme'))).toBeTruthy();

    await page.getByRole('button', { name: 'Review Queue' }).click();
    await expectVisible(page, page.getByText('2', { exact: true }).first());
    await page.getByRole('button', { name: 'Positive', exact: true }).click();
    await expectVisible(page, page.getByText('1', { exact: true }).first());
    await expectVisible(page, page.locator('.recent-list').getByText('Positive'));

    await page.close();
  });
});

async function seedFeedback(
  app: FastifyInstance,
  occurrenceId: string,
  videoId: string,
  source: string,
  featureOverrides: Record<string, number> = {}
): Promise<void> {
  const payload = feedbackFixture({
    occurrenceId,
    videoId,
    source,
    candidateFeatures: {
      ...feedbackFixture().candidateFeatures,
      ...featureOverrides
    },
    modelConfidence: featureOverrides.modelConfidence ?? 0.82
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/feedback',
    payload
  });
  expect(response.statusCode).toBe(201);
}

async function expectVisible(page: Page, locator: ReturnType<Page['getByText']>): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 5_000 });
  expect(await locator.isVisible()).toBe(true);
}

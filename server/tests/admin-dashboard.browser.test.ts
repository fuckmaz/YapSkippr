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

  test('logs in, renders overview metrics, explores data, trains a model, and advances review queue', async () => {
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
    await expectVisible(page, page.getByRole('heading', { name: 'Extension Feedback' }));
    await expectVisible(page, page.getByText('Viewer confirmed the visible link report from the popup.'));
    await page.getByLabel('Admin review notes').click();
    await page.keyboard.type('Needs 1 more pass');
    await page.waitForTimeout(250);
    await expectVisible(page, page.locator('.queue-number').getByText('2', { exact: true }));
    await page.getByLabel('Admin review notes').fill('Confirmed visible link cue during review.');
    const positiveReviewResponse = page.waitForResponse((response) => response.url().includes('/admin/feedback/') && response.url().endsWith('/review'));
    await page.getByRole('button', { name: 'Positive', exact: true }).click();
    const positiveReview = await positiveReviewResponse;
    expect(positiveReview.status()).toBe(200);
    await expectVisible(page, page.getByText('1', { exact: true }).first());
    await expectVisible(page, page.locator('.recent-list').getByText('Positive'));
    await expectVisible(page, page.locator('.recent-list').getByText('Confirmed visible link cue during review.'));

    await page.getByRole('button', { name: 'Training' }).click();
    const rejectedTrainResponse = page.waitForResponse((response) => response.url().endsWith('/admin/models/train'));
    await page.getByRole('button', { name: 'Train model' }).click();
    expect((await rejectedTrainResponse).status()).toBe(400);
    await expectVisible(page, page.getByText('Training requires at least one positive and one negative reviewed example.'));

    await page.getByRole('button', { name: 'Feedback' }).click();
    await page.getByLabel('Search feedback').fill('candidate-link');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);
    await page.getByLabel('Search feedback').fill('');
    await page.getByLabel('Feedback source filter').selectOption('frame-visible-link');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);
    await page.getByLabel('Feedback source filter').selectOption('all');
    await page.getByLabel('Feedback review filter').selectOption('reviewed');
    await expectVisible(page, page.getByText('positive'));
    expect(await page.locator('.table-wrap tbody').getByText('Pending').count()).toBe(0);
    await page.getByLabel('Feedback review filter').selectOption('all');
    await page.getByLabel('Feedback sort').selectOption('model-desc');
    expect(await page.locator('tbody tr').first().innerText()).toContain('video-a');

    await page.getByRole('button', { name: 'Videos' }).click();
    await page.getByLabel('Search videos').fill('video-b');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);
    await page.getByLabel('Search videos').fill('');
    await page.getByLabel('Video source filter').selectOption('frame-visible-link');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);

    await page.getByRole('button', { name: 'Review Queue' }).click();
    const negativeReviewResponse = page.waitForResponse((response) => response.url().includes('/admin/feedback/') && response.url().endsWith('/review'));
    await page.getByRole('button', { name: 'False positive', exact: true }).click();
    const negativeReview = await negativeReviewResponse;
    expect(negativeReview.status()).toBe(200);
    await expectVisible(page, page.locator('.queue-number').getByText('0', { exact: true }));
    await expectVisible(page, page.getByText('Queue clear'));

    await page.getByRole('button', { name: 'Training' }).click();
    const trainResponse = page.waitForResponse((response) => response.url().endsWith('/admin/models/train'));
    await page.getByRole('button', { name: 'Train model' }).click();
    const trained = await trainResponse;
    expect(trained.status()).toBe(201);
    await expectVisible(page, page.getByRole('cell', { name: 'completed' }));

    await page.getByRole('button', { name: 'Models' }).click();
    await page.getByLabel('Search models').fill('model_');
    await expectVisible(page, page.getByText('model_', { exact: false }));
    await page.getByLabel('Model status filter').selectOption('draft');
    await expectVisible(page, page.getByRole('cell', { name: 'Draft' }));
    await page.getByLabel('Model sort').selectOption('f1-desc');
    await expectVisible(page, page.getByRole('columnheader', { name: 'F1' }));
    await page.getByLabel('Model status filter').selectOption('all');

    const evaluationResponse = page.waitForResponse((response) => response.url().includes('/admin/models/') && response.url().endsWith('/evaluation'));
    await page.getByRole('button', { name: 'Inspect model' }).click();
    expect((await evaluationResponse).status()).toBe(200);
    await expectVisible(page, page.getByRole('heading', { name: 'Model Evaluation' }));
    await expectVisible(page, page.getByText('Feature weights'));
    await expectVisible(page, page.getByText('Training summary'));

    const promoteResponse = page.waitForResponse((response) => response.url().includes('/admin/models/') && response.url().endsWith('/promote'));
    await page.getByRole('button', { name: 'Promote' }).click();
    expect((await promoteResponse).status()).toBe(200);
    await expectVisible(page, page.getByRole('cell', { name: 'Promoted' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Promotion History' }));
    await expectVisible(page, page.locator('.promotion-history').getByText('promote'));

    await page.getByRole('button', { name: 'Training' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Current Promoted Model' }));
    await expectVisible(page, page.getByText('F1 delta'));

    await page.close();
  }, 60_000);
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
    notes: source === 'frame-visible-link' ? 'Viewer confirmed the visible link report from the popup.' : undefined,
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

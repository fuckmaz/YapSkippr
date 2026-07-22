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

  test('finds anonymous client IDs in dashboard search and video summaries', async () => {
    const clientApp = await buildServer({ adminToken: 'secret' });
    await clientApp.listen({ host: '127.0.0.1', port: 0 });
    const address = clientApp.server.address();
    if (!address || typeof address === 'string') throw new Error('Could not bind client search test server.');
    const clientBaseUrl = `http://127.0.0.1:${address.port}`;
    await seedFeedback(clientApp, 'client-primary', 'video-client', 'frame-visible-link', {}, 'client_distinct_a');
    await seedFeedback(clientApp, 'client-duplicate', 'video-client', 'transcript', {}, 'client_distinct_a');
    await seedFeedback(clientApp, 'client-second', 'video-client', 'frame-qr-code', {}, 'client_distinct_b');
    await seedFeedback(clientApp, 'other-video', 'video-other', 'transcript', {}, 'client_other');

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${clientBaseUrl}/admin`);

      await page.getByPlaceholder('Admin token').fill('secret');
      await page.getByRole('button', { name: 'Unlock dashboard' }).click();

      await expectVisible(page, page.getByRole('heading', { name: 'Overview' }));
      await page.getByLabel('Search dashboard').fill('client_distinct_b');
      await expectVisible(page, page.getByRole('button', { name: 'Open feedback client-second' }));
      await expectVisible(page, page.getByRole('button', { name: 'Open video video-client' }));
      await expectVisible(page, page.getByText('Video · 3 feedback · 2 clients · 3 pending').first());

      await page.getByLabel('Search dashboard').fill('');
      await page.getByRole('button', { name: 'Videos' }).click();
      await expectVisible(page, page.getByRole('columnheader', { name: 'Clients' }));
      await page.getByLabel('Search videos').fill('client_distinct_b');
      await expectVisible(page, page.getByRole('cell', { name: 'video-client' }));
      expect(await page.getByRole('cell', { name: 'video-other' }).count()).toBe(0);

      const videoClientRow = page.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'video-client' }) });
      expect((await videoClientRow.locator('td').nth(2).innerText()).trim()).toBe('2');
    } finally {
      await page.close();
      await clientApp.close();
    }
  }, 30_000);

  test('logs in, renders overview metrics, explores data, trains a model, and advances review queue', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/admin`);

    await expectVisible(page, page.getByRole('heading', { name: 'Admin access required' }));
    await page.getByPlaceholder('Admin token').fill('secret');
    await page.getByRole('button', { name: 'Unlock dashboard' }).click();

    await expectVisible(page, page.getByRole('heading', { name: 'Overview' }));
    await expectVisible(page, page.getByText('Total Feedback'));
    await expectVisible(page, page.getByText('Reporting Clients'));
    await expectVisible(page, page.getByText('2', { exact: true }).first());
    await expectVisible(page, page.getByRole('heading', { name: 'Review Queue' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Detector Source Distribution' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Detector Quality' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Model Performance' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Training Dataset' }));
    await expectVisible(page, page.getByText('Compatible examples', { exact: true }));
    await expectVisible(page, page.getByRole('heading', { name: 'All Data Available' }));

    await page.getByLabel('Search dashboard').fill('candidate-link');
    await expectVisible(page, page.getByRole('heading', { name: 'Search Results' }));
    await expectVisible(page, page.getByText('candidate-link').first());
    await expectVisible(page, page.getByText('Feedback · video-b').first());
    await page.getByRole('button', { name: 'Open feedback candidate-link' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Feedback' }));
    await expectVisible(page, page.getByRole('cell', { name: 'candidate-link', exact: true }));
    await page.getByRole('button', { name: 'Overview' }).click();

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
    await expectVisible(page, page.getByLabel('Review queue source filter'));
    await page.getByLabel('Review queue source filter').selectOption('frame-visible-link');
    await expectVisible(page, page.locator('.queue-number').getByText('1', { exact: true }));
    await page.getByLabel('Review queue source filter').selectOption('all');
    await expectVisible(page, page.locator('.queue-number').getByText('2', { exact: true }));
    const reviewFacts = page.locator('.review-facts');
    await expectVisible(page, reviewFacts.getByText('candidate-link', { exact: true }));
    await expectVisible(page, reviewFacts.getByText('video-b', { exact: true }));
    await expectVisible(page, reviewFacts.getByText('client_candidate-link', { exact: true }));
    await expectVisible(page, reviewFacts.getByText('Model source'));
    await expectVisible(page, reviewFacts.getByText('downloaded', { exact: true }));
    const reviewTimecodeLink = page.getByRole('link', { name: 'Open review item at timecode' });
    await expectVisible(page, reviewTimecodeLink);
    expect(await reviewTimecodeLink.getAttribute('href')).toContain('t=42s');
    expect(await page.getByRole('button', { name: 'Positive', exact: true }).getAttribute('aria-keyshortcuts')).toBe('1');
    expect(await page.getByRole('button', { name: 'False positive', exact: true }).getAttribute('aria-keyshortcuts')).toBe('2');
    await page.getByLabel('Admin review notes').click();
    await page.keyboard.type('Needs 1 more pass');
    await page.waitForTimeout(250);
    await expectVisible(page, page.locator('.queue-number').getByText('2', { exact: true }));
    await page.getByLabel('Admin review notes').fill('Confirmed visible link cue during review.');

    await page.route('**/admin/feedback/*/review', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Review service unavailable.' })
      });
    });
    const failedReviewResponse = page.waitForResponse((response) => response.url().includes('/admin/feedback/') && response.url().endsWith('/review'));
    await page.getByRole('button', { name: 'Positive', exact: true }).click();
    expect((await failedReviewResponse).status()).toBe(503);
    await expectVisible(page, page.locator('.inline-alert').getByText('Review service unavailable.'));
    await expectVisible(page, page.locator('.review-focus').getByText('candidate-link', { exact: true }));
    expect(await page.getByLabel('Admin review notes').inputValue()).toBe('Confirmed visible link cue during review.');
    await page.unroute('**/admin/feedback/*/review');

    const positiveReviewResponse = page.waitForResponse((response) => response.url().includes('/admin/feedback/') && response.url().endsWith('/review'));
    await page.getByRole('button', { name: 'Positive', exact: true }).click();
    const positiveReview = await positiveReviewResponse;
    expect(positiveReview.status()).toBe(200);
    await expectVisible(page, page.getByText('1', { exact: true }).first());
    expect(await page.getByText('Review service unavailable.').count()).toBe(0);
    await expectVisible(page, page.locator('.recent-list').getByText('Positive'));
    await expectVisible(page, page.locator('.recent-list').getByText('Confirmed visible link cue during review.'));

    await page.getByRole('button', { name: 'Training' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Training Readiness' }));
    const trainingDatasetExportLink = page.getByRole('link', { name: 'Download training dataset JSON' });
    await expectVisible(page, trainingDatasetExportLink);
    expect(await trainingDatasetExportLink.getAttribute('href')).toBe('/admin/training-dataset/export');
    await expectVisible(page, page.getByRole('heading', { name: 'Training Dataset Explorer' }));
    await expectVisible(page, page.getByRole('columnheader', { name: 'Trainable' }));
    await expectVisible(page, page.getByText('candidate-link').first());
    await page.getByLabel('Training dataset source filter').selectOption('frame-visible-link');
    await expectVisible(page, page.getByText('candidate-link').first());
    expect(await page.getByText('candidate-positive').count()).toBe(0);
    await page.getByLabel('Training dataset source filter').selectOption('all');
    await page.getByLabel('Training dataset status filter').selectOption('blocked');
    await expectVisible(page, page.getByText('Feedback has not been reviewed yet.').first());
    await page.getByLabel('Training dataset status filter').selectOption('all');
    await page.getByLabel('Search training dataset').fill('candidate-link');
    await expectVisible(page, page.getByText('candidate-link').first());
    expect(await page.getByText('candidate-positive').count()).toBe(0);
    await page.getByLabel('Search training dataset').fill('');
    await page.getByLabel('Training dataset sort').selectOption('time-asc');
    await expectVisible(page, page.locator('.training-dataset-panel').getByRole('columnheader', { name: 'Actions' }));
    await page.getByRole('button', { name: 'Inspect dataset row candidate-link' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Training Dataset Details' }));
    await expectVisible(page, page.getByText('visibleLinkCount'));
    await expectVisible(page, page.locator('.training-dataset-detail-grid').getByText('Model confidence'));
    await expectVisible(page, page.locator('.training-dataset-detail-grid').getByText('Model source'));
    await expectVisible(page, page.locator('.training-dataset-detail-grid').getByText('downloaded', { exact: true }));
    await expectVisible(page, page.getByText('Evidence snapshot'));
    await expectVisible(page, page.getByText('This video is sponsored by Acme. Use code YAP.'));
    await expectVisible(page, page.locator('.training-readiness').getByText('Schema 2', { exact: true }));
    await expectVisible(page, page.getByText('1 compatible'));
    await expectVisible(page, page.getByText('1 positive · 0 negative'));
    const rejectedTrainResponse = page.waitForResponse((response) => response.url().endsWith('/admin/models/train'));
    await page.getByRole('button', { name: 'Train model' }).click();
    expect((await rejectedTrainResponse).status()).toBe(400);
    await expectVisible(page, page.locator('.inline-alert').getByText('Training requires at least one positive and one negative reviewed example for feature schema 2.'));

    await page.getByRole('button', { name: 'Feedback' }).click();
    await page.getByLabel('Search feedback').fill('candidate-link');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    await page.getByRole('button', { name: 'Inspect feedback candidate-link' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Feedback Details' }));
    await expectVisible(page, page.getByText('Candidate features'));
    await expectVisible(page, page.getByText('visibleLinkCount'));
    await expectVisible(page, page.locator('.feedback-detail-grid').getByText('Model source'));
    await expectVisible(page, page.locator('.feedback-detail-grid').getByText('downloaded', { exact: true }));
    await expectVisible(page, page.getByText('Transcript context'));
    await expectVisible(page, page.getByText('This video is sponsored by Acme. Use code YAP.'));
    const timecodeLink = page.getByRole('link', { name: 'Open at timecode' });
    await expectVisible(page, timecodeLink);
    expect(await timecodeLink.getAttribute('href')).toContain('t=42s');
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);
    await page.getByLabel('Search feedback').fill('');
    await page.getByLabel('Feedback source filter').selectOption('frame-visible-link');
    await expectVisible(page, page.getByRole('cell', { name: 'video-b' }));
    expect(await page.getByRole('cell', { name: 'video-a' }).count()).toBe(0);
    await page.getByLabel('Feedback source filter').selectOption('all');
    await page.getByLabel('Feedback review filter').selectOption('reviewed');
    await expectVisible(page, page.getByText('positive', { exact: true }));
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
    await page.keyboard.press('2');
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
    await expectVisible(page, page.locator('.training-runs-panel').getByRole('columnheader', { name: 'Actions' }));
    await page.locator('.training-runs-panel tbody tr').first().getByRole('button', { name: /Inspect training run / }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Training Run Details' }));
    await expectVisible(page, page.getByText('Dataset split'));
    await expectVisible(page, page.getByText('Validation metrics'));
    await expectVisible(page, page.getByText('No promoted model is currently available for comparison.'));

    await page.getByRole('button', { name: 'Models' }).click();
    await page.getByLabel('Search models').fill('model_');
    await expectVisible(page, page.getByText('model_', { exact: false }));
    await page.getByLabel('Model status filter').selectOption('draft');
    await expectVisible(page, page.getByRole('cell', { name: 'Draft' }));
    await page.getByLabel('Model sort').selectOption('f1-desc');
    await expectVisible(page, page.getByRole('columnheader', { name: 'F1' }));
    await page.getByLabel('Model status filter').selectOption('all');
    const modelRow = page.locator('tbody tr').filter({ hasText: /model_/ }).first();

    const evaluationResponse = page.waitForResponse((response) => response.url().includes('/admin/models/') && response.url().endsWith('/evaluation'));
    await modelRow.getByRole('button', { name: 'Inspect model' }).click();
    expect((await evaluationResponse).status()).toBe(200);
    await expectVisible(page, page.getByRole('heading', { name: 'Model Evaluation' }));
    const artifactExportLink = modelRow.getByRole('link', { name: /Download artifact JSON for model_/ });
    const evaluationExportLink = modelRow.getByRole('link', { name: /Download evaluation JSON for model_/ });
    await expectVisible(page, artifactExportLink);
    await expectVisible(page, evaluationExportLink);
    expect(await artifactExportLink.getAttribute('href')).toMatch(/^\/admin\/models\/model_[^/]+\/artifact$/);
    expect(await evaluationExportLink.getAttribute('href')).toMatch(/^\/admin\/models\/model_[^/]+\/evaluation\/export$/);
    await expectVisible(page, page.getByText('Feature weights'));
    await expectVisible(page, page.getByText('Training summary'));
    await expectVisible(page, page.getByText('Artifact metadata'));
    await expectVisible(page, page.getByText('Feature schema'));
    await expectVisible(page, page.getByText('Thresholds'));
    await expectVisible(page, page.getByText('Promoted comparison'));
    await expectVisible(page, page.getByText('No promoted baseline yet.'));
    await expectVisible(page, page.locator('.model-detail-grid').getByText('positive', { exact: true }));

    let failedPromoteIntercepted = false;
    await page.route('**/admin/models/*/promote', async (route) => {
      if (failedPromoteIntercepted) {
        await route.continue();
        return;
      }
      failedPromoteIntercepted = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Promotion service unavailable.' })
      });
    });
    const failedPromoteResponse = page.waitForResponse((response) => response.url().includes('/admin/models/') && response.url().endsWith('/promote'));
    await page.getByRole('button', { name: 'Promote' }).click();
    expect((await failedPromoteResponse).status()).toBe(500);
    await expectVisible(page, page.getByText('Promotion service unavailable.'));
    await page.unroute('**/admin/models/*/promote');

    const promoteResponse = page.waitForResponse((response) => response.url().includes('/admin/models/') && response.url().endsWith('/promote'));
    await page.getByRole('button', { name: 'Promote' }).click();
    expect((await promoteResponse).status()).toBe(200);
    expect(await page.getByText('Promotion service unavailable.').count()).toBe(0);
    await expectVisible(page, page.getByRole('cell', { name: 'Promoted' }));
    await expectVisible(page, page.getByRole('heading', { name: 'Promotion History' }));
    await expectVisible(page, page.locator('.promotion-history').getByText('promote'));

    await page.getByRole('button', { name: 'Training' }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Current Promoted Model' }));
    await page.locator('.training-runs-panel tbody tr').first().getByRole('button', { name: /Inspect training run / }).click();
    await expectVisible(page, page.getByRole('heading', { name: 'Training Run Details' }));
    await expectVisible(page, page.getByText('Comparison to promoted model'));
    await expectVisible(page, page.locator('.training-run-detail-panel').getByText('F1 delta'));

    await page.close();
  }, 60_000);
});

async function seedFeedback(
  app: FastifyInstance,
  occurrenceId: string,
  videoId: string,
  source: string,
  featureOverrides: Record<string, number> = {},
  clientId = `client_${occurrenceId}`
): Promise<void> {
  const payload = feedbackFixture({
    clientId,
    occurrenceId,
    videoId,
    source,
    notes: source === 'frame-visible-link' ? 'Viewer confirmed the visible link report from the popup.' : undefined,
    candidateFeatures: {
      ...feedbackFixture().candidateFeatures,
      ...featureOverrides
    },
    modelSource: source === 'frame-visible-link' ? 'downloaded' : 'bundled',
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

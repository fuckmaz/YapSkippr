import { describe, expect, test } from 'vitest';
import { buildServer, resolveAdminToken } from '../src/app';
import type { CandidateModelArtifact } from '../src/model/types';
import { createMemoryRepository } from '../src/store/memory';
import { feedbackFixture } from './fixtures';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('YapSkippr server API', () => {
  test('refuses to start in production without an explicit admin token', async () => {
    expect(() => resolveAdminToken(undefined, { NODE_ENV: 'production' })).toThrow('ADMIN_TOKEN must be configured in production.');
    expect(() => resolveAdminToken(undefined, { NODE_ENV: 'production', ADMIN_TOKEN: 'short' })).toThrow('ADMIN_TOKEN must be at least 24 characters in production.');
    expect(resolveAdminToken(undefined, { NODE_ENV: 'development' })).toBe('dev-admin-token');
  });

  test('only emits CORS allow-origin for configured extension origins', async () => {
    const app = await buildServer({
      adminToken: 'secret',
      allowedExtensionOrigins: ['chrome-extension://*', 'moz-extension://*', 'https://trusted.example']
    });

    const chromePreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feedback',
      headers: {
        origin: 'chrome-extension://abcdef',
        'access-control-request-method': 'POST'
      }
    });
    expect(chromePreflight.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');

    const trustedPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feedback',
      headers: {
        origin: 'https://trusted.example',
        'access-control-request-method': 'POST'
      }
    });
    expect(trustedPreflight.headers['access-control-allow-origin']).toBe('https://trusted.example');

    const rejectedPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/feedback',
      headers: {
        origin: 'https://untrusted.example',
        'access-control-request-method': 'POST'
      }
    });
    expect(rejectedPreflight.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  test('rejects oversized request bodies before feedback validation', async () => {
    const app = await buildServer({ adminToken: 'secret', bodyLimitBytes: 512 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ transcriptContext: 'x'.repeat(2_000) })
    });

    expect(response.statusCode).toBe(413);

    await app.close();
  });

  test('preserves accepted feedback model sources and rejects unknown sources', async () => {
    const app = await buildServer({ adminToken: 'secret' });
    const modelSources = ['bundled', 'downloaded', 'fallback'] as const;

    for (const modelSource of modelSources) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        payload: feedbackFixture({
          occurrenceId: `model-source-${modelSource}`,
          modelSource
        })
      });

      expect(response.statusCode).toBe(201);
    }

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: {
        ...feedbackFixture({ occurrenceId: 'model-source-remote' }),
        modelSource: 'remote'
      }
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      ok: false,
      error: 'Invalid feedback payload.',
      details: {
        fieldErrors: {
          modelSource: expect.arrayContaining([expect.any(String)])
        }
      }
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/api/feedback',
      headers: { 'x-admin-token': 'secret' }
    });

    expect(listed.statusCode).toBe(200);
    const sourceByOccurrence = Object.fromEntries(
      listed.json().items.map((item: { payload: { occurrenceId: string; modelSource?: string } }) => [
        item.payload.occurrenceId,
        item.payload.modelSource
      ])
    );
    expect(sourceByOccurrence).toMatchObject({
      'model-source-bundled': 'bundled',
      'model-source-downloaded': 'downloaded',
      'model-source-fallback': 'fallback'
    });
    expect(sourceByOccurrence).not.toHaveProperty('model-source-remote');

    await app.close();
  });

  test('rate limits public feedback submissions with retry headers', async () => {
    const app = await buildServer({
      adminToken: 'secret',
      feedbackRateLimit: { max: 2, windowMs: 60_000 }
    });

    const first = await app.inject({ method: 'POST', url: '/api/v1/feedback', payload: feedbackFixture({ occurrenceId: 'rate-limit-1' }) });
    const second = await app.inject({ method: 'POST', url: '/api/v1/feedback', payload: feedbackFixture({ occurrenceId: 'rate-limit-2' }) });
    const limited = await app.inject({ method: 'POST', url: '/api/v1/feedback', payload: feedbackFixture({ occurrenceId: 'rate-limit-3' }) });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers['x-ratelimit-limit']).toBe('2');
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');
    expect(limited.json()).toMatchObject({
      ok: false,
      error: 'Too many feedback submissions. Try again later.'
    });

    await app.close();
  });

  test('rate limits admin session attempts with retry headers', async () => {
    const app = await buildServer({
      adminToken: 'secret',
      adminSessionRateLimit: { max: 1, windowMs: 60_000 }
    });

    const first = await app.inject({
      method: 'POST',
      url: '/admin/session',
      payload: { token: 'wrong' }
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/admin/session',
      payload: { token: 'still-wrong' }
    });

    expect(first.statusCode).toBe(401);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers['x-ratelimit-limit']).toBe('1');
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');
    expect(limited.json()).toMatchObject({
      ok: false,
      error: 'Too many admin session attempts. Try again later.'
    });

    await app.close();
  });

  test('persists feedback v2 payloads and protects admin data', async () => {
    const app = await buildServer({ adminToken: 'secret' });
    const legacyPayload = feedbackFixture();
    delete legacyPayload.clientId;

    const feedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: legacyPayload
    });
    expect(feedback.statusCode).toBe(201);
    expect(feedback.json()).toMatchObject({ ok: true, feedbackId: expect.any(String) });

    const blocked = await app.inject({ method: 'GET', url: '/admin/api/feedback' });
    expect(blocked.statusCode).toBe(401);

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/api/feedback',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      payload: {
        version: 2,
        candidateFeatures: {
          transcriptStartCount: 1
        },
        transcriptContext: 'This video is sponsored by Acme. Use code YAP.'
      },
      review: null
    });

    await app.close();
  });

  test('requires valid structured boundaries for wrong-timing reviews', async () => {
    const app = await buildServer({ adminToken: 'secret' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ startSeconds: 42, endSeconds: 90, feedback: 'wrong_timing' })
    });
    const feedbackId = created.json().feedbackId;

    const missing = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'wrong_timing' }
    });
    expect(missing.statusCode).toBe(400);

    const inverted = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: {
        label: 'wrong_timing',
        boundaryCorrection: { startSeconds: 50, endSeconds: 49 }
      }
    });
    expect(inverted.statusCode).toBe(400);

    const accepted = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: {
        label: 'wrong_timing',
        boundaryCorrection: { startSeconds: 47, endSeconds: 96 }
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().item.review.boundaryCorrection).toEqual({
      startSeconds: 47,
      endSeconds: 96
    });

    await app.close();
  });

  test('embeds holdout-proven boundary corrections in trained model artifacts', async () => {
    const repository = createMemoryRepository(() => '2026-07-24T10:00:00.000Z');
    for (const [index, label] of ['positive', 'false_positive'].entries()) {
      const record = await repository.createFeedback(feedbackFixture({
        occurrenceId: `confidence-${index}`,
        videoId: `confidence-video-${index}`,
        feedback: label === 'positive' ? 'accurate' : 'false_positive'
      }));
      await repository.reviewFeedback(record.id, label as 'positive' | 'false_positive');
    }
    for (let index = 0; index < 30; index += 1) {
      const startSeconds = 100 + index;
      const endSeconds = 160 + index;
      const record = await repository.createFeedback(feedbackFixture({
        occurrenceId: `timing-${index}`,
        videoId: `timing-video-${index}`,
        source: 'transcript',
        startSeconds,
        endSeconds,
        feedback: 'wrong_timing'
      }));
      await repository.reviewFeedback(record.id, 'wrong_timing', undefined, {
        startSeconds: startSeconds + 5,
        endSeconds: endSeconds + 6
      });
    }
    const app = await buildServer({ adminToken: 'secret', repository });

    const trained = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });

    expect(trained.statusCode).toBe(201);
    expect(trained.json().model.boundaryCalibration).toMatchObject({
      version: 1,
      global: {
        startOffsetSeconds: 5,
        endOffsetSeconds: 6,
        calibratedMaeSeconds: 0
      },
      bySource: {
        transcript: {
          startOffsetSeconds: 5,
          endOffsetSeconds: 6
        }
      }
    });

    await app.close();
  });

  test('protects the admin dashboard with an admin session cookie', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const unauthenticatedDashboard = await app.inject({ method: 'GET', url: '/admin' });
    expect(unauthenticatedDashboard.statusCode).toBe(200);
    expect(unauthenticatedDashboard.body).toContain('Admin access required');
    expect(unauthenticatedDashboard.body).not.toContain('/admin/assets/');

    const rejectedSession = await app.inject({
      method: 'POST',
      url: '/admin/session',
      payload: { token: 'wrong' }
    });
    expect(rejectedSession.statusCode).toBe(401);

    const acceptedSession = await app.inject({
      method: 'POST',
      url: '/admin/session',
      payload: { token: 'secret' }
    });
    expect(acceptedSession.statusCode).toBe(200);
    const cookie = acceptedSession.headers['set-cookie'];
    expect(cookie).toEqual(expect.stringContaining('yapskippr_admin='));

    const session = Array.isArray(cookie) ? cookie[0] : cookie;
    const apiWithCookie = await app.inject({
      method: 'GET',
      url: '/admin/api/feedback',
      headers: { cookie: session }
    });
    expect(apiWithCookie.statusCode).toBe(200);

    const dashboardWithCookie = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { cookie: session }
    });
    expect(dashboardWithCookie.statusCode).toBe(200);
    expect(dashboardWithCookie.body).not.toContain('Admin access required');

    await app.close();
  });

  test('protects built admin dashboard assets with admin auth', async () => {
    const originalCwd = process.cwd();
    const tempCwd = mkdtempSync(path.join(tmpdir(), 'yapskippr-admin-assets-'));
    const adminDist = path.join(tempCwd, 'dist/admin');
    const adminAssets = path.join(adminDist, 'assets');
    mkdirSync(adminAssets, { recursive: true });
    writeFileSync(
      path.join(adminDist, 'index.html'),
      '<!doctype html><html><head><script type="module" src="/admin/assets/app.js"></script></head><body><div id="root">React admin</div></body></html>'
    );
    writeFileSync(path.join(adminAssets, 'app.js'), 'globalThis.yapskipprAdmin = true;\n');

    let app: Awaited<ReturnType<typeof buildServer>> | undefined;
    try {
      process.chdir(tempCwd);
      app = await buildServer({ adminToken: 'secret' });

      const unauthenticatedDashboard = await app.inject({ method: 'GET', url: '/admin' });
      expect(unauthenticatedDashboard.statusCode).toBe(200);
      expect(unauthenticatedDashboard.body).toContain('Admin access required');
      expect(unauthenticatedDashboard.body).not.toContain('/admin/assets/');

      const unauthenticatedAsset = await app.inject({ method: 'GET', url: '/admin/assets/app.js' });
      expect(unauthenticatedAsset.statusCode).toBe(404);
      expect(unauthenticatedAsset.body).not.toContain('yapskipprAdmin');

      const tokenAsset = await app.inject({
        method: 'GET',
        url: '/admin/assets/app.js',
        headers: { 'x-admin-token': 'secret' }
      });
      expect(tokenAsset.statusCode).toBe(200);
      expect(tokenAsset.body).toBe('globalThis.yapskipprAdmin = true;\n');

      const acceptedSession = await app.inject({
        method: 'POST',
        url: '/admin/session',
        payload: { token: 'secret' }
      });
      expect(acceptedSession.statusCode).toBe(200);
      const cookie = acceptedSession.headers['set-cookie'];
      const session = Array.isArray(cookie) ? cookie[0] : cookie;
      expect(session).toEqual(expect.stringContaining('yapskippr_admin='));

      const cookieAsset = await app.inject({
        method: 'GET',
        url: '/admin/assets/app.js',
        headers: { cookie: session }
      });
      expect(cookieAsset.statusCode).toBe(200);
      expect(cookieAsset.body).toBe('globalThis.yapskipprAdmin = true;\n');

      const dashboardWithCookie = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: { cookie: session }
      });
      expect(dashboardWithCookie.statusCode).toBe(200);
      expect(dashboardWithCookie.body).toContain('/admin/assets/app.js');
      expect(dashboardWithCookie.body).not.toContain('Admin access required');
    } finally {
      await app?.close();
      process.chdir(originalCwd);
      rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  test('marks admin session cookies secure in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = await buildServer({
      adminToken: 'super-secret-admin-token-32-chars',
      repository: createMemoryRepository()
    });

    try {
      const acceptedSession = await app.inject({
        method: 'POST',
        url: '/admin/session',
        payload: { token: 'super-secret-admin-token-32-chars' }
      });

      expect(acceptedSession.statusCode).toBe(200);
      expect(acceptedSession.headers['set-cookie']).toEqual(expect.stringContaining('Secure'));
    } finally {
      await app.close();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('review and training work end to end while unsafe tiny models cannot be promoted', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const positive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ occurrenceId: 'candidate-positive', videoId: 'video-a', feedback: 'accurate' })
    });
    const negative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-negative',
        videoId: 'video-b',
        feedback: 'false_positive',
        candidateFeatures: {
          ...feedbackFixture().candidateFeatures,
          transcriptStartCount: 0,
          visibleLinkCount: 1,
          sponsorPhraseHitCount: 0
        }
      })
    });

    for (const [response, label] of [
      [positive, 'positive'],
      [negative, 'false_positive']
    ] as const) {
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: { label, notes: 'reviewed in test' }
      });
      expect(review.statusCode).toBe(200);
    }

    const train = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(train.statusCode).toBe(201);
    expect(train.json().model).toMatchObject({
      modelId: expect.any(String),
      featureSchemaVersion: 2,
      weights: expect.objectContaining({
        heuristicConfidence: expect.any(Number)
      }),
      metrics: expect.objectContaining({
        accuracy: expect.any(Number)
      })
    });

    const promote = await app.inject({
      method: 'POST',
      url: `/admin/models/${train.json().model.modelId}/promote`,
      headers: { 'x-admin-token': 'secret' }
    });
    expect(promote.statusCode).toBe(409);
    expect(promote.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining('Promotion blocked:'),
      blockers: expect.arrayContaining([
        expect.stringContaining('not calibrated'),
        expect.stringContaining('Holdout calibration examples')
      ])
    });

    await app.close();
  });

  test('promotes, serves, and rolls back a model that passes safety gates', async () => {
    const repository = createMemoryRepository();
    const safeModel = modelArtifact('model-safe', '2026.07.24.000000', {
      thresholdsCalibrated: 1,
      thresholdCalibrationExamples: 40,
      thresholdCalibrationPositives: 20,
      thresholdCalibrationNegatives: 20,
      thresholdCalibrationGroups: 10,
      positivePrecision: 0.95,
      positiveRecall: 0.75,
      reviewRecall: 0.98,
      auc: 0.9
    });
    await repository.saveModel(safeModel);
    const app = await buildServer({ adminToken: 'secret', repository });

    const promote = await app.inject({
      method: 'POST',
      url: '/admin/models/model-safe/promote',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(promote.statusCode).toBe(200);

    const latest = await app.inject({ method: 'GET', url: '/api/v1/model/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().modelId).toBe('model-safe');

    const rollback = await app.inject({
      method: 'POST',
      url: '/admin/models/model-safe/rollback',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json()).toMatchObject({ ok: true });

    await app.close();
  });

  test('re-reviewing feedback replaces its training example instead of duplicating stale labels', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const feedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ occurrenceId: 'candidate-relabel', videoId: 'video-a' })
    });
    expect(feedback.statusCode).toBe(201);
    const feedbackId = feedback.json().feedbackId;

    const firstReview = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'positive' }
    });
    expect(firstReview.statusCode).toBe(200);

    const secondReview = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'false_positive' }
    });
    expect(secondReview.statusCode).toBe(200);

    const positive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ occurrenceId: 'candidate-positive-peer', videoId: 'video-b' })
    });
    expect(positive.statusCode).toBe(201);
    const positiveReview = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${positive.json().feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'positive' }
    });
    expect(positiveReview.statusCode).toBe(200);

    const train = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(train.statusCode).toBe(201);
    expect(train.json().model.trainingSetSummary).toMatchObject({
      examples: 2,
      positives: 1,
      negatives: 1
    });

    await app.close();
  });

  test('requires both positive and negative reviewed examples before training', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const feedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({ occurrenceId: 'candidate-positive-only', videoId: 'video-a' })
    });
    expect(feedback.statusCode).toBe(201);

    const review = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${feedback.json().feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'positive' }
    });
    expect(review.statusCode).toBe(200);

    const train = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(train.statusCode).toBe(400);
    expect(train.json()).toMatchObject({
      ok: false,
      error: 'Training requires at least one positive and one negative reviewed example for feature schema 2.'
    });

    await app.close();
  });

  test('trains only reviewed examples that match the current feature schema', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const oldSchemaPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-old-schema-positive',
        videoId: 'video-old',
        featureSchemaVersion: 1
      })
    });
    const currentSchemaNegative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-schema-negative',
        videoId: 'video-current-negative',
        feedback: 'false_positive',
        candidateFeatures: {
          ...feedbackFixture().candidateFeatures,
          transcriptStartCount: 0,
          visibleLinkCount: 1,
          sponsorPhraseHitCount: 0
        }
      })
    });

    for (const [response, label] of [
      [oldSchemaPositive, 'positive'],
      [currentSchemaNegative, 'false_positive']
    ] as const) {
      expect(response.statusCode).toBe(201);
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: { label }
      });
      expect(review.statusCode).toBe(200);
    }

    const mixedSchemaTrain = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(mixedSchemaTrain.statusCode).toBe(400);
    expect(mixedSchemaTrain.json()).toMatchObject({
      ok: false,
      error: 'Training requires at least one positive and one negative reviewed example for feature schema 2.'
    });

    const currentSchemaPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-schema-positive',
        videoId: 'video-current-positive'
      })
    });
    expect(currentSchemaPositive.statusCode).toBe(201);
    const currentSchemaPositiveReview = await app.inject({
      method: 'POST',
      url: `/admin/feedback/${currentSchemaPositive.json().feedbackId}/review`,
      headers: { 'x-admin-token': 'secret' },
      payload: { label: 'positive' }
    });
    expect(currentSchemaPositiveReview.statusCode).toBe(200);

    const train = await app.inject({
      method: 'POST',
      url: '/admin/models/train',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(train.statusCode).toBe(201);
    expect(train.json().model).toMatchObject({
      featureSchemaVersion: 2,
      trainingSetSummary: {
        examples: 2,
        positives: 1,
        negatives: 1
      }
    });

    await app.close();
  });

  test('reports training readiness from schema-compatible reviewed examples', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const oldSchemaPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-old-schema-summary',
        videoId: 'video-old-summary',
        clientId: 'client_alpha',
        featureSchemaVersion: 1
      })
    });
    const currentSchemaPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-positive-summary',
        videoId: 'video-current-positive-summary',
        clientId: 'client_beta'
      })
    });
    const currentSchemaNegative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-negative-summary',
        videoId: 'video-current-negative-summary',
        clientId: 'client_beta',
        feedback: 'false_positive',
        candidateFeatures: {
          ...feedbackFixture().candidateFeatures,
          transcriptStartCount: 0,
          visibleLinkCount: 1,
          sponsorPhraseHitCount: 0
        }
      })
    });

    for (const [response, label] of [
      [oldSchemaPositive, 'positive'],
      [currentSchemaPositive, 'positive'],
      [currentSchemaNegative, 'false_positive']
    ] as const) {
      expect(response.statusCode).toBe(201);
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: { label }
      });
      expect(review.statusCode).toBe(200);
    }

    const summary = await app.inject({
      method: 'GET',
      url: '/admin/api/summary',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      uniqueClients: 2,
      trainingReadiness: {
        featureSchemaVersion: 2,
        totalExamples: 3,
        compatibleExamples: 2,
        incompatibleExamples: 1,
        positiveExamples: 1,
        negativeExamples: 1,
        ready: true,
        blocker: null
      }
    });

    await app.close();
  });

  test('summarizes detector quality by source', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const transcriptPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-transcript-quality',
        videoId: 'video-quality-a',
        source: 'transcript'
      })
    });
    const linkPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-link-quality-positive',
        videoId: 'video-quality-b',
        source: 'frame-visible-link'
      })
    });
    const linkFalsePositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-link-quality-negative',
        videoId: 'video-quality-c',
        source: 'frame-visible-link',
        feedback: 'false_positive'
      })
    });

    for (const [response, label] of [
      [transcriptPositive, 'positive'],
      [linkPositive, 'positive'],
      [linkFalsePositive, 'false_positive']
    ] as const) {
      expect(response.statusCode).toBe(201);
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: { label }
      });
      expect(review.statusCode).toBe(200);
    }

    const summary = await app.inject({
      method: 'GET',
      url: '/admin/api/summary',
      headers: { 'x-admin-token': 'secret' }
    });

    expect(summary.statusCode).toBe(200);
    expect(summary.json().detectorQuality).toEqual([
      {
        source: 'frame-visible-link',
        total: 2,
        reviewed: 2,
        pending: 0,
        positive: 1,
        falsePositive: 1,
        wrongTiming: 0,
        duplicate: 0,
        ignored: 0,
        needsMoreData: 0,
        trainablePositive: 1,
        trainableNegative: 1,
        positiveRate: 0.5
      },
      {
        source: 'transcript',
        total: 1,
        reviewed: 1,
        pending: 0,
        positive: 1,
        falsePositive: 0,
        wrongTiming: 0,
        duplicate: 0,
        ignored: 0,
        needsMoreData: 0,
        trainablePositive: 1,
        trainableNegative: 0,
        positiveRate: 1
      }
    ]);

    await app.close();
  });

  test('lists admin training dataset rows with trainability reasons', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const trainablePositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'dataset-positive',
        videoId: 'video-dataset-a',
        source: 'transcript'
      })
    });
    const incompatibleNegative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'dataset-incompatible',
        videoId: 'video-dataset-b',
        source: 'frame-visible-link',
        feedback: 'false_positive',
        featureSchemaVersion: 1
      })
    });
    const timingFeedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'dataset-wrong-timing',
        videoId: 'video-dataset-c',
        source: 'frame-progress-bar',
        feedback: 'wrong_timing'
      })
    });

    for (const [response, label] of [
      [trainablePositive, 'positive'],
      [incompatibleNegative, 'false_positive'],
      [timingFeedback, 'wrong_timing']
    ] as const) {
      expect(response.statusCode).toBe(201);
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: {
          label,
          ...(label === 'wrong_timing' ? {
            boundaryCorrection: { startSeconds: 47, endSeconds: 96 }
          } : {})
        }
      });
      expect(review.statusCode).toBe(200);
    }

    const blocked = await app.inject({ method: 'GET', url: '/admin/api/training-dataset' });
    expect(blocked.statusCode).toBe(401);

    const dataset = await app.inject({
      method: 'GET',
      url: '/admin/api/training-dataset',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(dataset.statusCode).toBe(200);
    expect(dataset.json().items).toEqual([
      expect.objectContaining({
        occurrenceId: 'dataset-wrong-timing',
        source: 'frame-progress-bar',
        reviewLabel: 'wrong_timing',
        trainingLabel: null,
        featureSchemaVersion: 2,
        featureCount: Object.keys(feedbackFixture().candidateFeatures ?? {}).length,
        compatible: true,
        trainable: false,
        exclusionReason: 'wrong_timing is stored for boundary analysis, not confidence training.',
        boundaryTrainable: true,
        boundaryCorrection: { startSeconds: 47, endSeconds: 96 },
        startOffsetSeconds: 5,
        endOffsetSeconds: null
      }),
      expect.objectContaining({
        occurrenceId: 'dataset-incompatible',
        source: 'frame-visible-link',
        reviewLabel: 'false_positive',
        trainingLabel: 0,
        featureSchemaVersion: 1,
        compatible: false,
        trainable: false,
        exclusionReason: 'Feature schema 1 is not compatible with active schema 2.'
      }),
      expect.objectContaining({
        occurrenceId: 'dataset-positive',
        source: 'transcript',
        reviewLabel: 'positive',
        trainingLabel: 1,
        featureSchemaVersion: 2,
        compatible: true,
        trainable: true,
        exclusionReason: null
      })
    ]);

    await app.close();
  });

  test('exports model artifacts and evaluations as protected JSON attachments', async () => {
    const repository = createMemoryRepository();
    const promotedModel = modelArtifact('model-promoted', '2026.07.01.000001', { accuracy: 0.72, f1: 0.68, auc: 0.74 });
    const candidateModel = modelArtifact('model-candidate', '2026.07.01.000002', { accuracy: 0.81, f1: 0.73, auc: 0.79 });
    await repository.saveModel(promotedModel);
    await repository.saveModel(candidateModel);
    await repository.promoteModel('model-promoted');
    const app = await buildServer({ adminToken: 'secret', repository });

    const blockedArtifact = await app.inject({ method: 'GET', url: '/admin/models/model-candidate/artifact' });
    const blockedEvaluationExport = await app.inject({ method: 'GET', url: '/admin/models/model-candidate/evaluation/export' });
    expect(blockedArtifact.statusCode).toBe(401);
    expect(blockedEvaluationExport.statusCode).toBe(401);

    const missingArtifact = await app.inject({
      method: 'GET',
      url: '/admin/models/model-missing/artifact',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(missingArtifact.statusCode).toBe(404);
    expect(missingArtifact.json()).toMatchObject({ ok: false, error: 'Model not found.' });

    const artifact = await app.inject({
      method: 'GET',
      url: '/admin/models/model-candidate/artifact',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers['content-type']).toEqual(expect.stringContaining('application/json'));
    expect(artifact.headers['content-disposition']).toBe('attachment; filename="yapskippr-model-model-candidate.json"');
    expect(artifact.json()).toEqual(candidateModel);

    const evaluation = await app.inject({
      method: 'GET',
      url: '/admin/models/model-candidate/evaluation',
      headers: { 'x-admin-token': 'secret' }
    });
    const evaluationExport = await app.inject({
      method: 'GET',
      url: '/admin/models/model-candidate/evaluation/export',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(evaluationExport.statusCode).toBe(200);
    expect(evaluationExport.headers['content-type']).toEqual(expect.stringContaining('application/json'));
    expect(evaluationExport.headers['content-disposition']).toBe('attachment; filename="yapskippr-model-model-candidate-evaluation.json"');
    expect(evaluationExport.json()).toEqual(evaluation.json());
    expect(evaluationExport.json()).toMatchObject({
      modelId: 'model-candidate',
      thresholds: {
        positive: 0.65,
        review: 0.45
      },
      thresholdCalibration: {
        mode: 'fallback',
        examples: 0,
        positive: {
          threshold: 0.65
        },
        review: {
          threshold: 0.45
        }
      },
      promotedComparison: {
        promotedModelId: 'model-promoted',
        metricDeltas: {
          accuracy: 0.09,
          f1: 0.05,
          auc: 0.05
        }
      }
    });

    await app.close();
  });

  test('exports the training dataset with readiness metadata as a protected JSON attachment', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const positive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'dataset-export-positive',
        videoId: 'video-export-a',
        source: 'transcript'
      })
    });
    const negative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'dataset-export-negative',
        videoId: 'video-export-b',
        source: 'frame-visible-link',
        feedback: 'false_positive'
      })
    });

    for (const [response, label] of [
      [positive, 'positive'],
      [negative, 'false_positive']
    ] as const) {
      expect(response.statusCode).toBe(201);
      const review = await app.inject({
        method: 'POST',
        url: `/admin/feedback/${response.json().feedbackId}/review`,
        headers: { 'x-admin-token': 'secret' },
        payload: { label }
      });
      expect(review.statusCode).toBe(200);
    }

    const blocked = await app.inject({ method: 'GET', url: '/admin/training-dataset/export' });
    expect(blocked.statusCode).toBe(401);

    const exported = await app.inject({
      method: 'GET',
      url: '/admin/training-dataset/export',
      headers: { 'x-admin-token': 'secret' }
    });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toEqual(expect.stringContaining('application/json'));
    expect(exported.headers['content-disposition']).toBe('attachment; filename="yapskippr-training-dataset.json"');
    expect(Number.isNaN(Date.parse(exported.json().generatedAt))).toBe(false);
    expect(exported.json()).toMatchObject({
      featureSchemaVersion: 2,
      readiness: {
        featureSchemaVersion: 2,
        totalExamples: 2,
        compatibleExamples: 2,
        incompatibleExamples: 0,
        positiveExamples: 1,
        negativeExamples: 1,
        ready: true,
        blocker: null
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          occurrenceId: 'dataset-export-positive',
          reviewLabel: 'positive',
          trainingLabel: 1,
          trainable: true
        }),
        expect.objectContaining({
          occurrenceId: 'dataset-export-negative',
          reviewLabel: 'false_positive',
          trainingLabel: 0,
          trainable: true
        })
      ])
    });
    expect(exported.json().items).toHaveLength(2);

    await app.close();
  });

  test('rejects rollback for models that are not currently promoted', async () => {
    const repository = createMemoryRepository();
    await repository.saveModel(modelArtifact('model-a', '2026.07.01.000001', promotionSafeMetricOverrides()));
    await repository.saveModel(modelArtifact('model-b', '2026.07.01.000002', promotionSafeMetricOverrides()));
    const app = await buildServer({ adminToken: 'secret', repository });

    const promoteA = await app.inject({
      method: 'POST',
      url: '/admin/models/model-a/promote',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(promoteA.statusCode).toBe(200);

    const promoteB = await app.inject({
      method: 'POST',
      url: '/admin/models/model-b/promote',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(promoteB.statusCode).toBe(200);

    const rejectedRollback = await app.inject({
      method: 'POST',
      url: '/admin/models/model-a/rollback',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(rejectedRollback.statusCode).toBe(409);
    expect(rejectedRollback.json()).toMatchObject({
      ok: false,
      error: 'Only the currently promoted model can be rolled back.'
    });

    const latestAfterRejectedRollback = await app.inject({ method: 'GET', url: '/api/v1/model/latest' });
    expect(latestAfterRejectedRollback.statusCode).toBe(200);
    expect(latestAfterRejectedRollback.json().modelId).toBe('model-b');

    const rollbackCurrent = await app.inject({
      method: 'POST',
      url: '/admin/models/model-b/rollback',
      headers: { 'x-admin-token': 'secret' }
    });
    expect(rollbackCurrent.statusCode).toBe(200);
    expect(rollbackCurrent.json().model.modelId).toBe('model-a');

    const latestAfterRollback = await app.inject({ method: 'GET', url: '/api/v1/model/latest' });
    expect(latestAfterRollback.statusCode).toBe(200);
    expect(latestAfterRollback.json().modelId).toBe('model-a');

    await app.close();
  });

  test('model evaluation compares metrics against the promoted model', async () => {
    const repository = createMemoryRepository();
    await repository.saveModel(modelArtifact('model-promoted', '2026.07.01.000001', { accuracy: 0.72, f1: 0.68, auc: 0.74 }));
    await repository.saveModel(modelArtifact('model-candidate', '2026.07.01.000002', { accuracy: 0.81, f1: 0.73, auc: 0.79 }));
    await repository.promoteModel('model-promoted');
    const app = await buildServer({ adminToken: 'secret', repository });

    const evaluation = await app.inject({
      method: 'GET',
      url: '/admin/models/model-candidate/evaluation',
      headers: { 'x-admin-token': 'secret' }
    });

    expect(evaluation.statusCode).toBe(200);
    expect(evaluation.json()).toMatchObject({
      modelId: 'model-candidate',
      promotedComparison: {
        promotedModelId: 'model-promoted',
        metricDeltas: {
          accuracy: 0.09,
          f1: 0.05,
          auc: 0.05
        }
      }
    });

    await app.close();
  });
});

function modelArtifact(modelId: string, version: string, metricOverrides: Record<string, number> = {}): CandidateModelArtifact {
  return {
    modelId,
    modelVersion: version,
    featureSchemaVersion: 2,
    createdAt: '2026-07-07T10:00:00.000Z',
    promotedAt: null,
    intercept: 0,
    weights: {
      heuristicConfidence: 1
    },
    thresholds: {
      positive: 0.65,
      review: 0.45
    },
    metrics: {
      accuracy: 0.9,
      precision: 0.8,
      recall: 0.7,
      f1: 0.75,
      auc: 0.85,
      ...metricOverrides
    },
    trainingSetSummary: {
      examples: 2,
      positives: 1,
      negatives: 1
    }
  };
}

function promotionSafeMetricOverrides(): Record<string, number> {
  return {
    thresholdsCalibrated: 1,
    thresholdCalibrationExamples: 40,
    thresholdCalibrationPositives: 20,
    thresholdCalibrationNegatives: 20,
    thresholdCalibrationGroups: 10,
    positivePrecision: 0.95,
    positiveRecall: 0.75,
    reviewRecall: 0.98,
    auc: 0.9
  };
}

import { describe, expect, test } from 'vitest';
import { buildServer, resolveAdminToken } from '../src/app';
import type { CandidateModelArtifact } from '../src/model/types';
import { createMemoryRepository } from '../src/store/memory';
import { feedbackFixture } from './fixtures';

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

  test('persists feedback v2 payloads and protects admin data', async () => {
    const app = await buildServer({ adminToken: 'secret' });

    const feedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture()
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

  test('review, training, promotion, latest model, and rollback work end to end', async () => {
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
    expect(promote.statusCode).toBe(200);

    const latest = await app.inject({ method: 'GET', url: '/api/v1/model/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().modelId).toBe(train.json().model.modelId);

    const rollback = await app.inject({
      method: 'POST',
      url: `/admin/models/${train.json().model.modelId}/rollback`,
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
        featureSchemaVersion: 1
      })
    });
    const currentSchemaPositive = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-positive-summary',
        videoId: 'video-current-positive-summary'
      })
    });
    const currentSchemaNegative = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: feedbackFixture({
        occurrenceId: 'candidate-current-negative-summary',
        videoId: 'video-current-negative-summary',
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

  test('rejects rollback for models that are not currently promoted', async () => {
    const repository = createMemoryRepository();
    await repository.saveModel(modelArtifact('model-a', '2026.07.01.000001'));
    await repository.saveModel(modelArtifact('model-b', '2026.07.01.000002'));
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

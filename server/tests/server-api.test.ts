import { describe, expect, test } from 'vitest';
import { buildServer } from '../src/app';
import { feedbackFixture } from './fixtures';

describe('YapSkippr server API', () => {
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
      featureSchemaVersion: 1,
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
});

import { describe, expect, test } from 'vitest';
import {
  FeedbackSendInvalidatedError,
  createFeedbackSendControl,
  isFeedbackSendInvalidatedError
} from '../../src/core/feedback-send-control';

describe('feedback send control', () => {
  test('requires current consent and an endpoint before issuing a send lease', () => {
    const control = createFeedbackSendControl();
    expect(control.begin()).toBeNull();

    const consentGeneration = control.getConsentGeneration();
    expect(control.authorizeConsentIfCurrent(consentGeneration)).toBe(true);
    expect(control.begin()).toBeNull();

    control.setEndpoint('https://feedback.example/api/v1/feedback');
    expect(control.begin()?.endpoint).toBe('https://feedback.example/api/v1/feedback');
  });

  test('revokes synchronously, aborts active sends, and rejects stale authorization', () => {
    const control = createFeedbackSendControl();
    const pendingAuthorization = control.getConsentGeneration();
    control.authorizeConsentIfCurrent(pendingAuthorization);
    control.setEndpoint('https://feedback.example/api/v1/feedback');
    const lease = control.begin();
    expect(lease).not.toBeNull();

    control.revokeConsent();

    expect(control.isAuthorized()).toBe(false);
    expect(lease?.signal.aborted).toBe(true);
    expect(control.authorizeConsentIfCurrent(pendingAuthorization)).toBe(false);
    expect(() => control.assertCurrent(lease!)).toThrow(FeedbackSendInvalidatedError);
  });

  test('aborts active sends only when endpoint identity changes', () => {
    const control = createFeedbackSendControl();
    control.authorizeConsentIfCurrent(control.getConsentGeneration());
    control.setEndpoint('https://feedback.example/api/v1/feedback');
    const lease = control.begin()!;
    const generation = control.getEndpointGeneration();

    expect(control.setEndpoint('https://feedback.example/api/v1/feedback')).toBe(false);
    expect(control.isCurrent(lease)).toBe(true);

    expect(control.setEndpoint('https://other.example/api/v1/feedback')).toBe(true);
    expect(lease.signal.aborted).toBe(true);
    expect(control.isEndpointGenerationCurrent(generation)).toBe(false);
  });

  test('prevents late endpoint loads from replacing newer values', () => {
    const control = createFeedbackSendControl();
    const loadGeneration = control.getEndpointGeneration();
    control.setEndpoint('https://new.example/feedback');

    expect(control.setEndpointIfCurrent(loadGeneration, 'https://stale.example/feedback')).toBe(false);
    expect(control.getEndpoint()).toBe('https://new.example/feedback');
  });

  test('can invalidate a pending endpoint operation even when no endpoint was set', () => {
    const control = createFeedbackSendControl();
    const generation = control.getEndpointGeneration();

    control.invalidateEndpoint();

    expect(control.isEndpointGenerationCurrent(generation)).toBe(false);
    expect(control.setEndpointIfCurrent(generation, 'https://stale.example/feedback')).toBe(false);
  });

  test('recognizes explicit invalidation and fetch abort errors', () => {
    expect(isFeedbackSendInvalidatedError(new FeedbackSendInvalidatedError())).toBe(true);
    expect(isFeedbackSendInvalidatedError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isFeedbackSendInvalidatedError(new Error('network failed'))).toBe(false);
  });
});

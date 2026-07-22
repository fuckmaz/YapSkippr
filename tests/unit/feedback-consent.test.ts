import { describe, expect, test } from 'vitest';
import {
  FEEDBACK_DATA_COLLECTION_CATEGORIES,
  createFeedbackDataCollectionPermissionRequest,
  evaluateFeedbackAuthorization,
  hasExplicitFeedbackConsent,
  isFirefoxExtensionUrl,
  removesFeedbackDataCollectionPermission
} from '../../src/core/feedback-consent';

describe('feedback consent', () => {
  test('declares the minimal Firefox categories required by the feedback payload', () => {
    expect(FEEDBACK_DATA_COLLECTION_CATEGORIES).toEqual([
      'personallyIdentifyingInfo',
      'browsingActivity',
      'websiteContent',
      'technicalAndInteraction'
    ]);
    expect(createFeedbackDataCollectionPermissionRequest()).toEqual({
      data_collection: [...FEEDBACK_DATA_COLLECTION_CATEGORIES]
    });
  });

  test.each([undefined, null, false, 1, 'true', {}])(
    'does not treat %j as explicit consent',
    (value) => {
      expect(hasExplicitFeedbackConsent(value)).toBe(false);
    }
  );

  test('accepts only the literal boolean true as explicit consent', () => {
    expect(hasExplicitFeedbackConsent(true)).toBe(true);
  });

  test('detects Firefox from the extension origin without user-agent sniffing', () => {
    expect(isFirefoxExtensionUrl('moz-extension://extension-id/')).toBe(true);
    expect(isFirefoxExtensionUrl('chrome-extension://extension-id/')).toBe(false);
    expect(isFirefoxExtensionUrl('not a URL')).toBe(false);
  });

  test('allows Chromium feedback only after explicit local consent', () => {
    expect(evaluateFeedbackAuthorization({ storedConsent: true, isFirefox: false })).toEqual({ allowed: true });
    expect(evaluateFeedbackAuthorization({ storedConsent: false, isFirefox: false })).toEqual({
      allowed: false,
      reason: 'consent-required'
    });
  });

  test('requires both explicit consent and the optional Firefox permission', () => {
    expect(evaluateFeedbackAuthorization({
      storedConsent: true,
      isFirefox: true,
      firefoxPermissionGranted: true
    })).toEqual({ allowed: true });
    expect(evaluateFeedbackAuthorization({
      storedConsent: true,
      isFirefox: true,
      firefoxPermissionGranted: false
    })).toEqual({ allowed: false, reason: 'firefox-permission-required' });
    expect(evaluateFeedbackAuthorization({
      storedConsent: false,
      isFirefox: true,
      firefoxPermissionGranted: true
    })).toEqual({ allowed: false, reason: 'consent-required' });
  });

  test('recognizes Firefox permission removals that revoke any required feedback category', () => {
    expect(removesFeedbackDataCollectionPermission({
      data_collection: ['websiteContent']
    })).toBe(true);
    expect(removesFeedbackDataCollectionPermission({
      data_collection: ['unrelatedCategory']
    })).toBe(false);
    expect(removesFeedbackDataCollectionPermission({ origins: ['<all_urls>'] })).toBe(false);
    expect(removesFeedbackDataCollectionPermission(null)).toBe(false);
  });
});

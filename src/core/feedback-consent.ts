export const FEEDBACK_DATA_COLLECTION_CATEGORIES = [
  'personallyIdentifyingInfo',
  'browsingActivity',
  'websiteContent',
  'technicalAndInteraction'
] as const;

export interface FeedbackDataCollectionPermissionRequest {
  data_collection: string[];
}

export type FeedbackAuthorization =
  | { allowed: true }
  | { allowed: false; reason: 'consent-required' | 'firefox-permission-required' };

export function createFeedbackDataCollectionPermissionRequest(): FeedbackDataCollectionPermissionRequest {
  return { data_collection: [...FEEDBACK_DATA_COLLECTION_CATEGORIES] };
}

export function hasExplicitFeedbackConsent(value: unknown): value is true {
  return value === true;
}

export function isFirefoxExtensionUrl(extensionUrl: string): boolean {
  try {
    return new URL(extensionUrl).protocol === 'moz-extension:';
  } catch {
    return false;
  }
}

export function evaluateFeedbackAuthorization(input: {
  storedConsent: unknown;
  isFirefox: boolean;
  firefoxPermissionGranted?: boolean;
}): FeedbackAuthorization {
  if (!hasExplicitFeedbackConsent(input.storedConsent)) {
    return { allowed: false, reason: 'consent-required' };
  }

  if (input.isFirefox && input.firefoxPermissionGranted !== true) {
    return { allowed: false, reason: 'firefox-permission-required' };
  }

  return { allowed: true };
}

export function removesFeedbackDataCollectionPermission(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.data_collection)) return false;
  return value.data_collection.some((category) => (
    typeof category === 'string'
    && (FEEDBACK_DATA_COLLECTION_CATEGORIES as readonly string[]).includes(category)
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

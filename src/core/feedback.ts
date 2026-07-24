import type { EvidenceKind, EvidenceSource } from './types';

export const OCCURRENCE_FEEDBACK_VALUES = ['accurate', 'false_positive', 'wrong_timing', 'missed_context'] as const;
export const OCCURRENCE_FEEDBACK_MODEL_SOURCE_VALUES = ['bundled', 'downloaded', 'fallback'] as const;

export type OccurrenceFeedbackValue = (typeof OCCURRENCE_FEEDBACK_VALUES)[number];
export type OccurrenceFeedbackType = 'candidate' | 'evidence' | 'missed-segment';
export type OccurrenceFeedbackModelSource = (typeof OCCURRENCE_FEEDBACK_MODEL_SOURCE_VALUES)[number];

export interface OccurrenceFeedbackAction {
  readonly value: OccurrenceFeedbackValue;
  readonly label: string;
  readonly title: string;
}

export const OCCURRENCE_FEEDBACK_ACTIONS = [
  { value: 'accurate', label: 'Good', title: 'Correct detection' },
  { value: 'false_positive', label: 'Wrong', title: 'Wrong detection' },
  { value: 'wrong_timing', label: 'Timing', title: 'Wrong timing' }
] as const satisfies readonly OccurrenceFeedbackAction[];

export interface OccurrenceFeedbackEvidenceSnapshot {
  source: EvidenceSource | string;
  kind: EvidenceKind | string;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  reason: string;
  detail?: string;
}

export interface OccurrenceFeedbackInput {
  clientId?: string;
  videoUrl: string | null;
  videoId: string | null;
  occurrenceId: string;
  occurrenceType: OccurrenceFeedbackType;
  source?: EvidenceSource | string;
  startSeconds: number;
  endSeconds?: number;
  summary: string;
  reason?: string;
  feedback: OccurrenceFeedbackValue;
  notes?: string;
  modelId?: string | null;
  modelVersion?: string | null;
  modelSource?: OccurrenceFeedbackModelSource;
  featureSchemaVersion?: number;
  heuristicConfidence?: number;
  modelConfidence?: number;
  candidateFeatures?: Record<string, number>;
  evidenceSnapshot?: OccurrenceFeedbackEvidenceSnapshot[];
  transcriptContext?: string;
}

export interface OccurrenceFeedbackPayload extends OccurrenceFeedbackInput {
  app: 'YapSkippr';
  version: 2;
  createdAt: string;
}

export function createOccurrenceFeedbackPayload(
  input: OccurrenceFeedbackInput,
  now = Date.now()
): OccurrenceFeedbackPayload {
  return {
    app: 'YapSkippr',
    version: 2,
    ...input,
    createdAt: new Date(now).toISOString()
  };
}

export function normalizeFeedbackEndpoint(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function createFeedbackEndpointOriginPermission(value: string): string | null {
  const normalized = normalizeFeedbackEndpoint(value);
  if (!normalized) return null;
  return `${new URL(normalized).origin}/*`;
}

export function deriveAdminDashboardUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeFeedbackEndpoint(value);
  if (!normalized) return null;

  const endpoint = new URL(normalized);
  return new URL('/admin', endpoint.origin).toString();
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

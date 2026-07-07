import { z } from 'zod';

const featureRecordSchema = z.record(z.string(), z.number().finite());

export const feedbackEvidenceSnapshotSchema = z.object({
  source: z.string().min(1),
  kind: z.string().min(1),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().nonnegative().optional(),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().min(1),
  detail: z.string().optional()
});

export const feedbackPayloadV2Schema = z.object({
  app: z.literal('YapSkippr'),
  version: z.literal(2),
  createdAt: z.string().datetime(),
  videoUrl: z.string().url().nullable(),
  videoId: z.string().nullable(),
  occurrenceId: z.string().min(1),
  occurrenceType: z.enum(['candidate', 'evidence']),
  source: z.string().optional(),
  startSeconds: z.number().finite().nonnegative(),
  summary: z.string().min(1),
  reason: z.string().optional(),
  feedback: z.enum(['accurate', 'false_positive', 'wrong_timing', 'missed_context']),
  notes: z.string().optional(),
  modelId: z.string().nullable().optional(),
  modelVersion: z.string().nullable().optional(),
  modelSource: z.string().optional(),
  featureSchemaVersion: z.number().int().positive().optional(),
  heuristicConfidence: z.number().finite().min(0).max(1).optional(),
  modelConfidence: z.number().finite().min(0).max(1).optional(),
  candidateFeatures: featureRecordSchema.optional(),
  evidenceSnapshot: z.array(feedbackEvidenceSnapshotSchema).optional(),
  transcriptContext: z.string().optional()
});

export type FeedbackPayloadV2 = z.infer<typeof feedbackPayloadV2Schema>;
export type FeedbackEvidenceSnapshot = z.infer<typeof feedbackEvidenceSnapshotSchema>;

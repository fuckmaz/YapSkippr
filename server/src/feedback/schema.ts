import { z } from 'zod';

const featureRecordSchema = z.record(z.string(), z.number().finite());

export const feedbackModelSourceValues = ['bundled', 'downloaded', 'fallback'] as const;
export const feedbackModelSourceSchema = z.enum(feedbackModelSourceValues);

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
  clientId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  videoUrl: z.string().url().nullable(),
  videoId: z.string().nullable(),
  occurrenceId: z.string().min(1),
  occurrenceType: z.enum(['candidate', 'evidence', 'missed-segment']),
  source: z.string().optional(),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().nonnegative().optional(),
  summary: z.string().min(1),
  reason: z.string().optional(),
  feedback: z.enum(['accurate', 'false_positive', 'wrong_timing', 'missed_context']),
  notes: z.string().optional(),
  modelId: z.string().nullable().optional(),
  modelVersion: z.string().nullable().optional(),
  modelSource: feedbackModelSourceSchema.optional(),
  featureSchemaVersion: z.number().int().positive().optional(),
  heuristicConfidence: z.number().finite().min(0).max(1).optional(),
  modelConfidence: z.number().finite().min(0).max(1).optional(),
  candidateFeatures: featureRecordSchema.optional(),
  evidenceSnapshot: z.array(feedbackEvidenceSnapshotSchema).optional(),
  transcriptContext: z.string().optional()
}).superRefine((value, context) => {
  if (value.endSeconds !== undefined && value.endSeconds <= value.startSeconds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endSeconds'],
      message: 'Candidate end time must be after its start time.'
    });
  }
  if (value.occurrenceType === 'missed-segment') {
    if (value.endSeconds === undefined || value.endSeconds - value.startSeconds > 600) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endSeconds'],
        message: 'Missed segments require an end time and may be at most 10 minutes long.'
      });
    }
    if (value.feedback !== 'missed_context' || value.source !== 'user-missed-segment') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feedback'],
        message: 'Missed segments must use the dedicated missed-context source and label.'
      });
    }
  }
});

export type FeedbackModelSource = z.infer<typeof feedbackModelSourceSchema>;
export type FeedbackPayloadV2 = z.infer<typeof feedbackPayloadV2Schema>;
export type FeedbackEvidenceSnapshot = z.infer<typeof feedbackEvidenceSnapshotSchema>;

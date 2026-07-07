export interface CandidateModelArtifact {
  modelId: string;
  modelVersion: string;
  featureSchemaVersion: number;
  createdAt: string;
  promotedAt?: string | null;
  intercept: number;
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  metrics: Record<string, number>;
  trainingSetSummary: Record<string, number>;
}

export interface LabeledTrainingExample {
  id: string;
  videoId: string | null;
  occurrenceId: string;
  label: 0 | 1;
  features: Record<string, number>;
}

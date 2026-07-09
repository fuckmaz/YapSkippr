import type { FeedbackPayloadV2 } from '../feedback/schema.js';
import type { CandidateModelArtifact, LabeledTrainingExample } from '../model/types.js';
import type { TrainingReadinessSummary } from '../model/training-readiness.js';

export type ReviewLabel = 'positive' | 'false_positive' | 'wrong_timing' | 'duplicate' | 'ignored' | 'needs_more_data';

export interface FeedbackRecord {
  id: string;
  receivedAt: string;
  payload: FeedbackPayloadV2;
  review: ReviewRecord | null;
}

export interface ReviewRecord {
  id: string;
  feedbackId: string;
  label: ReviewLabel;
  notes?: string;
  reviewedAt: string;
}

export interface TrainingRunRecord {
  id: string;
  createdAt: string;
  modelId: string;
  datasetSize: number;
  validationSize: number;
  metrics: Record<string, number>;
  status: 'completed';
}

export interface PromotionRecord {
  id: string;
  modelId: string;
  promotedAt: string;
  action: 'promote' | 'rollback';
}

export interface DashboardSummary {
  totalFeedback: number;
  reviewedFeedback: number;
  pendingFeedback: number;
  modelVersions: number;
  promotedModel: CandidateModelArtifact | null;
  detectorSourceDistribution: Record<string, number>;
  feedbackLabelDistribution: Record<string, number>;
  reviewThroughput: Array<{ date: string; reviewed: number }>;
  modelPerformance: Record<string, number>;
  trainingReadiness: TrainingReadinessSummary;
}

export interface YapSkipprRepository {
  createFeedback(payload: FeedbackPayloadV2): Promise<FeedbackRecord>;
  listFeedback(): Promise<FeedbackRecord[]>;
  reviewFeedback(id: string, label: ReviewLabel, notes?: string): Promise<FeedbackRecord | null>;
  listTrainingExamples(): Promise<LabeledTrainingExample[]>;
  createTrainingRun(model: CandidateModelArtifact): Promise<TrainingRunRecord>;
  listTrainingRuns(): Promise<TrainingRunRecord[]>;
  saveModel(model: CandidateModelArtifact): Promise<CandidateModelArtifact>;
  listModels(): Promise<CandidateModelArtifact[]>;
  getModel(id: string): Promise<CandidateModelArtifact | null>;
  getPromotedModel(): Promise<CandidateModelArtifact | null>;
  promoteModel(id: string): Promise<CandidateModelArtifact | null>;
  rollbackModel(id: string): Promise<CandidateModelArtifact | null>;
  getPromotionHistory(): Promise<PromotionRecord[]>;
  getSummary(): Promise<DashboardSummary>;
  close?(): Promise<void>;
}

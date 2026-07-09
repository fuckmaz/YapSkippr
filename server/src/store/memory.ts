import type { FeedbackPayloadV2 } from '../feedback/schema.js';
import { summarizeTrainingReadiness } from '../model/training-readiness.js';
import type { CandidateModelArtifact, LabeledTrainingExample } from '../model/types.js';
import type {
  DashboardSummary,
  FeedbackRecord,
  PromotionRecord,
  ReviewLabel,
  ReviewRecord,
  TrainingRunRecord,
  YapSkipprRepository
} from './types.js';

export function createMemoryRepository(now: () => string = () => new Date().toISOString()): YapSkipprRepository {
  const feedback: FeedbackRecord[] = [];
  const trainingExamples: LabeledTrainingExample[] = [];
  const models: CandidateModelArtifact[] = [];
  const trainingRuns: TrainingRunRecord[] = [];
  const promotions: PromotionRecord[] = [];
  let promotedModelId: string | null = null;
  let counter = 0;

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}_${String(counter).padStart(6, '0')}`;
  }

  return {
    async createFeedback(payload: FeedbackPayloadV2) {
      const record: FeedbackRecord = {
        id: nextId('fb'),
        receivedAt: now(),
        payload,
        review: null
      };
      feedback.unshift(record);
      return record;
    },

    async listFeedback() {
      return feedback;
    },

    async reviewFeedback(id: string, label: ReviewLabel, notes?: string) {
      const record = feedback.find((item) => item.id === id);
      if (!record) return null;
      const review: ReviewRecord = {
        id: nextId('review'),
        feedbackId: id,
        label,
        ...(notes ? { notes } : {}),
        reviewedAt: now()
      };
      record.review = review;

      const trainingLabel = toTrainingLabel(label);
      for (let index = trainingExamples.length - 1; index >= 0; index -= 1) {
        if (trainingExamples[index]?.feedbackId === id) trainingExamples.splice(index, 1);
      }
      if (trainingLabel !== null && record.payload.candidateFeatures) {
        trainingExamples.push({
          id: nextId('example'),
          feedbackId: id,
          videoId: record.payload.videoId,
          occurrenceId: record.payload.occurrenceId,
          label: trainingLabel,
          featureSchemaVersion: record.payload.featureSchemaVersion ?? null,
          features: record.payload.candidateFeatures
        });
      }

      return record;
    },

    async listTrainingExamples() {
      return trainingExamples;
    },

    async createTrainingRun(model: CandidateModelArtifact) {
      const run: TrainingRunRecord = {
        id: nextId('run'),
        createdAt: now(),
        modelId: model.modelId,
        datasetSize: model.trainingSetSummary.examples ?? trainingExamples.length,
        validationSize: model.trainingSetSummary.validationExamples ?? 0,
        metrics: model.metrics,
        status: 'completed'
      };
      trainingRuns.unshift(run);
      return run;
    },

    async listTrainingRuns() {
      return trainingRuns;
    },

    async saveModel(model: CandidateModelArtifact) {
      const existingIndex = models.findIndex((item) => item.modelId === model.modelId);
      if (existingIndex >= 0) models.splice(existingIndex, 1, model);
      else models.unshift(model);
      return model;
    },

    async listModels() {
      return models;
    },

    async getModel(id: string) {
      return models.find((model) => model.modelId === id) ?? null;
    },

    async getPromotedModel() {
      return promotedModelId ? models.find((model) => model.modelId === promotedModelId) ?? null : null;
    },

    async promoteModel(id: string) {
      const model = models.find((item) => item.modelId === id);
      if (!model) return null;
      promotedModelId = id;
      model.promotedAt = now();
      promotions.unshift({
        id: nextId('promotion'),
        modelId: id,
        promotedAt: model.promotedAt,
        action: 'promote'
      });
      return model;
    },

    async rollbackModel(id: string) {
      const currentIndex = promotions.findIndex((promotion) => promotion.modelId === id && promotion.action === 'promote');
      const previous = promotions.slice(currentIndex + 1).find((promotion) => promotion.action === 'promote');
      promotedModelId = previous?.modelId ?? null;
      const model = promotedModelId ? models.find((item) => item.modelId === promotedModelId) ?? null : null;
      promotions.unshift({
        id: nextId('promotion'),
        modelId: model?.modelId ?? id,
        promotedAt: now(),
        action: 'rollback'
      });
      return model;
    },

    async getPromotionHistory() {
      return promotions;
    },

    async getSummary() {
      const reviewed = feedback.filter((item) => item.review);
      const detectorSourceDistribution = countBy(feedback, (item) => item.payload.source ?? item.payload.occurrenceType);
      const feedbackLabelDistribution = countBy(reviewed, (item) => item.review?.label ?? 'pending');
      const promotedModel = promotedModelId ? models.find((model) => model.modelId === promotedModelId) ?? null : null;

      return {
        totalFeedback: feedback.length,
        reviewedFeedback: reviewed.length,
        pendingFeedback: feedback.length - reviewed.length,
        modelVersions: models.length,
        promotedModel,
        detectorSourceDistribution,
        feedbackLabelDistribution,
        reviewThroughput: buildReviewThroughput(reviewed),
        modelPerformance: promotedModel?.metrics ?? {},
        trainingReadiness: summarizeTrainingReadiness(trainingExamples)
      };
    }
  };
}

function toTrainingLabel(label: ReviewLabel): 0 | 1 | null {
  if (label === 'positive') return 1;
  if (label === 'false_positive' || label === 'duplicate' || label === 'ignored') return 0;
  return null;
}

function countBy<T>(items: readonly T[], getKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function buildReviewThroughput(items: readonly FeedbackRecord[]): Array<{ date: string; reviewed: number }> {
  const counts = countBy(items, (item) => item.review?.reviewedAt.slice(0, 10) ?? 'unknown');
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, reviewed]) => ({ date, reviewed }));
}

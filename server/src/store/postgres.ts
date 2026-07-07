import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { FeedbackPayloadV2 } from '../feedback/schema.js';
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

export function createPostgresRepository(databaseUrl: string): YapSkipprRepository {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async createFeedback(payload) {
      const record: FeedbackRecord = {
        id: `fb_${randomUUID()}`,
        receivedAt: new Date().toISOString(),
        payload,
        review: null
      };
      await pool.query(
        'insert into feedback_events (id, received_at, payload, review) values ($1, $2, $3, $4)',
        [record.id, record.receivedAt, record.payload, null]
      );
      return record;
    },

    async listFeedback() {
      const result = await pool.query('select id, received_at, payload, review from feedback_events order by received_at desc');
      return result.rows.map(feedbackFromRow);
    },

    async reviewFeedback(id, label, notes) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const current = await client.query('select id, received_at, payload, review from feedback_events where id = $1 for update', [id]);
        if (current.rowCount === 0) {
          await client.query('rollback');
          return null;
        }
        const record = feedbackFromRow(current.rows[0]);
        const review: ReviewRecord = {
          id: `review_${randomUUID()}`,
          feedbackId: id,
          label,
          ...(notes ? { notes } : {}),
          reviewedAt: new Date().toISOString()
        };
        await client.query('update feedback_events set review = $2 where id = $1', [id, review]);
        await insertTrainingExampleIfUseful(client, record.payload, id, label);
        await client.query('commit');
        return { ...record, review };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async listTrainingExamples() {
      const result = await pool.query('select id, video_id, occurrence_id, label, features from training_examples order by created_at asc');
      return result.rows.map((row): LabeledTrainingExample => ({
        id: row.id,
        videoId: row.video_id,
        occurrenceId: row.occurrence_id,
        label: row.label,
        features: row.features
      }));
    },

    async createTrainingRun(model) {
      const run: TrainingRunRecord = {
        id: `run_${randomUUID()}`,
        createdAt: new Date().toISOString(),
        modelId: model.modelId,
        datasetSize: model.trainingSetSummary.examples ?? 0,
        validationSize: model.trainingSetSummary.validationExamples ?? 0,
        metrics: model.metrics,
        status: 'completed'
      };
      await pool.query(
        'insert into training_runs (id, created_at, model_id, dataset_size, validation_size, metrics, status) values ($1, $2, $3, $4, $5, $6, $7)',
        [run.id, run.createdAt, run.modelId, run.datasetSize, run.validationSize, run.metrics, run.status]
      );
      return run;
    },

    async listTrainingRuns() {
      const result = await pool.query('select id, created_at, model_id, dataset_size, validation_size, metrics, status from training_runs order by created_at desc');
      return result.rows.map((row): TrainingRunRecord => ({
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        modelId: row.model_id,
        datasetSize: row.dataset_size,
        validationSize: row.validation_size,
        metrics: row.metrics,
        status: row.status
      }));
    },

    async saveModel(model) {
      await pool.query(
        `insert into model_artifacts (model_id, artifact, created_at, promoted_at)
         values ($1, $2, $3, $4)
         on conflict (model_id) do update set artifact = excluded.artifact, created_at = excluded.created_at, promoted_at = excluded.promoted_at`,
        [model.modelId, model, model.createdAt, model.promotedAt ?? null]
      );
      return model;
    },

    async listModels() {
      const result = await pool.query('select artifact from model_artifacts order by created_at desc');
      return result.rows.map((row) => row.artifact as CandidateModelArtifact);
    },

    async getModel(id) {
      const result = await pool.query('select artifact from model_artifacts where model_id = $1', [id]);
      return result.rows[0]?.artifact ?? null;
    },

    async getPromotedModel() {
      const state = await pool.query("select value from app_state where key = 'promotedModelId'");
      const modelId = typeof state.rows[0]?.value?.modelId === 'string' ? state.rows[0].value.modelId : null;
      if (!modelId) return null;
      const result = await pool.query('select artifact from model_artifacts where model_id = $1', [modelId]);
      return result.rows[0]?.artifact ?? null;
    },

    async promoteModel(id) {
      const model = await this.getModel(id);
      if (!model) return null;
      const promotedAt = new Date().toISOString();
      const promoted = { ...model, promotedAt };
      await pool.query(
        `update model_artifacts set artifact = $2, promoted_at = $3 where model_id = $1`,
        [id, promoted, promotedAt]
      );
      await pool.query(
        `insert into app_state (key, value) values ('promotedModelId', $1)
         on conflict (key) do update set value = excluded.value`,
        [{ modelId: id }]
      );
      await pool.query(
        'insert into promotion_history (id, model_id, promoted_at, action) values ($1, $2, $3, $4)',
        [`promotion_${randomUUID()}`, id, promotedAt, 'promote']
      );
      return promoted;
    },

    async rollbackModel(id) {
      const history = await this.getPromotionHistory();
      const currentIndex = history.findIndex((item) => item.modelId === id && item.action === 'promote');
      const previous = history.slice(currentIndex + 1).find((item) => item.action === 'promote');
      const rolledBackAt = new Date().toISOString();
      if (previous) {
        await pool.query(
          `insert into app_state (key, value) values ('promotedModelId', $1)
           on conflict (key) do update set value = excluded.value`,
          [{ modelId: previous.modelId }]
        );
      } else {
        await pool.query("delete from app_state where key = 'promotedModelId'");
      }
      await pool.query(
        'insert into promotion_history (id, model_id, promoted_at, action) values ($1, $2, $3, $4)',
        [`promotion_${randomUUID()}`, previous?.modelId ?? id, rolledBackAt, 'rollback']
      );
      return previous ? this.getModel(previous.modelId) : null;
    },

    async getPromotionHistory() {
      const result = await pool.query('select id, model_id, promoted_at, action from promotion_history order by promoted_at desc');
      return result.rows.map((row): PromotionRecord => ({
        id: row.id,
        modelId: row.model_id,
        promotedAt: new Date(row.promoted_at).toISOString(),
        action: row.action
      }));
    },

    async getSummary() {
      const feedback = await this.listFeedback();
      const models = await this.listModels();
      const promotedModel = await this.getPromotedModel();
      const reviewed = feedback.filter((item) => item.review);
      return {
        totalFeedback: feedback.length,
        reviewedFeedback: reviewed.length,
        pendingFeedback: feedback.length - reviewed.length,
        modelVersions: models.length,
        promotedModel,
        detectorSourceDistribution: countBy(feedback, (item) => item.payload.source ?? item.payload.occurrenceType),
        feedbackLabelDistribution: countBy(reviewed, (item) => item.review?.label ?? 'pending'),
        reviewThroughput: buildReviewThroughput(reviewed),
        modelPerformance: promotedModel?.metrics ?? {}
      } satisfies DashboardSummary;
    },

    async close() {
      await pool.end();
    }
  };
}

async function insertTrainingExampleIfUseful(
  client: PoolClient,
  payload: FeedbackPayloadV2,
  feedbackId: string,
  label: ReviewLabel
): Promise<void> {
  const trainingLabel = toTrainingLabel(label);
  if (trainingLabel === null || !payload.candidateFeatures) return;
  await client.query(
    `insert into training_examples (id, feedback_id, video_id, occurrence_id, label, features, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      `example_${randomUUID()}`,
      feedbackId,
      payload.videoId,
      payload.occurrenceId,
      trainingLabel,
      payload.candidateFeatures,
      new Date().toISOString()
    ]
  );
}

function feedbackFromRow(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: row.id as string,
    receivedAt: new Date(row.received_at as string).toISOString(),
    payload: row.payload as FeedbackPayloadV2,
    review: (row.review as ReviewRecord | null) ?? null
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

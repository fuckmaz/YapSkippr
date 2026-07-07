import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { feedbackPayloadV2Schema } from './feedback/schema.js';
import { trainLogisticModel } from './model/trainer.js';
import { createMemoryRepository } from './store/memory.js';
import { createPostgresRepository } from './store/postgres.js';
import type { ReviewLabel, YapSkipprRepository } from './store/types.js';

export interface BuildServerOptions {
  adminToken?: string;
  repository?: YapSkipprRepository;
}

const reviewSchema = z.object({
  label: z.enum(['positive', 'false_positive', 'wrong_timing', 'duplicate', 'ignored', 'needs_more_data']),
  notes: z.string().optional()
});

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const repository = options.repository ?? (process.env.DATABASE_URL ? createPostgresRepository(process.env.DATABASE_URL) : createMemoryRepository());
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? 'dev-admin-token';
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-admin-token']
  });

  const adminDist = path.resolve(process.cwd(), 'dist/admin');
  if (existsSync(adminDist)) {
    await app.register(fastifyStatic, {
      root: adminDist,
      prefix: '/admin/'
    });
  }

  app.get('/healthz', async () => ({ ok: true }));
  app.addHook('onClose', async () => {
    await repository.close?.();
  });

  app.post('/api/v1/feedback', async (request, reply) => {
    const parsed = feedbackPayloadV2Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid feedback payload.', details: parsed.error.flatten() });
    }
    const record = await repository.createFeedback(parsed.data);
    return reply.status(201).send({ ok: true, feedbackId: record.id });
  });

  app.get('/api/v1/model/latest', async (_request, reply) => {
    const model = await repository.getPromotedModel();
    if (!model) return reply.status(404).send({ ok: false, error: 'No promoted model is available.' });
    return reply.send(model);
  });

  app.get('/admin/api/summary', { preHandler: requireAdmin(adminToken) }, async () => repository.getSummary());
  app.get('/admin/api/feedback', { preHandler: requireAdmin(adminToken) }, async () => ({
    items: await repository.listFeedback()
  }));
  app.get('/admin/api/models', { preHandler: requireAdmin(adminToken) }, async () => ({
    items: await repository.listModels(),
    promoted: await repository.getPromotedModel(),
    history: await repository.getPromotionHistory()
  }));
  app.get('/admin/api/training-runs', { preHandler: requireAdmin(adminToken) }, async () => ({
    items: await repository.listTrainingRuns()
  }));

  app.post('/admin/feedback/:id/review', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid review payload.' });
    const { id } = request.params as { id: string };
    const record = await repository.reviewFeedback(id, parsed.data.label as ReviewLabel, parsed.data.notes);
    if (!record) return reply.status(404).send({ ok: false, error: 'Feedback item not found.' });
    return { ok: true, item: record };
  });

  app.post('/admin/models/train', { preHandler: requireAdmin(adminToken) }, async (_request, reply) => {
    const examples = await repository.listTrainingExamples();
    if (examples.length === 0) return reply.status(400).send({ ok: false, error: 'No reviewed training examples are available.' });
    const model = trainLogisticModel(examples);
    await repository.saveModel(model);
    const run = await repository.createTrainingRun(model);
    return reply.status(201).send({ ok: true, model, run });
  });

  app.post('/admin/models/:id/promote', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.promoteModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    return { ok: true, model };
  });

  app.post('/admin/models/:id/rollback', { preHandler: requireAdmin(adminToken) }, async (request) => {
    const { id } = request.params as { id: string };
    const model = await repository.rollbackModel(id);
    return { ok: true, model };
  });

  app.get('/admin/models/:id/evaluation', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    return { modelId: id, metrics: model.metrics, trainingSetSummary: model.trainingSetSummary };
  });

  app.get('/admin', async (_request, reply) => {
    if (existsSync(path.join(adminDist, 'index.html'))) {
      return reply.sendFile('index.html', adminDist);
    }
    return reply.type('text/html').send('<!doctype html><html><body><div id="root">YapSkippr Admin build not found. Run npm run build:admin.</div></body></html>');
  });

  return app;
}

function requireAdmin(adminToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.headers['x-admin-token'] === adminToken) return;
    await reply.status(401).send({ ok: false, error: 'Admin authentication required.' });
  };
}

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
  const adminAssets = path.join(adminDist, 'assets');
  if (existsSync(adminAssets)) {
    await app.register(fastifyStatic, {
      root: adminAssets,
      prefix: '/admin/assets/'
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

  app.post('/admin/session', async (request, reply) => {
    const token = extractAdminSessionToken(request.body);
    if (token !== adminToken) {
      return reply.status(401).send({ ok: false, error: 'Invalid admin token.' });
    }

    reply.header('set-cookie', buildAdminCookie(adminToken));
    return { ok: true };
  });
  app.get('/admin/api/session', { preHandler: requireAdmin(adminToken) }, async () => ({ ok: true }));
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
    const positives = examples.filter((example) => example.label === 1).length;
    const negatives = examples.length - positives;
    if (positives === 0 || negatives === 0) {
      return reply.status(400).send({ ok: false, error: 'Training requires at least one positive and one negative reviewed example.' });
    }
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

  app.post('/admin/models/:id/rollback', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const promoted = await repository.getPromotedModel();
    if (!promoted) return reply.status(409).send({ ok: false, error: 'No model is currently promoted.' });
    if (promoted.modelId !== id) {
      return reply.status(409).send({ ok: false, error: 'Only the currently promoted model can be rolled back.' });
    }
    const model = await repository.rollbackModel(id);
    return { ok: true, model };
  });

  app.get('/admin/models/:id/evaluation', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    return { modelId: id, metrics: model.metrics, trainingSetSummary: model.trainingSetSummary };
  });

  app.get('/admin', async (request, reply) => {
    if (!isAdminRequest(request, adminToken)) {
      return reply.type('text/html').send(renderAdminLoginPage());
    }
    if (existsSync(path.join(adminDist, 'index.html'))) {
      return reply.sendFile('index.html', adminDist);
    }
    return reply.type('text/html').send('<!doctype html><html><body><div id="root">YapSkippr Admin build not found. Run npm run build:admin.</div></body></html>');
  });

  return app;
}

function requireAdmin(adminToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (isAdminRequest(request, adminToken)) return;
    await reply.status(401).send({ ok: false, error: 'Admin authentication required.' });
  };
}

function isAdminRequest(request: FastifyRequest, adminToken: string): boolean {
  return request.headers['x-admin-token'] === adminToken || hasValidAdminCookie(request.headers.cookie, adminToken);
}

function extractAdminSessionToken(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.token === 'string' ? body.token : null;
}

function buildAdminCookie(adminToken: string): string {
  return [
    `yapskippr_admin=${adminSessionSignature(adminToken)}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=604800'
  ].join('; ');
}

function hasValidAdminCookie(cookieHeader: string | undefined, adminToken: string): boolean {
  const cookie = parseCookies(cookieHeader).yapskippr_admin;
  if (!cookie) return false;

  const expected = adminSessionSignature(adminToken);
  const cookieBuffer = Buffer.from(cookie);
  const expectedBuffer = Buffer.from(expected);
  return cookieBuffer.length === expectedBuffer.length && timingSafeEqual(cookieBuffer, expectedBuffer);
}

function adminSessionSignature(adminToken: string): string {
  return createHmac('sha256', adminToken).update('yapskippr-admin-session-v1').digest('hex');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').flatMap((part): Array<[string, string]> => {
      const [key, ...valueParts] = part.trim().split('=');
      if (!key || valueParts.length === 0) return [];
      return [[key, valueParts.join('=')]];
    })
  );
}

function renderAdminLoginPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YapSkippr Admin</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #071015; color: #eef6f8; font: 14px system-ui, sans-serif; }
      form { width: min(420px, calc(100vw - 32px)); display: grid; gap: 14px; padding: 22px; border: 1px solid #24333d; border-radius: 8px; background: #0d171e; box-shadow: 0 20px 60px rgba(0,0,0,.32); }
      h1, p { margin: 0; }
      p { color: #95a8b1; line-height: 1.45; }
      input, button { min-height: 40px; border-radius: 7px; font: inherit; }
      input { border: 1px solid #24333d; background: #111d25; color: #eef6f8; padding: 0 12px; }
      button { border: 0; background: #36d278; color: #04130a; font-weight: 800; cursor: pointer; }
      small { min-height: 18px; color: #ef4f55; }
    </style>
  </head>
  <body>
    <form id="login">
      <h1>Admin access required</h1>
      <p>Enter the YapSkippr server admin token to open the dashboard.</p>
      <input name="token" type="password" autocomplete="current-password" placeholder="Admin token" required />
      <button type="submit">Unlock dashboard</button>
      <small id="error"></small>
    </form>
    <script>
      document.querySelector('#login').addEventListener('submit', async (event) => {
        event.preventDefault();
        const token = new FormData(event.currentTarget).get('token');
        const response = await fetch('/admin/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token })
        });
        if (response.ok) location.reload();
        else document.querySelector('#error').textContent = 'Invalid admin token.';
      });
    </script>
  </body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

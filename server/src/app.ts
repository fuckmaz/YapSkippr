import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { feedbackPayloadV2Schema } from './feedback/schema.js';
import { buildTrainingDatasetRows } from './model/training-dataset.js';
import { trainLogisticModel } from './model/trainer.js';
import { getCompatibleTrainingExamples, summarizeTrainingReadiness } from './model/training-readiness.js';
import type { CandidateModelArtifact } from './model/types.js';
import { createMemoryRepository } from './store/memory.js';
import { createPostgresRepository } from './store/postgres.js';
import type { ReviewLabel, YapSkipprRepository } from './store/types.js';

export interface BuildServerOptions {
  adminToken?: string;
  allowedExtensionOrigins?: readonly string[];
  bodyLimitBytes?: number;
  feedbackRateLimit?: Partial<RateLimitOptions>;
  adminSessionRateLimit?: Partial<RateLimitOptions>;
  repository?: YapSkipprRepository;
}

interface RateLimitOptions {
  max: number;
  windowMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const reviewSchema = z.object({
  label: z.enum(['positive', 'false_positive', 'wrong_timing', 'duplicate', 'ignored', 'needs_more_data']),
  notes: z.string().optional()
});

const defaultBodyLimitBytes = 256 * 1024;
const defaultFeedbackRateLimit: RateLimitOptions = { max: 60, windowMs: 60_000 };
const defaultAdminSessionRateLimit: RateLimitOptions = { max: 10, windowMs: 60_000 };

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const adminToken = resolveAdminToken(options.adminToken);
  const repository = options.repository ?? (process.env.DATABASE_URL ? createPostgresRepository(process.env.DATABASE_URL) : createMemoryRepository());
  const allowedOrigins = options.allowedExtensionOrigins ?? parseAllowedOrigins(process.env.ALLOWED_EXTENSION_ORIGINS);
  const bodyLimit = options.bodyLimitBytes ?? positiveIntegerFromEnv('SERVER_BODY_LIMIT_BYTES', defaultBodyLimitBytes);
  const feedbackRateLimit = resolveRateLimit(options.feedbackRateLimit, defaultFeedbackRateLimit, 'FEEDBACK_RATE_LIMIT');
  const adminSessionRateLimit = resolveRateLimit(options.adminSessionRateLimit, defaultAdminSessionRateLimit, 'ADMIN_SESSION_RATE_LIMIT');
  const app = Fastify({ logger: false, bodyLimit });

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, !origin || isAllowedCorsOrigin(origin, allowedOrigins));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-admin-token']
  });

  const adminDist = path.resolve(process.cwd(), 'dist/admin');
  const adminAssets = path.join(adminDist, 'assets');
  if (existsSync(adminAssets)) {
    await app.register(fastifyStatic, {
      root: adminAssets,
      prefix: '/admin/assets/',
      allowedPath: (_pathName, _root, request) => isAdminRequest(request, adminToken)
    });
  }

  app.get('/healthz', async () => ({ ok: true }));
  app.addHook('onClose', async () => {
    await repository.close?.();
  });

  app.post(
    '/api/v1/feedback',
    { preHandler: createRateLimitPreHandler(feedbackRateLimit, 'Too many feedback submissions. Try again later.') },
    async (request, reply) => {
      const parsed = feedbackPayloadV2Schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: 'Invalid feedback payload.', details: parsed.error.flatten() });
      }
      const record = await repository.createFeedback(parsed.data);
      return reply.status(201).send({ ok: true, feedbackId: record.id });
    }
  );

  app.get('/api/v1/model/latest', async (_request, reply) => {
    const model = await repository.getPromotedModel();
    if (!model) return reply.status(404).send({ ok: false, error: 'No promoted model is available.' });
    return reply.send(model);
  });

  app.post('/admin/session', { preHandler: createRateLimitPreHandler(adminSessionRateLimit, 'Too many admin session attempts. Try again later.') }, async (request, reply) => {
    const token = extractAdminSessionToken(request.body);
    if (token !== adminToken) {
      return reply.status(401).send({ ok: false, error: 'Invalid admin token.' });
    }

    reply.header('set-cookie', buildAdminCookie(adminToken, process.env.NODE_ENV === 'production'));
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
  app.get('/admin/api/training-dataset', { preHandler: requireAdmin(adminToken) }, async () => ({
    items: buildTrainingDatasetRows(await repository.listFeedback())
  }));
  app.get('/admin/training-dataset/export', { preHandler: requireAdmin(adminToken) }, async (_request, reply) => {
    const [feedback, examples] = await Promise.all([repository.listFeedback(), repository.listTrainingExamples()]);
    const readiness = summarizeTrainingReadiness(examples);
    return sendJsonAttachment(reply, 'yapskippr-training-dataset.json', {
      generatedAt: new Date().toISOString(),
      featureSchemaVersion: readiness.featureSchemaVersion,
      readiness,
      items: buildTrainingDatasetRows(feedback)
    });
  });

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
    const readiness = summarizeTrainingReadiness(examples);
    if (!readiness.ready) return reply.status(400).send({ ok: false, error: readiness.blocker });
    const compatibleExamples = getCompatibleTrainingExamples(examples, readiness.featureSchemaVersion);
    const model = trainLogisticModel(compatibleExamples);
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

  app.get('/admin/models/:id/artifact', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    return sendJsonAttachment(reply, `yapskippr-model-${attachmentSafeName(id)}.json`, model);
  });

  app.get('/admin/models/:id/evaluation', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    const promoted = await repository.getPromotedModel();
    return buildModelEvaluationReport(id, model, promoted);
  });

  app.get('/admin/models/:id/evaluation/export', { preHandler: requireAdmin(adminToken) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.status(404).send({ ok: false, error: 'Model not found.' });
    const promoted = await repository.getPromotedModel();
    return sendJsonAttachment(
      reply,
      `yapskippr-model-${attachmentSafeName(id)}-evaluation.json`,
      buildModelEvaluationReport(id, model, promoted)
    );
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

function buildAdminCookie(adminToken: string, secure: boolean): string {
  return [
    `yapskippr_admin=${adminSessionSignature(adminToken)}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
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

function createRateLimitPreHandler(options: RateLimitOptions, error: string) {
  const buckets = new Map<string, RateLimitBucket>();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const now = Date.now();
    const key = rateLimitKey(request);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= options.max) {
      setRateLimitHeaders(reply, options, 0, bucket.resetAt, now);
      await reply.status(429).send({ ok: false, error });
      return;
    }

    bucket.count += 1;
    setRateLimitHeaders(reply, options, Math.max(0, options.max - bucket.count), bucket.resetAt, now);
  };
}

function setRateLimitHeaders(reply: FastifyReply, options: RateLimitOptions, remaining: number, resetAt: number, now: number): void {
  reply.header('x-ratelimit-limit', String(options.max));
  reply.header('x-ratelimit-remaining', String(remaining));
  reply.header('x-ratelimit-reset', String(Math.ceil(resetAt / 1000)));
  if (remaining === 0) reply.header('retry-after', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
}

function rateLimitKey(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedIp = forwardedValue?.split(',')[0]?.trim();
  return forwardedIp || request.ip || 'unknown';
}

function resolveRateLimit(overrides: Partial<RateLimitOptions> | undefined, defaults: RateLimitOptions, envPrefix: string): RateLimitOptions {
  return {
    max: overrides?.max ?? positiveIntegerFromEnv(`${envPrefix}_MAX`, defaults.max),
    windowMs: overrides?.windowMs ?? positiveIntegerFromEnv(`${envPrefix}_WINDOW_MS`, defaults.windowMs)
  };
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sendJsonAttachment(reply: FastifyReply, filename: string, payload: unknown): FastifyReply {
  return reply
    .type('application/json')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(payload);
}

function attachmentSafeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function buildModelEvaluationReport(modelId: string, model: CandidateModelArtifact, promoted: CandidateModelArtifact | null) {
  return {
    modelId,
    metrics: model.metrics,
    trainingSetSummary: model.trainingSetSummary,
    promotedComparison: promoted
      ? {
          promotedModelId: promoted.modelId,
          metricDeltas: compareModelMetrics(model.metrics, promoted.metrics)
        }
      : null
  };
}

function compareModelMetrics(metrics: Record<string, number>, baseline: Record<string, number>): Record<string, number> {
  const names = new Set([...Object.keys(metrics), ...Object.keys(baseline)]);
  return Object.fromEntries(
    [...names].sort().flatMap((name) => {
      const value = metrics[name];
      const baselineValue = baseline[name];
      if (!Number.isFinite(value) || !Number.isFinite(baselineValue)) return [];
      return [[name, roundMetricDelta((value as number) - (baselineValue as number))]];
    })
  );
}

function roundMetricDelta(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
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

export function resolveAdminToken(configuredToken: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const token = (configuredToken ?? env.ADMIN_TOKEN)?.trim();
  const production = env.NODE_ENV === 'production';

  if (!token) {
    if (production) throw new Error('ADMIN_TOKEN must be configured in production.');
    return 'dev-admin-token';
  }

  if (production && token.length < 24) {
    throw new Error('ADMIN_TOKEN must be at least 24 characters in production.');
  }

  return token;
}

function parseAllowedOrigins(value: string | undefined): readonly string[] {
  return (value ?? 'chrome-extension://*,moz-extension://*,http://localhost:*,http://127.0.0.1:*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedCorsOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((allowedOrigin) => originMatchesPattern(origin, allowedOrigin));
}

function originMatchesPattern(origin: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return origin === pattern;
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  return regex.test(origin);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

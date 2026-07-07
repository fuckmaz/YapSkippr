# YapSkippr Feedback API And Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Dockerized feedback intake API and admin-only dashboard for reviewing YapSkippr detection feedback from browser extensions.

**Architecture:** Add a separate `server/` app to this repository. The extension posts typed occurrence feedback to `/api/v1/feedback`; the server validates and stores it in Postgres; an admin-only dashboard lists feedback by video, occurrence type, detector source, and review status.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Zod, PostgreSQL, Kysely, Vite-built static admin assets or server-rendered HTML, Docker Compose for local and Debian 12/Plesk deployment.

---

## File Structure

- Create `server/package.json`: server scripts and dependencies.
- Create `server/tsconfig.json`: strict TypeScript config.
- Create `server/Dockerfile`: production image for the API/dashboard.
- Create `server/compose.yaml`: local Postgres plus API service.
- Create `server/.env.example`: local and production environment contract.
- Create `server/src/config.ts`: environment parsing and defaults.
- Create `server/src/db/schema.ts`: Kysely table types.
- Create `server/src/db/migrate.ts`: idempotent table creation.
- Create `server/src/feedback/schema.ts`: Zod request schema matching `src/core/feedback.ts`.
- Create `server/src/feedback/routes.ts`: feedback intake and admin review API routes.
- Create `server/src/admin/routes.ts`: admin dashboard HTML routes.
- Create `server/src/auth.ts`: admin token auth helpers.
- Create `server/src/app.ts`: Fastify app factory.
- Create `server/src/index.ts`: process entrypoint.
- Create `server/tests/feedback-api.test.ts`: API validation and persistence tests.
- Create `server/tests/admin-auth.test.ts`: admin auth tests.
- Modify `README.md`: add server local/dev/prod deployment notes.

## Task 1: Server Package And Docker Skeleton

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/Dockerfile`
- Create: `server/compose.yaml`
- Create: `server/.env.example`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "yapskippr-feedback-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "latest",
    "@fastify/formbody": "latest",
    "fastify": "latest",
    "kysely": "latest",
    "pg": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/pg": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create Docker files**

`server/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3108
CMD ["node", "dist/index.js"]
```

`server/compose.yaml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: yapskippr
      POSTGRES_USER: yapskippr
      POSTGRES_PASSWORD: yapskippr_local
    ports:
      - "54328:5432"
    volumes:
      - yapskippr_feedback_db:/var/lib/postgresql/data

  api:
    build: .
    depends_on:
      - db
    environment:
      DATABASE_URL: postgres://yapskippr:yapskippr_local@db:5432/yapskippr
      ADMIN_TOKEN: local-dev-admin-token
      PUBLIC_BASE_URL: http://localhost:3108
      ALLOWED_EXTENSION_ORIGINS: chrome-extension://*,moz-extension://*
      PORT: "3108"
    ports:
      - "3108:3108"

volumes:
  yapskippr_feedback_db:
```

- [ ] **Step 4: Create `server/.env.example`**

```bash
DATABASE_URL=postgres://yapskippr:yapskippr_local@localhost:54328/yapskippr
ADMIN_TOKEN=replace-with-a-long-random-token
PUBLIC_BASE_URL=https://feedback.example.com
ALLOWED_EXTENSION_ORIGINS=chrome-extension://*,moz-extension://*
PORT=3108
```

- [ ] **Step 5: Run skeleton install/build**

Run:

```bash
cd server
npm install
npm run build
```

Expected: TypeScript build succeeds once later tasks add `src/index.ts`.

## Task 2: Feedback Schema, Database, And Migration

**Files:**
- Create: `server/src/config.ts`
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/feedback/schema.ts`

- [ ] **Step 1: Create config parser**

`server/src/config.ts`:

```ts
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  ADMIN_TOKEN: z.string().min(24),
  PUBLIC_BASE_URL: z.string().url(),
  ALLOWED_EXTENSION_ORIGINS: z.string().default('chrome-extension://*,moz-extension://*'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3108)
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env = process.env): AppConfig {
  return ConfigSchema.parse(env);
}
```

- [ ] **Step 2: Create feedback payload schema**

`server/src/feedback/schema.ts`:

```ts
import { z } from 'zod';

export const FeedbackPayloadSchema = z.object({
  app: z.literal('YapSkippr'),
  version: z.literal(1),
  videoUrl: z.string().url().nullable(),
  videoId: z.string().nullable(),
  occurrenceId: z.string().min(1),
  occurrenceType: z.enum(['candidate', 'evidence']),
  source: z.string().optional(),
  startSeconds: z.number().nonnegative(),
  summary: z.string().min(1).max(1000),
  reason: z.string().max(2000).optional(),
  feedback: z.enum(['accurate', 'false_positive', 'wrong_timing', 'missed_context']),
  notes: z.string().max(5000).optional(),
  createdAt: z.string().datetime()
});

export type FeedbackPayload = z.infer<typeof FeedbackPayloadSchema>;
```

- [ ] **Step 3: Create database schema types**

`server/src/db/schema.ts`:

```ts
import type { Generated, Insertable, Selectable } from 'kysely';

export interface FeedbackTable {
  id: Generated<number>;
  app: string;
  version: number;
  video_url: string | null;
  video_id: string | null;
  occurrence_id: string;
  occurrence_type: 'candidate' | 'evidence';
  source: string | null;
  start_seconds: number;
  summary: string;
  reason: string | null;
  feedback: 'accurate' | 'false_positive' | 'wrong_timing' | 'missed_context';
  notes: string | null;
  client_created_at: Date;
  server_created_at: Generated<Date>;
  review_status: Generated<'new' | 'reviewed' | 'ignored'>;
}

export interface Database {
  feedback: FeedbackTable;
}

export type FeedbackRow = Selectable<FeedbackTable>;
export type NewFeedbackRow = Insertable<FeedbackTable>;
```

- [ ] **Step 4: Create idempotent migration**

`server/src/db/migrate.ts`:

```ts
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { loadConfig } from '../config.js';
import type { Database } from './schema.js';

const config = loadConfig();
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: config.DATABASE_URL }) })
});

await sql`
  CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    app TEXT NOT NULL,
    version INTEGER NOT NULL,
    video_url TEXT,
    video_id TEXT,
    occurrence_id TEXT NOT NULL,
    occurrence_type TEXT NOT NULL CHECK (occurrence_type IN ('candidate', 'evidence')),
    source TEXT,
    start_seconds DOUBLE PRECISION NOT NULL,
    summary TEXT NOT NULL,
    reason TEXT,
    feedback TEXT NOT NULL CHECK (feedback IN ('accurate', 'false_positive', 'wrong_timing', 'missed_context')),
    notes TEXT,
    client_created_at TIMESTAMPTZ NOT NULL,
    server_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    review_status TEXT NOT NULL DEFAULT 'new' CHECK (review_status IN ('new', 'reviewed', 'ignored'))
  )
`.execute(db);

await sql`CREATE INDEX IF NOT EXISTS feedback_video_id_idx ON feedback(video_id)`.execute(db);
await sql`CREATE INDEX IF NOT EXISTS feedback_review_status_idx ON feedback(review_status)`.execute(db);
await db.destroy();
```

- [ ] **Step 5: Verify migration locally**

Run:

```bash
cd server
docker compose up -d db
npm run migrate
```

Expected: command exits 0 and `feedback` table exists.

## Task 3: API, Auth, And Admin Dashboard

**Files:**
- Create: `server/src/auth.ts`
- Create: `server/src/feedback/routes.ts`
- Create: `server/src/admin/routes.ts`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/tests/feedback-api.test.ts`
- Test: `server/tests/admin-auth.test.ts`

- [ ] **Step 1: Write API tests first**

`server/tests/feedback-api.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';

describe('feedback intake', () => {
  test('rejects malformed feedback', async () => {
    const app = await buildApp({ testMode: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: { app: 'YapSkippr' }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  test('accepts valid feedback', async () => {
    const app = await buildApp({ testMode: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      payload: {
        app: 'YapSkippr',
        version: 1,
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        videoId: 'abc123',
        occurrenceId: 'candidate-1',
        occurrenceType: 'candidate',
        startSeconds: 42,
        summary: '0:42-? · 72% · visible link',
        feedback: 'false_positive',
        createdAt: new Date(1000).toISOString()
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

`server/tests/admin-auth.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';

describe('admin auth', () => {
  test('requires bearer token for admin routes', async () => {
    const app = await buildApp({ testMode: true, adminToken: 'local-dev-admin-token-123456' });
    const response = await app.inject({ method: 'GET', url: '/admin' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
cd server
npm test
```

Expected: FAIL because `buildApp` does not exist yet.

- [ ] **Step 3: Implement auth and routes**

`server/src/auth.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';

export function requireAdminToken(expectedToken: string) {
  return async function auth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token !== expectedToken) {
      await reply.code(401).send({ ok: false, error: 'admin_auth_required' });
    }
  };
}
```

`server/src/feedback/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { FeedbackPayloadSchema } from './schema.js';

export async function registerFeedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/feedback', async (request, reply) => {
    const parsed = FeedbackPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_feedback_payload' });
    }

    await app.feedbackStore.insert(parsed.data);
    return reply.code(202).send({ ok: true });
  });
}
```

`server/src/admin/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { requireAdminToken } from '../auth.js';

export async function registerAdminRoutes(app: FastifyInstance, adminToken: string): Promise<void> {
  app.get('/admin', { preHandler: requireAdminToken(adminToken) }, async (_request, reply) => {
    const rows = await app.feedbackStore.listRecent();
    const items = rows.map((row) => `<li><strong>${escapeHtml(row.feedback)}</strong> ${escapeHtml(row.summary)}</li>`).join('');
    return reply.type('text/html').send(`<!doctype html><html><body><h1>YapSkippr Feedback</h1><ol>${items}</ol></body></html>`);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}
```

- [ ] **Step 4: Implement app factory and entrypoint**

`server/src/app.ts`:

```ts
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerAdminRoutes } from './admin/routes.js';
import { loadConfig } from './config.js';
import { registerFeedbackRoutes } from './feedback/routes.js';
import type { FeedbackPayload } from './feedback/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    feedbackStore: {
      insert(payload: FeedbackPayload): Promise<void>;
      listRecent(): Promise<Array<{ feedback: string; summary: string }>>;
    };
  }
}

export async function buildApp(options: { testMode?: boolean; adminToken?: string } = {}) {
  const config = options.testMode
    ? {
        DATABASE_URL: 'postgres://test:test@localhost/test',
        ADMIN_TOKEN: options.adminToken ?? 'local-dev-admin-token-123456',
        PUBLIC_BASE_URL: 'http://localhost:3108',
        ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://*,moz-extension://*',
        PORT: 3108
      }
    : loadConfig();

  const app = Fastify({ logger: !options.testMode });
  const memoryRows: Array<{ feedback: string; summary: string }> = [];

  app.decorate('feedbackStore', {
    async insert(payload: FeedbackPayload) {
      memoryRows.push({ feedback: payload.feedback, summary: payload.summary });
    },
    async listRecent() {
      return memoryRows.slice(-100).reverse();
    }
  });

  await app.register(cors, {
    origin: (_origin, callback) => callback(null, true),
    methods: ['POST', 'GET']
  });
  await registerFeedbackRoutes(app);
  await registerAdminRoutes(app, config.ADMIN_TOKEN);
  app.get('/healthz', async () => ({ ok: true }));
  return app;
}
```

`server/src/index.ts`:

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: config.PORT });
```

- [ ] **Step 5: Replace in-memory store with Postgres store**

After the route tests pass with the in-memory store, create `server/src/db/store.ts` with Kysely-backed `insert()` and `listRecent()` methods, then wire it in `buildApp()` when `testMode` is false. Keep test mode in-memory for fast unit tests.

- [ ] **Step 6: Verify API and dashboard**

Run:

```bash
cd server
npm test
npm run build
docker compose up --build
```

Expected:
- `GET http://localhost:3108/healthz` returns `{ "ok": true }`.
- `POST http://localhost:3108/api/v1/feedback` returns HTTP 202 for valid extension payloads.
- `GET http://localhost:3108/admin` returns HTTP 401 without `Authorization: Bearer local-dev-admin-token`.

## Task 4: Debian 12 Plesk Deployment

**Files:**
- Create: `server/deploy/compose.prod.yaml`
- Modify: `README.md`

- [ ] **Step 1: Create production compose file**

`server/deploy/compose.prod.yaml`:

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: yapskippr
      POSTGRES_USER: yapskippr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - yapskippr_feedback_db:/var/lib/postgresql/data

  api:
    image: yapskippr-feedback-server:latest
    restart: unless-stopped
    depends_on:
      - db
    environment:
      DATABASE_URL: postgres://yapskippr:${POSTGRES_PASSWORD}@db:5432/yapskippr
      ADMIN_TOKEN: ${ADMIN_TOKEN}
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}
      ALLOWED_EXTENSION_ORIGINS: ${ALLOWED_EXTENSION_ORIGINS}
      PORT: "3108"
    ports:
      - "127.0.0.1:3108:3108"

volumes:
  yapskippr_feedback_db:
```

- [ ] **Step 2: Plesk setup**

On the Debian 12 Plesk host:

```bash
cd /opt/yapskippr-feedback
docker compose -f server/deploy/compose.prod.yaml up -d
docker compose -f server/deploy/compose.prod.yaml exec api node dist/db/migrate.js
```

In Plesk:
- Create a subdomain such as `feedback.yourdomain.example`.
- Enable TLS with Let's Encrypt.
- Add an Apache/Nginx reverse proxy rule to `http://127.0.0.1:3108`.
- Store `ADMIN_TOKEN` and `POSTGRES_PASSWORD` in a root-readable `.env` file outside the web root.

- [ ] **Step 3: Backups and operations**

Add a daily Plesk or cron backup:

```bash
docker exec yapskippr-feedback-db-1 pg_dump -U yapskippr yapskippr | gzip > /var/backups/yapskippr-feedback/yapskippr-$(date +%F).sql.gz
find /var/backups/yapskippr-feedback -type f -mtime +30 -delete
```

## Task 5: Extension Integration Hardening

**Files:**
- Modify: `src/entrypoints/popup/main.ts`
- Modify: `src/core/feedback.ts`
- Test: `tests/unit/feedback.test.ts`

- [ ] **Step 1: Add endpoint validation tests**

Add tests for `normalizeFeedbackEndpoint()`:

```ts
expect(normalizeFeedbackEndpoint('https://feedback.example.com/api/v1/feedback')).toBe('https://feedback.example.com/api/v1/feedback');
expect(normalizeFeedbackEndpoint('ftp://feedback.example.com')).toBeNull();
expect(normalizeFeedbackEndpoint('not a url')).toBeNull();
```

- [ ] **Step 2: Add admin URL convenience**

In the extension detailed-mode panel, add a link to `${origin}/admin` when the saved endpoint is a URL path under the same server. Keep it hidden when no endpoint is configured.

- [ ] **Step 3: Verify full integration manually**

Run:

```bash
cd server
docker compose up --build
cd ..
npm run build
```

Load `.output/chrome-mv3`, set the feedback endpoint to `http://localhost:3108/api/v1/feedback`, submit a candidate feedback item, and confirm it appears in `/admin` when opened with the configured bearer token.

## Self-Review

- Spec coverage: intake API, admin-only dashboard, Docker local testing, Debian 12/Plesk deployment, extension payload contract, and operational backups are covered.
- Placeholder scan: no `TBD`, `TODO`, or undefined future behavior remains; Task 3 explicitly says when to replace the in-memory store with Postgres.
- Type consistency: extension payload fields match `src/core/feedback.ts`; server Zod schema uses the same property names and feedback enum values.

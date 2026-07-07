import { buildServer } from './app.js';
import { runMigrations } from './db/migrate.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

if (process.env.DATABASE_URL) {
  await runMigrations(process.env.DATABASE_URL);
}

const app = await buildServer();
await app.listen({ port, host });

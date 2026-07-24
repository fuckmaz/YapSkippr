import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('deployment artifacts', () => {
  test('ships a production compose file for Debian/Plesk hosting', () => {
    const compose = read('server/deploy/compose.prod.yaml');

    expect(compose).toContain('image: postgres:16');
    expect(compose).toContain('build:');
    expect(compose).toContain('context: ..');
    expect(compose).toContain('127.0.0.1:${YAPSKIPPR_HOST_PORT:-8787}:8787');
    expect(compose).not.toMatch(/5432:5432/);
    expect(compose).toContain('ADMIN_TOKEN: ${ADMIN_TOKEN:?Set ADMIN_TOKEN');
    expect(compose).toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD');
    expect(compose).toContain('/healthz');
    expect(compose).toContain('yapskippr-feedback-db');
    expect(compose).toContain('yapskippr-feedback-server');
  });

  test('documents production environment values without real secrets', () => {
    const env = read('server/deploy/.env.production.example');

    expect(env).toContain('ADMIN_TOKEN=replace-with-a-long-random-hex-token');
    expect(env).toContain('POSTGRES_PASSWORD=replace-with-a-long-random-password');
    expect(env).toContain('PUBLIC_BASE_URL=https://feedback.example.com');
    expect(env).toContain('ALLOWED_EXTENSION_ORIGINS=chrome-extension://*,moz-extension://*');
    expect(env).not.toContain('secret');
  });

  test('includes executable backup helper with retention cleanup', () => {
    const backupPath = path.join(repoRoot, 'server/deploy/backup-postgres.sh');
    const backup = read('server/deploy/backup-postgres.sh');

    expect(existsSync(backupPath)).toBe(true);
    expect(statSync(backupPath).mode & 0o111).toBeGreaterThan(0);
    expect(backup).toContain('pg_dump');
    expect(backup).toContain('gzip');
    expect(backup).toContain('find "$BACKUP_DIR" -type f -name');
    expect(backup).toContain('-mtime +"$RETENTION_DAYS" -delete');
  });

  test('links deployment operations from README and deploy guide', () => {
    const rootReadme = read('README.md');
    const deployReadme = read('server/deploy/README.md');

    expect(rootReadme).toContain('server/deploy/README.md');
    expect(deployReadme).toContain('docker compose --env-file server/deploy/.env.production -f server/deploy/compose.prod.yaml up -d --build');
    expect(deployReadme).toContain('feedback.example.com');
    expect(deployReadme).toContain('backup-postgres.sh');
    expect(deployReadme).toContain('127.0.0.1:${YAPSKIPPR_HOST_PORT:-8787}');
  });

  test('ships Postgres feedback idempotency schema and conflict handling', () => {
    const migration = read('server/src/db/migrate.ts');
    const repository = read('server/src/store/postgres.ts');

    expect(migration).toContain('deduplication_key text');
    expect(migration).toContain('feedback_events_deduplication_key_unique_idx');
    expect(migration).toContain('where deduplication_key is not null');
    expect(repository).toContain('on conflict (deduplication_key)');
    expect(repository).toContain('created: false');
  });
});

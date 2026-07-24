import { Pool } from 'pg';
import { buildFeedbackDeduplicationKey } from '../feedback/deduplication.js';
import { feedbackPayloadV2Schema } from '../feedback/schema.js';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists feedback_events (
        id text primary key,
        received_at timestamptz not null,
        payload jsonb not null,
        review jsonb,
        deduplication_key text
      );

      create table if not exists training_examples (
        id text primary key,
        feedback_id text not null references feedback_events(id) on delete cascade,
        video_id text,
        occurrence_id text not null,
        label integer not null check (label in (0, 1)),
        feature_schema_version integer,
        features jsonb not null,
        created_at timestamptz not null
      );

      create table if not exists model_artifacts (
        model_id text primary key,
        artifact jsonb not null,
        created_at timestamptz not null,
        promoted_at timestamptz
      );

      create table if not exists training_runs (
        id text primary key,
        created_at timestamptz not null,
        model_id text not null,
        dataset_size integer not null,
        validation_size integer not null,
        metrics jsonb not null,
        status text not null
      );

      create table if not exists promotion_history (
        id text primary key,
        model_id text not null,
        promoted_at timestamptz not null,
        action text not null
      );

      create table if not exists app_state (
        key text primary key,
        value jsonb not null
      );

      create index if not exists feedback_events_received_at_idx on feedback_events (received_at desc);
      create index if not exists training_examples_feedback_id_idx on training_examples (feedback_id);
      create index if not exists promotion_history_promoted_at_idx on promotion_history (promoted_at desc);
    `);
    await pool.query('alter table feedback_events add column if not exists deduplication_key text');
    const feedbackRows = await pool.query(
      'select id, payload, deduplication_key from feedback_events order by received_at asc, id asc'
    );
    const assignedKeys = new Set<string>(
      feedbackRows.rows.flatMap((row) => typeof row.deduplication_key === 'string' ? [row.deduplication_key] : [])
    );
    for (const row of feedbackRows.rows) {
      if (row.deduplication_key) continue;
      const payload = feedbackPayloadV2Schema.safeParse(row.payload);
      if (!payload.success) continue;
      const key = buildFeedbackDeduplicationKey(payload.data);
      if (!key || assignedKeys.has(key)) continue;
      const updated = await pool.query(
        'update feedback_events set deduplication_key = $2 where id = $1 and deduplication_key is null',
        [row.id, key]
      );
      if ((updated.rowCount ?? 0) > 0) assignedKeys.add(key);
    }
    await pool.query(`
      create unique index if not exists feedback_events_deduplication_key_unique_idx
        on feedback_events (deduplication_key)
        where deduplication_key is not null;
    `);
    await pool.query('alter table training_examples add column if not exists feature_schema_version integer');
    await pool.query(`
      delete from training_examples stale
      using training_examples latest
      where stale.feedback_id = latest.feedback_id
        and (stale.created_at, stale.id) < (latest.created_at, latest.id);

      create unique index if not exists training_examples_feedback_id_unique_idx
        on training_examples (feedback_id);
    `);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations.');
  await runMigrations(databaseUrl);
}

import { Pool } from 'pg';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists feedback_events (
        id text primary key,
        received_at timestamptz not null,
        payload jsonb not null,
        review jsonb
      );

      create table if not exists training_examples (
        id text primary key,
        feedback_id text not null references feedback_events(id) on delete cascade,
        video_id text,
        occurrence_id text not null,
        label integer not null check (label in (0, 1)),
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
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations.');
  await runMigrations(databaseUrl);
}

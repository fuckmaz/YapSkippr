# YapSkippr Production Deployment

This deployment bundle is intended for a Debian 12 host with Docker Compose and a reverse proxy managed by Plesk. The API binds only to loopback via `127.0.0.1:${YAPSKIPPR_HOST_PORT:-8787}`, so Plesk or another local reverse proxy should terminate TLS and forward traffic to that port.

## Files

- `compose.prod.yaml`: production Postgres and YapSkippr API/dashboard stack.
- `.env.production.example`: required environment values without real credentials.
- `backup-postgres.sh`: compressed Postgres backup helper with retention cleanup.

## First Deploy

From the repository root on the server:

```bash
cp server/deploy/.env.production.example server/deploy/.env.production
chmod 600 server/deploy/.env.production
openssl rand -hex 32
```

Edit `server/deploy/.env.production`:

```text
ADMIN_TOKEN=<long random value>
POSTGRES_PASSWORD=<long random value>
PUBLIC_BASE_URL=https://feedback.example.com
ALLOWED_EXTENSION_ORIGINS=chrome-extension://*,moz-extension://*
YAPSKIPPR_HOST_PORT=8787
```

Start or update the stack:

```bash
docker compose --env-file server/deploy/.env.production -f server/deploy/compose.prod.yaml up -d --build
```

The server runs database migrations automatically on startup when `DATABASE_URL` is set. Check health locally:

```bash
curl http://127.0.0.1:8787/healthz
```

## Plesk Reverse Proxy

In Plesk:

1. Create a subdomain such as `feedback.example.com`.
2. Enable TLS with Let's Encrypt.
3. Add a reverse proxy rule to `http://127.0.0.1:8787`.
4. Keep `server/deploy/.env.production` outside any web-served directory and readable only by the deploy user or root.

After deployment, configure the extension feedback endpoint as:

```text
https://feedback.example.com/api/v1/feedback
```

## Backups

Install a daily cron entry or Plesk scheduled task:

```bash
/opt/yapskippr/server/deploy/backup-postgres.sh
```

Useful overrides:

```bash
BACKUP_DIR=/var/backups/yapskippr-feedback
RETENTION_DAYS=30
CONTAINER_NAME=yapskippr-feedback-db
```

The script creates compressed `pg_dump` files and deletes `yapskippr-*.sql.gz` backups older than the configured retention window.

## Update

From the repository root:

```bash
git pull
docker compose --env-file server/deploy/.env.production -f server/deploy/compose.prod.yaml up -d --build
docker compose --env-file server/deploy/.env.production -f server/deploy/compose.prod.yaml ps
```

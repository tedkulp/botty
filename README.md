# botty

A self-hosted Discord bot built from Modules, with a web dashboard for Admins.

## Running with Docker Compose

Images are published to `ghcr.io/tedkulp/botty`, tagged `main`, the release version (e.g. `1.2.0`) and `sha-<commit>`, for amd64 and arm64.

```sh
curl -O https://raw.githubusercontent.com/tedkulp/botty/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/tedkulp/botty/main/.env.example
$EDITOR .env
mkdir data && sudo chown 1000:1000 data   # the container runs as uid 1000
docker compose up -d
```

SQLite lives in `./data/botty.db`. Migrations run on startup. Set `BOTTY_IMAGE` to run a different image, e.g. one you built with `docker build -t botty:local .`.

### Required environment

Every variable is described in [`.env.example`](.env.example), with the Discord and Pocket ID setup steps.

| Variable | What it is |
| --- | --- |
| `DISCORD_TOKEN` | Bot token. Turn on the Message Content intent and invite with permissions `66624`. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | A confidential Pocket ID client with callback `${PUBLIC_URL}/auth/callback` and logout callback `${PUBLIC_URL}/`. |
| `ADMIN_GROUP` | The Pocket ID group name allowed into the dashboard. Also restrict the client's Access to it. |
| `SESSION_SECRET` | At least 32 characters (`openssl rand -base64 48`). |
| `PUBLIC_URL` | The dashboard's public origin, e.g. `https://botty.example.com`. |

Optional: `LOG_LEVEL` (`info`), `PORT` (`3000`), `DATA_DIR` (`/data`).

### Reverse proxy

Serve Botty at the root of its own host (e.g. `botty.example.com`, not a sub-path) and terminate TLS at the proxy, forwarding plain HTTP to port 3000. `PUBLIC_URL` must be the `https://` origin people use. `GET /healthz` reports `{db, discord}`; it returns 200 while Discord is unreachable and 503 only when the database is.

## Development

```sh
npm ci
npm run dev          # bot + API, tsx watch
npm run dev:client   # dashboard with HMR (proxies /api and /auth)
npm run typecheck
npm test
```

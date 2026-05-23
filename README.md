# daily.fresh

> How fresh are you on this week's dev discourse?

A quiz built on the [daily.dev Public API](https://docs.daily.dev/docs/plus/public-api) for the **2026 daily.dev hackathon**. Ten questions per round, drawn from a pool of ~1000 across seven question kinds — real titles, real upvotes, real comments, real publishers. No fluff, no signup.

**Live:** [dailyfresh.tcsenpai.com](https://dailyfresh.tcsenpai.com)

---

## How it works

A pre-warmer hits daily.dev every 6h, snapshotting top trending posts across major dev topics. Each post becomes raw material for one of seven question kinds:

| Kind              | What it tests                                       |
| ----------------- | --------------------------------------------------- |
| Guess the upvotes | Pick the upvote bracket for a real post             |
| Whose post        | Match a title to its publisher                      |
| Pick the tag      | Identify the primary topic                          |
| How recent        | Date bucket — this week, this month, ancient        |
| Hot-take radar    | Comments-heavy or upvote-heavy?                     |
| Controversy meter | Pick the heat: quiet / normal / hot / on fire       |
| Trivia (LLM)      | Self-hosted LLM generates trivia from post content  |

All questions are pre-built and served from a local SQLite cache — no live API calls happen when you take the quiz. A quality-control pass strips questions whose answers leak from the surrounding context (e.g., title contains the source name).

## Identity & leaderboard

No login. Anon identity via a signed cookie (`df_handle`, HttpOnly, HMAC-SHA256).

- First nickname claim is free.
- Renames are **one-shot** — after that the handle is locked to the uid forever.
- Leaderboard rows persist in SQLite (`./data/daily-fresh.db`), not in cookies.
- Per-uid best-only ranking — no leaderboard flooding.

## Stack

- **Runtime:** Bun
- **Server:** Elysia (server-rendered HTML)
- **Interactivity:** HTMX + Alpine.js
- **State:** SQLite (bun:sqlite, WAL mode)
- **Cache:** Redis (hot read path)
- **Share cards:** satori + resvg-js (1200×630 PNG)
- **LLM:** OpenAI-compatible endpoint (gemma4, qwopus, anything chat-completions)
- **Deploy:** Docker Compose, designed to live behind Caddy/nginx TLS

The visual layer steals daily.dev's food-named accent palette (cabbage magenta, cheese yellow, blueCheese cyan, onion purple, bun orange…) and pairs it with a retro-arcade × cyberpunk display layer.

---

## Run

```bash
cp .env.example .env
# fill in DAILY_DEV_PAT, OPENAI_URL/TOKEN, generate COOKIE_SECRET
docker compose up -d --build
```

Open <http://localhost:3737>. First boot triggers a background pre-warm (~1 min on a cold cache).

Stop with `docker compose down`. SQLite data persists in `./data/`.

### Run without Docker (dev)

```bash
docker compose up -d redis      # Redis only
bun install
bun run migrate
bun run prewarm                 # populate cache
bun run dev                     # hot-reload server
```

## Scripts

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `bun run dev`          | Hot-reload server                                         |
| `bun run start`        | Production server                                         |
| `bun run migrate`      | Apply SQLite schema (idempotent)                          |
| `bun run prewarm`      | Pull from daily.dev and rebuild template question pool    |
| `bun run llm-prewarm`  | Generate trivia questions via self-hosted LLM (see below) |

### LLM trivia prewarm

Generates additional trivia-style questions from cached posts using your self-hosted OpenAI-compatible endpoint.

```bash
# default: 2000 questions, gemma4:e4b, 3 concurrent batches
bun run llm-prewarm

# custom count + model
bun run llm-prewarm --count=500 --model=qwen3.5:9b

# tune batching + concurrency
bun run llm-prewarm --batch=8 --concurrency=4

# dry run — generate and print samples without persisting
bun run llm-prewarm --dry
```

Reads `OPENAI_URL`, `OPENAI_TOKEN`, and `LLM_MODEL` from `.env`. Output is appended to the existing pool (templates + LLM trivia, mixed at sample time). Survives 6h cron pre-warms — trivia is preserved when templates rebuild.

## Env vars

Required:

- `DAILY_DEV_PAT` — Personal Access Token from <https://app.daily.dev/settings/api>
- `COOKIE_SECRET` — secret for signing the `df_handle` cookie. Generate with `openssl rand -base64 32`. Rotate in production.

Optional:

- `PORT` (default `3737`)
- `BASE_URL` (default `http://localhost:3737`) — public-facing URL; OG meta + share links use this
- `DB_PATH` (default `./data/daily-fresh.db`)
- `REDIS_URL` (default `redis://localhost:6379`)
- `LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`)
- `RATE_LIMIT_RPM` (default `50`, self-cap below provider's 60)
- `OPENAI_URL`, `OPENAI_TOKEN`, `LLM_MODEL` — required by `llm-prewarm`, otherwise unused
- `HOST_BIND` (default `127.0.0.1`) — bind interface; localhost-only for proxy deployments
- `HOST_PORT` (default `3737`)
- `NODE_ENV` (`development` | `production`) — forces cookie `Secure` flag when set to production

## Deploy behind a reverse proxy

Compose binds the app to `127.0.0.1:3737`. Terminate TLS at your proxy:

```caddy
dailyfresh.tcsenpai.com {
    encode gzip zstd
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:3737
}
```

Set `BASE_URL=https://dailyfresh.tcsenpai.com` in `.env` so meta tags and share URLs use the public domain. The cookie `Secure` flag activates automatically when `BASE_URL` is `https://`.

## Project layout

```
src/
├── api/          daily.dev client (rate-limit + retry)
├── cache/        Redis wrapper (graceful degradation)
├── config/       env loader + zod schema
├── db/           bun:sqlite + migrations + repository
├── jobs/         prewarm (template Qs) + llm-prewarm (LLM trivia)
├── lib/          logger, id, og renderer, rate-limit, identity (cookie)
├── modes/
│   ├── leaderboard/  per-uid best-only ranking, rename-once
│   └── trending/     question builder + sampling + QC
├── routes/       Elysia routes (pages, API, OG, smoke, identity)
└── views/        HTML rendering (layout + pages)
public/           CSS + Inter Bold (for OG renderer) + favicon
data/             SQLite + OG image cache (volume-mounted, gitignored)
```

## License

MIT — see [LICENSE](./LICENSE).

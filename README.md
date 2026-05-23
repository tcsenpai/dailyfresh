# daily.fresh

> How fresh are you on this week's dev discourse?

A quiz built on the [daily.dev Public API](https://docs.daily.dev/docs/plus/public-api) for the **2026 daily.dev hackathon**. Ten questions per round, drawn from a pool of ~1000 across seven question kinds — real titles, real upvotes, real comments, real publishers. No fluff, no signup.

**Live:** [dailyfresh.tcsenpai.com](https://dailyfresh.tcsenpai.com)

---

## How it works

A pre-warmer hits daily.dev every 6h, snapshotting top trending posts across major dev topics. Each post becomes raw material for one of seven question kinds:

| Kind             | What it tests                                       |
| ---------------- | --------------------------------------------------- |
| Guess the upvotes | Pick the upvote bracket for a real post            |
| Whose post       | Match a title to its publisher                      |
| Pick the tag     | Identify the primary topic                          |
| How recent       | Date bucket — this week, this month, ancient        |
| Hot-take radar   | Comments-heavy or upvote-heavy?                     |
| Summary → title  | Match a summary to its post                         |
| Trivia (LLM)     | Self-hosted LLM generates trivia from post content  |

All questions are pre-built and served from a local SQLite cache — no live API calls happen when you take the quiz. Quality control filters strip questions whose answers leak from the surrounding context (e.g., title contains the source name).

## Identity & leaderboard

No login. Anon identity via a signed cookie (`df_handle`, HttpOnly, HMAC-SHA256). Pick a nickname → land on the leaderboard. **Renames are one-shot.** Per-uid best-only ranking — no leaderboard flooding.

## Stack

- **Runtime:** Bun
- **Server:** Elysia (server-rendered HTML)
- **Interactivity:** HTMX + Alpine.js
- **State:** SQLite (bun:sqlite, WAL mode)
- **Cache:** Redis (hot read path)
- **Share cards:** satori + resvg-js (1200×630 PNG)
- **LLM:** OpenAI-compatible endpoint (gemma4 / qwopus / any chat-completions API)
- **Deploy:** Docker compose, designed to live behind Caddy/nginx TLS

The visual layer steals daily.dev's food-named accent palette (cabbage magenta, cheese yellow, blueCheese cyan, onion purple, bun orange…) and pairs it with a retro-arcade × cyberpunk display layer for the quiz UI.

## Run it

```bash
cd daily-fresh
cp .env.example .env
# fill in DAILY_DEV_PAT, OPENAI_URL/TOKEN, generate COOKIE_SECRET
docker compose up -d --build
```

Open <http://localhost:3737>. First boot triggers a background pre-warm (~1 min on a cold cache).

See [`daily-fresh/README.md`](./daily-fresh/README.md) for full env reference, scripts, and the `llm-prewarm` job that generates the trivia question pool.

## Deploy behind a reverse proxy

The compose file binds the app to `127.0.0.1:3737` by default. Terminate TLS at your proxy:

```caddy
dailyfresh.tcsenpai.com {
    encode gzip zstd
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:3737
}
```

Set `BASE_URL=https://dailyfresh.tcsenpai.com` in `.env` so OG meta tags and share URLs use the public domain. The cookie `Secure` flag activates automatically when `BASE_URL` is `https://`.

## License

MIT — see [LICENSE](./LICENSE).

import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { cron, Patterns } from "@elysiajs/cron";
import { env } from "./config/env";
import { log } from "./lib/logger";
import { migrate } from "./db/migrate";
import { ensureRedis } from "./cache/redis";
import { smokeRoutes } from "./routes/smoke";
import { trendingRoutes } from "./routes/trending";
import { ogRoutes } from "./routes/og";
import { identityRoutes } from "./routes/identity";
import { pageRoutes } from "./routes/pages";
import { prewarm } from "./jobs/prewarm";
import { postsCount } from "./db/repo";

migrate();
await ensureRedis();

if (postsCount() === 0) {
  log.info("posts_cache empty — running initial prewarm in background");
  prewarm().catch((err) => log.error("initial prewarm failed", { err: String(err) }));
}

const app = new Elysia()
  .use(
    cron({
      name: "prewarm",
      pattern: Patterns.everyHours(6),
      run() {
        prewarm().catch((err) => log.error("scheduled prewarm failed", { err: String(err) }));
      },
    }),
  )
  .use(staticPlugin({ prefix: "/static", assets: "public" }))
  .onError(({ error, code, set }) => {
    log.error("unhandled", { code, error: String(error) });
    set.status = 500;
    return { error: "internal_error" };
  })
  .get("/healthz", () => ({ ok: true, ts: new Date().toISOString() }))
  .use(pageRoutes)
  .use(smokeRoutes)
  .use(trendingRoutes)
  .use(identityRoutes)
  .use(ogRoutes)
  .listen(env.PORT);

log.info("daily.fresh listening", { port: env.PORT, baseUrl: env.BASE_URL });

export type App = typeof app;

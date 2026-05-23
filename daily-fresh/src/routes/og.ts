import { Elysia } from "elysia";
import { getQuizResult } from "../db/repo";
import { renderOg } from "../lib/og";
import { log } from "../lib/logger";

export const ogRoutes = new Elysia({ prefix: "/og" })
  .get("/r/:id", async ({ params, set }) => {
    const row = getQuizResult(params.id);
    if (!row || row.mode !== "trending") {
      set.status = 404;
      return new Response("not found", { status: 404 });
    }

    try {
      const score = row.score ?? 0;
      const max = row.max_score ?? 0;
      const pct = max ? Math.round((score / max) * 100) : 0;
      const verdict =
        pct >= 80 ? "Extremely fresh" : pct >= 60 ? "Pretty fresh" : pct >= 40 ? "Lukewarm" : "Catch up time";
      const png = await renderOg({
        kind: "trending",
        badge: "Trending IQ",
        bigNumber: String(score),
        smallNumber: String(max),
        title: `${pct}% — ${verdict}`,
        subtitle: "Can you beat this on daily.fresh?",
      });
      set.headers["content-type"] = "image/png";
      set.headers["cache-control"] = "public, max-age=86400, immutable";
      return new Response(new Uint8Array(png));
    } catch (err) {
      log.error("og render failed", { err: String(err), id: params.id });
      set.status = 500;
      return new Response("render failed", { status: 500 });
    }
  })
  .get("/default", async ({ set }) => {
    try {
      const png = await renderOg({
        kind: "trending",
        badge: "How fresh are you?",
        title: "Ten questions about this week's dev discourse",
        subtitle: "Built on the daily.dev Public API",
      });
      set.headers["content-type"] = "image/png";
      set.headers["cache-control"] = "public, max-age=86400, immutable";
      return new Response(new Uint8Array(png));
    } catch (err) {
      log.error("og default render failed", { err: String(err) });
      set.status = 500;
      return new Response("render failed", { status: 500 });
    }
  });

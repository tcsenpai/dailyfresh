import { Elysia } from "elysia";
import { getQuizResult, latestQuizPool, saveQuizPool } from "../db/repo";
import { buildTrendingPool, sampleQuestions, type TrendingPool } from "../modes/trending/build";
import {
  homePage,
  aboutPage,
  trendingQuizPage,
  resultPage,
  leaderboardPage,
} from "../views/pages";
import { env } from "../config/env";
import { topByMode } from "../modes/leaderboard/repo";
import { decodeIdentity, parseCookie } from "../lib/identity";

function html(s: string): Response {
  return new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function pool(): TrendingPool | null {
  let p = latestQuizPool<TrendingPool>("trending");
  if (!p) {
    p = buildTrendingPool();
    if (p.questions.length > 0) saveQuizPool("trending", null, p);
  }
  return p;
}

export const pageRoutes = new Elysia()
  .get("/", () => html(homePage()))
  .get("/about", () => html(aboutPage()))
  .get("/leaderboard", ({ headers }) => {
    const me = decodeIdentity(parseCookie(headers["cookie"] ?? null));
    const allTime = topByMode({ mode: "trending", limit: 25, sinceHours: null });
    const week = topByMode({ mode: "trending", limit: 25, sinceHours: 24 * 7 });
    return html(leaderboardPage({ allTime, week, meUid: me?.uid ?? null }));
  })
  .get("/trending", ({ query }) => {
    const p = pool();
    if (!p || p.questions.length === 0) {
      return html(
        `<!doctype html><html><head><link rel="stylesheet" href="/static/style.css"></head><body><main style="padding:60px 20px;max-width:560px;margin:0 auto;color:#e6e9f2;background:#0e1217;"><h1 style="font-family:sans-serif;">Quiz warming up</h1><p style="color:#a8b3cf;">The question pool is being built. Refresh in 60 seconds.</p></main></body></html>`,
      );
    }
    // hardcore mode = 20 questions, triggered by ?hardcore=1 (Konami unlocks)
    const isHardcore = query.hardcore === "1";
    const count = isHardcore ? 20 : 10;
    const sample = sampleQuestions(p, count);
    const safe = sample.map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      postTitle: q.postTitle,
      postUrl: q.postUrl,
      postPermalink: q.postPermalink,
      imageUrl: q.imageUrl,
      source: q.source,
      options: q.options,
    }));
    return html(trendingQuizPage({ sessionId: "ssr", questions: safe }));
  })
  .get("/r/:id", ({ params, set }) => {
    const row = getQuizResult(params.id);
    if (!row || row.mode !== "trending") {
      set.status = 404;
      return html(`<h1>404</h1><p>Result not found.</p>`);
    }
    const details = JSON.parse(row.details_json) as any;
    return html(
      resultPage({
        id: row.id,
        score: row.score ?? 0,
        maxScore: row.max_score ?? 0,
        percent: row.max_score ? Math.round(((row.score ?? 0) / row.max_score) * 100) : 0,
        shareUrl: `${env.BASE_URL}/r/${row.id}`,
        ogImage: `${env.BASE_URL}/og/r/${row.id}`,
        breakdown: details.breakdown ?? [],
      }),
    );
  });

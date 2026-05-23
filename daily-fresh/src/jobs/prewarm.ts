/**
 * Pre-warmer cron.
 *
 * Pulls a wide slice of daily.dev posts into posts_cache, then rebuilds the
 * Trending IQ question pool from that snapshot. All user-facing endpoints
 * read from posts_cache / quiz_pools, never hitting the daily.dev API on
 * the request path.
 *
 * Mix of feeds:
 * - /feeds/popular  → general top posts (broad coverage)
 * - /feeds/discussed → debate-heavy posts (richer for engagement-type Qs)
 * - /feeds/tag/{tag} → topic depth across HOT_TAGS
 *
 * Run via cron on a 6h interval, or manually: `bun run prewarm`.
 */

import { dailydev } from "../api/client";
import { log } from "../lib/logger";
import { upsertPosts, postsCount, saveQuizPool, latestQuizPool } from "../db/repo";
import { buildTrendingPool, type TrendingPool } from "../modes/trending/build";
import { qcFilter } from "../modes/trending/qc";

const HOT_TAGS = [
  "ai",
  "rust",
  "javascript",
  "typescript",
  "react",
  "python",
  "go",
  "devops",
  "kubernetes",
  "docker",
  "webdev",
  "security",
  "database",
  "llm",
  "cloud",
  "frontend",
  "backend",
  "performance",
  "open-source",
  "design",
];

const POPULAR_LIMIT = 50;
const TAG_LIMIT = 25;
const DISCUSSED_LIMIT = 30;

export async function prewarm(): Promise<{ posts: number; tags: number; duration_ms: number }> {
  const start = Date.now();
  log.info("prewarm start", { tags: HOT_TAGS.length });

  // 1. global popular
  try {
    const res = await dailydev.popular({ limit: POPULAR_LIMIT });
    upsertPosts(res.data);
    log.info("prewarm popular", { count: res.data.length });
  } catch (err) {
    log.error("prewarm popular failed", { err: String(err) });
  }

  // 2. discussed feed — broader engagement signal
  try {
    const res = await dailydev.discussed({ limit: DISCUSSED_LIMIT, period: 14 });
    upsertPosts(res.data);
    log.info("prewarm discussed", { count: res.data.length });
  } catch (err) {
    log.warn("prewarm discussed failed", { err: String(err) });
  }

  // 3. per-tag feeds (serial, rate-limit friendly)
  let tagsOk = 0;
  for (const tag of HOT_TAGS) {
    try {
      const res = await dailydev.feedByTag(tag, { limit: TAG_LIMIT });
      upsertPosts(res.data);
      tagsOk++;
    } catch (err) {
      log.warn("prewarm tag failed", { tag, err: String(err) });
    }
  }

  // 4. build templates fresh; preserve any factTrivia rows from prior pool
  try {
    const prior = latestQuizPool<TrendingPool>("trending");
    const priorTrivia = (prior?.questions ?? []).filter((q) => q.kind === "factTrivia");
    const { kept: triviaKept, report: triviaReport } = qcFilter(priorTrivia);
    if (priorTrivia.length > 0) {
      log.info("preserved factTrivia from prior pool", {
        before: priorTrivia.length,
        ...triviaReport,
      });
    }

    const fresh = buildTrendingPool();
    const merged: TrendingPool = {
      questions: [...fresh.questions, ...triviaKept],
      builtAt: new Date().toISOString(),
      sample: fresh.sample,
      perKind: {},
    };
    for (const q of merged.questions) merged.perKind[q.kind] = (merged.perKind[q.kind] ?? 0) + 1;

    saveQuizPool("trending", null, merged);
    log.info("trending pool built", {
      total: merged.questions.length,
      perKind: merged.perKind,
    });
  } catch (err) {
    log.error("trending pool build failed", { err: String(err) });
  }

  const duration_ms = Date.now() - start;
  const posts = postsCount();
  log.info("prewarm done", { posts, tags: tagsOk, duration_ms });
  return { posts, tags: tagsOk, duration_ms };
}

if (import.meta.main) {
  await prewarm();
  process.exit(0);
}

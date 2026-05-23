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

const PAGE_LIMIT = 50; // provider cap per call
const POPULAR_PAGES_DEFAULT = 1;
const DISCUSSED_PAGES_DEFAULT = 1;
const TAG_PAGES_DEFAULT = 1;

interface PrewarmOpts {
  popularPages?: number;
  discussedPages?: number;
  tagPages?: number;
}

async function fetchPaginated(
  fetchPage: (cursor?: string) => Promise<{ data: any[]; pagination?: { cursor?: string | null; hasMore?: boolean } }>,
  maxPages: number,
  label: string,
): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    try {
      const res = await fetchPage(cursor);
      upsertPosts(res.data);
      total += res.data.length;
      const nextCursor = res.pagination?.cursor ?? null;
      const hasMore = res.pagination?.hasMore ?? !!nextCursor;
      if (!nextCursor || !hasMore || res.data.length === 0) break;
      cursor = nextCursor;
    } catch (err) {
      log.warn(`prewarm ${label} page failed`, { page: i, err: String(err).slice(0, 200) });
      break;
    }
  }
  return total;
}

export async function prewarm(opts: PrewarmOpts = {}): Promise<{ posts: number; tags: number; duration_ms: number }> {
  const popularPages = opts.popularPages ?? POPULAR_PAGES_DEFAULT;
  const discussedPages = opts.discussedPages ?? DISCUSSED_PAGES_DEFAULT;
  const tagPages = opts.tagPages ?? TAG_PAGES_DEFAULT;

  const start = Date.now();
  log.info("prewarm start", {
    tags: HOT_TAGS.length,
    popularPages,
    discussedPages,
    tagPages,
  });

  // 1. global popular
  const popularCount = await fetchPaginated(
    (cursor) => dailydev.popular({ limit: PAGE_LIMIT, cursor }),
    popularPages,
    "popular",
  );
  log.info("prewarm popular", { count: popularCount, pages: popularPages });

  // 2. discussed feed — debate-heavy posts
  const discussedCount = await fetchPaginated(
    (cursor) => dailydev.discussed({ limit: PAGE_LIMIT, cursor, period: 14 }),
    discussedPages,
    "discussed",
  );
  log.info("prewarm discussed", { count: discussedCount, pages: discussedPages });

  // 3. per-tag feeds (serial, rate-limit friendly)
  let tagsOk = 0;
  for (const tag of HOT_TAGS) {
    const tagCount = await fetchPaginated(
      (cursor) => dailydev.feedByTag(tag, { limit: PAGE_LIMIT, cursor }),
      tagPages,
      `tag:${tag}`,
    );
    if (tagCount > 0) tagsOk++;
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

/**
 * Parse CLI args:
 *   --target=N           rough target post count; auto-derives page depth
 *   --popular-pages=N    explicit page count for /feeds/popular (50 per page)
 *   --discussed-pages=N  explicit page count for /feeds/discussed
 *   --tag-pages=N        explicit page count for each tag feed
 */
function parsePrewarmArgs(argv: string[]): PrewarmOpts {
  const opts: PrewarmOpts = {};
  let target: number | undefined;
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-z-]+)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    const n = Number(val);
    if (key === "target" && Number.isFinite(n) && n > 0) target = n;
    else if (key === "popular-pages" && Number.isFinite(n) && n > 0) opts.popularPages = n;
    else if (key === "discussed-pages" && Number.isFinite(n) && n > 0) opts.discussedPages = n;
    else if (key === "tag-pages" && Number.isFinite(n) && n > 0) opts.tagPages = n;
  }
  if (target !== undefined && (opts.popularPages === undefined && opts.tagPages === undefined && opts.discussedPages === undefined)) {
    // distribute the target across feeds. 50 posts per page.
    // Bias toward tag feeds (variety) but cap popular/discussed too.
    // formula: pages = ceil(target / (50 * (HOT_TAGS.length + 2)))
    const pages = Math.max(1, Math.ceil(target / (50 * (HOT_TAGS.length + 2))));
    opts.popularPages = Math.max(1, Math.ceil(pages * 1.5));
    opts.discussedPages = Math.max(1, Math.ceil(pages * 1.2));
    opts.tagPages = pages;
  }
  return opts;
}

if (import.meta.main) {
  const opts = parsePrewarmArgs(process.argv);
  await prewarm(opts);
  process.exit(0);
}

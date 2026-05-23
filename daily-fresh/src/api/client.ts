/**
 * daily.dev Public API client.
 *
 * Wraps fetch with bearer auth, a self-imposed token-bucket rate limiter,
 * and 429-aware retry/backoff. Provider allows 60 req/min; we default to 50
 * to leave headroom and reduce throttling churn.
 *
 * Feeds endpoints (popular, discussed, by-tag) are upstream-slow (10–20s).
 * Never call these from a user request path — go through the pre-warmer
 * (src/jobs/prewarm.ts) which seeds posts_cache, then serve from SQLite.
 */

import { env } from "../config/env";
import { log } from "../lib/logger";
import { TokenBucket } from "../lib/rate-limit";
import type {
  FeedOptions,
  FeedResponse,
  RecommendOptions,
  SourcesSearchResponse,
  TagsResponse,
} from "./types";

const BASE = "https://api.daily.dev/public/v1";
const USER_AGENT = "daily.fresh/0.1 (hackathon)";
const DEFAULT_TIMEOUT_MS = 45_000;

const bucket = new TokenBucket(env.RATE_LIMIT_RPM, env.RATE_LIMIT_RPM);

export class DailyDevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "DailyDevError";
  }
}

interface FetchOpts {
  path: string;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  retries?: number;
}

function buildUrl(path: string, query?: FetchOpts["query"]): string {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function fetchWithRetry<T>({
  path,
  query,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 2,
}: FetchOpts): Promise<T> {
  let attempt = 0;
  while (true) {
    await bucket.acquire();
    const url = buildUrl(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.DAILY_DEV_PAT}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 5);
        log.warn("daily.dev 429, backing off", { retryAfter, path });
        if (attempt >= retries) {
          throw new DailyDevError("rate limited", 429);
        }
        await Bun.sleep(retryAfter * 1000);
        attempt++;
        continue;
      }

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = await res.text().catch(() => undefined);
        }
        throw new DailyDevError(
          `daily.dev ${res.status} ${res.statusText} for ${path}`,
          res.status,
          body,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DailyDevError) throw err;
      if (attempt >= retries) throw err;
      const backoff = 500 * 2 ** attempt;
      log.warn("daily.dev fetch error, retrying", { err: String(err), backoff, path });
      await Bun.sleep(backoff);
      attempt++;
    }
  }
}

export const dailydev = {
  popular(opts: FeedOptions = {}): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: "/feeds/popular",
      query: { limit: opts.limit, cursor: opts.cursor, tags: opts.tags },
    });
  },

  discussed(opts: FeedOptions = {}): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: "/feeds/discussed",
      query: {
        limit: opts.limit,
        cursor: opts.cursor,
        period: opts.period,
        tag: opts.tag,
        source: opts.source,
      },
    });
  },

  feedByTag(tag: string, opts: FeedOptions = {}): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: `/feeds/tag/${encodeURIComponent(tag)}`,
      query: { limit: opts.limit, cursor: opts.cursor },
    });
  },

  feedBySource(sourceId: string, opts: FeedOptions = {}): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: `/feeds/source/${encodeURIComponent(sourceId)}`,
      query: { limit: opts.limit, cursor: opts.cursor },
    });
  },

  recommendSemantic(opts: RecommendOptions): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: "/recommend/semantic",
      query: { q: opts.q, limit: opts.limit, time: opts.time },
    });
  },

  recommendKeyword(opts: RecommendOptions): Promise<FeedResponse> {
    return fetchWithRetry<FeedResponse>({
      path: "/recommend/keyword",
      query: { q: opts.q, limit: opts.limit, time: opts.time, cursor: opts.cursor },
    });
  },

  searchTags(q: string): Promise<TagsResponse> {
    return fetchWithRetry<TagsResponse>({
      path: "/search/tags",
      query: { q },
    });
  },

  searchSources(q: string): Promise<SourcesSearchResponse> {
    return fetchWithRetry<SourcesSearchResponse>({
      path: "/search/sources",
      query: { q },
    });
  },

  tags(): Promise<TagsResponse> {
    return fetchWithRetry<TagsResponse>({ path: "/tags/" });
  },
};

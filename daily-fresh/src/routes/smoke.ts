import { Elysia, t } from "elysia";
import { dailydev } from "../api/client";
import { cacheGetJson, cacheSetJson } from "../cache/redis";
import { log } from "../lib/logger";

const CACHE_KEY = "smoke:popular:5";
const TTL_SEC = 300;

export const smokeRoutes = new Elysia({ prefix: "/api" }).get(
  "/smoke",
  async ({ query, set }) => {
    const limit = query.limit ?? 5;
    const cacheKey = `${CACHE_KEY}:${limit}`;

    const cached = await cacheGetJson<{ posts: SmokePost[]; cachedAt: string }>(cacheKey);
    if (cached) {
      set.headers["x-cache"] = "hit";
      return { source: "cache", ...cached };
    }

    try {
      const res = await dailydev.popular({ limit });
      const posts: SmokePost[] = res.data.map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        source: p.source.name,
        upvotes: p.numUpvotes,
        comments: p.numComments,
        tags: p.tags,
      }));
      const payload = { posts, cachedAt: new Date().toISOString() };
      await cacheSetJson(cacheKey, payload, TTL_SEC);
      set.headers["x-cache"] = "miss";
      return { source: "live", ...payload };
    } catch (err) {
      log.error("smoke endpoint failed", { err: String(err) });
      set.status = 502;
      return { error: "upstream_failed", detail: String(err) };
    }
  },
  {
    query: t.Object({
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 20, default: 5 })),
    }),
  },
);

interface SmokePost {
  id: string;
  title: string;
  url: string;
  source: string;
  upvotes: number;
  comments: number;
  tags: string[];
}

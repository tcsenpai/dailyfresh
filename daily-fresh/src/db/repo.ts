/**
 * SQLite repository helpers.
 *
 * All persistence lives in a single SQLite file (WAL mode). Tables:
 * - posts_cache    — flattened daily.dev posts (id, title, source, tags, counts, raw_json)
 * - quiz_pools     — pre-built question pools (mode + topic + payload_json)
 * - quiz_results   — submitted quiz outcomes (for share permalinks + OG cards)
 * - bingo_grids, leaderboard — vestigial from earlier modes, unused in MVP
 *
 * Reads are split between richPosts() (image + summary + ≥50 upvotes) and
 * trendingPosts() (any post ≥10 upvotes). The split lets the question
 * builder pick high-quality posts when a Q kind needs an image or summary.
 */

import { db } from "./index";
import type { FeedPost } from "../api/types";

const upsertPostStmt = db.prepare(`
  INSERT INTO posts_cache (
    id, title, url, source_id, source_name, source_handle, tags_csv,
    num_upvotes, num_comments, read_time, published_at, created_at, raw_json, fetched_at
  ) VALUES (
    $id, $title, $url, $source_id, $source_name, $source_handle, $tags_csv,
    $num_upvotes, $num_comments, $read_time, $published_at, $created_at, $raw_json, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    url = excluded.url,
    source_id = excluded.source_id,
    source_name = excluded.source_name,
    source_handle = excluded.source_handle,
    tags_csv = excluded.tags_csv,
    num_upvotes = excluded.num_upvotes,
    num_comments = excluded.num_comments,
    read_time = excluded.read_time,
    published_at = excluded.published_at,
    raw_json = excluded.raw_json,
    fetched_at = excluded.fetched_at
`);

export function upsertPosts(posts: FeedPost[]): void {
  const filtered = posts.filter((p) => p.title && p.url);
  const tx = db.transaction((rows: FeedPost[]) => {
    for (const p of rows) {
      upsertPostStmt.run({
        $id: p.id,
        $title: p.title,
        $url: p.url,
        $source_id: p.source.id,
        $source_name: p.source.name,
        $source_handle: p.source.handle,
        $tags_csv: (p.tags ?? []).join(","),
        $num_upvotes: p.numUpvotes,
        $num_comments: p.numComments,
        $read_time: p.readTime ?? null,
        $published_at: p.publishedAt ?? null,
        $created_at: p.createdAt,
        $raw_json: JSON.stringify(p),
      });
    }
  });
  tx(filtered);
}

export interface CachedPost {
  id: string;
  title: string;
  url: string;
  source_id: string;
  source_name: string;
  source_handle: string;
  tags_csv: string;
  num_upvotes: number;
  num_comments: number;
  read_time: number | null;
  published_at: string | null;
  created_at: string;
  raw_json: string;
  fetched_at: string;
}

/**
 * High-quality posts: image + summary + minimum upvotes.
 * Optionally restrict to recently-fetched.
 */
export function richPosts(opts: { minUpvotes?: number; limit?: number; sinceHours?: number } = {}): CachedPost[] {
  const minUpvotes = opts.minUpvotes ?? 50;
  const limit = opts.limit ?? 200;
  const sinceHours = opts.sinceHours ?? 24 * 30;

  // We filter image+summary in JS by parsing raw_json (cheaper than a generated col).
  const rows = db
    .query<CachedPost, [number, number, number]>(
      `SELECT * FROM posts_cache
       WHERE num_upvotes >= ?
         AND datetime(fetched_at) >= datetime('now', ? || ' hours')
       ORDER BY num_upvotes DESC
       LIMIT ?`,
    )
    .all(minUpvotes, -sinceHours, limit * 3);

  const out: CachedPost[] = [];
  for (const r of rows) {
    try {
      const raw = JSON.parse(r.raw_json);
      if (raw.image && raw.summary && raw.summary.length >= 30) {
        out.push(r);
      }
    } catch {}
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Looser pool used for some question kinds (e.g., engagement-type) that don't need a summary.
 */
export function trendingPosts(opts: { minUpvotes?: number; limit?: number; sinceHours?: number } = {}): CachedPost[] {
  const minUpvotes = opts.minUpvotes ?? 10;
  const limit = opts.limit ?? 200;
  const sinceHours = opts.sinceHours ?? 24 * 30;

  return db
    .query<CachedPost, [number, number, number]>(
      `SELECT * FROM posts_cache
       WHERE num_upvotes >= ?
         AND datetime(fetched_at) >= datetime('now', ? || ' hours')
       ORDER BY num_upvotes DESC
       LIMIT ?`,
    )
    .all(minUpvotes, -sinceHours, limit);
}

export function postsCount(): number {
  const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM posts_cache`).get();
  return row?.n ?? 0;
}

export function sourcesCount(): number {
  const row = db.query<{ n: number }, []>(`SELECT COUNT(DISTINCT source_name) AS n FROM posts_cache`).get();
  return row?.n ?? 0;
}

// quiz_pools
export function saveQuizPool(
  mode: string,
  topic: string | null,
  payload: unknown,
  expiresAt: string | null = null,
): void {
  db.run(
    `INSERT INTO quiz_pools (mode, topic, payload_json, expires_at) VALUES (?, ?, ?, ?)`,
    [mode, topic, JSON.stringify(payload), expiresAt],
  );
}

export function latestQuizPool<T = unknown>(
  mode: string,
  topic: string | null = null,
): T | null {
  const row = topic
    ? db
        .query<{ payload_json: string }, [string, string]>(
          `SELECT payload_json FROM quiz_pools
           WHERE mode = ? AND topic = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(mode, topic)
    : db
        .query<{ payload_json: string }, [string]>(
          `SELECT payload_json FROM quiz_pools
           WHERE mode = ? AND topic IS NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(mode);
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}

// quiz_results
export function saveQuizResult(args: {
  id: string;
  mode: string;
  topic: string | null;
  score: number | null;
  maxScore: number | null;
  archetype: string | null;
  details: unknown;
  ipHash: string | null;
}): void {
  db.run(
    `INSERT INTO quiz_results (id, mode, topic, score, max_score, archetype, details_json, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.id,
      args.mode,
      args.topic,
      args.score,
      args.maxScore,
      args.archetype,
      JSON.stringify(args.details),
      args.ipHash,
    ],
  );
}

export interface QuizResultRow {
  id: string;
  mode: string;
  topic: string | null;
  score: number | null;
  max_score: number | null;
  archetype: string | null;
  details_json: string;
  ip_hash: string | null;
  created_at: string;
}

export function getQuizResult(id: string): QuizResultRow | null {
  return (
    db
      .query<QuizResultRow, [string]>(`SELECT * FROM quiz_results WHERE id = ?`)
      .get(id) ?? null
  );
}

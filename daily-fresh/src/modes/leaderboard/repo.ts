/**
 * Leaderboard repository.
 *
 * One row per quiz submission attached to a handle/uid. Reads support
 * "all-time" and "this week" windows. Per-uid best-only views deduplicate so
 * a single player can't flood the board with low scores.
 */

import { db } from "../../db/index";

export interface LeaderboardRow {
  rank: number;
  handle: string;
  uid: string | null;
  score: number;
  maxScore: number;
  percent: number;
  resultId: string | null;
  createdAt: string;
}

interface RawRow {
  handle: string;
  uid: string | null;
  score: number;
  max_score: number;
  result_id: string | null;
  created_at: string;
}

/**
 * Top scores for a mode, deduplicated to each uid's best run.
 * If `sinceHours` is null, returns all-time.
 */
export function topByMode(opts: {
  mode: string;
  limit?: number;
  sinceHours?: number | null;
}): LeaderboardRow[] {
  const { mode } = opts;
  const limit = opts.limit ?? 20;
  const sinceHours = opts.sinceHours ?? null;

  // For uid'd rows we keep best run per uid; rows without uid show as-is.
  const sql = sinceHours
    ? `
      WITH ranked AS (
        SELECT
          handle, uid, score, max_score, result_id, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(uid, 'anon:' || id)
            ORDER BY (score * 1.0 / NULLIF(max_score, 0)) DESC, score DESC, created_at ASC
          ) AS rn
        FROM leaderboard
        WHERE mode = ?
          AND datetime(created_at) >= datetime('now', ? || ' hours')
      )
      SELECT handle, uid, score, max_score, result_id, created_at
      FROM ranked
      WHERE rn = 1
      ORDER BY (score * 1.0 / NULLIF(max_score, 0)) DESC, score DESC, created_at ASC
      LIMIT ?
    `
    : `
      WITH ranked AS (
        SELECT
          handle, uid, score, max_score, result_id, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(uid, 'anon:' || id)
            ORDER BY (score * 1.0 / NULLIF(max_score, 0)) DESC, score DESC, created_at ASC
          ) AS rn
        FROM leaderboard
        WHERE mode = ?
      )
      SELECT handle, uid, score, max_score, result_id, created_at
      FROM ranked
      WHERE rn = 1
      ORDER BY (score * 1.0 / NULLIF(max_score, 0)) DESC, score DESC, created_at ASC
      LIMIT ?
    `;

  const rows: RawRow[] = sinceHours
    ? db.query<RawRow, [string, number, number]>(sql).all(mode, -sinceHours, limit)
    : db.query<RawRow, [string, number]>(sql).all(mode, limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    handle: r.handle,
    uid: r.uid,
    score: r.score,
    maxScore: r.max_score,
    percent: r.max_score ? Math.round((r.score / r.max_score) * 100) : 0,
    resultId: r.result_id,
    createdAt: r.created_at,
  }));
}

export function insertLeaderboardRow(args: {
  mode: string;
  topic: string | null;
  handle: string;
  uid: string | null;
  score: number;
  maxScore: number;
  resultId: string | null;
  ipHash: string | null;
}): void {
  db.run(
    `INSERT INTO leaderboard (mode, topic, handle, uid, score, max_score, result_id, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.mode,
      args.topic,
      args.handle,
      args.uid,
      args.score,
      args.maxScore,
      args.resultId,
      args.ipHash,
    ],
  );
}

/**
 * Update display handle on every existing row for a uid. Lets users rename
 * without losing history.
 */
export function renameUid(uid: string, newHandle: string): number {
  const r = db.run(`UPDATE leaderboard SET handle = ? WHERE uid = ?`, [newHandle, uid]);
  return Number(r.changes ?? 0);
}

export interface UidSnapshot {
  uid: string;
  handle: string;
  totalRuns: number;
  bestPercent: number;
  bestScore: number;
  bestMax: number;
  bestResultId: string | null;
  lastRun: string | null;
}

export function snapshotForUid(uid: string): UidSnapshot | null {
  const row = db
    .query<{
      handle: string;
      total: number;
      best_pct: number;
      best_score: number;
      best_max: number;
      best_result: string | null;
      last_run: string | null;
    }, [string, string, string, string, string]>(
      `SELECT
         (SELECT handle FROM leaderboard WHERE uid = ? ORDER BY created_at DESC LIMIT 1) AS handle,
         COUNT(*) AS total,
         MAX(score * 100.0 / NULLIF(max_score, 0)) AS best_pct,
         (SELECT score FROM leaderboard WHERE uid = ? ORDER BY (score*1.0/NULLIF(max_score,0)) DESC, score DESC LIMIT 1) AS best_score,
         (SELECT max_score FROM leaderboard WHERE uid = ? ORDER BY (score*1.0/NULLIF(max_score,0)) DESC, score DESC LIMIT 1) AS best_max,
         (SELECT result_id FROM leaderboard WHERE uid = ? ORDER BY (score*1.0/NULLIF(max_score,0)) DESC, score DESC LIMIT 1) AS best_result,
         MAX(created_at) AS last_run
       FROM leaderboard
       WHERE uid = ?`,
    )
    .get(uid, uid, uid, uid, uid);

  if (!row || !row.total) return null;
  return {
    uid,
    handle: row.handle,
    totalRuns: row.total,
    bestPercent: Math.round(row.best_pct ?? 0),
    bestScore: row.best_score,
    bestMax: row.best_max,
    bestResultId: row.best_result,
    lastRun: row.last_run,
  };
}

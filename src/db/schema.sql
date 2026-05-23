-- daily.fresh schema
-- Version: 1

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cache of daily.dev posts. Key by their id, json blob for forward-compat fields.
CREATE TABLE IF NOT EXISTS posts_cache (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_handle TEXT NOT NULL,
  tags_csv TEXT NOT NULL DEFAULT '',
  num_upvotes INTEGER NOT NULL DEFAULT 0,
  num_comments INTEGER NOT NULL DEFAULT 0,
  read_time INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_cache_source ON posts_cache(source_id);
CREATE INDEX IF NOT EXISTS idx_posts_cache_upvotes ON posts_cache(num_upvotes DESC);
CREATE INDEX IF NOT EXISTS idx_posts_cache_fetched ON posts_cache(fetched_at DESC);

-- Per-mode pre-baked quiz question pools, refreshed by cron.
CREATE TABLE IF NOT EXISTS quiz_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,           -- 'trending' | 'archetype' | 'bingo'
  topic TEXT,                   -- nullable; e.g. 'rust', 'ai'
  payload_json TEXT NOT NULL,   -- mode-specific payload (questions, grid, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_pools_mode_topic ON quiz_pools(mode, topic, created_at DESC);

-- Persistent quiz result records (for share permalinks).
CREATE TABLE IF NOT EXISTS quiz_results (
  id TEXT PRIMARY KEY,           -- short id (8-12 chars)
  mode TEXT NOT NULL,
  topic TEXT,
  score INTEGER,
  max_score INTEGER,
  archetype TEXT,                -- only for archetype mode
  details_json TEXT NOT NULL,    -- mode-specific result payload
  ip_hash TEXT,                  -- anon, for abuse limits
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quiz_results_mode_created ON quiz_results(mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_results_archetype ON quiz_results(archetype);

-- Daily Tag Bingo grid (one per day, reused).
CREATE TABLE IF NOT EXISTS bingo_grids (
  day TEXT PRIMARY KEY,          -- YYYY-MM-DD
  grid_json TEXT NOT NULL,       -- 5x5 tag matrix + metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Leaderboard rows.
CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  topic TEXT,
  handle TEXT NOT NULL,          -- display name picked by user
  uid TEXT,                      -- stable anon id from signed cookie
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  result_id TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (result_id) REFERENCES quiz_results(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_mode ON leaderboard(mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_uid ON leaderboard(uid);
CREATE INDEX IF NOT EXISTS idx_leaderboard_created ON leaderboard(created_at);

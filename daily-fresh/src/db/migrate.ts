import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./index";
import { log } from "../lib/logger";

const CURRENT_VERSION = 2;

function currentVersion(): number {
  const row = db
    .query<{ version: number }, []>("SELECT MAX(version) AS version FROM schema_version")
    .get();
  return row?.version ?? 0;
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const have = currentVersion();
  if (have >= CURRENT_VERSION) {
    log.info("db schema up to date", { version: have });
    return;
  }

  const schemaPath = resolve(import.meta.dir, "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");

  db.transaction(() => {
    db.exec(sql);

    // v2: leaderboard.uid column (idempotent — SQLite throws if exists)
    if (have < 2) {
      try {
        db.exec(`ALTER TABLE leaderboard ADD COLUMN uid TEXT;`);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }

    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [CURRENT_VERSION]);
  })();

  log.info("db migrated", { from: have, to: CURRENT_VERSION });
}

if (import.meta.main) {
  migrate();
}
